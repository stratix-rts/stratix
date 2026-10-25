/**
 * 文件职责：任务实时输出流的**缓冲存储与视图模型派生**（纯逻辑，零 DOM）——
 *   每角色一条输出缓冲（characterId → 尾部窗口文本），append 追加并按字符上限截头保尾；
 *   由 WorldState.tasks（相位真相）+ 缓冲（流文本真相）合成面板视图模型。
 *   来源：task_046（任务实时输出流 —— running 任务点单位可实时查看 CLI 流式输出）。
 * 输入：appendTaskOutput 端口转发来的流式 chunk（task-service 执行期的 message 事件文本）；
 *   WorldState.tasks 快照（core/task 写入的相位投影）。
 * 输出：TaskOutputStore（可在 node 环境单测的缓冲存储）、latestTaskFor / resolveTaskOutputDisplay
 *   （面板渲染前的一次性合成，测试直接断言）。
 * 禁止事项：
 *   1. 触碰 DOM —— 本文件必须能在 node 环境单测，渲染是 task-output-panel.ts 的事；
 *   2. import world/、app/、phaser、vue、任何 UI 库 —— 铁律；
 *   3. 直接调 core/bus —— 相位快照由组件经注入的 subscribe 回填进来，本文件只吃数据；
 *   4. 无上限增长 —— 每角色缓冲按 MAX_TASK_OUTPUT_BUFFER_CHARS 截头保尾
 *      （perf 硬约束：数据不许无限增长；全文在 SQLite tasks 表，HUD 只留尾部窗口）。
 *
 * ============ 两份真相的分工（相位在状态、流文本在缓冲）============
 * 任务**相位**（queued / running / completed / failed）的唯一真相源是 WorldState.tasks
 *   （core/task 状态机写入，随总线全量广播）；缓冲**不复制相位**，只记 taskId 做对账。
 * 任务**流文本**不进 WorldState（状态里的 task.output 只是 ≤2k 摘要，全文落 SQLite）——
 *   实时 tail 视图读的就是这里的缓冲；completed 后缓冲保留（与 📋 报告同一「可回看」口径），
 *   直到同角色的**下一次派发**开工才清空重开（begin 换 taskId = 清空时机）。
 *
 * ============ 截断口径（截头保尾）============
 * 追加后超上限 → slice(-cap) 只留**尾部**：tail 视图关心的是最新输出，旧内容丢了也不影响
 *   「现在跑到哪了」；truncated 标记提示「前文已截断」（全文在库里，报告里也有 ≤2k 摘要）。
 * 与 chat 会话的条数截尾（CHAT_SESSION_MESSAGE_CAP）同一精神，只是粒度是字符不是条数 ——
 * CLI 流式输出没有「条」的自然边界。
 *
 * ============ 成果物摘要块（task_048）============
 * 任务完成后，组合根把 formatTaskArtifactsBlock（app 层的渲染模型 —— 同一函数也拼在 📋 报告
 *   尾部，规格④「复用同一渲染模型」）算好的**文案**经 setTaskArtifacts 喂进面板，附在展示
 *   文本尾部。为什么传字符串不传对象：hud 铁律禁止 import app/ —— 渲染模型留在 app 层，
 *   hud 只接收渲染结果（与 034 组件只消费已经拼好的消息文本同一口径）。
 *   清空时机与流缓冲同一提：同角色下一次派发开工（begin 换 taskId）→ 块随流一起清（新任务
 *   还没成果物）。
 *
 * @since v3.22（task_046）；v3.24（task_048）追加成果物摘要块（artifactsBlock 参数 + 清空时机）。
 */

import { TASK_PLAN_WAIT_MARKER, type CharacterTask, type TaskStatus } from '../../../core/types';

// ============================================================================
// 常量（导出供单测断言，别在测试里抄一遍数值）
// ============================================================================

/**
 * 每角色输出缓冲的字符上限（按 Unicode 码点计，slice 按 UTF-16 切 —— 与全文落库的
 * 口径一致，展示层只求量级有界，不纠结代理对边界）。
 * 32k ≈ 一次长任务尾部窗口的量级：CLI 单轮任务输出通常 <10k，超长输出的前文由
 * SQLite tasks 表（全文）与 📋 报告兜底，这里只保 tail 视图有界。
 */
export const MAX_TASK_OUTPUT_BUFFER_CHARS = 32_000;

/**
 * 缓冲里「 taskId 未知」的占位 id。
 * 时序契约：startTask 写库 → 同步广播 → 面板 begin，先于任何 chunk（transport 事件是
 * 异步 IPC）。万一 chunk 先到（订阅晚挂等极端时序），append 会用这个 id 建缓冲 ——
 * 随后 begin 到场时**认领**（同角色即改挂新 taskId，不清空），不丢已收到的字符。
 */
export const STREAMING_TASK_ID = '(streaming)';

// ============================================================================
// 缓冲存储
// ============================================================================

/** 一条角色输出缓冲（不可变快照；text 是截头保尾后的尾部窗口）。 */
export interface TaskOutputBuffer {
  readonly characterId: string;
  /** 对账用：这条缓冲归属哪个任务（STREAMING_TASK_ID = chunk 先到、begin 未到场）。 */
  readonly taskId: string;
  /** 尾部窗口文本（≤ cap 码点）。 */
  readonly text: string;
  /** 是否发生过截头（头部被丢过 → 面板提示「前文已截断」）。 */
  readonly truncated: boolean;
  /** 最后一次变更时间（ms；测试可注入确定性时间源）。 */
  readonly updatedAt: number;
}

/** 存储的可注入能力（测试注入确定性时间 / 小上限；生产用默认值）。 */
export interface TaskOutputStoreOptions {
  /** 每角色缓冲上限；缺省 MAX_TASK_OUTPUT_BUFFER_CHARS。 */
  readonly cap?: number;
  /** 时间源；缺省 Date.now。 */
  readonly now?: () => number;
}

/** 缓冲存储对外形状（组件与测试按它操作）。 */
export interface TaskOutputStore {
  /**
   * 一次执行开工：换 taskId = 新任务 → **清空重开**（需求③「下次派发清空重开」的落点）。
   * 同 taskId（状态重复广播）→ no-op（不清刚收的流）；taskId 是 STREAMING_TASK_ID（chunk
   * 先到的占位缓冲）→ 认领：改挂新 id、保留已收文本。
   */
  begin(characterId: string, taskId: string): void;
  /**
   * 流式追加（appendTaskOutput 端口的落点）：超上限截头保尾。
   * 无缓冲（begin 未到场）→ 以 STREAMING_TASK_ID 防御性新建（见常量注释的时序契约）。
   * 空 chunk → no-op（transport 不会发，防御）。
   */
  append(characterId: string, chunk: string): void;
  /** 读某角色的缓冲快照；没有为 null。读零成本（Map 直查）。 */
  entry(characterId: string): TaskOutputBuffer | null;
  /** 丢弃某角色的缓冲（角色删除等清场场景；正常生命周期走 begin 换代，不走这里）。 */
  clear(characterId: string): void;
}

/** 缓冲存储工厂（纯逻辑，无 DOM、无定时器）。 */
export function createTaskOutputStore(options: TaskOutputStoreOptions = {}): TaskOutputStore {
  const cap = options.cap ?? MAX_TASK_OUTPUT_BUFFER_CHARS;
  const now = options.now ?? ((): number => Date.now());
  const buffers = new Map<string, TaskOutputBuffer>();

  return {
    begin(characterId: string, taskId: string): void {
      const current = buffers.get(characterId);
      if (!current) {
        buffers.set(characterId, { characterId, taskId, text: '', truncated: false, updatedAt: now() });
        return;
      }
      if (current.taskId === taskId) return; // 同一任务的重复广播：不清刚收的流
      if (current.taskId === STREAMING_TASK_ID) {
        // chunk 先到的占位缓冲：认领新任务（保留已收文本，不丢数据）
        buffers.set(characterId, { ...current, taskId, updatedAt: now() });
        return;
      }
      // 换了任务 → 清空重开
      buffers.set(characterId, { characterId, taskId, text: '', truncated: false, updatedAt: now() });
    },

    append(characterId: string, chunk: string): void {
      if (chunk.length === 0) return;
      const current = buffers.get(characterId)
        ?? { characterId, taskId: STREAMING_TASK_ID, text: '', truncated: false, updatedAt: now() };
      const merged = current.text + chunk;
      const truncated = merged.length > cap;
      buffers.set(characterId, {
        characterId,
        taskId: current.taskId,
        text: truncated ? merged.slice(-cap) : merged,
        truncated: current.truncated || truncated,
        updatedAt: now(),
      });
    },

    entry(characterId: string): TaskOutputBuffer | null {
      return buffers.get(characterId) ?? null;
    },

    clear(characterId: string): void {
      buffers.delete(characterId);
    },
  };
}

// ============================================================================
// 视图模型派生（面板渲染前的合成；纯函数，node 可算）
// ============================================================================

/**
 * 任务相位 → 面板徽标文案。词表即契约（本组件单一真相源；agent-catalog 的队列读数
 * 是另一套口径，不共用）。
 * @since v3.23（task_047）补 cancelled：排队取消后最新任务的徽标有处可落（不进流缓冲 ——
 * 取消的任务没跑过，没有流，text 走状态快照里的占位文案）。
 */
export const TASK_PHASE_LABELS: Readonly<Record<TaskStatus, string>> = {
  queued: '排队中',
  running: '执行中',
  awaiting_approval: '待审批', // @since v3.25（task_049）：计划挂起 —— 流缓冲里就是计划全文
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

/**
 * 某角色在状态里的**最新**一条任务（createdAt 最大；同刻取数组靠后的 —— core/task
 * 追加在尾部，同刻时后写的更新）。没有为 null。
 * why 取最新而不是「running 优先」：面板语义是「这个角色最近的任务怎么样了」——
 * completed 之后又派了新的（queued），看板应该跟着新任务走（排队中）。
 */
export function latestTaskFor(
  tasks: readonly CharacterTask[] | undefined,
  characterId: string | null
): CharacterTask | null {
  if (!characterId || !tasks) return null;
  let best: CharacterTask | null = null;
  for (const task of tasks) {
    if (task.characterId !== characterId) continue;
    if (!best || task.createdAt >= best.createdAt) best = task;
  }
  return best;
}

/** 面板视图模型（resolveTaskOutputDisplay 的产物；组件只画不判）。 */
export interface TaskOutputDisplay {
  /** 有没有可展示的（角色没任务 → 整段隐藏）。 */
  readonly visible: boolean;
  /** 最新任务的相位（visible=false 时为 null）。 */
  readonly phase: TaskStatus | null;
  /** 归属任务 id（对账 / 调试；visible=false 时为 null）。 */
  readonly taskId: string | null;
  /** 展示文本：缓冲命中 = 流式尾部窗口；未命中（守门失败等）= 状态里的 output（摘要/原因）。 */
  readonly text: string;
  /** 缓冲发生过截头（提示「前文已截断」）。 */
  readonly truncated: boolean;
  /** 文本来自实时流缓冲（false = 来自状态快照的兜底，没有实时性）。 */
  readonly fromStream: boolean;
}

const HIDDEN_DISPLAY: TaskOutputDisplay = {
  visible: false,
  phase: null,
  taskId: null,
  text: '',
  truncated: false,
  fromStream: false,
};

/**
 * 合成面板视图模型（纯函数）：
 *   - 状态里没有该角色的任务 → 隐藏（角色被删 / 还没派过任务）；
 *   - 缓冲 taskId === 最新任务 id → 展示流式文本（completed 也保留 —— 完成态可回看）；
 *   - 缓冲未命中（taskId 不同 / 无缓冲）→ 终态任务回落状态里的 output（失败原因 /
 *     完成摘要 —— 守门拦截的任务从未 running 过，缓冲天然没有它）；在办任务回落空串
 *     （面板显示「等待输出…」占位，不编造内容）。
 * 缓冲命中但文本为空（CLI 只回了工具回执没有 message）→ 也回落状态 output：
 * 空流 + 有摘要有内容，取有内容的那个（done 分支的占位文案「（任务完成，无文本输出）」
 * 恰好从这里透出）。
 * artifactsBlock（task_048）：非空时附在文本尾部（前置换行与文本分隔；空文本时直接作正文
 *   —— 实际不会发生：成果物只在 completed 后喂入，终态必有 output）。隐藏态不受它影响。
 */
export function resolveTaskOutputDisplay(
  entry: TaskOutputBuffer | null,
  latestTask: CharacterTask | null,
  artifactsBlock = ''
): TaskOutputDisplay {
  const base = resolveTaskOutputBase(entry, latestTask);
  if (!base.visible || artifactsBlock.length === 0) return base;
  return {
    ...base,
    text: base.text.length > 0 ? `${base.text}\n${artifactsBlock}` : artifactsBlock,
  };
}

/**
 * 挂起标记行剥离（task_049）：PLAN_WAIT 是 app 层 prompt 指令里的协议词（agent 用它声明
 * 「计划完毕，等批准」），不是给人看的输出。检测在 app 层（core → app 事件链已把任务转入
 * awaiting_approval 并剥离存档）；流缓冲里还留着这行（缓冲是原序 tail，不改写历史），所以
 * **展示时**剥离 —— 缓冲保持只追加的纪律，可见性归渲染。标记词从 core 契约取（同一词的
 * 第三处消费点，见 types.ts 的 TASK_PLAN_WAIT_MARKER）。
 */
function stripPlanWaitLines(text: string): string {
  const stripped = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== TASK_PLAN_WAIT_MARKER)
    .join('\n');
  return stripped === text ? text : stripped;
}

/** resolveTaskOutputDisplay 的主体（task_046 既有逻辑，原样保留；成果物拼接在外层）。 */
function resolveTaskOutputBase(
  entry: TaskOutputBuffer | null,
  latestTask: CharacterTask | null
): TaskOutputDisplay {
  if (!latestTask) return HIDDEN_DISPLAY;
  // @since v3.23（task_047）cancelled 同为终态：text 回落状态里的占位文案（取消的任务没跑过，
  // 没有流，缓冲天然没有它 —— 从这里读出「这条被取消了」）。
  const terminal =
    latestTask.status === 'completed' || latestTask.status === 'failed' || latestTask.status === 'cancelled';
  if (entry && entry.taskId === latestTask.id) {
    // task_049：流文本剥离挂起标记行（协议词不进可见输出；awaiting 相位下这条就是计划全文）。
    const text =
      entry.text.length > 0 ? stripPlanWaitLines(entry.text) : terminal ? latestTask.output : '';
    return {
      visible: true,
      phase: latestTask.status,
      taskId: latestTask.id,
      text,
      truncated: entry.truncated,
      fromStream: entry.text.length > 0,
    };
  }
  return {
    visible: true,
    phase: latestTask.status,
    taskId: latestTask.id,
    text: terminal ? latestTask.output : '',
    truncated: false,
    fromStream: false,
  };
}
