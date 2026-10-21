/**
 * 文件职责：**单个外部 agent 会话的状态机** —— 创建 / 恢复 / 关闭 / 重连 + 事件回传。
 *   这是 core/agent-link 的核心；manager.ts 只做多会话编排与状态投影。
 * 协议与状态语义全部对齐现网（只读参考，未改动那两个模块）：
 *   - stratix-gateway/api/routes/openclaw.ts     ：POST /connect 登记代理、POST /ws-connect 真实握手、POST /disconnect 销户
 *   - stratix-openclaw-adapter/GatewayOpenClawAdapter.ts ：WS 数据通道 + requestId 关联 + 30s 请求超时
 *   - ConnectionPool / OpenClawProxyManager      ：重连次数 3、间隔 1s 起指数退避、30s 心跳
 * 输入：transport.ts 的端口（控制面 + 通道工厂），AgentLinkOpenParams 定义的业务参数。
 * 输出：AgentLinkSessionEvent（订阅式，唯一出口）、snapshot()（可持久化，用于应用重启后恢复）。
 * 禁止事项：
 *   1. import 具体 IO 实现（fetch / ws / axios）——只认 transport 端口，否则逻辑无法脱离 IO 单测；
 *   2. 直接改 WorldState —— 会话不碰 store，投影由 manager 统一做（避免多处写状态打架）；
 *   3. 静默吞错 —— 失败必须变成 error 事件 + phase=error，否则 HUD 上"卡在 connecting"无人认领；
 *   4. 无界资源 —— pending 请求、心跳/退避定时器、监听器全部有上限且在 dispose 里清空；
 *   5. 无界重连 —— 退避次数有上限（默认 3 次），耗尽后停在 error，等用户显式重连。
 *
 * 相位机（唯一合法迁移，其余一律视为 bug）：
 *   idle ──open()──▶ connecting ──成功──▶ connected
 *   closed/error ──resume()/reconnect()──▶ reconnecting ──成功──▶ connected
 *   任意 ──close()──▶ closing ──▶ closed
 *   connected ──通道异常关闭──▶ reconnecting（有界退避）｜退避耗尽──▶ error
 */

import type { AgentLinkPhase } from '../types';

import {
  chatFrame,
  CONNECT_TIMEOUT_MS,
  decodeInboundFrame,
  encodeOutboundFrame,
  parseRemoteMessage,
  parseRemoteStatus,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_MAX_DELAY_MS,
  redactEndpoint,
  REMOTE_EVENT,
  REQUEST_TIMEOUT_MS,
  toolFrame,
  type AgentLinkOutboundFrame,
} from './protocol';
import { CHANNEL_CLOSE, type AgentLinkChannel, type AgentLinkTransport } from './transport';
import type { AgentLinkSessionEvent, AgentLinkSessionListener, AgentLinkOpenParams, AgentLinkSnapshot } from './types';

/** 单会话同时在途的请求上限。出处：现网 pendingRequests 无上限（已知问题），本层收紧。 */
export const MAX_PENDING_REQUESTS = 64;

interface PendingRequest {
  readonly resolve: (value: string) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  /** chat 的应答要同时进消息流（聊天抽屉要看到回复），tool 的应答不显示。 */
  readonly kind: 'chat' | 'tool';
}

export interface AgentLinkSessionOptions {
  readonly linkId: string;
  readonly params: AgentLinkOpenParams;
  readonly transport: AgentLinkTransport;
  /** 网关基址（同源留空即可）。通道地址由 transport 工厂自己拼，本层不碰 URL。 */
  readonly baseUrl?: string;
  readonly now?: () => number;
  readonly createId?: (prefix: string) => string;
  readonly requestTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly maxReconnectAttempts?: number;
  readonly baseReconnectDelayMs?: number;
  readonly maxReconnectDelayMs?: number;
}

export interface AgentLinkSession {
  readonly linkId: string;
  readonly phase: AgentLinkPhase;
  readonly agentId: string | null;
  readonly sessionId: string | null;
  readonly lastError: string | null;
  readonly connectedAt: number | null;
  /** 创建（首次开户）。并发调用共享同一次建链，不会重复开户。 */
  open(): Promise<void>;
  /** 恢复：带原会话键重新建链（现网语义 = 同一 sessionKey 继续同一上下文）。已连接时是 no-op。 */
  resume(): Promise<void>;
  /** 主动重连：丢弃当前通道，用同一份参数重新建链（退避预算清零）。 */
  reconnect(): Promise<void>;
  /** 关闭会话：关通道 + 销户，**不自动重连**。 */
  close(reason?: string): Promise<void>;
  /** 发送一条对话消息：本端气泡与远端回复都进消息流。 */
  sendMessage(text: string): Promise<string>;
  /** 调用远端工具（命令面板 → agent 能力的入口）。 */
  invokeTool(tool: string, args?: Record<string, unknown>): Promise<string>;
  subscribe(listener: AgentLinkSessionListener): () => void;
  snapshot(): AgentLinkSnapshot;
  /** 释放一切资源（通道 / 定时器 / 监听器）。管理器关闭全部连接时调用。 */
  dispose(): Promise<void>;
}

class Session implements AgentLinkSession {
  readonly linkId: string;

  private readonly transport: AgentLinkTransport;
  private readonly params: AgentLinkOpenParams;
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly baseReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;

  private currentPhase: AgentLinkPhase = 'idle';
  private channel: AgentLinkChannel | null = null;
  private channelOffs: (() => void)[] = [];
  private listeners = new Set<AgentLinkSessionListener>();
  private pending = new Map<string, PendingRequest>();
  /** 建链在途 Promise：open/resume/reconnect 并发时共享，避免同一端点重复开户。 */
  private connecting: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private disposed = false;
  private seq = 0;
  private reconnectAttempts = 0;
  private remoteAgentId: string | null;
  private remoteSessionId: string | null;
  private connectedSince: number | null = null;
  private lastErrorMessage: string | null = null;

  constructor(options: AgentLinkSessionOptions) {
    this.linkId = options.linkId;
    this.params = options.params;
    this.transport = options.transport;
    this.now = options.now ?? ((): number => Date.now());
    this.createId = options.createId ?? ((prefix: string): string => `${prefix}_${this.now()}_${++this.seq}`);
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? RECONNECT_MAX_ATTEMPTS;
    this.baseReconnectDelayMs = options.baseReconnectDelayMs ?? RECONNECT_BASE_DELAY_MS;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? RECONNECT_MAX_DELAY_MS;
    this.remoteAgentId = options.params.agentId ?? null;
    this.remoteSessionId = options.params.sessionId ?? null;
  }

  get phase(): AgentLinkPhase {
    return this.currentPhase;
  }

  get agentId(): string | null {
    return this.remoteAgentId;
  }

  get sessionId(): string | null {
    return this.remoteSessionId;
  }

  get lastError(): string | null {
    return this.lastErrorMessage;
  }

  get connectedAt(): number | null {
    return this.connectedSince;
  }

  // ==========================================================================
  // 生命周期
  // ==========================================================================

  open(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error(`session ${this.linkId} disposed`));
    if (this.currentPhase === 'connected') return Promise.resolve();
    return this.establish('connecting');
  }

  resume(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error(`session ${this.linkId} disposed`));
    if (this.currentPhase === 'connected') return Promise.resolve();
    // 恢复保留 remoteSessionId：这是"接上原上下文"的唯一凭据（现网：sessionKey 每次调用透传）
    return this.establish('reconnecting');
  }

  reconnect(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error(`session ${this.linkId} disposed`));
    this.reconnectAttempts = 0; // 用户显式重连 = 重新给满退避预算
    this.teardownChannel('reconnect requested by user');
    return this.establish('reconnecting');
  }

  async close(reason = 'closed by local'): Promise<void> {
    if (this.disposed) return;
    // 先置位再关通道：否则 onClose 会把主动关闭误判成异常掉线并触发自动重连
    this.intentionalClose = true;
    this.clearReconnectTimer();
    if (this.currentPhase !== 'closed') this.setPhase('closing', reason);
    this.rejectAllPending(new Error('session closed'));
    this.teardownChannel(reason);
    this.connectedSince = null;
    this.setPhase('closed', reason);
    try {
      // 销户尽力而为：网关不可达不该让本地关闭流程失败（对齐现网 disconnect 的 try/catch 语义）
      await this.transport.controlPlane.disconnect(this.params.endpoint);
    } catch (error) {
      this.emitError(errorMessageOf(error), false);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.close('disposed');
    this.disposed = true;
    this.listeners.clear();
    this.clearReconnectTimer();
  }

  // ==========================================================================
  // 消息 / 工具
  // ==========================================================================

  async sendMessage(text: string): Promise<string> {
    // 先打本端气泡再等应答：否则远端秒回时消息顺序会倒过来
    this.emitMessage('outbound', 'you', text);
    return this.dispatch(
      chatFrame(this.nextRequestId(), text, { sessionId: this.remoteSessionId, agentId: this.remoteAgentId }),
      'chat'
    );
  }

  invokeTool(tool: string, args?: Record<string, unknown>): Promise<string> {
    return this.dispatch(
      toolFrame(this.nextRequestId(), tool, { args, sessionKey: this.remoteSessionId }),
      'tool'
    );
  }

  /**
   * 发一帧并等应答。**在途请求有上限**：超过 MAX_PENDING_REQUESTS 直接拒，
   * 避免对端不回时 Map 无限涨（现网 pendingRequests 的已知问题）。
   */
  private dispatch(frame: AgentLinkOutboundFrame, kind: 'chat' | 'tool'): Promise<string> {
    if (this.disposed) {
      return Promise.reject(new Error(`session ${this.linkId} is disposed`));
    }
    if (this.currentPhase !== 'connected' || !this.channel) {
      return Promise.reject(new Error(`session ${this.linkId} is not connected (phase=${this.currentPhase})`));
    }
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new Error(`too many pending requests (max ${MAX_PENDING_REQUESTS})`));
    }

    const channel = this.channel;
    const requestId = frame.requestId;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`request timeout after ${this.requestTimeoutMs}ms (requestId=${requestId})`));
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, kind });
      try {
        channel.send(encodeOutboundFrame(frame));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error(errorMessageOf(error)));
      }
    });
  }

  // ==========================================================================
  // 建链
  // ==========================================================================

  private establish(phase: 'connecting' | 'reconnecting', autoRetry = false): Promise<void> {
    if (this.connecting) return this.connecting;
    this.intentionalClose = false;
    this.setPhase(phase, null);
    const task = this.doEstablish(autoRetry).finally(() => {
      this.connecting = null;
    });
    this.connecting = task;
    return task;
  }

  /**
   * @param autoRetry 本次建链是否由自动重连触发。why 要区分：
   *   用户主动 open() 失败就该把错误交回用户（不自己闷头重试）；
   *   自动重连失败则应该继续消耗退避预算，否则"重连 3 次"这个配置名存实亡。
   */
  private async doEstablish(autoRetry: boolean): Promise<void> {
    const { endpoint, accountId, apiKey, agentId } = this.params;
    try {
      // 1) 控制面开户：/connect 登记代理（拿 proxyKey）+ /ws-connect 真实握手（拿 deviceId）
      const result = await this.transport.controlPlane.connect({ endpoint, accountId, apiKey });
      if (this.aborted()) return; // 建链途中被 close/dispose：丢弃结果，绝不复活已关闭的会话
      if (!result.connected) {
        throw new Error(`gateway refused connection for ${redactEndpoint(endpoint)}`);
      }
      // deviceId 是网关侧握手拿到的设备身份，等价于"我们在跟哪个 agent 实例说话"的锚点
      const identityAgentId = agentId ?? result.deviceId;
      const identitySessionId = this.remoteSessionId ?? result.deviceId;

      // 2) 数据通道
      const channel = await this.transport.openChannel({
        endpoint,
        accountId,
        apiKey,
        agentId: identityAgentId,
        timeoutMs: this.connectTimeoutMs,
      });
      if (this.aborted()) {
        // 同上：通道刚建好就被要求关闭 → 立刻关掉，不挂到会话上
        try {
          channel.close(CHANNEL_CLOSE.normal, 'closed while establishing');
        } catch {
          /* 通道可能已经自己断了，无需补救 */
        }
        return;
      }
      this.attachChannel(channel);

      this.remoteAgentId = identityAgentId;
      this.remoteSessionId = identitySessionId;
      this.connectedSince = this.now();
      this.lastErrorMessage = null;
      this.reconnectAttempts = 0;
      this.setPhase('connected', null);
      this.emit({
        type: 'identity',
        agentId: this.remoteAgentId,
        sessionId: this.remoteSessionId,
        at: this.now(),
      });
    } catch (error) {
      const message = errorMessageOf(error);
      this.lastErrorMessage = message;
      this.emitError(message, true);
      if (autoRetry && !this.disposed && !this.intentionalClose) {
        this.scheduleReconnect(message);
      } else {
        this.setPhase('error', message);
      }
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private attachChannel(channel: AgentLinkChannel): void {
    this.channel = channel;
    this.channelOffs = [
      channel.onMessage((raw) => this.handleInbound(raw)),
      channel.onClose((info) => this.handleChannelClose(info.code, info.reason)),
    ];
  }

  /** 摘掉并关闭当前通道（含退订）。**不碰相位** —— 相位由调用方决定。 */
  private teardownChannel(reason: string): void {
    const offs = this.channelOffs;
    this.channelOffs = [];
    const channel = this.channel;
    this.channel = null;
    offs.forEach((off) => off());
    if (channel) {
      try {
        channel.close(CHANNEL_CLOSE.normal, reason);
      } catch {
        // 通道已死：关闭失败没有可补救动作（状态已在调用方归因），吞掉即可
      }
    }
  }

  // ==========================================================================
  // 入站处理
  // ==========================================================================

  private handleInbound(raw: string): void {
    const frame = decodeInboundFrame(raw);
    switch (frame.kind) {
      case 'response': {
        const pending = this.pending.get(frame.requestId);
        if (!pending) return; // 超时后迟到的应答：丢弃（不猜它属于谁）
        this.pending.delete(frame.requestId);
        clearTimeout(pending.timer);
        if (frame.error) {
          pending.reject(new Error(frame.error));
          this.emitError(`request failed: ${frame.error}`, true);
          return;
        }
        const text = frame.text ?? '';
        pending.resolve(text);
        if (pending.kind === 'chat' && text.length > 0) {
          // 对话应答同时进消息流：聊天抽屉展示的是"对话"，不是"协议应答"
          this.emitMessage('inbound', this.remoteAgentId ?? 'agent', text);
        }
        return;
      }
      case 'event':
        this.handleRemoteEvent(frame.event, frame.data);
        return;
      case 'error':
        // 通道级错误（代理不存在 / 鉴权失败）：不可重试，重试只会连续打网关
        this.emitError(`gateway error: ${frame.error}`, false);
        return;
      case 'ignored':
        // 协议漂移探针：不进消息流，但必须可见（dev 观测面板按 reason 分类）
        this.emit({ type: 'raw', event: 'link.frame.ignored', data: frame.reason });
        return;
      default:
        return;
    }
  }

  private handleRemoteEvent(event: string, data: unknown): void {
    this.captureSessionKey(data); // 任何事件里都可能带会话键：抓到就更新（恢复会话靠它）

    if (event === REMOTE_EVENT.message) {
      const parsed = parseRemoteMessage(data);
      if (!parsed) {
        this.emit({ type: 'raw', event, data });
        return;
      }
      this.emitMessage('inbound', parsed.author, parsed.text);
      return;
    }

    if (event === REMOTE_EVENT.status) {
      const status = parseRemoteStatus(data);
      if (!status) {
        this.emit({ type: 'raw', event, data });
        return;
      }
      this.emit({ type: 'status', agentId: this.remoteAgentId, status, at: this.now() });
      return;
    }

    // 未归一事件：原样透传，协议演进时数据不丢
    this.emit({ type: 'raw', event, data });
  }

  /** 事件负载里的 sessionKey / sessionId / session 一律收下。 */
  private captureSessionKey(data: unknown): void {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return;
    const record = data as Record<string, unknown>;
    for (const key of ['sessionKey', 'sessionId', 'session'] as const) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0 && value !== this.remoteSessionId) {
        this.remoteSessionId = value;
        this.emit({ type: 'identity', agentId: this.remoteAgentId, sessionId: value, at: this.now() });
        return;
      }
    }
  }

  // ==========================================================================
  // 通道关闭（主动 / 异常）
  // ==========================================================================

  private handleChannelClose(code: number, reason: string): void {
    this.channelOffs = [];
    this.channel = null;
    this.connectedSince = null;
    this.rejectAllPending(new Error(`channel closed (code=${code}${reason ? `, reason=${reason}` : ''})`));

    if (this.disposed || this.intentionalClose) return; // close() 自己会把相位推到 closed

    const message = `channel closed unexpectedly (code=${code}${reason ? `, reason=${reason}` : ''})`;
    this.lastErrorMessage = message;
    this.emitError(message, true);
    this.scheduleReconnect(message);
  }

  /**
   * 安排下一次重连（指数退避 + 次数上限）。
   * 退避预算耗尽就停在 error 等用户显式重连 —— 不做无限重试（perf 与资源纪律）。
   */
  private scheduleReconnect(message: string): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.reconnectDelayFor(this.reconnectAttempts);
      this.reconnectAttempts += 1;
      this.setPhase('reconnecting', `${message}; retry in ${delay}ms`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        // 退避窗口内被 dispose / close 打断时必须彻底退出，不能留下孤儿定时器
        if (this.disposed || this.intentionalClose) return;
        void this.establish('reconnecting', true).catch(() => {
          /* 相位与错误已在 doEstablish 内归因 */
        });
      }, delay);
      return;
    }
    this.setPhase('error', `${message}; reconnect budget exhausted (${this.maxReconnectAttempts})`);
  }

  /** 退避序列：base * 2^attempt，封顶 maxReconnectDelayMs（对齐 ConnectionPool 的指数退避）。 */
  private reconnectDelayFor(attempt: number): number {
    return Math.min(this.baseReconnectDelayMs * Math.pow(2, Math.max(0, attempt)), this.maxReconnectDelayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private rejectAllPending(error: Error): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    entries.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.reject(error);
    });
  }

  // ==========================================================================
  // 事件出口
  // ==========================================================================

  subscribe(listener: AgentLinkSessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): AgentLinkSnapshot {
    return {
      linkId: this.linkId,
      kind: this.params.kind,
      endpoint: this.params.endpoint,
      displayName: this.params.displayName ?? redactEndpoint(this.params.endpoint),
      accountId: this.params.accountId ?? 'stratix',
      agentId: this.remoteAgentId,
      sessionId: this.remoteSessionId,
    };
  }

  private nextRequestId(): string {
    return `req_${this.now()}_${++this.seq}`;
  }

  /**
   * 建链途中是否已被要求收手（close / dispose 发生在 await 期间）。
   * why 单独抽出来：建链有两次 await，每次返回后都要复查，否则"关掉了却又连上"这种
   * 幽灵状态只在慢网络下偶发，排查成本极高。
   */
  private aborted(): boolean {
    return this.disposed || this.intentionalClose;
  }

  private setPhase(phase: AgentLinkPhase, reason: string | null): void {
    const previous = this.currentPhase;
    if (previous === phase) return; // 同相位不重复广播：一次状态变更只打一条事件（perf）
    this.currentPhase = phase;
    this.emit({ type: 'phase', phase, previous, reason, at: this.now() });
  }

  private emitMessage(direction: 'inbound' | 'outbound', author: string, text: string): void {
    this.emit({
      type: 'message',
      message: { id: this.createId('msg'), linkId: this.linkId, direction, author, text, at: this.now() },
    });
  }

  private emitError(message: string, retryable: boolean): void {
    this.emit({ type: 'error', message, at: this.now(), retryable });
  }

  private emit(event: AgentLinkSessionEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // 单个订阅者抛错不许影响会话与其他订阅者（事件回传链路必须始终可用）
      }
    });
  }
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAgentLinkSession(options: AgentLinkSessionOptions): AgentLinkSession {
  return new Session(options);
}