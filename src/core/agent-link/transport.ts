/**
 * 文件职责：外部连接所需的**端口定义（依赖倒置）** —— 会话状态机只认这里的三组接口，
 *   不认 WebSocket / fetch / 任何具体实现。因此 core/agent-link 的逻辑可以纯单测。
 * 输入：无（纯接口 + 工厂签名）。
 * 输出：AgentLinkControlPlane（REST 控制面）、AgentLinkChannel（WS 数据通道）、AgentLinkTransport（两者合体）。
 * 禁止事项：
 *   1. 在本文件里 import ws / fetch / axios —— 这里只有形状；实现在 gateway-transport.ts；
 *   2. 让通道实现持有业务状态 —— 通道只负责"把字节送出去、把字节送回来"，重试与状态在 session.ts；
 *   3. 订阅接口不返回退订函数 —— 资源必须可清理（core 铁律）。
 *
 * 为什么要拆两个端口：现网控制面（/connect /disconnect）与数据面（/proxy/{key}/ws）本就是两条链路，
 * 生命周期也不同（控制面按 endpoint 记账，数据面按 accountId 挂载）。合成一个接口会逼实现方伪造状态。
 */

/** 通道关闭原因（与 gateway 现用 close code 对齐：1000 正常 / 1008 策略 / 1011 内部错误）。 */
export const CHANNEL_CLOSE = {
  normal: 1000,
  policy: 1008,
  internal: 1011,
} as const;

/** 建链请求参数。字段与 REST /connect、/ws-connect 的 body 对齐。 */
export interface AgentLinkConnectParams {
  readonly endpoint: string;
  /** 网关侧账号标识；WS 通道用 clientId 定位，缺省走 'stratix'（与现网 default 一致）。 */
  readonly accountId?: string;
  readonly apiKey?: string;
}

export interface AgentLinkConnectResult {
  readonly connected: boolean;
  /** /connect 给出：拼 WS 地址用。 */
  readonly proxyKey: string | null;
  /** /ws-connect 给出：真实握手拿到的设备标识，作为会话身份锚点。 */
  readonly deviceId: string | null;
}

/** REST 控制面：会话的"开户 / 销户 / 体检"。 */
export interface AgentLinkControlPlane {
  /** 开户：POST /connect（登记代理）+ POST /ws-connect（真实握手拿 deviceId）。任一失败即视为开户失败。 */
  connect(params: AgentLinkConnectParams): Promise<AgentLinkConnectResult>;
  /** 销户：POST /disconnect。实现必须"尽力而为"：网关不可达时也不该让本地关闭流程失败。 */
  disconnect(endpoint: string): Promise<void>;
  /** 体检：GET /test。用于连接前探测与连接失败时的归因，不改变会话状态。 */
  test(endpoint: string, apiKey?: string): Promise<{ ok: boolean; detail: string | null }>;
}

/** 数据通道：一条已建立的 WS 连接。 */
export interface AgentLinkChannel {
  /** 发送原始帧字符串。实现要么送达、要么抛错，**不许静默丢弃**。 */
  send(raw: string): void;
  /** 关闭通道。code 语义见 CHANNEL_CLOSE。 */
  close(code?: number, reason?: string): void;
  /** 入站数据订阅，返回退订函数。 */
  onMessage(handler: (raw: string) => void): () => void;
  /** 关闭事件订阅，返回退订函数。reason 为空表示对端未给原因。 */
  onClose(handler: (info: { code: number; reason: string }) => void): () => void;
}

/**
 * 数据通道工厂：给定目标端点与鉴权信息开一条通道，握手完成即 resolve（不等待业务级 hello）。
 * 传端点而非完整 URL 是有意的：**地址拼装是 transport 的责任**（baseUrl 只有它知道），
 * 会话层不该知道网关路由长什么样 —— 这也让换传输（WS / IPC / 本地进程）不动上层。
 */
export type AgentLinkChannelFactory = (options: {
  readonly endpoint: string;
  readonly accountId?: string;
  readonly apiKey?: string;
  readonly agentId?: string | null;
  readonly timeoutMs: number;
}) => Promise<AgentLinkChannel>;

/** 会话用到的全部 IO 能力。测试注入内存实现，生产用 gateway-transport.ts 的真实实现。 */
export interface AgentLinkTransport {
  readonly controlPlane: AgentLinkControlPlane;
  readonly openChannel: AgentLinkChannelFactory;
}