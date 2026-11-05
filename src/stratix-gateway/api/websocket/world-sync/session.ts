/**
 * 文件职责：world-sync 的**单连接会话**（前后端分离 B2 / task_082）——
 *   一条客户端连接 = 一个会话：解析来信、按协议分派、回消息。
 * 输入：客户端发来的 UTF-8 JSON 文本（hello / command.forward / event.forward）。
 * 输出：发给**本连接**的 snapshot / command.ack / error（点对点；广播是端点的职责）。
 * 禁止事项：
 *   1. 在会话里改 store —— 写只能经 command.forward / event.forward → core 裁决（铁律 2「裁决在 core」）；
 *   2. 在会话里发 seq —— 发号是端点的单一职责（全 service 统一发号，协议 §3）；
 *   3. 在会话里广播 —— 广播属端点（会话只管自己这一条连接）；
 *   4. 把信封级错误当命令失败 —— 信封级错误走 error，业务级失败走 command.ack{ok:false}（协议 §2.1）。
 *
 * @since v3.3（task_156）：新增 `event.forward` 的受理 —— 画布交互的世界事件从客户端
 *   上行到 service 的 core 总线（此前只有 hello / command.forward 两种客户端消息型，
 *   远程模式下画布交互进了本地总线却零消费者 → 静默丢弃 → 画布全哑）。
 *
 * 依赖方向：会话只认识 `WorldSyncEndpointPort`（窄接口）+ protocol.ts 的纯函数。
 *   why 不直接依赖端点实现：端点要 import 会话，会话再 import 端点 = 循环依赖。
 *
 * 配套契约：docs/WORLD-SYNC.md（消息表 / 方向语义 / 重连语义）｜protocol.ts（B1 契约层）
 */

import type { HudCommand } from '@/core/types';

import {
  WORLD_SYNC_MIN_PROTOCOL_VERSION,
  WORLD_SYNC_PROTOCOL_VERSION,
  createErrorMessage,
  decodeMessage,
  decodeMessageBytes,
  encodeMessage,
  isSupportedProtocolVersion,
  type CommandAckMessage,
  type EventForwardMessage,
  type ForwardableWorldEvent,
  type HelloMessage,
  type SnapshotMessage,
  type WorldSyncDecodeResult,
  type WorldSyncErrorCode,
  type WorldSyncMessage,
} from './protocol';

// ============================================================================
// 传输端口（socket 窄接口 —— 单测可注入内存 duplex socket，不起真端口）
// ============================================================================

/**
 * 一条 WS 连接所需的最小面。
 *
 * why 不直接用 `ws` 的 WebSocket 类型：协议层要在**不起真端口**的前提下被单测覆盖
 * （内存 duplex socket 注入）。这里声明窄接口，生产侧传 `ws` 的 WebSocket，
 * 单测侧传内存替身 —— 两边共用同一份会话逻辑。
 *
 * 事件口径与 `ws` 一致：'message'（载荷是字节/文本）、'close'、'error'、'pong'。
 */
export interface WorldSyncSocket {
  /** 连接状态（1 = OPEN）。缺省视为 OPEN。 */
  readonly readyState?: number;
  /** 发一帧文本。 */
  send(data: string): void;
  /** 优雅关闭。 */
  close(code?: number, reason?: string): void;
  /** 强制断开（踢死链用）。 */
  terminate?(): void;
  /** 心跳 ping。 */
  ping?(): void;
  /** 订阅事件。 */
  on(event: string, listener: (...args: any[]) => void): void;
}

/** 端点端口（会话 → 端点的窄接口；实现见 endpoint.ts）。 */
export interface WorldSyncEndpointPort {
  /** 状态面是否附着（未附着 = service 没接上 core store）。 */
  readonly attached: boolean;
  /** 发一份新的全量 snapshot（统一发号）—— 供 hello 应答。 */
  issueSnapshot(): SnapshotMessage | null;
  /** 命令面：投递 + 回读核对落点 → 回执（绝不假装成功，铁律 4）。 */
  dispatchCommand(commandId: string, command: HudCommand): Promise<CommandAckMessage>;
  /**
   * 事件面（@since v3.3，task_156）：把客户端上行的世界事件投到 **service 的 core 总线**。
   * 无回执（fire-and-forget）：快照是最终一致口径 —— 客户端看结果读下一份 snapshot。
   */
  dispatchWorldEvent(event: ForwardableWorldEvent): void;
  /** 会话结束（连接关闭）→ 端点清理该会话。 */
  releaseSession(session: WorldSyncSession): void;
}

/** 会话构造参数。 */
export interface WorldSyncSessionOptions {
  /** 底层连接。 */
  readonly socket: WorldSyncSocket;
  /** 端点端口。 */
  readonly endpoint: WorldSyncEndpointPort;
  /** 日志口（可选）。 */
  readonly logger?: (line: string) => void;
}

/** WS 就绪态（OPEN）。ws 的常量是 1。 */
const WS_OPEN = 1;

/**
 * 一条客户端连接 = 一个会话。
 *
 * 生命周期：accept → （hello）→ 命令若干 → close。
 * 未发 hello 的连接**不算注册**（协议 §2.1：每次连接都必须发 hello）——
 * 此时来的命令一律拒（并如实回 error），不静默丢弃。
 */
export class WorldSyncSession {
  /** 底层连接（端点负责事件接线与清理）。 */
  readonly socket: WorldSyncSocket;

  /** 端点端口。 */
  private readonly endpoint: WorldSyncEndpointPort;

  /** 日志口。 */
  private readonly logger: (line: string) => void;

  /** 客户端自报的实例 id（hello 之后才有）。 */
  clientId: string | null = null;

  /** 是否已 hello 注册。 */
  registered = false;

  /** 是否已关闭（关闭后不再发任何消息）。 */
  closed = false;

  constructor(options: WorldSyncSessionOptions) {
    this.socket = options.socket;
    this.endpoint = options.endpoint;
    this.logger = options.logger ?? ((): void => {});
  }

  /** 发一条协议消息给本连接（编码失败 = 内部 bug，如实记日志，不炸传输层）。 */
  send(message: WorldSyncMessage): void {
    if (this.closed) return;
    if (this.socket.readyState !== undefined && this.socket.readyState !== WS_OPEN) return;
    const raw = encodeSafely(message);
    if (raw === null) {
      this.logger(`[world-sync] 消息编码失败（type=${message.type}）—— 已丢弃，不假装发出`);
      return;
    }
    try {
      this.socket.send(raw);
    } catch (error) {
      this.logger(`[world-sync] 发送失败（type=${message.type}）：${describeError(error)}`);
    }
  }

  /** 处理一帧来信（字节流或文本）。 */
  async handleMessage(data: unknown): Promise<void> {
    if (this.closed) return;
    try {
      await this.dispatchMessage(data);
    } catch (error) {
      // 会话层不炸传输层：如实报一条 error，连接继续活着。
      this.sendError('internal_error', `消息处理失败：${describeError(error)}`);
    }
  }

  /** 关闭会话（幂等）。 */
  close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.close(code, reason);
    } catch {
      // 关闭失败无所谓：连接已不可用。
    }
  }

  // -------------------------------------------------------------------------
  // 私有
  // -------------------------------------------------------------------------

  /** 按协议分派一帧。 */
  private async dispatchMessage(data: unknown): Promise<void> {
    const decoded = this.decode(data);
    if (!decoded.ok) {
      // 信封级错误 → error（不是命令失败）；能认出 commandId 就带上（便于客户端对账）。
      this.sendError(decoded.code, decoded.message, this.extractCommandId(data));
      return;
    }
    const message = decoded.message;
    switch (message.type) {
      case 'hello':
        this.handleHello(message);
        return;
      case 'command.forward':
        await this.handleCommandForward(message);
        return;
      case 'event.forward':
        this.handleEventForward(message);
        return;
      default:
        // snapshot / command.ack / error 都是 service → 客户端方向；客户端发它们 = 方向搞反了。
        this.sendError(
          'malformed_message',
          `客户端不得发送 ${message.type}（该消息型是 service → 客户端方向）`
        );
    }
  }

  /** hello：版本裁决 → 注册 → 立即回一份全量 snapshot（重连亦然，不做增量合并）。 */
  private handleHello(message: HelloMessage): void {
    if (!isSupportedProtocolVersion(message.protocolVersion)) {
      // 版本不兼容 → 回 error 并断开（不降级、不假装能通，协议 §7.3）。
      this.sendError(
        'unsupported_version',
        `协议版本 ${message.protocolVersion} 不受支持（支持 ${WORLD_SYNC_MIN_PROTOCOL_VERSION}–${WORLD_SYNC_PROTOCOL_VERSION}）`
      );
      this.close(1002, 'unsupported protocol version');
      return;
    }
    this.clientId = message.clientId;
    this.registered = true;
    const snapshot = this.endpoint.issueSnapshot();
    if (!snapshot) {
      // 未附着 ≠ 战场为空：如实报不可用，**不**改发一份空 snapshot 装作正常（协议 §1.3）。
      this.sendError('not_attached', '状态面未附着：service 未接上 core store');
      return;
    }
    this.send(snapshot);
  }

  /** command.forward：转交端点 → 端点回读核对落点 → 回 command.ack（点对点）。 */
  private async handleCommandForward(message: {
    readonly commandId: string;
    readonly command: HudCommand;
  }): Promise<void> {
    if (!this.registered) {
      // 未注册的连接不认它的写（协议 §2.1：每次连接必须先 hello）。
      this.sendError('malformed_message', '请先发送 hello 完成注册再发命令', message.commandId);
      return;
    }
    const ack = await this.endpoint.dispatchCommand(message.commandId, message.command);
    this.send(ack);
  }

  /**
   * event.forward（@since v3.3，task_156）：转交端点 → 投到 service 的 core 总线。
   *
   * 无回执（fire-and-forget）：世界事件没有「落点 id」可回读，快照是最终一致口径 ——
   *   客户端想看结果就读下一份 snapshot（选中环 / 面板据此更新）。
   * 载荷形状已在 protocol 层挡过（isForwardableWorldEvent）—— 白名单外的事件根本解不开，
   *   走到这里的一定是「类型在册 + 形状对得上」的那几条。
   */
  private handleEventForward(message: EventForwardMessage): void {
    if (!this.registered) {
      // 未注册的连接不认它的写（同 command.forward 的纪律：先 hello 再写）。
      this.sendError('malformed_message', '请先发送 hello 完成注册再发事件');
      return;
    }
    this.endpoint.dispatchWorldEvent(message.event);
  }

  /** 解码一帧（失败不抛，用返回值判别 —— 协议层口径）。 */
  private decode(data: unknown): WorldSyncDecodeResult {
    if (typeof data === 'string') return decodeMessage(data);
    if (data instanceof Uint8Array) return decodeMessageBytes(data);
    return { ok: false, code: 'malformed_message', message: '收到非文本帧' };
  }

  /** 发一条协议错误信封。 */
  private sendError(code: WorldSyncErrorCode, message: string, commandId?: string): void {
    this.send(createErrorMessage(code, message, commandId));
  }

  /**
   * 尽力从坏帧里捞出 commandId（让客户端能把错误对账到具体命令）。
   * 捞不到就算了 —— 不为「好看」去猜。
   */
  private extractCommandId(data: unknown): string | undefined {
    try {
      const text =
        typeof data === 'string'
          ? data
          : data instanceof Uint8Array
            ? new TextDecoder('utf-8').decode(data)
            : null;
      if (text === null) return undefined;
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) {
        const id = (parsed as { commandId?: unknown }).commandId;
        if (typeof id === 'string' && id.length > 0) return id;
      }
    } catch {
      // 解析不了就算了。
    }
    return undefined;
  }
}

/** 编码（失败返回 null，不抛）。 */
function encodeSafely(message: WorldSyncMessage): string | null {
  try {
    return encodeMessage(message);
  } catch {
    return null;
  }
}

/** 错误 → 一句话。 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
