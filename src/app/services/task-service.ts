/**
 * 文件职责：**角色任务执行服务**（task_037）—— 每角色 FIFO 队列、并发 1，把 core/task 派出的
 *   queued 任务经 CLI transport 执行完一个回合，并把相位回报给 core（start / complete / fail）。
 * 输入：core 总线上的 task.* 生命周期事件（task.queued 出队、其余转发落库）；
 *   WorldState 快照（characters + detectedAgents，守门用）；注入的 transport 工厂。
 * 输出：core TaskManager 的相位迁移调用（写 WorldState.tasks + 单位忙闲派生 + 再发事件）；
 *   任务落库回调（tasks 表：状态快照随事件落，**全文输出**随 complete 落 —— 状态里只有摘要）。
 * 禁止事项：
 *   1. import child_process / node-process / cli-transport 的**实现**文件 —— 本服务跑在渲染层
 *      bundle 里，子进程一律在 Electron 主进程（经 IPC 桥），这里只 import transport.ts 的纯类型；
 *   2. 在这里认识任何一家 CLI 的字段 —— 事件翻译在 adapters，这里只认公共 TransportEvent 词表；
 *   3. 引入新依赖 —— core 契约 + 注入端口，仅此而已；
 *   4. 自动重试失败任务 —— 规格⑤明确：failed 即终态，手动重派是 038 的 UI 动作（新任务）。
 *
 * ============ 复用 chat IPC 链路（vs 新开 task:* 通道）的选择与理由 ============
 * 任务执行复用 035 的 chat:run / chat:abort IPC 通道 + chat-transport-bridge 的工厂：
 *   - 该通道本来就是通用的「kind + prompt + sessionId + timeout → 事件流」单轮执行管道，
 *     不含任何聊天语义（聊天语义全在 chat-service 里），任务需要的正是同一形状；
 *   - runId 路由保证并发轮次互不串台，任务与聊天共用通道不会互相污染事件流；
 *   - 新开 task:* 三条通道（main + preload + 桥）零增益、双倍维护面 —— 主进程侧 transport
 *     构造逻辑一模一样。选择复用，若将来任务需要 chat 不具备的执行参数（如多轮工具循环），
 *     再分家不迟（那时再在两侧文件头同步改说明）。
 *
 * ============ 任务会话与聊天会话隔离（规格④）============
 * 任务执行**每次都是独立会话**：spawn 恒传 sessionId=null（一次性会话，跑完即弃），
 *   - 不读角色的 externalSessionId（那是聊天会话的落库回执）；
 *   - 不把 CLI 回报的 session id 回写角色档案（回写会污染下一次聊天的续会话判断）；
 *   - session 事件直接忽略。
 * 推论：任务没有「续发」，每一轮都是首发 → **persona 每次内嵌**（buildTaskPrompt，
 *   与 chat-service 的 buildFirstPrompt 同一拼装式样，措辞换成任务语境）。
 *
 * ============ 取消的队列纪律（task_047）============
 * task.cancelled 事件到达时把该任务从内存队列剔除（emitWorldEvent 是同步广播，取消与出队
 *   不会真的交错 —— 但剔除发生在下一次 pump 之前，队里从此没有它）；pump 出队时再查一次
 *   WorldState.tasks 的相位做**双层防御**：只有仍是 queued 的任务才进 transport，其余跳过继续
 *   泵下一条（防外部直改状态的同帧竞态与未来新路径）。取消的任务：不进 transport、不发 exp、
 *   不触发 onTaskSettled 回流（没跑过，没有可回的结果）；cancelled 快照照常落库（审计可见）。
 *
 * ============ 落库口径（独立 tasks 表，与聊天审计分离）============
 * persistTask 回调随每条 task.* 事件落状态快照（queued / running / failed 的 output 都很短）；
 * completed 单独走：本服务持有执行**全文输出**（transport 流式拼接），complete 时全文落库 ——
 * 状态里只存摘要（MAX_TASK_SUMMARY_LEN，见 core/task/machine.summarizeTaskOutput），
 * 全文只在 SQLite。fire-and-forget：落库失败记日志，不绑架任务执行回路（与 035 同一口径）。
 *
 * ============ 成果物解析与落列（task_048）============
 * complete 时同步多算一步：parseTaskArtifacts(全文) → serializeTaskArtifacts 落进记录的
 * artifacts 字段（JSON 字符串，缺省 = 解析不出）。解析是纯正则、永不抛（解析器内部兜底
 * 返回空），它在 done 收尾主路径上 —— 坏了不能拖累任务收尾，兜底语义写在解析器里。
 * 非终态快照（queued/running/failed/cancelled）不解析不带字段 —— 成果物只在 completed
 * 有意义（失败任务是没产出，不是产出不明）。onTaskSettled 回调携带同一份序列化串，
 * 消费方（task-report / 任务输出面板）各自反序列化，坏形状宽容降级（回落纯文本）。
 *
 * ============ 终态收尾的副作用：结果回流 + exp 事件（task_039）============
 * 任务到终态（completed / failed）时额外做两件事，两者都是 fire-and-forget（抛错只记日志，
 * 绝不倒灌任务执行回路）：
 *   ① onTaskSettled 回调：把带**全文输出**的终态记录交给注入方（组合根接 task-report，
 *     组装「任务报告」消息注入角色会话 + 落 character_chat_messages + hud 轻提示）；
 *   ② 发 exp.gained 总线事件（source=task_completed / task_failed）：失败也发 —— 「做过就有
 *     收获」是养成口径。发射点时机与口径：
 *       - completed 在 runTask 的 done 收尾处（全文在手，回调拿全文）；
 *       - failed 挂在 handleEvent 的 task.failed 分支 —— 状态机事件是失败相位的唯一真相源，
 *         服务内四条失败路径（守门拦截 / transport 报错 / 防御性收尾 / 异常兑底）与外部直发的
 *         task.failed 事件都恰好流经这里一次，不会双发也不会漏发。
 *   amount 由注入的 expWeight 换算，缺省 app/services/exp-config.ts 的临时常量；
 *   **数值表归 task_040 的 progression 模块**（交接注记见 exp-config.ts 文件头，两侧已注明）。
 *
 * ============ 流式输出转发（task_046）============
 * 执行期每个 message 事件的文本 chunk 经 onTaskChunk 端口原序转发（组合根接 hud 任务输出
 * 面板的 appendTaskOutput —— running 任务的实时 tail 视图）。fire-and-forget（与 persistTask
 * 同一纪律）：回调抛错只记日志，绝不绑架执行回路；tool_use / tool_result / session 事件不转发
 * （任务结果只收 message 文本，与 output 拼接同一口径）。转发在 startTask 之后开始 ——
 * 总线同步广播保证了订阅方先见到 running 再见到 chunk，面板的开工对账（清空重开）不会丢流。
 *
 * @since v3.16（task_037）；v3.18（task_039）追加终态副作用；v3.22（task_046）追加流转发端口；
 *   v3.23（task_047）追加取消的队列纪律（事件剔除 + 出队防御）；v3.24（task_048）追加成果物解析落列。
 */

import { emitWorldEvent, onWorldEvent } from '../../core/bus';
import type {
  AgentKind,
  CharacterTask,
  CharacterView,
  ExpSource,
  TaskStatus,
  WorldEvent,
  WorldState,
} from '../../core/types';
import type { TaskManager } from '../../core/task';
import type { SpawnOptions, TransportErrorCode, TransportEvent } from './cli-transport/transport';
import { parseTaskArtifacts, serializeTaskArtifacts } from './task-artifacts';
import { defaultExpWeight } from './exp-config';

// ============================================================================
// 端口与常量
// ============================================================================

/** transport 端口：能跑一轮对话即可（结构上即 cli-transport 的 CliTransport / chat-service 的口）。 */
export interface TaskTransportPort {
  spawn(prompt: string, options?: SpawnOptions): AsyncIterable<TransportEvent>;
}

/** transport 工厂：agent 种类 → transport（生产复用 chat-transport-bridge 的 IPC 工厂；单测打桩）。 */
export type TaskTransportFactory = (kind: AgentKind) => TaskTransportPort;

/**
 * 任务落库记录（与 SQLite tasks 表一行同构）。
 * completed 的 output 是**全文**（调用方传全文覆盖事件里的摘要）。
 * artifacts（task_048）：completed 才携带 —— parseTaskArtifacts(全文) 的序列化成果物
 * （JSON 字符串）；缺省 = 无（非终态快照 / 解析不出）。
 */
export interface TaskPersistRecord {
  readonly id: string;
  readonly characterId: string;
  readonly prompt: string;
  readonly status: TaskStatus;
  readonly output: string;
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  /** @since v3.24（task_048）；'' 不出现在这里 —— 解析不出就是缺省，不占字段。 */
  readonly artifacts?: string;
}

/** 任务单轮执行超时（ms）。CLI 跑任务比聊天长得多，取 035 档主进程上限：10 分钟。 */
export const DEFAULT_TASK_TIMEOUT_MS = 600_000;

// ---- 守门与占位文案（导出供单测断言，别在测试里抄一遍字符串）----

/** agent 未检出 / 未安装（出队守门拦截 → 任务直接 failed）。 */
export const TASK_MSG_NOT_INSTALLED = '该 CLI 未安装，任务无法执行';

/** 角色没绑 agent 种类（老档案 / 引导没走完）。 */
export const TASK_MSG_UNBOUND = '该角色未绑定 CLI agent，任务无法执行';

/** 角色档案不在状态里（刚被删 / 快照未到）。 */
export const TASK_MSG_NO_PROFILE = '未找到该角色的档案，任务无法执行';

/** 传输层错误码 → 任务失败原因前缀。 */
const ERROR_LABELS: Readonly<Record<TransportErrorCode, string>> = {
  spawn_failed: 'CLI 拉起失败',
  aborted: '已中断',
  timeout: '执行超时',
  nonzero_exit: 'CLI 异常退出',
  cli_error: 'CLI 报错',
};

// ============================================================================
// 纯函数（可独立单测）
// ============================================================================

/**
 * 出队守门：任务能不能跑。
 * 与 chat-service 的 guard 同三条（在档 / 已绑 / 已检出），但拦截落点不同：
 * chat 是错误气泡（对话不入库），task 是任务直接 failed（状态与库里都看得见原因）。
 */
export function guardTaskCharacter(
  state: Pick<WorldState, 'characters' | 'detectedAgents'>,
  characterId: string
): { readonly ok: true; readonly character: CharacterView; readonly kind: AgentKind } | { readonly ok: false; readonly reason: string } {
  const character = state.characters.find((c) => c.id === characterId);
  if (!character) return { ok: false, reason: TASK_MSG_NO_PROFILE };
  const kind = character.agentKind;
  if (!kind) return { ok: false, reason: TASK_MSG_UNBOUND };
  const detected = state.detectedAgents?.some((agent) => agent.kind === kind && agent.installed);
  if (!detected) return { ok: false, reason: TASK_MSG_NOT_INSTALLED };
  return { ok: true, character, kind };
}

/**
 * 任务指令拼装：角色设定引导语 + persona + 任务指令。
 * 任务会话是**一次性**的（每轮独立会话，无续发），所以每次都内嵌 persona ——
 * 与 chat-service.buildFirstPrompt 的差别只有措辞（任务语境 vs 对话语境），拼装式样刻意一致。
 */
export function buildTaskPrompt(character: CharacterView, taskPrompt: string): string {
  const persona = character.persona.trim();
  if (persona.length === 0) return taskPrompt;
  return [
    `你将扮演「${character.name}」这个角色执行任务，请全程保持角色设定一致。`,
    `【角色设定】\n${persona}`,
    `【任务指令】\n${taskPrompt}`,
  ].join('\n\n');
}

/** 传输层错误 → 任务失败原因（带码的人话，落 failed.output 与库）。 */
export function taskErrorText(code: TransportErrorCode, message: string): string {
  return `${ERROR_LABELS[code]}：${message}`;
}

/** 事件快照 → 落库记录（completed 之外的相位直接用快照；output 即失败原因/空串）。 */
export function taskEventToRecord(task: CharacterTask): TaskPersistRecord {
  return {
    id: task.id,
    characterId: task.characterId,
    prompt: task.prompt,
    status: task.status,
    output: task.output,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ============================================================================
// 服务
// ============================================================================

export interface TaskServiceDeps {
  /**
   * 世界快照读取口（组合根传 worldStore.getState；单测传夹具）。
   * @since v3.23（task_047）类型面增 tasks：出队防御要查任务当前相位（仅 queued 才执行）。
   * 组合根与测试注入的都是完整 getState，零改动兼容。
   */
  readonly getState: () => Pick<WorldState, 'characters' | 'detectedAgents' | 'tasks'>;
  /** transport 工厂（生产：复用 chat-transport-bridge 的 IPC 工厂；单测：打桩）。 */
  readonly createTransport: TaskTransportFactory;
  /** core 任务域写入面（相位回报：start / complete / fail）。与 runtime 注入同一个实例。 */
  readonly taskManager: TaskManager;
  /** 任务落库口（缺省不落库）。同步签名、实现方内部异步 —— fire-and-forget，失败只记日志。 */
  readonly persistTask?: (record: TaskPersistRecord) => void;
  /**
   * 任务终态回调（@since v3.18，task_039；缺省不回调）。携带**全文输出**的终态记录
   * （completed = 执行全文；failed = 失败原因）恰好一次/任务。同步签名、fire-and-forget：
   * 抛错只记日志，绝不绑架任务执行回路。组合根接 task-report（报告消息 + 轻提示）。
   */
  readonly onTaskSettled?: (record: TaskPersistRecord) => void;
  /**
   * 流式输出转发端口（@since v3.22，task_046；缺省不转发）。执行期每个 message 事件的
   * 文本 chunk 按到达顺序转发（characterId, chunk）。同步签名、fire-and-forget：抛错只记
   * 日志，绝不绑架任务执行回路。组合根接 hud 任务输出面板的 appendTaskOutput（实时 tail 视图）。
   */
  readonly onTaskChunk?: (characterId: string, chunk: string) => void;
  /**
   * 经验权重函数（@since v3.18，task_039；缺省 exp-config 的临时常量表）。
   * **task_040 交接点**：progression 模块接管数值时换掉这个注入件，本服务零改动。
   */
  readonly expWeight?: (source: ExpSource) => number;
  /** 单轮执行超时；缺省 DEFAULT_TASK_TIMEOUT_MS（10min，主进程上限同档）。 */
  readonly timeoutMs?: number;
  /** 日志口；缺省静默。 */
  readonly logger?: (line: string) => void;
}

export interface TaskService {
  /**
   * 接上总线（订阅 task.* 生命周期事件）。必须在 runtime.start 之后调：core/task 的
   * assignTask 在命令处理里同步发 task.queued，晚订阅只会漏掉启动前的派发（无害）。
   * 返回 stop；重复 start 是 no-op。
   */
  start(): () => void;
  /** 某角色是否有一轮任务在跑（观察口：测试 / 调试）。 */
  isBusy(characterId: string): boolean;
  /** 某角色的待执行队列长度（观察口：038 的队列可见性读 WorldState，这里仅供测试）。 */
  queueLength(characterId: string): number;
}

export function createTaskService(deps: TaskServiceDeps): TaskService {
  const logger = deps.logger ?? ((): void => { /* 缺省静默 */ });
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  const manager = deps.taskManager;
  const expWeight = deps.expWeight ?? defaultExpWeight;

  /** characterId → 待执行队列（FIFO；队头即下一个执行）。 */
  const queues = new Map<string, CharacterTask[]>();
  /** 正在执行的角色集合（并发 1 的执行纪律；core 侧另有状态机兜底）。 */
  const busy = new Set<string>();
  /** kind → transport 缓存（IPC 桥的 transport 无状态可缓存；省一次工厂往返）。 */
  const transports = new Map<AgentKind, TaskTransportPort>();

  const transportFor = (kind: AgentKind): TaskTransportPort => {
    const cached = transports.get(kind);
    if (cached) return cached;
    const created = deps.createTransport(kind);
    transports.set(kind, created);
    return created;
  };

  /** 落库（fire-and-forget）：抛错只记日志 —— 历史完整性不绑架任务执行回路。 */
  const persist = (record: TaskPersistRecord): void => {
    if (!deps.persistTask) return;
    try {
      deps.persistTask(record);
    } catch (error) {
      logger(`[task-service] 任务落库回调抛错（${record.id}/${record.status}）：${describe(error)}`);
    }
  };

  /**
   * 发 exp.gained（task_039）：权重 ≤ 0 直接不发（040 接管后可整类关掉某来源）；
   * mitt 不该抛，防御性包一层 —— exp 是旁路观察事件，绝不让它倒灌任务回路。
   */
  const emitExp = (characterId: string, source: ExpSource): void => {
    const amount = expWeight(source);
    if (amount <= 0) return;
    try {
      emitWorldEvent({ type: 'exp.gained', characterId, source, amount });
    } catch (error) {
      logger(`[task-service] exp.gained 发射失败（${characterId}/${source}）：${describe(error)}`);
    }
  };

  /**
   * 流式 chunk 转发（task_046）：fire-and-forget —— 回调抛错只记日志，
   * 观察口（tail 视图）坏了绝不能绑架任务执行本身。
   */
  const emitChunk = (characterId: string, chunk: string): void => {
    if (!deps.onTaskChunk) return;
    try {
      deps.onTaskChunk(characterId, chunk);
    } catch (error) {
      logger(`[task-service] 流式输出转发抛错（${characterId}）：${describe(error)}`);
    }
  };

  /**
   * 终态收尾副作用（task_039）：回流回调 + exp 事件。回调抛错只记日志（fire-and-forget）。
   * 只在状态机相位迁移成功时调（迁移没走动就不算终态，不发生副作用）。
   */
  const settle = (record: TaskPersistRecord, source: ExpSource): void => {
    if (deps.onTaskSettled) {
      try {
        deps.onTaskSettled(record);
      } catch (error) {
        logger(`[task-service] 任务收尾回调抛错（${record.id}/${record.status}）：${describe(error)}`);
      }
    }
    emitExp(record.characterId, source);
  };

  /** 总线事件处理：task.queued → 出队执行；其余相位 → 落状态快照。 */
  const handleEvent = (event: WorldEvent): void => {
    switch (event.type) {
      case 'task.queued':
        persist(taskEventToRecord(event.task));
        enqueue(event.task);
        return;
      case 'task.started':
        persist(taskEventToRecord(event.task));
        return;
      case 'task.failed':
        // started / failed 的 output 都很短（空串 / 失败原因），快照直接落库。
        // completed 不在这里落：全文在 runTask 手里，那边落（见文件头「落库口径」）。
        // failed 的终态副作用（回流回调 + exp）挂在这里（task_039）：见文件头「终态收尾」 ——
        //   服务内四条失败路径与外部直发的 task.failed 都恰好流经这里一次。
        persist(taskEventToRecord(event.task));
        settle(taskEventToRecord(event.task), 'task_failed');
        return;
      case 'task.cancelled':
        // task_047：cancelled 快照照常落库（审计可见），但**不算「跑过」** —— 不发 exp、
        // 不触发 onTaskSettled 回流（见文件头「取消的队列纪律」）。同时把它从待执行队列
        // 剔除：取消事件是同步广播，下次 pump 之前队里就没有它了（取消与出队同帧的竞态面）。
        persist(taskEventToRecord(event.task));
        dequeue(event.task);
        return;
      case 'task.completed':
        return;
      default:
        return;
    }
  };

  const enqueue = (task: CharacterTask): void => {
    const queue = queues.get(task.characterId) ?? [];
    queue.push(task);
    queues.set(task.characterId, queue);
    pump(task.characterId);
  };

  /**
   * 把一条任务从内存队列剔除（task_047，取消路径专用）。剔除后不 pump：能被取消的只有
   * queued 任务，它不占 busy（busy 是 running 的执行纪律），无位可释放。
   */
  const dequeue = (task: CharacterTask): void => {
    const queue = queues.get(task.characterId);
    if (!queue) return;
    const index = queue.findIndex((item) => item.id === task.id);
    if (index < 0) return;
    queue.splice(index, 1);
  };

  /**
   * 出队防御（task_047）：任务在 WorldState.tasks 里仍是 queued 才执行。
   * tasks 缺省（老快照/裁剪态）时不拦 —— 交给 startTask 的状态机兑底拒绝（同一裁决的
   * 第二道闸，防御性检查不该比真相源更严）。
   */
  const isStillQueued = (taskId: string): boolean => {
    const tasks = deps.getState().tasks;
    if (!tasks) return true;
    return tasks.some((task) => task.id === taskId && task.status === 'queued');
  };

  /**
   * 出队泵：每角色并发 1 —— busy 就不动；队列为空就收工。
   * 守门不通过 → failTask 直达 failed（事件回环会落库），继续泵下一条（队列不被一条死任务堵死）；
   * 已被取消/收尾 → 跳过继续泵（task_047：cancelled 绝不进 transport）。
   */
  const pump = (characterId: string): void => {
    if (busy.has(characterId)) return;
    const queue = queues.get(characterId);
    if (!queue || queue.length === 0) return;
    const task = queue.shift();
    if (!task) return;

    if (!isStillQueued(task.id)) {
      pump(characterId); // 已被取消（或外部收尾）：跳过，接着看下一条
      return;
    }

    const guard = guardTaskCharacter(deps.getState(), characterId);
    if (!guard.ok) {
      // 规格⑤：agent 未检出等 → 任务直接 failed 带原因，不进 transport。
      manager.failTask(task.id, guard.reason);
      pump(characterId); // 这条堵死了，接着看下一条
      return;
    }

    busy.add(characterId);
    void runTask(task, guard.character, guard.kind).finally(() => {
      busy.delete(characterId);
      pump(characterId); // FIFO 继续：上一条收尾（任何相位）后立刻看下一条
    });
  };

  /** 一轮任务执行的完整生命周期（守门已过）。 */
  const runTask = async (
    task: CharacterTask,
    character: CharacterView,
    kind: AgentKind
  ): Promise<void> => {
    // queued → running：盖 startedAt、单位忙闲派生、发 task.started（事件回环落 running 快照）。
    const started = manager.startTask(task.id);
    if (!started) return; // 状态没走动（任务被收尾/不存在）—— 不执行也不重试，防守即可
    const prompt = buildTaskPrompt(character, task.prompt); // persona 每次内嵌（会话隔离 → 无续发）
    let output = '';

    try {
      const transport = transportFor(kind);
      // sessionId 恒 null：任务会话一次性，不复用聊天会话也不跨任务续接（见文件头「会话隔离」）。
      for await (const event of transport.spawn(prompt, { sessionId: null, timeoutMs })) {
        if (event.type === 'message') {
          output += event.text;
          emitChunk(task.characterId, event.text); // 实时 tail 视图（task_046）：原序转发，不拦流
          continue;
        }
        if (event.type === 'session') continue; // 一次性会话：id 不记录、不回写、不透传
        if (event.type === 'done') {
          // 空输出也给一句占位（与 chat 的空回复占位同一口径），失败/成功都有可读的 output。
          const fullText = output.length > 0 ? output : '（任务完成，无文本输出）';
          const finished = manager.completeTask(task.id, fullText); // 状态里存摘要
          // 成果物解析（task_048）：同步算、永不抛（解析器内部兜底空）；解析不出 → 缺省字段。
          // 空输出（占位文案）不解析 —— 占位符不是执行产出，解析它只会造出假 summary。
          const artifactsJson =
            output.length > 0 ? serializeTaskArtifacts(parseTaskArtifacts(fullText)) : '';
          const record: TaskPersistRecord = {
            ...taskEventToRecord(finished ?? started),
            status: 'completed',
            output: fullText, // 库里存全文（状态/事件里只有摘要）
            ...(artifactsJson.length > 0 ? { artifacts: artifactsJson } : {}),
          };
          persist(record);
          // 终态副作用（task_039）：回流回调拿全文 + 发 exp。只在状态机确认收尾时发生
          // （finished 为 null = 状态没走动，不产生副作用；防御性落库照旧，见上面 record 兑底）。
          if (finished) settle(record, 'task_completed');
          return;
        }
        if (event.type === 'error') {
          // 失败不自动重试（规格⑤）：failed 即终态；事件回环落 failed 快照（output=原因）。
          manager.failTask(task.id, taskErrorText(event.code, event.message));
          return;
        }
        // tool_use / tool_result：任务结果只收 message 文本，工具回执不进输出。
      }
      // 流自然结束却没有 done / error —— runtime 契约上不该发生，防御性失败收尾。
      manager.failTask(task.id, 'transport 事件流异常结束（无 done 事件）');
    } catch (error) {
      // runtime 不该抛（内部全转 error 事件）；真抛了也要给任务一个 failed 收尾，别把它吊死在 running。
      manager.failTask(task.id, taskErrorText('cli_error', describe(error)));
    }
  };

  let stop: (() => void) | null = null;

  return {
    // 直连 core/bus 单例（与 game-save-coordinator 同一手法：app → core 是合法依赖方向，
    // 单测隔离靠 resetBus，不必为订阅口多开一层注入）。
    start: (): (() => void) => {
      if (stop) return stop;
      const off = onWorldEvent(handleEvent);
      stop = () => {
        off();
        stop = null;
      };
      return stop;
    },

    isBusy: (characterId: string): boolean => busy.has(characterId),

    queueLength: (characterId: string): number => queues.get(characterId)?.length ?? 0,
  };
}
