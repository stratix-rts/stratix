/**
 * 文件职责：**headless 组合根**（前后端分离 A1 / task_077，A2 / task_078 扩展）——
 *   在**没有渲染进程**的进程里装配 core runtime（命令 → 状态机 → store → 广播），
 *   让 service 进程自己持有世界态；A2 起还可以在**本进程**跑任务执行环（直接 spawn CLI）。
 *   装配内容照抄渲染侧组合根（src/app/main/main-entry.ts 的 core 段），顺序也照抄：
 *     ① 四个写入面（character / mission / task / session manager）—— 同一份 store；
 *     ② core runtime —— 命令分发的唯一裁决点（runtime 后起）；
 *     ③ 养成回路（progression-service）—— exp.gained → 角色成长 + 升级广播；
 *     ④ 任务执行环（A2，可选接入）—— task.queued → FIFO 出队 → 并发 1 → spawn CLI → 相位回报。
 * 输入：可选注入端口（store / pipeline / persistExpEvent / persistSession / taskExecution /
 *   onUnhandled / logger）—— 缺省即缺省范式。
 * 输出：一个可独立 boot 的 StratixService：
 *   { store, runtime, character, mission, task, session, taskService, stop }。
 * 禁止事项：
 *   1. import 渲染层 / 宿主层的东西（DOM、ipc、preload、浏览器全局）—— 本模块必须能在纯 node 里跑；
 *   2. 直接改 store —— 写操作一律走 HudCommand，由 core 状态机裁决（铁律：裁决在 core）；
 *   3. 在这里做业务判断（等级曲线 / 任务相位 / 合法性）—— 那些真相在 core，本模块只接线；
 *   4. 复制 app/services/progression-service 的逻辑 —— 复用它，只注入它的可选落库端口；
 *   5. 复制 task-service 的执行环 —— 复用它（见 service/task-execution.ts），本模块只接线；
 *   6. 把视图件（对话抽屉 / 轻提示 / 进程内 IPC 面）硬接进来 —— 视图件一律是**可选注入端口**，
 *      端口缺席时服务照常工作（缺省范式见 persistExpEvent：非渲染环境端口缺席、服务照常）。
 *
 * why 单独成模块（而不是让渲染进程继续独占 core runtime）：
 *   前后端分离的拓扑是「service 常驻持有大脑，宿主进程退化为可选视图壳」
 *   （docs/SERVICE-SPLIT-PLAN.md §2）。core runtime 住在渲染进程里时，关掉窗口 = 大脑停机。
 *   本模块把同一套装配抽成零渲染依赖的组合根，让 service 进程能独立持有世界态；
 *   渲染侧组合根本单**不改**（C2 才做双模式收敛）。
 *
 * ============ A2：任务执行环在本进程跑（task_078）============
 * 渲染进程的任务执行环是「渲染进程 → cliChat IPC → Electron main spawn」；
 *   service 进程里这条链去掉中间两跳 —— service 直接 spawn 子进程（cli-transport 的
 *   node-process 工厂），渲染进程关掉不影响任务执行。
 * 执行环本体**复用** app/services/task-service.ts（渲染侧同一份实现，两边只是 transport
 *   来源不同）—— 本模块只做接线：给注入的 getState（store.getState）与 taskManager（①里的实例）。
 * 渲染进程模式维持现状：main-entry.ts 的装配**本单不动**（C2 才标记退役）。
 *
 * 视图件清单（A1 全部不接，将来一律走可选注入端口）：
 *   - 对话抽屉 / 视图口：属 app 层 chat 服务，本模块零引用；
 *   - 轻提示（toast）：属 UI 反馈面，本模块零引用；
 *   - 进程内 IPC 面（对话 / 任务传输）：service 侧直接 spawn，**不经 IPC**（本模块零引用）。
 *
 * ============ A3：存储归一（task_079）============
 * 三个落库点（任务全文 / chat / exp_events）原先散在渲染进程，经 IPC 落到 Electron main 的 DAO
 *   —— 于是「谁开库」变成多进程开同一个文件。A3 起 SQLite 由 service 进程独占写
 *   （storage.ts 是 service 侧的唯一 owner），其余进程经 API 读（铁律 6）。
 * 本模块只做接线：storage 端口给出即接管两个落库口（任务全文 / 经验事件）；
 *   chat 的落库口由调用方拿 storage.persistChatMessage 自行包一层（话题缓存语义见
 *   app/services/stratix-context.ts 的 createTopicCachePersister）。
 *
 * ============ v3.2a S3：会话域接线（task_093）============
 * 组合根多挂一个写入面：**会话域 manager**（core/session）—— 与前三个 manager 同一口径
 *   （纯构造、绑同一份 store、无 IO、无订阅）。它有两个去处，必须是**同一个实例**：
 *   ① core runtime 的 `session.interrupt` 命令落点（runtime 直调 manager，同 mission / task 口径）；
 *   ② 业务侧记账（task-service 的 LITE 接线）—— 两处写的是同一份 WorldState.sessions。
 * 持久化口（SessionPersistPort）缺省口径与 exp_events 同范式：**存储件在 → 自动接管**
 *   （会话摘要与事件随写随落 sessions / session_events 两张表）；显式给了以显式为准；
 *   两者都缺 = 不落库（会话只活在 WorldState 里 —— 不假装落库成功）。
 *
 * @since v3.40（task_077 / service-split A1）；v3.41（task_078 / service-split A2）追加执行环接线；
 *        v3.42（task_079 / service-split A3）追加存储端口接线；
 *        v3.43（task_093 / v3.2a S3）追加会话域写入面 + 持久化口接线。
 */

import { createSessionPersister } from '../../app/services/persistence/session-persister';
import { toSessionEventView } from '../../app/services/persistence/session-reader';
import { sessionCompressThresholdFromEnv } from '../../app/services/session-compress-config';
import { createProgressionService } from '../../app/services/progression-service';
import type { TaskService, TaskTransportFactory } from '../../app/services/task-service';
import { onWorldEvent } from '../../core/bus';
import { createCharacterManager, type CharacterManager } from '../../core/character';
import { createMissionManager, type MissionManager } from '../../core/mission';
import { createCoreRuntime, type CoreRuntime, type UnhandledChannel } from '../../core/runtime';
import { createSessionManager, type SessionManager, type SessionPersistPort } from '../../core/session';
import { worldStore, type CoreStore } from '../../core/store';
import { createTaskManager, type PipelineRunnerPort, type TaskManager } from '../../core/task';
import type { HudCommand, WorldEvent } from '../../core/types';

import { createServiceTaskExecution, type ServiceTaskExecutionPorts } from './task-execution';
import { settleMissionFromTaskReport } from './mission-report';
import type { ServiceStorage } from './storage';

/**
 * 经验事件落库口（可选）—— 形状与 app/services/progression-service 的 persistExpEvent 一致。
 * 缺省 = 不落库（养成照常，只少一条审计流）：渲染进程里那一份由持久化注入件提供，
 * service 进程里的那一份归 A3（存储归一）单负责。
 */
export interface StratixExpEventInsert {
  readonly characterId: string;
  readonly delta: number;
  readonly reason: 'task_completed' | 'task_failed' | 'chat_round' | 'level_up';
  readonly level: number | null;
  readonly createdAt: number;
}

/** 经验事件落库口（可选注入端口）。 */
export type StratixPersistExpEventPort = (insert: StratixExpEventInsert) => void;

/**
 * 任务执行环的可选注入端口（service 进程内直接 spawn CLI，A2 / task_078）。
 * 形状 = task-service 的可选端口全集 + 可选的 transport 工厂
 *   （缺省 = cli-transport 的 node-process 工厂，直接在本进程 spawn 子进程）。
 */
export type StratixTaskExecutionOptions = ServiceTaskExecutionPorts & {
  /**
   * transport 工厂（可选）。缺省 = 直接 spawn 子进程（service 模式的生产口径）；
   * 单测注入 fake adapter（echo 型测试替身）。
   */
  readonly createTransport?: TaskTransportFactory;
};

/** 组合根的可选注入端口（全部可缺席，缺席即降级，不报错）。 */
export interface StratixServiceOptions {
  /**
   * 世界态持有者。缺省 = core/store 的 worldStore 单例（与 core runtime、MCP 数据面同一份世界态）。
   * 单测用 createStore() 隔离。
   */
  readonly store?: CoreStore;
  /**
   * 流水线编排器端口（可选）—— runtime 只把 pipeline.start 转发给它（core 不执行编排）。
   * 未注入时 pipeline.start 按「未落地」处理（与 agent-link 命令同一口径，走 onUnhandled）。
   */
  readonly pipeline?: PipelineRunnerPort;
  /**
   * 经验事件落库口（可选）—— 见 StratixPersistExpEventPort。缺省 = 不落库。
   */
  readonly persistExpEvent?: StratixPersistExpEventPort;
  /**
   * 存储（可选，A3 / task_079）—— service 进程内的 SQLite owner（service/storage.ts）。
   * 给出即：两个落库口（任务全文 / 经验事件）默认改由 service 侧存储件落
   * （显式传入的 persistExpEvent / taskExecution.persistTask 优先 —— 显式覆盖缺省）。
   *
   * why 缺省是「不落库」而不是「自己开库」：组合根不碰 SQLite 连接（开库归存储件的工厂），
   *   单测与缺省场景不想落库时，端口缺席即不落（养成照常，只少一条审计流）。
   */
  readonly storage?: ServiceStorage;
  /**
   * 任务执行环接线（可选，A2）—— 给出即在**本进程**跑执行环（直接 spawn CLI，不再经
   * 渲染进程 / Electron main 的 IPC 链）。缺省 = 不接：任务只落 queued，没人执行
   *   （此时本模块会就每条 task.queued 记一行警告 —— 如实说清没人干活，不假装成功）。
   */
  readonly taskExecution?: StratixTaskExecutionOptions;
  /**
   * 未落地的命令 / 事件出口（可选）。缺省 = 记一行警告（不打断服务）。
   */
  readonly onUnhandled?: (channel: UnhandledChannel, payload: HudCommand | WorldEvent) => void;
  /**
   * 会话持久化口（可选，@since v3.43，task_093 / v3.2a S3）—— 形状 = core/session 的
   * SessionPersistPort（app 层 session-persister 的 SessionPersister 与之**结构同形**，
   * 可直接注入，无需适配器）。
   *
   * 缺省口径（与 exp_events 同一范式）：**存储件在 → 组合根自动接管**（会话摘要与事件
   * 随写随落 sessions / session_events 两张表）；显式给了就以显式为准；
   * 两者都缺 = **不落库**（会话只活在 WorldState 里 —— 缺省即缺省，不假装落库成功）。
   */
  readonly persistSession?: SessionPersistPort;
  /**
   * 日志口（可选）。缺省 = console.warn —— 只用于「未接任务执行环」那条提示
   * （其余端口缺席即静默，与 app 层各服务的缺省口径一致）。
   */
  readonly logger?: (line: string) => void;
}

/** 组合根产物：service 进程持有的 core 装配。 */
export interface StratixService {
  /** 世界态持有者（真相源）。 */
  readonly store: CoreStore;
  /** core runtime（命令分发的唯一裁决点）。 */
  readonly runtime: CoreRuntime;
  /** 角色域写入面（建档 / 提示词 / 经验累加）。 */
  readonly character: CharacterManager;
  /** 任务域写入面（mission.create / assign / confirm / cancel / checkpoint）。 */
  readonly mission: MissionManager;
  /** 角色任务写入面（task.assign / cancel / approve / reject）。 */
  readonly task: TaskManager;
  /**
   * 会话域写入面（@since v3.43，task_093 / v3.2a S3）—— 建会话 / 追加事件 / 中断 / 收尾。
   * 同一实例既接 runtime 的 `session.interrupt` 命令落点，也接业务侧的记账
   * （chat / task / agent-link 的 LITE 接线）—— 两处写的是同一份 WorldState.sessions。
   */
  readonly session: SessionManager;
  /**
   * 任务执行环（A2；未接执行环时为 null）。观察口：isBusy / queueLength。
   * 存在即代表**本进程**会跑任务（直接 spawn CLI，不经渲染进程 / IPC）。
   */
  readonly taskService: TaskService | null;
  /** 收干净：退执行环订阅 → 退养成回路订阅 → 退 runtime 订阅（资源必须可清理）。幂等。 */
  stop(): void;
}

/**
 * 装配 headless core runtime。
 *
 * 装配顺序（与渲染侧组合根同一口径，见 main-entry.ts「core 侧」段）：
 *   ① 三 manager 先建 —— 它们只绑 store，纯构造、无 IO、无订阅、无副作用；
 *   ② runtime 后起 —— runtime.start() 接上 store 订阅 + 总线两个通道；
 *   ③ 养成回路最后起 —— 它订阅总线上的 exp.gained，写入面用的是①里的 character manager；
 *   ④ 任务执行环（A2，可选）—— 它订阅总线上的 task.*，晚于 runtime 起（否则漏事件）。
 *
 * why ②③ 分开而不是合并：runtime 的启动让命令开始落地，养成回路的启动让经验事件开始结算，
 *   两者互不依赖先后，但养成回路必须在 runtime 之后启动 —— 否则启动瞬间到达的 exp.gained
 *   会落在还没接上总线的窗口里（丢事件）。
 */
export function createStratixService(options: StratixServiceOptions = {}): StratixService {
  const store = options.store ?? worldStore;
  /** 缺省提示出口（只用于「未接执行环」那条警告；其余缺省范式 = 静默）。 */
  const warn = options.logger ?? ((line: string): void => console.warn(line));

  // ===== ① 四个写入面（同一份 store；两处写的是同一件事）=====
  const character = createCharacterManager({ store });
  const mission = createMissionManager({ store });
  const task = createTaskManager({ store });
  // 会话域写入面（@since v3.43，task_093）：纯构造、无 IO、无订阅 —— 与前三个同口径。
  // 持久化口缺省口径（与 exp_events 同一范式）：显式给了用显式的；没给而存储件在 → 用存储件接管；
  // 两者都缺 = 不落库（会话只活在 WorldState 里，不假装落库成功）。
  // 存储件（事件读口的来源；抽出局部量好让下面的闭包不用再判空）。
  const storage = options.storage;
  const sessionPersister: SessionPersistPort | null =
    options.persistSession ??
    (storage
      ? createSessionPersister(
          {
            upsertSession: storage.persistSession,
            appendSessionEvent: storage.persistSessionEvent,
          },
          options.logger
        )
      : null);
  const session = createSessionManager({
    store,
    ...(sessionPersister ? { persist: sessionPersister } : {}),
    // 长会话压缩阈值（@since v3.48 / task_106 / v3.2b-B7）：事件条数超过它就折叠老段。
    //   缺省 200，可用 env `SX_SESSION_COMPRESS_THRESHOLD` 调（解析见 app/services/session-compress-config.ts）。
    compressThreshold: sessionCompressThresholdFromEnv(),
    // 事件读口（@since v3.47，task_101）：resume 的回灌要有事件源 ——
    //   存储件在 → 用它读（库里 sessions / session_events 两张表就是事件流，
    //   口径与 app 侧 session-reader.ts 同一份 DAO）；存储件不在 → 不接
    //   （回灌不出上文，core 会**如实拒绝**，绝不空转成"已恢复"）。
    ...(storage
      ? {
          read: {
            readSessionEvents: (
              sessionId: string,
              query: { readonly beforeSeq?: number; readonly limit: number }
            ) =>
              storage
                .readSessionEvents(sessionId, {
                  ...(query.beforeSeq === undefined ? {} : { beforeSeq: query.beforeSeq }),
                  limit: query.limit,
                })
                .map(toSessionEventView),
            // 向前读（@since v3.48 / task_106）：长会话压缩取"要折的那一段"用 ——
            //   窗口口径得从最新往回翻页穿过整段历史（读量随会话长度增长）。
            readSessionEventsAfter: (
              sessionId: string,
              afterSeq: number,
              limit: number
            ) => storage.readSessionEventsAfter(sessionId, afterSeq, limit).map(toSessionEventView),
          },
        }
      : {}),
  });

  // ===== ② core runtime（命令 → 状态机 → store → 广播）=====
  const runtime = createCoreRuntime({
    store,
    character,
    mission,
    task,
    // 会话域写入面（@since v3.43，task_093）：`session.interrupt` 命令的落点 ——
    // 与上面三个 manager 同一个实例（命令落点与业务侧记账写的是同一份 WorldState.sessions）。
    session,
    // task_101：`session.resume` 命令的落点 —— **core 级**恢复（翻状态位 interrupted → active
    //   + 记一条 resumed 事件 + 建回灌快照；core/session 的 manager.resume 裁决）。
    //   why 这里只做 core 级：互聊**引擎**（回灌上文后重启轮转）住在渲染进程，
    //   service 进程不跑互聊 —— 它能改的是"本进程的状态与事件流"这一层真相。
    //   准入不满足（会话不在 / 非互聊 / 不是被中断的 / 没有事件源）时 manager 如实拒绝，
    //   状态纹丝不动 —— MCP 侧据此如实报错，不假装恢复成功。
    sessionResume: (sessionId: string): void => {
      session.resume(sessionId);
    },
    // 流水线编排器端口：未注入时 pipeline.start 走 onUnhandled（未落地口径，不假装成功）。
    pipeline: options.pipeline,
    onUnhandled:
      options.onUnhandled ??
      ((channel, payload) => {
        console.warn(`[Stratix][service] 未处理 ${channel}: ${payload.type}`);
      }),
  });
  const stopRuntime = runtime.start();

  // ===== ③ 养成回路（exp.gained → 角色成长 + 升级广播）=====
  // 落库口缺省 = 不落库（养成照常，只少一条审计流）—— 与渲染侧的 persistExpEvent 同一范式。
  const stopProgression = createProgressionService({
    characterManager: character,
    logger: options.logger,
    persistExpEvent: options.persistExpEvent ?? options.storage?.persistExpEvent,
  }).start();

  // ===== ④ 任务执行环（A2，可选接入）=====
  // 接上 = 本进程直接 spawn CLI（不再经渲染进程 → cliChat IPC → Electron main）。
  // 不接 = 任务只落 queued，没人执行 —— 明确记一行警告（如实说清没人干活，不假装成功）。
  let taskService: TaskService | null = null;
  let stopTaskExecution: (() => void) | null = null;
  if (options.taskExecution) {
    taskService = createServiceTaskExecution({
      ...options.taskExecution,
      // 任务全文的落库口（A3）：显式给了就用显式的；没给而存储件在 → 落 service 侧库
      // （铁律 6：SQLite 由 service 进程独占写）。
      persistTask: options.taskExecution.persistTask ?? options.storage?.persistTask,
      // 编组任务收尾（task_076 语义，与渲染侧组合根 main-entry.ts 同一口径）：
      //   任务 completed → mission done；任务 failed → mission cancelled（中止语义）。
      // why 组合根兜底接线（而不是留给调用方）：service 进程持有 core runtime（真相唯一），
      //   没人接线的话 —— 任务在 service 里跑完了，mission 却永远停在 running。
      //   那正是「壳关了 agent 照常干活」这条主张要消解的场景（C1 剧本的验收点）。
      onMissionSettled:
        options.taskExecution.onMissionSettled ??
        ((record) => {
          // 回报落点 + 兜底（@since v3.8 / task_143）：编组任务已被撤掉 / 删除时，
          //   回报无处可落 —— 由 settleMissionFromTaskReport 留痕（warn 日志 + Notice），
          //   不再"静默蒸发"（评估报告 r4 P1：任务跑完了，编组那边一声不响）。
          settleMissionFromTaskReport(
            { store, mission, logger: warn },
            { taskId: record.id, status: record.status, missionId: record.missionId ?? null }
          );
        }),
      // 编组任务存在性读口（@since v3.8 / task_143）：任务收尾时给 mission_run 会话
      //   标出"回报落空"（编组已被删）—— 这条会话是 MCP 侧唯一查得到的回报去向痕迹。
      missionExists:
        options.taskExecution.missionExists ??
        ((missionId: string) =>
          (store.getState().missions ?? []).some((missionItem) => missionItem.id === missionId)),
      store,
      taskManager: task,
      // 会话域写入面（@since v3.43，task_093）：任务收尾时记 task_run / mission_run 会话
      // （LITE 两事件，见 app/services/task-service.ts 文件头）。
      sessions: session,
    });
    stopTaskExecution = taskService.start();
  } else {
    stopTaskExecution = onWorldEvent((event) => {
      if (event.type !== 'task.queued') return;
      warn('[Stratix][service] 未接任务执行环：任务只落 queued，不会被执行（接入 taskExecution 端口即可）');
    });
  }

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    // 逆序收：执行环先退（它订阅总线上的 task.*），再退养成回路，最后退 runtime。
    stopTaskExecution?.();
    stopProgression();
    stopRuntime();
  };

  return { store, runtime, character, mission, task, session, taskService, stop };
}
