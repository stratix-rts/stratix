/**
 * 文件职责：**大厅面板 Web Component**（`<strat-lobby-panel>`）——「副本总览」的那张卡片网格
 *   （design §7.1「M1-14」行）：一张卡 = 一个副本（名字 / 路径尾段 / 分支 / 实例级状态 /
 *   最近进入 / 在办任务数），默认沙盒卡标「默认沙盒」，没有副本时渲染**明确空态**
 *   （「没有可用副本 · 添加副本」按钮**可点**），空态下派单入口禁用但**有出口**（不锁死用户）。
 *   视图模型派生全在 lobby-catalog.ts（纯逻辑），本文件只负责把模型画成 Shadow DOM。
 *   来源：docs/DESIGN-project-map.md §7.1「M1-14」行 + §2.4（默认沙盒）+ §1.2.1（契约形状）。
 * 输入：注入的 HudBusAdapter（只要 dispatch + subscribe）。
 * 输出：Shadow DOM 大厅面板；点卡片 → `project.enter` → adapter.dispatch。
 * 禁止事项：
 *   1. import world / app / phaser —— 铁律：HUD 不认识战场与组合根；
 *   2. 直接 import core/bus —— HUD 一律经注入的 adapter 收发；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* 皮肤 token
 *      （现代皮 / 像素皮同一套组件零改动 —— 双 token 皮肤的既有范式）；
 *   4. 自己发别的命令 —— 本面板只派 `project.enter`（进副本）；
 *   5. 泄漏监听器 —— disconnectedCallback 必须退订（perf 硬约束）。
 *
 * ★ 为什么大厅是**覆盖层**而不是一个 ScreenId 屏位（design §0 D4）：
 *   「大厅态 = 独立的世界场景（LobbyScene），不是一个 HUD 屏位」⇒ HUD 侧不新增屏位、
 *   不动 `ScreenId` 契约；大厅面板由组合根按世界态挂起（`activeInstanceId === null` 时在场）。
 *   面板自身**不判断**自己该不该在场 —— 那是组合根的活（它同时管 world 场景切换）。
 *
 * ★ 为什么派单入口在大厅态是「降级」的（design §5.1 HUD 行）：
 *   任务挂实例（M1-01 的 `instanceId`），未加载的副本里没有角色、没有任务队列 ⇒
 *   大厅态下**没有可派单的对象**。所以派单入口在大厅里 = 「进副本再派单」：
 *   可用时它进默认沙盒（契约保证恒存的那个），不可用（一个副本都没有）时**禁用**并说清原因。
 *   空态另有**可点的出口**（「添加副本」按钮）⇒ 用户不会被锁死（验收③）。
 *
 * 渲染策略（perf，与 command-panel / status-screen 同一口径）：
 *   core 每次状态变更都全量广播 ⇒ 用 `lobbyPanelSignature` 判重，签名不变就跳过重渲染；
 *   外壳（标题 / 工具条 / 空态壳）只在挂载时建一次，卡片网格随签名重建。
 */

import type { HudCommand, WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
import { zVar } from '../theme/layer-tokens';

import type { LobbyCardModel, LobbyPanelModel } from './lobby-catalog';
import {
  buildAddInstanceCommand,
  buildEnterInstanceCommand,
  LOBBY_ADD_LABEL,
  LOBBY_DISPATCH_LABEL,
  LOBBY_EMPTY_HINT,
  LOBBY_EMPTY_TITLE,
  LOBBY_ENTER_LABEL,
  LOBBY_SANDBOX_BADGE,
  LOBBY_TITLE,
  lobbyPanelSignature,
  resolveLobbyPanel,
} from './lobby-catalog';

export const LOBBY_PANEL_TAG = 'strat-lobby-panel';

/**
 * 本面板需要的最小能力面：subscribe 看副本清单、dispatch 派 `project.enter`。
 * 与 status-screen / agent-panel 同一约定（不碰 core/bus）。
 */
export type LobbyPanelDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'>;

/** 自定义元素的对外形状（测试与装配方按它断言）。 */
export interface StratLobbyPanelElement extends HTMLElement {
  /** 注入的适配器；在 connected 之前或之后设置都生效。 */
  adapter: LobbyPanelDeps | null;
  /** 强制重算重渲染（改了观测时刻或手工注入新 state 后可调用）。 */
  refresh(): void;
  /** 最近一次派生出的渲染模型。 */
  readonly model: LobbyPanelModel;
  /** 最近一次收到的 WorldState。 */
  readonly lastState: WorldState | null;
}

/**
 * 组件样式表（shadow DOM 内）。
 * why 全部用 `--srf-*` token：换皮肤 = 换 token 表，组件零改动（现代皮 / 像素皮同一份样式）。
 * why 不用字形当图标：像素皮是像素字体，特殊字形会变豆腐块 —— 图标一律 CSS 画。
 */
const LOBBY_PANEL_STYLE = `
  :host {
    all: initial;
    /* 整屏覆盖层（大厅态 = 一屏只有总览）：压住主屏面板（panel 档），
       但让位给全屏弹窗（modal 档）—— 档位走刻度表，不写裸数字（浮层登记制度）。 */
    position: absolute;
    inset: 0;
    z-index: ${zVar('overlay')};
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--srf-spacing-xl, 24px);
    pointer-events: auto;
    background: var(--srf-backdrop, rgba(9, 11, 16, 0.72));
    font-family: var(--srf-font-ui, system-ui, -apple-system, sans-serif);
    color: var(--srf-text, #e6e9ef);
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--srf-spacing-md, 12px);
    width: min(960px, 100%);
    max-height: 100%;
    overflow: auto;
    padding: var(--srf-spacing-lg, 16px);
    background: var(--srf-panel, #181c25);
    border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
    border-radius: var(--srf-radius, 6px);
    box-shadow: var(--srf-shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.5));
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--srf-spacing-sm, 8px);
    flex-wrap: wrap;
  }
  .title {
    margin: 0;
    font-size: var(--srf-font-size-lg, 16px);
    font-weight: var(--srf-font-weight-bold, 700);
  }
  .sub {
    margin: 0;
    font-size: var(--srf-font-size-xs, 11px);
    color: var(--srf-text-muted, #9aa3b2);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--srf-spacing-sm, 8px);
    flex-wrap: wrap;
  }
  .hint {
    font-size: var(--srf-font-size-xs, 11px);
    color: var(--srf-text-muted, #9aa3b2);
  }
  .btn {
    font: inherit;
    font-size: var(--srf-font-size-sm, 12px);
    line-height: var(--srf-line-height, 1.4);
    padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-md, 12px);
    border-radius: var(--srf-radius, 6px);
    border: var(--srf-border-width, 1px) solid var(--srf-accent, #6ea8ff);
    background: transparent;
    color: var(--srf-accent, #6ea8ff);
    cursor: pointer;
  }
  .btn:hover:not([disabled]) { background: var(--srf-panel-elevated, #20262f); }
  .btn[disabled] {
    cursor: not-allowed;
    opacity: 0.55;
    border-color: var(--srf-border-strong, #3a4252);
    color: var(--srf-text-disabled, #5a6373);
  }
  .btn.primary {
    background: var(--srf-accent, #6ea8ff);
    color: var(--srf-bg, #0f1116);
    font-weight: var(--srf-font-weight-semibold, 600);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: var(--srf-spacing-md, 12px);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--srf-spacing-xs, 4px);
    padding: var(--srf-spacing-md, 12px);
    background: var(--srf-panel, #181c25);
    border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
    border-radius: var(--srf-radius, 6px);
  }
  .card[data-status="active"] { border-color: var(--srf-accent, #6ea8ff); }
  .card[data-status="missing"] { opacity: 0.72; }
  .card-head {
    display: flex;
    align-items: center;
    gap: var(--srf-spacing-xs, 4px);
    flex-wrap: wrap;
  }
  .card-name {
    font-size: var(--srf-font-size-md, 14px);
    font-weight: var(--srf-font-weight-semibold, 600);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    font-size: var(--srf-font-size-xs, 11px);
    padding: 0 var(--srf-spacing-xs, 4px);
    border-radius: var(--srf-radius-pill, 999px);
    border: var(--srf-border-width, 1px) solid var(--srf-border-strong, #3a4252);
    color: var(--srf-text-muted, #9aa3b2);
    white-space: nowrap;
  }
  .badge[data-role="sandbox-badge"] {
    border-color: var(--srf-badge-accent, #7fb3ff);
    color: var(--srf-badge-accent, #7fb3ff);
  }
  .badge[data-status="active"] {
    border-color: var(--srf-accent, #6ea8ff);
    color: var(--srf-accent, #6ea8ff);
  }
  .badge[data-status="missing"] {
    border-color: var(--srf-danger, #e06c75);
    color: var(--srf-danger, #e06c75);
  }
  .meta {
    margin: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0 var(--srf-spacing-sm, 8px);
    font-size: var(--srf-font-size-xs, 11px);
    line-height: var(--srf-line-height, 1.4);
  }
  .meta dt { color: var(--srf-text-muted, #9aa3b2); white-space: nowrap; }
  .meta dd {
    margin: 0;
    color: var(--srf-text, #e6e9ef);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-foot { display: flex; align-items: center; gap: var(--srf-spacing-sm, 8px); }
  .card-foot .hint { flex: 1 1 auto; min-width: 0; }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--srf-spacing-sm, 8px);
    padding: var(--srf-spacing-xl, 24px) var(--srf-spacing-sm, 8px);
    text-align: center;
    border: var(--srf-border-width, 1px) dashed var(--srf-border-strong, #3a4252);
    border-radius: var(--srf-radius, 6px);
  }
  .empty-title {
    margin: 0;
    font-size: var(--srf-font-size-md, 14px);
    font-weight: var(--srf-font-weight-semibold, 600);
  }
  .empty-hint {
    margin: 0;
    font-size: var(--srf-font-size-xs, 11px);
    color: var(--srf-text-muted, #9aa3b2);
  }
`;

/** 一行「字段名 / 值」的 DOM 片段（值一律 textContent 写入，不拼 HTML）。 */
function metaRow(label: string, value: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  frag.append(dt, dd);
  return frag;
}

/** 一张副本卡片的 DOM（data-role 供测试断言）。 */
function buildCard(card: LobbyCardModel): HTMLElement {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.role = 'card';
  el.dataset.instanceId = card.instanceId;
  el.dataset.status = card.status;

  const head = document.createElement('div');
  head.className = 'card-head';
  const name = document.createElement('span');
  name.className = 'card-name';
  name.dataset.role = 'card-name';
  name.textContent = card.name;
  head.appendChild(name);
  if (card.sandbox) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.dataset.role = 'sandbox-badge';
    badge.textContent = LOBBY_SANDBOX_BADGE;
    head.appendChild(badge);
  }
  const status = document.createElement('span');
  status.className = 'badge';
  status.dataset.role = 'status';
  status.dataset.status = card.status;
  status.textContent = card.statusLabel;
  head.appendChild(status);
  el.appendChild(head);

  const meta = document.createElement('dl');
  meta.className = 'meta';
  meta.dataset.role = 'meta';
  meta.appendChild(metaRow('路径', card.pathTail));
  meta.appendChild(metaRow('分支', card.branch));
  meta.appendChild(metaRow('最近进入', card.lastEnteredText));
  meta.appendChild(metaRow('在办任务', `${card.activeTaskCount}`));
  el.appendChild(meta);

  const foot = document.createElement('div');
  foot.className = 'card-foot';
  const enter = document.createElement('button');
  enter.type = 'button';
  enter.className = 'btn';
  enter.dataset.role = 'enter';
  enter.dataset.instanceId = card.instanceId;
  enter.textContent = LOBBY_ENTER_LABEL;
  enter.disabled = !card.enterable;
  if (!card.enterable) {
    enter.title = card.enterHint;
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.dataset.role = 'enter-hint';
    hint.textContent = card.enterHint;
    foot.appendChild(hint);
  }
  foot.appendChild(enter);
  el.appendChild(foot);
  return el;
}

/**
 * 工厂：注册 `<strat-lobby-panel>`。
 * 幂等（与 defineStatusScreen / defineStratButton 同约定：hot-reload 会重复调用）。
 */
export function defineLobbyPanel(): typeof HTMLElement {
  if (customElements.get(LOBBY_PANEL_TAG)) {
    return customElements.get(LOBBY_PANEL_TAG) as unknown as typeof HTMLElement;
  }

  class LobbyPanel extends HTMLElement implements StratLobbyPanelElement {
    private _adapter: LobbyPanelDeps | null = null;
    /** core 订阅闭包（退订必须挂在 disconnectedCallback —— perf 硬约束）。 */
    private _unsubscribe: (() => void) | null = null;
    /** 最近一次收到的 WorldState。 */
    private _state: WorldState | null = null;
    /** 最近一次派生出的模型（观察口）。 */
    private _model: LobbyPanelModel = resolveLobbyPanel(null);
    /** 渲染判重签名（perf：签名不变不重画 DOM）。 */
    private _signature = '';
    /** 网格容器（卡片区）。 */
    private _grid: HTMLElement | null = null;
    /** 空态容器。 */
    private _empty: HTMLElement | null = null;
    /** 派单按钮。 */
    private _dispatchButton: HTMLButtonElement | null = null;
    /** 派单副标题。 */
    private _dispatchHint: HTMLElement | null = null;
    /** 空态里的「添加副本」按钮。 */
    private _addButton: HTMLButtonElement | null = null;
    /** 大厅副标题（副本计数）。 */
    private _subtitle: HTMLElement | null = null;

    get adapter(): LobbyPanelDeps | null {
      return this._adapter;
    }

    set adapter(value: LobbyPanelDeps | null) {
      this._adapter = value;
      this.bindAdapter();
    }

    get model(): LobbyPanelModel {
      return this._model;
    }

    get lastState(): WorldState | null {
      return this._state;
    }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `
        <style>${LOBBY_PANEL_STYLE}</style>
        <div class="panel" data-role="lobby-panel">
          <div class="head">
            <h2 class="title" data-role="title">${LOBBY_TITLE}</h2>
            <p class="sub" data-role="subtitle"></p>
          </div>
          <div class="toolbar">
            <button type="button" class="btn" data-role="dispatch">${LOBBY_DISPATCH_LABEL}</button>
            <span class="hint" data-role="dispatch-hint"></span>
          </div>
          <div class="grid" data-role="grid"></div>
          <div class="empty" data-role="empty" hidden>
            <p class="empty-title" data-role="empty-title">${LOBBY_EMPTY_TITLE}</p>
            <p class="empty-hint" data-role="empty-hint">${LOBBY_EMPTY_HINT}</p>
            <button type="button" class="btn primary" data-role="add">${LOBBY_ADD_LABEL}</button>
          </div>
        </div>
      `;
      this._grid = root.querySelector('[data-role="grid"]');
      this._empty = root.querySelector('[data-role="empty"]');
      this._dispatchButton = root.querySelector('[data-role="dispatch"]');
      this._dispatchHint = root.querySelector('[data-role="dispatch-hint"]');
      this._addButton = root.querySelector('[data-role="add"]');
      this._subtitle = root.querySelector('[data-role="subtitle"]');

      // 事件委托：卡片网格整体一个监听（不逐卡挂 —— 卡片随签名重建，逐卡挂会漏摘）。
      this._grid?.addEventListener('click', this.onGridClick);
      this._dispatchButton?.addEventListener('click', this.onDispatchClick);
      this._addButton?.addEventListener('click', this.onAddClick);

      // 外壳刚重建（innerHTML 重写）⇒ 签名作废，强制画一遍（否则会跳过重绘、留下一张空网格）。
      this._signature = '';
      this.bindAdapter();
      this.render();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：退订 + 摘事件监听（元素反复挂卸不许累积订阅）。
      this._unsubscribe?.();
      this._unsubscribe = null;
      this._grid?.removeEventListener('click', this.onGridClick);
      this._dispatchButton?.removeEventListener('click', this.onDispatchClick);
      this._addButton?.removeEventListener('click', this.onAddClick);
    }

    /** 强制重算重渲染（改了观测时刻或手工注入新 state 后可调用）。 */
    refresh(): void {
      this._signature = '';
      this.render();
    }

    /** 绑定适配器（换适配器时先退订旧的 —— 免得两份订阅同时回调）。 */
    private bindAdapter(): void {
      this._unsubscribe?.();
      this._unsubscribe = null;
      const adapter = this._adapter;
      if (!adapter) return;
      this._unsubscribe = adapter.subscribe((state) => {
        this._state = state;
        this.render();
      });
    }

    /** 渲染（签名不变 ⇒ 跳过：perf，core 每次状态变更都全量广播）。 */
    private render(): void {
      const model = resolveLobbyPanel(this._state);
      this._model = model;
      const signature = lobbyPanelSignature(this._state);
      if (signature === this._signature) return;
      // 外壳还没建好（元素尚未 connected）⇒ 只更新模型，等 connectedCallback 再画 DOM。
      if (!this._grid) return;
      this._signature = signature;

      if (this._subtitle) {
        this._subtitle.textContent = model.empty
          ? LOBBY_EMPTY_HINT
          : `${model.cards.length} 个副本 · 选一个进入战场`;
      }
      if (this._dispatchButton) {
        this._dispatchButton.disabled = !model.dispatchEnabled;
        this._dispatchButton.title = model.dispatchHint;
      }
      if (this._dispatchHint) {
        this._dispatchHint.textContent = model.dispatchHint;
      }
      if (this._empty) {
        this._empty.hidden = !model.empty;
      }
      const grid = this._grid;
      grid.innerHTML = '';
      grid.hidden = model.empty;
      for (const card of model.cards) {
        grid.appendChild(buildCard(card));
      }
    }

    /** 点卡片 / 进入按钮 → 派 `project.enter`（core 负责裁决成败）。 */
    private onGridClick = (event: Event): void => {
      const target = event.target as HTMLElement | null;
      const holder = target?.closest('[data-instance-id]');
      const instanceId = holder?.getAttribute('data-instance-id');
      if (!instanceId) return;
      const card = this._model.cards.find((item) => item.instanceId === instanceId);
      // 不可进的副本（路径没了）不给派命令 —— 让 core 去拒绝没有意义，这里就说清原因。
      if (!card || !card.enterable) return;
      this.dispatchCommand(buildEnterInstanceCommand(card.instanceId));
    };

    /** 派单入口：可用时进默认沙盒（进副本后才有角色与队列可派单）。 */
    private onDispatchClick = (): void => {
      const target = this._model.dispatchTargetId;
      if (!target) return;
      this.dispatchCommand(buildEnterInstanceCommand(target));
    };

    /** 空态出口：把默认沙盒接回来并进入（详见 lobby-catalog 的 buildAddInstanceCommand 注释）。 */
    private onAddClick = (): void => {
      this.dispatchCommand(buildAddInstanceCommand());
    };

    /** 派命令（适配器缺席时静默丢弃 —— 没有通道就没有命令，不假装发过）。 */
    private dispatchCommand(command: HudCommand): void {
      this._adapter?.dispatch(command);
    }
  }

  customElements.define(LOBBY_PANEL_TAG, LobbyPanel);
  return LobbyPanel as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂（与 mountStatusScreen 同一装配口径：先给依赖，再给容器）：建元素、挂进容器，
 * 返回元素引用 + unmount 闭包。
 */
export function mountLobbyPanel(
  deps: LobbyPanelDeps,
  host: HTMLElement,
): { readonly element: StratLobbyPanelElement; readonly unmount: () => void } {
  defineLobbyPanel();
  const element = document.createElement(LOBBY_PANEL_TAG) as StratLobbyPanelElement;
  element.adapter = deps;
  host.appendChild(element);
  return {
    element,
    unmount: () => {
      element.adapter = null;
      element.remove();
    },
  };
}
