/**
 * 文件职责：world-sync 的**端点**（前后端分离 B2 / task_082）—— gateway 侧的传输实现：
 *   统一发号（seq）、快照节流广播、命令面回读核对落点、事件面投递（@since task_156）、
 *   **下行事件广播**（@since task_216 / IX-02：core 裁决产物 → 全体客户端）、
 *   心跳踢死链、多客户端广播。
 * 输入：一条 WS 连接（生产 = `ws` 的 WebSocket；单测 = 注入的内存 duplex socket）、
 *   core store（真相源）与命令投递口（core 总线）。
 * 输出：发给客户端的 snapshot（广播）/ command.ack（点对点）/ error（点对点）。
 * 禁止事项：
 *   1. 在端点里裁决命令合法性 —— 载荷合法性归 core 状态机（铁律 2「裁决在 core」）；
 *   2. 在端点里改 store —— 写只经 HudCommand（core 总线），端点只负责传输与回执；
 *   3. 按连接分别发号 —— seq 全 service 统一发号（协议 §3.1），两个客户端看到的 seq 必须可比；
 *   4. 状态面未附着时改发空 snapshot —— 未附着 = 没有真相，如实报 not_attached（协议 §1.3）；
 *   5. 假装成功 —— 命令无落点一律回 internal_error 回执（铁律 4）。
 *   6. 在端点里自行决定「推什么」—— 下行白名单在协议层（createEventPushMessage 判），端点只负责广播。
 *
 * ============ 节流（协议 §3.7 / 任务要求 3）============
 * store 每次变更都推一份全量快照会把带宽与渲染成本打爆 —— 故按 25ms 窗口**合并**：
 *   窗口内发生的多次变更只推**最新**一份（中间态不推）；窗口过后再有变更再开新窗口。
 * 节流丢弃的中间态不影响真相：下一份快照是全量的（客户端整体覆盖，协议 §1.2）。
 *
 * ============ 关键事件旁路（@since v3.3，task_231 / PERF-02）============
 * 「进副本 / 退副本 / 单位上场 / 单位移除」是**结构变化**：用户点了就该立刻看见，等一窗 = 白等
 *   （实测「点进入→生效」122ms 里 ~100ms 耗在这条节流窗上 —— docs/PERF-baselines.md §6 候选 1）。
 * 故这类变化**不等节流窗**，立刻发一帧；高频变化（提示 / 选择 / 任务相位…）照旧走 25ms 合并。
 * why 判定在 **gateway 侧**：时延策略是**传输层**的事，core 零 IO 铁律 —— core 只管状态对不对。
 *
 * ============ 回读核对落点（任务要求 4）============
 * 语义对齐 src/stratix-gateway/mcp/context.ts 的既有口径：**投命令 → 回读状态 → 核对落点**。
 * 差别：MCP 是「一次性读回」（工具调用是同步语义），本端点是**流式**的 ——
 *   故落点核对是一个**探针**：投命令后盯着 store，落点出现即回 ok；
 *   超过 WORLD_SYNC_ACK_TIMEOUT_MS 仍无落点 → 回 internal_error（**超时不是成功**，铁律 4）。
 * 落点判定（按顶层字段引用比对 —— core 的状态更新一律换新引用，未变则连引用都不换）：
 *   · 有字段变了（除 notices 外）→ 落地（ok）；
 *   · 只多了 warn/error 级 Notice → core 状态机拒绝了这条命令（rejected）；
 *   · 什么都没变 → 落点没出现 → 等到超时 → internal_error。
 *
 * 已知边界（记在 task_082.md 的契约缺口里，本单不改契约层）：
 *   ① core 的「无状态变更型」命令（unit.move / camera.center —— 落点在世界层坐标而非 WorldState）
 *      在本端点会被判为「无落点」→ 超时回 internal_error；
 *   ② 落点核对是**观测**而非精确归因：核对窗口内若其它来源也改了状态，会被判为落地。
 *
 * 配套契约：docs/WORLD-SYNC.md｜protocol.ts（B1 契约层，不在本单改动）
 */

import http from 'http';

import { WebSocketServer } from 'ws';

import type { CoreStore } from '@/core/store';
import type { HudCommand, Notice, UnitView, WorldEvent, WorldState } from '@/core/types';

import {
  WORLD_SYNC_ACK_TIMEOUT_MS,
  WORLD_SYNC_PATH,
  WORLD_SYNC_SEQ_START,
  createEventPushMessage,
  createFailedAck,
  createNotAttachedAck,
  createOkAck,
  createSnapshotMessage,
  type CommandAckMessage,
  type ForwardableWorldEvent,
  type SnapshotMessage,
} from './protocol';
import { WorldSyncSession, type WorldSyncEndpointPort, type WorldSyncSocket } from './session';

// ============================================================================
// 落点探针（回读核对）
// ============================================================================

/** 落点判定的三种结局。 */
type LandingOutcome = 'landed' | 'rejected' | 'timeout';

/**
 * 顶层字段级差异（按引用比较）。
 * why 引用比较就够：core 的状态更新一律换新引用（store.ts「引用未变即不广播」约定），
 *   没变的字段引用不变 —— 不需要深比较，也不会有深比较的漏判。
 */
function changedTopLevelKeys(before: WorldState, after: WorldState): string[] {
  const beforeRecord = before as unknown as Record<string, unknown>;
  const afterRecord = after as unknown as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (beforeRecord[key] !== afterRecord[key]) changed.push(key);
  }
  return changed;
}

/**
 * 找出「本次新增的告警级 Notice」（core 拒绝命令时的落法：只发通知，不改实体）。
 * why 只认 warn/error 级：info 级通知不构成拒绝证据（如「已存入编组」也是 info）。
 */
function findRejectionNotice(before: WorldState, after: WorldState): Notice | null {
  const known = new Set((before.notices ?? []).map((notice) => notice.id));
  for (const notice of after.notices ?? []) {
    if (known.has(notice.id)) continue;
    if (notice.level === 'warn' || notice.level === 'error') return notice;
  }
  return null;
}

/**
 * 单位集合的**结构指纹**（只取 id，按序拼接；分隔符 `\u0000` 保证 id 拼接不撞车）。
 * why 只看 id：位置 / 忙碌与否是高频变的**表现态**，而「场上有哪些单位」是**结构**。
 */
function unitSetSignature(units: readonly UnitView[]): string {
  return units.map((unit) => unit.id).join('\u0000');
}

/**
 * 判定「这是不是一次**结构变化**」（@since v3.3，task_231 / PERF-02；gateway 侧判定）。
 * 四类关键事件都落在这一个判据里：进副本 / 退副本 ⇒ 激活实例变了；
 *   单位上场 / 单位移除 ⇒ 单位集合的 id 指纹变了。其余字段（提示 / 选择 / 任务相位…）
 *   是表现态 —— 高频变，走节流窗合并才对。
 * @param prev 上一份状态面（null = 首帧 ⇒ 不算结构变化）。
 */
function isStructuralChange(prev: WorldState | null, next: WorldState): boolean {
  if (!prev) return false;
  if ((prev.activeInstanceId ?? null) !== (next.activeInstanceId ?? null)) return true;
  if (prev.units === next.units) return false; // 同一个单位数组引用 ⇒ 结构没动
  return unitSetSignature(prev.units) !== unitSetSignature(next.units);
}

/**
 * 落点探针：投命令后盯着状态面，落点出现即结算。
 *
 * why 做成「探针」而不是「一次性读回」：core 绝大多数命令同步落地，但也有异步落地的
 *   （如执行环接手排队任务）—— 一次性读回会把「还没落地」误判成失败。
 */
class LandingProbe {
  /** 投命令前的状态快照（引用）。 */
  private readonly before: WorldState;

  /** 是否已结算。 */
  private settled = false;

  /** 结算结果。 */
  private outcome: LandingOutcome = 'timeout';

  /** 拒绝证据（rejected 时有值）。 */
  private rejection: Notice | null = null;

  /** 等待中的结算回调。 */
  private resolver: ((outcome: LandingOutcome) => void) | null = null;

  /** 超时定时器。 */
  private timer: NodeJS.Timeout | null = null;

  constructor(before: WorldState) {
    this.before = before;
  }

  /** 拒绝证据（rejected 时非空）。 */
  get rejectionNotice(): Notice | null {
    return this.rejection;
  }

  /** 观察一次状态面（幂等；已结算则忽略）。 */
  observe(state: WorldState): void {
    if (this.settled) return;
    if (state === this.before) return;
    const changed = changedTopLevelKeys(this.before, state);
    if (changed.length === 0) return;
    const onlyNotices = changed.length === 1 && changed[0] === 'notices';
    if (onlyNotices) {
      const notice = findRejectionNotice(this.before, state);
      if (notice) {
        this.rejection = notice;
        this.settle('rejected');
        return;
      }
    }
    this.settle('landed');
  }

  /** 等落点（最多 timeoutMs）。 */
  wait(timeoutMs: number): Promise<LandingOutcome> {
    if (this.settled) return Promise.resolve(this.outcome);
    return new Promise<LandingOutcome>((resolve) => {
      this.resolver = resolve;
      this.timer = setTimeout(() => {
        this.settle('timeout');
      }, timeoutMs);
      // 不吊住进程（单测与嵌入式运行都不该被定时器拖住）。
      this.timer.unref?.();
    });
  }

  /** 结算（幂等）。 */
  private settle(outcome: LandingOutcome): void {
    if (this.settled) return;
    this.settled = true;
    this.outcome = outcome;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const resolver = this.resolver;
    this.resolver = null;
    resolver?.(outcome);
  }
}

// ============================================================================
// 端点
// ============================================================================

/** 端点构造参数（全部可注入 —— 单测不起真端口、不连真总线）。 */
export interface WorldSyncEndpointOptions {
  /** 世界态持有者（真相源）。**传 null = 状态面未附着**（协议 §1.3 的那条语义）。 */
  readonly store: CoreStore | null;
  /** 命令投递口（生产 = core 总线的 emitCommand）。 */
  readonly dispatch: (command: HudCommand) => void;
  /**
   * 世界事件投递口（@since v3.3，task_156；生产 = core 总线的 emitWorldEvent）。
   * 缺省 = **不投递**（端点没有总线就没有裁决方 —— 事件无处可去，如实丢弃不假装生效）。
   */
  readonly dispatchEvent?: (event: WorldEvent) => void;
  /**
   * **下行事件流**的订阅口（@since v3.3，task_216 / IX-02；生产 = core 总线的 onWorldEvent）。
   *
   * why 注入而不是端点内部直接 import core/bus：端点是**传输层**（协议层纪律：不引业务依赖），
   *   且单测要能起一个「内存 service 实例」而不牵动全局总线单例。
   * 缺省 = **不订阅**（没有下行源就没有下行事件 —— 如实不推，不假装有）。
   *
   * 语义：端点把 core 总线上**下行白名单内**的事件（首批只放 `unit.position`）广播给
   *   所有已 hello 的连接；白名单外的一律不推（纯视图事件 + 防回环的第一道闸）。
   */
  readonly subscribeWorldEvents?: (
    handler: (event: WorldEvent) => void,
  ) => () => void;
  /** 命令回执超时（ms）。缺省 = WORLD_SYNC_ACK_TIMEOUT_MS。 */
  readonly ackTimeoutMs?: number;
  /** 快照节流窗口（ms）。缺省 = WORLD_SYNC_SNAPSHOT_THROTTLE_MS（25）。 */
  readonly snapshotThrottleMs?: number;
  /** 心跳间隔（ms）。缺省 = 30000；传 0 = 不起心跳。 */
  readonly heartbeatIntervalMs?: number;
  /** 日志口（可选）。 */
  readonly logger?: (line: string) => void;
}

/**
 * 快照节流窗口默认值（ms）—— 任务要求 3。
 * @since v3.3（task_231 / PERF-02）：100 → 25（100ms 窗把「点进入→生效」拖到 122ms，
 *   service 侧裁决只花 5ms —— docs/PERF-baselines.md §6 候选 1）。关键结构变化走**旁路**。
 */
export const WORLD_SYNC_SNAPSHOT_THROTTLE_MS = 25;

/** 心跳间隔默认值（ms）—— 与既有 StatusSync 同口径。 */
export const WORLD_SYNC_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * 存活标记（WeakMap）。
 * why WeakMap：以 socket 为键，socket 被回收即随之消失 —— 不会攒下无主条目（perf：资源必须可清理）。
 * 口径与 src/stratix-gateway/api/websocket/StatusSync.ts 的 ping/pong 存活标记一致，
 * 但**不复用它的事件面**（那是 v2 编排事件、两个世界）。
 */
const aliveMarkers = new WeakMap<WorldSyncSocket, { isAlive: boolean }>();

/**
 * world-sync 端点：一条 service 侧的传输中枢。
 *
 * 职责边界：
 *   · 发号（全 service 统一、单调递增，协议 §3）；
 *   · 广播（全量快照，节流合并）；
 *   · 命令面（投递 + 回读核对落点 → 回执）；
 *   · 连接生命周期（接入 / 断开清理 / 心跳踢死链）。
 */
export class WorldSyncEndpoint implements WorldSyncEndpointPort {
  /** 世界态持有者（null = 未附着）。 */
  private readonly store: CoreStore | null;

  /** 命令投递口。 */
  private readonly dispatch: (command: HudCommand) => void;

  /** 世界事件投递口（@since v3.3，task_156；缺省 = 无裁决方，事件无处可去）。 */
  private readonly dispatchEvent: ((event: WorldEvent) => void) | null;

  /** 下行事件流的订阅退订（@since v3.3，task_216 / IX-02；null = 未订阅）。 */
  private unsubscribeWorldEvents: (() => void) | null;

  /** 命令回执超时（ms）。 */
  private readonly ackTimeoutMs: number;

  /** 快照节流窗口（ms）。 */
  private readonly snapshotThrottleMs: number;

  /** 心跳间隔（ms）；0 = 不起心跳。 */
  private readonly heartbeatIntervalMs: number;

  /** 日志口。 */
  private readonly logger: (line: string) => void;

  /** 活跃会话。 */
  private readonly sessions = new Set<WorldSyncSession>();

  /** 已发号的最大 seq（0 = 还没发过；首个 = WORLD_SYNC_SEQ_START）。 */
  private seq = 0;

  /**
   * 上一份状态面（@since v3.3，task_231 / PERF-02）—— 判「结构变化」的对照基准。
   * why 端点自己记：store 订阅只给**新**状态；只留引用不深比较（WorldState 不可变）。
   */
  private lastState: WorldState | null = null;

  /** 待发的节流广播定时器（null = 无待发）。 */
  private broadcastTimer: NodeJS.Timeout | null = null;

  /** 心跳定时器。 */
  private heartbeatTimer: NodeJS.Timeout | null = null;

  /** 退订 store 订阅的闭包。 */
  private unsubscribeStore: (() => void) | null = null;

  /** 在飞的落点探针。 */
  private readonly probes = new Set<LandingProbe>();

  /** 收尾钩子（挂载层注册：摘 upgrade 监听、关 wss）。 */
  private readonly cleanups: Array<() => void> = [];

  /** 是否已关闭。 */
  private closed = false;

  constructor(options: WorldSyncEndpointOptions) {
    this.store = options.store;
    this.dispatch = options.dispatch;
    this.dispatchEvent = options.dispatchEvent ?? null;
    this.unsubscribeWorldEvents = null;
    this.ackTimeoutMs = options.ackTimeoutMs ?? WORLD_SYNC_ACK_TIMEOUT_MS;
    this.snapshotThrottleMs = options.snapshotThrottleMs ?? WORLD_SYNC_SNAPSHOT_THROTTLE_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? WORLD_SYNC_HEARTBEAT_INTERVAL_MS;
    this.logger = options.logger ?? ((line: string): void => console.log(line));

    if (this.store) {
      // 结构变化的对照基准 = 端点构造时的那份状态（此刻还没变过）。
      this.lastState = this.store.getState();
      // 状态面一变就记一笔：先判落点探针，再排节流广播（顺序固定：命令回执早于广播）。
      this.unsubscribeStore = this.store.subscribe((state) => this.handleStateChange(state));
    }
    // 下行事件流（@since v3.3，task_216 / IX-02）：订阅 core 总线 → 白名单内的事件广播给全体客户端。
    const subscribe = options.subscribeWorldEvents;
    if (subscribe) {
      this.unsubscribeWorldEvents = subscribe((event) => this.pushWorldEvent(event));
    }
    this.startHeartbeat();
  }

  /** 状态面是否附着。 */
  get attached(): boolean {
    return this.store !== null;
  }

  /** 当前已发号的最大 seq（最新一份 snapshot 的版本号）。 */
  get currentSeq(): number {
    return this.seq;
  }

  /** 活跃连接数（观测用）。 */
  get clientCount(): number {
    return this.sessions.size;
  }

  /** 注册收尾钩子。 */
  addCleanup(fn: () => void): void {
    this.cleanups.push(fn);
  }

  /**
   * 接入一条连接（生产 = ws 的 WebSocket；单测 = 内存 duplex socket）。
   * 事件接线归端点（连接生命周期是端点的事），协议分派归会话。
   */
  accept(socket: WorldSyncSocket): WorldSyncSession {
    const session = new WorldSyncSession({ socket, endpoint: this, logger: this.logger });
    this.sessions.add(session);
    this.setAlive(socket, true);

    socket.on('message', (data: unknown) => {
      void session.handleMessage(data);
    });
    socket.on('close', () => {
      this.releaseSession(session);
    });
    socket.on('error', (error: unknown) => {
      this.logger(`[world-sync] 连接错误：${describeError(error)}`);
    });
    socket.on('pong', () => {
      this.setAlive(socket, true);
    });

    this.logger(`[world-sync] 接入一条连接（当前 ${this.sessions.size} 条）`);
    return session;
  }

  /** 会话结束 → 清理（幂等）。 */
  releaseSession(session: WorldSyncSession): void {
    if (!this.sessions.delete(session)) return;
    this.logger(`[world-sync] 断开一条连接（剩余 ${this.sessions.size} 条）`);
  }

  /**
   * 发一份新的全量 snapshot（统一发号）。
   * 未附着时返回 null（**不改发空快照** —— 协议 §1.3）。
   */
  issueSnapshot(): SnapshotMessage | null {
    const store = this.store;
    if (!store) return null;
    this.seq += 1;
    return createSnapshotMessage(this.seq, store.getState());
  }

  /**
   * 命令面：投递 → 回读核对落点 → 回执。
   * 绝不假装成功：超时无落点 = internal_error（铁律 4）。
   */
  async dispatchCommand(commandId: string, command: HudCommand): Promise<CommandAckMessage> {
    const store = this.store;
    if (!store) return createNotAttachedAck(commandId);

    const probe = new LandingProbe(store.getState());
    this.probes.add(probe);
    try {
      try {
        this.dispatch(command);
      } catch (error) {
        // 投递口抛错 = 命令没出去。如实报 internal_error（绝不假装成功）。
        return createFailedAck(
          commandId,
          'internal_error',
          `命令投递失败：${describeError(error)}`,
          null
        );
      }
      // 同步回读：core 绝大多数命令在裁决里同步落地（emit → 状态机 → store）。
      probe.observe(store.getState());
      const outcome = await probe.wait(this.ackTimeoutMs);
      if (outcome === 'landed') {
        return createOkAck(commandId, Math.max(this.seq, WORLD_SYNC_SEQ_START));
      }
      if (outcome === 'rejected') {
        const notice = probe.rejectionNotice;
        return createFailedAck(
          commandId,
          'rejected',
          notice ? `命令被 core 状态机拒绝：${notice.text}` : '命令被 core 状态机拒绝',
          Math.max(this.seq, WORLD_SYNC_SEQ_START)
        );
      }
      return createFailedAck(
        commandId,
        'internal_error',
        `命令裁决超时（${this.ackTimeoutMs}ms 内无落点）：无人接管或未落地`,
        null,
        '结果未知：不要重发同一条命令（可能已落地）；真相以后续 snapshot 为准'
      );
    } finally {
      this.probes.delete(probe);
    }
  }

  /**
   * 事件面（@since v3.3，task_156）：把客户端上行的世界事件投到 **service 的 core 总线**。
   *
   * why 端点只做「投递」：裁决在 service 侧的 core runtime（铁律 2）—— 事件进了总线，
   *   core 落 store → store 变更 → 本端点照旧广播全量 snapshot（回推全体客户端）。
   *   端点自己**不改 store**（同 dispatchCommand 的纪律）。
   *
   * 无回执（fire-and-forget）：世界事件没有「落点 id」可回读，快照是最终一致口径。
   */
  dispatchWorldEvent(event: ForwardableWorldEvent): void {
    const emit = this.dispatchEvent;
    if (!emit) {
      // 没有总线 = 没有裁决方。如实记一笔（不假装生效），不炸传输层。
      this.logger(`[world-sync] 事件面无投递口（type=${event.type}）—— 已丢弃`);
      return;
    }
    if (!this.store) {
      // 未附着：没有真相可落 —— 事件无处裁决（如实记一笔，不假装生效）。
      this.logger(`[world-sync] 状态面未附着，事件无处裁决（type=${event.type}）`);
      return;
    }
    try {
      emit(event);
    } catch (error) {
      // 投递口抛错 = 事件没出去。如实记一笔（铁律 4「绝不假装成功」），连接继续活着。
      this.logger(`[world-sync] 事件投递失败（type=${event.type}）：${describeError(error)}`);
    }
  }

  /**
   * 下行事件面（@since v3.3，task_216 / IX-02）：把 core 总线上的**裁决产物**广播给全体客户端。
   *
   * why 要这条通道：service 侧的 core 裁决右击移动后，会在自己的总线上广播 `unit.position`
   *   （编队终值）。协议原先只有 `event.forward`（上行）⇒ 那条广播**无人可收** ⇒
   *   客户端没有 tween、没有小地图更新、也没有落库（画布"点了没反应"）。
   *
   * why 白名单在协议层（`createEventPushMessage` 判）：纯视图事件（camera.moved / fx.sound …）
   *   不推（service 的相机姿态对客户端无意义，且纯属烧带宽）；**更重要的是防回环** ——
   *   下行白名单与上行白名单**互斥**（protocol.ts 的编译期断言）⇒ 推下去的事件
   *   客户端不会又上行回来（上行那条路由 `FORWARDABLE_WORLD_EVENT_TYPES` 挡死）。
   *
   * 返回 true = 已广播；false = 白名单外 / 无连接（如实丢弃，不假装推过）。
   */
  pushWorldEvent(event: WorldEvent): boolean {
    const message = createEventPushMessage(event);
    if (!message) {
      // 白名单外（纯视图事件 / 上行语义事件）—— 不推（防回环的第一道闸）。
      return false;
    }
    let sent = false;
    for (const session of Array.from(this.sessions)) {
      if (!session.registered) continue;
      session.send(message);
      sent = true;
    }
    return sent;
  }

  /** 收干净：停定时器 → 退 store 订阅 → 断连接 → 跑收尾钩子。幂等。 */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.unsubscribeWorldEvents?.();
    this.unsubscribeWorldEvents = null;
    for (const session of Array.from(this.sessions)) {
      try {
        session.socket.terminate?.();
      } catch {
        // 强断失败无所谓：连接已不可用。
      }
    }
    this.sessions.clear();
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch (error) {
        this.logger(`[world-sync] 收尾钩子出错：${describeError(error)}`);
      }
    }
    this.cleanups.length = 0;
  }

  // -------------------------------------------------------------------------
  // 私有
  // -------------------------------------------------------------------------

  /** 状态面变了：先判落点探针，再排节流广播（结构变化 ⇒ 不等窗，立即发）。 */
  private handleStateChange(state: WorldState): void {
    for (const probe of Array.from(this.probes)) probe.observe(state);
    const structural = isStructuralChange(this.lastState, state);
    this.lastState = state;
    if (structural) {
      // 关键事件旁路（task_231 / PERF-02）：用户点了就要立刻看见，不等节流窗。
      this.flushBroadcast();
      return;
    }
    this.scheduleBroadcast();
  }

  /** 排一次节流广播（窗口内只排一次 —— 中间态合并掉，只推最新）。 */
  private scheduleBroadcast(): void {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.broadcastSnapshot();
    }, this.snapshotThrottleMs);
    this.broadcastTimer.unref?.();
  }

  /**
   * 立刻发一帧快照（关键事件旁路）。
   * why 撤掉待发的窗口定时器：这一帧已是「此刻的全量真相」，窗口里那份只会重复同一份变化。
   */
  private flushBroadcast(): void {
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    this.broadcastSnapshot();
  }

  /** 广播一份全量 snapshot 给所有**已 hello** 的连接（协议 §4.5：snapshot 是广播）。 */
  private broadcastSnapshot(): void {
    const message = this.issueSnapshot();
    if (!message) return;
    for (const session of Array.from(this.sessions)) {
      if (!session.registered) continue;
      session.send(message);
    }
  }

  /** 起心跳（ping/pong 存活标记）。 */
  private startHeartbeat(): void {
    if (this.heartbeatIntervalMs <= 0) return;
    this.heartbeatTimer = setInterval(() => this.tickHeartbeat(), this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  /** 一轮心跳：没回过 pong 的连接 = 死链 → 踢掉。 */
  private tickHeartbeat(): void {
    for (const session of Array.from(this.sessions)) {
      const socket = session.socket;
      if (!this.getAlive(socket)) {
        this.logger('[world-sync] 心跳超时，踢掉死链');
        this.killSession(session);
        continue;
      }
      this.setAlive(socket, false);
      try {
        socket.ping?.();
      } catch (error) {
        this.logger(`[world-sync] ping 失败，踢掉死链：${describeError(error)}`);
        this.killSession(session);
      }
    }
  }

  /** 踢掉一条死链（幂等）。 */
  private killSession(session: WorldSyncSession): void {
    this.releaseSession(session);
    try {
      session.socket.terminate?.();
    } catch {
      // 强断失败无所谓。
    }
  }

  /** 标存活。 */
  private setAlive(socket: WorldSyncSocket, value: boolean): void {
    let marker = aliveMarkers.get(socket);
    if (!marker) {
      marker = { isAlive: true };
      aliveMarkers.set(socket, marker);
    }
    marker.isAlive = value;
  }

  /** 读存活位（缺省 true = 没打过 ping 的连接不算死）。 */
  private getAlive(socket: WorldSyncSocket): boolean {
    return aliveMarkers.get(socket)?.isAlive ?? true;
  }
}

// ============================================================================
// 挂载
// ============================================================================

/**
 * 把 world-sync 端点挂到 HTTP server 上（路径 = WORLD_SYNC_PATH = /ws/world-sync）。
 *
 * why 挂同一个 HTTP server 而不是另开一个端口：另开端口要多一处部署与一处防火墙口。
 *   与 openclaw 的 WS 路由**共存不冲突**：两者各自注册一个 'upgrade' 监听，
 *   各自只认自己的路径 —— openclaw 认 /api/stratix/openclaw/**，本端点认 /ws/world-sync。
 *   Node 会依次调用所有 'upgrade' 监听；不匹配的路径本端点**不碰**（不销毁 socket、不抢处理）。
 */
export function attachWorldSyncEndpoint(
  server: http.Server,
  options: WorldSyncEndpointOptions
): WorldSyncEndpoint {
  const endpoint = new WorldSyncEndpoint(options);
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (
    req: http.IncomingMessage,
    socket: import('net').Socket,
    head: Buffer
  ): void => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== WORLD_SYNC_PATH) return; // 不是本端点的路径 → 不碰
    wss.handleUpgrade(req, socket, head, (ws) => {
      endpoint.accept(ws);
    });
  };

  server.on('upgrade', onUpgrade);
  endpoint.addCleanup(() => {
    server.off('upgrade', onUpgrade);
    wss.close();
  });
  return endpoint;
}

/** 错误 → 一句话。 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
