/**
 * 文件职责：角色聊天抽屉 Web Component（`<strat-character-chat-drawer>`）—— 右侧滑入滑出抽屉：
 *   头部（当前角色名 + agent kind 徽标 + 关闭钮）/ 消息列表（user 右 / assistant 左气泡，
 *   自动滚动到底）/ 输入框 + 发送钮（Enter 发送、Shift+Enter 换行）。
 *   多角色会话（每角色独立消息数组）与流式缓冲全在 chat-catalog.ts（纯逻辑），本文件只负责
 *   把会话画成 Shadow DOM、把"用户打字 / 点发送 / 点关闭"翻译成回调，并订阅总线做
 *   "点战场单位 → 打开抽屉并切到该角色上下文"。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 hud 层级 + task_034（transport 打桩，纯 UI 任务）。
 *   @since v3.14（task_035 追加）：错误气泡（addMessage 带 error 标记 → 警示配色 + 内嵌「重试」钮）
 *   与发送中「停止」钮 —— 回调 onStop / onRetry 由组合根桥接 chat-service，组件仍不认识 transport。
 * 输入：注入的 deps（subscribe：吃 WorldState 快照 —— 选择集驱动开抽屉/切上下文、
 *   characters 档案驱动头部；onSend：发送回调，由组合根桥接 chat-service —— task_035 接线）。
 * 输出：Shadow DOM 抽屉；流式公开方法 appendStream / finalizeStream / addMessage / setSending
 *   （035 的 chat-service 拿元素引用直接调用）。
 * 禁止事项：
 *   1. import world/、phaser、vue、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— 一律经注入的 subscribe（Pick<HudBusAdapter,'subscribe'>）；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token；
 *   4. 在本组件里跑定时器 / 网络请求 —— 演示假流在 demo-fake-stream.ts（DEMO 标记），
 *      正式数据流由 035 的 chat-service 驱动，组件只被动接收；
 *   5. 泄漏监听器 —— disconnectedCallback 必须退订。
 *
 * 与 panels/chat-drawer.ts（外部 agent 会话）的关键差异 —— **本组件允许本地 user 气泡**：
 *   外部会话的消息真相在 core/agent-link（面板本地回显会让"发出去了没"不可排查）；
 *   角色对话的消息真相在本组件的会话存储（036 落库后由 chat-service 加载历史回填），
 *   "发送 → 立即出现 user 气泡 → 流式回显"正是 task_035 定义的流程。
 *
 * 点单位 → 切上下文的事件链路：world(BattlefieldScene) → core 总线 → WorldState.selection
 *   → 本组件订阅（只在 selection.revision 变化时判定，无关广播不会把用户刚关的抽屉顶开）。
 *
 * 渲染策略（perf，与 command-panel / agent-panel 同一口径）：外壳（含输入框）只在挂载时建一次，
 *   输入时光标不丢；消息列表仅在结构变化（提交消息 / 切角色 / 收束）时整体重建；
 *   流式增量（appendStream）只动最后一个流式气泡的文本节点，不重建列表
 *   （流式 chunk 高频，每次全量重画几十个气泡不可接受）。
 *
 * @since v3.13（task_034）
 */

import type { WorldState } from '../../../core/types';
import type { HudBusAdapter } from '../../bridge/bus-adapter';

import {
  UNBOUND_KIND_LABEL,
  createCharacterChatSessions,
  resolveCharacterHeader,
  sendableDraft,
  type CharacterChatMessage,
  type CharacterChatMessageInput,
  type CharacterChatSessions,
  type StreamBuffer,
} from './chat-catalog';

export const CHARACTER_CHAT_DRAWER_TAG = 'strat-character-chat-drawer';

/**
 * 面板需要的最小能力面：subscribe（吃总线状态）+ onSend（发送回调）。
 * why 不含 dispatch：角色对话没有对应的 HudCommand（契约的 chat.send 服务外部 agent 会话），
 * 发送走回调由组合根桥接（035 的 chat-service），把 dispatch 声明进来只会诱使后来者塞命令。
 */
export type CharacterChatDrawerDeps = Pick<HudBusAdapter, 'subscribe'> & {
  /**
   * 发送回调：用户消息已落进会话存储并渲染（user 气泡出现），由桥接方驱动 transport、
   * 再通过 setSending / appendStream / finalizeStream 把应答喂回来。缺省 = 无桥接（演示接假流）。
   */
  readonly onSend?: (characterId: string, text: string) => void;
  /**
   * 停止回调（@since v3.14，task_035）：发送中点「停止」→ 桥接方中断 transport
   * （AbortSignal → 杀进程树，见 chat-service.stop）。缺省 = 无桥接（按钮不产生效果）。
   */
  readonly onStop?: (characterId: string) => void;
  /**
   * 重试回调（@since v3.14，task_035）：错误气泡里的「重试」钮 → 桥接方重发该角色最近一次
   * 失败的原文（chat-service.retry；不新增 user 气泡）。缺省 = 无桥接（按钮不产生效果）。
   */
  readonly onRetry?: (characterId: string) => void;
};

/** 自定义元素的对外形状（测试与挂载方按它断言；流式接口供 035 组合根桥接）。 */
export interface StratCharacterChatDrawerElement extends HTMLElement {
  /** 注入的依赖；在 connected 之前或之后设置都生效。 */
  deps: CharacterChatDrawerDeps | null;
  /** 打开抽屉；带 characterId 时同时切到该角色会话。 */
  open(characterId?: string): void;
  /** 收起抽屉（会话与查看对象保留，再打开还在原上下文）。 */
  close(): void;
  /** 开合态。 */
  readonly isOpen: boolean;
  /** 切换查看的角色会话（不改变开合态；首次出现的角色从空会话开始）。 */
  setCharacter(characterId: string): void;
  /** 当前查看的角色 id；未选为 null。 */
  readonly characterId: string | null;
  /** 提交一条完整消息（user / assistant 通用；characterId 缺省取当前角色）。 */
  addMessage(message: CharacterChatMessageInput): void;
  /** 流式增量：追加到活跃流（无流则以当前角色为归属开一条）。 */
  appendStream(chunk: string): void;
  /** 收束活跃流为一条 assistant 消息（正文为空则丢弃）。 */
  finalizeStream(): void;
  /** 发送中态：置 true 时输入框与发送钮禁用（防重发）。 */
  setSending(sending: boolean): void;
  /** 发送中态。 */
  readonly sending: boolean;
  /** 输入框草稿（面板瞬时态，不是消息）。 */
  draft: string;
  /** 当前角色已提交的消息 id（按时间正序；不含流式缓冲）。 */
  readonly visibleMessageIds: readonly string[];
  /** 出现过消息的角色 id（测试 / 调试观察口）。 */
  readonly sessionCharacterIds: readonly string[];
  /** 活跃流缓冲快照；无流为 null。 */
  readonly streaming: Readonly<StreamBuffer> | null;
  /** 最近一次收到的 WorldState。 */
  readonly lastState: WorldState | null;
}

/** HTML 文本转义。消息正文与角色名含外部输入，必须转义后才进 innerHTML。 */
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
 * 工厂：注册 `<strat-character-chat-drawer>`。
 * 幂等（与 defineChatDrawer / defineAgentPanel 同约定）：重复 register 返回已注册构造器，不抛错。
 */
export function defineCharacterChatDrawer(): typeof HTMLElement {
  if (customElements.get(CHARACTER_CHAT_DRAWER_TAG)) {
    return customElements.get(CHARACTER_CHAT_DRAWER_TAG) as unknown as typeof HTMLElement;
  }

  class CharacterChatDrawer extends HTMLElement implements StratCharacterChatDrawerElement {
    private _deps: CharacterChatDrawerDeps | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _listenersBound = false;
    private _open = false;
    private _sending = false;
    private _draft = '';
    private _lastState: WorldState | null = null;
    /** 已处理过的选择 revision：无关广播（同 revision）不得把用户刚关的抽屉再顶开。 */
    private _lastSelectionRevision: number | null = null;
    private readonly _sessions: CharacterChatSessions = createCharacterChatSessions();

    // —— 属性面 ——
    get deps(): CharacterChatDrawerDeps | null { return this._deps; }
    set deps(value: CharacterChatDrawerDeps | null) {
      this._deps = value;
      this.bindDeps();
    }

    get isOpen(): boolean { return this._open; }
    get characterId(): string | null { return this._sessions.viewing; }
    get sending(): boolean { return this._sending; }
    get draft(): string { return this._draft; }
    set draft(value: string) {
      this._draft = value;
      const box = this.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]');
      if (box && box.value !== value) box.value = value;
      this.syncComposer();
    }
    get visibleMessageIds(): readonly string[] {
      const viewing = this._sessions.viewing;
      return viewing ? this._sessions.messages(viewing).map((m) => m.id) : [];
    }
    get sessionCharacterIds(): readonly string[] { return this._sessions.characterIds; }
    get streaming(): Readonly<StreamBuffer> | null { return this._sessions.stream; }
    get lastState(): WorldState | null { return this._lastState; }

    connectedCallback(): void {
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.renderChrome();
      this.bindDeps();
      this.syncRail();
      this.syncHeader();
      this.renderMessages();
      this.syncComposer();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：不退订的话，反复挂卸会把订阅堆成 O(n)，且元素已不在文档里仍在收广播。
      this.releaseDeps();
    }

    // —— 流式公开接口（035 组合根桥接的调用面）——
    open(characterId?: string): void {
      if (characterId && characterId !== this._sessions.viewing) {
        this._sessions.setViewing(characterId);
        this.syncHeader();
      }
      this._open = true;
      this.syncRail();
      this.renderMessages();
      this.syncComposer();
    }

    close(): void {
      this._open = false;
      this.syncRail();
    }

    setCharacter(characterId: string): void {
      if (this._sessions.viewing === characterId) return;
      this._sessions.setViewing(characterId);
      this.syncHeader();
      this.renderMessages();
      this.syncComposer();
    }

    addMessage(message: CharacterChatMessageInput): void {
      const committed = this._sessions.addMessage(message);
      if (committed && committed.characterId === this._sessions.viewing) this.renderMessages();
    }

    appendStream(chunk: string): void {
      const stream = this._sessions.appendStream(chunk);
      if (!stream) return;
      // 流式增量只动最后一个气泡（见文件头渲染策略），归属不是当前角色则本视图无感。
      if (stream.characterId === this._sessions.viewing) this.updateStreamBubble();
    }

    finalizeStream(): void {
      const committed = this._sessions.finalizeStream();
      if (committed && committed.characterId === this._sessions.viewing) this.renderMessages();
    }

    setSending(sending: boolean): void {
      if (this._sending === sending) return;
      this._sending = sending;
      this.syncComposer();
    }

    // —— 订阅生命周期 ——
    private bindDeps(): void {
      if (!this.isConnected || !this._deps || this._unsubscribe) return;
      this._unsubscribe = this._deps.subscribe((state) => this.handleState(state));
    }

    private releaseDeps(): void {
      if (!this._unsubscribe) return;
      this._unsubscribe();
      this._unsubscribe = null;
    }

    /**
     * 总线状态到达：
     *   1. selection.revision 变化 → 单选且单位关联角色 → 打开抽屉并切到该角色会话
     *      （多点 / 未关联角色 / 点空地都不动抽屉）；同 revision 的后续广播全部跳过；
     *   2. characters 档案变化 → 头部（名字 / kind 徽标）跟着刷新。
     */
    private handleState(state: WorldState): void {
      this._lastState = state;
      if (state.selection.revision !== this._lastSelectionRevision) {
        this._lastSelectionRevision = state.selection.revision;
        const selected = state.selection.unitIds;
        if (selected.length === 1) {
          const unit = state.units.find((u) => u.id === selected[0]);
          const characterId = unit?.characterId ?? null;
          if (characterId) this.open(characterId);
        }
      }
      this.syncHeader();
    }

    // —— 用户操作 ——
    /**
     * 发送：草稿 trim 后非空、有当前角色、不在发送中，才落一条 user 消息（本地气泡 ——
     * 见文件头"与外部会话的差异"）、清草稿、回调 onSend 交给桥接方驱动 transport。
     */
    private send(): void {
      if (this._sending) return;
      const text = sendableDraft(this._draft);
      const characterId = this._sessions.viewing;
      if (!text || !characterId) return;
      this._sessions.addMessage({ characterId, role: 'user', text });
      this.renderMessages();
      this.draft = '';
      this._deps?.onSend?.(characterId, text);
    }

    // —— 渲染 ——
    private renderChrome(): void {
      const root = this.shadowRoot;
      if (!root) return;

      root.innerHTML = `
        <style>
          /* 右侧覆盖抽屉：宿主只占位不拦事件（关着时右侧战场可正常点选），开合交给 .rail 平移 */
          :host {
            all: initial;
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            /* 展示宽上限 360px，窄视口（手机 / 分屏）回落 92vw */
            width: min(360px, 92vw);
            z-index: 40;
            pointer-events: none;
          }
          .rail {
            display: grid;
            grid-template-rows: auto 1fr auto;
            height: 100%;
            box-sizing: border-box;
            gap: var(--srf-spacing-sm, 8px);
            padding: var(--srf-spacing-md, 12px);
            background: var(--srf-panel, #181c25);
            border-left: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            color: var(--srf-text, #e6e9ef);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-md, 14px);
            line-height: var(--srf-line-height, 1.4);
            /* 滑入滑出：只有位移 + 可见性（visibility 随 transition 离散切换，收起动画完整播完才隐藏）；
               220ms 是动效时长（非颜色/字体 token 范畴，暂不设皮肤变量） */
            transform: translateX(calc(100% + 12px));
            transition: transform 220ms ease, visibility 220ms;
            visibility: hidden;
            pointer-events: none;
          }
          .rail[data-open="true"] { transform: translateX(0); visibility: visible; pointer-events: auto; }
          .head { display: flex; align-items: center; gap: var(--srf-spacing-sm, 8px); }
          .char-name {
            font-size: var(--srf-font-size-lg, 16px);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .kind-badge {
            flex: none;
            padding: 0 var(--srf-spacing-sm, 8px);
            border: var(--srf-border-width, 1px) solid var(--srf-border-strong, #3a4252);
            border-radius: var(--srf-radius, 6px);
            color: var(--srf-badge-accent, var(--srf-accent, #6ea8ff));
            font-size: var(--srf-font-size-sm, 12px);
          }
          .head .spacer { flex: 1; }
          button.close {
            flex: none;
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-sm, 8px);
            background: var(--srf-panel-elevated, #20262f);
            color: var(--srf-text-muted, #9aa3b2);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-sm, 12px);
            cursor: pointer;
          }
          button.close:hover { border-color: var(--srf-border-strong, #3a4252); }
          .messages {
            display: flex;
            flex-direction: column;
            gap: var(--srf-spacing-sm, 8px);
            min-height: 0;
            overflow-y: auto;
            padding: var(--srf-spacing-xs, 4px);
          }
          .bubble {
            max-width: 82%;
            box-sizing: border-box;
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-sm, 8px);
            background: var(--srf-panel-elevated, #20262f);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
          }
          .bubble[data-side="user"] { align-self: end; border-color: var(--srf-accent, #6ea8ff); }
          .bubble[data-side="assistant"] { align-self: start; }
          /* 错误气泡（task_035）：警示配色 + 内嵌重试钮，重试路径由 onRetry 桥接 chat-service.retry */
          .bubble[data-error="true"] { border-color: var(--srf-danger, #e06c75); }
          .bubble[data-error="true"] .bubble-text { color: var(--srf-danger, #e06c75); }
          button.retry {
            display: block;
            margin-top: var(--srf-spacing-xs, 4px);
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-sm, 8px);
            background: var(--srf-panel-elevated, #20262f);
            color: var(--srf-danger, #e06c75);
            border: var(--srf-border-width, 1px) solid var(--srf-danger, #e06c75);
            border-radius: var(--srf-radius, 6px);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-sm, 12px);
            cursor: pointer;
          }
          button.retry:hover { background: var(--srf-danger, #e06c75); color: var(--srf-bg, #0f1116); }
          .bubble-text {
            font-size: var(--srf-font-size-sm, 12px);
            white-space: pre-wrap;
            word-break: break-word;
          }
          /* 流式光标：appendStream 进行中的视觉信号（jsdom 不跑动画，静态竖线也成立） */
          .caret {
            display: inline-block;
            width: 2px;
            height: 1em;
            margin-left: 2px;
            vertical-align: text-bottom;
            background: var(--srf-accent, #6ea8ff);
            animation: caret-blink 900ms step-end infinite;
          }
          @keyframes caret-blink { 50% { opacity: 0; } }
          .empty {
            align-self: center;
            color: var(--srf-text-muted, #9aa3b2);
            font-size: var(--srf-font-size-sm, 12px);
            text-align: center;
            padding: var(--srf-spacing-lg, 16px) var(--srf-spacing-sm, 8px);
          }
          .composer { display: grid; gap: var(--srf-spacing-xs, 4px); }
          textarea {
            width: 100%;
            box-sizing: border-box;
            min-height: 48px;
            resize: vertical;
            padding: var(--srf-spacing-sm, 8px);
            background: var(--srf-bg, #0f1116);
            color: var(--srf-text, #e6e9ef);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-sm, 12px);
          }
          textarea:focus { outline: var(--srf-border-width, 1px) solid var(--srf-accent, #6ea8ff); }
          textarea:disabled, button.send:disabled { opacity: 0.6; cursor: not-allowed; }
          .composer-foot { display: flex; align-items: center; justify-content: flex-end; gap: var(--srf-spacing-sm, 8px); }
          .hint { color: var(--srf-text-muted, #9aa3b2); font-size: var(--srf-font-size-sm, 12px); flex: 1; }
          .hint[data-tone="busy"] { color: var(--srf-warn, #f0c674); }
          /* 停止钮（task_035）：只在发送中出现 —— 中断当前轮（onStop → chat-service.stop） */
          button.stop {
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-md, 12px);
            background: var(--srf-panel-elevated, #20262f);
            color: var(--srf-warn, #f0c674);
            border: var(--srf-border-width, 1px) solid var(--srf-warn, #f0c674);
            border-radius: var(--srf-radius, 6px);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-sm, 12px);
            cursor: pointer;
          }
          button.send {
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-md, 12px);
            background: var(--srf-accent, #6ea8ff);
            color: var(--srf-bg, #0f1116);
            border: var(--srf-border-width, 1px) solid var(--srf-accent, #6ea8ff);
            border-radius: var(--srf-radius, 6px);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-sm, 12px);
            cursor: pointer;
          }
          button.send[disabled] {
            background: var(--srf-panel-elevated, #20262f);
            color: var(--srf-text-disabled, #5a6373);
            border-color: var(--srf-border, #2a313d);
          }
        </style>
        <div class="rail" data-role="rail" data-open="false">
          <div class="head">
            <span class="char-name" data-role="char-name">未选择角色</span>
            <span class="kind-badge" data-role="kind-badge">${escapeHtml(UNBOUND_KIND_LABEL)}</span>
            <span class="spacer"></span>
            <button type="button" class="close" data-role="close">关闭</button>
          </div>
          <div class="messages" data-role="messages" aria-live="polite"></div>
          <div class="composer">
            <textarea data-role="draft" placeholder="对角色说点什么…（Enter 发送）" disabled></textarea>
            <div class="composer-foot">
              <span class="hint" data-role="send-hint"></span>
              <button type="button" class="stop" data-role="stop" hidden>停止</button>
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

        // Enter 发送（Shift+Enter 换行）：语义与 panels/chat-drawer（旧 AgentChatModal）一致。
        // why 收 Event 再断言成 KeyboardEvent：ShadowRoot 的 addEventListener 类型只认 slotchange，
        // 直接挂 KeyboardEvent 监听过不了类型检查（DOM 里其余监听同理，签名统一走 Event）。
        root.addEventListener('keydown', (ev: Event) => {
          const target = ev.target as HTMLTextAreaElement | null;
          if (!target || target.dataset.role !== 'draft') return;
          const key = ev as KeyboardEvent;
          if (key.key !== 'Enter' || key.shiftKey) return;
          ev.preventDefault();
          this.send();
        });

        // 关闭 / 停止 / 发送 / 重试：data-role 定位 → 动作。
        root.addEventListener('click', (ev: Event) => {
          const target = ev.target as HTMLElement | null;
          if (!target) return;
          if (target.closest?.('[data-role="close"]')) this.close();
          else if (target.closest?.('[data-role="send"]')) this.send();
          else if (target.closest?.('[data-role="stop"]')) {
            // 只在发送中且有查看对象时回调 —— 停止钮只在发送中可见，这里是双保险。
            if (this._sending && this._sessions.viewing) {
              this._deps?.onStop?.(this._sessions.viewing);
            }
          } else if (target.closest?.('[data-role="retry"]')) {
            // 重试钮带所属角色 id（错误气泡可能属于非当前查看的角色）。
            const button = target.closest<HTMLElement>('[data-role="retry"]');
            const characterId = button?.dataset.character;
            if (characterId) this._deps?.onRetry?.(characterId);
          }
        });
      }
    }

    /** 开合态 → 轨道节点的 data-open（CSS 平移由属性选择器接管，测试也断言它）。 */
    private syncRail(): void {
      const rail = this.shadowRoot?.querySelector('[data-role="rail"]');
      rail?.setAttribute('data-open', this._open ? 'true' : 'false');
    }

    /**
     * 头部同步：名字 / kind 徽标从最近快照的 characters 派生。
     * 逐节点比对新值，没变不碰 DOM（档案广播频繁，头部无关变化不值得重写文本节点）。
     */
    private syncHeader(): void {
      const nameNode = this.shadowRoot?.querySelector('[data-role="char-name"]');
      const badgeNode = this.shadowRoot?.querySelector('[data-role="kind-badge"]');
      if (!nameNode || !badgeNode) return;
      const header = resolveCharacterHeader(this._lastState?.characters ?? [], this._sessions.viewing);
      const nextName = header ? header.name : '未选择角色';
      const nextBadge = header?.kindLabel ?? UNBOUND_KIND_LABEL;
      if (nameNode.textContent !== nextName) nameNode.textContent = nextName;
      if (badgeNode.textContent !== nextBadge) badgeNode.textContent = nextBadge;
    }

    /** 消息列表整体重建（结构变化时才走：提交 / 切角色 / 收束；流式增量走 updateStreamBubble）。 */
    private renderMessages(): void {
      const box = this.shadowRoot?.querySelector('[data-role="messages"]');
      if (!box) return;
      const viewing = this._sessions.viewing;
      if (!viewing) {
        box.innerHTML = `<div class="empty" data-role="empty">点选战场上的角色单位，开始对话</div>`;
        return;
      }
      const messages = this._sessions.messages(viewing);
      if (messages.length === 0) {
        box.innerHTML = `<div class="empty" data-role="empty">与 ${escapeHtml(this.headerNameOf(viewing))} 的对话还是空的</div>`;
      } else {
        box.innerHTML = messages.map((message) => this.renderBubble(message)).join('');
      }
      // 流缓冲若属于当前角色，接在末尾（增量更新由 updateStreamBubble 接管）
      this.updateStreamBubble();
      // 新内容到底部（与旧 AgentChatModal 的 scrollToBottom 同语义）
      box.scrollTop = box.scrollHeight;
    }

    /** 当前角色的展示名（空态文案用；档案缺失回落 id，与 syncHeader 同一口径）。 */
    private headerNameOf(characterId: string): string {
      const header = resolveCharacterHeader(this._lastState?.characters ?? [], characterId);
      return header?.name ?? characterId;
    }

    private renderBubble(message: CharacterChatMessage): string {
      if (message.error) {
        return `
          <div class="bubble" data-role="bubble" data-message="${escapeHtml(message.id)}" data-side="assistant" data-error="true">
            <div class="bubble-text">${escapeHtml(message.text)}</div>
            <button type="button" class="retry" data-role="retry" data-character="${escapeHtml(message.characterId)}">重试</button>
          </div>
        `;
      }
      return `
        <div class="bubble" data-role="bubble" data-message="${escapeHtml(message.id)}" data-side="${escapeHtml(message.role)}">
          <div class="bubble-text">${escapeHtml(message.text)}</div>
        </div>
      `;
    }

    /**
     * 流式增量渲染：只找 / 建 / 改最后一个流式气泡，不重建列表。
     * 气泡带 data-streaming 与光标节点，finalize 后整体重建时自然消失（转为普通气泡）。
     */
    private updateStreamBubble(): void {
      const stream = this._sessions.stream;
      const box = this.shadowRoot?.querySelector('[data-role="messages"]');
      if (!box || !stream || stream.characterId !== this._sessions.viewing) return;
      let node = box.querySelector<HTMLElement>('[data-role="stream-bubble"]');
      if (!node) {
        node = document.createElement('div');
        node.className = 'bubble';
        node.setAttribute('data-role', 'stream-bubble');
        node.setAttribute('data-side', 'assistant');
        node.setAttribute('data-streaming', 'true');
        node.innerHTML = `<div class="bubble-text"></div><span class="caret" aria-hidden="true"></span>`;
        box.appendChild(node);
      }
      const textNode = node.querySelector<HTMLElement>('.bubble-text');
      if (textNode) textNode.textContent = stream.text;
      box.scrollTop = box.scrollHeight;
    }

    /** 输入区状态同步：只动禁用态与提示，不碰消息流。 */
    private syncComposer(): void {
      const box = this.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]');
      const send = this.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="send"]');
      const stop = this.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="stop"]');
      const hint = this.shadowRoot?.querySelector<HTMLElement>('[data-role="send-hint"]');
      const canType = this._sessions.viewing !== null && !this._sending;
      if (box) box.disabled = !canType;
      if (send) send.disabled = !canType || sendableDraft(this._draft) === null;
      // 停止钮只在发送中出现（此刻输入与发送都被禁，它是唯一可点的动作）。
      if (stop) stop.hidden = !this._sending;
      if (hint) {
        if (this._sending) {
          hint.textContent = '发送中…';
          hint.setAttribute('data-tone', 'busy');
        } else if (this._sessions.viewing === null) {
          hint.textContent = '先选择一个角色';
          hint.setAttribute('data-tone', 'muted');
        } else {
          hint.textContent = '';
          hint.setAttribute('data-tone', 'muted');
        }
      }
    }
  }

  customElements.define(CHARACTER_CHAT_DRAWER_TAG, CharacterChatDrawer);
  return CharacterChatDrawer as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：本仓库面板的统一装配口径（与 mountChatDrawer / mountAgentPanel 一致）——
 *   建元素、注入 deps、挂进容器，返回 unmount 闭包。
 */
export function mountCharacterChatDrawer(deps: CharacterChatDrawerDeps, host: HTMLElement): () => void {
  defineCharacterChatDrawer();
  const element = document.createElement(CHARACTER_CHAT_DRAWER_TAG) as StratCharacterChatDrawerElement;
  element.deps = deps;
  host.appendChild(element);
  // 移除元素触发 disconnectedCallback → 退订，订阅随之释放。
  return () => { element.remove(); };
}
