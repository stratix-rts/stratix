/**
 * 文件职责：**报错红光晕** Web Component（`<strat-error-glow>`，@since v3.3，task_086）——
 *   屏幕边缘柔和的红色光晕，呼吸 2 次后归零（DEMO-PLAN §7「报错事件附加红色 vignette 脉冲」）。
 *   @since v3.3（task_086）本效果从战场可缩放层**迁出**到 HUD 屏幕空间，并按验收意见降级：
 *   迁前是四条**硬边框**渐变带（world 画布内，随镜头缩放变形，且抢戏）；
 *   迁后是**径向 alpha 渐变**（中心透明 → 边缘红），无硬边框，强度约为原来一半。
 * 输入：pulse() 的显式调用（组合根订阅 core 总线的 task.failed 后喂进来 ——
 *   hud 组件只被驱动、不订阅总线，与跑马灯 / 里程碑同一装配口径）。
 * 输出：fixed 定位的 Shadow DOM 光晕（覆盖整屏；pointer-events:none，不拦事件）。
 * 禁止事项：
 *   1. import world / phaser / app / core/bus —— 铁律：hud 只认识 core；
 *   2. 自己订阅总线 / 自己判断导演模式 —— 事件订阅与业务判定归组合根
 *      （判定口径在 screen-fx-catalog 的 errorGlowTrigger，单测直打）；
 *   3. 画硬边框（border / 环 / 实心边缘带）—— 规格钦定「柔和红光晕」，硬边会像报错弹窗；
 *   4. 硬编码色值 / 时长 / 次数 —— 取自 core/theme/visual-spec 的 SCREEN_FX_METRICS，
 *      色值走 --srf-visual-danger token（唯一事实源注入）；
 *   5. 泄漏计时器 —— 本组件零计时器（动画结束由 animationend 事件收尾）。
 */

import { SCREEN_FX_METRICS, VISUAL_PALETTE } from '../../../core/theme/visual-spec';
import { zVar } from '../../theme/layer-tokens';
import { MOTION_REDUCED_CSS } from '../../theme/motion-tokens';

export const ERROR_GLOW_TAG = 'strat-error-glow';

/** 自定义元素的对外形状（组合根与测试按它操作）。 */
export interface StratErrorGlowElement extends HTMLElement {
  /** 呼吸一次（亮起 → 熄灭，共 N 个来回；N 取自 SCREEN_FX_METRICS.errorGlowPulses = 2）。 */
  pulse(): void;
  /** 当前是否正在呼吸（观察口）。 */
  readonly showing: boolean;
  /** 已呼吸的次数（观察口）。 */
  readonly pulseCount: number;
}

/**
 * 工厂：注册 `<strat-error-glow>`。
 * 幂等（与 defineStratMarquee / defineStratMilestone 同约定）。
 */
export function defineStratErrorGlow(): typeof HTMLElement {
  if (customElements.get(ERROR_GLOW_TAG)) {
    return customElements.get(ERROR_GLOW_TAG) as unknown as typeof HTMLElement;
  }

  class ErrorGlow extends HTMLElement implements StratErrorGlowElement {
    private _glow: HTMLElement | null = null;
    private _showing = false;
    private _pulseCount = 0;

    get showing(): boolean {
      return this._showing;
    }

    get pulseCount(): number {
      return this._pulseCount;
    }

    connectedCallback(): void {
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `
        <style>
          /* 整屏覆盖层：fixed 定位 = 屏幕空间坐标，与镜头缩放 / 平移无关。 */
          :host {
            all: initial;
            position: fixed;
            inset: 0;
            z-index: ${zVar('fxRaised')};
            pointer-events: none;
          }
          /* 光晕本体：径向 alpha 渐变 —— 中心透明 → 边缘红。
             why 不用 border / 实心边缘带：规格要的是「柔和红光晕」，硬边看着像报错弹窗。
             色值走 --srf-visual-danger token（唯一事实源注入），兜底色取自同一份色表。 */
          .glow {
            position: absolute;
            inset: 0;
            opacity: 0;
            background: radial-gradient(
              ellipse at center,
              transparent var(--glow-inner, 45%),
              var(--srf-visual-danger, ${VISUAL_PALETTE.danger}) 100%
            );
          }
          /* 呼吸：一次亮起 + 一次熄灭算一轮，轮数 = --glow-pulses（规格钦定 2）。 */
          .glow.pulsing {
            animation: srf-error-glow-pulse var(--glow-pulse-ms, var(--srf-motion-loop-glow)) ease-in-out var(--glow-pulses, 2);
          }
          @keyframes srf-error-glow-pulse {
            0% { opacity: 0; }
            50% { opacity: var(--glow-peak, 0.28); }
            100% { opacity: 0; }
          }
        ${MOTION_REDUCED_CSS}
        </style>
        <div class="glow" data-role="glow" aria-hidden="true"></div>
      `;
      this._glow = root.querySelector('[data-role="glow"]');
      this._glow?.addEventListener('animationend', this.onAnimationEnd);
      // 强度 / 时长 / 轮数 / 渐变起点写进 CSS 变量（唯一事实源 → 样式），不在 CSS 里再抄一份。
      this.style.setProperty('--glow-peak', String(SCREEN_FX_METRICS.errorGlowAlpha));
      this.style.setProperty('--glow-pulse-ms', `${SCREEN_FX_METRICS.errorGlowPulseMs}ms`);
      this.style.setProperty('--glow-pulses', String(SCREEN_FX_METRICS.errorGlowPulses));
      this.style.setProperty('--glow-inner', `${Math.round(SCREEN_FX_METRICS.errorGlowInnerRatio * 100)}%`);
    }

    disconnectedCallback(): void {
      // 资源必须可清理：摘掉 animationend 监听并复位状态（元素可能被复用）。
      this._glow?.removeEventListener('animationend', this.onAnimationEnd);
      this._glow = null;
      this._showing = false;
    }

    pulse(): void {
      const glow = this._glow;
      if (!glow) return;
      this._pulseCount += 1;
      // 重新触发 CSS 动画：移除 class 后强制回流一次再挂上（否则连续两次报错不会重播）。
      glow.classList.remove('pulsing');
      void glow.offsetWidth;
      glow.classList.add('pulsing');
      this._showing = true;
    }

    /** 动画跑完 → 收尾（去掉 class，状态复位；下一轮呼吸从头开始）。 */
    private readonly onAnimationEnd = (): void => {
      this._glow?.classList.remove('pulsing');
      this._showing = false;
    };
  }

  customElements.define(ERROR_GLOW_TAG, ErrorGlow);
  return ErrorGlow as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂（本仓库面板的统一装配口径，与 mountMarquee / mountReplayClock 一致）：
 * 建元素、挂进容器，返回元素引用 + unmount 闭包。
 *
 * @param host 覆盖层容器（**挂 #hud-side**：#hud-root 会被主屏每次重绘 innerHTML 抹掉）。
 */
export function mountErrorGlow(
  host: HTMLElement
): { readonly element: StratErrorGlowElement; readonly unmount: () => void } {
  defineStratErrorGlow();
  const element = document.createElement(ERROR_GLOW_TAG) as StratErrorGlowElement;
  host.appendChild(element);
  // 移除元素 → disconnectedCallback（监听随之摘掉）。
  return { element, unmount: () => { element.remove(); } };
}
