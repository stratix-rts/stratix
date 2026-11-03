/**
 * 文件职责：**会话面板** Web Component（`<strat-session-panel>`）—— 「多会话管理」的 UI 入口：
 *   ① kind 筛选筹码（全部 / 聊天 / 互聊 / 任务 / 编队 / 连接）；
 *   ② 会话列表（core 自动起名的标题 + 状态徽标 + 最近活动时间 + 事件数）；
 *   ③ 进行中会话行内的「中断」钮 → 发 `session.interrupt` 命令（core 状态机裁决）；
 *      被中断的**互聊**会话行内的「恢复」钮 → 发 `session.resume` 命令
 *      （@since v3.47，task_101；续跑由互聊引擎接手，裁决在 core/session + 引擎）；
 *   ④ 点击会话行展开**历史抽屉**：按 kind 路由到对应读取器
 *      （character_chat → 角色对话历史 / peer_chat·task_run → 会话事件流 /
 *        mission_run → 任务单详情引用 / shell_link → 命令行消息投影），滚动到顶加载更早一页；
 *      抽屉里每条**会话事件**旁有「从这里分叉」钮（@since v3.48，task_102）→
 *      发 `session.fork` 命令（atSeq = 该事件的 seq，裁决在 core/session 的 manager.fork）。
 *   数据源：WorldState.sessions 订阅（core 广播即刷新，**零轮询**）。
 *   派生逻辑（筛选 / 徽标 / 截断 / 时间 / 两路投影）全在 session-catalog.ts（纯逻辑，可单测）。
 * 来源：docs/SESSION-PLAN.md §4「HUD 会话面板」+ task_095（v3.2a S5）。
 * 输入：注入的依赖（adapter：subscribe 吃 WorldState / dispatch 发命令；history：历史读取口）。
 * 输出：Shadow DOM 面板。
 * 禁止事项：
 *   1. import world/、gateway 内部、phaser、vue、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— 一律经注入的 adapter 订阅状态 / 发命令；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token（双 token 皮肤：default / pixel 同源）；
 *   4. 编造历史 —— 读取口缺席就说"未附着"，读取失败就说"失败"，绝不拿假数据充数；
 *   5. 泄漏监听器 —— disconnectedCallback 必须退订；
 *   6. 在本组件里跑定时器 / 轮询 —— 刷新只由总线广播驱动。
 *
 * 空态语义（三档，别混）：
 *   - 一条会话都没有 → 引导文案（怎么才会有会话）；
 *   - 筛选档下没有 → 明说"该筛选下没有会话"（是筛选结果，不是没有会话）；
 *   - 历史读不到 → 分「未附着」与「读取失败」两档如实说明。
 */

import type { HudCommand, SessionRecord, WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';

import {
  SESSION_KIND_FILTERS,
  activeCount,
  canFork,
  canInterrupt,
  canResume,
  formatRelativeTime,
  isResumableHint,
  kindLabel,
  missionReferenceEntries,
  shellLinkEntries,
  statusLabel,
  truncateTitle,
  visibleSessions,
  type SessionHistoryEntry,
  type SessionHistoryPort,
  type SessionKindFilter,
} from './session-catalog';

export const SESSION_PANEL_TAG = 'strat-session-panel';

/** 历史一页的条数（与聊天历史窗口同量级）。 */
export const SESSION_HISTORY_PAGE_SIZE = 50;

/**
 * 面板需要的依赖面。
 * why history 是可选的：读取口缺席（非 Electron / service 未起）时面板仍可用 ——
 *   列表照常显示，只是历史抽屉说"未附着"。缺省 = 不显示假数据。
 */
export interface SessionPanelDeps {
  /** 总线适配器（subscribe 吃状态 / dispatch 发命令）。 */
  readonly adapter: Pick<HudBusAdapter, 'dispatch' | 'subscribe'>;
  /** 历史读取口（两路真 IO）；缺省 = 历史未附着。 */
  readonly history?: SessionHistoryPort;
}

/** 历史抽屉的读态。 */
export type SessionHistoryStatus = 'idle' | 'loading' | 'loaded' | 'error' | 'unattached';

/** 抽屉内部状态（一次只展开一条会话）。 */
interface HistoryState {
  readonly sessionId: string;
  readonly entries: readonly SessionHistoryEntry[];
  /** 最早一条的游标（下一段更早的历史从这儿接着读；null = 没有更早的）。 */
  readonly cursor: string | null;
  /** 是否还有更早的一页。 */
  readonly hasEarlier: boolean;
  readonly status: SessionHistoryStatus;
  readonly error: string | null;
}

/** 自定义元素的对外形状（测试与挂载方按它断言）。 */
export interface StratSessionPanelElement extends HTMLElement {
  /** 注入的依赖；在 connected 之前或之后设置都生效。 */
  deps: SessionPanelDeps | null;
  /** 折叠态（折叠时只留标题栏 —— 面板常驻但不抢视野）。 */
  readonly collapsed: boolean;
  toggleCollapsed(): void;
  /** 当前 kind 筛选档。 */
  readonly kindFilter: SessionKindFilter;
  setKindFilter(filter: SessionKindFilter): void;
  /** 当前可见的会话（已筛选 + 已排序）。 */
  readonly visibleSessions: readonly SessionRecord[];
  /** 展开历史的会话 id；未展开为 null。 */
  readonly expandedSessionId: string | null;
  /** 展开某条会话的历史（再点同一行 = 收起）。 */
  expandSession(sessionId: string | null): void;
  /** 抽屉里的历史条目。 */
  readonly historyEntries: readonly SessionHistoryEntry[];
  /** 抽屉读态。 */
  readonly historyStatus: SessionHistoryStatus;
  /** 抽屉错误说明（读失败时）。 */
  readonly historyError: string | null;
  /** 强制重算重渲染。 */
  refresh(): void;
  /** 最近一次收到的 WorldState。 */
  readonly lastState: WorldState | null;
}

/** HTML 文本转义。会话标题 / 消息正文含外部输入，必须转义后才进 innerHTML。 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] as string);
}

/** 错误 → 人话（不把 stack 甩给用户）。 */
function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return '读取失败';
}

/**
 * 工厂：注册 `<strat-session-panel>`。
 * 幂等（与 defineLogDrawer / defineCommandPanel 同约定）：重复 register 返回已注册构造器。
 */
export function defineSessionPanel(): typeof HTMLElement {
  if (customElements.get(SESSION_PANEL_TAG)) {
    return customElements.get(SESSION_PANEL_TAG) as unknown as typeof HTMLElement;
  }

  class SessionPanel extends HTMLElement implements StratSessionPanelElement {
    private _deps: SessionPanelDeps | null = null;
    private _state: WorldState | null = null;
    private _kindFilter: SessionKindFilter = 'all';
    private _collapsed = true;
    private _expandedId: string | null = null;
    private _history: HistoryState | null = null;
    /** 竞态守卫：切会话后，旧请求的结果必须丢弃（否则会把上一条会话的历史画到新会话下）。 */
    private _historyToken = 0;
    private _unsubscribe: (() => void) | null = null;
    private _listenersBound = false;
    private _lastSignature: string | null = null;

    // —— 属性面 ——
    get deps(): SessionPanelDeps | null { return this._deps; }
    set deps(value: SessionPanelDeps | null) {
      this._deps = value;
      this.bindDeps();
      this.refresh();
    }

    get collapsed(): boolean { return this._collapsed; }
    get kindFilter(): SessionKindFilter { return this._kindFilter; }
    get visibleSessions(): readonly SessionRecord[] {
      return visibleSessions(this._state?.sessions, this._kindFilter);
    }
    get expandedSessionId(): string | null { return this._expandedId; }
    get historyEntries(): readonly SessionHistoryEntry[] { return this._history?.entries ?? []; }
    get historyStatus(): SessionHistoryStatus { return this._history?.status ?? 'idle'; }
    get historyError(): string | null { return this._history?.error ?? null; }
    get lastState(): WorldState | null { return this._state; }

    connectedCallback(): void {
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.renderChrome();
      // 折叠态同时挂 host 属性（面板外也能看到；CSS 的 :host([collapsed]) 靠它生效）。
      this.toggleAttribute('collapsed', this._collapsed);
      // 清签名强制首绘：挂载前 deps setter 那次 refresh 已把签名记下，
      // 而那时还没有 shadowRoot —— 不清掉这次就会被判重跳过。
      this._lastSignature = null;
      this.bindDeps();
      this.refresh();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：不退订的话，反复挂卸会把订阅堆成 O(n)。
      this.releaseDeps();
      this._lastSignature = null;
    }

    // —— 交互 ——
    toggleCollapsed(): void {
      this._collapsed = !this._collapsed;
      // 同时挂 host 属性：面板外（样式 / 测试 / 布局）也能看到折叠态。
      this.toggleAttribute('collapsed', this._collapsed);
      this.refresh();
    }

    setKindFilter(filter: SessionKindFilter): void {
      if (this._kindFilter === filter) return;
      this._kindFilter = filter;
      // 换档后抽屉里那条会话可能已不在可见列表 —— 收起它（别留一条看不见的展开态）。
      if (this._expandedId && !this.visibleSessions.some((s) => s.id === this._expandedId)) {
        this.expandSession(null);
        return;
      }
      this.refresh();
    }

    expandSession(sessionId: string | null): void {
      // 再点同一行 = 收起（next 取反；null 永远表示"收起"，不递归）。
      const next = this._expandedId === sessionId ? null : sessionId;
      this._expandedId = next;
      this._history = null;
      if (next === null) {
        this.refresh();
        return;
      }
      const session = this.sessionById(next);
      if (!session) {
        this._expandedId = null;
        this.refresh();
        return;
      }
      void this.loadHistoryPage(next, undefined, 'first');
    }

    refresh(): void {
      const signature = this.renderSignature();
      if (signature === this._lastSignature) return;
      this._lastSignature = signature;
      this.render();
    }

    // —— 订阅生命周期 ——
    private bindDeps(): void {
      if (!this.isConnected || !this._deps || this._unsubscribe) return;
      this._unsubscribe = this._deps.adapter.subscribe((state) => {
        this._state = state;
        this.refresh();
      });
    }

    private releaseDeps(): void {
      if (!this._unsubscribe) return;
      this._unsubscribe();
      this._unsubscribe = null;
    }

    private sessionById(sessionId: string): SessionRecord | null {
      return (this._state?.sessions ?? []).find((s) => s.id === sessionId) ?? null;
    }

    // —— 历史读取（kind 路由）——
    /**
     * 读一页历史。**kind 路由**在这一处收口：
     *   character_chat → 角色对话历史（读取口）；
     *   peer_chat / task_run → 会话事件流（读取口）；
     *   mission_run → 任务单详情引用（WorldState 投影，不走 IO）；
     *   shell_link → 命令行消息投影（WorldState 投影，不走 IO）。
     * 返回三档结果：读到了 / 未附着 / 读失败 —— 三者在抽屉里显示不同的文案，绝不混同。
     */
    private async readHistory(
      session: SessionRecord,
      before?: string
    ): Promise<
      | { readonly kind: 'ok'; readonly entries: readonly SessionHistoryEntry[] }
      | { readonly kind: 'unattached'; readonly reason: string }
      | { readonly kind: 'error'; readonly reason: string }
    > {
      const port = this._deps?.history;
      try {
        switch (session.kind) {
          case 'character_chat': {
            const reader = port?.loadCharacterChat;
            if (!reader) return { kind: 'unattached', reason: '角色对话历史读取器未附着' };
            const characterId = session.participants[0] ?? session.refId ?? '';
            if (!characterId) return { kind: 'unattached', reason: '这条会话没有角色标识，读不到历史' };
            return { kind: 'ok', entries: await reader(characterId, SESSION_HISTORY_PAGE_SIZE, before) };
          }
          case 'peer_chat':
          case 'task_run': {
            const reader = port?.loadSessionEvents;
            if (!reader) return { kind: 'unattached', reason: '会话事件读取器未附着' };
            return { kind: 'ok', entries: await reader(session.id, SESSION_HISTORY_PAGE_SIZE, before) };
          }
          case 'mission_run':
            return { kind: 'ok', entries: missionReferenceEntries(session, this._state) };
          case 'shell_link':
            return { kind: 'ok', entries: shellLinkEntries(session, this._state) };
          default:
            return { kind: 'unattached', reason: '未知的会话种类，读不到历史' };
        }
      } catch (error: unknown) {
        return { kind: 'error', reason: describeError(error) };
      }
    }

    /** 读一页历史并落到抽屉状态（'first' = 换页重读；'earlier' = 往前翻一页并前插）。 */
    private async loadHistoryPage(
      sessionId: string,
      before: string | undefined,
      mode: 'first' | 'earlier'
    ): Promise<void> {
      const session = this.sessionById(sessionId);
      if (!session) return;
      const token = ++this._historyToken;
      const previous = this._history;
      this._history = {
        sessionId,
        entries: mode === 'earlier' ? previous?.entries ?? [] : [],
        cursor: mode === 'earlier' ? previous?.cursor ?? null : null,
        hasEarlier: mode === 'earlier' ? previous?.hasEarlier ?? false : false,
        status: 'loading',
        error: null,
      };
      this.refresh();

      const result = await this.readHistory(session, before);
      if (token !== this._historyToken) return; // 竞态：已切到别的会话，丢弃本次结果

      if (result.kind === 'unattached') {
        this._history = {
          sessionId,
          entries: [],
          cursor: null,
          hasEarlier: false,
          status: 'unattached',
          error: result.reason,
        };
        this.refresh();
        return;
      }
      if (result.kind === 'error') {
        this._history = {
          sessionId,
          entries: mode === 'earlier' ? previous?.entries ?? [] : [],
          cursor: mode === 'earlier' ? previous?.cursor ?? null : null,
          hasEarlier: mode === 'earlier' ? previous?.hasEarlier ?? false : false,
          status: 'error',
          error: result.reason,
        };
        this.refresh();
        return;
      }

      const merged =
        mode === 'earlier' ? [...result.entries, ...(previous?.entries ?? [])] : [...result.entries];
      const oldest = merged[0];
      this._history = {
        sessionId,
        entries: merged,
        cursor: oldest?.cursor ?? null,
        // 满页 = 可能还有更早的（与聊天抽屉同一口径）；不满页 = 到底了。
        hasEarlier: result.entries.length >= SESSION_HISTORY_PAGE_SIZE,
        status: 'loaded',
        error: null,
      };
      this.refresh();
    }

    /** 往前翻一页（滚动到顶 / 点「加载更早」）。 */
    private loadEarlier(): void {
      const history = this._history;
      if (!history || !history.hasEarlier || history.status === 'loading') return;
      if (!history.cursor) return;
      const body = this.shadowRoot?.querySelector<HTMLElement>('[data-role="drawer-body"]');
      const prevHeight = body?.scrollHeight ?? 0;
      const prevTop = body?.scrollTop ?? 0;
      void this.loadHistoryPage(history.sessionId, history.cursor, 'earlier').then(() => {
        // 前插后把视口锚回原处（否则新内容一进来就把用户顶走）。
        const after = this.shadowRoot?.querySelector<HTMLElement>('[data-role="drawer-body"]');
        if (after) after.scrollTop = Math.max(0, after.scrollHeight - prevHeight + prevTop);
      });
    }

    /** 中断一条会话：发 session.interrupt 命令（裁决在 core/session 的状态机里）。 */
    private interrupt(sessionId: string): void {
      const adapter = this._deps?.adapter;
      if (!adapter) return;
      const command: HudCommand = { type: 'session.interrupt', sessionId };
      adapter.dispatch(command);
    }

    /**
     * 恢复一条被中断的互聊会话：发 session.resume 命令（@since v3.47，task_101）。
     * why 与「中断」同一模式：面板只**发命令**，不自己裁决能不能恢复 ——
     *   准入（kind / 状态 / 角色是否还在场）由 core/session 的状态机与互聊引擎裁决，
     *   面板若自己判断就会与真相分叉（"按钮能点但点了必被拒"是最伤的一种体验）。
     */
    private resume(sessionId: string): void {
      const adapter = this._deps?.adapter;
      if (!adapter) return;
      const command: HudCommand = { type: 'session.resume', sessionId };
      adapter.dispatch(command);
    }

    /**
     * 从某条事件分叉：发 session.fork 命令（@since v3.48，task_102 / v3.2b-B3）。
     *
     * atSeq = 那条事件的 seq（**含**该序号）—— 面板只负责把"从哪儿分叉"说清楚，
     *   能不能分叉、复制多少、标题怎么继承全由 core/session 的 manager.fork 裁决
     *   （面板自己判就会与真相分叉：给出"点了必被拒"的按钮是最伤的一种体验）。
     */
    private fork(sessionId: string, atSeq: number): void {
      const adapter = this._deps?.adapter;
      if (!adapter) return;
      const command: HudCommand = { type: 'session.fork', sessionId, atSeq };
      adapter.dispatch(command);
    }

    // —— 渲染 ——
    /** 渲染签名：会话摘要 + 筛选档 + 折叠态 + 展开项 + 抽屉状态。 */
    private renderSignature(): string {
      const sessions = this._state?.sessions ?? [];
      const history = this._history;
      const historyPart = history
        ? `${history.sessionId}:${history.status}:${history.entries.length}:${history.cursor ?? ''}:${history.hasEarlier}`
        : '-';
      return `${sessions
        .map((r) => `${r.id}:${r.kind}:${r.status}:${r.title}:${r.lastEventAt}:${r.eventCount}`)
        .join('|')}#${this._kindFilter}#${this._collapsed ? 'c' : 'e'}#${this._expandedId ?? '-'}#${historyPart}`;
    }

    private renderChrome(): void {
      const root = this.shadowRoot;
      if (!root) return;

      root.innerHTML = `
        <style>
          :host { all: initial; display: block; }
          .panel {
            display: grid;
            gap: var(--srf-spacing-sm);
            padding: var(--srf-spacing-md);
            background: var(--srf-panel);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            color: var(--srf-text);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-md);
            line-height: var(--srf-line-height);
          }
          .head { display: flex; align-items: center; gap: var(--srf-spacing-sm); min-width: 0; }
          .title { font-size: var(--srf-font-size-lg); font-weight: var(--srf-font-weight-semibold); }
          .summary { flex: 1; color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          button.chip {
            flex: none;
            padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
            background: var(--srf-panel-elevated);
            color: var(--srf-text-muted);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-xs);
            cursor: pointer;
            transition: color var(--srf-transition), background var(--srf-transition), border-color var(--srf-transition);
          }
          button.chip:hover { color: var(--srf-text); border-color: var(--srf-border-strong); }
          button.chip:active { background: var(--srf-panel); }
          button.chip:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          button.chip[aria-pressed="true"] { color: var(--srf-accent); border-color: var(--srf-accent); }
          /* 分叉钮（@since v3.48，task_102）：行内小钮，靠右贴边（entry-head 是 flex 行）。 */
          button.chip.fork {
            margin-left: auto;
            align-self: center;
            padding: var(--srf-spacing-xxs) var(--srf-spacing-xs);
            font-size: var(--srf-font-size-xs);
            color: var(--srf-accent);
            border-color: var(--srf-accent);
          }
          .body {
            display: grid;
            gap: var(--srf-spacing-sm);
            min-height: 0;
            /* 出入场过渡（@since v3.6，task_121）：展开 / 收起各有 140ms 淡入淡出。
               why 用 allow-discrete + @starting-style：display:none 会掐断过渡，
               改成离散过渡后收起能播完淡出、展开能播淡入（纯 CSS，无 JS 计时器）。 */
            opacity: 1;
            transform: translateY(0);
            transition: opacity 140ms ease-out, transform 140ms ease-out, display 140ms allow-discrete;
          }
          :host([collapsed]) .body { display: none; opacity: 0; transform: translateY(-6px); }
          @starting-style {
            .body { opacity: 0; transform: translateY(-6px); }
          }
          .filters { display: flex; flex-wrap: wrap; gap: var(--srf-spacing-xs); }
          .rows { display: grid; gap: var(--srf-spacing-xxs); max-height: 16em; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--srf-border-strong) transparent; }
          .rows::-webkit-scrollbar { width: var(--srf-spacing-sm); }
          .rows::-webkit-scrollbar-thumb { background: var(--srf-border-strong); border-radius: var(--srf-radius-pill); }
          .row {
            display: grid;
            grid-template-columns: 1fr auto;
            align-items: center;
            gap: var(--srf-spacing-xxs) var(--srf-spacing-xs);
            padding: var(--srf-spacing-xs);
            border-radius: var(--srf-radius);
            background: var(--srf-panel-elevated);
            border: var(--srf-border-width) solid transparent;
          }
          .row[data-expanded="true"] { border-color: var(--srf-accent); }
          .row-main {
            grid-column: 1;
            display: grid;
            grid-template-columns: 1fr auto;
            gap: var(--srf-spacing-xxs) var(--srf-spacing-xs);
            align-items: center;
            min-width: 0;
            padding: 0;
            background: none;
            border: none;
            color: inherit;
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-sm);
            text-align: left;
            cursor: pointer;
          }
          .row-main:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          .row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .row-meta { grid-column: 1 / -1; color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); }
          .badge { padding: var(--srf-spacing-xxs) var(--srf-spacing-xs); border: var(--srf-border-width) solid var(--srf-border-strong); border-radius: var(--srf-radius-pill); font-size: var(--srf-font-size-xs); white-space: nowrap; }
          .badge[data-kind="character_chat"] { color: var(--srf-accent); border-color: var(--srf-accent); }
          .badge[data-kind="peer_chat"] { color: var(--srf-success); border-color: var(--srf-success); }
          .badge[data-kind="task_run"] { color: var(--srf-badge-accent, var(--srf-accent)); border-color: var(--srf-border-strong); }
          .badge[data-kind="mission_run"] { color: var(--srf-badge-accent, var(--srf-accent)); border-color: var(--srf-border-strong); }
          .badge[data-kind="shell_link"] { color: var(--srf-text-muted); }
          .badge.status[data-status="active"] { color: var(--srf-success); border-color: var(--srf-success); }
          .badge.status[data-status="idle"] { color: var(--srf-text-muted); }
          .badge.status[data-status="interrupted"] { color: var(--srf-warn); border-color: var(--srf-warn); }
          .badge.status[data-status="closed"] { color: var(--srf-text-disabled); }
          .row-hint { grid-column: 1 / -1; color: var(--srf-warn); font-size: var(--srf-font-size-xs); }
          button.interrupt {
            grid-column: 2;
            padding: var(--srf-spacing-xxs) var(--srf-spacing-xs);
            background: var(--srf-panel-elevated);
            color: var(--srf-danger);
            border: var(--srf-border-width) solid var(--srf-danger);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-xs);
            cursor: pointer;
          }
          button.interrupt:hover { background: var(--srf-danger); color: var(--srf-bg); }
          button.interrupt:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          button.resume {
            grid-column: 2;
            padding: var(--srf-spacing-xxs) var(--srf-spacing-xs);
            background: var(--srf-panel-elevated);
            color: var(--srf-success);
            border: var(--srf-border-width) solid var(--srf-success);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-xs);
            cursor: pointer;
          }
          button.resume:hover { background: var(--srf-success); color: var(--srf-bg); }
          button.resume:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          .empty { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); text-align: center; padding: var(--srf-spacing-lg) var(--srf-spacing-sm); border: var(--srf-border-width) dashed var(--srf-border); border-radius: var(--srf-radius); }
          .drawer {
            display: grid;
            gap: var(--srf-spacing-xs);
            padding: var(--srf-spacing-sm);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            background: var(--srf-panel-elevated);
          }
          .drawer-head { display: flex; align-items: center; gap: var(--srf-spacing-xs); min-width: 0; }
          .drawer-title { flex: 1; font-size: var(--srf-font-size-sm); font-weight: var(--srf-font-weight-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .drawer-body { display: grid; gap: var(--srf-spacing-xxs); max-height: 14em; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--srf-border-strong) transparent; }
          .drawer-body::-webkit-scrollbar { width: var(--srf-spacing-sm); }
          .drawer-body::-webkit-scrollbar-thumb { background: var(--srf-border-strong); border-radius: var(--srf-radius-pill); }
          .entry { display: grid; gap: var(--srf-spacing-xxs); padding: var(--srf-spacing-xxs); border-radius: var(--srf-radius); background: var(--srf-panel); }
          .entry-head { display: flex; gap: var(--srf-spacing-xs); align-items: baseline; }
          .entry-author { font-size: var(--srf-font-size-xs); font-weight: var(--srf-font-weight-semibold); }
          .entry-time { color: var(--srf-text-disabled); font-size: var(--srf-font-size-xs); font-family: var(--srf-font-mono); }
          .entry-text { font-size: var(--srf-font-size-xs); white-space: pre-wrap; word-break: break-word; }
          .entry[data-tone="warn"] .entry-text { color: var(--srf-warn); }
          .entry[data-tone="error"] .entry-text { color: var(--srf-danger); }
          .drawer-note { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); text-align: center; padding: var(--srf-spacing-xs); }
        </style>
        <div class="panel" part="panel">
          <div class="head">
            <span class="title">会话</span>
            <span class="summary" data-role="summary">等待世界状态…</span>
            <button type="button" class="chip" data-action="collapse">展开</button>
          </div>
          <div class="body" data-role="body"></div>
        </div>
      `;

      if (!this._listenersBound) {
        this._listenersBound = true;

        // 事件委托：一个监听器管住筹码 / 行 / 抽屉里的所有动作（避免每次重画都重新绑）。
        root.addEventListener('click', (ev: Event) => {
          const target = ev.target as HTMLElement | null;
          if (!target) return;
          const holder = target.closest?.('[data-action]') as HTMLElement | null;
          if (!holder) return;
          const action = holder.getAttribute('data-action');
          const sessionId = holder.getAttribute('data-session') ?? '';
          if (action === 'collapse') this.toggleCollapsed();
          else if (action === 'filter') {
            const kind = holder.getAttribute('data-kind') as SessionKindFilter | null;
            if (kind) this.setKindFilter(kind);
          } else if (action === 'expand') this.expandSession(sessionId);
          else if (action === 'interrupt') this.interrupt(sessionId);
          else if (action === 'resume') this.resume(sessionId);
          else if (action === 'fork') {
            // atSeq 从按钮上读（每条事件一个钮，值 = 该事件的 seq）。
            const atSeq = Number.parseInt(holder.getAttribute('data-at-seq') ?? '', 10);
            if (Number.isFinite(atSeq)) this.fork(sessionId, atSeq);
          }
          else if (action === 'close-drawer') this.expandSession(null);
          else if (action === 'load-earlier') this.loadEarlier();
          else if (action === 'retry') {
            const history = this._history;
            if (history) void this.loadHistoryPage(history.sessionId, undefined, 'first');
          }
        });

        // 滚动到顶 = 加载更早一页（与聊天抽屉同一交互口径）。
        root.addEventListener('scroll', (ev: Event) => {
          const target = ev.target as HTMLElement | null;
          if (target?.dataset?.role !== 'drawer-body') return;
          if (target.scrollTop !== 0) return;
          this.loadEarlier();
        }, true);
      }
    }

    private render(): void {
      const root = this.shadowRoot;
      if (!root) return;

      const summary = root.querySelector('[data-role="summary"]');
      const collapseBtn = root.querySelector<HTMLButtonElement>('button[data-action="collapse"]');
      if (collapseBtn) collapseBtn.textContent = this._collapsed ? '展开' : '收起';

      const sessions = this._state?.sessions ?? [];
      const visible = this.visibleSessions;
      if (summary) {
        summary.textContent =
          this._state === null
            ? '等待世界状态…'
            : `${visible.length} / ${sessions.length} 条 · ${activeCount(sessions)} 进行中`;
      }

      const body = root.querySelector('[data-role="body"]');
      if (!body) return;
      if (this._collapsed) {
        body.innerHTML = ''; // 折叠时连 DOM 都不建（省内存，也不占布局）
        return;
      }

      body.innerHTML = `
        ${this.renderFilters()}
        ${this.renderRows(visible, sessions.length)}
        ${this.renderDrawer()}
      `;
    }

    /** 筛选筹码行（全部 + 五种 kind）。 */
    private renderFilters(): string {
      const chips = SESSION_KIND_FILTERS.map(
        (spec) =>
          `<button type="button" class="chip" data-action="filter" data-kind="${escapeHtml(spec.id)}" aria-pressed="${this._kindFilter === spec.id}">${escapeHtml(spec.label)}</button>`
      ).join('');
      return `<div class="filters" data-role="filters">${chips}</div>`;
    }

    /** 会话行列表（含空态）。 */
    private renderRows(visible: readonly SessionRecord[], total: number): string {
      if (total === 0) {
        return `<div class="empty" data-role="empty">还没有会话。<br/>发起角色对话、互聊或任务后，会话会出现在这里（可中断、可查历史）。</div>`;
      }
      if (visible.length === 0) {
        return `<div class="empty" data-role="empty">该筛选下没有会话</div>`;
      }
      const now = Date.now();
      const rows = visible.map((record) => this.renderRow(record, now)).join('');
      return `<div class="rows" data-role="rows">${rows}</div>`;
    }

    private renderRow(record: SessionRecord, now: number): string {
      const expanded = this._expandedId === record.id;
      const title = truncateTitle(record.title);
      const meta = `${formatRelativeTime(record.lastEventAt, now)} · ${record.eventCount} 事件`;
      const hint = isResumableHint(record)
        ? `<span class="row-hint" data-role="resumable-hint">${canResume(record) ? '已中断 · 可恢复续聊' : '已中断'}</span>`
        : '';
      const interrupt = canInterrupt(record)
        ? `<button type="button" class="interrupt" data-action="interrupt" data-session="${escapeHtml(record.id)}">中断</button>`
        : '';
      // 恢复钮（@since v3.47，task_101）：只给「被中断的互聊会话」（canResume 的判定在 catalog）。
      //   与「中断」钮互斥 —— 一行最多一个动作钮（两个都占 grid-column 2）。
      const resume = canResume(record)
        ? `<button type="button" class="resume" data-action="resume" data-session="${escapeHtml(record.id)}">恢复</button>`
        : '';
      return `
        <div class="row" data-role="row" data-session="${escapeHtml(record.id)}" data-kind="${escapeHtml(record.kind)}" data-status="${escapeHtml(record.status)}" data-expanded="${expanded}">
          <button type="button" class="row-main" data-action="expand" data-session="${escapeHtml(record.id)}">
            <span class="row-title" title="${escapeHtml(record.title)}">${escapeHtml(title)}</span>
            <span class="badge" data-kind="${escapeHtml(record.kind)}">${escapeHtml(kindLabel(record.kind))}</span>
            <span class="badge status" data-role="status-badge" data-status="${escapeHtml(record.status)}">${escapeHtml(statusLabel(record.status))}</span>
            <span class="row-meta" data-role="row-meta">${escapeHtml(meta)}</span>
          </button>
          ${hint}
          ${interrupt}
          ${resume}
        </div>
      `;
    }

    /** 历史抽屉（展开某条会话时才有）。 */
    private renderDrawer(): string {
      const sessionId = this._expandedId;
      if (!sessionId) return '';
      const session = this.sessionById(sessionId);
      if (!session) return '';
      const history = this._history;
      const title = `${kindLabel(session.kind)}：${session.title}`;

      let bodyHtml = '';
      if (!history || history.status === 'idle' || history.status === 'loading') {
        bodyHtml = '<div class="drawer-note" data-role="drawer-note">读取中…</div>';
      } else if (history.status === 'unattached') {
        bodyHtml = `<div class="drawer-note" data-role="drawer-note">${escapeHtml(history.error ?? '历史读取器未附着')}</div>`;
      } else if (history.status === 'error') {
        bodyHtml = `
          <div class="drawer-note" data-role="drawer-note">读取失败：${escapeHtml(history.error ?? '')}</div>
          <div class="drawer-foot"><button type="button" class="chip" data-action="retry">重试</button></div>
        `;
      } else if (history.entries.length === 0) {
        bodyHtml = '<div class="drawer-note" data-role="drawer-note">没有可读的历史记录</div>';
      } else {
        // 分叉入口（@since v3.48，task_102）：每条**会话事件**旁一个「从这里分叉」钮，
        //   atSeq = 该事件的 seq。按钮只在"这条会话可分叉 + 这条条目带 seq"时出现 ——
        //   角色对话那路的条目没有 seq（它的历史不在会话事件流里，分叉复制不到东西）。
        const forkable = canFork(session);
        const entries = history.entries
          .map((entry) => {
            const forkBtn =
              forkable && entry.seq !== undefined
                ? `<button type="button" class="chip fork" data-action="fork" data-session="${escapeHtml(session.id)}" data-at-seq="${escapeHtml(String(entry.seq))}" title="以这条事件为终点另起一条会话">从这里分叉</button>`
                : '';
            return `
              <div class="entry" data-role="entry" data-entry="${escapeHtml(entry.id)}" data-tone="${escapeHtml(entry.tone)}">
                <div class="entry-head">
                  <span class="entry-author" data-role="entry-author">${escapeHtml(entry.author)}</span>
                  <span class="entry-time" data-role="entry-time">${escapeHtml(formatRelativeTime(entry.at, Date.now()))}</span>
                  ${forkBtn}
                </div>
                <div class="entry-text" data-role="entry-text">${escapeHtml(entry.text)}</div>
              </div>
            `;
          })
          .join('');
        const more = history.hasEarlier
          ? '<div class="drawer-foot"><button type="button" class="chip" data-action="load-earlier">加载更早</button></div>'
          : '<div class="drawer-note" data-role="drawer-end">没有更早的记录了</div>';
        bodyHtml = `<div class="drawer-body" data-role="drawer-body">${entries}</div>${more}`;
      }

      return `
        <div class="drawer" data-role="drawer" data-session="${escapeHtml(session.id)}">
          <div class="drawer-head">
            <span class="drawer-title" data-role="drawer-title" title="${escapeHtml(session.title)}">${escapeHtml(truncateTitle(title, 32))}</span>
            <button type="button" class="chip" data-action="close-drawer">关闭</button>
          </div>
          ${bodyHtml}
        </div>
      `;
    }
  }

  customElements.define(SESSION_PANEL_TAG, SessionPanel);
  return SessionPanel as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：本仓库面板的统一装配口径（与 mountLogDrawer / mountCommandPanel 一致）——
 *   建元素、注入 deps、挂进容器，返回 unmount 闭包。
 */
export function mountSessionPanel(deps: SessionPanelDeps, host: HTMLElement): () => void {
  defineSessionPanel();
  const element = document.createElement(SESSION_PANEL_TAG) as StratSessionPanelElement;
  element.deps = deps;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订，订阅随之释放。
  return () => { element.remove(); };
}
