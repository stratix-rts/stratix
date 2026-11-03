/**
 * 文件职责：统一日志抽屉 Web Component（`<strat-log-drawer>`）—— 合并旧 LogPanelModal（指令日志弹窗）
 *   与 TaskLogViewer（任务日志弹窗）为**一个**可折叠日志视图：订阅 WorldState，把 notices 与
 *   任务相位迁移增量渲染成「时间 / 来源 / 级别 / 正文」四列，支持按任务与按级别过滤、可清空当前视图。
 *   视图模型派生全在 log-catalog.ts（纯逻辑），本文件只负责把模型画成 Shadow DOM。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 panels/ 层级；语义提取自 src/components/LogPanelModal.vue
 *   与 src/components/TaskLogViewer.vue（只读提取语义，未复制任何实现）。
 * 输入：注入的 HudBusAdapter（**只需要 subscribe**：本组件是纯展示，不产生任何 HudCommand）。
 * 输出：Shadow DOM 抽屉；折叠/过滤/清空只改本地展示态。
 * 禁止事项：
 *   1. import world/、phaser、vue、@/stratix-rts、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— HUD 一律经注入的 adapter 订阅状态；
 *   3. 产生 HudCommand —— 日志是只读视图，过滤/折叠/清空都是纯展示态，没有可上报的业务动作；
 *      （契约里的 ui.navigate 也不需要：抽屉不跳屏，跳屏是命令面板的事）；
 *   4. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token；
 *   5. 拉日志（fetch / 轮询）—— 日志是 core 广播的副产品，旧组件的 2s 轮询不复刻；
 *   6. 泄漏监听器 —— disconnectedCallback 必须退订。
 *
 * 累积语义（关键，见 log-catalog 文件头）：core 的 notices 会 6s 过期，
 *   所以本组件**不是**每次广播重画 state，而是用 createLogStream 增量消费、条目留在本地环缓冲里。
 *
 * 渲染策略（perf，与 command-panel / agent-panel 同一口径）：core 每次状态变更都全量广播，
 *   本组件先用 logSignature 判掉"没有新日志源"的广播，再判重渲染签名，两道闸门都过了才碰 DOM。
 */

import type { WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';

import type { LogEntryView, LogFilter, LogLevel, LogModel, MissionOption } from './log-catalog';
import {
  EMPTY_LOG_FILTER,
  LOG_LEVELS,
  buildLogModel,
  createLogStream,
  formatLogTime,
  levelLabel,
  logSignature,
  sourceLabel,
} from './log-catalog';

export const LOG_DRAWER_TAG = 'strat-log-drawer';

/**
 * 抽屉需要的最小能力面：**只有 subscribe**。
 * why 不含 dispatch：纯展示组件没有可上报的业务动作（见文件头禁止事项 3），
 *   把 dispatch 声明进来只会诱使后来者往这里塞命令。
 */
export type LogDrawerDeps = Pick<HudBusAdapter, 'subscribe'>;

/** 自定义元素的对外形状（测试与挂载方按它断言）。 */
export interface StratLogDrawerElement extends HTMLElement {
  /** 注入的适配器；在 connected 之前或之后设置都生效。 */
  adapter: LogDrawerDeps | null;
  /** 强制重算重渲染（改了筛选条件或手工注入新 state 后可调用）。 */
  refresh(): void;
  /** 折叠态。折叠只收起抽屉体，标题栏（含清空）常驻。 */
  readonly collapsed: boolean;
  toggleCollapsed(): void;
  /** 当前筛选条件（只读）。 */
  readonly filter: LogFilter;
  /** 设置任务过滤；null = 全部任务。 */
  setMissionFilter(missionId: string | null): void;
  /** 勾选/取消一个级别。取消全部级别后视图为空（这是刻意的，语义见 LogFilter 注释）。 */
  toggleLevel(level: LogLevel): void;
  /** 回到「全部级别」。 */
  resetLevels(): void;
  /** 清空当前视图（只清已渲染的行，不回放 state 里还活着的通知，见 LogStream.clear）。 */
  clear(): void;
  /** 当前渲染出的条目（已过滤）。 */
  readonly entries: readonly LogEntryView[];
  /** 当前模型（派生结果，读取零成本）。 */
  readonly model: LogModel;
  /** 任务下拉候选项。 */
  readonly missionOptions: readonly MissionOption[];
  /** 最近一次收到的 WorldState。 */
  readonly lastState: WorldState | null;
}

/** HTML 文本转义。日志正文来自通知/任务标题，含外部输入，必须转义后才进 innerHTML。 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] as string);
}

/** 渲染签名：条目 id 序列 + 筛选 + 折叠态。任一变化才重画，否则跳过。 */
function renderSignature(model: LogModel, filter: LogFilter, collapsed: boolean): string {
  const levels = filter.levels ? [...filter.levels].sort().join(',') : '*';
  const ids = model.entries.map((e) => e.id).join('|');
  return `${filter.missionId ?? '*'}#${levels}#${collapsed ? 'c' : 'e'}#${ids}`;
}

/**
 * 工厂：注册 `<strat-log-drawer>`。
 * 幂等（与 defineStratButton / defineAgentPanel / defineCommandPanel 同约定）。
 */
export function defineLogDrawer(): typeof HTMLElement {
  if (customElements.get(LOG_DRAWER_TAG)) {
    return customElements.get(LOG_DRAWER_TAG) as unknown as typeof HTMLElement;
  }

  class LogDrawer extends HTMLElement implements StratLogDrawerElement {
    private _adapter: LogDrawerDeps | null = null;
    private _state: WorldState | null = null;
    private readonly _stream = createLogStream();
    private _filter: LogFilter = EMPTY_LOG_FILTER;
    private _collapsed = false;
    private _model: LogModel = buildLogModel([], EMPTY_LOG_FILTER, null, 0);
    private _lastStateSignature: string | null = null;
    private _lastRenderSignature: string | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _listenersBound = false;

    // —— 属性面 ——
    get adapter(): LogDrawerDeps | null { return this._adapter; }
    set adapter(value: LogDrawerDeps | null) {
      this._adapter = value;
      this.bindAdapter();
      this.refresh();
    }

    get collapsed(): boolean { return this._collapsed; }
    get filter(): LogFilter { return this._filter; }
    get entries(): readonly LogEntryView[] { return this._model.entries; }
    get model(): LogModel { return this._model; }
    get missionOptions(): readonly MissionOption[] { return this._model.missions; }
    get lastState(): WorldState | null { return this._state; }

    connectedCallback(): void {
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.renderChrome();
      // 清签名强制首绘：挂载前 adapter setter 那次 refresh 已把签名记下，
      // 而那时还没有 shadowRoot —— 不清掉这次就会被判重跳过。
      this._lastRenderSignature = null;
      this._lastStateSignature = null;
      this.bindAdapter();
      this.refresh();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：不退订的话，反复挂卸会把订阅堆成 O(n)。
      this.releaseAdapter();
      this._lastStateSignature = null;
      this._lastRenderSignature = null;
    }

    refresh(): void {
      this._model = buildLogModel(this._stream.entries, this._filter, this._state, this._stream.droppedCount);
      this.renderBody();
    }

    // —— 交互（全部是纯展示态，不经 adapter.dispatch） ——
    toggleCollapsed(): void {
      this._collapsed = !this._collapsed;
      // 同时挂 host 属性：Shadow DOM 外的样式/测试/布局都能看到折叠态（:host([collapsed]) 靠它生效）。
      this.toggleAttribute('collapsed', this._collapsed);
      this.refresh();
    }

    setMissionFilter(missionId: string | null): void {
      if (this._filter.missionId === missionId) return;
      this._filter = { ...this._filter, missionId: missionId || null };
      this.refresh();
    }

    toggleLevel(level: LogLevel): void {
      const current = this._filter.levels;
      // null（不过滤）视作"全选"，点一下某个级别 = 从全选里摘掉它。
      const next = new Set<LogLevel>(current ?? LOG_LEVELS);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      // 归一：又选满三级就回到 null，否则「全部级别」筹码会亮着而三个级别筹码也全亮（两套真相）。
      const backToAll = next.size === LOG_LEVELS.length;
      this._filter = { ...this._filter, levels: backToAll ? null : next };
      this.refresh();
    }

    resetLevels(): void {
      this._filter = { ...this._filter, levels: null };
      this.refresh();
    }

    clear(): void {
      this._stream.clear();
      this.refresh();
    }

    // —— 订阅生命周期 ——
    private bindAdapter(): void {
      if (!this.isConnected || !this._adapter || this._unsubscribe) return;
      this._unsubscribe = this._adapter.subscribe((state) => {
        this.onState(state);
      });
    }

    private releaseAdapter(): void {
      if (!this._unsubscribe) return;
      this._unsubscribe();
      this._unsubscribe = null;
    }

    /**
     * 一次广播的处理：先判"日志源有没有变"，没变就整帧跳过（合并与渲染都省掉）。
     * core 的广播绝大多数与日志无关（选择拖拽、单位读数、相机），这道闸门是抽屉的主要省流点。
     */
    private onState(state: WorldState): void {
      this._state = state;
      const signature = logSignature(state);
      if (signature === this._lastStateSignature) return;
      this._lastStateSignature = signature;
      // 观测时刻取 Date.now()：任务相位迁移在契约里没有时间戳（MissionView 只有 createdAt），
      // 观测时刻是唯一诚实的取值。单测不走这条路径（直接调 refresh），故时间可断言。
      this._stream.consume(state, Date.now());
      this.refresh();
    }

    // —— 渲染 ——
    private renderChrome(): void {
      const root = this.shadowRoot;
      if (!root) return;

      root.innerHTML = `
        <style>
          :host { all: initial; display: block; }
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
          .head { display: flex; align-items: center; justify-content: space-between; gap: var(--srf-spacing-sm); }
          .title-group, .head-actions { display: flex; align-items: center; gap: var(--srf-spacing-xs); min-width: 0; }
          .title { font-size: var(--srf-font-size-lg); font-weight: var(--srf-font-weight-semibold); }
          .summary { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); }
          button.chip {
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
          button.chip:focus-visible, select.mission-filter:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          button.chip[aria-pressed="true"] { color: var(--srf-accent); border-color: var(--srf-accent); }
          button.chip[data-level="warn"][aria-pressed="true"] { color: var(--srf-warn); border-color: var(--srf-warn); }
          button.chip[data-level="error"][aria-pressed="true"] { color: var(--srf-danger); border-color: var(--srf-danger); }
          .body {
            display: grid;
            gap: var(--srf-spacing-sm);
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
          .filters { display: flex; flex-wrap: wrap; align-items: center; gap: var(--srf-spacing-xs); }
          select.mission-filter {
            background: var(--srf-panel-elevated);
            color: var(--srf-text);
            border: var(--srf-border-width) solid var(--srf-border-strong);
            border-radius: var(--srf-radius);
            padding: var(--srf-spacing-xs);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-xs);
            max-width: 14em;
          }
          .rows { display: grid; gap: var(--srf-spacing-xxs); max-height: 18em; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--srf-border-strong) transparent; }
          .rows::-webkit-scrollbar { width: var(--srf-spacing-sm); }
          .rows::-webkit-scrollbar-thumb { background: var(--srf-border-strong); border-radius: var(--srf-radius-pill); }
          .row {
            display: grid;
            grid-template-columns: 5.5em 7em 3.5em 1fr;
            gap: var(--srf-spacing-sm);
            align-items: baseline;
            padding: var(--srf-spacing-xs);
            border-radius: var(--srf-radius);
            background: var(--srf-panel-elevated);
            font-size: var(--srf-font-size-xs);
          }
          .time, .event-time { color: var(--srf-text-disabled); font-family: var(--srf-font-mono); font-variant-numeric: tabular-nums; }
          .source { color: var(--srf-text-muted); overflow-wrap: anywhere; }
          .level { font-weight: var(--srf-font-weight-semibold); }
          .row[data-level="info"] .level { color: var(--srf-text); }
          .row[data-level="warn"] .level, .notice-truncated { color: var(--srf-warn); }
          .row[data-level="error"] .level { color: var(--srf-danger); }
          .body-text { overflow-wrap: anywhere; }
          .mission-tag { color: var(--srf-accent); }
          .empty, .notice-truncated { font-size: var(--srf-font-size-sm); }
          .empty { color: var(--srf-text-muted); padding: var(--srf-spacing-lg); text-align: center; }
        </style>
        <div class="drawer" part="drawer">
          <div class="head">
            <div class="title-group">
              <span class="title">日志</span>
              <span class="summary" data-role="summary">等待世界状态…</span>
            </div>
            <div class="head-actions">
              <button type="button" class="chip" data-action="toggle">收起</button>
              <button type="button" class="chip" data-action="clear">清空</button>
            </div>
          </div>
          <div class="body" data-role="body"></div>
        </div>
      `;

      if (!this._listenersBound) {
        this._listenersBound = true;

        // 事件委托：一个监听器管住标题栏按钮与筛选条筹码，避免每次重画都重新绑（perf）。
        root.addEventListener('click', (ev: Event) => {
          const target = ev.target as HTMLElement | null;
          const host = target?.closest?.('[data-action]') as HTMLElement | null;
          const action = host?.getAttribute('data-action');
          if (action === 'toggle') this.toggleCollapsed();
          else if (action === 'clear') this.clear();
          else if (action === 'levels-all') this.resetLevels();
          else if (action === 'level') {
            const level = host?.getAttribute('data-level') as LogLevel | null;
            // data-level 是本文件 renderFilters 写死的（取自 LOG_LEVELS 词表），非词表值直接忽略，
            // 免得伪造的 DOM 塞个 'debug' 进来污染筛选态。
            if (level && LOG_LEVELS.includes(level)) this.toggleLevel(level);
          }
        });

        // 任务下拉的 change：只有真实用户操作才改筛选（写 innerHTML 不会触发）。
        root.addEventListener('change', (ev: Event) => {
          const target = ev.target as HTMLSelectElement | null;
          if (!target || !target.matches?.('select[data-role="mission-filter"]')) return;
          this.setMissionFilter(target.value);
        });
      }
    }

    private renderBody(): void {
      const root = this.shadowRoot;
      const summary = root?.querySelector('[data-role="summary"]');
      const toggle = root?.querySelector<HTMLButtonElement>('button[data-action="toggle"]');
      if (toggle) toggle.textContent = this._collapsed ? '展开' : '收起';

      if (summary) {
        summary.textContent = this._model.totalCount === 0 && this._state === null
          ? '等待世界状态…'
          : this._model.summary;
      }
      // 折叠态下 body 是空的：省掉建 DOM 的成本，也让"收起时列表不占布局"这件事在 DOM 上为真。
      if (this._collapsed) {
        const body = root?.querySelector('[data-role="body"]');
        if (body) body.innerHTML = '';
        // 必须清签名：body 已被清空，而下面的判重只认"签名变了才重画"，
        // 不清的话展开时签名与折叠前完全相同 → 判重命中 → body 一直空着，抽屉展开是坏的。
        this._lastRenderSignature = null;
        return;
      }

      const box = root?.querySelector('[data-role="body"]');
      if (!box) return;

      const signature = renderSignature(this._model, this._filter, this._collapsed);
      if (signature === this._lastRenderSignature) return;
      this._lastRenderSignature = signature;

      box.innerHTML = `
        ${this.renderFilters()}
        ${this.renderRows()}
      `;
    }

    /** 筛选条：任务下拉（全部 + 当前 state 里的任务）+ 级别筹码。 */
    private renderFilters(): string {
      const options: string[] = [
        `<option value=""${this._filter.missionId === null ? ' selected' : ''}>全部任务</option>`,
        ...this._model.missions.map(
          (m) =>
            `<option value="${escapeHtml(m.id)}"${this._filter.missionId === m.id ? ' selected' : ''}>${escapeHtml(m.label)}</option>`,
        ),
      ];

      const allPressed = this._filter.levels === null;
      const levelChips = LOG_LEVELS.map((level) => {
        const on = allPressed || this._filter.levels?.has(level) === true;
        return `<button type="button" class="chip" data-action="level" data-level="${escapeHtml(level)}" aria-pressed="${on}">${escapeHtml(levelLabel(level))}</button>`;
      }).join('');

      return `
        <div class="filters" data-role="filters">
          <select class="mission-filter" data-role="mission-filter" aria-label="按任务过滤">${options.join('')}</select>
          <button type="button" class="chip" data-action="levels-all" aria-pressed="${allPressed}">全部级别</button>
          ${levelChips}
        </div>
      `;
    }

    /** 行列表：时间 / 来源 / 级别 / 正文（+ 任务标签）。倒序 = 最新在上，不需要自动滚底。 */
    private renderRows(): string {
      if (this._model.entries.length === 0) {
        const hint = this._model.totalCount > 0 ? '当前筛选下没有日志' : '暂无日志';
        return `<div class="empty" data-role="empty">${hint}</div>`;
      }

      const rows = this._model.entries.map((entry) => {
        const mission = entry.missionId
          ? `<span class="mission-tag" data-role="mission-tag">${escapeHtml(entry.missionTitle ?? entry.missionId)}</span> `
          : '';
        return `
          <div class="row" data-role="row" data-entry="${escapeHtml(entry.id)}" data-level="${escapeHtml(entry.level)}" data-mission="${escapeHtml(entry.missionId ?? '')}">
            <span class="time" data-role="time">${escapeHtml(formatLogTime(entry.at))}</span>
            <span class="source" data-role="source" title="${escapeHtml(sourceLabel(entry.sourceKind))}">${escapeHtml(entry.source)}</span>
            <span class="level" data-role="level">${escapeHtml(entry.levelLabel)}</span>
            <span class="body-text" data-role="text">${mission}${escapeHtml(entry.text)}</span>
          </div>
        `;
      }).join('');

      const dropped = this._model.droppedCount > 0
        ? `<div class="notice-truncated" data-role="truncated">已滚出最近 ${this._model.droppedCount} 条更早的日志</div>`
        : '';

      return `<div class="rows" data-role="rows">${rows}</div>${dropped}`;
    }
  }

  customElements.define(LOG_DRAWER_TAG, LogDrawer);
  return LogDrawer as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：本仓库面板的统一装配口径（与 main-screen / agent-panel 一致）——
 *   建元素、注入 adapter、挂进容器，返回 unmount 闭包。
 */
export function mountLogDrawer(deps: LogDrawerDeps, host: HTMLElement): () => void {
  defineLogDrawer();
  const element = document.createElement(LOG_DRAWER_TAG) as StratLogDrawerElement;
  element.adapter = deps;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订，订阅随之释放。
  return () => { element.remove(); };
}