/**
 * 文件职责：**事件轨（Z2）** Web Component（`<strat-marquee>`）—— 屏幕左下角的最近 5 条
 *   事件流：图标 + 短句 + 相对时间（刚刚 / N 分钟前），分级配色（完成绿 / 报错红 / 派活蓝 / 里程碑金）。
 *   动效：新消息从左侧滑入（--srf-motion-panel：200ms），旧消息整体下移一行，超出 5 条时最旧一条淡出（同档 200ms）后移除。
 *   来源：docs/DEMO-PLAN.md §6（事件跑马灯）+ §8（演示模式强制开启）；
 *   v3.4 升级依据：docs/hud-redesign-proposal.html §2.5（分区规格表 Z2 行）。
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
 *   条目栈是**定高**容器（行高恒定，底边贴屏幕左下角）：新消息插到栈顶 → 旧条目在流式布局里
 *   整体下移一行；第 6 条进来时最旧一条落到栈底之外并淡出。
 *   「下移」是位移动画：插队后给旧条目一个 translateY(-一行) 的初值（FLIP 的 First），
 *   下一帧撤掉（Last）→ 浏览器用 transition 把它送回新位置。动画时长取自唯一事实源
 *   （入场 / 退场时长统一取 --srf-motion-panel / --srf-motion-panel-exit，见 core/theme/motion-spec.ts）。
 *
 * ============ v3.4 · Z2 事件轨（@since task_091）============
 *   proposal §2.5 Z2 的规格逐条落地：
 *   ① 位置 / 尺寸：左下 fixed，宽 ≤ MARQUEE_METRICS.maxWidthPx（260px）—— 宽度写进 CSS 变量，
 *      栈宽 100%，条目按 flex 拉伸；控制岛（Z4，56% 屏宽贴底居中）在 1280 宽下左缘 22% = 281px，
 *      轨道右缘 = 16 + 260 = 276px → 零重叠。
 *   ② 默认显示 2 条 +「展开 N 条」：折叠态只渲染 MARQUEE_METRICS.collapsedVisible（2）条，
 *      其余条目留在 DOM 里但 display:none（不销毁 —— 展开时原位出现，且条数上限仍由
 *      maxEntries 兜着）；底部一枚「展开 N 条 / 收起」按钮（N = 被藏起来的条数）。
 *   ③ hover 展开详情行：条目内挂一块**绝对定位**的详情板（完整文案 + 相对时间）——
 *      绝对定位 = 不占布局流 → 悬停时下方条目**不挪位**（布局不跳动）；
 *      栈最底下那条的详情翻到条目的**上方**（往下翻会出屏）。
 *   ④ 点击条目发 focus.unit（HudCommand → core → world 通道，world 侧消费在 task_092）：
 *      派发经注入的 dispatch 端口（同 milestone overlay 的相机震动口径），组件自己不碰总线。
 *   ★ 分级配色与出入场动效沿用 task_080 的实现，不动。
 *
 * @since v3.3（task_080）；v3.4（task_091）升级为 Z2 事件轨（折叠 / hover 详情 / 点击联动）。
 */

import { MARQUEE_METRICS } from '../../../core/theme/visual-spec';
import { MOTION_DURATIONS } from '../../../core/theme/motion-spec';
import type { HudCommand } from '../../../core/types';

import {
  formatRelativeTime,
  marqueeToneColor,
  type MarqueeEntry,
} from './marquee-catalog';
import { zVar } from '../../theme/layer-tokens';
import { MOTION_REDUCED_CSS } from '../../theme/motion-tokens';

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

/** 依赖注入：时钟（默认 Date.now）+ 记忆存储（默认 localStorage）+ 命令出口（默认无操作）。 */
export interface MarqueeDeps {
  readonly now?: () => number;
  readonly storage?: () => MarqueeStorage | null;
  /**
   * 命令出口（HUD → core 的唯一合法通道）—— 条目点击时发 focus.unit（带单位 id）。
   * 缺省 = 无出口（此时点击静默无动作，单测与无总线环境都安全）。
   */
  readonly dispatch?: (command: HudCommand) => void;
}

/** 自定义元素的对外形状（组合根与测试按它操作）。 */
export interface StratMarqueeElement extends HTMLElement {
  /** 依赖注入（时钟 / 记忆存储 / 命令出口）—— mount 时挂上，connectedCallback 时生效。 */
  deps?: MarqueeDeps;
  /** 追加一条（新消息从左侧滑入；超出上限时最旧一条淡出）。 */
  push(entry: MarqueeEntry): void;
  /** 强制可见（演示模式开 = true；关 = 回到本地记忆口径）。 */
  setForced(forced: boolean): void;
  /** 展开 / 收起（折叠态显示 collapsedVisible 条，展开态显示全部）。 */
  toggleExpand(): void;
  /** 当前在屏条目（自上而下 = 自新到旧；测试 / 调试观察口）。 */
  readonly entries: readonly MarqueeEntry[];
  /** 当前是否可见。 */
  readonly visible: boolean;
  /** 被强制开启（演示模式）—— 观察口。 */
  readonly forced: boolean;
  /** 是否处于展开态（Z2：默认折叠，只露 2 条）。 */
  readonly expanded: boolean;
  /** 折叠时被藏起来的条数（= 展开按钮上的 N；展开态为 0）。 */
  readonly hiddenCount: number;
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
    /** 展开 / 收起按钮（Z2：折叠时显示「展开 N 条」）。 */
    private _toggle: HTMLButtonElement | null = null;
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
    /** Z2 展开态（缺省折叠：只露 collapsedVisible 条）。 */
    private _expanded = false;

    /** 依赖注入（mount 时挂上）：时钟 / 记忆存储 / 命令出口。 */
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

    get expanded(): boolean {
      return this._expanded;
    }

    get hiddenCount(): number {
      return Math.max(0, this._items.length - this.visibleCount());
    }

    /** 当前可见条数（折叠态 = collapsedVisible，展开态 = 全部）。 */
    private visibleCount(): number {
      if (this._expanded) return this._items.length;
      return Math.min(MARQUEE_METRICS.collapsedVisible, this._items.length);
    }

    connectedCallback(): void {
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `
        <style>
          /* 左下角的事件流：fixed 定位不占布局；不拦事件（pointer-events:none）——
             空白处的拖拽平移 / 框选必须能穿透到战场画布。条目与按钮自己开 pointer-events。 */
          :host {
            all: initial;
            position: fixed;
            left: 16px;
            bottom: 16px;
            z-index: ${zVar('track')};
            pointer-events: none;
            font-family: var(--srf-font-ui, system-ui, -apple-system, sans-serif);
            /* Z2 宽度上限（≤260px，proposal §2.5）—— 数值由 MARQUEE_METRICS 注入。 */
            width: var(--marquee-width, 260px);
            --marquee-row-h: 26px;
            --marquee-gap: 4px;
            --marquee-step: calc(var(--marquee-row-h) + var(--marquee-gap));
          }
          /* 定高栈：可见行数由 --marquee-visible-rows 给（组件按折叠 / 展开态注入）——
             高度恒定，插队时只有条目在动，容器本身不跳。 */
          .stack {
            position: relative;
            display: flex;
            flex-direction: column;
            gap: var(--marquee-gap);
            height: calc(var(--marquee-visible-rows, 2) * var(--marquee-step));
          }
          .entry {
            position: relative;
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
            transition: transform var(--srf-motion-panel);
            animation: marquee-enter var(--srf-motion-panel) both;
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
          /* 最旧一条淡出：绝对定位钉在栈底（不占流 —— 否则会顶开下面的「展开」按钮）。 */
          .entry.leaving { position: absolute; left: 0; right: 0; bottom: 0; animation: marquee-leave var(--srf-motion-panel-exit) both; }
          @keyframes marquee-leave {
            from { opacity: 1; }
            to { opacity: 0; }
          }
          /* Z2 折叠态：超出的条目留在 DOM 里但不出场（展开时原位出现）。 */
          .entry.is-hidden { display: none; }
          /* 可点条目（有关联单位）：指针 + 悬停提亮。
             pointer-events 走自定义属性：条目在**影子树内部**，外层样式表穿不进来 ——
             全屏弹窗开着时要禁掉它们（v3.5 遮挡规则 R1），只能靠自定义属性穿透影子边界
             （由 hud/layers/occlusion.ts 在弹窗时把 --srf-marquee-pe 翻成 none）。 */
          .entry[data-clickable="true"] { pointer-events: var(--srf-marquee-pe, auto); cursor: pointer; }
          .entry[data-clickable="true"]:hover,
          .entry[data-hover="true"] { background: var(--srf-panel-solid, var(--srf-panel-overlay)); }
          /* hover 详情板：绝对定位 → 不占布局流 → 悬停时下方条目不挪位（布局不跳动）。
             opacity / visibility 过渡只动合成属性，不触发布局重排（perf 铁律）。 */
          .detail {
            position: absolute;
            left: 0;
            right: 0;
            top: 100%;
            z-index: ${zVar('localTop')};
            display: flex;
            flex-direction: column;
            gap: 2px;
            margin-top: 3px;
            padding: 6px 8px;
            border: 1px solid var(--entry-color, transparent);
            border-radius: var(--srf-radius, 6px);
            background: var(--srf-panel-overlay);
            color: var(--srf-text);
            font-size: var(--srf-font-size-xs, 11px);
            line-height: 1.45;
            white-space: normal;
            overflow-wrap: anywhere;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            transition: opacity var(--srf-motion-hover);
          }
          .entry[data-hover="true"] .detail { opacity: 1; visibility: visible; }
          /* 栈最底下那条：详情翻到上方（往下翻会出屏）。 */
          .entry[data-detail-above="true"] .detail { top: auto; bottom: 100%; margin-top: 0; margin-bottom: 3px; }
          .detail-time { color: var(--srf-text-muted); }
          /* Z2 折叠 / 展开按钮（同上：开关走自定义属性，弹窗期间禁点）。 */
          .toggle {
            pointer-events: var(--srf-marquee-pe, auto);
            display: block;
            width: 100%;
            margin-top: 4px;
            padding: 3px 8px;
            border: 1px solid var(--srf-border, rgba(255, 255, 255, 0.08));
            border-radius: var(--srf-radius, 6px);
            background: var(--srf-panel-overlay);
            color: var(--srf-text-muted);
            font-family: inherit;
            font-size: var(--srf-font-size-xs, 11px);
            line-height: 1.4;
            text-align: left;
            cursor: pointer;
          }
          .toggle:hover { color: var(--srf-text); }
          .toggle[hidden] { display: none; }
        ${MOTION_REDUCED_CSS}
        </style>
        <div class="stack" data-role="stack" aria-live="polite"></div>
        <button class="toggle" type="button" data-role="toggle" hidden></button>
      `;
      this._stack = root.querySelector('[data-role="stack"]');
      this._toggle = root.querySelector('[data-role="toggle"]');
      this._toggle?.addEventListener('click', () => this.toggleExpand());
      // 条数上限 / 宽度 / 可见行数写进 CSS 变量（唯一事实源 → 样式），不在 CSS 里再抄一份。
      this.style.setProperty('--marquee-width', `${MARQUEE_METRICS.maxWidthPx}px`);
      this._remembered = this.readRemembered();
      this.applyVisibility();
      this.renderRows();
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
      this._toggle = null;
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
      // 详情板（hover 展开）：完整文案 + 相对时间（相对时间随时间刷新，见 startTick）。
      const detail = document.createElement('div');
      detail.className = 'detail';
      detail.setAttribute('data-role', 'detail');
      const detailText = document.createElement('span');
      detailText.className = 'detail-text';
      detailText.textContent = entry.detail ?? entry.text;
      const detailTime = document.createElement('span');
      detailTime.className = 'detail-time';
      detailTime.textContent = formatRelativeTime(entry.at, this.now());
      detail.append(detailText, detailTime);
      node.append(detail);
      // 条目底色按分级取语义色（唯一事实源的七色语义色，经 --srf-visual-* token）。
      node.style.setProperty('--entry-color', marqueeToneColor(entry.kind));
      // 有关联单位才可点（里程碑那条不指向任何单位 → 点了没意义）。
      if (entry.unitId) {
        node.setAttribute('data-clickable', 'true');
        node.setAttribute('role', 'button');
        node.setAttribute('tabindex', '0');
      }
      this.bindEntryEvents(node, entry);
      stack.prepend(node);
      this._items.unshift({ entry, node });
      // 旧条目整体下移一行：先给「旧位置」初值（FLIP 的 First），下一帧撤掉 → transition 送回新位置。
      this.shiftOldEntries();
      this.trimOverflow();
      this.renderRows();
    }

    setForced(forced: boolean): void {
      this._forced = forced;
      this.applyVisibility();
    }

    toggleExpand(): void {
      this._expanded = !this._expanded;
      this.renderRows();
    }

    /** 可见性 = 演示模式强制 or 本地记忆（缺省开启）。 */
    private applyVisibility(): void {
      this.style.display = this.visible ? '' : 'none';
    }

    /**
     * 条目交互接线：hover / 聚焦 → 详情板现身；点击 / 回车 → 发 focus.unit。
     * why 用 JS 事件而不是纯 CSS :hover —— 焦点可达（键盘也能看详情、也能聚焦单位），
     * 且状态可被单测直接断言（jsdom 没有 :hover 状态）。
     */
    private bindEntryEvents(node: HTMLElement, entry: MarqueeEntry): void {
      const show = (): void => node.setAttribute('data-hover', 'true');
      const hide = (): void => node.removeAttribute('data-hover');
      node.addEventListener('mouseenter', show);
      node.addEventListener('mouseleave', hide);
      node.addEventListener('focus', show);
      node.addEventListener('blur', hide);
      node.addEventListener('click', () => this.emitFocus(entry));
      node.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.emitFocus(entry);
        }
      });
    }

    /** 点击条目 → 发 focus.unit（带单位 id）；无关联单位 = 静默无动作。 */
    private emitFocus(entry: MarqueeEntry): void {
      const unitId = entry.unitId;
      if (!unitId) return;
      this.deps.dispatch?.({ type: 'focus.unit', unitId });
    }

    /**
     * 按折叠 / 展开态重排可见性：折叠态只露 collapsedVisible 条，其余条目 display:none；
     * 栈高随可见行数走（定高容器，插队时不跳）；「展开 N 条」按钮按被藏条数改文案。
     */
    private renderRows(): void {
      const visibleCount = this.visibleCount();
      for (const [index, item] of this._items.entries()) {
        item.node.classList.toggle('is-hidden', index >= visibleCount);
      }
      this.style.setProperty('--marquee-visible-rows', String(visibleCount));
      const toggle = this._toggle;
      if (toggle) {
        if (this._expanded) {
          toggle.textContent = '收起';
          toggle.hidden = false;
        } else {
          const hidden = Math.max(0, this._items.length - visibleCount);
          toggle.textContent = `展开 ${hidden} 条`;
          toggle.hidden = hidden === 0;
        }
      }
      this.markDetailAnchor();
    }

    /** 栈最底下那条的详情翻到上方（往下翻会出屏）。 */
    private markDetailAnchor(): void {
      let last: HTMLElement | null = null;
      for (const item of this._items) {
        if (item.node.classList.contains('is-hidden')) continue;
        last = item.node;
      }
      for (const item of this._items) {
        item.node.removeAttribute('data-detail-above');
      }
      if (last) last.setAttribute('data-detail-above', 'true');
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

    /** 超出条数上限：最旧一条淡出（--srf-motion-panel-exit：200ms）后移除 —— 与 CSS 退场动效同拍。 */
    private trimOverflow(): void {
      while (this._items.length > MARQUEE_METRICS.maxEntries) {
        const oldest = this._items.pop();
        if (!oldest) break;
        oldest.node.classList.add('leaving');
        oldest.node.setAttribute('data-leaving', 'true');
        const timer = setTimeout(() => {
          this._leaving.delete(oldest.node);
          oldest.node.remove();
        }, MOTION_DURATIONS.base);
        this._leaving.set(oldest.node, timer);
      }
    }

    /** 相对时间刷新（秒级变化才看得出来，5s 一跳足够）。 */
    private startTick(): void {
      if (this._tick !== null) return;
      this._tick = setInterval(() => {
        const now = this.now();
        for (const item of this._items) {
          const label = formatRelativeTime(item.entry.at, now);
          const time = item.node.querySelector('.time');
          if (time) time.textContent = label;
          const detailTime = item.node.querySelector('.detail-time');
          if (detailTime) detailTime.textContent = label;
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
  // 依赖注入：时钟、记忆存储与命令出口（测试用假实现，避免真 localStorage 串味）。
  element.deps = deps;
  host.appendChild(element);
  // 移除元素触发 disconnectedCallback → 计时器清光。
  return { element, unmount: () => { element.remove(); } };
}
