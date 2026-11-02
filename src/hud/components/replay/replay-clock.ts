/**
 * 文件职责：**回放时间戳角标** Web Component（`<strat-replay-clock>`，task_082）——
 *   屏幕左上角的大号时间戳 + 日期 + 「回放中」快进提示（DEMO-PLAN.md §9「60 秒看完今天」）。
 * 输入：setTime(at) 的显式调用（组合根注入 —— 角标只被驱动，不订阅总线）。
 * 输出：fixed 定位的 Shadow DOM 角标（时间跳变是唯一的动画来源）。
 * 禁止事项：
 *   1. import world / phaser / app / core/bus —— 铁律：hud 只认识 core；
 *   2. 自己读时钟决定「现在几点」—— 时刻由回放控制器给（回放的是**历史**时刻，不是墙钟）；
 *   3. 用 innerHTML 写正文 —— 一律 textContent；
 *   4. 硬编码色值 —— 走 --srf-visual-* token（唯一事实源注入）；
 *   5. 常驻占位 —— 没有回放时刻就整个隐藏（不占左上角，也不误导观众）。
 *
 * @since v3.3（task_082）。
 */

import { REPLAY_METRICS, VISUAL_PALETTE } from '../../../core/theme/visual-spec';

import { formatReplayClock, formatReplayDate } from './replay-catalog';

export const REPLAY_CLOCK_TAG = 'strat-replay-clock';

/** 自定义元素的对外形状（组合根与测试按它操作）。 */
export interface StratReplayClockElement extends HTMLElement {
  /** 设置回放时刻；null = 收角标（隐藏）。 */
  setTime(at: number | null): void;
  /** 当前显示的时刻（观察口；null = 隐藏中）。 */
  readonly currentAt: number | null;
  /** 当前是否可见（观察口）。 */
  readonly visible: boolean;
}

export function defineStratReplayClock(): typeof HTMLElement {
  if (customElements.get(REPLAY_CLOCK_TAG)) {
    return customElements.get(REPLAY_CLOCK_TAG) as unknown as typeof HTMLElement;
  }

  class ReplayClock extends HTMLElement implements StratReplayClockElement {
    private _at: number | null = null;
    private _root: HTMLElement | null = null;
    private _time: HTMLElement | null = null;
    private _date: HTMLElement | null = null;

    get currentAt(): number | null {
      return this._at;
    }

    get visible(): boolean {
      return this._at !== null;
    }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `
        <style>
          :host {
            all: initial;
            position: fixed;
            top: var(--replay-clock-inset, 24px);
            left: var(--replay-clock-inset, 24px);
            z-index: 40;
            pointer-events: none;
            font-family: var(--srf-font-ui, system-ui, -apple-system, sans-serif);
          }
          .badge {
            display: none;
            flex-direction: column;
            gap: 2px;
            padding: 10px 16px;
            border-radius: var(--srf-radius, 8px);
            background: var(--srf-panel-overlay, rgba(13, 17, 38, 0.86));
            border: 1px solid var(--srf-visual-accent, ${VISUAL_PALETTE.accent});
            box-shadow: var(--srf-shadow, 0 8px 24px rgba(0, 0, 0, 0.35));
            color: var(--srf-text, #e8ecf4);
          }
          .badge[data-on="1"] { display: flex; }
          .time {
            font-size: var(--replay-clock-font, 44px);
            font-weight: var(--srf-font-weight-bold, 700);
            font-variant-numeric: tabular-nums;
            line-height: 1.05;
            letter-spacing: 0.02em;
            color: var(--srf-visual-accent, ${VISUAL_PALETTE.accent});
          }
          .meta {
            display: flex;
            align-items: baseline;
            gap: 8px;
            font-size: var(--srf-font-size-xs, 11px);
            color: var(--srf-text-muted, #93a0b5);
          }
          .tag { color: var(--srf-visual-accent, ${VISUAL_PALETTE.accent}); font-weight: var(--srf-font-weight-semibold, 600); }
        </style>
        <div class="badge" data-role="badge">
          <span class="time" data-role="time">--:--:--</span>
          <span class="meta">
            <span data-role="date"></span>
            <span class="tag">⏩ 回放中</span>
          </span>
        </div>
      `;
      this._root = root.querySelector('[data-role="badge"]');
      this._time = root.querySelector('[data-role="time"]');
      this._date = root.querySelector('[data-role="date"]');
      this.style.setProperty('--replay-clock-inset', `${REPLAY_METRICS.clockInsetPx}px`);
      this.style.setProperty('--replay-clock-font', `${REPLAY_METRICS.clockFontPx}px`);
      this.apply();
    }

    disconnectedCallback(): void {
      // 无定时器（时刻由外部推），这里只需把状态复位（元素可能被复用）。
      this._at = null;
    }

    setTime(at: number | null): void {
      this._at = at === null ? null : Number.isFinite(at) ? at : null;
      this.apply();
    }

    /** 把状态刷进 DOM（时刻变了才动文本 —— 时间跳变是这枚角标的全部动画）。 */
    private apply(): void {
      const badge = this._root;
      if (!badge) return;
      const on = this._at !== null;
      badge.dataset.on = on ? '1' : '0';
      if (!on || this._at === null) return;
      if (this._time) this._time.textContent = formatReplayClock(this._at);
      if (this._date) this._date.textContent = formatReplayDate(this._at);
    }
  }

  customElements.define(REPLAY_CLOCK_TAG, ReplayClock);
  return ReplayClock as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂（与 mountMarquee / mountMinimap 同一装配口径）：建元素、挂进容器，
 * 返回元素引用 + unmount 闭包。
 */
export function mountReplayClock(
  host: HTMLElement
): { readonly element: StratReplayClockElement; readonly unmount: () => void } {
  defineStratReplayClock();
  const element = document.createElement(REPLAY_CLOCK_TAG) as StratReplayClockElement;
  host.appendChild(element);
  return { element, unmount: () => { element.remove(); } };
}
