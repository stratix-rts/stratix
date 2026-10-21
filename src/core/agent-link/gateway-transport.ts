/**
 * 文件职责：transport 端口的**真实实现** —— 用 stratix-gateway 既有的 OpenClaw 路由
 *   （/connect、/ws-connect、/disconnect、/test + /proxy/{key}/ws）跑真实会话。
 *   与协议层分工：protocol.ts 定义形状，本文件负责发请求、解析信封、管超时与退订。
 * 输入：端点 / 账号 / 凭据；全局 fetch 与 WebSocket（Node 22+ 与浏览器都是全局，**不引新依赖**）。
 * 输出：AgentLinkControlPlane 与 AgentLinkChannel 的实现。
 * 禁止事项：
 *   1. 改动网关路由与鉴权约定 —— 这里只做既有协议的客户端，不做协议扩展；
 *   2. 留下定时器 / 监听器 —— 每个超时都 Abort，每个 socket 都留退订出口；
 *   3. 吞掉控制面失败 —— connect 失败必须抛出（否则会话会假装连上了）；disconnect 例外（尽力而为）；
 *   4. 缓存凭据 —— apiKey 只在当次请求里用，不进任何字段、不进日志。
 *
 * 鉴权说明：REST 走 body 里的 apiKey；WS 通道在 Node 侧用 headers 透传（网关按 clientId 定位代理，
 * 浏览器侧无法设置 WS 头，鉴权由 /ws-connect 的真实握手承担 —— 与现网浏览器适配器同一策略）。
 */

import {
  buildWsUrl,
  CONNECT_TIMEOUT_MS,
  GATEWAY_API_BASE,
  isGatewayOk,
  proxyKeyOf,
  REQUEST_TIMEOUT_MS,
  type GatewayConnectData,
  type GatewayDisconnectData,
  type GatewayEnvelope,
  type GatewayTestData,
} from './protocol';
import {
  CHANNEL_CLOSE,
  type AgentLinkChannel,
  type AgentLinkChannelFactory,
  type AgentLinkConnectParams,
  type AgentLinkConnectResult,
  type AgentLinkControlPlane,
  type AgentLinkTransport,
} from './transport';

export interface HttpControlPlaneOptions {
  /** 网关基址；同源部署留空（如 'http://127.0.0.1:3010'）。 */
  readonly baseUrl?: string;
  /** 注入 fetch 便于单测 / 复用既有实例；缺省用全局 fetch。 */
  readonly fetchImpl?: typeof fetch;
  /** 控制面请求超时（ms）。 */
  readonly timeoutMs?: number;
}

interface EnvelopeResult<T> {
  readonly envelope: GatewayEnvelope<T> | null;
  /** HTTP 层错误（非 2xx 或网络异常）时的说明；信封能解析出来则为 null。 */
  readonly transportError: string | null;
}

/** 建 REST 信封请求：带超时与 JSON 解析，HTTP 非 2xx 也照常解析信封（网关的错误分支返回 code=4xx/5xx）。 */
async function requestJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<EnvelopeResult<T>> {
  const controller = new AbortController();
  // Abort 与 clearTimeout 必须成对：漏 clear 会让每次请求都留一个悬挂定时器（perf：资源必须可清理）
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await response.text();
    try {
      return { envelope: JSON.parse(text) as GatewayEnvelope<T>, transportError: null };
    } catch {
      return { envelope: null, transportError: response.ok ? `malformed envelope: ${text.slice(0, 120)}` : `HTTP ${response.status}` };
    }
  } catch (error) {
    return { envelope: null, transportError: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * REST 控制面实现。
 * connect 的两步语义照抄现网：/connect 登记代理（拿 proxyKey 与 WS 地址）、/ws-connect 真实握手（拿 deviceId）。
 * /ws-connect 返回 404 = 网关未实现该端点（旧网关兼容）：不阻断建链，deviceId 留空。
 */
export function createHttpControlPlane(options: HttpControlPlaneOptions = {}): AgentLinkControlPlane {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('agent-link: no fetch implementation available (Node 18+ or browser required)');
  }
  const base = (options.baseUrl ?? '').replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? CONNECT_TIMEOUT_MS;
  const api = (path: string): string => `${base}${GATEWAY_API_BASE}${path}`;

  const controlPlane: AgentLinkControlPlane = {
    async connect(params: AgentLinkConnectParams): Promise<AgentLinkConnectResult> {
      const { envelope, transportError } = await requestJson<GatewayConnectData>(
        fetchImpl,
        api('/connect'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: params.endpoint, apiKey: params.apiKey }),
        },
        timeoutMs
      );
      if (transportError) throw new Error(`gateway /connect failed: ${transportError}`);
      if (!envelope || !isGatewayOk(envelope)) {
        throw new Error(`gateway /connect rejected: ${envelope?.message ?? 'no response body'}`);
      }

      let deviceId: string | null = envelope.data?.deviceId ?? null;
      const handshake = await requestJson<GatewayConnectData>(
        fetchImpl,
        api('/ws-connect'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: params.endpoint,
            accountId: params.accountId ?? 'stratix',
            apiKey: params.apiKey,
          }),
        },
        timeoutMs
      );
      // 404 = 网关没有 /ws-connect（代理已登记，握手由代理侧兜底）→ 兼容放行，不阻断建链
      if (handshake.envelope && !isGatewayOk(handshake.envelope) && handshake.envelope.code !== 404) {
        throw new Error(`gateway /ws-connect rejected: ${handshake.envelope.message}`);
      }
      if (handshake.envelope && isGatewayOk(handshake.envelope)) {
        deviceId = handshake.envelope.data?.deviceId ?? deviceId;
      }

      return {
        connected: true,
        // proxyKey 缺失时本地按同一算法兜底（与现网 computeProxyKey 同构）
        proxyKey: envelope.data?.proxyKey ?? proxyKeyOf(params.endpoint),
        deviceId,
      };
    },

    async disconnect(endpoint: string): Promise<void> {
      // 尽力而为：网关不可达时本地关闭流程照常完成（对齐现网 disconnect 的 try/catch 语义）
      await requestJson<GatewayDisconnectData>(
        fetchImpl,
        api('/disconnect'),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) },
        timeoutMs
      );
    },

    async test(endpoint: string, apiKey?: string): Promise<{ ok: boolean; detail: string | null }> {
      const query = new URLSearchParams({ endpoint });
      if (apiKey) query.set('apiKey', apiKey);
      const { envelope, transportError } = await requestJson<GatewayTestData>(
        fetchImpl,
        `${api('/test')}?${query.toString()}`,
        { method: 'GET' },
        timeoutMs
      );
      if (transportError) return { ok: false, detail: transportError };
      if (!envelope) return { ok: false, detail: 'no response body' };
      return { ok: isGatewayOk(envelope), detail: envelope.message || null };
    },
  };

  return controlPlane;
}

interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
}

type WebSocketCtor = new (url: string, protocolsOrOptions?: unknown) => WebSocketLike;

export interface WsChannelFactoryOptions {
  /** 网关基址；与控制面同源时留空。WS 地址 = baseUrl 的 ws 形式 + /api/stratix/openclaw/proxy/{key}/ws。 */
  readonly baseUrl?: string;
  /** 注入 WebSocket 实现（测试用；缺省全局）。Node 22+ 与浏览器都有全局 WebSocket。 */
  readonly WebSocketImpl?: WebSocketCtor;
  /** 是否是 Node 环境（决定能否带 headers 建连；浏览器 WebSocket 不支持自定义头）。 */
  readonly isNode?: boolean;
  readonly requestTimeoutMs?: number;
}

/**
 * WS 通道工厂。
 * 建连超时内没有 open 事件即视为失败并主动关闭 —— 否则半死不活的 socket 会挂着直到进程退出。
 * 关闭后所有订阅者立即收到 onClose（上层据此归因并决定是否退避重连）。
 */
export function createWebSocketChannelFactory(options: WsChannelFactoryOptions = {}): AgentLinkChannelFactory {
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  return async function openChannel(channelOptions: {
    endpoint: string;
    accountId?: string;
    apiKey?: string;
    agentId?: string | null;
    timeoutMs: number;
  }): Promise<AgentLinkChannel> {
    const ctor = (options.WebSocketImpl ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket) as
      | WebSocketCtor
      | undefined;
    if (typeof ctor !== 'function') {
      throw new Error('agent-link: no WebSocket implementation available (Node 22+ or browser required)');
    }
    const isNode = options.isNode ?? (typeof process !== 'undefined' && typeof process.versions?.node === 'string');
    const url = buildWsUrl(options.baseUrl ?? '', channelOptions.endpoint, channelOptions.accountId ?? 'stratix');
    const headers: Record<string, string> = {};
    if (channelOptions.apiKey) headers.Authorization = `Bearer ${channelOptions.apiKey}`;
    // 网关按此头把请求转给指定 agent（出处：OpenClaw 代理的 x-openclaw-agent-id）
    if (channelOptions.agentId) headers['x-openclaw-agent-id'] = channelOptions.agentId;

    return new Promise<AgentLinkChannel>((resolve, reject) => {
      let settled = false;
      let socket: WebSocketLike | null = null;
      const messageHandlers = new Set<(raw: string) => void>();
      const closeHandlers = new Set<(info: { code: number; reason: string }) => void>();
      const timeoutMs = Math.min(channelOptions.timeoutMs, requestTimeoutMs);

      const settleFail = (message: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket?.close(CHANNEL_CLOSE.internal, message.slice(0, 100));
        } catch {
          /* 尚未 open 的 socket 关闭可能抛错，忽略 */
        }
        reject(new Error(message));
      };

      const notifyClose = (code: number, reason: string): void => {
        closeHandlers.forEach((handler) => handler({ code, reason }));
        closeHandlers.clear();
        messageHandlers.clear();
      };

      const timer = setTimeout(() => settleFail(`websocket open timeout after ${timeoutMs}ms`), timeoutMs);

      try {
        socket = isNode ? new ctor(url, { headers }) : new ctor(url);
      } catch (error) {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      socket.onopen = (): void => {
        if (settled || !socket) return;
        settled = true;
        clearTimeout(timer);
        const live = socket;
        resolve({
          send: (raw: string): void => {
            live.send(raw);
          },
          close: (code?: number, reason?: string): void => {
            live.close(code ?? CHANNEL_CLOSE.normal, reason ?? '');
            // 浏览器 socket.close 是异步的：本地立刻通知，保证上层状态机不依赖对端时序
            notifyClose(code ?? CHANNEL_CLOSE.normal, reason ?? '');
          },
          onMessage: (handler): (() => void) => {
            messageHandlers.add(handler);
            return () => messageHandlers.delete(handler);
          },
          onClose: (handler): (() => void) => {
            closeHandlers.add(handler);
            return () => closeHandlers.delete(handler);
          },
        });
      };

      socket.onmessage = (event): void => {
        const data = event.data;
        if (typeof data === 'string') {
          messageHandlers.forEach((handler) => handler(data));
        }
        // 非字符串（二进制）帧：agent-link 只消费 JSON 文本帧，直接忽略
      };

      socket.onerror = (): void => {
        settleFail(`websocket error while connecting to ${url}`);
      };

      socket.onclose = (event): void => {
        const code = event.code ?? CHANNEL_CLOSE.internal;
        const reason = event.reason ?? '';
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`websocket closed before open (code=${code}${reason ? `, reason=${reason}` : ''})`));
          return;
        }
        notifyClose(code, reason);
      };
    });
  };
}

/** 真实 transport 组装：REST 控制面 + WS 通道。 */
export function createGatewayTransport(
  options: HttpControlPlaneOptions & WsChannelFactoryOptions = {}
): AgentLinkTransport {
  return {
    controlPlane: createHttpControlPlane(options),
    openChannel: createWebSocketChannelFactory(options),
  };
}