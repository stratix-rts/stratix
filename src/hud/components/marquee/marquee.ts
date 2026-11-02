/**
 * 文件职责：**事件跑马灯** Web Component（`<strat-marquee>`，task_080）—— 屏幕左下角的最近 5 条
 *   事件流：图标 + 短句 + 相对时间（刚刚 / N 分钟前），分级配色（完成绿 / 报错红 / 派活蓝 / 里程碑金）。
 *   动效：新消息从左侧滑入（250ms），旧消息整体下移一行，超出 5 条时最旧一条淡出（300ms）后移除。
 *   来源：docs/DEMO-PLAN.md §6（事件跑马灯）+ §8（演示模式强制开启）。
 * 输入：push(entry) 的显式调用（组合根订阅 core 总线后喂进来 —— hud 组件只被驱动、不订阅总线，
 *   与 toast-host / sfx-service 同一装配口径）；setForced() 由组合根按演示模式开关调用。
 * 输出：fixed 定位的 Shadow DOM 条目栈（视觉全部由代码绘制，零资产文件）。
 * 禁止事项：
 *   1. import world/、phaser、app/、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— 事件订阅与命令派发一律经组合根注入（本组件零订阅零派发）；
 *   3. 正文走 innerHTML —— 角色名 / 任务名是外部输入，一律 textContent 直写（XSS 面为零）；
 *   4. 硬编码色值 —— 颜色走 --srf-visual-* token（唯一事实源注入），兜底色取自同一份色表；
 *   5. 泄漏定时器 —— 淡出计时器与时间刷新定时器都必须在 disconnectedCallback 清光（perf 硬约束）；
 *   6. 让条数无限增长 —— 条数上限来自 MARQUEE_METRICS.maxEntries，超出即淡出最旧一条。
 *
 * ============ 布局与「旧消息下移」============
 *   条目栈是**定高**容器（5 行高，底边贴屏幕左下角）：新消息插到栈顶 → 旧条目在流式布局里
 *   整体下移一行；第 6 条进来时最旧一条落到栈底之外并淡出。
 *   「下移」是位移动画：插队后给旧条目一个 translateY(-一行) 的初值（FLIP 的 First），
 *   下一帧撤掉（Last）→ 浏览器用 transition 把它送回新位置。动画时长取自唯一事实源
 *   （MARQUEE_METRICS.enterDurationMs = 250ms）。
 *
 * @since v3.3（task_080）。
 */

import { MARQUEE_METRICS } from '../../../core/theme/visual-spec';
import {
  formatRelativeTime,
  marqueeToneColor,
  type MarqueeEntry,
} from './marquee-catalog';

export const MARQUEE_TAG = 'strat-marquee';

/**
 * 可见性记忆键（正常模式下的开关口径；值 'on' / 'off'）。
 * 演示模式开启时**强制**可见（见 setForced）—— 演示的脸不能被这条记忆关掉。
 */
export const MARQUEE_ENABLED_KEY = 'stratix.marquee.enabled';

/** 相对时间刷新间隔（ms）：秒级无意义，5s 一跳够用（一次刷新只改 ≤5 个文本节点）。 */
const TIME_TICK_MS = 5000;

/** localStorage 的最小面（便于单测注入内存实现）。 */
export interface MarqueeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 依赖注入：时钟（默认 Date.now）+ 记忆存储（默认 localStorage）。 */
export interface MarqueeDeps {
  readonly now?: () => number;
  readonly storage?: () => MarqueeStorage | null;
}

/** 自定义元素的对外形状（组合根与测试按它操作）。 */
export interface StratMarqueeElement extends HTMLElement {
  /** 依赖注入（时钟 / 记忆存储）—— mount 时挂上，connectedCallback 时生效。 */
  deps?: MarqueeDeps;
  /** 追加一条（新消息从左侧滑入；超出上限时最旧一条淡出）。 */
  push(entry: MarqueeEntry): void;
  /** 强制可见（演示模式开 = true；关 = 回到本地记忆口径）。 */
  setForced(forced: boolean): void;
  /** 当前在屏条目（自上而下 = 自新到旧；测试 / 调试观察口）。 */
  readonly entries: readonly MarqueeEntry[];
  /** 当前是否可见。 */
  readonly visible: boolean;
  /** 被强制开启（演示模式）—— 观察口。 */
  readonly forced: boolean;
}

/** 默认取 localStorage（浏览器全局；不存在时返回 null）。 */
function defaultStorage(): MarqueeStorage | null {
  try {
    const store = (globalThis as { localStorage?: MarqueeStorage }).localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

/**
 * 工厂：注册 `<strat-marquee>`。
 * 幂等（与 defineToastHost / defineStratMinimap 同约定）：重复 register 返回已注册构造器。
 */
export function defineStratMarquee(): typeof HTMLElement {
  if (customElements.get(MARQUEE_TAG)) {
    return customElements.get(MARQUEE_TAG) as unknown as typeof HTMLElement;
  }

  class Marquee extends HTMLElement implements StratMarqueeElement {
    private _stack: HTMLElement | null = null;
    /** 在屏条目（自上而下 = 自新到旧）。 */
    private _items: { entry: MarqueeEntry; node: HTMLElement }[] = [];
    /** 淡出计时器（节点 → 计时器）：离场时必须清光。 */
    private readonly _leaving = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    /** 相对时间刷新定时器。 */
    private _tick: ReturnType<typeof setInterval> | null = null;
    /** 演示模式强制开启。 */
    private _forced = false;
    /** 本地记忆的可见性（缺省开启）。 */
    private _remembered = true;

    /** 依赖注入（mount 时挂上）：时钟 / 记忆存储。 */
    get deps(): MarqueeDeps {
      return (this as unknown as { _deps?: MarqueeDeps })._deps ?? {};
    }

    set deps(value: MarqueeDeps) {
      (this as unknown as { _deps?: MarqueeDeps })._deps = value;
    }

    /** 当前时钟（注入优先，缺省 Date.now）。 */
    private now(): number {
      return this.deps.now ? this.deps.now() : Date.now();
    }

    /** 当前记忆存储（注入优先，缺省 localStorage）。 */
    private storage(): MarqueeStorage | null {
      return this.deps.storage ? this.deps.storage() : defaultStorage();
    }

    get entries(): readonly MarqueeEntry[] {
      return this._items.map((item) => item.entry);
    }

    get visible(): boolean {
      return this._forced || this._remembered;
    }

    get forced(): boolean {
      return this._forced;
    }

    connectedCallback(): void {
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `
        <style>
          /* 左下角的事件流：fixed 定位不占布局；不拦事件（pointer-events:none）——
             空白处的拖拽平移 / 框选必须能穿透到战场画布。 */
          :host {
            all: initial;
            position: fixed;
            left: 16px;
            bottom: 16px;
            z-index: 21;
            pointer-events: none;
            font-family: var(--srf-font-ui, system-ui, -apple-system, sans-serif);
            --marquee-row-h: 26px;
            --marquee-gap: 4px;
            --marquee-step: calc(var(--marquee-row-h) + var(--marquee-gap));
          }
          /* 定高栈：条数上限由 --marquee-rows 给（组件按 MARQUEE_METRICS 注入）——
             高度恒定，插队时只有条目在动，容器本身不跳。 */
          .stack {
            display: flex;
            flex-direction: column;
            gap: var(--marquee-gap);
            height: calc(var(--marquee-rows) * var(--marquee-step));
          }
          .entry {
            display: flex;
            align-items: center;
            gap: 8px;
            box-sizing: border-box;
            height: var(--marquee-row-h);
            padding: 0 10px;
            border-radius: var(--srf-radius, 6px);
            border-left: 3px solid var(--entry-color, transparent);
            background: var(--srf-panel-overlay);
            color: var(--entry-color, var(--srf-text));
            font-size: var(--srf-font-size-sm, 12px);
            line-height: 1;
            white-space: nowrap;
            overflow: hidden;
            transition: transform 250ms cubic-bezier(0.22, 1, 0.36, 1);
            animation: marquee-enter 250ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }
          /* 分级色不写在这里 —— 由 push() 按 MARQUEE_TONE_KEYS 从唯一事实源取，
             写成行内 --entry-color（见 marquee-catalog.ts 的 marqueeToneColor）。
             why 不在 CSS 里再抄一份色值：色值只有 core/theme/visual-spec.ts 一处。 */
          .icon { flex: none; }
          .text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
          .time { flex: none; color: var(--srf-text-muted); font-size: var(--srf-font-size-xs, 11px); }
          @keyframes marquee-enter {
            from { opacity: 0; transform: translateX(-18px); }
            to { opacity: 1; transform: translateX(0); }
          }
          /* 最旧一条淡出：留在原位淡掉（随后被移除）。 */
          .entry.leaving { animation: marquee-leave 300ms ease-in both; }
          @keyframes marquee-leave {
            from { opacity: 1; }
            to { opacity: 0; }
          }
        </style>
        <div class="stack" data-role="stack" aria-live="polite"></div>
      `;
      this._stack = root.querySelector('[data-role="stack"]');
      // 条数上限写进 CSS 变量（唯一事实源 → 样式），不在 CSS 里再抄一份 5。
      this.style.setProperty('--marquee-rows', String(MARQUEE_METRICS.maxEntries));
      this._remembered = this.readRemembered();
      this.applyVisibility();
      this.startTick();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：元素离场时清光淡出计时器与时间刷新定时器。
      for (const timer of this._leaving.values()) clearTimeout(timer);
      this._leaving.clear();
      if (this._tick !== null) {
        clearInterval(this._tick);
        this._tick = null;
      }
      this._items = [];
      this._stack = null;
    }

    push(entry: MarqueeEntry): void {
      const stack = this._stack;
      if (!stack) return; // 未连接（理论上组合根挂载后才会被调）：安全跳过
      if (!this.visible) return; // 被关掉时不渲染（演示模式强制开启时不走这条）
      const node = document.createElement('div');
      node.className = 'entry';
      node.setAttribute('data-kind', entry.kind);
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = entry.icon;
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = entry.text;
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = formatRelativeTime(entry.at, this.now());
      node.append(icon, text, time);
      // 条目底色按分级取语义色（唯一事实源的七色语义色，经 --srf-visual-* token）。
      node.style.setProperty('--entry-color', marqueeToneColor(entry.kind));
      stack.prepend(node);
      this._items.unshift({ entry, node });
      // 旧条目整体下移一行：先给「旧位置」初值（FLIP 的 First），下一帧撤掉 → transition 送回新位置。
      this.shiftOldEntries();
      this.trimOverflow();
    }

    setForced(forced: boolean): void {
      this._forced = forced;
      this.applyVisibility();
    }

    /** 可见性 = 演示模式强制 or 本地记忆（缺省开启）。 */
    private applyVisibility(): void {
      this.style.display = this.visible ? '' : 'none';
    }

    /** 读本地记忆（缺省开启；读不到 = 开启）。 */
    private readRemembered(): boolean {
      const store = this.storage();
      if (!store) return true;
      try {
        return store.getItem(MARQUEE_ENABLED_KEY) !== 'off';
      } catch {
        return true;
      }
    }

    /** 旧条目下移一行（FLIP：先瞬移回旧位置，下一帧再撤掉位移交给 transition）。 */
    private shiftOldEntries(): void {
      const olds = this._items.slice(1);
      if (olds.length === 0) return;
      for (const item of olds) {
        item.node.style.transition = 'none';
        item.node.style.transform = 'translateY(calc(-1 * var(--marquee-step)))';
      }
      // 下一帧撤掉初值：浏览器用 transition 把旧条目送到下移后的新位置。
      const raf = globalThis.requestAnimationFrame;
      if (typeof raf !== 'function') {
        for (const item of olds) {
          item.node.style.transition = '';
          item.node.style.transform = '';
        }
        return;
      }
      raf(() => {
        for (const item of olds) {
          item.node.style.transition = '';
          item.node.style.transform = '';
        }
      });
    }

    /** 超出条数上限：最旧一条淡出（300ms）后移除。 */
    private trimOverflow(): void {
      while (this._items.length > MARQUEE_METRICS.maxEntries) {
        const oldest = this._items.pop();
        if (!oldest) break;
        oldest.node.classList.add('leaving');
        oldest.node.setAttribute('data-leaving', 'true');
        const timer = setTimeout(() => {
          this._leaving.delete(oldest.node);
          oldest.node.remove();
        }, MARQUEE_METRICS.exitDurationMs);
        this._leaving.set(oldest.node, timer);
      }
    }

    /** 相对时间刷新（秒级变化才看得出来，5s 一跳足够）。 */
    private startTick(): void {
      if (this._tick !== null) return;
      this._tick = setInterval(() => {
        const now = this.now();
        for (const item of this._items) {
          const time = item.node.querySelector('.time');
          if (time) time.textContent = formatRelativeTime(item.entry.at, now);
        }
      }, TIME_TICK_MS);
    }
  }

  customElements.define(MARQUEE_TAG, Marquee);
  return Marquee as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：本仓库面板的统一装配口径（与 mountToastHost / mountMinimap 一致）——
 *   建元素、挂进容器，返回元素引用 + unmount 闭包。
 */
export function mountMarquee(
  host: HTMLElement,
  deps: MarqueeDeps = {}
): {
  readonly element: StratMarqueeElement;
  readonly unmount: () => void;
} {
  defineStratMarquee();
  const element = document.createElement(MARQUEE_TAG) as StratMarqueeElement;
  // 依赖注入：时钟与记忆存储（测试用假实现，避免真 localStorage 串味）。
  element.deps = deps;
  host.appendChild(element);
  // 移除元素触发 disconnectedCallback → 计时器清光。
  return { element, unmount: () => { element.remove(); } };
}
