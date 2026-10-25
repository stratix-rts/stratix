/**
 * 文件职责：角色任务（CharacterTask）状态机 —— **纯函数**，是「什么动作能让任务走到哪个相位」的
 *   唯一裁决点。语义来源：.long-run-agent/tasks/task_037.md「任务派发命令与队列」。
 * 输入：当前 CharacterTask + 一个 TaskAction。
 * 输出：新的 CharacterTask 与本次迁移是否实质变更（changed=false 时调用方可跳过广播与事件）。
 * 禁止事项：
 *   1. 碰 store / bus / DOM —— 本文件只算状态，不持有也不写入任何东西（写库在 manager.ts）；
 *   2. 直接修改传入的 task —— 任务态是 immutable，返回新对象；
 *   3. 静默接受非法迁移 —— 非法动作原样返回并带 error，上层据此上报 Notice；
 *   4. 在这里做输入校验（prompt 非空 / 长度上限）—— 那是 manager 的守门职责，两处判定必然漂移。
 *
 * 相位机（契约词表见 types.ts 的 TaskStatus）：
 *   queued ──start──▶ running ──complete──▶ completed
 *     │                   │
 *     ├──cancel──▶ cancelled（@since v3.23，task_047：仅 queued 可取消）
 *     └──────fail─────────┴───▶ failed
 *   - fail 允许从 queued 与 running 出发：queued 直达 failed 是**守门拦截**的落点
 *     （agent 未检出等 —— 派了但注定跑不起来，直接 failed 带原因，不进队列空转）；
 *   - cancel 只认 queued（@since v3.23）：running 不强杀（规格：中止在跑任务归「先停止」
 *     另一条路，状态机拒绝并回错误码，由上层转 UI 提示）；
 *   - completed / failed / cancelled 是终态：任何动作都判非法（重复收尾不改写历史）——
 *     对 cancelled 的重复 cancel 也拒（幂等拒绝，重复点按钮不会造出第二个真相）；
 *   - **失败不自动重试**（task_037 规格）：状态机里没有 retry 动作，重派是调用方的新任务。
 *
 * @since v3.16（task_037）；v3.23（task_047）追加 cancel 动作与 cancelled 终态。
 */

import {
  MAX_TASK_SUMMARY_LEN,
  type CharacterTask,
  type TaskStatus,
} from '../types';

/** 迁移被拒的机器可读原因（只有一个：相位不允许这个动作）。 */
export type TaskErrorCode = 'illegal-transition';

export interface TaskTransition {
  /** 迁移成功后的任务；被拒时是**原引用**（调用方据此判定"没变"）。 */
  readonly next: CharacterTask;
  readonly changed: boolean;
  readonly error?: TaskErrorCode;
}

export type TaskAction =
  /** queued → running：开工（盖 startedAt）。 */
  | { type: 'start'; at: number }
  /** running → completed：收尾（盖 endedAt，写输出摘要）。 */
  | { type: 'complete'; at: number; output: string }
  /** queued | running → failed：失败收尾（盖 endedAt，output=失败原因）。 */
  | { type: 'fail'; at: number; reason: string }
  /**
   * queued → cancelled：排队取消（@since v3.23，task_047；盖 endedAt，output=占位文案）。
   * running / 终态一律拒绝 —— 取消在跑任务归「先停止」另一条路，这里不掌生杀。
   */
  | { type: 'cancel'; at: number };

/** 终态：不再接受任何动作（@since v3.23 增 cancelled）。 */
const TERMINAL_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled'];

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** 在办（未收尾）：单位忙闲派生与队列占用判定都用它。 */
export function isActiveTaskStatus(status: TaskStatus): boolean {
  return !isTerminalTaskStatus(status);
}

/** 非法迁移：原样返回当前引用 + changed=false，调用方不需要判断"是否变了"。 */
function reject(current: CharacterTask): TaskTransition {
  return { next: current, changed: false, error: 'illegal-transition' };
}

function move(
  current: CharacterTask,
  status: TaskStatus,
  patch: Partial<CharacterTask> = {}
): TaskTransition {
  return { next: { ...current, ...patch, status }, changed: true };
}

/** 新建一条 queued 任务（入参已过 manager 守门：prompt trim 过、非空、限长内）。 */
export function createQueuedTask(input: {
  readonly id: string;
  readonly characterId: string;
  readonly prompt: string;
  readonly createdAt: number;
}): CharacterTask {
  return {
    id: input.id,
    characterId: input.characterId,
    prompt: input.prompt,
    status: 'queued',
    createdAt: input.createdAt,
    startedAt: null,
    endedAt: null,
    output: '',
  };
}

/**
 * 状态机本体。纯函数、可穷举测试：非法迁移一律 reject，不抛异常
 * （命令总线是同步的，抛异常会打断一次广播；失败语义由上层转成 Notice）。
 */
export function applyTaskAction(current: CharacterTask, action: TaskAction): TaskTransition {
  // 终态不可再动：重复 complete / fail 都不该改写历史（否则事件重放会造出第二份真相）。
  if (isTerminalTaskStatus(current.status)) return reject(current);

  switch (action.type) {
    case 'start': {
      if (current.status !== 'queued') return reject(current);
      return move(current, 'running', { startedAt: action.at });
    }
    case 'complete': {
      if (current.status !== 'running') return reject(current);
      return move(current, 'completed', {
        endedAt: action.at,
        output: summarizeTaskOutput(action.output),
      });
    }
    case 'fail': {
      return move(current, 'failed', {
        endedAt: action.at,
        output: action.reason.length > 0 ? action.reason : '任务失败（未提供原因）',
      });
    }
    case 'cancel': {
      // 仅 queued 可取消（@since v3.23）：running 不强杀，终态不重开 —— 其余相位一律 reject。
      // output 占位文案写死在状态机：取消没有外部原因可传，且终态 output 永不为空串（读的人不猜）。
      if (current.status !== 'queued') return reject(current);
      return move(current, 'cancelled', {
        endedAt: action.at,
        output: '任务在排队时被取消',
      });
    }
  }
}

/**
 * 输出摘要：WorldState 里的 task.output 只存摘要（全文在 SQLite tasks 表，见 task-service）。
 * 空输出 → 占位文案（静默的"完成"比说清更让人困惑）；超长截断加省略号。
 * 导出供 manager 与单测共用，别在两侧各写一份截断逻辑。
 */
export function summarizeTaskOutput(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '（任务完成，无文本输出）';
  if (trimmed.length <= MAX_TASK_SUMMARY_LEN) return trimmed;
  return `${trimmed.slice(0, MAX_TASK_SUMMARY_LEN)}…`;
}

/**
 * 腾位置：只丢终态的历史（completed / failed / **cancelled**，@since v3.23 —— 取消的排队
 * 是历史不是在办，同样可被淘汰），直到能容下 keep 条 —— 与 core/mission 的 dropSettledMissions
 * 同一口径。**绝不丢在办任务**（queued / running）：让一条在跑的任务静默消失比"拒绝新派"更糟。
 * 腾不出位置时由调用方拒绝新派并回 Notice —— 这是 tasks 有界的保证，不会出现第三条路。
 */
export function dropSettledTasks(tasks: readonly CharacterTask[], keep: number): CharacterTask[] {
  const drop = new Set<number>();
  let remaining = tasks.length;
  for (let i = 0; i < tasks.length && remaining > keep; i += 1) {
    if (isTerminalTaskStatus(tasks[i].status)) {
      drop.add(i);
      remaining -= 1;
    }
  }
  return drop.size === 0 ? tasks.slice() : tasks.filter((_, i) => !drop.has(i));
}
