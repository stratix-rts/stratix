/**
 * 文件职责：**屏幕空间扫描光带** Web Component（`<strat-scan-band>`，@since v3.3，task_086）——
 *   横贯整屏的柔和光带，每 12s 从左到右扫过一次（DEMO-PLAN §5「缓慢移动的横向扫描光带」）。
 *   @since v3.3（task_086）本效果从战场可缩放层**迁出**到 HUD 屏幕空间：
 *   镜头缩放 / 平移时它必须纹丝不动（迁前它画在 world 画布里，跟着镜头缩放变形）。
 * 输入：无 —— 自驱动（CSS transform 动画，不读时钟、不占主线程、不订阅总线）。
 * 输出：fixed 定位的 Shadow DOM 光带（覆盖整屏；pointer-events:none，不拦事件）。
 * 禁止事项：
 *   1. import world / phaser / app / core/bus —— 铁律：hud 只认识 core；
 *   2. 挂在战场画布层（world）—— 那是**可缩放**坐标空间，放那儿必然跟着镜头变形；
 *   3. 逐帧 JS 算位置 —— 用 CSS transform 动画（合成器线程跑，主线程零成本，perf 硬约束）；
 *   4. 硬编码色值 / 尺寸 / 周期 —— 全部取自 core/theme/visual-spec 的 SCREEN_FX_METRICS；
 *   5. 把它画得太亮 —— 峰值透明度已按验收意见降到 4%（弱化为背景感，不盖住单位与区域点亮）。
 */

import { SCREEN_FX_METRICS } from '../../../core/theme/visual-spec';

export const SCAN_BAND_TAG = 'strat-scan-band';

/** 自定义元素的对外形状（组合根与测试按它观察）。 */
export interface StratScanBandElement extends HTMLElement {
  /** 光带周期（ms；观察口）。 */
  readonly periodMs: number;
  /** 光带峰值透明度（观察口）。 */
  readonly alpha: number;
  /** 光带宽度（屏幕 px；观察口）。 */
  readonly widthPx: number;
}

/**
 * 工厂：注册 `<strat-scan-band>`。
 * 幂等（与 defineStratMarquee / defineStratMilestone 同约定）：重复注册返回已注册构造器。
 */
export function defineStratScanBand(): typeof HTMLElement {
  if (customElements.get(SCAN_BAND_TAG)) {
    return customElements.get(SCAN_BAND_TAG) as unknown as typeof HTMLElement;
  }

  class ScanBand extends HTMLElement implements StratScanBandElement {
    private _track: HTMLElement | null = null;

    get periodMs(): number {
      return SCREEN_FX_METRICS.scanBandPeriodMs;
    }

    get alpha(): number {
      return SCREEN_FX_METRICS.scanBandAlpha;
    }

    get widthPx(): number {
      return SCREEN_FX_METRICS.scanBandWidthPx;
    }

    connectedCallback(): void {
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `
        <style>
          /* 整屏覆盖层：fixed 定位 = 屏幕空间坐标，与镜头缩放 / 平移无关。
             z-index 1 —— 压在战场画布之上、HUD 面板之下（面板 20+），故它只是背景感。 */
          :host {
            all: initial;
            position: fixed;
            inset: 0;
            z-index: 1;
            pointer-events: none;
            overflow: hidden;
          }
          /* 轨道：整屏大小，动画只动它的 transform。
             why 动轨道而不是光带：translateX 的百分比按**元素自身宽度**算，
               轨道宽度 = 屏幕宽，于是 100% 正好是「光带完全出右边界」的位置。 */
          .track {
            position: absolute;
            inset: 0;
            animation: srf-scan-sweep var(--scan-band-period, 12000ms) linear infinite;
          }
          /* 光带：竖条（宽 = --scan-band-width），横贯全屏；两端淡出 → 软边无硬边。 */
          .band {
            position: absolute;
            top: 0;
            bottom: 0;
            left: 0;
            width: var(--scan-band-width, 120px);
            background: linear-gradient(
              to right,
              rgba(255, 255, 255, 0),
              rgba(255, 255, 255, var(--scan-band-alpha, 0.04)) 50%,
              rgba(255, 255, 255, 0)
            );
          }
          @keyframes srf-scan-sweep {
            from { transform: translateX(calc(-1 * var(--scan-band-width, 120px))); }
            to { transform: translateX(100%); }
          }
        </style>
        <div class="track" data-role="track">
          <div class="band" data-role="band"></div>
        </div>
      `;
      this._track = root.querySelector('[data-role="track"]');
      // 尺寸 / 周期 / 透明度写进 CSS 变量（唯一事实源 → 样式），不在 CSS 里再抄一份。
      this.style.setProperty('--scan-band-width', `${SCREEN_FX_METRICS.scanBandWidthPx}px`);
      this.style.setProperty('--scan-band-alpha', String(SCREEN_FX_METRICS.scanBandAlpha));
      this.style.setProperty('--scan-band-period', `${SCREEN_FX_METRICS.scanBandPeriodMs}ms`);
    }

    disconnectedCallback(): void {
      // 无计时器 / 无补间（动画由合成器线程驱动，随元素移除而终止）—— 这里只需复位引用。
      this._track = null;
    }
  }

  customElements.define(SCAN_BAND_TAG, ScanBand);
  return ScanBand as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂（本仓库面板的统一装配口径，与 mountMarquee / mountReplayClock 一致）：
 * 建元素、挂进容器，返回元素引用 + unmount 闭包。
 *
 * @param host 覆盖层容器（**挂 #hud-side**：#hud-root 会被主屏每次重绘 innerHTML 抹掉）。
 */
export function mountScanBand(
  host: HTMLElement
): { readonly element: StratScanBandElement; readonly unmount: () => void } {
  defineStratScanBand();
  const element = document.createElement(SCAN_BAND_TAG) as StratScanBandElement;
  host.appendChild(element);
  // 移除元素 → disconnectedCallback（动画随之终止）。
  return { element, unmount: () => { element.remove(); } };
}
