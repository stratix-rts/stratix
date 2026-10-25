/**
 * 文件职责：**角色任务域的写入面**（task_037）—— 把 HudCommand（task.assign）与程序化调用
 *   （app 层 task-service 的 start/complete/fail）翻译成状态机动作，并把结果**投影进 store**
 *   （WorldState.tasks + units 的忙闲派生）。相位裁决全在 machine.ts（纯函数），
 *   本文件只做三件事：找对象 → 跑动作 → 写库 + 上报 + 发生命周期事件。
 * 输入：core/store 的 CoreStore；task.assign 的参数；task-service 回报的动作。
 * 输出：WorldState.tasks 与 units[].status（busy 派生）的写入；task.* 总线事件；失败时的 Notice。
 * 禁止事项：
 *   1. 自己订阅命令总线 —— 与 core/mission 同一口径：任务域无 IO、无长驻资源，
 *      由 core/runtime.ts 直接调用本模块（四行 case），少一层"这条命令归谁"的判定；
 *   2. 自己 emitState —— 状态广播的唯一出口仍是 core/runtime.ts 的 store 订阅
 *      （否则一次变更广播两遍，两侧白重渲染一次）；
 *   3. 在命令里抛异常 —— 命令总线是同步的，抛异常会打断整轮广播；一切失败都转成 Notice；
 *   4. 做 IO / 认识 transport —— **transport 执行全在 app 层 task-service**（core 零 IO 铁律），
 *      本模块只认「状态迁移」这一件事；
 *   5. 在这里判定 prompt 合法性以外的守门（agent 是否检出等）—— 那是 app 层的职责，
 *      不满足时由 task-service 调 failTask 直达终态（状态里看得见原因）。
 *
 * ============ 为什么本模块会发 task.* 总线事件（与 mission 不发事件的差别）============
 * task_037 规格指定：任务生命周期在总线上广播（task.queued / task.started / task.completed /
 * task.failed，挂在 WorldEvent 通道上，runtime 显式接地不进 onUnhandled —— 同 unit.position
 * 的先例）。消费者都在 app 层：
 *   - task-service：靠 task.queued 出队执行（core 不认识 transport，执行必须由 app 层驱动）；
 *   - 任务落库订阅者：tasks 表的写入时机（全文输出由 task-service 落，摘要随事件走）。
 * @since v3.23（task_047）增 task.cancelled：消费者同上（task-service 据此从待执行队列剔除，
 * 防「取消与出队同帧」的竞态；落库订阅者落 cancelled 快照）。取消不发 exp、不回流报告 ——
 * 取消的任务没跑过，没有可回的结果。
 * why 不让 app 层各自轮询 store diff：diff 要比整份数组且说不清"哪条是这次变的"，
 * 事件是现成的、携带迁移后快照的、单向的通知面。
 *
 * ============ 单位忙闲派生（规格①）============
 * 某角色有 running 任务 → 对应战场单位 status='busy'（UnitView 词表里没有 'working'，
 * 'busy' 就是契约冻结的"忙"——渲染侧已认识它，038 的战场表现零改动即可读到）。
 * 收尾时**只回收 busy**：error / offline 是别处的真相（如 agent-link 的远端状态），不碰；
 * 且该角色还有**其他** running 任务时不回收（并发 1 是 app 层的执行纪律，core 不假设）。
 *
 * @since v3.16（task_037）；v3.23（task_047）追加 cancelTask（排队取消）与 TaskCancelOutcome。
 */

import { emitWorldEvent } from '../bus';
import { worldStore, type CoreStore } from '../store';
import {
  MAX_TASK_PROMPT_LEN,
  MAX_TASKS,
  NOTICE_TTL_MS,
  type CharacterTask,
  type CharacterView,
  type NoticeLevel,
  type TaskStatus,
  type UnitView,
} from '../types';

import {
  applyTaskAction,
  createQueuedTask,
  dropSettledTasks,
  type TaskAction,
} from './machine';

/** 命令/调用被拒的机器可读原因。 */
export type TaskRejectionCode =
  | 'not-found' // 任务不在状态里（或角色不在档）
  | 'empty-prompt'
  | 'prompt-too-long'
  | 'limit-exceeded'
  | 'illegal-transition';

/**
 * task.cancel 的结构化结果（@since v3.23，task_047）—— 与 start/complete/fail 返回
 * `CharacterTask | null` 不同，取消要能区分**为什么没取消成**（UI 据 code 提示「先停止」
 * 或「已收尾」），null 语义装不下三种失败面。
 */
export type TaskCancelOutcome =
  | { readonly ok: true; readonly task: CharacterTask }
  | {
      readonly ok: false;
      /** not-found：任务不在状态里；not-queued：相位不允许（running / 终态）。 */
      readonly code: 'not-found' | 'not-queued';
      /** 被拒时的任务当前相位（not-found 时为 null）—— 调用方据此分流提示文案。 */
      readonly status: TaskStatus | null;
    };

export interface TaskManagerOptions {
  /** 状态持有者；默认 worldStore 单例。单测用 createStore() 隔离。 */
  readonly store?: CoreStore;
  readonly now?: () => number;
  readonly createId?: (prefix: string) => string;
  /** 任务条数上限；默认契约常量 MAX_TASKS。 */
  readonly maxTasks?: number;
}

export interface TaskManager {
  readonly store: CoreStore;
  /**
   * 派发一条任务（task.assign 的落点）：守门（角色在档 / prompt 非空限长）→ 建 queued 任务
   * → 写库 → 发 task.queued。失败返回 null 并上报 Notice（agent 是否检出**不在**这里判 ——
   * 那是 app 层出队守门的事，不满足时走 failTask 直达 failed）。
   */
  assignTask(input: { readonly characterId: string; readonly prompt: string }): CharacterTask | null;
  /** queued → running：开工（app 层 task-service 出队后调用）。 */
  startTask(taskId: string): CharacterTask | null;
  /** running → completed：收尾，output 收全文、状态里只存摘要（machine.summarizeTaskOutput）。 */
  completeTask(taskId: string, output: string): CharacterTask | null;
  /** queued | running → failed：失败收尾（含守门拦截的直达路径）。**不自动重试**（规格）。 */
  failTask(taskId: string, reason: string): CharacterTask | null;
  /**
   * queued → cancelled：排队取消（@since v3.23，task_047）。结构化结果（见 TaskCancelOutcome）：
   * running 拒（不强杀，Notice 提示「先停止」）；终态拒（幂等拒绝，不改写历史）。
   * 成功后发 task.cancelled（消费者：task-service 剔除队列 + 落库）。
   */
  cancelTask(taskId: string): TaskCancelOutcome;
}

/**
 * 把角色的忙闲派生到战场单位（纯函数，导出供单测）。
 * - working=true：该角色的单位 status → 'busy'（已在 busy 则原引用返回，不广播）；
 * - working=false：只把 'busy' 回收成 'idle' —— error / offline 是别处的真相，绝不碰。
 * 按 unit.characterId 匹配（角色单位投影时带上了它）；没有对应单位（理论上有角色就有单位，
 * 恢复/建档同批写入）时是 no-op。
 */
export function syncUnitWorkingStatus(
  units: readonly UnitView[],
  characterId: string,
  working: boolean
): UnitView[] {
  let changed = false;
  const next = units.map((unit) => {
    if (unit.characterId !== characterId) return unit;
    if (working) {
      if (unit.status === 'busy') return unit;
      changed = true;
      return { ...unit, status: 'busy' as const };
    }
    if (unit.status !== 'busy') return unit;
    changed = true;
    return { ...unit, status: 'idle' as const };
  });
  return changed ? next : (units as UnitView[]);
}

class Manager implements TaskManager {
  readonly store: CoreStore;

  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private readonly maxTasks: number;
  private seq = 0;

  constructor(options: TaskManagerOptions = {}) {
    this.store = options.store ?? worldStore;
    this.now = options.now ?? ((): number => Date.now());
    this.createId = options.createId ?? ((prefix: string): string => `${prefix}_${this.now()}_${++this.seq}`);
    this.maxTasks = options.maxTasks ?? MAX_TASKS;
  }

  assignTask(input: { readonly characterId: string; readonly prompt: string }): CharacterTask | null {
    const prompt = input.prompt.trim();
    const character = this.store.getState().characters.find((c) => c.id === input.characterId);
    if (!character) {
      this.notify('warn', '未找到该角色的档案，任务未派发');
      return null;
    }
    if (prompt.length === 0) {
      this.notify('warn', '任务指令不能为空');
      return null;
    }
    if (prompt.length > MAX_TASK_PROMPT_LEN) {
      this.notify('warn', `任务指令过长（上限 ${MAX_TASK_PROMPT_LEN} 字）`);
      return null;
    }

    const outcome: { task?: CharacterTask } = {};
    this.store.setState((state) => {
      // 先腾位子：新任务占 1 格，裁到 max-1 且**只丢终态历史**（dropSettledTasks 的保证）；
      // 全是在办任务时腾不出位置 → 拒绝新派并回 Notice，绝不静默挤掉谁。
      const kept = dropSettledTasks(state.tasks ?? [], this.maxTasks - 1);
      if (kept.length >= this.maxTasks) return state;
      const task = createQueuedTask({
        id: this.createId('task'),
        characterId: input.characterId,
        prompt,
        createdAt: this.now(),
      });
      outcome.task = task;
      return { ...state, tasks: [...kept, task] };
    });

    const task = outcome.task;
    if (!task) {
      this.notify('warn', `任务数已达上限（${this.maxTasks}），请先收尾再派新任务`);
      return null;
    }
    // 事件在写库**之后**发：订阅者（task-service）拿到事件去读状态时，状态必须已经是新的。
    emitWorldEvent({ type: 'task.queued', task });
    this.notify('info', `已给「${character.name}」派发任务，排入队列`);
    return task;
  }

  startTask(taskId: string): CharacterTask | null {
    return this.transition(taskId, { type: 'start', at: this.now() }, {
      event: 'task.started',
      syncWorking: true,
    });
  }

  completeTask(taskId: string, output: string): CharacterTask | null {
    return this.transition(taskId, { type: 'complete', at: this.now(), output }, {
      event: 'task.completed',
      syncWorking: false,
      notice: (task, character) =>
        this.notify('info', `「${character?.name ?? task.characterId}」任务完成：${firstLine(task.output)}`),
    });
  }

  failTask(taskId: string, reason: string): CharacterTask | null {
    return this.transition(taskId, { type: 'fail', at: this.now(), reason }, {
      event: 'task.failed',
      syncWorking: false,
      notice: (task, character) =>
        this.notify('warn', `「${character?.name ?? task.characterId}」任务失败：${firstLine(task.output)}`),
    });
  }

  /**
   * 取消不走通用 transition 管道：它的失败面要区分 not-found / running / 终态三种文案
   * （transition 的 null 装不下），且成功时**不碰单位忙闲**（busy 只由 running 派生，
   * queued 从未让单位 busy，取消自然无需回收）。裁决与写入在同一次 setState 里完成，
   * 与 assignTask 同款：事件与 Notice 在写库之后发（订阅者读到的状态必须是新的）。
   */
  cancelTask(taskId: string): TaskCancelOutcome {
    const outcome: { result?: TaskCancelOutcome } = {};
    this.store.setState((state) => {
      const tasks = state.tasks ?? [];
      const index = tasks.findIndex((task) => task.id === taskId);
      if (index < 0) {
        outcome.result = { ok: false, code: 'not-found', status: null };
        return state;
      }
      const current = tasks[index];
      const step = applyTaskAction(current, { type: 'cancel', at: this.now() });
      if (!step.changed) {
        outcome.result = { ok: false, code: 'not-queued', status: current.status };
        return state;
      }
      const nextTasks = tasks.slice();
      nextTasks[index] = step.next;
      outcome.result = { ok: true, task: step.next };
      return { ...state, tasks: nextTasks };
    });

    const result = outcome.result!; // setState 同步执行，updater 必然写入
    if (result.ok) {
      emitWorldEvent({ type: 'task.cancelled', task: result.task });
      this.notify('info', '已取消排队任务');
    } else if (result.code === 'not-found') {
      this.notify('warn', '任务不存在，无法取消');
    } else if (result.status === 'running') {
      this.notify('warn', '任务正在执行，不能排队取消；如需中止请先停止该任务');
    } else {
      this.notify('warn', '任务已收尾，无需取消');
    }
    return result;
  }

  /**
   * 统一的状态迁移管道：一次 setState 里完成「任务相位 + 单位忙闲」两份投影的合并写入
   * （perf：一次用户动作只广播一次），成功后再发事件 + Notice。
   * syncWorking=true：开工 → busy；false：收尾 → 仅当该角色没有其他 running 任务时回收 idle。
   */
  private transition(
    taskId: string,
    action: TaskAction,
    plan: {
      readonly event: 'task.started' | 'task.completed' | 'task.failed';
      readonly syncWorking: boolean;
      readonly notice?: (task: CharacterTask, character: CharacterView | undefined) => void;
    }
  ): CharacterTask | null {
    const outcome: { task?: CharacterTask; character?: CharacterView } = {};
    this.store.setState((state) => {
      const tasks = state.tasks ?? [];
      const index = tasks.findIndex((task) => task.id === taskId);
      if (index < 0) return state;
      const current = tasks[index];
      const step = applyTaskAction(current, action);
      if (step.error || !step.changed) return state;

      const nextTasks = tasks.slice();
      nextTasks[index] = step.next;
      // 收尾回收前先看：该角色是否还有别的 running 任务（app 层并发 1，但 core 不假设）。
      const stillWorking =
        !plan.syncWorking &&
        nextTasks.some((task) => task.characterId === current.characterId && task.status === 'running');
      const units = syncUnitWorkingStatus(
        state.units,
        current.characterId,
        plan.syncWorking ? true : stillWorking
      );
      outcome.task = step.next;
      outcome.character = state.characters.find((c) => c.id === current.characterId);
      return units === state.units && nextTasks === tasks
        ? state
        : { ...state, tasks: nextTasks, units };
    });

    const task = outcome.task;
    if (!task) {
      this.notify('warn', '任务不存在或当前状态下这一步不可执行');
      return null;
    }
    emitWorldEvent({ type: plan.event, task });
    plan.notice?.(task, outcome.character);
    return task;
  }

  private notify(level: NoticeLevel, text: string): void {
    const at = this.now();
    this.store.pushNotice({
      id: this.createId('notice'),
      level,
      text,
      createdAt: at,
      expiresAt: at + NOTICE_TTL_MS,
      source: 'core/task',
    });
  }
}

/** 摘要的首行（Notice 里放整段摘要会刷屏；全文在状态与库里，不在通知里）。 */
function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? '';
  return line.length > 0 ? line : text;
}

export function createTaskManager(options: TaskManagerOptions = {}): TaskManager {
  return new Manager(options);
}
