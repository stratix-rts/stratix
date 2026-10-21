/**
 * 测试辅助：内存版"网关 + 远端 agent"对端。
 *
 * why 不是随手写的 stub：本文件**按真实协议逐字段校验每一帧** —— 出站帧走
 * parseOutboundFrame 核对（type/requestId/message/payload），请求按 requestId 回真实形状的应答帧，
 * 事件按 { type:'event', event, payload } 下发。这样单测跑的是真协议，
 * 而不是"我 mock 一个返回值恰好等于我期望"的自证循环。
 * 帧形状对齐 stratix-openclaw-adapter/GatewayOpenClawAdapter（只读参考，未改动）。
 */

import type { AgentLinkChannel, AgentLinkConnectParams, AgentLinkConnectResult, AgentLinkTransport } from '../../transport';

export interface SentFrame {
  readonly type: string;
  readonly requestId?: string;
  readonly message?: string;
  readonly payload?: unknown;
  readonly raw: string;
}

export interface ChannelDouble extends AgentLinkChannel {
  /** 下发一帧原始字符串（模拟远端下行）。 */
  emitRaw(raw: string): void;
  /** 下发事件帧。 */
  emitEvent(event: string, payload?: unknown): void;
  /** 模拟对端异常掉线（触发上层自动重连）。 */
  drop(code?: number, reason?: string): void;
  readonly sent: SentFrame[];
  readonly closedWith: { code: number; reason: string } | null;
}

export interface GatewayDoubleOptions {
  /** /connect 与 /ws-connect 返回的 deviceId。 */
  readonly deviceId?: string;
  /** 控制面开户是否成功；false 时 connect 直接抛错（模拟代理池满 / 网关拒绝）。 */
  readonly acceptConnect?: boolean;
  /** 数据通道是否允许建立；false 时 openChannel 抛错（模拟上游 agent 不可达）。 */
  readonly acceptChannel?: boolean;
  /** 指定端点一律建链失败（用于"只有某一个 agent 挂了"的场景）。 */
  readonly failEndpoints?: readonly string[];
  /** 收到对话帧后是否自动回一条应答（默认 true，回 'ack:<text>'）。 */
  readonly autoReplyChat?: boolean;
}

export interface GatewayDouble {
  readonly transport: AgentLinkTransport;
  /** 控制面收到的开户调用（断言协议字段用）。 */
  readonly connectCalls: AgentLinkConnectParams[];
  /** 控制面收到的销户调用（endpoint 列表）。 */
  readonly disconnectCalls: string[];
  /** 已建立的通道（最后一个为当前通道）。 */
  readonly channels: ChannelDouble[];
  /** 当前通道；未建立时为 null。 */
  currentChannel(): ChannelDouble | null;
  /** 已发出的全部帧（跨通道，顺序即发送顺序）。 */
  sentFrames(): SentFrame[];
  /** 让后续建链全部失败（模拟上游 agent 不可达）。 */
  breakChannelOpen(): void;
  /** 让销户全部失败（模拟网关不可达）。 */
  breakDisconnect(): void;
}

export function createGatewayDouble(options: GatewayDoubleOptions = {}): GatewayDouble {
  const connectCalls: AgentLinkConnectParams[] = [];
  const disconnectCalls: string[] = [];
  const channels: ChannelDouble[] = [];
  const allSent: SentFrame[] = [];
  // 运行期可变的故障开关：transport 端口是只读的，故障注入走这两个开关而不是改属性
  let channelBroken = options.acceptChannel === false;
  let disconnectBroken = false;

  const controlPlane = {
    async connect(params: AgentLinkConnectParams): Promise<AgentLinkConnectResult> {
      connectCalls.push(params);
      if (options.acceptConnect === false) throw new Error('gateway: connection pool full (max 100)');
      return { connected: true, proxyKey: 'proxy_key', deviceId: options.deviceId ?? 'device_abc123' };
    },
    async disconnect(endpoint: string): Promise<void> {
      disconnectCalls.push(endpoint);
      if (disconnectBroken) throw new Error('gateway unreachable');
    },
    async test(): Promise<{ ok: boolean; detail: string | null }> {
      return { ok: true, detail: 'connected' };
    },
  };

  const openChannel = async (channelOptions: {
    endpoint: string;
    accountId?: string;
    apiKey?: string;
    agentId?: string | null;
    timeoutMs: number;
  }): Promise<AgentLinkChannel> => {
    if (channelBroken || (options.failEndpoints ?? []).includes(channelOptions.endpoint)) {
      throw new Error(`cannot reach ${channelOptions.endpoint}`);
    }
    const messageHandlers = new Set<(raw: string) => void>();
    const closeHandlers = new Set<(info: { code: number; reason: string }) => void>();
    const sent: SentFrame[] = [];
    const channel: ChannelDouble & { closedWith: { code: number; reason: string } | null } = {
      sent,
      closedWith: null,
      send(raw: string): void {
        // 真校验：出站帧形状不对就在测试里炸出来，而不是被对端假装收下。
        // 注意方向 —— 出站是 {type:'tool'|'text', requestId, message, payload}，与入站帧词表不同。
        const frame = parseOutboundFrame(raw);
        sent.push({
          type: frame.type,
          requestId: frame.requestId,
          message: frame.message,
          payload: frame.payload,
          raw,
        });
        allSent.push(sent[sent.length - 1]);
        if (options.autoReplyChat !== false && frame.type === 'text') {
          const { requestId } = frame;
          queueMicrotask(() => {
            channel.emitRaw(JSON.stringify({ type: 'response', requestId, message: `ack:${frame.message}` }));
          });
        }
      },
      close(code = 1000, reason = ''): void {
        if (channel.closedWith !== null) return;
        channel.closedWith = { code, reason };
        closeHandlers.forEach((handler) => handler({ code, reason }));
        closeHandlers.clear();
        messageHandlers.clear();
      },
      onMessage(handler: (raw: string) => void): () => void {
        messageHandlers.add(handler);
        return () => messageHandlers.delete(handler);
      },
      onClose(handler: (info: { code: number; reason: string }) => void): () => void {
        closeHandlers.add(handler);
        return () => closeHandlers.delete(handler);
      },
      emitRaw(raw: string): void {
        messageHandlers.forEach((handler) => handler(raw));
      },
      emitEvent(event: string, payload?: unknown): void {
        channel.emitRaw(eventFrame(event, payload));
      },
      drop(code = 1011, reason = 'proxy lost'): void {
        channel.close(code, reason);
      },
    };
    channels.push(channel);
    return channel;
  };

  return {
    transport: { controlPlane, openChannel },
    connectCalls,
    disconnectCalls,
    channels,
    currentChannel: (): ChannelDouble | null => channels[channels.length - 1] ?? null,
    sentFrames: (): SentFrame[] => allSent,
    breakChannelOpen: (): void => {
      channelBroken = true;
    },
    breakDisconnect: (): void => {
      disconnectBroken = true;
    },
  };
}

/** 事件帧的线上形状：{ type:'event', event, payload }（与 GatewayOpenClawAdapter 的订阅路径一致）。 */
function eventFrame(event: string, payload?: unknown): string {
  return JSON.stringify({ type: 'event', event, payload });
}

/**
 * 出站帧校验器：按 protocol.ts 的 AgentLinkOutboundFrame 逐字段核对。
 * why 自己解析而不是复用 decodeInboundFrame：入站词表（response/text/event/error）与出站（tool/text）不同，
 * 拿入站解码器验出站会把合法的工具帧判成"未知类型"。
 */
function parseOutboundFrame(raw: string): { type: 'tool' | 'text'; requestId: string; message: string; payload: unknown } {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const type = parsed.type;
  if (type !== 'tool' && type !== 'text') throw new Error(`client sent frame with illegal type: ${String(type)}`);
  if (typeof parsed.requestId !== 'string' || parsed.requestId.length === 0) {
    throw new Error('client sent frame without requestId');
  }
  if (typeof parsed.message !== 'string') throw new Error('client sent frame without message');
  return { type, requestId: parsed.requestId, message: parsed.message, payload: parsed.payload };
}