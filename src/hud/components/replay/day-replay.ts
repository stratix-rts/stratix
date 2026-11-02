/**
 * 文件职责：**当日回放**的底部时间轴 Web Component（`<strat-day-replay>`，task_082）——
 *   一条缩略热力条（单位密度）+ 可拖动的 scrubber + 「▶ 60 秒看完今天」按钮 + 空态提示。
 *   来源：docs/DEMO-PLAN.md §9（底部时间轴 scrubber / 缩略热力条 / 60 秒看完今天）。
 * 输入：回放控制器（组合根注入；组件只被驱动 —— 它自己不知道数据从哪来）。
 * 输出：Shadow DOM 里的热力条 + 游标 + 按钮；交互经控制器出口（seek / play）落地。
 * 禁止事项：
 *   1. import world / phaser / app / core/bus —— 铁律：hud 只认识 core；
 *   2. 自己读库 —— 数据由控制器经读取口拿（组件零 IO）；
 *   3. 用 innerHTML 写正文 —— 任务短句是外部输入，一律 textContent（XSS 面为零）；
 *   4. 硬编码色值 —— 颜色走 --srf-visual-* token（唯一事实源注入），兜底色取自同一份色表；
 *   5. 拖动时逐帧全量重画 —— 拖动只改游标位置与一段文本（perf：热力条只在数据变化时重建）。
 *
 * @since v3.3（task_082）。
 */

import { REPLAY_METRICS, VISUAL_PALETTE } from '../../../core/theme/visual-spec';

import {
  REPLAY_EMPTY_TEXT,
  REPLAY_ERROR_TEXT,
  REPLAY_ICONS,
  formatReplayClock,
  replayHeatBuckets,
  replayRatio,
  replaySpan,
  replayTimeAt,
  type DayReplayEntry,
} from './replay-catalog';
import type { ReplayController, ReplayState } from './replay-controller';

export const DAY_REPLAY_TAG = 'strat-day-replay';

/** 组件对外形状（组合根与测试按它操作）。 */
export interface StratDayReplayElement extends HTMLElement {
  /** 回放控制器（组合根注入；null = 没有回放口 → 组件显示空态）。 */
  controller?: ReplayController | null;
  /** 当前渲染的条目数（观察口）。 */
  readonly entryCount: number;
  /** 当前是否在自动倍速播放（观察口）。 */
  readonly playing: boolean;
}

/**
 * 热力条的数据指纹（条目条数 + 首末时刻）。
 * why 不用整条数据的哈希：60 秒模式每次推状态都要算一次指纹 —— 这儿要的是
 *   「数据变了没有」的**廉价判据**，不是密码学摘要（首末时刻 + 条数足够）。
 */
function heatSignature(entries: readonly DayReplayEntry[]): string {
  if (entries.length === 0) return '';
  const first = entries[0];
  const last = entries[entries.length - 1];
  return `${entries.length}:${first?.at ?? 0}:${last?.at ?? 0}`;
}

export function defineStratDayReplay(): typeof HTMLElement {
  if (customElements.get(DAY_REPLAY_TAG)) {
    return customElements.get(DAY_REPLAY_TAG) as unknown as typeof HTMLElement;
  }

  class DayReplay extends HTMLElement implements StratDayReplayElement {
    private _controller: ReplayController | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _entries: readonly DayReplayEntry[] = [];
    private _cursorAt: number | null = null;
    private _playing = false;
    /** 热力条容器（重建时整段换掉 —— 数据变了才重建，不是每帧）。 */
    private _heat: HTMLElement | null = null;
    private _handle: HTMLElement | null = null;
    private _empty: HTMLElement | null = null;
    private _clock: HTMLElement | null = null;
    private _count: HTMLElement | null = null;
    private _button: HTMLButtonElement | null = null;
    private _strip: HTMLElement | null = null;
    /**
     * 热力条的数据指纹（条目条数 + 首末时刻）：指纹不变 = 数据没变 = **不重建热力条**。
     * why：60 秒模式每一拍都会推一次状态（游标在走）—— 每次重建 96 根柱子就是纯浪费
     *   （perf 硬约束；拖动时同理）。
     */
    private _heatSignature = '';
    /** 拖动态（指针按下 → 移动 → 松开）。 */
    private _dragging = false;

    get controller(): ReplayController | null {
      return this._controller;
    }

    set controller(value: ReplayController | null) {
      this._controller = value;
      this.bindController();
    }

    get entryCount(): number {
      return this._entries.length;
    }

    get playing(): boolean {
      return this._playing;
    }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `
        <style>
          :host {
            all: initial;
            display: block;
            box-sizing: border-box;
            padding: 6px 10px;
            font-family: var(--srf-font-ui, system-ui, -apple-system, sans-serif);
            color: var(--srf-text);
          }
          .row { display: flex; align-items: center; gap: 10px; }
          .title { flex: none; font-size: var(--srf-font-size-xs, 11px); color: var(--srf-text-muted); letter-spacing: 0.04em; }
          .clock {
            flex: none;
            font-size: var(--srf-font-size-md, 14px);
            font-variant-numeric: tabular-nums;
            color: var(--srf-visual-accent, ${VISUAL_PALETTE.accent});
            min-width: 62px;
          }
          .count { flex: none; font-size: var(--srf-font-size-xs, 11px); color: var(--srf-text-muted); font-variant-numeric: tabular-nums; }
          /* 热力条：单位密度（每桶在场过的角色数）。可拖动 —— pointer-events 由宿主自接。 */
          .strip {
            position: relative;
            flex: 1 1 auto;
            height: var(--replay-strip-h, 30px);
            min-width: 120px;
            border-radius: var(--srf-radius, 6px);
            background: var(--srf-panel, rgba(13, 17, 38, 0.8));
            border: 1px solid var(--srf-border, rgba(255, 255, 255, 0.08));
            overflow: hidden;
            cursor: ew-resize;
            touch-action: none;
          }
          .heat { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 1px; }
          .bar { flex: 1 1 0; min-width: 0; background: var(--srf-visual-unit, ${VISUAL_PALETTE.unit}); border-radius: 1px 1px 0 0; }
          .handle {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 2px;
            background: var(--srf-visual-accent, ${VISUAL_PALETTE.accent});
            box-shadow: 0 0 6px var(--srf-visual-accent, ${VISUAL_PALETTE.accent});
            transform: translateX(-1px);
            pointer-events: none;
          }
          .empty {
            flex: 1 1 auto;
            font-size: var(--srf-font-size-xs, 11px);
            color: var(--srf-text-muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .play {
            flex: none;
            font: inherit;
            font-size: var(--srf-font-size-xs, 11px);
            padding: 4px 10px;
            border-radius: var(--srf-radius-pill, 999px);
            border: 1px solid var(--srf-visual-accent, ${VISUAL_PALETTE.accent});
            background: transparent;
            color: var(--srf-visual-accent, ${VISUAL_PALETTE.accent});
            cursor: pointer;
            white-space: nowrap;
          }
          .play[disabled] { opacity: 0.4; cursor: not-allowed; }
          .play:hover:not([disabled]) { background: color-mix(in srgb, var(--srf-visual-accent, ${VISUAL_PALETTE.accent}) 15%, transparent); }
        </style>
        <div class="row">
          <span class="title">今日回放</span>
          <span class="clock" data-role="clock">--:--:--</span>
          <span class="count" data-role="count"></span>
          <div class="strip" data-role="strip">
            <div class="heat" data-role="heat"></div>
            <div class="handle" data-role="handle" style="left: 0"></div>
          </div>
          <span class="empty" data-role="empty" hidden></span>
          <button class="play" type="button" data-role="play" disabled>▶ 60 秒看完今天</button>
        </div>
      `;
      this._heat = root.querySelector('[data-role="heat"]');
      this._handle = root.querySelector('[data-role="handle"]');
      this._empty = root.querySelector('[data-role="empty"]');
      this._clock = root.querySelector('[data-role="clock"]');
      this._count = root.querySelector('[data-role="count"]');
      this._button = root.querySelector('[data-role="play"]');
      this._strip = root.querySelector('[data-role="strip"]');

      this.style.setProperty('--replay-strip-h', `${Math.round(REPLAY_METRICS.stripHeightPx * 0.55)}px`);

      this._button?.addEventListener('click', this.onPlayClick);
      this._strip?.addEventListener('pointerdown', this.onPointerDown);
      this._strip?.addEventListener('pointermove', this.onPointerMove);
      this._strip?.addEventListener('pointerup', this.onPointerUp);
      this._strip?.addEventListener('pointercancel', this.onPointerUp);

      this.bindController();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：退订 + 解事件（元素离场后不该再被控制器回调）。
      this._unsubscribe?.();
      this._unsubscribe = null;
      this._button?.removeEventListener('click', this.onPlayClick);
      this._strip?.removeEventListener('pointerdown', this.onPointerDown);
      this._strip?.removeEventListener('pointermove', this.onPointerMove);
      this._strip?.removeEventListener('pointerup', this.onPointerUp);
      this._strip?.removeEventListener('pointercancel', this.onPointerUp);
      this._dragging = false;
    }

    /** 绑定控制器（换控制器时先退订旧的）。 */
    private bindController(): void {
      this._unsubscribe?.();
      this._unsubscribe = null;
      if (!this._controller) {
        this.render({ entries: [], loaded: false, failed: false, cursorAt: null, playing: false });
        return;
      }
      this._unsubscribe = this._controller.subscribe((state) => this.render(state));
    }

    /** 渲染（状态变化时调；热力条只在条目变了才重建）。 */
    private render(state: ReplayState): void {
      this._entries = state.entries;
      this._cursorAt = state.cursorAt;
      this._playing = state.playing;

      const hasData = state.entries.length > 0;
      if (this._empty) {
        this._empty.hidden = hasData;
        // 读不到与今天没活儿是两回事 —— 说清楚，别装成空数据。
        this._empty.textContent = state.failed ? REPLAY_ERROR_TEXT : REPLAY_EMPTY_TEXT;
      }
      if (this._strip) this._strip.style.display = hasData ? '' : 'none';
      if (this._count) {
        this._count.textContent = hasData ? `${state.entries.length} 条` : '';
      }
      if (this._clock) {
        this._clock.textContent =
          state.cursorAt === null ? '--:--:--' : formatReplayClock(state.cursorAt);
      }
      if (this._button) {
        this._button.disabled = !hasData;
        this._button.textContent = state.playing ? '⏸ 停下' : '▶ 60 秒看完今天';
      }

      if (hasData) this.renderHeat(state.entries);
      // 数据清空 → 指纹作废（下次有数据时热力条一定重建 —— 宁可多画一次，不留旧画面）。
      else this._heatSignature = '';
      this.renderHandle();
    }

    /**
     * 热力条重建（**数据变了才做** —— 不是每帧、也不是每拍）。
     * 指纹 = 条目条数 + 首末时刻：拖动时数据不变（只是游标在走）→ 不重建。
     */
    private renderHeat(entries: readonly DayReplayEntry[]): void {
      const heat = this._heat;
      if (!heat) return;
      const signature = heatSignature(entries);
      if (signature === this._heatSignature) return;
      this._heatSignature = signature;
      const span = replaySpan(entries);
      if (!span) {
        heat.innerHTML = '';
        return;
      }
      const counts = replayHeatBuckets(entries, span, REPLAY_METRICS.heatBuckets);
      const max = counts.reduce((acc, value) => (value > acc ? value : acc), 0);
      const fragment = document.createDocumentFragment();
      for (const count of counts) {
        const bar = document.createElement('div');
        bar.className = 'bar';
        // 高度按密度比例（最大的一格满格；没有密度 = 0 高度，热力条留白）。
        const ratio = max > 0 ? count / max : 0;
        bar.style.height = `${Math.round(ratio * 100)}%`;
        bar.style.opacity = count > 0 ? String(0.35 + ratio * 0.65) : '0.12';
        fragment.appendChild(bar);
      }
      heat.innerHTML = '';
      heat.appendChild(fragment);
    }

    /** 游标位置（按当前播放时刻占活跃时段的比例）。 */
    private renderHandle(): void {
      const handle = this._handle;
      if (!handle) return;
      const span = replaySpan(this._entries);
      if (!span || this._cursorAt === null) {
        handle.style.left = '0';
        return;
      }
      handle.style.left = `${Math.round(replayRatio(this._cursorAt, span) * 100)}%`;
    }

    // ==========================================================================
    // 交互
    // ==========================================================================

    private onPlayClick = (): void => {
      const controller = this._controller;
      if (!controller) return;
      if (this._playing) controller.stop();
      else controller.play();
    };

    /**
     * 指针按下：起拖 + 立刻定位到按下处（点哪就跳到哪）。
     *
     * why 不监听 pointerleave：按下时已经 setPointerCapture —— 指针移出条外时事件仍然
     *   落在条上（capture 生效），而 pointerleave 在指针越过边界时照样会触发（capture 目标
     *   同样收得到）—— 拿它当「松手」会让拖到一半的 scrubber 提前松手。松手只认
     *   pointerup / pointercancel。
     */
    private onPointerDown = (event: PointerEvent): void => {
      if (!this._controller) return;
      this._dragging = true;
      this._strip?.setPointerCapture?.(event.pointerId);
      this.seekFromPointer(event);
    };

    private onPointerMove = (event: PointerEvent): void => {
      if (!this._dragging) return;
      this.seekFromPointer(event);
    };

    private onPointerUp = (event: PointerEvent): void => {
      if (!this._dragging) return;
      this._dragging = false;
      this._strip?.releasePointerCapture?.(event.pointerId);
      this.seekFromPointer(event);
    };

    /** 指针位置 → 时刻 → 定位（拖动重演）。 */
    private seekFromPointer(event: PointerEvent): void {
      const controller = this._controller;
      const strip = this._strip;
      if (!controller || !strip) return;
      const entries = controller.state.entries;
      const span = replaySpan(entries);
      if (!span) return;
      const rect = strip.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = (event.clientX - rect.left) / rect.width;
      controller.seek(replayTimeAt(ratio, span));
    }
  }

  customElements.define(DAY_REPLAY_TAG, DayReplay);
  return DayReplay as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂（与 mountMarquee / mountMinimap 同一装配口径）：建元素、挂进容器，
 * 返回元素引用 + unmount 闭包。
 */
export function mountDayReplay(
  host: HTMLElement,
  deps: { readonly controller: ReplayController | null }
): { readonly element: StratDayReplayElement; readonly unmount: () => void } {
  defineStratDayReplay();
  const element = document.createElement(DAY_REPLAY_TAG) as StratDayReplayElement;
  element.controller = deps.controller;
  host.appendChild(element);
  return { element, unmount: () => { element.remove(); } };
}

export { REPLAY_ICONS };
