/**
 * 文件职责：状态屏 Web Component（`<strat-status-screen>`）—— 全局态势总览的**纯展示**屏：
 *   ① 四张核心指标卡（单位总数 / 活跃任务 / 进行中会话 / 未读通知，全部由 WorldState 派生）；
 *   ② 系统状态区（gateway 连接态读 agent-link 会话相位、系统心跳活跃度、运行时长）；
 *   ③ 最近事件列表（复用 notices 的渲染，与 log-drawer 同源但紧凑形态）。
 *   视图模型派生全在 status-catalog.ts（纯逻辑），本文件只负责把模型画成 Shadow DOM。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 screens/ 层级；语义只读提取自
 *   src/components/TaskLogViewer.vue / LogPanelModal.vue / RTSSettings.vue 的"概览"语义（未复制实现）。
 * 输入：注入的 HudBusAdapter（**只要 subscribe + dispatch**：本屏不发业务命令，dispatch 仅供导航）。
 * 输出：Shadow DOM 态势屏；导航点击 → HudCommand(ui.navigate) → adapter.dispatch。
 * 禁止事项：
 *   1. import world/、phaser、vue、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— HUD 一律经注入的 adapter 收发；
 *   3. 除 ui.navigate 外的任何 HudCommand —— 本屏是只读态势总览，没有可上报的业务动作
 *      （发 mission.* 会让"看态势"变成"改态势"，且本屏拿不到 core 的裁决上下文）；
 *   4. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token；
 *   5. 本地改任何数 —— 指标与状态全部现算自最近一次 WorldState，改了也只等 core 回广播；
 *   6. 泄漏监听器 / 计时器 —— disconnectedCallback 必须退订并停掉 tick（perf 硬约束）。
 *
 * 装配与入口：本屏以"主屏的一个区块"形态挂在 main-screen 的 .body 内（无独立屏位 ——
 *   契约 ScreenId 里没有 status，本任务也不改 core/types.ts，那是总线契约、且有并行任务在改）。
 *   进入状态屏靠主屏挂载，跳转出去（设置 / 聊天）走 ui.navigate，与其他屏同一口径。
 *
 * 渲染策略（perf，与 command-panel / log-drawer 同一口径）：
 *   core 每次状态变更都全量广播，本屏用 statusSignature 判掉与显示无关的广播；
 *   心跳活跃度与运行时长按秒自走（唯一例外：一个 1s tick，只改两个文本节点）。
 *   tick 只在 isConnected 且已注入 adapter 时存在，disconnectedCallback 必停 —— 反复挂卸不留定时器。
 */

import type { ScreenId, WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
import { defineEmptyState, EMPTY_STATE_TAG } from '../components/empty-state/empty-state';
import type { GatewayConnectionState, GatewayLinkPort } from '../bridge/gateway-link-port';
import { defineStratButton, STRAT_BUTTON_TAG } from '../widgets/strat-button';

import type { StatusMetricId, StatusModel, StatusTone } from './status-catalog';
import {
  BUS_WINDOW_MS,
  MAX_BUS_SAMPLES,
  STATUS_METRIC_IDS,
  formatEventTime,
  pushBusSample,
  resolveConnection,
  resolveStatusModel,
  statusSignature,
} from './status-catalog';

export const STATUS_SCREEN_TAG = 'strat-status-screen';

/**
 * 本屏需要的最小能力面：subscribe 看态势、dispatch 只用于导航（见文件头禁止事项 3）。
 * @since v3.7，task_127：网关连通性端口是**独立**的一个入参（见 mountStatusScreen）——
 *   「网关连接」那一行与全局横幅读同一个真相源（同一份三级态），不再各判各的。
 *   缺省 = 没接探测端口（那一行如实说「未探测」，不谎报在线）。
 */
export type StatusScreenDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'>;

/** 导航出口：data-nav → ui.navigate.screen。词表即契约的 ScreenId 子集，不自造屏位。 */
export type StatusNavTarget = Extract<ScreenId, 'settings' | 'chat'>;

/** 导航出口清单（渲染与测试共用同一份，不各写一套）。 */
export const STATUS_NAV_ITEMS: readonly { target: StatusNavTarget; label: string }[] = [
  { target: 'settings', label: '去设置' },
  { target: 'chat', label: '打开聊天' },
];

/** 自定义元素的对外形状（测试与挂载方按它断言）。 */
export interface StratStatusScreenElement extends HTMLElement {
  /** 注入的适配器；在 connected 之前或之后设置都生效。 */
  adapter: StatusScreenDeps | null;
  /** 注入的网关连通性端口（与全局横幅同一份真相源）；null = 未接入探测。 */
  gateway: GatewayLinkPort | null;
  /** 强制重算重渲染（改了观测时刻或手工注入新 state 后可调用）。 */
  refresh(): void;
  /** 最近一次派生出的渲染模型。 */
  readonly model: StatusModel;
  /** 最近一次收到的 WorldState。 */
  readonly lastState: WorldState | null;
}

/** HTML 文本转义。通知正文与单位名来自 core/外部输入，必须转义后才进 innerHTML。 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] as string);
}

/** tone → 中文色槽名（组件据此挑 --srf-* 变量，色值不落在这里）。 */
const TONE_ATTR: Readonly<Record<StatusTone, string>> = {
  ok: 'ok',
  busy: 'busy',
  warn: 'warn',
  error: 'error',
  idle: 'idle',
};

/**
 * 工厂：注册 `<strat-status-screen>`。
 * 幂等（与 defineStratButton / defineLogDrawer 同约定：hot-reload 会重复调用）。
 */
export function defineStatusScreen(): typeof HTMLElement {
  if (customElements.get(STATUS_SCREEN_TAG)) {
    return customElements.get(STATUS_SCREEN_TAG) as unknown as typeof HTMLElement;
  }

  class StatusScreen extends HTMLElement implements StratStatusScreenElement {
    /** tick 周期（ms）：只驱动"运行时长"与"系统心跳"两个读数，1s 足够且开销可忽略。 */
    private static readonly TICK_MS = 1000;

    private _adapter: StatusScreenDeps | null = null;
    /** 网关连通性端口（@since v3.7，task_127）。 */
    private _gateway: GatewayLinkPort | null = null;
    /** 当前三级连通态（null = 未接入探测）。 */
    private _gatewayState: GatewayConnectionState | null = null;
    /** 连通性端口的退订闭包（换端口 / 卸载时必退 —— perf 硬约束）。 */
    private _unsubscribeGateway: (() => void) | null = null;
    private _state: WorldState | null = null;
    private _now = 0;
    private _busSamples: readonly number[] = [];
    private _observedSince: number | null = null;
    private _model: StatusModel = resolveStatusModel(null, 0, [], null);
    /** 上一次记进 console.debug 的窗口内投递数（变了才记，避免每秒刷屏）。 */
    private _lastBusCount: number | null = null;
    private _lastSignature: string | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _timer: ReturnType<typeof setInterval> | null = null;
    private _listenersBound = false;

    get adapter(): StatusScreenDeps | null { return this._adapter; }
    set adapter(value: StatusScreenDeps | null) {
      this._adapter = value;
      this.bindAdapter();
      this.bindGateway();
      this.startTimer();
      this.refresh();
    }

    get model(): StatusModel { return this._model; }
    get lastState(): WorldState | null { return this._state; }

    get gateway(): GatewayLinkPort | null { return this._gateway; }
    set gateway(value: GatewayLinkPort | null) {
      this._gateway = value;
      this.bindGateway();
    }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      // 统一空态组件（task_136）：先注册再渲染（幂等，重复 define 不抛）。
      defineEmptyState();
      this.renderChrome();
      // 清签名强制首绘：挂载前 adapter setter 那次 refresh 已记下签名，而那时还没有 DOM 可画
      this._lastSignature = null;
      this.bindAdapter();
      this.bindGateway();
      this.startTimer();
      this.refresh();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：不退订 / 不停 tick 的话，反复挂卸会把订阅与定时器堆成 O(n)。
      this.releaseAdapter();
      this.releaseGateway();
      this.stopTimer();
      this._lastSignature = null;
    }

    refresh(): void {
      this._now = Date.now();
      this._model = resolveStatusModel(
        this._state,
        this._now,
        this._busSamples,
        this._observedSince,
        this._gatewayState,
      );
      const signature = statusSignature(this._state);
      if (signature !== this._lastSignature) {
        this._lastSignature = signature;
        this.renderMetrics();
        this.renderConnection();
        this.renderEvents();
      }
      // 这两项按秒自走，与状态签名无关，因此走独立通道（见 tick 注释）。
      this.renderTickables();
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
     * 绑定连通性端口（@since v3.7，task_127）。
     * why 单独一条通道：连通性变化与总线广播是**两路**信号 ——
     *   连通性变了不该触发整屏重绘（perf 纪律），只重画「网关连接」那一行。
     */
    private bindGateway(): void {
      this.releaseGateway();
      const gateway = this._gateway;
      if (!gateway) {
        this._gatewayState = null;
        this.refresh();
        return;
      }
      this._unsubscribeGateway = gateway.subscribe((state) => this.onGatewayState(state));
    }

    private releaseGateway(): void {
      if (!this._unsubscribeGateway) return;
      this._unsubscribeGateway();
      this._unsubscribeGateway = null;
    }

    /** 三级态变了 → 只重算连接行（横幅与这一行读的是同一份真相源）。 */
    private onGatewayState(state: GatewayConnectionState): void {
      this._gatewayState = state;
      this._model = { ...this._model, connection: resolveConnection(state) };
      this.renderConnection();
    }

    /**
     * 一次广播：记一个投递时刻（心跳活跃度的真实观测量）+ 首帧锚定观测起点，然后照常走签名判重。
     */
    private onState(state: WorldState): void {
      const at = Date.now();
      this._state = state;
      this._busSamples = pushBusSample(this._busSamples, at);
      if (this._observedSince === null) this._observedSince = at;
      this.refresh();
    }

    // —— 计时器（只服务两个读数，卸载必停） ——
    private startTimer(): void {
      if (this._timer !== null || !this.isConnected || !this._adapter) return;
      this._timer = setInterval(() => {
        if (!this.isConnected) return;
        this._now = Date.now();
        this._model = resolveStatusModel(
          this._state,
          this._now,
          this._busSamples,
          this._observedSince,
          this._gatewayState,
        );
        this.logBusDetail();
        this.renderTickables();
      }, StatusScreen.TICK_MS);
    }

    private stopTimer(): void {
      if (this._timer === null) return;
      clearInterval(this._timer);
      this._timer = null;
    }

    /** 导航出口 → HudCommand(ui.navigate)。这是本屏**唯一**允许派发的命令（见文件头禁止事项 3）。 */
    private navigate(target: StatusNavTarget): void {
      this._adapter?.dispatch({ type: 'ui.navigate', screen: target });
    }

    // —— 渲染 ——
    private renderChrome(): void {
      const root = this.shadowRoot;
      if (!root) return;

      root.innerHTML = `
        <style>
          :host { all: initial; display: block; }
          .screen {
            display: grid;
            gap: var(--srf-spacing-md);
            padding: var(--srf-spacing-md);
            background: var(--srf-panel);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            color: var(--srf-text);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-body);
            line-height: var(--srf-line-height-body);
          }
          .head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--srf-spacing-sm); }
          .title { font-size: var(--srf-font-size-title); font-weight: var(--srf-font-weight-semibold); }
          .nav { display: flex; gap: var(--srf-spacing-xs); }
          .section-name { color: var(--srf-text-muted); font-size: var(--srf-font-size-caption); font-weight: var(--srf-font-weight-semibold); letter-spacing: 0.04em; }
          .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(9em, 1fr)); gap: var(--srf-spacing-sm); }
          .metric {
            display: grid;
            gap: var(--srf-spacing-xs);
            padding: var(--srf-spacing-sm);
            background: var(--srf-panel-elevated);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
          }
          .metric-label { color: var(--srf-text-muted); font-size: var(--srf-font-size-caption); }
          .metric-value { font-size: var(--srf-font-size-body); font-weight: var(--srf-font-weight-semibold); font-variant-numeric: tabular-nums; }
          .metric-hint { color: var(--srf-text-disabled); font-size: var(--srf-font-size-caption); overflow-wrap: anywhere; }
          .metric[data-tone="busy"] .metric-value { color: var(--srf-accent); }
          .system, .events { display: grid; gap: var(--srf-spacing-xxs); }
          .sys-row, .event {
            display: grid;
            gap: var(--srf-spacing-sm);
            align-items: baseline;
            padding: var(--srf-spacing-xs);
            background: var(--srf-panel-elevated);
            border-radius: var(--srf-radius);
            font-size: var(--srf-font-size-caption);
          }
          .sys-row { grid-template-columns: 6em 5em 1fr; }
          .sys-name { color: var(--srf-text-muted); }
          .sys-value { font-weight: var(--srf-font-weight-semibold); }
          .sys-detail { color: var(--srf-text-disabled); overflow-wrap: anywhere; }
          [data-tone="ok"] .sys-value { color: var(--srf-success); }
          [data-tone="busy"] .sys-value { color: var(--srf-accent); }
          [data-tone="warn"] .sys-value { color: var(--srf-warn); }
          [data-tone="error"] .sys-value { color: var(--srf-danger); }
          [data-tone="idle"] .sys-value { color: var(--srf-text-muted); }
          .events { max-height: 14em; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--srf-border-strong) transparent; }
          .events::-webkit-scrollbar { width: var(--srf-spacing-sm); }
          .events::-webkit-scrollbar-thumb { background: var(--srf-border-strong); border-radius: var(--srf-radius-pill); }
          .event { grid-template-columns: 5.5em 3em 6em 1fr; }
          .event-time { color: var(--srf-text-disabled); font-family: var(--srf-font-mono); font-variant-numeric: tabular-nums; }
          .event-level { font-weight: var(--srf-font-weight-semibold); color: var(--srf-text); }
          .event[data-level="warn"] .event-level { color: var(--srf-warn); }
          .event[data-level="error"] .event-level { color: var(--srf-danger); }
          .event-source { color: var(--srf-text-muted); overflow-wrap: anywhere; }
          .event-text { overflow-wrap: anywhere; }
          .empty { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); padding: var(--srf-spacing-md); text-align: center; }
          .truncated { color: var(--srf-warn); font-size: var(--srf-font-size-caption); }
        </style>
        <div class="screen" part="screen">
          <div class="head">
            <span class="title">态势总览</span>
            <div class="nav" data-role="nav">
              ${STATUS_NAV_ITEMS.map(
                (item) =>
                  `<${STRAT_BUTTON_TAG} label="${escapeHtml(item.label)}" data-nav="${escapeHtml(item.target)}"></${STRAT_BUTTON_TAG}>`,
              ).join('')}
            </div>
          </div>
          <div class="metrics" data-role="metrics"></div>
          <div class="section-name">系统状态</div>
          <div class="system" data-role="system"></div>
          <div class="section-name">最近事件</div>
          <div class="events" data-role="events"></div>
        </div>
      `;

      if (!this._listenersBound) {
        this._listenersBound = true;
        // 事件委托绑在外壳上：nav 是重建的，逐个绑会随重渲染反复泄漏（perf 硬约束）
        root.addEventListener('strat-button-click', (ev: Event) => {
          const target = ev.target as HTMLElement | null;
          const button = target?.closest?.(`[data-nav]`) as HTMLElement | null;
          const nav = button?.getAttribute('data-nav') as StatusNavTarget | null;
          // data-nav 由本文件 renderChrome 写死（取自 STATUS_NAV_ITEMS），非词表值直接忽略。
          if (!nav || !STATUS_NAV_ITEMS.some((item) => item.target === nav)) return;
          this.navigate(nav);
        });
      }
    }

    private renderMetrics(): void {
      const box = this.shadowRoot?.querySelector('[data-role="metrics"]');
      if (!box) return;
      box.innerHTML = STATUS_METRIC_IDS.map((id: StatusMetricId) => this.renderMetric(this._model.metrics[id])).join('');
    }

    private renderMetric(metric: StatusModel['metrics'][StatusMetricId]): string {
      // tone：会话为 0 时用 idle，其余一律 ok —— 指标卡本身没有"异常"语义，异常在系统状态区表达。
      const tone: StatusTone = metric.value === 0 ? 'idle' : 'ok';
      return `
        <div class="metric" data-metric="${escapeHtml(metric.id)}" data-tone="${TONE_ATTR[tone]}" data-value="${metric.value}">
          <span class="metric-label" data-role="metric-label">${escapeHtml(metric.label)}</span>
          <span class="metric-value" data-role="metric-value">${metric.value}</span>
          <span class="metric-hint" data-role="metric-hint">${escapeHtml(metric.hint)}</span>
        </div>
      `;
    }

    /** 系统状态区：连接态随状态重绘；心跳/运行时长两行走独立通道（renderTickables）。 */
    private renderConnection(): void {
      const box = this.shadowRoot?.querySelector('[data-role="system"]');
      if (!box) return;
      const { connection } = this._model;
      const sysRow = (id: string, name: string, tone: StatusTone, value: string, detail: string): string => `
        <div class="sys-row" data-sys="${escapeHtml(id)}" data-tone="${TONE_ATTR[tone]}">
          <span class="sys-name" data-role="sys-name">${escapeHtml(name)}</span>
          <span class="sys-value" data-role="sys-value">${escapeHtml(value)}</span>
          <span class="sys-detail" data-role="sys-detail">${escapeHtml(detail)}</span>
        </div>
      `;
      box.innerHTML = sysRow('connection', '网关连接', connection.tone, connection.label, connection.detail);
      // 占位行先建好：renderTickables 只改文本，不建 DOM，tick 因此是廉价的。
      box.insertAdjacentHTML(
        'beforeend',
        sysRow('bus', '系统心跳', this._model.bus.tone, this._model.bus.label, this._model.bus.detail),
      );
      box.insertAdjacentHTML(
        'beforeend',
        sysRow('uptime', this._model.uptime.label, this._model.uptime.tone, this._model.uptime.value, '自首次收到状态起'),
      );
    }

    /**
     * 心跳的**技术细节**只进 console.debug（task_122）。
     * why：界面那行只说"最近 60 秒更新 N 次"（用户看得懂），但排障时需要知道
     *   窗口内的真实投递数与样本环的占用 —— 埋在 console 里，不占界面、不吓人。
     *   只在数字变化时记一次，避免每秒刷屏。
     */
    private logBusDetail(): void {
      const count = this._model.bus.recentCount;
      if (count === this._lastBusCount) return;
      this._lastBusCount = count;
      console.debug(
        `[stratix] 系统心跳：近 ${Math.round(BUS_WINDOW_MS / 1000)} 秒 ${count} 次状态投递` +
          `（样本环 ${this._busSamples.length}/${MAX_BUS_SAMPLES}）`,
      );
    }

    /**
     * 每秒走一次的两行（系统心跳 / 运行时长）。
     * why 单独一条通道：这两项按秒变化，若并进状态签名，则每次投递都会强制重绘整屏。
     */
    private renderTickables(): void {
      const root = this.shadowRoot;
      if (!root) return;
      for (const [id, tone, value, detail] of [
        ['bus', this._model.bus.tone, this._model.bus.label, this._model.bus.detail],
        ['uptime', this._model.uptime.tone, this._model.uptime.value, '自首次收到状态起'],
      ] as const) {
        const row = root.querySelector<HTMLElement>(`[data-sys="${id}"]`);
        if (!row) continue;
        row.setAttribute('data-tone', TONE_ATTR[tone]);
        const valueEl = row.querySelector('[data-role="sys-value"]');
        if (valueEl) valueEl.textContent = value;
        const detailEl = row.querySelector('[data-role="sys-detail"]');
        if (detailEl) detailEl.textContent = detail;
      }
    }

    /** 最近事件：与日志抽屉同源 notices 的紧凑形态（时间 / 级别 / 来源 / 正文），倒序最新在前。 */
    private renderEvents(): void {
      const box = this.shadowRoot?.querySelector('[data-role="events"]');
      if (!box) return;
      const { rows, total } = this._model.events;

      if (rows.length === 0) {
        // 统一空态组件（@since v3.8，task_136）：与其它面板同一套版式。
        box.innerHTML = `<${EMPTY_STATE_TAG} data-role="empty">暂无事件</${EMPTY_STATE_TAG}>`;
        return;
      }

      const list = rows
        .map(
          (row) => `
          <div class="event" data-event="${escapeHtml(row.id)}" data-level="${escapeHtml(row.level)}">
            <span class="event-time" data-role="event-time">${escapeHtml(formatEventTime(row.at))}</span>
            <span class="event-level" data-role="event-level">${escapeHtml(row.levelLabel)}</span>
            <span class="event-source" data-role="event-source">${escapeHtml(row.source)}</span>
            <span class="event-text" data-role="event-text">${escapeHtml(row.text)}</span>
          </div>`,
        )
        .join('');
      const more = total > rows.length
        ? `<div class="truncated" data-role="truncated">另有 ${total - rows.length} 条更早的事件（日志抽屉可查）</div>`
        : '';
      box.innerHTML = list + more;
    }
  }

  customElements.define(STATUS_SCREEN_TAG, StatusScreen);
  return StatusScreen as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：本仓库屏/面板的统一装配口径（与 main-screen / log-drawer 一致）——
 *   注册自定义元素、建元素、注入 adapter、挂进容器，返回 unmount 闭包。
 */
export function mountStatusScreen(
  deps: StatusScreenDeps,
  host: HTMLElement,
  gateway: GatewayLinkPort | null = null,
): () => void {
  defineStatusScreen();
  defineStratButton();
  const element = document.createElement(STATUS_SCREEN_TAG) as StratStatusScreenElement;
  element.adapter = deps;
  element.gateway = gateway;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订 + 停 tick，资源随之释放。
  return () => { element.remove(); };
}