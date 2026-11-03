/**
 * 文件职责：**网关连通性全局横幅**（@since v3.6，task_114）——
 *   网关（service / stratix-gateway）断连时，顶栏正下方挂一条**首屏第一眼可见**的横幅：
 *   「网关未连接 · 多数功能暂时没有数据」+「重试」按钮。
 *   为什么要有：断连这件事原先只埋在右栏态势总览的第 12 行（status-screen 的「网关连接」行），
 *   首次用户根本看不到 —— 于是「界面空着」被误读成「今天没活儿」，而不是「网关没连上」。
 *   横幅是**唯一**的全局断连提示位（态势屏那一行保留，作为细节口径）。
 * 输入：注入的 GatewayLinkPort（连通性真相由 app 层持有 —— HUD 不自己探活）。
 * 输出：Shadow DOM 横幅（断连时显示、连通即消失）+「重试」按钮（点一下立刻探一次）。
 * 禁止事项：
 *   1. import world / phaser / app —— 铁律：hud 只认识 core 与注入的端口；
 *   2. 自己发 fetch / 建轮询 —— 连通性判定归 app 层（单一判定方），HUD 只呈现；
 *   3. 用 innerHTML 写正文 —— 文案是常量（textContent 即可），不做外部输入渲染；
 *   4. 硬编码色值 —— 颜色一律引用 --srf-* token；
 *   5. 泄漏监听器 —— disconnectedCallback 必须退订（perf 硬约束）。
 *
 * ============ 版面口径 ============
 *   横幅挂在 **#hud-side**（覆盖层容器，pointer-events:none，JS 永不重写）——
 *   why 不挂 #hud-root：主屏每次重绘都 `host.innerHTML = ...` 重写 #hud-root，
 *   挂里面的东西当场被抹掉（与 task_084 逮到的回放角标同一个坑）。
 *   纵向位置 = 顶栏下沿 + 间距（顶栏高度取 core/theme/visual-spec.ts 的唯一事实源
 *   TOPBAR_METRICS.heightPx）；横向居中且限宽 —— 全宽会压住左右竖栏的顶行。
 */

import { TOPBAR_METRICS } from '../../../core/theme/visual-spec';

export const GATEWAY_BANNER_TAG = 'strat-gateway-banner';

/**
 * 网关连通性端口（HUD 侧的**契约**；app 层实现它）。
 * why 契约放 HUD：横幅是 HUD 组件，它需要什么形状由它自己说了算；
 *   app 层照形状实现（与 appearance-preview-port / session-catalog 的端口同一纪律）。
 */
export interface GatewayLinkPort {
  /** 同步读当前连通性（true = 在线）。初始按「在线」处理 —— 别在首帧闪一条横幅。 */
  readonly online: boolean;
  /** 订阅连通性变化（注册后立刻推一次当前值）；返回退订闭包。 */
  subscribe(handler: (online: boolean) => void): () => void;
  /** 立刻探一次（重试按钮用）；返回探测后的在线态。 */
  refresh(): Promise<boolean>;
}

/** 横幅文案（人话：说清「连不上」+「会有什么影响」+「怎么办」）。 */
export const GATEWAY_BANNER_TITLE = '网关未连接';
export const GATEWAY_BANNER_DETAIL = '多数功能暂时没有数据';
export const GATEWAY_BANNER_RETRY_LABEL = '重试';

/** 组件对外形状（测试与装配方按它断言）。 */
export interface StratGatewayBannerElement extends HTMLElement {
  /** 连通性端口（组合根注入；null = 没有端口 → 横幅不显示）。 */
  link?: GatewayLinkPort | null;
  /** 当前横幅是否可见（观察口）。 */
  readonly visible: boolean;
}

export function defineStratGatewayBanner(): typeof HTMLElement {
  if (customElements.get(GATEWAY_BANNER_TAG)) {
    return customElements.get(GATEWAY_BANNER_TAG) as unknown as typeof HTMLElement;
  }

  class GatewayBanner extends HTMLElement implements StratGatewayBannerElement {
    private _link: GatewayLinkPort | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _root: HTMLElement | null = null;
    private _online = true;
    /** 重试进行中（按钮禁用来避免连点打出一串探测）。 */
    private _retrying = false;

    get link(): GatewayLinkPort | null {
      return this._link;
    }

    set link(value: GatewayLinkPort | null) {
      this._link = value;
      this.bindLink();
    }

    get visible(): boolean {
      return !this._online;
    }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `
        <style>
          :host {
            all: initial;
            position: absolute;
            /* 模式状态条（@since v3.6，task_117）亮出时让位一条 ——
               否则断连横幅会压在状态条上（两者都在顶栏正下方）。 */
            top: calc(var(--srf-mode-strip-h, 0px) + ${TOPBAR_METRICS.heightPx + 8}px);
            left: 50%;
            transform: translateX(-50%);
            max-width: min(560px, calc(100% - 32px));
            z-index: 31;
            pointer-events: none;
            font-family: var(--srf-font-ui, system-ui, -apple-system, sans-serif);
          }
          .banner {
            display: flex;
            align-items: center;
            gap: var(--srf-spacing-sm, 8px);
            box-sizing: border-box;
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-sm, 8px);
            border: 1px solid var(--srf-danger, #d04a4a);
            border-radius: var(--srf-radius, 6px);
            background: var(--srf-panel-elevated-overlay, rgba(20, 12, 16, 0.94));
            color: var(--srf-text, #e6e9ef);
            font-size: var(--srf-font-size-xs, 11px);
            line-height: var(--srf-line-height, 1.5);
            box-shadow: var(--srf-shadow, 0 4px 16px rgba(0, 0, 0, 0.35));
            pointer-events: auto;
          }
          .banner[hidden] { display: none; }
          .dot {
            flex: none;
            width: 8px;
            height: 8px;
            border-radius: var(--srf-radius-pill, 999px);
            background: var(--srf-danger, #d04a4a);
          }
          .title { font-weight: var(--srf-font-weight-semibold, 600); white-space: nowrap; }
          .detail { color: var(--srf-text-muted, #9aa3b2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .retry {
            flex: none;
            font: inherit;
            font-size: var(--srf-font-size-xs, 11px);
            padding: 2px 10px;
            border-radius: var(--srf-radius-pill, 999px);
            border: 1px solid var(--srf-danger, #d04a4a);
            background: transparent;
            color: var(--srf-danger, #d04a4a);
            cursor: pointer;
            white-space: nowrap;
          }
          .retry:hover:not([disabled]) { background: color-mix(in srgb, var(--srf-danger, #d04a4a) 18%, transparent); }
          .retry[disabled] { opacity: 0.55; cursor: progress; }
        </style>
        <div class="banner" data-role="gateway-banner" role="status" aria-live="polite" hidden>
          <span class="dot" aria-hidden="true"></span>
          <span class="title" data-role="title">${GATEWAY_BANNER_TITLE}</span>
          <span class="detail" data-role="detail">${GATEWAY_BANNER_DETAIL}</span>
          <button class="retry" type="button" data-role="retry" aria-label="${GATEWAY_BANNER_RETRY_LABEL}">${GATEWAY_BANNER_RETRY_LABEL}</button>
        </div>
      `;
      this._root = root.querySelector('[data-role="gateway-banner"]');
      root.querySelector('[data-role="retry"]')?.addEventListener('click', this.onRetryClick);
      this.bindLink();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：退订 + 摘事件监听（元素离场后不该再被回调）。
      this._unsubscribe?.();
      this._unsubscribe = null;
      this.shadowRoot?.querySelector('[data-role="retry"]')?.removeEventListener('click', this.onRetryClick);
    }

    /** 绑定端口（换端口时先退订旧的）。 */
    private bindLink(): void {
      this._unsubscribe?.();
      this._unsubscribe = null;
      const link = this._link;
      if (!link) {
        this.render(true);
        return;
      }
      this._online = link.online;
      this._unsubscribe = link.subscribe((online) => this.render(online));
      this.render(link.online);
    }

    /** 呈现（连通 → 收起；断连 → 亮出横幅）。 */
    private render(online: boolean): void {
      this._online = online;
      if (this._root) this._root.hidden = online;
    }

    /** 点「重试」：立刻探一次（判定在 app 层，这里只转交）。 */
    private onRetryClick = (): void => {
      const link = this._link;
      if (!link || this._retrying) return;
      this._retrying = true;
      this.setRetryDisabled(true);
      void link
        .refresh()
        .catch(() => false)
        .then(() => {
          this._retrying = false;
          this.setRetryDisabled(false);
        });
    };

    /** 重试按钮的禁用态（探测中禁一次，避免连点打出一串请求）。 */
    private setRetryDisabled(disabled: boolean): void {
      const button = this.shadowRoot?.querySelector('[data-role="retry"]');
      if (button instanceof HTMLButtonElement) button.disabled = disabled;
    }
  }

  customElements.define(GATEWAY_BANNER_TAG, GatewayBanner);
  return GatewayBanner as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂（与 mountDayReplay / mountMarquee 同一装配口径）：建元素、挂进容器，
 * 返回元素引用 + unmount 闭包。
 */
export function mountGatewayBanner(
  host: HTMLElement,
  deps: { readonly link: GatewayLinkPort | null }
): { readonly element: StratGatewayBannerElement; readonly unmount: () => void } {
  defineStratGatewayBanner();
  const element = document.createElement(GATEWAY_BANNER_TAG) as StratGatewayBannerElement;
  element.link = deps.link;
  host.appendChild(element);
  return { element, unmount: () => { element.remove(); } };
}
