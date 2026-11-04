/**
 * 文件职责：角色聊天抽屉 Web Component（`<strat-character-chat-drawer>`）—— 右侧滑入滑出抽屉：
 *   头部（当前角色名 + agent kind 徽标 + 关闭钮）/ 消息列表（user 右 / assistant 左气泡，
 *   自动滚动到底）/ 输入框 + 发送钮（Enter 发送、Shift+Enter 换行）。
 *   与 chat-catalog 多角色会话（每角色独立消息数组）与流式缓冲全在 chat-catalog.ts（纯逻辑），本文件只负责
 *   把会话画成 Shadow DOM、把"用户打字 / 点发送 / 点关闭"翻译成回调，并订阅总线做
 *   "点战场单位 → 打开抽屉并切到该角色上下文"。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 hud 层级 + task_034（transport 打桩，纯 UI 任务）。
 *   @since v3.14（task_035 追加）：错误气泡（addMessage 带 error 标记 → 警示配色 + 内嵌「重试」钮）
 *   与发送中「停止」钮 —— 回调 onStop / onRetry 由组合根桥接 chat-service，组件仍不认识 transport。
 *   @since v3.15（task_036 追加）：历史回填 —— open / setCharacter 时经 loadHistory 回调读最近
 *   CHAT_HISTORY_LOAD_LIMIT（50）条逐条回填进会话存储（库里的历史与重建后的新会话在 UI 层
 *   天然同一段消息流 = 连续展示）。task_074 追加 beforeId 分页：滚动到顶加载更早一页，
 *   prepend 后锚定原首条消息；不足一页显示顶部到底提示，失败静默且可重试。
 *   @since v3.22（task_046 追加）：头部与消息区之间嵌挂任务输出面板（`<strat-task-output-panel>`）——
 *   034 的「点单位 → 抽屉打开」是既有语义，busy 单位的实时 CLI 流顺着同一入口可见（冲突裁决：
 *   不另开面板抢点击，抽屉头部下挂折叠区）。本文件只做三件事：嵌挂元素、转发 subscribe、
 *   open / setCharacter 时同步上下文（showFor）；流式文本与跟随/折叠交互全在 task-output-panel.ts。
 *   @since v3.28（task_052 追加）：互聊模式 —— 框选恰两个角色单位 → 头部「让它们聊聊」→
 *   议题输入 + 轮数选择（3/5/8）→ 联合会话视图（A 左 assistant / B 右 peer 色彩变体，
 *   peer 气泡带对方名字行）；讨论中输入框变插话框（onPeerInterject，本地 user 气泡照旧）；
 *   头部轮次进度「第 2/3 轮」与停止钮（onPeerChatStop）由 agent-chat-service 驱动
 *   （setPeerRound / endPeerChat）。互聊进行中单选切走被抑制（联合视图是讨论主舞台）；
 *   结束 / 取消后恢复。流式走 appendPeerStream / finalizePeerStream —— 归属钉死在
 *   联合会话（peerChatSessionId），用户切走视图也不串台进个人会话。
 * 输入：注入的 deps（subscribe：吃 WorldState 快照 —— 选择集驱动开抽屉/切上下文/互聊候选、
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
import { enhanceMarkdown, MARKDOWN_CLASS, MARKDOWN_CSS, renderMarkdown } from '../../lib/markdown';
import { defineEmptyState, EMPTY_STATE_TAG } from '../empty-state/empty-state';
import {
  defineTaskOutputPanel,
  TASK_OUTPUT_PANEL_TAG,
  type StratTaskOutputPanelElement,
} from '../task-output/task-output-panel';

import {
  UNBOUND_KIND_LABEL,
  createCharacterChatSessions,
  peerChatSessionId,
  resolveCharacterHeader,
  sendableDraft,
  type CharacterChatMessage,
  type CharacterChatMessageInput,
  type CharacterChatSessions,
  type StreamBuffer,
} from './chat-catalog';
import { zVar } from '../../theme/layer-tokens';

export const CHARACTER_CHAT_DRAWER_TAG = 'strat-character-chat-drawer';

/**
 * 半模态抽屉的状态出口（@since v3.5，task_099）—— 由遮挡控制器实现
 *   （hud/layers/occlusion.ts 的 setDrawer）。
 * why 是一行接口而不是直接 import 控制器：组件只认「开 / 关」这一个动作，
 *   机制（谁在压着谁、要不要禁点）归机制层管 —— 依赖注入口径同 toast-host / sfx-service。
 */
export interface DrawerOcclusionPort {
  /** 登记 / 注销「有一个半模态抽屉开着」（null = 关上了）。 */
  setDrawer(id: string | null): void;
}

/** 抽屉在遮挡栈里的登记名（R2：半模态 —— 只压暗对侧，不锁四角、不接管全屏）。 */
export const CHAT_DRAWER_OCCLUSION_ID = 'chat-drawer';

/**
 * 面板需要的最小能力面：subscribe（吃总线状态）+ onSend（发送回调）。
 * why 不含 dispatch：角色对话没有对应的 HudCommand（契约的 chat.send 服务外部 agent 会话），
 * 发送走回调由组合根桥接（035 的 chat-service），把 dispatch 声明进来只会诱使后来者塞命令。
 */
export type CharacterChatDrawerDeps = Pick<HudBusAdapter, 'subscribe'> & {
  /**
   * 半模态状态出口（@since v3.5，task_099）：抽屉开合报给遮挡控制器 ——
   *   控制器据此知道「现在有个半模态抽屉」，但**不锁四角、不接管全屏**（R2）。
   *   缺省 = 不报（抽屉照样开合，只是没人知道它开着）。
   */
  readonly occlusion?: DrawerOcclusionPort | null;
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
  /**
   * 历史加载回调（@since v3.15，task_036）：抽屉打开 / 切角色时请求该角色的历史消息
   * （最近 N 条、时间正序；N 由桥接方给 —— 生产是 CHAT_HISTORY_LOAD_LIMIT）。缺省 = 无持久化
   * 桥接（空历史，行为与 034/035 完全一致）。回填规则见 requestHistory：内存会话非空不回填、
   * 活跃流缓冲挂在目标角色上不回填、每角色每生命周期至多成功回填一次。
   */
  readonly loadHistory?: (characterId: string) => Promise<readonly CharacterChatMessageInput[]>;
  /** 历史页大小；初始加载满页后才允许滚动到顶继续翻页。 */
  readonly historyPageSize?: number;
  /** 读取当前首条历史消息之前的一页；失败 reject，抽屉静默并允许重试。 */
  readonly loadEarlierHistory?: (
    characterId: string,
    beforeId: string,
    limit: number
  ) => Promise<readonly CharacterChatMessageInput[]>;
  /**
   * 互聊发起回调（@since v3.28，task_052）：议题表单点「开始讨论」→ 桥接方驱动
   * agent-chat-service.start（A2A 回合编排）。缺省 = 无桥接（表单可开、讨论不跑）。
   */
  readonly onPeerChatStart?: (aId: string, bId: string, topic: string, rounds: number) => void;
  /**
   * 互聊停止回调（@since v3.28，task_052）：讨论中点「停止」→ agent-chat-service.stop
   * （abort 在飞回合 —— 与 035 同一套杀进程树链路）。
   */
  readonly onPeerChatStop?: () => void;
  /**
   * 插话回调（@since v3.28，task_052）：讨论中发送框变插话框 —— 本地 user 气泡照旧出现，
   * 桥接方把文本交给 agent-chat-service.interject（进双方下一轮 prompt）。
   */
  readonly onPeerInterject?: (text: string) => void;
};

/** 互聊可选轮数（规格③：3/5/8；服务侧另有钳位上限）。 */
export const PEER_ROUND_CHOICES: readonly number[] = [3, 5, 8];

/** 互聊模式的相位（setup=议题表单 / running=讨论进行 / ended=已收束待退出）。 */
export type PeerChatPhase = 'setup' | 'running' | 'ended';

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
  /** 嵌挂的任务输出面板（task_046）；未挂载（chrome 未建）为 null。组合根经它接流转发端口。 */
  readonly taskOutput: StratTaskOutputPanelElement | null;
  /**
   * 框选出的互聊候选（@since v3.28，task_052）：恰两个角色单位时为 [aId, bId]；否则 null。
   * 头部「让它们聊聊」按钮的可视性由它驱动（见 syncPeerButtons）。
   */
  readonly peerCandidates: readonly string[] | null;
  /** 互聊状态（@since v3.28，task_052）；不在互聊模式为 null。 */
  readonly peerChat: { readonly aId: string; readonly bId: string; readonly phase: PeerChatPhase } | null;
  /** 议题草稿（互聊 setup 相位的瞬时态）。 */
  readonly peerTopicDraft: string;
  /** 进入互聊 setup：开抽屉 + 切到联合会话视图（头部「让它们聊聊」的动作面）。 */
  openPeerChat(aId: string, bId: string): void;
  /** 退出互聊模式（取消表单 / 结束后离开；不影响在跑的讨论 —— 那由停止钮管）。 */
  exitPeerChat(): void;
  /** 互聊流式增量（@since v3.28，task_052）：归属钉死在联合会话，role 决定气泡侧。 */
  appendPeerStream(role: 'assistant' | 'peer', chunk: string): void;
  /** 收束互聊活跃流（与 finalizeStream 同语义，但仅在互聊模式有效）。 */
  finalizePeerStream(): void;
  /** 轮次进度：「第 x/y 轮」；仅 running 相位生效。 */
  setPeerRound(current: number, total: number): void;
  /** 整场收束（agent-chat-service 的 endPeerChat 端口）：running → ended。 */
  endPeerChat(): void;
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

  /**
   * 角色聊天抽屉本体（Shadow DOM 呈现面）——
   *   数据面全部由注入的会话仓给出，本类只负责呈现与交互；
   *   开合状态同时报给遮挡控制器（半模态：只压暗对侧，不锁四角 —— 遮挡规则 R2）。
   */
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
    /** 已成功回填（或确认无需回填）历史的角色 id（task_036）：每角色每生命周期至多一次。 */
    private readonly _historyLoaded = new Set<string>();
    private readonly _historyHasEarlier = new Set<string>();
    private readonly _historyExhausted = new Set<string>();
    private readonly _historyLoadingEarlier = new Set<string>();
    private readonly _sessions: CharacterChatSessions = createCharacterChatSessions();
    /** 嵌挂的任务输出面板（task_046）：renderChrome 时捕获，deps 转发与 showFor 都走它。 */
    private _taskOutput: StratTaskOutputPanelElement | null = null;
    /** 互聊候选（task_052）：框选恰两个角色单位时点亮头部「让它们聊聊」。 */
    private _peerCandidates: readonly [string, string] | null = null;
    /** 互聊状态机（task_052）：setup → running → ended；null = 普通单角色模式。 */
    private _peerChat: {
      aId: string;
      bId: string;
      jointId: string;
      phase: PeerChatPhase;
    } | null = null;
    /** 议题草稿 / 轮数选择（setup 相位瞬时态，外壳重建不丢——同 draft 的口径）。 */
    private _peerTopicDraft = '';
    private _peerRoundsDraft = 3;
    /** 轮次进度（running 相位；「第 x/y 轮」）。 */
    private _peerRound: { current: number; total: number } | null = null;

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
    get taskOutput(): StratTaskOutputPanelElement | null { return this._taskOutput; }
    get peerCandidates(): readonly string[] | null {
      return this._peerCandidates ? [...this._peerCandidates] : null;
    }
    get peerChat(): { aId: string; bId: string; phase: PeerChatPhase } | null {
      return this._peerChat
        ? { aId: this._peerChat.aId, bId: this._peerChat.bId, phase: this._peerChat.phase }
        : null;
    }
    get peerTopicDraft(): string { return this._peerTopicDraft; }

    connectedCallback(): void {
      // 统一空态组件（task_136）：先注册再渲染（幂等，重复 define 不抛）。
      defineEmptyState();
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.renderChrome();
      this.bindDeps();
      this.syncRail();
      this.syncHeader();
      this.renderMessages();
      this.syncComposer();
      this.syncPeerButtons();
      this.syncPeerRound();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：不退订的话，反复挂卸会把订阅堆成 O(n)，且元素已不在文档里仍在收广播。
      this.releaseDeps();
      // 半模态状态也要撤（@since v3.5，task_099）：元素走了就别在机制层留个「抽屉开着」。
      this._deps?.occlusion?.setDrawer(null);
    }

    // —— 流式公开接口（035 组合根桥接的调用面）——
    open(characterId?: string): void {
      if (characterId && characterId !== this._sessions.viewing) {
        this._sessions.setViewing(characterId);
        this.syncHeader();
        this._taskOutput?.showFor(characterId); // task_046：任务输出跟着切上下文
      }
      this._open = true;
      this.syncRail();
      this.renderMessages();
      this.syncComposer();
      this.requestHistory(this._sessions.viewing); // task_036：打开时补一次历史（已回填过则 no-op）
    }

    close(): void {
      this._open = false;
      this.syncRail();
    }

    setCharacter(characterId: string): void {
      if (this._sessions.viewing === characterId) return;
      this._sessions.setViewing(characterId);
      this.syncHeader();
      this._taskOutput?.showFor(characterId); // task_046：任务输出跟着切上下文
      this.renderMessages();
      this.syncComposer();
      this.requestHistory(characterId); // task_036：切角色即拉该角色历史
    }

    addMessage(message: CharacterChatMessageInput): void {
      // 互聊模式下不带归属的消息 → 联合会话（agent-chat-service 的视图口调用面）；
      // peer 消息缺 peerId 时补 B（联合会话里 peer 侧恒为应答者）。
      let input: CharacterChatMessageInput = message;
      if (message.characterId === undefined && this._peerChat) {
        input = { ...message, characterId: this._peerChat.jointId };
      }
      if (input.role === 'peer' && input.peerId === undefined && this._peerChat) {
        input = { ...input, peerId: this._peerChat.bId };
      }
      const committed = this._sessions.addMessage(input);
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

    // —— 互聊公开接口（task_052；agent-chat-service 的调用面）——

    openPeerChat(aId: string, bId: string): void {
      if (aId === bId) return;
      const jointId = peerChatSessionId(aId, bId);
      this._peerChat = { aId, bId, jointId, phase: 'setup' };
      this._peerTopicDraft = '';
      this._peerRoundsDraft = 3;
      this._peerRound = null;
      this._sessions.setViewing(jointId);
      // peer 侧恒为应答者 B（发起者 A 是 assistant 侧）：peer 流收束时补 peerId 用。
      this._sessions.setPeerIdHint(jointId, bId);
      this._open = true;
      this.syncRail();
      this.syncHeader();
      this.renderMessages();
      this.syncComposer();
      this.syncPeerButtons();
      this.syncPeerRound();
    }

    exitPeerChat(): void {
      if (!this._peerChat) return;
      this._peerChat = null;
      this._peerRound = null;
      this._sessions.setViewing(null);
      this.syncHeader();
      this.renderMessages();
      this.syncComposer();
      this.syncPeerButtons();
      this.syncPeerRound();
    }

    appendPeerStream(role: 'assistant' | 'peer', chunk: string): void {
      const jointId = this._peerChat?.jointId;
      if (!jointId) return; // 不在互聊模式：没有联合会话可归属
      const stream = this._sessions.appendStreamAs(jointId, role, chunk);
      if (!stream) return;
      if (stream.characterId === this._sessions.viewing) this.updateStreamBubble();
    }

    finalizePeerStream(): void {
      const committed = this._sessions.finalizeStream();
      if (committed && committed.characterId === this._sessions.viewing) this.renderMessages();
    }

    setPeerRound(current: number, total: number): void {
      if (this._peerChat?.phase !== 'running') return;
      this._peerRound = { current, total };
      this.syncPeerRound();
    }

    endPeerChat(): void {
      if (!this._peerChat) return;
      this._peerRound = null;
      if (this._peerChat.phase === 'running') {
        this._peerChat = { ...this._peerChat, phase: 'ended' };
      }
      this.syncPeerRound();
      this.syncComposer();
      this.syncPeerButtons();
    }

    setSending(sending: boolean): void {
      if (this._sending === sending) return;
      this._sending = sending;
      this.syncComposer();
    }

    // —— 订阅生命周期 ——
    private bindDeps(): void {
      if (!this.isConnected || !this._deps) return;
      // 嵌挂的任务输出面板（task_046）：吃同一份 subscribe（总线状态是公共广播面，
      // 各自订阅各自退订）；并同步当前上下文（挂载晚于 open 的时序补一次 showFor）。
      if (this._taskOutput) {
        this._taskOutput.deps = { subscribe: this._deps.subscribe };
        this._taskOutput.showFor(this._sessions.viewing);
      }
      if (this._unsubscribe) return;
      this._unsubscribe = this._deps.subscribe((state) => this.handleState(state));
    }

    private releaseDeps(): void {
      if (!this._unsubscribe) return;
      this._unsubscribe();
      this._unsubscribe = null;
    }

    /**
     * 历史回填（@since v3.15，task_036）：抽屉打开 / 切角色时向桥接方要该角色最近一段历史。
     * 规则（防重复、防串序、防与流式缓冲打架）：
     *   1. 已回填过 / 内存会话非空 → 不再要（本轮运行里内存是超集，回填只会重复）；
     *   2. 异步返回时复查：期间用户已发言（内存非空）→ 丢弃，标记已处理；
     *   3. 活跃流缓冲挂在目标角色上 → 本次不回填也不标记（下次开抽屉再试 —— 流结束后历史
     *      与新消息都在内存，届时内存非空，规则 1 直接吸收）；
     *   4. 加载失败 → 静默放弃（空会话照常可用，重试留给下次打开）。
     * 回填直接写会话存储（不逐条走组件 addMessage —— 那会每条重渲染一次），最后一次 renderMessages。
     */
    private requestHistory(characterId: string | null): void {
      if (!characterId) return;
      // 互聊联合会话没有库表历史（消息真相在双方各自的 character_chat_messages 行里，
      // 联合视图是运行时拼合）—— 不走回填。task_052。
      if (this._peerChat && characterId === this._peerChat.jointId) return;
      const loader = this._deps?.loadHistory;
      if (!loader || this._historyLoaded.has(characterId)) return;
      if (this._sessions.messages(characterId).length > 0) {
        this._historyLoaded.add(characterId); // 内存已有内容：本轮不再回填
        return;
      }
      void loader(characterId)
        .then((entries) => {
          if (this._historyLoaded.has(characterId)) return;
          if (this._sessions.messages(characterId).length > 0) {
            this._historyLoaded.add(characterId); // 竞态：加载期间用户已发言，丢弃本次
            return;
          }
          const stream = this._sessions.stream;
          if (stream !== null && stream.characterId === characterId) return; // 流式缓冲态不回填
          this._historyLoaded.add(characterId);
          if (entries.length >= (this._deps?.historyPageSize ?? 50)) this._historyHasEarlier.add(characterId);
          for (const entry of entries) {
            // 归属强制钉死到请求的角色（loader 的返回不该被信任到能决定归属）。
            this._sessions.addMessage({ ...entry, characterId });
          }
          if (this._sessions.viewing === characterId) this.renderMessages();
        })
        .catch(() => {
          // 历史加载失败不致命：空会话照常可用（不标记，下次打开重试）。
        });
    }

    private requestEarlierHistory(characterId: string): void {
      const loader = this._deps?.loadEarlierHistory;
      if (
        !loader ||
        !this._historyHasEarlier.has(characterId) ||
        this._historyLoadingEarlier.has(characterId)
      ) return;
      const anchorId = this._sessions.messages(characterId)[0]?.id;
      if (!anchorId) return;

      const limit = this._deps?.historyPageSize ?? 50;
      this._historyLoadingEarlier.add(characterId);
      void loader(characterId, anchorId, limit)
        .then((entries) => {
          if (entries.length < limit) {
            this._historyHasEarlier.delete(characterId);
            this._historyExhausted.add(characterId);
          }
          this._sessions.prependMessages(
            characterId,
            entries.map((entry) => ({ ...entry, characterId }))
          );
          if (this._sessions.viewing !== characterId) return;
          const box = this.shadowRoot?.querySelector<HTMLElement>('[data-role="messages"]');
          if (!box) return;
          this.renderMessages();
          const anchor = Array.from(box.querySelectorAll<HTMLElement>('[data-message]'))
            .find((node) => node.getAttribute('data-message') === anchorId);
          if (anchor) box.scrollTop = anchor.offsetTop;
        })
        .catch(() => {
          // 静默失败：不置到底标记，下一次滚动到顶可重试。
        })
        .finally(() => {
          this._historyLoadingEarlier.delete(characterId);
        });
    }

    /**
     * 总线状态到达：
     *   1. selection.revision 变化 → ①单选且单位关联角色 → 打开抽屉并切到该角色会话
     *      （互聊进行中抑制切走 —— 联合视图是讨论主舞台；setup/ended 相位则先退出互聊再切）；
     *      ②恰选两个单位且都关联角色 → 互聊候选：开抽屉点亮头部「让它们聊聊」（task_052）；
     *      其余（多点 / 未关联角色 / 点空地）不动抽屉。同 revision 的后续广播全部跳过；
     *   2. characters 档案变化 → 头部（名字 / kind 徽标 / 互聊标题）跟着刷新。
     */
    private handleState(state: WorldState): void {
      this._lastState = state;
      if (state.selection.revision !== this._lastSelectionRevision) {
        this._lastSelectionRevision = state.selection.revision;
        const selected = state.selection.unitIds;
        if (selected.length === 1) {
          if (this._peerChat?.phase === 'running') {
            // 讨论进行中：联合视图不动（服务往联合会话写，与当前查看对象无关）。
          } else {
            const unit = state.units.find((u) => u.id === selected[0]);
            const characterId = unit?.characterId ?? null;
            if (characterId) {
              if (this._peerChat) this.exitPeerChat(); // setup 表单 / 已结束的残留互聊态随单选切走
              this.open(characterId);
            }
          }
        } else if (selected.length === 2) {
          // task_052 互聊入口条件：恰两个单位、双方都关联角色且互不相同（讨论需要两个 agent）。
          const first = state.units.find((u) => u.id === selected[0]);
          const second = state.units.find((u) => u.id === selected[1]);
          const c1 = first?.characterId ?? null;
          const c2 = second?.characterId ?? null;
          if (c1 && c2 && c1 !== c2) {
            this._peerCandidates = [c1, c2];
            this.open(); // 只开抽屉不切上下文：互聊入口在头部按钮
          } else {
            this._peerCandidates = null;
          }
          this.syncPeerButtons();
        } else {
          if (this._peerCandidates !== null) {
            this._peerCandidates = null;
            this.syncPeerButtons();
          }
        }
      }
      this.syncHeader();
    }

    // —— 用户操作 ——
    /**
     * 发送：两种形态（task_052）——
     *   互聊中：草稿变插话（本地 user 气泡照旧 → onPeerInterject，服务注入双方下一轮 prompt）；
     *   普通：草稿 trim 后非空、有当前角色、不在发送中，才落 user 消息 → onSend 驱动 transport。
     */
    private send(): void {
      const peer = this._peerChat;
      if (peer) {
        if (peer.phase !== 'running') return; // setup/ended：输入区已禁，双保险
        const peerText = sendableDraft(this._draft);
        if (!peerText) return;
        this._sessions.addMessage({ characterId: peer.jointId, role: 'user', text: peerText });
        this.renderMessages();
        this.draft = '';
        this._deps?.onPeerInterject?.(peerText);
        return;
      }
      if (this._sending) return;
      const text = sendableDraft(this._draft);
      const characterId = this._sessions.viewing;
      if (!text || !characterId) return;
      this._sessions.addMessage({ characterId, role: 'user', text });
      this.renderMessages();
      this.draft = '';
      this._deps?.onSend?.(characterId, text);
    }

    /**
     * 互聊开始（task_052）：议题非空才起跑；相位切 running，交 onPeerChatStart 桥接
     * agent-chat-service（守门/回合编排在那边；守门不通过的提示气泡也由服务写进联合会话）。
     */
    private beginPeerChat(): void {
      const peer = this._peerChat;
      if (!peer || peer.phase !== 'setup') return;
      const topic = sendableDraft(this._peerTopicDraft);
      if (!topic) return;
      const rounds = this._peerRoundsDraft;
      this._peerChat = { ...peer, phase: 'running' };
      this.renderMessages();
      this.syncComposer();
      this.syncPeerButtons();
      this.syncPeerRound();
      this._deps?.onPeerChatStart?.(peer.aId, peer.bId, topic, rounds);
    }

    // —— 渲染 ——
    private renderChrome(): void {
      const root = this.shadowRoot;
      if (!root) return;

      // 嵌挂组件先注册（幂等）：innerHTML 解析到标签时才能同步 upgrade。
      defineTaskOutputPanel();

      root.innerHTML = `
        <style>
          :host {
            all: initial;
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            width: min(360px, 92vw);
            z-index: ${zVar('overlay')};
            pointer-events: none;
          }
          .rail {
            display: grid;
            grid-template-rows: auto auto 1fr auto;
            height: 100%;
            box-sizing: border-box;
            gap: var(--srf-spacing-sm);
            padding: var(--srf-spacing-lg);
            background: var(--srf-panel);
            border-left: var(--srf-border-width) solid var(--srf-border);
            box-shadow: var(--srf-shadow-lg);
            color: var(--srf-text);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-md);
            line-height: var(--srf-line-height);
            transform: translateX(calc(100% + var(--srf-spacing-md)));
            transition: transform var(--srf-transition), visibility var(--srf-transition);
            visibility: hidden;
            pointer-events: none;
            z-index: ${zVar('localMid')};
          }
          /* 对侧压暗（@since v3.5，遮挡规则 R2）：抽屉是**半模态** ——
             只把对侧（抽屉左边那一大片）压暗，不锁四角、不接管全屏。
             why pointer-events:none：压暗是「视觉让位」，不是「挡住」——
             四角常驻件（顶栏 / 控制岛 / 事件轨 / 小地图）在抽屉开着时照样点得动。
             why 固定定位 + right 与宿主同宽：宿主就是抽屉那一条（fixed 在无 transform 的祖先下
             以视口为定位基准）—— 压暗区正好是「视口减去抽屉那一条」。 */
          .rail-dim {
            position: fixed;
            inset: 0;
            right: min(360px, 92vw);
            background: var(--srf-backdrop);
            opacity: 0;
            pointer-events: none;
            transition: opacity var(--srf-transition);
            z-index: ${zVar('localBase')};
          }
          .rail-dim[data-active="true"] { opacity: 1; }
          .rail[data-open="true"] { transform: translateX(0); visibility: visible; pointer-events: auto; }
          .head { display: flex; align-items: center; gap: var(--srf-spacing-sm); padding-bottom: var(--srf-spacing-sm); border-bottom: var(--srf-border-width) solid var(--srf-border); }
          .char-name { font-size: var(--srf-font-size-lg); font-weight: var(--srf-font-weight-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .kind-badge { flex: none; padding: var(--srf-spacing-xxs) var(--srf-spacing-xs); border: var(--srf-border-width) solid var(--srf-border-strong); border-radius: var(--srf-radius-pill); color: var(--srf-badge-accent, var(--srf-accent)); font-size: var(--srf-font-size-xs); }
          .head .spacer { flex: 1; }
          button.close, button.retry, button.stop, button.send, button.peer-open, button.peer-exit, button.peer-begin, button.peer-cancel {
            flex: none;
            padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
            background: var(--srf-panel-elevated);
            color: var(--srf-text-muted);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-sm);
            cursor: pointer;
            transition: color var(--srf-transition), background var(--srf-transition), border-color var(--srf-transition);
          }
          button.close:hover, button.peer-exit:hover, button.peer-cancel:hover { color: var(--srf-text); border-color: var(--srf-border-strong); }
          button.close:active, button.retry:active, button.stop:active, button.send:active, button.peer-open:active, button.peer-exit:active, button.peer-begin:active, button.peer-cancel:active { background: var(--srf-panel); }
          button.close:focus-visible, button.retry:focus-visible, button.stop:focus-visible, button.send:focus-visible, button.peer-open:focus-visible, button.peer-exit:focus-visible, button.peer-begin:focus-visible, button.peer-cancel:focus-visible, textarea:focus-visible, .peer-setup select:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          .messages {
            display: flex;
            flex-direction: column;
            gap: var(--srf-spacing-sm);
            min-height: 0;
            overflow-y: auto;
            padding: var(--srf-spacing-xs);
            scrollbar-width: thin;
            scrollbar-color: var(--srf-border-strong) transparent;
          }
          .messages::-webkit-scrollbar { width: var(--srf-spacing-sm); }
          .messages::-webkit-scrollbar-thumb { background: var(--srf-border-strong); border-radius: var(--srf-radius-pill); }
          .history-end { align-self: center; color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); padding: var(--srf-spacing-xs); }
          .bubble { max-width: 82%; box-sizing: border-box; padding: var(--srf-spacing-sm); background: var(--srf-panel-elevated); border: var(--srf-border-width) solid var(--srf-border); border-radius: var(--srf-radius); }
          .bubble[data-side="user"] { align-self: end; border-color: var(--srf-accent); }
          .bubble[data-side="assistant"] { align-self: start; }
          .bubble[data-side="peer"] { align-self: end; border-color: var(--srf-success); }
          .bubble-name { color: var(--srf-success); font-size: var(--srf-font-size-xs); font-weight: var(--srf-font-weight-semibold); margin-bottom: var(--srf-spacing-xs); }
          .bubble[data-error="true"] { border-color: var(--srf-danger); }
          .bubble[data-error="true"] .bubble-text { color: var(--srf-danger); }
          button.retry { display: block; margin-top: var(--srf-spacing-xs); color: var(--srf-danger); border-color: var(--srf-danger); }
          button.retry:hover { background: var(--srf-danger); color: var(--srf-bg); }
          .bubble-text { font-size: var(--srf-font-size-content, var(--srf-font-size-body, 14px)); line-height: var(--srf-line-height-content, 1.6); word-break: break-word; }
          /* 流式气泡还没成型（纯文本增量）—— 保留 pre-wrap 语义；定稿后才按 markdown 渲染 */
          .bubble[data-streaming="true"] .bubble-text { white-space: pre-wrap; }
          .system-message { align-self: center; max-width: 92%; color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); text-align: center; white-space: pre-wrap; word-break: break-word; padding: var(--srf-spacing-xxs) var(--srf-spacing-sm); }
          .caret { display: inline-block; width: var(--srf-spacing-xxs); height: 1em; margin-left: var(--srf-spacing-xxs); vertical-align: text-bottom; background: var(--srf-accent); animation: caret-blink 900ms step-end infinite; }
          @keyframes caret-blink { 50% { opacity: 0; } }
          .empty { align-self: center; color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); text-align: center; padding: var(--srf-spacing-xl) var(--srf-spacing-md); }
          .composer { display: grid; gap: var(--srf-spacing-xs); padding-top: var(--srf-spacing-sm); border-top: var(--srf-border-width) solid var(--srf-border); }
          textarea, .peer-setup select {
            box-sizing: border-box;
            padding: var(--srf-spacing-sm);
            background: var(--srf-bg);
            color: var(--srf-text);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-sm);
            transition: border-color var(--srf-transition), box-shadow var(--srf-transition);
          }
          textarea { width: 100%; min-height: 48px; resize: vertical; }
          textarea:hover, .peer-setup select:hover { border-color: var(--srf-border-strong); }
          textarea:disabled, button.send:disabled { opacity: 0.6; cursor: not-allowed; }
          .composer-foot { display: flex; align-items: center; justify-content: flex-end; gap: var(--srf-spacing-sm); }
          .hint { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); flex: 1; }
          .hint[data-tone="busy"] { color: var(--srf-warn); }
          button.stop { padding-inline: var(--srf-spacing-md); color: var(--srf-warn); border-color: var(--srf-warn); }
          button.stop:hover { background: var(--srf-warn); color: var(--srf-bg); }
          button.send { padding-inline: var(--srf-spacing-md); background: var(--srf-accent); color: var(--srf-bg); border-color: var(--srf-accent); font-weight: var(--srf-font-weight-semibold); }
          button.send:hover:not(:disabled) { background: var(--srf-accent-hover); }
          button.send:disabled { background: var(--srf-panel-elevated); color: var(--srf-text-disabled); border-color: var(--srf-border); }
          .head .peer-round { flex: none; color: var(--srf-warn); font-size: var(--srf-font-size-xs); font-variant-numeric: tabular-nums; }
          button.peer-open { color: var(--srf-accent); border-color: var(--srf-accent); }
          button.peer-open:hover { color: var(--srf-accent-hover); }
          .peer-setup { display: grid; gap: var(--srf-spacing-sm); align-content: start; padding: var(--srf-spacing-sm); }
          .peer-setup-title { font-size: var(--srf-font-size-md); font-weight: var(--srf-font-weight-semibold); overflow-wrap: anywhere; }
          .peer-setup label { display: flex; align-items: center; gap: var(--srf-spacing-sm); color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); }
          .peer-setup select { padding: var(--srf-spacing-xs); }
          .peer-setup select:disabled { color: var(--srf-text-disabled); cursor: not-allowed; opacity: 0.6; }
          .peer-setup-foot { display: flex; justify-content: flex-end; gap: var(--srf-spacing-sm); }
          button.peer-begin { padding-inline: var(--srf-spacing-md); background: var(--srf-success); color: var(--srf-bg); border-color: var(--srf-success); font-weight: var(--srf-font-weight-semibold); }
          button.peer-begin:disabled, button.peer-cancel:disabled, button.peer-exit:disabled, button.peer-open:disabled, button.stop:disabled, button.retry:disabled { background: var(--srf-panel-elevated); color: var(--srf-text-disabled); border-color: var(--srf-border); cursor: not-allowed; opacity: 0.6; }
          button.peer-cancel { padding-inline: var(--srf-spacing-md); }
          ${MARKDOWN_CSS}
        </style>
        <div class="rail-dim" data-role="rail-dim" data-active="false"></div>
        <div class="rail" data-role="rail" data-open="false">
          <div class="head">
            <span class="char-name" data-role="char-name">未选择角色</span>
            <span class="kind-badge" data-role="kind-badge">${escapeHtml(UNBOUND_KIND_LABEL)}</span>
            <span class="peer-round" data-role="peer-round" hidden></span>
            <span class="spacer"></span>
            <button type="button" class="peer-open" data-role="peer-open" hidden>让它们聊聊</button>
            <button type="button" class="peer-exit" data-role="peer-exit" hidden>退出互聊</button>
            <button type="button" class="close" data-role="close">关闭</button>
          </div>
          <strat-task-output-panel data-role="task-output"></strat-task-output-panel>
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

      // 嵌挂的任务输出面板（task_046）：外壳重建后重新捕获引用（重建后是新元素，
      // 旧引用的订阅已随 disconnectedCallback 退订，不会泄漏）；deps 与上下文由随后的
      // bindDeps 补上。
      this._taskOutput = root.querySelector<StratTaskOutputPanelElement>(TASK_OUTPUT_PANEL_TAG);

      if (!this._listenersBound) {
        this._listenersBound = true;

        // 输入事件：只改瞬时态 + 同步发送按钮，不重画消息流（输入时光标不能丢）。
        // task_052：互聊议题框同享该监听（瞬时态 _peerTopicDraft，同 draft 的口径）。
        root.addEventListener('input', (ev: Event) => {
          const target = ev.target as HTMLTextAreaElement | null;
          if (!target) return;
          if (target.dataset.role === 'draft') {
            this._draft = target.value;
            this.syncComposer();
            return;
          }
          if (target.dataset.role === 'peer-topic') {
            this._peerTopicDraft = target.value;
            this.syncPeerSetupForm();
          }
        });

        root.addEventListener('scroll', (ev: Event) => {
          const target = ev.target as HTMLElement | null;
          if (target?.dataset.role !== 'messages' || target.scrollTop !== 0) return;
          const characterId = this._sessions.viewing;
          if (characterId && !this._peerChat) this.requestEarlierHistory(characterId);
        }, true);

        // 互聊轮数选择（task_052）：select 的值变更走 change 事件（input 在部分引擎不触发）。
        root.addEventListener('change', (ev: Event) => {
          const target = ev.target as HTMLSelectElement | null;
          if (!target || target.dataset.role !== 'peer-rounds') return;
          const parsed = Number.parseInt(target.value, 10);
          if (PEER_ROUND_CHOICES.includes(parsed)) this._peerRoundsDraft = parsed;
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

        // 关闭 / 停止 / 发送 / 重试 / 互聊：data-role 定位 → 动作。
        root.addEventListener('click', (ev: Event) => {
          const target = ev.target as HTMLElement | null;
          if (!target) return;
          if (target.closest?.('[data-role="close"]')) this.close();
          else if (target.closest?.('[data-role="send"]')) this.send();
          else if (target.closest?.('[data-role="stop"]')) {
            // task_052：互聊进行中停止 = 中断整场讨论（onPeerChatStop）；普通发送中 = onStop。
            if (this._peerChat?.phase === 'running') {
              this._deps?.onPeerChatStop?.();
            } else if (this._sending && this._sessions.viewing) {
              this._deps?.onStop?.(this._sessions.viewing);
            }
          } else if (target.closest?.('[data-role="retry"]')) {
            // 重试钮带所属角色 id（错误气泡可能属于非当前查看的角色）。
            const button = target.closest<HTMLElement>('[data-role="retry"]');
            const characterId = button?.dataset.character;
            if (characterId) this._deps?.onRetry?.(characterId);
          } else if (target.closest?.('[data-role="peer-open"]')) {
            // 「让它们聊聊」只在有候选且未在互聊时可见；这里再验一次（按钮可点 ≠ 状态没变）。
            const candidates = this._peerCandidates;
            if (candidates && !this._peerChat) this.openPeerChat(candidates[0], candidates[1]);
          } else if (target.closest?.('[data-role="peer-exit"]')) {
            this.exitPeerChat();
          } else if (target.closest?.('[data-role="peer-begin"]')) {
            this.beginPeerChat();
          } else if (target.closest?.('[data-role="peer-cancel"]')) {
            this.exitPeerChat();
          }
        });
      }
    }

    /** 开合态 → 轨道节点的 data-open（CSS 平移由属性选择器接管，测试也断言它）。 */
    private syncRail(): void {
      const rail = this.shadowRoot?.querySelector('[data-role="rail"]');
      rail?.setAttribute('data-open', this._open ? 'true' : 'false');
      // 对侧压暗（@since v3.5，task_099；R2）：抽屉开着 → 压暗对侧；关 → 撤。
      const dim = this.shadowRoot?.querySelector('[data-role="rail-dim"]');
      dim?.setAttribute('data-active', this._open ? 'true' : 'false');
      // 半模态状态报给遮挡控制器（机制层知道「有个抽屉开着」—— 但它**不锁四角**）。
      this._deps?.occlusion?.setDrawer(this._open ? CHAT_DRAWER_OCCLUSION_ID : null);
    }

    /**
     * 头部同步：名字 / kind 徽标从最近快照的 characters 派生。
     * 互聊模式（task_052）下头部换成「A × B」+「互聊」徽标 —— 联合视图不指向单个角色。
     * 逐节点比对新值，没变不碰 DOM（档案广播频繁，头部无关变化不值得重写文本节点）。
     */
    private syncHeader(): void {
      const nameNode = this.shadowRoot?.querySelector('[data-role="char-name"]');
      const badgeNode = this.shadowRoot?.querySelector('[data-role="kind-badge"]');
      if (!nameNode || !badgeNode) return;
      if (this._peerChat) {
        const peerName = `${this.headerNameOf(this._peerChat.aId)} × ${this.headerNameOf(this._peerChat.bId)}`;
        if (nameNode.textContent !== peerName) nameNode.textContent = peerName;
        if (badgeNode.textContent !== '互聊') badgeNode.textContent = '互聊';
        return;
      }
      const header = resolveCharacterHeader(this._lastState?.characters ?? [], this._sessions.viewing);
      const nextName = header ? header.name : '未选择角色';
      const nextBadge = header?.kindLabel ?? UNBOUND_KIND_LABEL;
      if (nameNode.textContent !== nextName) nameNode.textContent = nextName;
      if (badgeNode.textContent !== nextBadge) badgeNode.textContent = nextBadge;
    }

    /** 互聊头部按钮 / 进度徽标可见性（task_052）：候选 → 「让它们聊聊」；互聊态 → 「退出互聊」。 */
    private syncPeerButtons(): void {
      const open = this.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="peer-open"]');
      const exit = this.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="peer-exit"]');
      if (open) open.hidden = !(this._peerCandidates !== null && this._peerChat === null);
      if (exit) exit.hidden = this._peerChat === null;
    }

    /** 轮次进度徽标（task_052）：仅互聊 running 相位显示「第 x/y 轮」。 */
    private syncPeerRound(): void {
      const node = this.shadowRoot?.querySelector<HTMLElement>('[data-role="peer-round"]');
      if (!node) return;
      const round = this._peerChat?.phase === 'running' ? this._peerRound : null;
      if (round) {
        const label = `第 ${round.current}/${round.total} 轮`;
        if (node.textContent !== label) node.textContent = label;
        node.hidden = false;
      } else {
        node.hidden = true;
        node.textContent = '';
      }
    }

    /** 议题表单的开始按钮可用性（task_052）：议题非空才可开始。 */
    private syncPeerSetupForm(): void {
      const begin = this.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="peer-begin"]');
      if (begin) begin.disabled = sendableDraft(this._peerTopicDraft) === null;
    }

    /**
     * 互聊议题表单（task_052）：占据消息区（setup 相位没有对话可显）。名字从最近快照解析
     * （缺失回落 id，同 headerNameOf 口径）；议题 / 轮数选回填自瞬时态（renderMessages 重建不丢）。
     */
    private renderSetupForm(): string {
      const peer = this._peerChat;
      if (!peer) return '';
      const aName = this.headerNameOf(peer.aId);
      const bName = this.headerNameOf(peer.bId);
      const options = PEER_ROUND_CHOICES.map(
        (count) =>
          `<option value="${count}"${count === this._peerRoundsDraft ? ' selected' : ''}>${count} 轮</option>`
      ).join('');
      return `
        <div class="peer-setup" data-role="peer-setup">
          <div class="peer-setup-title">让 ${escapeHtml(aName)} 与 ${escapeHtml(bName)} 讨论</div>
          <textarea data-role="peer-topic" placeholder="议题：想让它们聊什么？"></textarea>
          <label>轮数
            <select data-role="peer-rounds">${options}</select>
          </label>
          <div class="peer-setup-foot">
            <button type="button" class="peer-cancel" data-role="peer-cancel">取消</button>
            <button type="button" class="peer-begin" data-role="peer-begin"${sendableDraft(this._peerTopicDraft) === null ? ' disabled' : ''}>开始讨论</button>
          </div>
        </div>
      `;
    }

    /** 消息列表整体重建（结构变化时才走：提交 / 切角色 / 收束；流式增量走 updateStreamBubble）。 */
    private renderMessages(): void {
      const box = this.shadowRoot?.querySelector('[data-role="messages"]');
      if (!box) return;
      const viewing = this._sessions.viewing;
      if (!viewing) {
        // 统一空态组件（@since v3.8，task_136）。
        box.innerHTML = `<${EMPTY_STATE_TAG} data-role="empty">点选战场上的角色单位，开始对话</${EMPTY_STATE_TAG}>`;
        return;
      }
      const peer = this._peerChat;
      if (peer && viewing === peer.jointId && peer.phase === 'setup') {
        box.innerHTML = this.renderSetupForm();
        // 瞬时态回填（议题框 / 轮数选择）—— renderMessages 重建 DOM 不丢用户输入。
        const topicBox = box.querySelector<HTMLTextAreaElement>('[data-role="peer-topic"]');
        if (topicBox) topicBox.value = this._peerTopicDraft;
        return;
      }
      const messages = this._sessions.messages(viewing);
      if (messages.length === 0) {
        const emptyText =
          peer && viewing === peer.jointId
            ? `与 ${escapeHtml(this.headerNameOf(peer.aId))}、${escapeHtml(this.headerNameOf(peer.bId))} 的讨论还是空的`
            : `与 ${escapeHtml(this.headerNameOf(viewing))} 的对话还是空的`;
        box.innerHTML = `<${EMPTY_STATE_TAG} data-role="empty">${emptyText}</${EMPTY_STATE_TAG}>`;
      } else {
        const historyEnd = !peer && this._historyExhausted.has(viewing)
          ? '<div class="history-end" data-role="history-end">没有更早的聊天记录了</div>'
          : '';
        box.innerHTML = historyEnd + messages.map((message) => this.renderBubble(message)).join('');
        // markdown 增强（代码块外框 / 语言标签 / 复制按钮 / 链接新窗口）——
        // 必须在 innerHTML 之后做：按钮要挂真实事件，标签要从 DOM 里读。
        enhanceMarkdown(box);
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
      if (message.role === 'system') {
        return `
          <div class="system-message" data-role="system-message" data-message="${escapeHtml(message.id)}" data-side="system">${escapeHtml(message.text)}</div>
        `;
      }
      if (message.error) {
        return `
          <div class="bubble" data-role="bubble" data-message="${escapeHtml(message.id)}" data-side="assistant" data-error="true">
            <div class="bubble-text ${MARKDOWN_CLASS}">${renderMarkdown(message.text)}</div>
            <button type="button" class="retry" data-role="retry" data-character="${escapeHtml(message.characterId)}">重试</button>
          </div>
        `;
      }
      // peer 气泡（task_052）：对方发言 —— 带对方名字行（档案解析，缺失回落 id）。
      if (message.role === 'peer') {
        const peerName = message.peerId ? this.headerNameOf(message.peerId) : null;
        return `
          <div class="bubble" data-role="bubble" data-message="${escapeHtml(message.id)}" data-side="peer">
            ${peerName ? `<div class="bubble-name">${escapeHtml(peerName)}</div>` : ''}
            <div class="bubble-text ${MARKDOWN_CLASS}">${renderMarkdown(message.text)}</div>
          </div>
        `;
      }
      return `
        <div class="bubble" data-role="bubble" data-message="${escapeHtml(message.id)}" data-side="${escapeHtml(message.role)}">
          <div class="bubble-text ${MARKDOWN_CLASS}">${renderMarkdown(message.text)}</div>
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
      // 流的角色决定气泡侧（task_052：互聊 B 侧流是 peer —— 靠右 + 名字行，随流同步）。
      node.setAttribute('data-side', stream.role);
      let nameNode = node.querySelector<HTMLElement>('.bubble-name');
      if (stream.role === 'peer') {
        const peerName = this._peerChat ? this.headerNameOf(this._peerChat.bId) : '';
        if (!nameNode) {
          nameNode = document.createElement('div');
          nameNode.className = 'bubble-name';
          node.prepend(nameNode);
        }
        if (nameNode.textContent !== peerName) nameNode.textContent = peerName;
      } else {
        nameNode?.remove();
      }
      const textNode = node.querySelector<HTMLElement>('.bubble-text');
      if (textNode) textNode.textContent = stream.text;
      box.scrollTop = box.scrollHeight;
    }

    /** 输入区状态同步：只动禁用态与提示，不碰消息流。互聊相位（task_052）：running = 插话框
     *  （可用 + 停止钮替代发送中语义）；setup/ended = 禁用（议题表单 / 讨论已收束）。 */
    private syncComposer(): void {
      const box = this.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]');
      const send = this.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="send"]');
      const stop = this.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="stop"]');
      const hint = this.shadowRoot?.querySelector<HTMLElement>('[data-role="send-hint"]');
      const peerPhase = this._peerChat?.phase ?? null;
      const canType =
        this._sessions.viewing !== null &&
        !this._sending &&
        (peerPhase === null || peerPhase === 'running');
      if (box) box.disabled = !canType;
      if (send) send.disabled = !canType || sendableDraft(this._draft) === null;
      // 停止钮在发送中 / 互聊进行中出现（互聊中它是「停止整场讨论」）。
      if (stop) stop.hidden = !(this._sending || peerPhase === 'running');
      if (hint) {
        if (this._sending) {
          hint.textContent = '发送中…';
          hint.setAttribute('data-tone', 'busy');
        } else if (peerPhase === 'running') {
          hint.textContent = '旁听中，输入即可插话';
          hint.setAttribute('data-tone', 'muted');
        } else if (peerPhase === 'ended') {
          hint.textContent = '讨论已结束';
          hint.setAttribute('data-tone', 'muted');
        } else if (peerPhase === 'setup') {
          hint.textContent = '';
          hint.setAttribute('data-tone', 'muted');
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
