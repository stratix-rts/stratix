/**
 * 文件职责：**里程碑大字 overlay** Web Component（`<strat-milestone>`，task_080）——
 *   每完成 N 个任务（MARQUEE_METRICS.milestoneEvery = 10）在屏幕中央打一行金色大字，
 *   停留 1.5s，同时甩给战场一记小震（camera shake，走 HudCommand → core → world 通道）。
 *   来源：docs/DEMO-PLAN.md §6（里程碑大字）+ §8（演示模式强制开启）。
 * 输入：noteCompleted() 的显式调用（组合根订阅 core 总线的 task.completed 后喂进来 ——
 *   hud 组件只被驱动、不订阅总线）；setForced() 由组合根按演示模式开关调用；
 *   dispatch 端口（组合根注入 adapter.dispatch —— 震动必须经总线，HUD 绝不直接调 world）。
 * 输出：fixed 居中的 Shadow DOM 大字（零资产：纯 CSS 绘制）+ 一条 camera.shake 命令。
 * 禁止事项：
 *   1. import world/、phaser、app/、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— 命令派发一律经注入的 dispatch（组合根接线）；
 *   3. 自己订阅总线判「完成了几个」—— 计数由组件持有（喂进来的都是完成事件），订阅归组合根；
 *   4. 硬编码色值 / 时长 —— 颜色走 --srf-visual-progress token，时长取 MARQUEE_METRICS；
 *   5. 泄漏计时器 —— 大字自动收的计时器必须在 disconnectedCallback 清光（perf 硬约束）。
 *
 * @since v3.3（task_080）。
 */

import { MARQUEE_METRICS, VISUAL_PALETTE, hexToRgba } from '../../../core/theme/visual-spec';
import type { HudCommand } from '../../../core/types';
import { isMilestoneCount, milestoneText } from './marquee-catalog';

export const MILESTONE_TAG = 'strat-milestone';

/** 可见性记忆键（正常模式下的开关口径；演示模式强制开启时忽略它）。 */
export const MILESTONE_ENABLED_KEY = 'stratix.milestone.enabled';

/** 依赖注入：命令出口（组合根喂 adapter.dispatch）+ 记忆存储。 */
export interface MilestoneDeps {
  /** 命令出口（HUD → core 的唯一合法通道）。 */
  readonly dispatch: (command: HudCommand) => void;
  /** localStorage 取法（缺省走浏览器全局；测试注入内存实现）。 */
  readonly storage?: () => Pick<Storage, 'getItem'> | null;
}

/** 自定义元素的对外形状（组合根与测试按它操作）。 */
export interface StratMilestoneElement extends HTMLElement {
  /** 依赖注入（mount 时挂上，connectedCallback 时生效）。 */
  deps?: MilestoneDeps;
  /** 记一次任务完成；到阈值时返回触发的里程碑序号（如 10），否则返回 null。 */
  noteCompleted(): number | null;
  /** 强制开启（演示模式开 = true；关 = 回到本地记忆口径）。 */
  setForced(forced: boolean): void;
  /** 已记下的完成数（观察口）。 */
  readonly completedCount: number;
  /** 大字当前是否在屏。 */
  readonly showing: boolean;
  /** 大字当前文案（不在屏时为空串）。 */
  readonly text: string;
  /** 是否开启（强制 or 记忆）。 */
  readonly enabled: boolean;
}

/** 默认取 localStorage（浏览器全局；不存在时返回 null）。 */
function defaultStorage(): Pick<Storage, 'getItem'> | null {
  try {
    const store = (globalThis as { localStorage?: Pick<Storage, 'getItem'> }).localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

/**
 * 工厂：注册 `<strat-milestone>`。
 * 幂等（与 defineToastHost / defineStratMarquee 同约定）。
 */
export function defineStratMilestone(): typeof HTMLElement {
  if (customElements.get(MILESTONE_TAG)) {
    return customElements.get(MILESTONE_TAG) as unknown as typeof HTMLElement;
  }

  class Milestone extends HTMLElement implements StratMilestoneElement {
    private _big: HTMLElement | null = null;
    /** 收起计时器（大字自动消失）。 */
    private _timer: ReturnType<typeof setTimeout> | null = null;
    /** 已完成的计数（喂进来的都是「完成」事件）。 */
    private _completed = 0;
    /** 演示模式强制开启。 */
    private _forced = false;
    /** 本地记忆的开启状态（缺省开启）。 */
    private _remembered = true;

    get deps(): MilestoneDeps {
      return (this as unknown as { _deps?: MilestoneDeps })._deps ?? { dispatch: () => {} };
    }

    set deps(value: MilestoneDeps) {
      (this as unknown as { _deps?: MilestoneDeps })._deps = value;
    }

    get completedCount(): number {
      return this._completed;
    }

    get showing(): boolean {
      return this._big !== null && this._big.classList.contains('show');
    }

    get text(): string {
      return this._big?.textContent ?? '';
    }

    get enabled(): boolean {
      return this._forced || this._remembered;
    }

    connectedCallback(): void {
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `
        <style>
          /* 屏幕中央的大字：fixed 覆盖整屏、不占布局、不拦事件（观众看的是画面）。 */
          :host {
            all: initial;
            position: fixed;
            inset: 0;
            z-index: 45;
            pointer-events: none;
            display: grid;
            place-items: center;
            font-family: var(--srf-font-ui, system-ui, -apple-system, sans-serif);
          }
          .big {
            font-size: clamp(30px, 5.5vw, 64px);
            font-weight: 700;
            letter-spacing: 0.02em;
            color: var(--milestone-color, var(--srf-visual-progress));
            text-shadow: 0 0 18px var(--milestone-glow, transparent), 0 2px 0 rgba(0, 0, 0, 0.45);
            opacity: 0;
            transform: scale(0.9);
            white-space: nowrap;
          }
          .big.show { animation: milestone-pop var(--milestone-duration, 1500ms) cubic-bezier(0.22, 1, 0.36, 1) both; }
          @keyframes milestone-pop {
            0% { opacity: 0; transform: scale(0.86); }
            12% { opacity: 1; transform: scale(1.05); }
            24% { transform: scale(1); }
            76% { opacity: 1; transform: scale(1); }
            100% { opacity: 0; transform: scale(1.02); }
          }
        </style>
        <div class="big" data-role="big" role="status"></div>
      `;
      this._big = root.querySelector('[data-role="big"]');
      // 停留时长写进 CSS 变量（唯一事实源 → 样式），不在 CSS 里再抄一份 1500。
      this.style.setProperty('--milestone-duration', `${MARQUEE_METRICS.milestoneDurationMs}ms`);
      // 金色从唯一事实源取（VISUAL_PALETTE.progress），在运行时翻成 CSS 变量 ——
      // why 不在 CSS 里写死色值：色值只有 core/theme/visual-spec.ts 一处。
      this.style.setProperty('--milestone-color', `var(--srf-visual-progress, ${VISUAL_PALETTE.progress})`);
      this.style.setProperty('--milestone-glow', hexToRgba(VISUAL_PALETTE.progress, 0.5));
      this._remembered = this.readRemembered();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：元素离场时清光收起计时器。
      if (this._timer !== null) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      this._big = null;
    }

    noteCompleted(): number | null {
      this._completed += 1;
      if (!isMilestoneCount(this._completed)) return null;
      if (!this.enabled) return null;
      this.show(milestoneText(this._completed));
      // 震：走 HudCommand → core 钳制 → world 通道 → 场景相机（铁律：hud 不认识 world）。
      this.deps.dispatch({
        type: 'camera.shake',
        durationMs: MARQUEE_METRICS.shakeDurationMs,
        intensity: MARQUEE_METRICS.shakeIntensity,
      });
      return this._completed;
    }

    setForced(forced: boolean): void {
      this._forced = forced;
    }

    /** 打大字（停留 milestoneDurationMs 后自动收）。 */
    private show(text: string): void {
      const big = this._big;
      if (!big) return;
      big.textContent = text;
      big.classList.remove('show');
      // 重新触发 CSS 动画：移除 class 后强制回流一次再挂上（否则连续两次不会重播）。
      void big.offsetWidth;
      big.classList.add('show');
      if (this._timer !== null) clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        this._timer = null;
        big.classList.remove('show');
        big.textContent = '';
      }, MARQUEE_METRICS.milestoneDurationMs);
    }

    /** 读本地记忆（缺省开启；读不到 = 开启）。 */
    private readRemembered(): boolean {
      const store = this.deps.storage ? this.deps.storage() : defaultStorage();
      if (!store) return true;
      try {
        return store.getItem(MILESTONE_ENABLED_KEY) !== 'off';
      } catch {
        return true;
      }
    }
  }

  customElements.define(MILESTONE_TAG, Milestone);
  return Milestone as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：与 mountToastHost / mountMarquee 同一装配口径。
 */
export function mountMilestone(
  host: HTMLElement,
  deps: MilestoneDeps
): {
  readonly element: StratMilestoneElement;
  readonly unmount: () => void;
} {
  defineStratMilestone();
  const element = document.createElement(MILESTONE_TAG) as StratMilestoneElement;
  element.deps = deps;
  host.appendChild(element);
  // 移除元素触发 disconnectedCallback → 计时器清光。
  return { element, unmount: () => { element.remove(); } };
}
