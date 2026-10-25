/**
 * 文件职责：**任务实时输出面板** Web Component（`<strat-task-output-panel>`，task_046）——
 *   busy 单位任务输出的 tail 视图：头部（「任务输出」+ 相位徽标 + 截断提示 + 跟随开关 +
 *   折叠钮）/ 正文（等宽观感的滚动输出区，自动滚底）。嵌挂在角色聊天抽屉（034 的
 *   「点单位 → 抽屉打开」既有语义）的头部与消息区之间 —— 选中 busy 单位即见实时 CLI 流。
 * 输入：注入的 deps.subscribe（吃 WorldState：tasks 驱动相位徽标 + 开工对账 + 可见性）；
 *   appendTaskOutput(characterId, chunk)（组合根接 task-service 的流转发端口 —— 组件只被驱动）。
 * 输出：Shadow DOM 折叠区；观察口（outputText / taskStatus / following / expanded / visible /
 *   scrollSyncs —— 测试与调试按它们断言，渲染内部态不外泄其它细节）。
 * 禁止事项：
 *   1. import world/、app/、phaser、vue、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— 一律经注入的 subscribe（Pick<HudBusAdapter,'subscribe'>）；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token
 *      （唯一的内联量是输出区 max-height，它是布局常量不是设计 token，见样式注释）；
 *   4. 正文走 innerHTML —— CLI 输出是外部输入，textContent 直写（XSS 面为零）；
 *   5. 泄漏监听器 —— disconnectedCallback 必须退订。
 *
 * ============ 状态分工（见 catalog 文件头「两份真相」）============
 * 相位读 WorldState.tasks（真相源）；流文本读本组件持有的 TaskOutputStore（每角色一条，
 * 32k 截头保尾）。开工对账：状态里出现 running 且缓冲 taskId 对不上 → store.begin
 * （清空重开）；**所有角色**都做对账（不只是当前展示的 —— 用户随时会切过来看别的角色，
 * 缓冲必须一直在收）。
 *
 * ============ 跟随（auto-scroll）与暂停 ============
 * following=true：每次文本变更滚到底（tail 视图的本义）；点「暂停跟随」→ following=false，
 * **缓冲照收、DOM 照更**（不丢数据），只是不滚 —— 用户在读上文；再点恢复 → 立即追平
 * （滚到底一次）。新任务开工（begin）时跟随复位 true（新流从零看起）。
 *
 * ============ 折叠口径 ============
 * 默认收起；**展示的角色进入 running → 自动展开**（task_046 需求①「默认展开当 running」）；
 * 用户手动折叠后不自动顶开（同 chat-drawer 的「无关广播不顶开刚关的抽屉」同一礼仪），
 * 下一次开工（新 taskId）才重新展开。
 *
 * 渲染策略（perf，与 chat-drawer 同一口径）：外壳建一次；流式增量只改输出区 textContent
 * （文本没变不碰 DOM —— 每条 chunk 一次字符串比对，远轻于重建节点）；徽标 / 提示 / 开关
 * 全走属性同步。
 *
 * @since v3.22（task_046）。宿主与嵌挂接线见 chat-drawer.ts（v3.22 注记）与 main-entry.ts。
 *   v3.24（task_048）追加 setTaskArtifacts（成果物摘要块喂入口）与新任务开工时的清空。
 */

import type { TaskStatus, WorldState } from '../../../core/types';
import type { HudBusAdapter } from '../../bridge/bus-adapter';

import {
  TASK_PHASE_LABELS,
  createTaskOutputStore,
  latestTaskFor,
  resolveTaskOutputDisplay,
  type TaskOutputStore,
} from './task-output-catalog';

export const TASK_OUTPUT_PANEL_TAG = 'strat-task-output-panel';

/** 面板需要的最小能力面：只要"订阅状态"（相位真相 + 可见性都从 WorldState 派生）。 */
export type TaskOutputPanelDeps = Pick<HudBusAdapter, 'subscribe'>;

/** 自定义元素的对外形状（嵌挂方 chat-drawer、组合根 main-entry 与测试按它操作）。 */
export interface StratTaskOutputPanelElement extends HTMLElement {
  /** 注入的依赖；在 connected 之前或之后设置都生效。 */
  deps: TaskOutputPanelDeps | null;
  /** 切换展示的角色（chat-drawer 在 open / setCharacter 时调）；null = 无上下文（隐藏）。 */
  showFor(characterId: string | null): void;
  /** 当前展示的角色 id；未设置为 null。 */
  readonly characterId: string | null;
  /** 实时流端口（task_046 需求②）：追加 chunk 进该角色的缓冲并刷新视图（不切上下文）。 */
  appendTaskOutput(characterId: string, chunk: string): void;
  /**
   * 成果物摘要块喂入口（task_048）：附在该角色展示文本尾部（文案由组合根用 app 层的
   * formatTaskArtifactsBlock 算好传入 —— hud 不 import app/，铁律）。空串 = 清除。
   */
  setTaskArtifacts(characterId: string, block: string): void;
  /** 是否跟随滚底（true = 自动滚底；暂停 = 收而 不滚）。 */
  readonly following: boolean;
  /** 折叠区展开态。 */
  readonly expanded: boolean;
  /** 整段是否可见（角色有任务才见）。 */
  readonly visible: boolean;
  /** 展示中的任务相位；不可见 / 无任务为 null。 */
  readonly taskStatus: TaskStatus | null;
  /** 展示中的输出文本（视图模型合成后的；占位文案不算在内）。 */
  readonly outputText: string;
  /** 缓冲是否发生过截头。 */
  readonly truncated: boolean;
  /** 滚底同步计数（测试 / 调试观察口：每次自动滚底 / 追平 +1 —— 暂停期间不增）。 */
  readonly scrollSyncs: number;
}

/** 空输出时的占位文案（running 没等到第一个 chunk / queued 排队中）。 */
const EMPTY_OUTPUT_PLACEHOLDER = '等待输出…';

/**
 * 工厂：注册 `<strat-task-output-panel>`。
 * 幂等（与 defineCharacterChatDrawer / defineToastHost 同约定）：重复 register 返回已注册构造器。
 */
export function defineTaskOutputPanel(): typeof HTMLElement {
  if (customElements.get(TASK_OUTPUT_PANEL_TAG)) {
    return customElements.get(TASK_OUTPUT_PANEL_TAG) as unknown as typeof HTMLElement;
  }

  class TaskOutputPanel extends HTMLElement implements StratTaskOutputPanelElement {
    private _deps: TaskOutputPanelDeps | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _listenersBound = false;
    private _state: WorldState | null = null;
    private readonly _store: TaskOutputStore = createTaskOutputStore();
    private _characterId: string | null = null;
    private _expanded = false;
    private _following = true;
    private _scrollSyncs = 0;
    /** 上次写进输出区的文本（没变不碰 DOM —— 流式高频，比对远轻于重写）。 */
    private _renderedText: string | null = null;
    /** 每角色一份成果物摘要块（task_048；组合根在任务完成时喂入，新任务开工随 begin 清）。 */
    private readonly _artifactsBlocks = new Map<string, string>();

    // —— 属性面 ——
    get deps(): TaskOutputPanelDeps | null { return this._deps; }
    set deps(value: TaskOutputPanelDeps | null) {
      this._deps = value;
      this.bindDeps();
    }

    get characterId(): string | null { return this._characterId; }
    get following(): boolean { return this._following; }
    get expanded(): boolean { return this._expanded; }

    get visible(): boolean {
      const root = this.shadowRoot?.querySelector('[data-role="root"]');
      return root !== null && root !== undefined && !(root as HTMLElement).hidden;
    }

    get taskStatus(): TaskStatus | null {
      return this.display().phase;
    }

    get outputText(): string {
      return this.display().text;
    }

    get truncated(): boolean {
      return this.display().truncated;
    }

    get scrollSyncs(): number { return this._scrollSyncs; }

    connectedCallback(): void {
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.renderChrome();
      this.bindDeps();
      this.syncAll();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：不退订的话，反复挂卸会把订阅堆成 O(n)，且元素已不在文档里仍在收广播。
      this.releaseDeps();
    }

    // —— 公开接口 ——
    showFor(characterId: string | null): void {
      if (this._characterId === characterId) return;
      this._characterId = characterId;
      // 切上下文复位跟随（看谁就 tail 谁）；展开态保留用户选择（不打断正在读的展开全文）。
      // 例外：切到 running 中的角色 → 默认展开（需求①「默认展开当 running」——
      // 状态先到、上下文后切的时序也走这条；冷开在终态任务上不强展开，回看是用户动作）。
      this._following = true;
      // task_049：挂起也自动展开 —— 流里是计划全文，面板（046）就是「计划全文」的展示面之一
      //（审批卡在 agent-panel，这里是流视角）；批准后回 running 仍走上面的展开分支。
      if (this.display().phase === 'running' || this.display().phase === 'awaiting_approval') {
        this._expanded = true;
      }
      this.syncAll();
    }

    appendTaskOutput(characterId: string, chunk: string): void {
      this._store.append(characterId, chunk);
      // 不是当前展示的角色也照收（缓冲为所有角色服务），只是本视图无感。
      if (characterId === this._characterId) this.syncAll();
    }

    /**
     * 成果物摘要块喂入口（task_048）：组合根在任务完成（onTaskSettled）时把
     * formatTaskArtifactsBlock 算好的文案塞进来，附在该角色展示文本尾部（渲染模型与
     * 📋 报告共用 —— 那边也在尾部拼同一函数的产物，规格④）。空串 = 清除（failed / 防御）。
     * 新任务开工（begin 换 taskId）随流一起清（见 handleState 的对账循环）。
     */
    setTaskArtifacts(characterId: string, block: string): void {
      const trimmed = block.trim();
      if (trimmed.length === 0) this._artifactsBlocks.delete(characterId);
      else this._artifactsBlocks.set(characterId, trimmed);
      if (characterId === this._characterId) this.syncAll();
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
     *   1. **所有角色**的 running 任务对账开工（缓冲 taskId 对不上 → begin 清空重开）；
     *      展示中的角色开工 → 自动展开 + 跟随复位（需求①「默认展开当 running」）；
     *   2. 相位徽标 / 可见性 / 文本随最新快照刷新（completed 也照常 —— 完成态可回看）。
     */
    private handleState(state: WorldState): void {
      this._state = state;
      const tasks = state.tasks ?? [];
      for (const task of tasks) {
        if (task.status !== 'running') continue;
        const entry = this._store.entry(task.characterId);
        if (entry && entry.taskId === task.id) continue; // 已对账（重复广播）
        this._store.begin(task.characterId, task.id);
        this._artifactsBlocks.delete(task.characterId); // 新任务开工：旧成果物随流一起清（task_048）
        if (task.characterId === this._characterId) {
          this._expanded = true; // 新执行默认展开
          this._following = true; // 新流从零看起
        }
      }
      this.syncAll();
    }

    // —— 渲染 ——
    private renderChrome(): void {
      const root = this.shadowRoot;
      if (!root) return;

      root.innerHTML = `
        <style>
          /* 嵌挂在抽屉 rail 的网格行里：占位由宿主网格管，隐藏由 [hidden] 接管 */
          :host { all: initial; display: block; min-height: 0; }
          .section {
            display: grid;
            gap: var(--srf-spacing-xs, 4px);
            padding: var(--srf-spacing-xs, 4px);
            background: var(--srf-panel-elevated, #20262f);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            color: var(--srf-text, #e6e9ef);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-md, 14px);
            line-height: var(--srf-line-height, 1.4);
          }
          .section[hidden] { display: none; }
          .head {
            display: flex;
            align-items: center;
            gap: var(--srf-spacing-xs, 4px);
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-xs, 4px);
            cursor: pointer;
            user-select: none;
          }
          .chevron { color: var(--srf-text-muted, #9aa3b2); font-size: var(--srf-font-size-sm, 12px); }
          .title {
            color: var(--srf-text-muted, #9aa3b2);
            font-size: var(--srf-font-size-sm, 12px);
            letter-spacing: 0.04em;
          }
          .phase {
            padding: 0 var(--srf-spacing-xs, 4px);
            border: var(--srf-border-width, 1px) solid var(--srf-border-strong, #3a4252);
            border-radius: var(--srf-radius, 6px);
            font-size: var(--srf-font-size-sm, 12px);
            color: var(--srf-text-muted, #9aa3b2);
          }
          .phase[data-status="queued"] { color: var(--srf-text-disabled, #5a6373); }
          .phase[data-status="running"] { color: var(--srf-accent, #6ea8ff); border-color: var(--srf-accent, #6ea8ff); }
          .phase[data-status="completed"] { color: var(--srf-success, #6fcf97); border-color: var(--srf-success, #6fcf97); }
          .phase[data-status="failed"] { color: var(--srf-danger, #e06c75); border-color: var(--srf-danger, #e06c75); }
          .truncated-hint {
            color: var(--srf-warn, #f0c674);
            font-size: var(--srf-font-size-sm, 12px);
          }
          .truncated-hint[hidden] { display: none; }
          .head .spacer { flex: 1; }
          button.follow {
            flex: none;
            padding: 0 var(--srf-spacing-sm, 8px);
            background: var(--srf-panel, #181c25);
            color: var(--srf-text-muted, #9aa3b2);
            border: var(--srf-border-width, 1px) solid var(--srf-border-strong, #3a4252);
            border-radius: var(--srf-radius, 6px);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-sm, 12px);
            cursor: pointer;
          }
          button.follow:hover { border-color: var(--srf-accent, #6ea8ff); color: var(--srf-accent, #6ea8ff); }
          button.follow[data-following="false"] {
            color: var(--srf-warn, #f0c674);
            border-color: var(--srf-warn, #f0c674);
          }
          .body { display: block; }
          .section[data-expanded="false"] .body { display: none; }
          .output {
            margin: 0;
            /* 布局常量（非皮肤 token）：tail 视图的窗口高度 —— 抽屉里消息区才是主舞台 */
            max-height: 240px;
            overflow-y: auto;
            box-sizing: border-box;
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-sm, 8px);
            background: var(--srf-bg, #0f1116);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-sm, 12px);
            white-space: pre-wrap;
            word-break: break-word;
          }
        </style>
        <section class="section" data-role="root" data-expanded="false" hidden>
          <div class="head" data-role="toggle">
            <span class="chevron" data-role="chevron">▸</span>
            <span class="title">任务输出</span>
            <span class="phase" data-role="phase"></span>
            <span class="truncated-hint" data-role="truncated" hidden>前文已截断</span>
            <span class="spacer"></span>
            <button type="button" class="follow" data-role="follow" data-following="true">暂停跟随</button>
          </div>
          <div class="body" data-role="body">
            <pre class="output" data-role="output" aria-live="polite"></pre>
          </div>
        </section>
      `;

      if (!this._listenersBound) {
        this._listenersBound = true;
        // 头部交互：跟随开关优先拦截；其余头部区域点击 = 折叠/展开。
        root.addEventListener('click', (ev: Event) => {
          const target = ev.target as HTMLElement | null;
          if (!target) return;
          if (target.closest?.('[data-role="follow"]')) {
            this.toggleFollow();
            return;
          }
          if (target.closest?.('[data-role="toggle"]')) this.toggleExpanded();
        });
      }
    }

    /** 当前展示角色的视图模型（读零成本；渲染与观察口共用同一份合成，不两算）。 */
    private display(): ReturnType<typeof resolveTaskOutputDisplay> {
      const latest = latestTaskFor(this._state?.tasks, this._characterId);
      return resolveTaskOutputDisplay(
        this._store.entry(this._characterId ?? ''),
        latest,
        this._artifactsBlocks.get(this._characterId ?? '') ?? ''
      );
    }

    private toggleFollow(): void {
      this._following = !this._following;
      if (this._following) this.syncScroll(); // 恢复跟随 = 立即追平一次（缓冲里的尾部即刻到位）
      this.syncHead();
    }

    private toggleExpanded(): void {
      this._expanded = !this._expanded;
      if (this._expanded && this._following) this.syncScroll(); // 展开时若在跟随，滚到当前尾部
      this.syncHead();
    }

    /** 滚底同步（tail 视图本义）：jsdom 里 scrollHeight 恒 0，计数器保证行为可断言。 */
    private syncScroll(): void {
      const box = this.shadowRoot?.querySelector('[data-role="output"]');
      if (!box) return;
      box.scrollTop = box.scrollHeight;
      this._scrollSyncs += 1;
    }

    /** 头部同步：徽标 / 截断提示 / 跟随钮 / 折叠钮 —— 逐节点比对新值，没变不碰 DOM。 */
    private syncHead(): void {
      const section = this.shadowRoot?.querySelector('[data-role="root"]');
      if (!section) return;
      const view = this.display();

      if (section.hasAttribute('hidden') === view.visible) {
        if (view.visible) section.removeAttribute('hidden');
        else section.setAttribute('hidden', '');
      }

      if (section.getAttribute('data-expanded') !== String(this._expanded)) {
        section.setAttribute('data-expanded', String(this._expanded));
      }

      const phase = this.shadowRoot?.querySelector('[data-role="phase"]');
      if (phase) {
        const label = view.phase ? TASK_PHASE_LABELS[view.phase] : '';
        const tone = view.phase ?? '';
        if (phase.textContent !== label) phase.textContent = label;
        if (phase.getAttribute('data-status') !== tone) phase.setAttribute('data-status', tone);
      }

      const hint = this.shadowRoot?.querySelector('[data-role="truncated"]');
      if (hint && hint.hasAttribute('hidden') === view.truncated) {
        if (view.truncated) hint.removeAttribute('hidden');
        else hint.setAttribute('hidden', '');
      }

      const follow = this.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="follow"]');
      if (follow) {
        const label = this._following ? '暂停跟随' : '恢复跟随';
        if (follow.textContent !== label) follow.textContent = label;
        if (follow.getAttribute('data-following') !== String(this._following)) {
          follow.setAttribute('data-following', String(this._following));
        }
      }

      const chevron = this.shadowRoot?.querySelector('[data-role="chevron"]');
      if (chevron) {
        const mark = this._expanded ? '▾' : '▸';
        if (chevron.textContent !== mark) chevron.textContent = mark;
      }
    }

    /** 正文同步：文本没变不碰 DOM；变了 textContent 直写（零 XSS 面）+ 跟随滚底。 */
    private syncAll(): void {
      this.syncHead();
      const box = this.shadowRoot?.querySelector('[data-role="output"]');
      if (!box) return;
      const view = this.display();
      const text = view.text.length > 0 ? view.text : view.visible ? EMPTY_OUTPUT_PLACEHOLDER : '';
      if (text !== this._renderedText) {
        this._renderedText = text;
        box.textContent = text; // CLI 输出是外部输入：textContent 直写，绝不 innerHTML
        if (this._following && this._expanded && view.visible) this.syncScroll();
      }
    }
  }

  customElements.define(TASK_OUTPUT_PANEL_TAG, TaskOutputPanel);
  return TaskOutputPanel as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：本仓库组件的统一装配口径（与 mountCharacterChatDrawer / mountToastHost 一致）——
 * 建元素、注入 deps、挂进容器，返回 unmount 闭包。
 * 正式装配走 chat-drawer 的嵌挂（不直接调本工厂）；工厂留给独立挂载场景（测试 / 调试页）。
 */
export function mountTaskOutputPanel(deps: TaskOutputPanelDeps, host: HTMLElement): () => void {
  defineTaskOutputPanel();
  const element = document.createElement(TASK_OUTPUT_PANEL_TAG) as StratTaskOutputPanelElement;
  element.deps = deps;
  host.appendChild(element);
  // 移除元素触发 disconnectedCallback → 退订，订阅随之释放。
  return () => { element.remove(); };
}
