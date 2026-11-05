/**
 * 文件职责：**Electron 壳的远程世界态存储**（前后端分离 B3 / task_083）——
 *   core/store.ts 的 `CoreStore` 的**远程实现**：状态面只读（service 推全量快照 → 本地整体覆盖），
 *   写面只经 `command.forward`（hud 命令 → service 的 core 裁决，铁律 2）、
 *   **事件面只经 `event.forward`**（画布交互的世界事件 → service 的 core 裁决，@since v3.3 task_156）。
 * 输入：world-sync 协议（B1 契约层 protocol.ts）的消息 + 一条 WS 连接（可注入 → 单测不起真端口）。
 * 输出：一个与 `CoreStore` **读侧同形**的 store（`getState` / `subscribe`）+
 *   命令转发面（`emitCommand`）+ 事件转发面（`emitWorldEvent`）+ 存活性查询（`isStale`）
 *   + 版本诊断（`getSeq`）+ 收尾（`dispose`）。
 * 禁止事项：
 *   1. 在本地改状态 —— 本地没有真相，真相在 service 的 core store（铁律 1「真相唯一」）；
 *   2. 增量合并快照 —— 重连 = **全量覆盖**，不做逐字段合并（协议 §1.2）；
 *   3. 断连时返回空态或抛错 —— 返回最后一份快照 + `isStale()` 为 true（铁律 4「绝不假装成功」）；
 *   4. 把未回执的命令补发到新连接 —— 那条命令可能已在旧连接上落地（协议 §1.2 明令禁止）；
 *   5. 引入新依赖 —— 只用浏览器原生 WebSocket（可注入替换 → 单测用内存替身）。
 *
 * ============ 事件面（@since v3.3，task_156）============
 *   远程模式下渲染进程**不起本地 core runtime** —— 画布交互（点选 / 框选 / 右键移动）走的是
 *   world → core 的 WorldEvent 通道；少了转发通道，那些事件进了本地总线却零消费者 →
 *   **静默丢弃**（画布全哑）。故本实现提供 `emitWorldEvent`：把**状态语义**事件转成
 *   `event.forward` 发给 service，由 service 侧的 runtime 裁决（落 store → snapshot 回推）。
 *   白名单（协议层 `FORWARDABLE_WORLD_EVENT_TYPES`）：unit.click / selection.box / unit.move /
 *   camera.director。纯视图事件（camera.moved / replay.beat / fx.sound …）**不上行** ——
 *   service 不需要相机姿态，别拿视图态污染真相。
 *
 * ============ 唯一的例外：屏位（currentScreen）是**客户端自己的**视图状态 ============
 *   快照里的 `currentScreen` 落在 service 的**共享** store 上 —— 谁跳屏，所有客户端都被拽过去
 *   （task_153 默认连网关后暴露：另一个客户端切到设置屏，本浏览器就被拽进设置屏）。
 *   屏位是**每个客户端自己的视图状态**（跟你把窗口切到哪个标签页一样，不该被别人拽走），
 *   故本实现：① 快照到达时保留**本地**屏位；② 本端发起 `ui.navigate` 时立即本地生效
 *   （不等回执往返），同时照旧把命令转发给 service（协议口径不变、命令面词表零改动）。
 *   这是「本地视图」而非「本地真相」—— 业务数据仍一律来自快照（铁律 1 不破）。
 *
 * ============ 为什么不是完整的 CoreStore ============
 * `CoreStore` 的写方法（`setState` / `patch` / `pushNotice` / …）语义是
 *   「就地改本地真相」；远程模式下本地**没有**真相，照搬这些方法会造出第二份真相（铁律 1）。
 *   故本实现只提供 `CoreStore` 的读侧（`Pick<CoreStore, 'getState' | 'subscribe'>`，类型上同形），
 *   写一律经 `emitCommand` → `command.forward` → service 的 core 状态机裁决。
 *
 * ============ 断线语义（协议 §1.2 / §1.3）============
 *   · 断开 → 本地视图标记 stale（不可信），但**保留最后一份快照**（不返回空态）；
 *   · 指数退避重连（默认 500ms 起、×2、封顶 10s；收到快照即重置退避）；
 *   · 重连成功 → hello → service 立即回一份**全量** snapshot → 整体覆盖本地（stale 解除）；
 *   · 未附着（service 回 `error{code:'not_attached'}`）→ 标记 stale，不假装战场为空。
 *
 * 配套契约：docs/WORLD-SYNC.md｜src/stratix-gateway/api/websocket/world-sync/protocol.ts（B1 产物）
 */

import { createInitialState, type CoreStore, type StateListener } from '../../../core/store';
import type { HudCommand, ScreenId, WorldEvent, WorldState } from '../../../core/types';
import {
  WORLD_SYNC_ACK_TIMEOUT_MS,
  WORLD_SYNC_PATH,
  WORLD_SYNC_PROTOCOL_VERSION,
  createEventForwardMessage,
  decodeMessage,
  encodeMessage,
  fromWireState,
  type CommandAckMessage,
  type SnapshotMessage,
  type WorldSyncErrorCode,
  type WorldSyncErrorDetail,
  type WorldSyncMessage,
} from '../../../stratix-gateway/api/websocket/world-sync/protocol';

/**
 * 一条 WS 连接所需的最小面（浏览器 `WebSocket` 的窄接口）。
 *
 * why 不直接用 `ws` 的 WebSocket 类型：单测要能在**不起真端口**的前提下覆盖四条路径
 *   （快照覆盖 / 断线重连 / 命令发送 / stale 标志）—— 这里声明窄接口，
 *   生产侧传浏览器原生 WebSocket，单测侧传内存替身，两边共用同一份逻辑。
 */
export interface RemoteSocket {
  /** 发一帧文本。 */
  send(data: string): void;
  /** 关闭连接。 */
  close(code?: number, reason?: string): void;
  /** 连接建立。 */
  onopen: ((event: unknown) => void) | null;
  /** 收到一帧（载荷在 `data` 里：文本帧为 string，二进制帧为 Uint8Array）。 */
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  /** 连接关闭。 */
  onclose: ((event: unknown) => void) | null;
  /** 连接出错。 */
  onerror: ((event: unknown) => void) | null;
}

/** 命令回执（客户端侧视角）：ok / 失败原因 + 核对后的版本号。 */
export interface RemoteCommandResult {
  /** 命令 id（与 `command.forward.commandId` 一致）。 */
  readonly commandId: string;
  /** true = service 侧 core 已裁决落点；false = 未发出 / 被拒 / 超时（**绝不假装成功**）。 */
  readonly ok: boolean;
  /** 核对后的状态版本；没有真相时为 null。 */
  readonly seq: number | null;
  /** 失败详情（ok=false 时必有）。 */
  readonly error?: WorldSyncErrorDetail;
}

/**
 * 远程 store 契约：`CoreStore` 的**读侧**（类型上同形）+ 命令面 + 存活性。
 *
 * why 不是完整 `CoreStore`：写方法语义是「就地改本地真相」，远程模式下本地没有真相
 *   （真相在 service）—— 照搬会造出第二份真相（铁律 1）。见文件头说明。
 */
export interface RemoteStore extends Pick<CoreStore, 'getState' | 'subscribe'> {
  /**
   * 把一条 HUD 命令转成 `command.forward` 发给 service。
   * 返回命令 id（可用于对账回执）。
   * 未连接时**不排队、不补发**（协议 §1.2）：命令未发出，如实回报失败。
   */
  emitCommand(command: HudCommand): string;
  /**
   * 把一条**世界事件**转成 `event.forward` 发给 service（@since v3.3，task_156）。
   *
   * 只有**状态语义**事件在白名单内才上行（unit.click / selection.box / unit.move /
   * camera.director）；纯视图事件（camera.moved / replay.beat …）返回 false、**不上行** ——
   * service 不需要相机姿态，别拿视图态污染真相。
   *
   * 返回 true = 已发出；false = 未发出（不在白名单 / 未连接）。
   */
  emitWorldEvent(event: WorldEvent): boolean;
  /** 本地视图是否不可信（未连接 / 已断开 / 状态面未附着）。 */
  isStale(): boolean;
  /** 连接是否已建立（socket 已 open 且 hello 已发出）。 */
  isConnected(): boolean;
  /** 最近一份快照的版本号（从未收到过快照 = null）。 */
  getSeq(): number | null;
  /** 收干净：停重连定时器 + 关连接 + 清在飞命令。幂等。 */
  dispose(): void;
}

/** 构造参数（第二参数；可选项全缺省）。 */
export interface RemoteStoreOptions {
  /** 客户端实例 id（壳重启会换新 id）；缺省自动生成。 */
  readonly clientId?: string;
  /** 连接工厂（单测注入内存替身；缺省 = 浏览器原生 WebSocket）。 */
  readonly createSocket?: (url: string) => RemoteSocket;
  /** 重连退避的起始延迟（ms）。缺省 500。 */
  readonly reconnectDelayMs?: number;
  /** 重连退避的上限（ms）。缺省 10000。 */
  readonly reconnectMaxDelayMs?: number;
  /** 命令回执超时（ms）。缺省 = 协议的 WORLD_SYNC_ACK_TIMEOUT_MS。 */
  readonly ackTimeoutMs?: number;
  /** 命令回执回调（成功 / 失败都走这里 —— 失败必带原因）。 */
  readonly onCommandResult?: (result: RemoteCommandResult) => void;
  /** 日志口（缺省 = console.warn 前缀 [remote-store]）。 */
  readonly logger?: (line: string) => void;
}

/** 默认 world-sync 端点：gateway 的 HTTP server（dev 下 PORT=7524）+ 协议路径。 */
export const DEFAULT_WORLD_SYNC_PORT = 7524;

/** 默认 world-sync 端点地址（与 gateway 同一台机器上的 service）。 */
export const DEFAULT_WORLD_SYNC_URL = `ws://127.0.0.1:${DEFAULT_WORLD_SYNC_PORT}${WORLD_SYNC_PATH}`;

/** 在飞命令（等回执）。 */
interface PendingCommand {
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * 造一个远程 store（连上 → 收快照 → 转命令）。
 *
 * 生命周期：构造即建连；断开自动指数退避重连；`dispose()` 收干净（资源必须可清理）。
 *
 * @param url world-sync 端点地址（如 `ws://127.0.0.1:7524/ws/world-sync`）。
 * @param options 可选项（客户端 id / 连接工厂 / 退避参数 / 回执回调 / 日志口）。
 */
export function createRemoteStore(url: string, options: RemoteStoreOptions = {}): RemoteStore {
  const createSocket = options.createSocket ?? createBrowserSocket;
  const logger = options.logger ?? ((line: string): void => console.warn(`[remote-store] ${line}`));
  const clientId = options.clientId ?? `electron-${randomSuffix()}`;
  const ackTimeoutMs = options.ackTimeoutMs ?? WORLD_SYNC_ACK_TIMEOUT_MS;
  const baseDelay = Math.max(0, options.reconnectDelayMs ?? 500);
  const maxDelay = Math.max(baseDelay, options.reconnectMaxDelayMs ?? 10_000);

  /** 本地投影（最后一份快照；从未收到过 = 空世界初始态）。 */
  let state: WorldState = createInitialState();
  /**
   * 本客户端自己的屏位（null = 主屏；与 core 的 currentScreen 缺省回落一致）。
   * why 不直接用快照里的那份：那份落在 service 的**共享** store 上 —— 别人跳屏会把这个客户端也拽走。
   */
  let localScreen: ScreenId | null = null;
  /** 最近一份快照的版本号。 */
  let seq: number | null = null;
  /** 本地视图是否不可信（true = 不可信）。 */
  let stale = true;
  /** socket 是否已 open（且 hello 已发出）。 */
  let opened = false;
  /** 是否已收干净。 */
  let disposed = false;
  /** 连续重连次数（用于指数退避；收到快照即重置）。 */
  let attempt = 0;
  /** 当前连接。 */
  let socket: RemoteSocket | null = null;
  /** 待触发的重连定时器。 */
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** 命令 id 计数（连接内唯一 → 本 store 内唯一）。 */
  let commandCounter = 0;
  /** 订阅者。 */
  const listeners = new Set<StateListener>();
  /** 在飞命令（等回执）。 */
  const pending = new Map<string, PendingCommand>();

  /** 广播新状态（订阅者拿到的永远是当前这份引用）。 */
  const notify = (): void => {
    for (const listener of Array.from(listeners)) listener(state);
  };

  /** 发一条协议消息（编码失败 / 发送失败一律返回 false —— 不假装发出）。 */
  const send = (message: WorldSyncMessage): boolean => {
    const target = socket;
    if (!target) return false;
    const raw = encodeMessage(message);
    if (raw === null) {
      logger(`消息编码失败（type=${message.type}）—— 已丢弃，不假装发出`);
      return false;
    }
    try {
      target.send(raw);
      return true;
    } catch (error) {
      logger(`发送失败（type=${message.type}）：${describeError(error)}`);
      return false;
    }
  };

  /** 注册：hello（协议版本 + clientId）—— 每次连接（含重连）都必须发一次。 */
  const sendHello = (): void => {
    send({ type: 'hello', protocolVersion: WORLD_SYNC_PROTOCOL_VERSION, clientId });
  };

  /** 全量覆盖：收到 snapshot 就整体替换本地视图（协议 §1.2 —— 不做增量合并）。 */
  const applySnapshot = (message: SnapshotMessage): void => {
    const next = fromWireState(message.state);
    // 屏位取**本地**值（客户端自己的视图状态）；快照里那份是 service 的共享值（会串台）。
    state = { ...next, currentScreen: localScreen ?? undefined };
    seq = message.seq;
    const wasStale = stale;
    stale = false;
    attempt = 0; // 连上了 → 退避重置
    if (wasStale) logger('已连上 service：本地视图恢复为可信');
    notify();
  };

  /** 结算一条命令回执（按 commandId 对账）。 */
  const settleCommand = (ack: CommandAckMessage): void => {
    const entry = pending.get(ack.commandId);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(ack.commandId);
    }
    options.onCommandResult?.({
      commandId: ack.commandId,
      ok: ack.ok,
      seq: ack.seq,
      ...(ack.error ? { error: ack.error } : {}),
    });
  };

  /** 回报一条失败（失败必带原因 —— 铁律 4）。 */
  const reportFailure = (
    commandId: string,
    detail: { readonly code: WorldSyncErrorCode; readonly message: string; readonly stale?: boolean; readonly hint?: string },
  ): void => {
    options.onCommandResult?.({
      commandId,
      ok: false,
      seq: null,
      error: {
        code: detail.code,
        message: detail.message,
        ...(detail.stale === undefined ? {} : { stale: detail.stale }),
        ...(detail.hint === undefined ? {} : { hint: detail.hint }),
      },
    });
  };

  /** 处理一帧来信。 */
  const handleMessage = (data: unknown): void => {
    const text = toText(data);
    if (text === null) {
      logger('收到非文本帧 —— 已忽略');
      return;
    }
    const decoded = decodeMessage(text);
    if (!decoded.ok) {
      logger(`协议解码失败：${decoded.code} ${decoded.message}`);
      return;
    }
    const message = decoded.message;
    switch (message.type) {
      case 'snapshot':
        applySnapshot(message);
        return;
      case 'command.ack':
        settleCommand(message);
        return;
      case 'error':
        logger(`service 报错：${message.code} ${message.message}`);
        // 未附着 = 没有真相 → 标记 stale（绝不把旧快照当真相，也不返回空态）。
        if (message.code === 'not_attached') stale = true;
        return;
      default:
        // hello / command.forward / event.forward 都是**客户端 → service**方向的消息型，
        //   service 发过来 = 方向搞反 → 忽略。
        logger(`收到方向非法的消息（type=${message.type}）—— 已忽略`);
    }
  };

  /** 连接断开：标记 stale + 保留最后快照 + 在飞命令如实报失败 + 排重连。 */
  const handleClosed = (): void => {
    opened = false;
    socket = null;
    if (!stale) logger('连接断开：本地视图标记为 stale（保留最后一份快照）');
    stale = true;
    // 在飞命令结果未知：如实报失败，**不补发**（协议 §1.2 —— 可能已落地）。
    for (const [commandId, entry] of Array.from(pending.entries())) {
      clearTimeout(entry.timer);
      reportFailure(commandId, {
        code: 'internal_error',
        message: '连接断开：命令结果未知',
        hint: '不要重发同一条命令（可能已落地）；真相以后续 snapshot 为准',
      });
    }
    pending.clear();
    // 断连就重连 —— 连都没连上（握手失败）也一样要重试，否则永远停在「未连接」。
    scheduleReconnect();
  };

  /** 排一次指数退避重连。 */
  const scheduleReconnect = (): void => {
    if (disposed) return;
    if (retryTimer !== null) return;
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    attempt += 1;
    logger(`将在 ${delay}ms 后重连（第 ${attempt} 次尝试）`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
    unrefTimer(retryTimer);
  };

  /** 建连。 */
  const connect = (): void => {
    if (disposed) return;
    let next: RemoteSocket;
    try {
      next = createSocket(url);
    } catch (error) {
      logger(`建连失败：${describeError(error)}`);
      scheduleReconnect();
      return;
    }
    socket = next;
    next.onopen = () => {
      opened = true;
      sendHello();
    };
    next.onmessage = (event) => handleMessage(event?.data);
    next.onclose = () => handleClosed();
    next.onerror = () => {
      logger('连接出错（等 close 事件后按退避重连）');
    };
  };

  /**
   * 本端屏位生效（客户端自己的视图状态）。
   * why 与 core 同口径：'main' / 'chat' 不写屏位字段（读侧回落主屏；聊天抽屉由 DOM 事件自治）。
   */
  const applyLocalScreen = (screen: ScreenId): void => {
    localScreen = screen === 'main' || screen === 'chat' ? null : screen;
    state = { ...state, currentScreen: localScreen ?? undefined };
    notify();
  };

  /** 命令面：转 `command.forward` 发给 service。 */
  const emitCommand = (command: HudCommand): string => {
    // 屏位是本端视图状态：先本地生效（不等回执往返，UI 不被网络往返卡住），再照旧转发。
    if (command.type === 'ui.navigate') applyLocalScreen(command.screen);
    commandCounter += 1;
    const commandId = `cmd-${commandCounter}`;
    if (!opened || !socket) {
      // 未连接：不排队、不补发（协议 §1.2）—— 命令没出去，如实报失败。
      reportFailure(commandId, {
        code: 'internal_error',
        message: '未连接到 service：命令未发出',
        stale: true,
        hint: '等连接恢复后重新发起这条命令',
      });
      return commandId;
    }
    if (!send({ type: 'command.forward', commandId, command })) {
      reportFailure(commandId, {
        code: 'internal_error',
        message: '命令发送失败',
        stale: true,
        hint: '等连接恢复后重新发起这条命令',
      });
      return commandId;
    }
    const timer = setTimeout(() => {
      pending.delete(commandId);
      // 超时不是成功：结果未知，如实报失败（铁律 4）。
      reportFailure(commandId, {
        code: 'internal_error',
        message: `命令回执超时（${ackTimeoutMs}ms）：结果未知`,
        hint: '不要重发同一条命令（可能已落地）；真相以后续 snapshot 为准',
      });
    }, ackTimeoutMs);
    unrefTimer(timer);
    pending.set(commandId, { timer });
    return commandId;
  };

  /**
   * 事件面（@since v3.3，task_156）：转 `event.forward` 发给 service。
   *
   * 白名单外的纯视图事件（camera.moved / replay.beat …）**不上行** —— 不刷日志（camera.moved
   * 每 120ms 一条，刷屏没意义），返回 false 即「没上行」。
   */
  const emitWorldEvent = (event: WorldEvent): boolean => {
    const message = createEventForwardMessage(event);
    if (!message) return false; // 不在白名单 —— 纯视图事件，本机表现而已
    if (!opened || !socket) {
      logger(`未连接到 service：世界事件未发出（type=${event.type}）`);
      return false;
    }
    return send(message);
  };

  const store: RemoteStore = {
    getState: () => state,
    subscribe: (listener: StateListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emitCommand,
    emitWorldEvent,
    isStale: () => stale,
    isConnected: () => opened,
    getSeq: () => seq,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
      const current = socket;
      socket = null;
      opened = false;
      try {
        current?.close();
      } catch {
        // 关闭失败无所谓：连接已不可用。
      }
      listeners.clear();
    },
  };

  connect();
  return store;
}

/** 默认连接工厂：浏览器原生 WebSocket（Node ≥ 22 也有同名全局）。 */
function createBrowserSocket(url: string): RemoteSocket {
  const ctor = (globalThis as { WebSocket?: new (target: string) => unknown }).WebSocket;
  if (!ctor) {
    throw new Error('当前环境没有 WebSocket 实现（远程模式需要浏览器或 Node ≥ 22）');
  }
  return new ctor(url) as RemoteSocket;
}

/** 帧载荷 → 文本（字符串直取；字节流解码；其余一律 null）。 */
function toText(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) {
    try {
      return new TextDecoder('utf-8').decode(data);
    } catch {
      return null;
    }
  }
  return null;
}

/** 定时器不吊住进程（Node 侧有 unref；浏览器侧没有 → 跳过）。 */
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const candidate = timer as unknown as { unref?: () => void };
  candidate.unref?.();
}

/** 客户端实例 id 的随机后缀（壳重启换新 id —— service 侧用作连接日志归属）。 */
function randomSuffix(): string {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

/** 错误 → 一句话。 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
