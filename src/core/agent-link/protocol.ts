/**
 * 文件职责：外部 agent 连接所依赖的**网关协议编解码** —— core/agent-link 与 stratix-gateway
 *   之间唯一的形状定义（REST 信封 + WS 帧）。本文件只做"类型 ↔ 线上 JSON"的翻译，不碰连接与状态。
 * 协议来源（只读参考，本任务不改那两个模块）：
 *   - src/stratix-gateway/api/routes/openclaw.ts   （REST：/connect /disconnect /ws-connect /test）
 *   - src/stratix-core/utils/StratixRequestHelper.ts（统一响应信封 { code, message, data, requestId }）
 *   - src/stratix-openclaw-adapter/GatewayOpenClawAdapter.ts（WS 帧收发与 requestId 关联）
 * 输入：AgentLinkOutboundFrame（本地构造）、原始字符串（远端下发）。
 * 输出：AgentLinkInbound（已归一的入站帧）、encodeOutboundFrame / buildWsUrl / proxyKeyOf 等纯函数。
 * 禁止事项：
 *   1. 发起任何 IO —— IO 归 transport 层，本文件必须可纯函数单测；
 *   2. decode 抛异常 —— 脏数据只降级为 { kind: 'ignored' }，一条坏帧不许掀掉整个会话；
 *   3. 出现 any —— 入站数据一律按 unknown 收，再逐字段收窄；
 *   4. 私自改字段名 —— 帧字段是对端既有实现，改名即断链。
 *
 * 超时/退避取值与现网一致（GatewayOpenClawAdapter / OpenClawProxyManager / ConnectionPool），
 * 在此集中成常量，避免"每个文件硬编码出不同的重连节奏"。
 */

// ============================================================================
// 常量（对齐现有实现，见各值上方出处）
// ============================================================================

/** 网关 OpenClaw 路由前缀（相对 baseUrl）。 */
export const GATEWAY_API_BASE = '/api/stratix/openclaw';

/** 建链超时（ms）。出处：GatewayOpenClawAdapter 的 WS connect timeout = 10000。 */
export const CONNECT_TIMEOUT_MS = 10_000;

/** 单次请求超时（ms）。出处：两个 WS adapter 的 sendWSMessage 默认 timeout = 30000。 */
export const REQUEST_TIMEOUT_MS = 30_000;

/** 重连基础间隔（ms）与最大次数。出处：ConnectionPool reconnectDelay=1000 / reconnectAttempts=3。 */
export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_ATTEMPTS = 3;

/** 重连间隔上限（ms）。出处：RetryPolicyEngine 'background' 档 maxDelayMs = 30000。 */
export const RECONNECT_MAX_DELAY_MS = 30_000;

/** 建链失败冷却（ms）。出处：GatewayOpenClawAdapter COOLDOWN = 3000。 */
export const RECONNECT_COOLDOWN_MS = 3_000;

/** 心跳间隔（ms）。出处：OpenClawProxyManager HEARTBEAT_INTERVAL = 30000。 */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** 端点标识（proxyKey）：非字母数字全部替换为下划线。出处：GatewayOpenClawAdapter.computeProxyKey。 */
export function proxyKeyOf(endpoint: string): string {
  return endpoint.replace(/[^a-zA-Z0-9]/g, '_');
}

/** 把端点脱敏成可回显形式：query 串（含可能的凭据）一律替换。 */
export function redactEndpoint(endpoint: string): string {
  const queryStart = endpoint.indexOf('?');
  return queryStart === -1 ? endpoint : `${endpoint.slice(0, queryStart)}?***`;
}

/** WS 数据通道地址。出处：GatewayOpenClawAdapter.getWebSocketUrl → /proxy/{proxyKey}/ws?clientId={accountId}。 */
export function buildWsUrl(baseUrl: string, endpoint: string, accountId: string): string {
  const httpBase = baseUrl.replace(/^http/, 'ws').replace(/\/$/, '');
  const proxyKey = proxyKeyOf(endpoint);
  return `${httpBase}${GATEWAY_API_BASE}/proxy/${proxyKey}/ws?clientId=${encodeURIComponent(accountId)}`;
}

// ============================================================================
// REST 控制面信封
// ============================================================================

/** 统一响应信封。出处：StratixApiResponse<T>。data 可为 null（错误分支）。 */
export interface GatewayEnvelope<T> {
  readonly code: number;
  readonly message: string;
  readonly data: T | null;
  readonly requestId: string;
}

/** POST /connect 与 POST /ws-connect 的 data 形状（两者字段是并集，用时按需取）。 */
export interface GatewayConnectData {
  readonly endpoint: string;
  readonly connected: boolean;
  /** /connect 返回：后续 WS 数据通道用它拼地址。 */
  readonly proxyKey?: string;
  /** /ws-connect 返回：网关侧真实握手拿到的设备标识（等价于 agent 身份锚点）。 */
  readonly deviceId?: string;
}

export interface GatewayDisconnectData {
  readonly endpoint: string;
}

export interface GatewayTestData {
  readonly endpoint?: string;
  readonly version?: string;
  readonly success?: boolean;
}

/** 信封是否成功。出处：StratixRequestHelper.isSuccess → code === 200。 */
export function isGatewayOk<T>(envelope: GatewayEnvelope<T>): boolean {
  return envelope.code === 200;
}

// ============================================================================
// WS 出站帧（本端 → 网关）
// ============================================================================

export interface AgentLinkToolPayload {
  readonly args?: Readonly<Record<string, unknown>>;
  readonly sessionKey?: string | null;
  readonly action?: unknown;
}

export interface AgentLinkChatPayload {
  readonly sessionId?: string | null;
  readonly agentId?: string | null;
}

/**
 * 出站帧。两种形态与 GatewayOpenClawAdapter 完全一致：
 *   工具调用 → { type:'tool', message: 工具名, payload:{ args, sessionKey, action } }
 *   对话发送 → { type:'text', message: 文本, payload:{ sessionId, agentId } }
 * requestId 由会话层生成（形如 req_<seq>_<ts>，与现网同构），用于回帧关联。
 */
export type AgentLinkOutboundFrame =
  | { readonly type: 'tool'; readonly requestId: string; readonly message: string; readonly payload: AgentLinkToolPayload }
  | { readonly type: 'text'; readonly requestId: string; readonly message: string; readonly payload: AgentLinkChatPayload };

export function encodeOutboundFrame(frame: AgentLinkOutboundFrame): string {
  return JSON.stringify(frame);
}

export function toolFrame(requestId: string, tool: string, payload: AgentLinkToolPayload): AgentLinkOutboundFrame {
  return { type: 'tool', requestId, message: tool, payload };
}

export function chatFrame(requestId: string, text: string, payload: AgentLinkChatPayload): AgentLinkOutboundFrame {
  return { type: 'text', requestId, message: text, payload };
}

// ============================================================================
// WS 入站帧（网关 → 本端），已归一
// ============================================================================

/**
 * kind:'response' —— 对某个出站 requestId 的应答。ok=false 时 error 非空。
 * kind:'event'    —— 主动事件（agent 消息 / 状态 / 心跳等），event 名为远端原样透传。
 * kind:'error'    —— 通道级错误（无 requestId），通常意味着代理或鉴权失败。
 * kind:'ignored'  —— 无法解析或不关心的帧；**丢弃而不是抛错**，避免脏数据掀掉会话。
 */
export type AgentLinkInbound =
  | { readonly kind: 'response'; readonly requestId: string; readonly text: string | null; readonly error: string | null }
  | { readonly kind: 'event'; readonly event: string; readonly data: unknown }
  | { readonly kind: 'error'; readonly error: string }
  | { readonly kind: 'ignored'; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 从 payload 里取文本：message / content / text 三选一（现网 resolve 逻辑为 message || content）。 */
function readText(source: Record<string, unknown>): string | null {
  for (const key of ['message', 'content', 'text'] as const) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/**
 * 解码一帧入站 WS 数据。**绝不抛异常**：非法 JSON、缺 type、无 requestId 的 response
 * 都归为 { kind:'ignored' } 并带上原因，便于 dev 观测面板定位远端协议漂移。
 */
export function decodeInboundFrame(raw: string): AgentLinkInbound {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'ignored', reason: 'invalid-json' };
  }
  if (!isRecord(parsed)) return { kind: 'ignored', reason: 'not-an-object' };

  const type = parsed.type;
  if (type === 'response' || type === 'text') {
    const requestId = parsed.requestId;
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return { kind: 'ignored', reason: 'response-without-requestId' };
    }
    const error = typeof parsed.error === 'string' && parsed.error.length > 0 ? parsed.error : null;
    return { kind: 'response', requestId, text: readText(parsed), error };
  }
  if (type === 'event') {
    const event = typeof parsed.event === 'string' && parsed.event.length > 0 ? parsed.event : 'unknown';
    return { kind: 'event', event, data: parsed.payload };
  }
  if (type === 'error') {
    const error = typeof parsed.error === 'string' && parsed.error.length > 0 ? parsed.error : 'unknown gateway error';
    return { kind: 'error', error };
  }
  return { kind: 'ignored', reason: `unknown-frame-type:${typeof type === 'string' ? type : 'undefined'}` };
}

// ============================================================================
// 远端事件归一
// ============================================================================

/** 归一后的远端事件名。远端发的其它 event 名一律落 raw 分支（透传，不丢）。 */
export const REMOTE_EVENT = {
  message: 'agent.message',
  status: 'agent.status',
} as const;

/**
 * 远端 agent 消息的负载形状（宽容解析：不同上游把正文放在 text/content/message 任一处）。
 * author 缺失时用 'agent'；id 缺失时由会话层补。
 */
export interface RemoteMessageData {
  readonly text: string;
  readonly author: string;
  readonly id: string | null;
}

/** 把 agent.message 事件负载解析成消息体；不是消息（无文本）返回 null。 */
export function parseRemoteMessage(data: unknown): RemoteMessageData | null {
  if (typeof data === 'string') {
    return data.length > 0 ? { text: data, author: 'agent', id: null } : null;
  }
  if (!isRecord(data)) return null;
  const text = readText(data);
  if (text === null) return null;
  const author = typeof data.author === 'string' && data.author.length > 0 ? data.author : 'agent';
  const id = typeof data.id === 'string' && data.id.length > 0 ? data.id : null;
  return { text, author, id };
}

/**
 * 远端状态 → 世界态单位状态（复用 UnitStatus 词表：idle / busy / offline / error）。
 * 宽容解析：{ status: 'busy' }、{ busy: true }、'busy' 三种写法都认；认不出返回 null（不变更状态）。
 */
export function parseRemoteStatus(data: unknown): 'idle' | 'busy' | 'offline' | 'error' | null {
  const raw = ((): unknown => {
    if (typeof data === 'string') return data;
    if (isRecord(data) && typeof data.status === 'string') return data.status;
    if (isRecord(data) && typeof data.busy === 'boolean') return data.busy ? 'busy' : 'idle';
    return null;
  })();
  if (typeof raw !== 'string') return null;
  switch (raw.toLowerCase()) {
    case 'idle':
    case 'ready':
    case 'available':
      return 'idle';
    case 'busy':
    case 'running':
    case 'working':
      return 'busy';
    case 'offline':
    case 'disconnected':
    case 'closed':
      return 'offline';
    case 'error':
    case 'failed':
      return 'error';
    default:
      return null;
  }
}