/**
 * 文件职责：**外部 agent 连接的管理器** —— 多会话编排 + 向 WorldState 的投影 + HudCommand 响应。
 *   这是 core/agent-link 对外唯一入口（chat-drawer / agent-panel 之后只认这个接口）。
 * 输入：transport.ts 端口、core/store 的 CoreStore、core/bus 的 HudCommand 通道。
 * 输出：WorldState.links / WorldState.messages 的写入；Notice（相位变化与错误）。
 * 禁止事项：
 *   1. 自己做 IO —— 一律经 session.ts，本文件只编排；
 *   2. 在本文件里 emitState —— state 广播的唯一出口是 core/runtime.ts（避免重复广播）；
 *   3. 往 store 塞传输细节（URL / token / socket）—— 只投影 types.ts 契约里有的字段；
 *   4. 无界增长 —— 会话数与消息数都受契约上限约束（MAX_AGENT_LINKS / MAX_AGENT_MESSAGES）；
 *   5. 命令里抛异常 —— 命令总线是同步的，异步失败一律转成 Notice + onError。
 *
 * 事件回传链路：远端帧 → session 事件 → 本文件投影 → store → core/runtime → state 通道 → hud/world。
 */

import { onCommand, type Unsubscribe } from '../bus';
import { worldStore, type CoreStore } from '../store';
import {
  MAX_AGENT_LINKS,
  MAX_AGENT_MESSAGES,
  MAX_AGENT_MESSAGES_PER_LINK,
  NOTICE_TTL_MS,
  type AgentLinkView,
  type AgentMessageView,
  type HudCommand,
  type NoticeLevel,
  type UnitStatus,
} from '../types';

import { redactEndpoint } from './protocol';
import { createAgentLinkSession, type AgentLinkSession, type AgentLinkSessionOptions } from './session';
import type { AgentLinkTransport } from './transport';
import type { AgentLinkOpenParams, AgentLinkSnapshot, AgentLinkSessionEvent, AgentLinkViewFilter } from './types';

/** 失败带码：HUD 与单测据此分流（不靠解析错误字符串）。 */
export type AgentLinkErrorCode =
  | 'not-found'
  | 'limit-exceeded'
  | 'not-connected'
  | 'ambiguous-target'
  | 'open-failed'
  | 'closed';

export class AgentLinkError extends Error {
  constructor(
    readonly code: AgentLinkErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AgentLinkError';
  }
}

export interface AgentLinkManagerOptions {
  readonly transport: AgentLinkTransport;
  /** 状态持有者；默认 worldStore 单例。单测用 createStore() 隔离。 */
  readonly store?: CoreStore;
  readonly now?: () => number;
  readonly createId?: (prefix: string) => string;
  /** 会话数上限；默认契约常量 MAX_AGENT_LINKS。 */
  readonly maxLinks?: number;
  /** 消息保留上限（全局 / 单会话）；默认契约常量。 */
  readonly maxMessages?: number;
  readonly maxMessagesPerLink?: number;
  /** 超时与退避参数（协议默认值见 protocol.ts）。测试用小值把等待压到毫秒级。 */
  readonly timing?: Partial<
    Pick<
      AgentLinkSessionOptions,
      'requestTimeoutMs' | 'connectTimeoutMs' | 'maxReconnectAttempts' | 'baseReconnectDelayMs' | 'maxReconnectDelayMs'
    >
  >;
  /** 恢复会话时重新注入凭据（快照刻意不含 apiKey）。 */
  readonly credentialFor?: (snapshot: AgentLinkSnapshot) => string | undefined;
  /** 命令通道上的异步失败出口（HUD 订阅它做 toast）。 */
  readonly onError?: (error: AgentLinkError) => void;
}

export interface RestoreResult {
  readonly restored: AgentLinkView[];
  readonly failed: { readonly linkId: string; readonly message: string }[];
}

export interface AgentLinkManager {
  readonly store: CoreStore;
  /** 接上命令总线（link.* / chat.send）。返回 stop 闭包，重复 start 是 no-op。 */
  start(): () => void;
  readonly running: boolean;
  /** 创建会话（开户 + 建通道）。超过上限直接抛 limit-exceeded。 */
  open(params: AgentLinkOpenParams): Promise<AgentLinkView>;
  /** 恢复会话：带原会话键重连（应用重启或远端重启后接上下文）。 */
  resume(linkId: string): Promise<AgentLinkView>;
  /** 主动重连：重建通道，退避预算清零。 */
  reconnect(linkId: string): Promise<AgentLinkView>;
  /** 关闭会话：关通道 + 销户。会话视图保留（phase=closed），便于 HUD 显示历史。 */
  close(linkId: string): Promise<void>;
  sendMessage(linkId: string, text: string): Promise<string>;
  invokeTool(linkId: string, tool: string, args?: Record<string, unknown>): Promise<string>;
  list(filter?: AgentLinkViewFilter): AgentLinkView[];
  get(linkId: string): AgentLinkView | null;
  /** 消息查询；不传 linkId = 全部（按时间正序）。 */
  messages(linkId?: string): AgentMessageView[];
  /** 当前应当接收 chat.send 的会话：最近一次成功建链的已连接会话。 */
  readonly activeLinkId: string | null;
  /** 全部会话的可持久化快照（应用重启后喂给 restore）。 */
  snapshots(): AgentLinkSnapshot[];
  /** 按快照恢复会话。逐个串行（对齐现网 connectionBatchDelay 的错峰精神），单个失败不影响其余。 */
  restore(snapshots: readonly AgentLinkSnapshot[]): Promise<RestoreResult>;
  /** 关闭全部会话并释放资源。 */
  dispose(): Promise<void>;
}

class Manager implements AgentLinkManager {
  readonly store: CoreStore;

  private readonly transport: AgentLinkTransport;
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private readonly maxLinks: number;
  private readonly maxMessages: number;
  private readonly maxMessagesPerLink: number;
  private readonly timing: AgentLinkManagerOptions['timing'];
  private readonly credentialFor: (snapshot: AgentLinkSnapshot) => string | undefined;
  private readonly reportError: (error: AgentLinkError) => void;

  private readonly sessions = new Map<string, AgentLinkSession>();
  private readonly views = new Map<string, AgentLinkView>();
  private readonly offs = new Map<string, () => void>();
  private linkSeq = 0;
  private stopFn: (() => void) | null = null;

  constructor(options: AgentLinkManagerOptions) {
    this.store = options.store ?? worldStore;
    this.transport = options.transport;
    this.now = options.now ?? ((): number => Date.now());
    this.createId = options.createId ?? ((prefix: string): string => `${prefix}_${this.now()}_${++this.linkSeq}`);
    this.maxLinks = options.maxLinks ?? MAX_AGENT_LINKS;
    this.maxMessages = options.maxMessages ?? MAX_AGENT_MESSAGES;
    this.maxMessagesPerLink = options.maxMessagesPerLink ?? MAX_AGENT_MESSAGES_PER_LINK;
    this.timing = options.timing;
    this.credentialFor = options.credentialFor ?? ((): undefined => undefined);
    this.reportError = options.onError ?? ((): void => { /* 默认安静；HUD 入口与单测注入 */ });
  }

  get running(): boolean {
    return this.stopFn !== null;
  }

  get activeLinkId(): string | null {
    // 最近一次成功建链的已连接会话（chat.send 的默认目标）。用 reduce 而非闭包变量：
    // 闭包里的赋值 TS 控制流分析看不见，会把结果误推成 never。
    const connected = [...this.views.values()].filter((view) => view.phase === 'connected');
    const best = connected.reduce<AgentLinkView | null>(
      (acc, view) => (acc === null || (view.connectedAt ?? 0) >= (acc.connectedAt ?? 0) ? view : acc),
      null
    );
    return best === null ? null : best.id;
  }

  // ==========================================================================
  // 命令总线
  // ==========================================================================

  start(): () => void {
    if (this.stopFn) return this.stopFn;
    const off: Unsubscribe = onCommand((command) => this.handleCommand(command));
    this.stopFn = () => {
      off();
      this.stopFn = null;
    };
    return this.stopFn;
  }

  private handleCommand(command: HudCommand): void {
    switch (command.type) {
      case 'link.open':
        void this.guard(() =>
          this.open({
            kind: command.kind,
            endpoint: command.endpoint,
            displayName: command.displayName,
            apiKey: command.apiKey,
          })
        );
        return;
      case 'link.resume':
        void this.guard(() => this.resume(command.linkId));
        return;
      case 'link.reconnect':
        void this.guard(() => this.reconnect(command.linkId));
        return;
      case 'link.close':
        void this.guard(() => this.close(command.linkId));
        return;
      case 'chat.send': {
        const target = command.linkId ?? this.activeLinkId;
        if (!target) {
          this.fail(new AgentLinkError('not-connected', 'chat.send: no connected agent link'));
          return;
        }
        // linkId 缺省时只接受唯一的已连接会话；多会话不猜（猜错 = 消息投给了别的 agent）
        if (!command.linkId && this.countConnected() > 1) {
          this.fail(
            new AgentLinkError('ambiguous-target', `chat.send: ${this.countConnected()} links connected, linkId required`)
          );
          return;
        }
        void this.guard(() => this.sendMessage(target, command.text));
        return;
      }
      default:
        // unit.select / mission.* / ui.navigate 等不是本模块的事务，交回 runtime 的 unhandled 出口
        return;
    }
  }

  /** 命令通道的异步出口：任何失败都转成 Notice + onError，绝不抛进总线。 */
  private async guard(task: () => Promise<unknown>): Promise<void> {
    try {
      await task();
    } catch (error) {
      this.fail(error instanceof AgentLinkError ? error : new AgentLinkError('open-failed', String(error)));
    }
  }

  private fail(error: AgentLinkError): void {
    this.notice('error', `[agent-link] ${error.message}`);
    this.reportError(error);
  }

  // ==========================================================================
  // 会话生命周期
  // ==========================================================================

  async open(params: AgentLinkOpenParams): Promise<AgentLinkView> {
    const linkId = params.linkId ?? this.createId('link');
    if (this.sessions.has(linkId)) {
      throw new AgentLinkError('limit-exceeded', `link ${linkId} already exists`);
    }
    if (this.sessions.size >= this.maxLinks) {
      throw new AgentLinkError('limit-exceeded', `link limit reached (max ${this.maxLinks})`);
    }
    // 视图先落库：HUD 在建链过程中就能看到 connecting（不出现"点了没反应"的空窗）
    this.putView(this.initialView(linkId, params));
    const session = this.createSession(linkId, params);
    try {
      await session.open();
    } catch (error) {
      throw new AgentLinkError('open-failed', `open ${linkId} failed: ${messageOf(error)}`);
    }
    return this.requireView(linkId);
  }

  async resume(linkId: string): Promise<AgentLinkView> {
    const session = this.requireSession(linkId);
    await session.resume();
    return this.requireView(linkId);
  }

  async reconnect(linkId: string): Promise<AgentLinkView> {
    const session = this.requireSession(linkId);
    await session.reconnect();
    return this.requireView(linkId);
  }

  async close(linkId: string): Promise<void> {
    const session = this.requireSession(linkId);
    await session.close();
  }

  sendMessage(linkId: string, text: string): Promise<string> {
    return this.requireSession(linkId).sendMessage(text);
  }

  invokeTool(linkId: string, tool: string, args?: Record<string, unknown>): Promise<string> {
    return this.requireSession(linkId).invokeTool(tool, args);
  }

  // ==========================================================================
  // 查询
  // ==========================================================================

  list(filter: AgentLinkViewFilter = {}): AgentLinkView[] {
    const all = [...this.views.values()];
    return all.filter((view) => {
      if (filter.phase && view.phase !== filter.phase) return false;
      if (filter.kind && view.kind !== filter.kind) return false;
      return true;
    });
  }

  get(linkId: string): AgentLinkView | null {
    return this.views.get(linkId) ?? null;
  }

  messages(linkId?: string): AgentMessageView[] {
    const all = this.store.getState().messages;
    return linkId ? all.filter((m) => m.linkId === linkId) : [...all];
  }

  snapshots(): AgentLinkSnapshot[] {
    return [...this.sessions.values()].map((session) => session.snapshot());
  }

  async restore(snapshots: readonly AgentLinkSnapshot[]): Promise<RestoreResult> {
    const restored: AgentLinkView[] = [];
    const failed: { linkId: string; message: string }[] = [];
    // 串行恢复：并发开局会同时打网关的 /ws-connect，重试风暴且难归因（对齐现网 connectionBatchDelay 的错峰精神）
    for (const snapshot of snapshots) {
      if (this.sessions.has(snapshot.linkId)) {
        failed.push({ linkId: snapshot.linkId, message: 'link already exists' });
        continue;
      }
      try {
        const view = await this.open({
          linkId: snapshot.linkId,
          kind: snapshot.kind,
          endpoint: snapshot.endpoint,
          displayName: snapshot.displayName,
          accountId: snapshot.accountId,
          agentId: snapshot.agentId ?? undefined,
          sessionId: snapshot.sessionId,
          apiKey: this.credentialFor(snapshot),
        });
        restored.push(view);
      } catch (error) {
        failed.push({ linkId: snapshot.linkId, message: messageOf(error) });
      }
    }
    return { restored, failed };
  }

  async dispose(): Promise<void> {
    this.stopFn?.();
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    this.offs.forEach((off) => off());
    this.offs.clear();
    await Promise.all(sessions.map((session) => session.dispose()));
    this.setState((state) => ({ ...state, links: [], messages: [] }));
    this.views.clear();
  }

  // ==========================================================================
  // 内部：会话装配与事件投影
  // ==========================================================================

  private createSession(linkId: string, params: AgentLinkOpenParams): AgentLinkSession {
    const session = createAgentLinkSession({
      linkId,
      params,
      transport: this.transport,
      now: this.now,
      createId: this.createId,
      ...(this.timing ?? {}),
    });
    this.sessions.set(linkId, session);
    this.offs.set(
      linkId,
      session.subscribe((event) => this.project(linkId, event))
    );
    return session;
  }

  /** 单次会话事件 → 状态投影。每个事件一次 setState：合并会让 HUD 少看到中间态（相位要看得见）。 */
  private project(linkId: string, event: AgentLinkSessionEvent): void {
    switch (event.type) {
      case 'phase': {
        this.patchView(linkId, {
          phase: event.phase,
          phaseReason: event.reason,
          connectedAt: event.phase === 'connected' ? event.at : null,
          lastError: event.phase === 'error' ? event.reason : null,
        });
        this.noticeForPhase(linkId, event);
        return;
      }
      case 'identity':
        this.patchView(linkId, { agentId: event.agentId, sessionId: event.sessionId });
        return;
      case 'message':
        this.appendMessage(event.message);
        return;
      case 'status':
        this.applyRemoteStatus(event.agentId, event.status);
        return;
      case 'error':
        // 去重：同一句错误连着报多次只推一条 Notice（错误风暴会淹没 HUD）
        if (this.views.get(linkId)?.lastError !== event.message) {
          this.patchView(linkId, { lastError: event.message });
          this.notice('error', `[agent-link:${linkId}] ${event.message}`);
        }
        return;
      case 'raw':
        // 未归一事件不进 notices（否则一条协议探针就能刷屏），需要时由 dev 入口接 onRawEvent
        return;
      default:
        return;
    }
  }

  private noticeForPhase(linkId: string, event: Extract<AgentLinkSessionEvent, { type: 'phase' }>): void {
    const name = this.views.get(linkId)?.displayName ?? linkId;
    switch (event.phase) {
      case 'connected':
        this.notice('info', `[agent-link] ${name} 已连接`);
        return;
      case 'error':
        this.notice('error', `[agent-link] ${name} 连接失败${event.reason ? `：${event.reason}` : ''}`);
        return;
      case 'closed':
        this.notice('info', `[agent-link] ${name} 已断开`);
        return;
      default:
        return;
    }
  }

  /** 远端状态 → 同 id 的 UnitView。单位不存在时不凭空造单位（ battlefield 单位的生杀在 world 层）。 */
  private applyRemoteStatus(agentId: string | null, status: UnitStatus): void {
    if (!agentId) return;
    this.setState((state) => ({ ...state, units: patchUnitStatus(state.units, agentId, status) }));
  }

  private appendMessage(message: AgentMessageView): void {
    this.setState((state) => ({
      ...state,
      messages: pruneMessages([...state.messages, message], this.maxMessagesPerLink, this.maxMessages),
    }));
  }

  // ==========================================================================
  // store 写入（一律合并成一次 setState，避免半成品状态被广播）
  // ==========================================================================

  private setState(update: (state: ReturnType<CoreStore['getState']>) => ReturnType<CoreStore['getState']>): void {
    this.store.setState(update);
  }

  private initialView(linkId: string, params: AgentLinkOpenParams): AgentLinkView {
    return {
      id: linkId,
      kind: params.kind,
      displayName: params.displayName ?? redactEndpoint(params.endpoint),
      phase: 'idle',
      phaseReason: null,
      agentId: params.agentId ?? null,
      sessionId: params.sessionId ?? null,
      // 端点脱敏后才进状态：URL 里可能带凭据，HUD 只需要知道"连的是谁"
      endpoint: redactEndpoint(params.endpoint),
      connectedAt: null,
      lastError: null,
    };
  }

  private putView(view: AgentLinkView): void {
    this.views.set(view.id, view);
    this.setState((state) => ({ ...state, links: [...this.views.values()] }));
  }

  private patchView(linkId: string, patch: Partial<AgentLinkView>): void {
    const current = this.views.get(linkId);
    if (!current) return;
    const next = { ...current, ...patch };
    this.views.set(linkId, next);
    this.setState((state) => ({ ...state, links: [...this.views.values()] }));
  }

  private requireView(linkId: string): AgentLinkView {
    const view = this.views.get(linkId);
    if (!view) throw new AgentLinkError('not-found', `link ${linkId} not found`);
    return view;
  }

  private requireSession(linkId: string): AgentLinkSession {
    const session = this.sessions.get(linkId);
    if (!session) throw new AgentLinkError('not-found', `link ${linkId} not found`);
    return session;
  }

  private countConnected(): number {
    let count = 0;
    this.views.forEach((view) => {
      if (view.phase === 'connected') count += 1;
    });
    return count;
  }

  private notice(level: NoticeLevel, text: string): void {
    const at = this.now();
    this.store.pushNotice({ id: this.createId('notice'), level, text, createdAt: at, expiresAt: at + NOTICE_TTL_MS });
  }
}

// ============================================================================
// 纯函数（导出以便单测与复用）
// ============================================================================

/**
 * 消息裁剪：**每个会话各保最近 maxPerLink 条，再全局保最近 maxTotal 条**。
 * why 两级：多会话并行时不能让一个话痨 agent 挤掉其他 agent 的上下文（单会话上限），
 * 同时总量必须有硬顶（全局上限）——否则长跑会话会把 WorldState 撑到每次广播都变重。
 * why 倒序扫描：一次遍历即可同时满足两级"保最新"，且不需要先排序（消息天然按时间入列）。
 * 输入 messages 按时间正序（appendMessage 保证），输出同样正序。
 */
export function pruneMessages(
  messages: readonly AgentMessageView[],
  maxPerLink: number,
  maxTotal: number
): AgentMessageView[] {
  const perLinkSeen = new Map<string, number>();
  const kept: AgentMessageView[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const seen = (perLinkSeen.get(message.linkId) ?? 0) + 1;
    if (seen > maxPerLink) continue;
    perLinkSeen.set(message.linkId, seen);
    kept.push(message);
  }
  kept.reverse();
  return kept.slice(Math.max(0, kept.length - maxTotal));
}

/** 远端状态回写单位。独立成函数便于单测（core/unit 与 agent-link 共用 UnitStatus 词表）。 */
export function patchUnitStatus<T extends { id: string; status: string }>(units: readonly T[], agentId: string, status: T['status']): T[] {
  return units.map((unit) => (unit.id === agentId ? { ...unit, status } : unit));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAgentLinkManager(options: AgentLinkManagerOptions): AgentLinkManager {
  return new Manager(options);
}