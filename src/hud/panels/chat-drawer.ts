/**
 * 文件职责：聊天抽屉 Web Component（`<strat-chat-drawer>`）—— 与**外部 agent**（core/agent-link
 *   管理的会话）的对话界面：会话列表 + 当前会话的消息流 + 输入框。
 *   视图模型派生与命令构造全在 chat-catalog.ts（纯逻辑），本文件只负责把模型画成 Shadow DOM，
 *   把"用户打字 / 点会话 / 点发送"变成 HudCommand 经注入的 adapter 派发。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 panels/ 层级 + §5 总线契约（links / messages / chat.send）；
 *   语义提取自 src/components/AgentChatModal.vue（消息列表 / Enter 发送 / 到底部滚动 / 空态，
 *   只读参考，未复制任何实现）。
 * 输入：注入的 HudBusAdapter（dispatch / subscribe 两个能力就够）；WorldState 快照。
 * 输出：Shadow DOM 抽屉；输入与会话切换 → HudCommand → adapter.dispatch。
 * 禁止事项：
 *   1. import world/、phaser、vue、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— HUD 一律经注入的 adapter 发命令与订阅状态；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token；
 *   4. 本地追加消息 / 本地改连接状态 —— 一律现算自 WorldState（links / messages 由 core/agent-link
 *      投影写入）。**本地乐观回显会让"发出去没"不可排查，本面板一行都不许本地加数据**；
 *   5. 泄漏监听器 —— disconnectedCallback 必须退订，否则元素反复挂卸会累积订阅（perf 硬约束）。
 *
 * 面板自己持有的瞬时态只有两样，都不是业务状态：
 *   - activeLinkId：用户正在看哪段对话（换会话 = 换个视图，不是业务变更）；
 *   - draft：输入框里的草稿（发出即清空，清的是输入框不是消息流）。
 *
 * 渲染策略（perf，与 command-panel / agent-panel 同一口径）：core 每次状态变更都全量广播，
 *   抽屉用 chatDrawerSignature 判重（只看当前会话的消息 + 会话相位），签名不变就跳过重渲染；
 *   外壳（含输入框）只在挂载时建一次，输入时光标不丢。
 */

import type { WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';

import type { ChatDrawerModel, ChatMessageRow, ChatSessionRow } from './chat-catalog';
import { buildChatSendCommand, chatDrawerSignature, formatMessageTime, resolveChatDrawer } from './chat-catalog';

export const CHAT_DRAWER_TAG = 'strat-chat-drawer';

/** 面板需要的最小能力面：只要"发命令"与"订阅状态"，与 command-panel / agent-panel 同一约定。 */
export type ChatDrawerDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'>;

/** 自定义元素的对外形状（测试与挂载方按它断言）。 */
export interface StratChatDrawerElement extends HTMLElement {
  /** 注入的适配器；在 connected 之前或之后设置都生效。 */
  adapter: ChatDrawerDeps | null;
  /** 当前查看的会话 id（面板展示态）。null = 未选，由 catalog 回落到第一个会话。 */
  activeLinkId: string | null;
  /** 输入框草稿（面板瞬时态，不是消息）。 */
  draft: string;
  /** 强制重算重渲染。 */
  refresh(): void;
  /** 最近一次派生出的视图模型。 */
  readonly model: ChatDrawerModel;
  /** 当前渲染出的会话 id（按渲染顺序）。 */
  readonly visibleSessionIds: readonly string[];
  /** 当前渲染出的消息 id（按渲染顺序，时间正序）。 */
  readonly visibleMessageIds: readonly string[];
  /** 当前会话的连接状态文案（无会话时为「无会话」）。 */
  readonly statusLabel: string;
  /** 最近一次收到的 WorldState。 */
  readonly lastState: WorldState | null;
}

/** HTML 文本转义。消息正文与端点含外部输入，必须转义后才进 innerHTML。 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] as string);
}

/**
 * 工厂：注册 `<strat-chat-drawer>`。
 * 幂等（与 defineCommandPanel / defineAgentPanel 同约定）：重复 register 返回已注册构造器，不抛错。
 */
export function defineChatDrawer(): typeof HTMLElement {
  if (customElements.get(CHAT_DRAWER_TAG)) {
    return customElements.get(CHAT_DRAWER_TAG) as unknown as typeof HTMLElement;
  }

  class ChatDrawer extends HTMLElement implements StratChatDrawerElement {
    private _adapter: ChatDrawerDeps | null = null;
    private _activeLinkId: string | null = null;
    private _draft = '';
    private _state: WorldState | null = null;
    private _model: ChatDrawerModel = resolveChatDrawer(null, null);
    private _lastSignature: string | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _listenersBound = false;

    // —— 属性面 ——
    get adapter(): ChatDrawerDeps | null { return this._adapter; }
    set adapter(value: ChatDrawerDeps | null) {
      this._adapter = value;
      this.bindAdapter();
      this.refresh();
    }

    get activeLinkId(): string | null { return this._activeLinkId; }
    set activeLinkId(value: string | null) {
      this._activeLinkId = value;
      this.refresh();
    }

    get draft(): string { return this._draft; }
    set draft(value: string) {
      this._draft = value;
      const box = this.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]');
      if (box && box.value !== value) box.value = value;
      this.syncComposer();
    }

    get model(): ChatDrawerModel { return this._model; }
    get lastState(): WorldState | null { return this._state; }
    get visibleSessionIds(): readonly string[] { return this._model.sessions.map((row) => row.id); }
    get visibleMessageIds(): readonly string[] { return this._model.messages.map((message) => message.id); }
    get statusLabel(): string { return this._model.active?.phaseLabel ?? '无会话'; }

    connectedCallback(): void {
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.renderChrome();
      // 清签名强制首绘：挂载前 adapter setter 那次 refresh 已记下签名，而那时还没有消息流可画
      this._lastSignature = null;
      this.bindAdapter();
      this.refresh();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：不退订的话，反复挂卸会把订阅堆成 O(n)，且元素已不在文档里仍在收广播。
      this.releaseAdapter();
      this._lastSignature = null;
    }

    refresh(): void {
      const signature = chatDrawerSignature(this._state, this._activeLinkId);
      if (signature === this._lastSignature) return;
      // 签名覆盖了会话相位与当前会话的全部消息，也就是 canSend 的全部输入 ——
      // 签名不变即"发送能力与消息流都没变"，输入区无需再动（renderBody 末尾已同步过一次）。
      this._lastSignature = signature;
      this._model = resolveChatDrawer(this._state, this._activeLinkId);
      this.renderBody();
    }

    // —— 订阅生命周期 ——
    private bindAdapter(): void {
      if (!this.isConnected || !this._adapter || this._unsubscribe) return;
      this._unsubscribe = this._adapter.subscribe((state) => {
        this._state = state;
        this.refresh();
      });
    }

    private releaseAdapter(): void {
      if (!this._unsubscribe) return;
      this._unsubscribe();
      this._unsubscribe = null;
    }

    // —— 用户操作 ——
    /** 换会话：只改"看哪段对话"这个展示态，不发命令（会话是 core 的既有事实，无需 HUD 下指令）。 */
    private selectSession(linkId: string): void {
      if (this._activeLinkId === linkId) return;
      this._activeLinkId = linkId;
      this.refresh();
    }

    /**
     * 发送：输入框 → HudCommand('chat.send') → adapter.dispatch。
     * 构造不出来（空消息 / 没有可发会话）就什么都不发；发完只清输入框，
     * **不本地插气泡** —— 本端气泡由 core/agent-link 投影回 WorldState.messages 后统一渲染，
     * 这样"消息到底有没有送出去"只有 core 一个答案。
     * why 也要看 canSend：Enter 发送是绕过按钮的旁路，若只在按钮上禁用，
     * 用户按回车仍会打出一条必被 core 拒绝的 chat.send（换回来一条 error Notice，纯噪音）。
     */
    private send(): void {
      if (!this._model.canSend) return;
      const command = buildChatSendCommand(this._draft, this._model.active?.id ?? null);
      if (!command || !this._adapter) return;
      this._adapter.dispatch(command);
      this.draft = '';
    }

    // —— 渲染 ——
    private renderChrome(): void {
      const root = this.shadowRoot;
      if (!root) return;

      root.innerHTML = `
        <style>
          :host { all: initial; }
          .drawer {
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
          .head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--srf-spacing-sm); }
          .title { font-size: var(--srf-font-size-lg); font-weight: var(--srf-font-weight-semibold); }
          .status {
            padding: var(--srf-spacing-xxs) var(--srf-spacing-xs);
            border: var(--srf-border-width) solid var(--srf-border-strong);
            border-radius: var(--srf-radius-pill);
            color: var(--srf-text-muted);
            font-size: var(--srf-font-size-xs);
          }
          .status[data-tone="online"] { color: var(--srf-success); border-color: var(--srf-success); }
          .status[data-tone="pending"] { color: var(--srf-warn); border-color: var(--srf-warn); }
          .status[data-tone="error"] { color: var(--srf-danger); border-color: var(--srf-danger); }
          .sessions { display: flex; flex-wrap: wrap; gap: var(--srf-spacing-xs); }
          button.session, button.send {
            padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-sm);
            cursor: pointer;
            transition: color var(--srf-transition), background var(--srf-transition), border-color var(--srf-transition);
          }
          button.session {
            display: flex;
            align-items: center;
            gap: var(--srf-spacing-xs);
            background: var(--srf-panel-elevated);
            color: var(--srf-text-muted);
          }
          button.session:hover { color: var(--srf-text); border-color: var(--srf-border-strong); }
          button.session:active { background: var(--srf-panel); }
          button.session[data-active="true"] { color: var(--srf-accent); border-color: var(--srf-accent); }
          button.session:focus-visible, button.send:focus-visible, textarea:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          .dot { width: var(--srf-spacing-sm); height: var(--srf-spacing-sm); border-radius: var(--srf-radius-pill); background: var(--srf-text-disabled); }
          .dot[data-tone="online"] { background: var(--srf-success); }
          .dot[data-tone="pending"] { background: var(--srf-warn); }
          .dot[data-tone="error"] { background: var(--srf-danger); }
          .messages {
            display: grid;
            gap: var(--srf-spacing-sm);
            max-height: 320px;
            overflow-y: auto;
            padding: var(--srf-spacing-xs);
            scrollbar-width: thin;
            scrollbar-color: var(--srf-border-strong) transparent;
          }
          .messages::-webkit-scrollbar { width: var(--srf-spacing-sm); }
          .messages::-webkit-scrollbar-thumb { background: var(--srf-border-strong); border-radius: var(--srf-radius-pill); }
          .msg {
            display: grid;
            gap: var(--srf-spacing-xxs);
            max-width: 80%;
            padding: var(--srf-spacing-sm);
            background: var(--srf-panel-elevated);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
          }
          .msg[data-direction="outbound"] { justify-self: end; border-color: var(--srf-accent); }
          .msg-meta { display: flex; gap: var(--srf-spacing-sm); color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); }
          .msg-text { font-size: var(--srf-font-size-sm); white-space: pre-wrap; word-break: break-word; }
          .composer { display: grid; gap: var(--srf-spacing-xs); }
          textarea {
            width: 100%;
            box-sizing: border-box;
            min-height: 48px;
            resize: vertical;
            padding: var(--srf-spacing-sm);
            background: var(--srf-bg);
            color: var(--srf-text);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-sm);
          }
          textarea:hover { border-color: var(--srf-border-strong); }
          .composer-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--srf-spacing-sm); }
          .hint { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); }
          .hint[data-tone="error"] { color: var(--srf-danger); }
          button.send { padding-inline: var(--srf-spacing-md); background: var(--srf-accent); color: var(--srf-bg); border-color: var(--srf-accent); font-weight: var(--srf-font-weight-semibold); }
          button.send:hover:not(:disabled) { background: var(--srf-accent-hover); }
          button.send:active:not(:disabled) { background: var(--srf-accent); }
          button.send:disabled { background: var(--srf-panel-elevated); color: var(--srf-text-disabled); border-color: var(--srf-border); cursor: not-allowed; }
          .empty { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); padding: var(--srf-spacing-lg); text-align: center; }
        </style>
        <div class="drawer" part="drawer">
          <div class="head">
            <span class="title">聊天</span>
            <span class="status" data-role="status" data-tone="offline">无会话</span>
          </div>
          <div class="sessions" data-role="sessions"></div>
          <div class="messages" data-role="messages"></div>
          <div class="composer">
            <textarea data-role="draft" placeholder="Enter 发送，Shift+Enter 换行"></textarea>
            <div class="composer-foot">
              <span class="hint" data-role="send-hint"></span>
              <button type="button" class="send" data-role="send" disabled>发送</button>
            </div>
          </div>
        </div>
      `;

      // 外壳重建后把草稿写回输入框：草稿是面板瞬时态，不随 DOM 重建丢失
      const box = root.querySelector<HTMLTextAreaElement>('[data-role="draft"]');
      if (box) box.value = this._draft;

      if (!this._listenersBound) {
        this._listenersBound = true;

        // 输入事件：只改瞬时态 + 同步发送按钮，不重画消息流（输入时光标不能丢）。
        root.addEventListener('input', (ev: Event) => {
          const target = ev.target as HTMLTextAreaElement | null;
          if (!target || target.dataset.role !== 'draft') return;
          this._draft = target.value;
          this.syncComposer();
        });

        // Enter 发送（Shift+Enter 换行）：语义与旧 AgentChatModal 一致。
        // why 收 Event 再断言成 KeyboardEvent：ShadowRoot 的 addEventListener 只认 slotchange，
        // 直接挂 KeyboardEvent 类型的监听会过不了类型检查（DOM 里其余监听同理，签名统一走 Event）。
        root.addEventListener('keydown', (ev: Event) => {
          const target = ev.target as HTMLTextAreaElement | null;
          if (!target || target.dataset.role !== 'draft') return;
          const key = ev as KeyboardEvent;
          if (key.key !== 'Enter' || key.shiftKey) return;
          ev.preventDefault();
          this.send();
        });

        // 会话切换 / 发送：data-link 与 data-role 上的目录坐标 → 展示态 或 HudCommand。
        root.addEventListener('click', (ev: Event) => {
          const target = ev.target as HTMLElement | null;
          if (!target) return;
          const session = target.closest?.('[data-link]') as HTMLElement | null;
          if (session) {
            const linkId = session.getAttribute('data-link');
            if (linkId) this.selectSession(linkId);
            return;
          }
          if (target.closest?.('[data-role="send"]')) this.send();
        });
      }
    }

    /** 输入区状态同步：只动发送按钮与提示，不碰消息流（输入一次就重渲染几十个气泡是不可接受的）。 */
    private syncComposer(): void {
      const button = this.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="send"]');
      const hint = this.shadowRoot?.querySelector<HTMLElement>('[data-role="send-hint"]');
      if (button) button.disabled = !(this._model.canSend && this._draft.trim().length > 0);
      if (hint) {
        const reason = this._model.canSend ? '' : (this._model.sendDisabledReason ?? '');
        hint.textContent = reason;
        hint.setAttribute('data-tone', this._model.canSend ? 'muted' : 'error');
      }
    }

    private renderBody(): void {
      const root = this.shadowRoot;
      if (!root) return;

      const status = root.querySelector('[data-role="status"]');
      if (status) {
        status.textContent = this._model.active?.phaseLabel ?? '无会话';
        status.setAttribute('data-tone', this._model.active?.tone ?? 'offline');
      }

      this.renderSessions();
      this.renderMessages();
      this.syncComposer();
    }

    private renderSessions(): void {
      const box = this.shadowRoot?.querySelector('[data-role="sessions"]');
      if (!box) return;
      if (this._model.sessions.length === 0) {
        box.innerHTML = `<div class="empty" data-role="sessions-empty">暂无外部 agent 会话</div>`;
        return;
      }
      box.innerHTML = this._model.sessions.map((row) => this.renderSession(row)).join('');
    }

    private renderSession(row: ChatSessionRow): string {
      return `
        <button
          type="button"
          class="session"
          data-link="${escapeHtml(row.id)}"
          data-active="${row.active ? 'true' : 'false'}"
          title="${escapeHtml(row.reason ?? row.phaseLabel)}"
        >
          <span class="dot" data-tone="${escapeHtml(row.tone)}"></span>
          <span class="session-name">${escapeHtml(row.displayName)}</span>
          <span class="session-phase">${escapeHtml(row.phaseLabel)}</span>
        </button>
      `;
    }

    private renderMessages(): void {
      const box = this.shadowRoot?.querySelector('[data-role="messages"]');
      if (!box) return;

      if (this._model.active === null) {
        box.innerHTML = `<div class="empty" data-role="empty">还没有外部 agent 会话。建立连接后即可在这里收发消息。</div>`;
        return;
      }
      if (this._model.messages.length === 0) {
        box.innerHTML = `<div class="empty" data-role="empty">与 ${escapeHtml(this._model.active.displayName)} 的对话还是空的</div>`;
        return;
      }

      const hidden = this._model.hiddenMessages > 0
        ? `<div class="empty" data-role="hidden">更早的 ${this._model.hiddenMessages} 条未显示</div>`
        : '';
      box.innerHTML = hidden + this._model.messages.map((message) => this.renderMessage(message)).join('');
      // 新消息到底部（与旧 AgentChatModal 的 scrollToBottom 同语义）
      box.scrollTop = box.scrollHeight;
    }

    private renderMessage(message: ChatMessageRow): string {
      const author = message.direction === 'outbound' ? '我' : message.author;
      return `
        <div class="msg" data-message="${escapeHtml(message.id)}" data-direction="${escapeHtml(message.direction)}">
          <div class="msg-meta">
            <span class="msg-author">${escapeHtml(author)}</span>
            <span class="msg-time">${formatMessageTime(message.at)}</span>
          </div>
          <div class="msg-text">${escapeHtml(message.text)}</div>
        </div>
      `;
    }
  }

  customElements.define(CHAT_DRAWER_TAG, ChatDrawer);
  return ChatDrawer as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：本仓库面板的统一装配口径（与 command-panel / agent-panel / mission-confirm 一致）——
 *   建元素、注入 adapter、挂进容器，返回 unmount 闭包。
 */
export function mountChatDrawer(deps: ChatDrawerDeps, host: HTMLElement): () => void {
  defineChatDrawer();
  const element = document.createElement(CHAT_DRAWER_TAG) as StratChatDrawerElement;
  element.adapter = deps;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订，订阅随之释放。
  return () => { element.remove(); };
}