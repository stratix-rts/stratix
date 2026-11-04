/**
 * 文件职责：**网关连通性全局横幅**（@since v3.6，task_114）——
 *   网关（service / stratix-gateway）断连时，顶栏正下方挂一条**首屏第一眼可见**的横幅：
 *   「网关未连接 · 多数功能暂时没有数据」+「重试」按钮。
 *   为什么要有：断连这件事原先只埋在右栏态势总览的第 12 行（status-screen 的「网关连接」行），
 *   首次用户根本看不到 —— 于是「界面空着」被误读成「今天没活儿」，而不是「网关没连上」。
 *   横幅是**唯一**的全局断连提示位（态势屏那一行保留，作为细节口径）。
 * @since v3.7，task_127：横幅改为**三级**（在线 / 降级 / 离线）——
 *   半连接（HTTP 通、实时通道断）时亮出「连接降级 · 数据可用，实时通道断开」，
 *   不再谎报「未连接」（那与「回放照样能放」自相矛盾）。
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
import {
  GATEWAY_STATE_TEXT,
  type GatewayConnectionState,
  type GatewayLinkPort,
} from '../../bridge/gateway-link-port';
// 动效层（@since v3.8，task_138）：横幅从「瞬现」改为「落位」——
//   入场动效走共享工具类（位移 8px + 淡入，200ms），时长 / 缓动取 --srf-motion-* token。
import { MOTION_CLASS, MOTION_COMPONENT_CSS, installMotionTokens } from '../../theme/motion-tokens';
import { zVar } from '../../theme/layer-tokens';

export const GATEWAY_BANNER_TAG = 'strat-gateway-banner';

/**
 * 网关连通性端口（契约与三态文案都在 hud/bridge/gateway-link-port.ts —— 横幅与态势屏共用）。
 * @since v3.7，task_127：端口从二值（`online: boolean`）升级为三级态
 *   （online / degraded / offline），半连接态（HTTP 通、WS 断）不再被谎报成「未连接」。
 */

/** 横幅文案（人话：说清「连不上 / 降级」+「会有什么影响」+「怎么办」）。 */
export const GATEWAY_BANNER_TITLE = GATEWAY_STATE_TEXT.offline.bannerTitle;
export const GATEWAY_BANNER_DETAIL = GATEWAY_STATE_TEXT.offline.detail;
/** 降级态（HTTP 可用、实时通道断开）的横幅文案 —— 不出现「未连接」却功能可用的矛盾。 */
export const GATEWAY_BANNER_DEGRADED_TITLE = GATEWAY_STATE_TEXT.degraded.bannerTitle;
export const GATEWAY_BANNER_DEGRADED_DETAIL = GATEWAY_STATE_TEXT.degraded.detail;
export const GATEWAY_BANNER_RETRY_LABEL = '重试';

export type { GatewayConnectionState, GatewayLinkPort };

/** 组件对外形状（测试与装配方按它断言）。 */
export interface StratGatewayBannerElement extends HTMLElement {
  /** 连通性端口（组合根注入；null = 没有端口 → 横幅不显示）。 */
  link?: GatewayLinkPort | null;
  /** 当前横幅是否可见（观察口）。 */
  readonly visible: boolean;
  /** 当前三级连通态（观察口；横幅按它决定标题与配色）。 */
  readonly state: GatewayConnectionState;
}

export function defineStratGatewayBanner(): typeof HTMLElement {
  if (customElements.get(GATEWAY_BANNER_TAG)) {
    return customElements.get(GATEWAY_BANNER_TAG) as unknown as typeof HTMLElement;
  }

  class GatewayBanner extends HTMLElement implements StratGatewayBannerElement {
    private _link: GatewayLinkPort | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _root: HTMLElement | null = null;
    /** 当前三级连通态（初始「在线」—— 首帧不闪横幅）。 */
    private _state: GatewayConnectionState = 'online';
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
      return this._state !== 'online';
    }

    get state(): GatewayConnectionState {
      return this._state;
    }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      const root = this.shadowRoot;
      if (!root) return;
      // 动效 token 注入文档根（幂等）：横幅用的 --srf-motion-* 与其他组件同源同速。
      installMotionTokens();
      root.innerHTML = `
        <style>
          ${MOTION_COMPONENT_CSS}
          :host {
            all: initial;
            position: absolute;
            /* 模式状态条（@since v3.6）亮出时让位一条 ——
               否则断连横幅会压在状态条上（两者都在顶栏正下方）。 */
            top: calc(var(--srf-mode-strip-h, 0px) + ${TOPBAR_METRICS.heightPx + 8}px);
            left: 50%;
            transform: translateX(-50%);
            max-width: min(560px, calc(100% - 32px));
            z-index: ${zVar('banner')};
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
            /* 降级态（HTTP 可用、实时通道断开）用警示色，不用危险色 ——
               「还能用」和「完全不通」在视觉上必须分得开（task_127）。 */
            border-color: var(--srf-banner-accent, var(--srf-danger, #d04a4a));
            background: var(--srf-panel-elevated-overlay, rgba(20, 12, 16, 0.94));
            color: var(--srf-text, #e6e9ef);
            font-size: var(--srf-font-size-xs, 11px);
            line-height: var(--srf-line-height, 1.5);
            box-shadow: var(--srf-double-shadow, var(--srf-shadow, 0 4px 16px rgba(0, 0, 0, 0.35)));
            /* 四角角块（@since v3.8，task_135）：与按钮 / 面板同一套像素语言
               （background 定位的 2×2 方块 = 直角缺角感；现代皮兜底 0px = 什么都不画）。 */
            background-image:
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent)),
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent)),
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent)),
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent));
            background-size: var(--srf-notch-size, 0px) var(--srf-notch-size, 0px);
            background-position: left top, right top, left bottom, right bottom;
            background-repeat: no-repeat;
            pointer-events: auto;
          }
          .banner[hidden] { display: none; }
          .banner[data-state="degraded"] {
            --srf-banner-accent: var(--srf-warn, #d8a13a);
          }
          .banner[data-state="offline"] {
            --srf-banner-accent: var(--srf-danger, #d04a4a);
          }
          .dot {
            flex: none;
            width: 8px;
            height: 8px;
            border-radius: var(--srf-radius-pill, 999px);
            background: var(--srf-banner-accent, var(--srf-danger, #d04a4a));
          }
          .title { font-weight: var(--srf-font-weight-semibold, 600); white-space: nowrap; }
          .detail { color: var(--srf-text-muted, #9aa3b2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .retry {
            flex: none;
            font: inherit;
            font-size: var(--srf-font-size-xs, 11px);
            padding: 2px 10px;
            border-radius: var(--srf-radius-pill, 999px);
            border: 1px solid var(--srf-banner-accent, var(--srf-danger, #d04a4a));
            background: transparent;
            color: var(--srf-banner-accent, var(--srf-danger, #d04a4a));
            cursor: pointer;
            white-space: nowrap;
          }
          .retry:hover:not([disabled]) { background: color-mix(in srgb, var(--srf-banner-accent, var(--srf-danger, #d04a4a)) 18%, transparent); }
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
        this.render('online');
        return;
      }
      this._unsubscribe = link.subscribe((state) => this.render(state));
      this.render(link.state);
    }

    /**
     * 呈现（在线 → 收起；降级 / 离线 → 亮出横幅，文案与配色按三级态取）。
     * why 降级也要亮横幅（task_127）：半连接时用户照样得知道「实时通道断了」，
     *   但文案必须说清「数据可用」—— 不能一边喊「未连接」一边让回放照放。
     */
    private render(state: GatewayConnectionState): void {
      const root = this._root;
      // 根还没建好（link 端口在挂载前就注入了）→ 这一帧不落状态：
      //   why：落了就等于「横幅已经亮过一次」，connectedCallback 里的那次 render
      //   会被判成「没变化」，于是首次亮出反而不播入场动效（横幅的第一眼必须是落位的）。
      if (!root) return;
      const wasVisible = this._state !== 'online';
      this._state = state;
      const text = GATEWAY_STATE_TEXT[state];
      root.hidden = state === 'online';
      root.setAttribute('data-state', state);
      const title = root.querySelector('[data-role="title"]');
      const detail = root.querySelector('[data-role="detail"]');
      if (title) title.textContent = text.bannerTitle;
      if (detail) detail.textContent = text.detail;
      // 入场动效（@since v3.8，task_138）：只在「不可见 → 可见」这一次触发 ——
      //   why 一次性：横幅收起再亮出要重新落位（否则第二次出现是瞬现，用户会以为界面卡了）。
      //   首帧亮出也算「不可见 → 可见」—— 横幅的第一眼必须是落位的。
      if (state !== 'online' && !wasVisible) this.playEnter(root);
    }

    /**
     * 播放入场动效（位移 8px + 淡入，200ms）。
     * why 要「先摘类 → 强制回流 → 再挂类」：同一元素重复挂同一个类不会重放动画，
     *   强制回流（读 offsetWidth）让浏览器认为样式已重算，动画才会重新起跑。
     */
    private playEnter(el: HTMLElement): void {
      el.classList.remove(MOTION_CLASS.enter);
      void el.offsetWidth;
      el.classList.add(MOTION_CLASS.enter);
    }

    /** 点「重试」：立刻探一次（判定在 app 层，这里只转交）。 */
    private onRetryClick = (): void => {
      const link = this._link;
      if (!link || this._retrying) return;
      this._retrying = true;
      this.setRetryDisabled(true);
      void link
        .refresh()
        .catch(() => 'offline' as GatewayConnectionState)
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
