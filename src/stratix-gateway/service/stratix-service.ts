/**
 * 文件职责：**headless 组合根**（前后端分离 A1 / task_077）—— 在**没有渲染进程**的进程里
 *   装配 core runtime（命令 → 状态机 → store → 广播），让 service 进程自己持有世界态。
 *   装配内容照抄渲染侧组合根（src/app/main/main-entry.ts 的 core 段），顺序也照抄：
 *     ① 三个写入面（character / mission / task manager）—— 同一份 store；
 *     ② core runtime —— 命令分发的唯一裁决点（runtime 后起）；
 *     ③ 养成回路（progression-service）—— exp.gained → 角色成长 + 升级广播。
 * 输入：可选注入端口（store / pipeline / persistExpEvent / onUnhandled / logger）—— 缺省即缺省范式。
 * 输出：一个可独立 boot 的 StratixService：{ store, runtime, character, mission, task, stop }。
 * 禁止事项：
 *   1. import 渲染层 / 宿主层的东西（DOM、ipc、preload、浏览器全局）—— 本模块必须能在纯 node 里跑；
 *   2. 直接改 store —— 写操作一律走 HudCommand，由 core 状态机裁决（铁律：裁决在 core）；
 *   3. 在这里做业务判断（等级曲线 / 任务相位 / 合法性）—— 那些真相在 core，本模块只接线；
 *   4. 复制 app/services/progression-service 的逻辑 —— 复用它，只注入它的可选落库端口；
 *   5. 把视图件（对话抽屉 / 轻提示 / 进程内 IPC 面）硬接进来 —— 视图件一律是**可选注入端口**，
 *      端口缺席时服务照常工作（缺省范式见 persistExpEvent：非渲染环境端口缺席、服务照常）。
 *
 * why 单独成模块（而不是让渲染进程继续独占 core runtime）：
 *   前后端分离的拓扑是「service 常驻持有大脑，宿主进程退化为可选视图壳」
 *   （docs/SERVICE-SPLIT-PLAN.md §2）。core runtime 住在渲染进程里时，关掉窗口 = 大脑停机。
 *   本模块把同一套装配抽成零渲染依赖的组合根，让 service 进程能独立持有世界态；
 *   渲染侧组合根本单**不改**（C2 才做双模式收敛）。
 *
 * 视图件清单（A1 全部不接，将来一律走可选注入端口）：
 *   - 对话抽屉 / 视图口：属 app 层 chat / task 服务（A2 执行环），本模块零引用；
 *   - 轻提示（toast）：属 UI 反馈面，本模块零引用；
 *   - 进程内 IPC 面（对话 / 任务传输）：A2 才进 service，本模块零引用。
 *
 * @since v3.40（task_077 / service-split A1）。
 */

import { createProgressionService } from '../../app/services/progression-service';
import { createCharacterManager, type CharacterManager } from '../../core/character';
import { createMissionManager, type MissionManager } from '../../core/mission';
import { createCoreRuntime, type CoreRuntime, type UnhandledChannel } from '../../core/runtime';
import { worldStore, type CoreStore } from '../../core/store';
import { createTaskManager, type PipelineRunnerPort, type TaskManager } from '../../core/task';
import type { HudCommand, WorldEvent } from '../../core/types';

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
   * 未落地的命令 / 事件出口（可选）。缺省 = 记一行警告（不打断服务）。
   */
  readonly onUnhandled?: (channel: UnhandledChannel, payload: HudCommand | WorldEvent) => void;
  /** 日志口（可选）。缺省 = 静默（与 app 层各服务的缺省口径一致）。 */
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
  /** 收干净：退养成回路订阅 → 退 runtime 订阅（资源必须可清理）。幂等。 */
  stop(): void;
}

/**
 * 装配 headless core runtime。
 *
 * 装配顺序（与渲染侧组合根同一口径，见 main-entry.ts「core 侧」段）：
 *   ① 三 manager 先建 —— 它们只绑 store，纯构造、无 IO、无订阅、无副作用；
 *   ② runtime 后起 —— runtime.start() 接上 store 订阅 + 总线两个通道；
 *   ③ 养成回路最后起 —— 它订阅总线上的 exp.gained，写入面用的是①里的 character manager。
 *
 * why ②③ 分开而不是合并：runtime 的启动让命令开始落地，养成回路的启动让经验事件开始结算，
 *   两者互不依赖先后，但养成回路必须在 runtime 之后启动 —— 否则启动瞬间到达的 exp.gained
 *   会落在还没接上总线的窗口里（丢事件）。
 */
export function createStratixService(options: StratixServiceOptions = {}): StratixService {
  const store = options.store ?? worldStore;

  // ===== ① 三个写入面（同一份 store；两处写的是同一件事）=====
  const character = createCharacterManager({ store });
  const mission = createMissionManager({ store });
  const task = createTaskManager({ store });

  // ===== ② core runtime（命令 → 状态机 → store → 广播）=====
  const runtime = createCoreRuntime({
    store,
    character,
    mission,
    task,
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
    persistExpEvent: options.persistExpEvent,
  }).start();

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    // 逆序收：养成回路先退（它订阅总线），再退 runtime（它退 store 订阅与总线通道）。
    stopProgression();
    stopRuntime();
  };

  return { store, runtime, character, mission, task, stop };
}
