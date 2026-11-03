/**
 * 文件职责：命令面板 Web Component（`<strat-command-panel>`）—— HUD 的**唯一命令入口**，
 *   合并旧 CommandPanel（选中单位后的操作）与 CommandPalette（全局命令 + 搜索）的功能语义。
 *   命令清单与命令构造全在 command-catalog.ts（纯逻辑），本文件只负责：把 WorldState 画成列表、
 *   把点击变成 HudCommand 经注入的 adapter 派发。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 panels/ 层级；语义提取自 src/components/CommandPanel.vue
 *   与 src/composables/useCommandPalette.ts（只读参考，未复制任何实现）。
 * 输入：注入的 HudBusAdapter（dispatch / subscribe 两个能力就够）；用户输入（搜索词、任务标题草稿）。
 * 输出：Shadow DOM 面板；点击 → HudCommand → adapter.dispatch。
 * 禁止事项：
 *   1. import world/、phaser、vue、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— HUD 一律经注入的 adapter 发命令与订阅状态；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token；
 *   4. 在本地维护选择集 / 任务相位 —— 可用性一律现算自 WorldState，判断权在 core；
 *   5. 泄漏监听器 —— disconnectedCallback 必须退订，否则元素反复挂卸会累积订阅（perf 硬约束）。
 *
 * 渲染策略（perf）：core 每次状态变更都全量广播，面板不能跟着无脑重建 DOM。
 *   用 renderSignature（选择集 revision + 单位数 + 任务相位 + 前 N 条通知）判重，
 *   签名不变就跳过重渲染；输入框所在的"外壳"只在挂载时建一次，输入时光标不丢。
 *
 * 外部样式钩子（@since v3.7，task_020）：命令分组根节点带 `part="group"`，
 *   供 hud/screens/main-screen.ts 把分组内的命令按钮排成横排（底栏"命令横条"用）。
 *   why 用 part 而不是改内部样式：面板内部布局不动（见文件头禁止事项），
 *   挂载方按 part 适配即可；本组件不因外部样式改变行为。
 *
 * 紧凑条形态（@since v3.4，task_090）：`variant="strip"` —— 控制岛（Z4）里的 1 行命令条。
 *   形态差异只有**排版**：抬头 / 通知列表 / 两个输入框压成行内窄控件，命令按钮去掉副标题
 *   （副标题改为按钮的 title 悬停提示），两个 scope 分组的按钮汇进同一条横向滚动行。
 *   why 归本组件而不是外部样式：`::part()` 只能改样式、不能改 DOM 顺序，
 *   而「1 行 6 条 + 其余横向滚动」要求把两个分组摊平成一条流 —— 那是结构，不是皮肤。
 *   ★ 命令一条不减：12 条命令仍在（滚动可达），搜索框与任务标题草稿框仍在（压成行内窄控件）。
 *   ★ 行为零差异：判定 / 构造 / 派发全走同一份 command-catalog，本形态只改排版。
 *
 * 「新建任务」的去向（@since v3.6，task_112）：global 组的「新建任务」**不再直发** mission.create ——
 *   它派发 DOM 事件 NEW_TASK_OPEN_EVENT，由组合根打开新建任务对话框（单任务 / 流水线 / 派发 / 取消）。
 *   why：发起方式有四种，命令条只能给一个按钮 —— 走对话框才让用户选；
 *   why 走 DOM 事件而不是总线命令：开对话框是纯 UI 动作，core 不该为它加一条命令
 *   （与「打开聊天」stratix:chat-open 同一口径）。命令的**构造**仍出自 command-catalog
 *   （对话框拿同一份构造器用），判定口径一字未改。
 *   副产物：对话框建完任务会派发 NEW_TASK_SUBMITTED_EVENT → 本面板清掉标题草稿
 *   （否则再点一次「新建任务」会用同一句话再建一条）。
 */

import type { HudCommand, WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
import {
  NEW_TASK_OPEN_EVENT,
  NEW_TASK_SUBMITTED_EVENT,
} from '../components/new-task-dialog/new-task-dialog';

import type {
  CommandContext,
  CommandScope,
  PanelCommandId,
  ResolvedCommand,
} from './command-catalog';
import {
  buildCommand,
  describeSelection,
  filterCommands,
  findCommandSpec,
  groupByScope,
  MAX_VISIBLE_NOTICES,
  renderSignature,
  resolveCommands,
} from './command-catalog';

export const COMMAND_PANEL_TAG = 'strat-command-panel';

/** 面板需要的最小能力面：只要"发命令"与"订阅状态"，与 hello-loop-panel 同一约定。 */
export type CommandPanelDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'>;

/** 自定义元素的对外形状（测试与挂载方按它断言）。 */
export interface StratCommandPanelElement extends HTMLElement {
  /** 注入的适配器；在 connected 之前或之后设置都生效。 */
  adapter: CommandPanelDeps | null;
  /** 搜索词（面板瞬时态）。 */
  query: string;
  /** 「发起任务」的标题草稿（面板瞬时态，不是业务状态）。 */
  draftTitle: string;
  /** 强制重算重渲染（改了瞬时态或注入新 state 后可手动调用）。 */
  refresh(): void;
  /** 当前可见的命令 id（按渲染顺序），供测试断言"该显示的显示了"。 */
  readonly visibleCommandIds: readonly PanelCommandId[];
  /** 最近一次收到的 WorldState。 */
  readonly lastState: WorldState | null;
}

const SECTION_LABELS: Record<'selection' | 'global', string> = {
  selection: '选中单位',
  global: '全局命令',
};

/** HTML 文本转义。hint / 通知文本含用户输入（任务标题、单位名），必须转义后才进 innerHTML。 */
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
 * 工厂：注册 `<strat-command-panel>`。
 * 幂等（与 defineStratButton 同约定）：重复 register 返回已注册构造器，不抛错。
 */
export function defineCommandPanel(): typeof HTMLElement {
  if (customElements.get(COMMAND_PANEL_TAG)) {
    return customElements.get(COMMAND_PANEL_TAG) as unknown as typeof HTMLElement;
  }

  class CommandPanel extends HTMLElement implements StratCommandPanelElement {
    private _adapter: CommandPanelDeps | null = null;
    private _query = '';
    private _draftTitle = '';
    private _state: WorldState | null = null;
    private _lastSignature: string | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _listenersBound = false;

    // —— 属性面 ——
    get adapter(): CommandPanelDeps | null { return this._adapter; }
    set adapter(value: CommandPanelDeps | null) {
      this._adapter = value;
      this.bindAdapter();
      this.refresh();
    }

    get query(): string { return this._query; }
    set query(value: string) {
      this._query = value;
      this.refresh();
    }

    get draftTitle(): string { return this._draftTitle; }
    set draftTitle(value: string) {
      this._draftTitle = value;
      this.refresh();
    }

    get lastState(): WorldState | null { return this._state; }

    get visibleCommandIds(): readonly PanelCommandId[] {
      return this.contextualCommands().map((c) => c.spec.id);
    }

    connectedCallback(): void {
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.renderChrome();
      // 清签名强制首绘：挂载前 adapter setter 里那次 refresh 已经把签名记下了，
      // 而那时还没有 shadowRoot、列表根本没画 —— 不清掉的话这次 refresh 会被判重跳过，列表就空了。
      this._lastSignature = null;
      // 「已提交任务」事件（@since v3.6，task_112）：对话框建完任务后清标题草稿。
      // 挂在 document 上 —— 对话框与本面板是兄弟组件（互不持有引用，事件是唯一通道）。
      document.addEventListener(NEW_TASK_SUBMITTED_EVENT, this.onNewTaskSubmitted);
      this.bindAdapter();
      this.refresh();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：不退订的话，反复挂卸会把订阅堆成 O(n)，且组件已不在文档里仍在收广播。
      this.releaseAdapter();
      document.removeEventListener(NEW_TASK_SUBMITTED_EVENT, this.onNewTaskSubmitted);
      this._lastSignature = null;
    }

    refresh(): void {
      const signature = renderSignature(this._state, this._draftTitle, this._query);
      if (signature === this._lastSignature) return;
      this._lastSignature = signature;
      this.renderSections();
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

    // —— 命令派生（纯逻辑都在 catalog 里，这里只组装上下文）——
    private context(): CommandContext {
      return { state: this._state, draftTitle: this._draftTitle };
    }

    private contextualCommands(): ResolvedCommand[] {
      return filterCommands(resolveCommands(this.context()), this._query);
    }

    /**
     * 点某条命令 → HudCommand → adapter.dispatch。
     * scope 一并传进来：同一个 id 在两个分组下入参不同（发起任务带指派对象 / 新建任务是草稿），
     * 用点击时携带的 scope 定位目录项，保证"点到的"与"构造出的"严格一致。
     * 构造不出来就什么都不发 —— 不发半截命令给 core。
     *
     * 例外（@since v3.6，task_112）：global 组的「新建任务」**不发命令**，改为打开新建任务对话框
     * （单任务 / 流水线 / 派发 / 取消 四选一）。selection 组的「发起任务」照旧直发 mission.create。
     */
    private runCommand(id: PanelCommandId, scope: CommandScope): void {
      if (!this._adapter) return;
      if (id === 'mission.create' && scope === 'global') {
        this.requestNewTaskDialog();
        return;
      }
      const spec = findCommandSpec(id, scope);
      if (!spec) return;
      const command: HudCommand | null = buildCommand(spec, this.context());
      if (!command) return;
      this._adapter.dispatch(command);
    }

    /**
     * 请求打开新建任务对话框（@since v3.6，task_112）。
     * 事件带标题（组合根据此预填对话框）；标题为空时什么都不做
     * —— 按钮此刻是禁用态，走不到这里；这里再挡一道是防「事件被外部伪造」。
     */
    private requestNewTaskDialog(): void {
      const title = this._draftTitle.trim();
      if (title.length === 0) return;
      this.dispatchEvent(
        new CustomEvent(NEW_TASK_OPEN_EVENT, {
          bubbles: true,
          composed: true,
          detail: { title },
        })
      );
    }

    /**
     * 对话框建完任务后的回调（@since v3.6，task_112）：清掉标题草稿。
     * 只在草稿**还是**刚提交的那句时才清 —— 用户若已经改写了输入框，别把他的新字抹掉。
     * why 是箭头函数字段：它要当 document 的事件监听用（普通方法被摘下来当监听时 this 会指向 document）。
     */
    private readonly onNewTaskSubmitted = (event: Event): void => {
      const title = (event as CustomEvent<{ title?: string }>).detail?.title ?? '';
      if (title.length === 0 || title !== this._draftTitle.trim()) return;
      this._draftTitle = '';
      const input = this.shadowRoot?.querySelector('[data-role="draft"]') as HTMLInputElement | null;
      if (input) input.value = '';
      this.refresh();
    };

    // —— 渲染 ——
    private renderChrome(): void {
      const root = this.shadowRoot;
      if (!root) return;

      root.innerHTML = `
        <style>
          :host { all: initial; }
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
          .head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--srf-spacing-sm); }
          .title { font-size: var(--srf-font-size-lg); font-weight: var(--srf-font-weight-semibold); }
          .selection, .field-name, .group-name, .empty { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); }
          .notices, .sections, .group { display: grid; gap: var(--srf-spacing-xs); }
          .notice {
            padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
            border-left: var(--srf-spacing-xxs) solid var(--srf-border-strong);
            border-radius: var(--srf-radius);
            background: var(--srf-panel-elevated);
            color: var(--srf-text-muted);
            font-size: var(--srf-font-size-sm);
          }
          .notice[data-level="warn"] { color: var(--srf-warn); border-left-color: var(--srf-warn); }
          .notice[data-level="error"] { color: var(--srf-danger); border-left-color: var(--srf-danger); }
          label.field { display: grid; gap: var(--srf-spacing-xs); }
          input {
            width: 100%;
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
          input:hover { border-color: var(--srf-border-strong); }
          input:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          .group-name { font-weight: var(--srf-font-weight-semibold); letter-spacing: 0.04em; }
          .empty { padding: var(--srf-spacing-md); text-align: center; border: var(--srf-border-width) dashed var(--srf-border); border-radius: var(--srf-radius); }
          button.command {
            display: grid;
            gap: var(--srf-spacing-xxs);
            width: 100%;
            text-align: left;
            padding: var(--srf-spacing-sm);
            background: var(--srf-panel-elevated);
            color: var(--srf-text);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-sm);
            cursor: pointer;
            transition: background var(--srf-transition), border-color var(--srf-transition), color var(--srf-transition);
          }
          button.command:hover:not(:disabled) { border-color: var(--srf-border-strong); background: var(--srf-panel); }
          button.command:active:not(:disabled) { border-color: var(--srf-accent); }
          button.command:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          button.command[data-primary="true"]:not(:disabled) { border-color: var(--srf-accent); color: var(--srf-accent); }
          button.command:disabled { color: var(--srf-text-disabled); cursor: not-allowed; opacity: 0.65; }
          .cmd-label { font-weight: var(--srf-font-weight-semibold); }
          .cmd-hint { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); }
          button.command:disabled .cmd-hint { color: var(--srf-text-disabled); }
          /* —— 紧凑条形态（@since v3.4，task_090）：控制岛内的 1 行命令条 ——
             排版差异全部收在这里；命令清单、可用性判定与派发与完整形态完全一致。
             why 抬头与通知列表在紧凑形态下沉：控制岛的高度预算是 100px（硬验收），
             抬头 / 通知 / 两个输入框一行摆不下 —— 通知的「计数」仍由顶栏徽标承担。 */
          :host([variant="strip"]) .panel {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: var(--srf-spacing-xs);
            padding: 0;
            background: transparent;
            border: none;
            border-radius: 0;
            overflow: visible;
          }
          :host([variant="strip"]) .head,
          :host([variant="strip"]) .notices { display: none; }
          /* 两个输入框压成行内窄控件（搜索 + 任务标题草稿都还在，一项功能不减）。 */
          :host([variant="strip"]) label.field {
            display: flex;
            align-items: center;
            gap: var(--srf-spacing-xxs);
            flex: 0 0 auto;
            min-width: 0;
          }
          :host([variant="strip"]) .field-name { display: none; }
          :host([variant="strip"]) input {
            width: var(--command-strip-input-w, 96px);
            height: 22px;
            padding: 0 var(--srf-spacing-xs);
            font-size: var(--srf-font-size-xs);
          }
          /* 命令流：两个 scope 分组的按钮摊平成一条横排（group-name 在紧凑形态下沉）。 */
          :host([variant="strip"]) .sections {
            display: flex;
            flex: 1 1 auto;
            align-items: center;
            gap: var(--srf-spacing-xs);
            min-width: 0;
            overflow-x: auto;
            overflow-y: hidden;
            scrollbar-width: thin;
          }
          :host([variant="strip"]) .group { display: contents; }
          :host([variant="strip"]) .group-name { display: none; }
          :host([variant="strip"]) button.command {
            display: inline-flex;
            align-items: center;
            width: auto;
            flex: 0 0 auto;
            padding: 2px var(--srf-spacing-sm);
            font-size: var(--srf-font-size-xs);
            white-space: nowrap;
          }
          /* 副标题（作用对象 / 禁用原因）改挂按钮 title —— 悬停可见，不占行高。 */
          :host([variant="strip"]) .cmd-hint { display: none; }
          :host([variant="strip"]) .empty {
            padding: var(--srf-spacing-xs);
            font-size: var(--srf-font-size-xs);
          }
        </style>
        <div class="panel" part="panel">
          <div class="head">
            <span class="title">命令</span>
            <span class="selection" data-role="selection">未选中单位</span>
          </div>
          <div class="notices" data-role="notices"></div>
          <label class="field">
            <span class="field-name">任务标题</span>
            <input type="text" data-role="draft" placeholder="输入后「发起任务」才可用" />
          </label>
          <label class="field">
            <span class="field-name">搜索命令</span>
            <input type="search" data-role="query" placeholder="如 mission / 主题 / 设置" />
          </label>
          <div class="sections" data-role="sections"></div>
        </div>
      `;

      if (!this._listenersBound) {
        this._listenersBound = true;

        // 输入事件：只改瞬时态 + 重画列表。外壳（含 input）不重建，光标不丢。
        root.addEventListener('input', (ev: Event) => {
          const target = ev.target as HTMLInputElement | null;
          if (!target) return;
          if (target.dataset.role === 'draft') this._draftTitle = target.value;
          else if (target.dataset.role === 'query') this._query = target.value;
          else return;
          this.refresh();
        });

        // 命令点击：data-command / data-scope 上的目录项坐标 → HudCommand。
        root.addEventListener('click', (ev: Event) => {
          const target = ev.target as HTMLElement | null;
          const host = target?.closest?.('[data-command]') as HTMLElement | null;
          const id = host?.getAttribute('data-command');
          const scope = host?.getAttribute('data-scope');
          if (!id || !scope) return;
          this.runCommand(id as PanelCommandId, scope as CommandScope);
        });
      }

      this.renderNotices();
    }

    private renderNotices(): void {
      const box = this.shadowRoot?.querySelector('[data-role="notices"]');
      if (!box) return;
      const notices = (this._state?.notices ?? []).slice(0, MAX_VISIBLE_NOTICES);
      box.innerHTML = notices
        .map(
          (n) =>
            `<div class="notice" data-level="${escapeHtml(n.level)}">${escapeHtml(n.text)}</div>`
        )
        .join('');
    }

    private renderSections(): void {
      const root = this.shadowRoot;
      const box = root?.querySelector('[data-role="sections"]');
      if (!root || !box) return;

      const selectionLabel = root.querySelector('[data-role="selection"]');
      if (selectionLabel) selectionLabel.textContent = describeSelection(this._state);
      this.renderNotices();

      const { selection, global } = groupByScope(this.contextualCommands());

      // 搜索把两个分组都过滤空了：只给一条"没匹配上"，不逐组重复报空。
      if (selection.length === 0 && global.length === 0) {
        box.innerHTML = `<div class="empty" data-role="empty">没有匹配的命令</div>`;
        return;
      }

      const groups: Array<{ scope: CommandScope; items: ResolvedCommand[] }> = [
        { scope: 'selection', items: selection },
        { scope: 'global', items: global },
      ];

      box.innerHTML = groups
        .filter((g) => g.items.length > 0)
        .map((g) => this.renderGroup(g.scope, g.items))
        .join('');
    }

    private renderGroup(scope: CommandScope, items: ResolvedCommand[]): string {
      const buttons = items.map((c) => this.renderCommand(c)).join('');
      return `
        <div class="group" part="group" data-scope="${scope}">
          <div class="group-name">${SECTION_LABELS[scope]}</div>
          ${buttons}
        </div>
      `;
    }

    private renderCommand(c: ResolvedCommand): string {
      const detail = c.enabled ? (c.hint ?? '') : (c.reason ?? '');
      const primary = c.spec.primary === true ? 'true' : 'false';
      return `
        <button
          type="button"
          class="command"
          data-command="${escapeHtml(c.spec.id)}"
          data-scope="${escapeHtml(c.spec.scope)}"
          data-primary="${primary}"
          data-enabled="${c.enabled ? 'true' : 'false'}"
          title="${escapeHtml(detail)}"
          ${c.enabled ? '' : 'disabled'}
        >
          <span class="cmd-label">${escapeHtml(c.spec.label)}</span>
          <span class="cmd-hint">${escapeHtml(detail)}</span>
        </button>
      `;
    }
  }

  customElements.define(COMMAND_PANEL_TAG, CommandPanel);
  return CommandPanel as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：本仓库面板的统一装配口径（与 main-screen / hello-loop-panel 一致）——
 *   建元素、注入 adapter、挂进容器，返回 unmount 闭包。
 * 选它而不是让调用方自己 createElement，是为了把"注册 + 注入 + 退订"三件事收在一处，
 *   调用方不必知道 custom element 的存在细节。
 *
 * @since v3.4（task_090）新增 options.variant：'strip' = 控制岛内的 1 行命令条（见文件头）。
 */
export function mountCommandPanel(
  deps: CommandPanelDeps,
  host: HTMLElement,
  options: { readonly variant?: 'default' | 'strip' } = {}
): () => void {
  defineCommandPanel();
  const element = document.createElement(COMMAND_PANEL_TAG) as StratCommandPanelElement;
  // 形态属性必须在入 DOM 前落定 —— connectedCallback 里的首绘要按形态建外壳。
  element.setAttribute('variant', options.variant ?? 'default');
  element.adapter = deps;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订，订阅随之释放。
  return () => { element.remove(); };
}