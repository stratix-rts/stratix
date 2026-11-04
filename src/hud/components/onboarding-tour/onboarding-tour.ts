/**
 * 文件职责：**轻引导 spotlight**（@since v3.8，task_139）—— 新用户第一次打开时告诉他「从哪开始」：
 *   ① 点命令行试试 → ② 新建一个角色 → ③ 看战场态势。
 * 与既有首启向导（hud/screens/onboarding-screen.ts，建档扫描那套重流程）**分工不重叠**：
 *   向导管「把角色建出来」，本组件管「先教一句从哪开始」。
 * 输入：三步词表（标题 / 一句话 / 目标元素解析口）+ localStorage 一次性标记。
 * 输出：`<strat-onboarding-tour>` 覆盖层（spotlight 挖洞 + 气泡 + 下一步 / 跳过）。
 * 禁止事项：① import core / world / app（组件不认识业务）；② 写死色值（一律 --srf-* token）；
 *   ③ 拦底下界面（蒙层 pointer-events:none，用户可照着提示直接点）；④ 漏写一次性标记。
 */
import { zVar } from '../../theme/layer-tokens';

export const ONBOARDING_TOUR_TAG = 'strat-onboarding-tour';
/** 一次性标记键（localStorage）：写过 = 不再出现（首开只走一次）。 */
export const ONBOARDING_TOUR_DONE_KEY = 'stratix.onboarding.tour.done';
/** 走完 / 跳过时派发（冒泡 + composed，detail.skipped 区分两种收场）。 */
export const ONBOARDING_TOUR_DONE_EVENT = 'strat-onboarding-tour-done';

/** 一步的词表。target 解析不到元素时 → 气泡居中显示，流程照走（不卡住用户）。 */
export interface OnboardingTourStep {
  readonly id: string;
  readonly title: string;
  /** 一句话（函数 = 按当前画面挑措辞，例如「新建角色」按钮在不在）。 */
  readonly text: string | (() => string);
  readonly target: () => Element | null;
}

/** 组件样式表（shadow DOM 内）。全走 --srf-* token；动效只有 ring 一条 transition。 */
const TOUR_STYLE = `
  :host { position: fixed; inset: 0; z-index: ${zVar('spotlight')}; pointer-events: none; font-family: var(--srf-font-ui); }
  :host([hidden]) { display: none; }
  .veil { position: fixed; display: none; background: rgba(0, 0, 0, 0.62); }
  .ring { position: fixed; display: none; box-sizing: border-box; border: var(--srf-border-width) solid var(--srf-accent); border-radius: var(--srf-radius); transition: left var(--srf-transition), top var(--srf-transition), width var(--srf-transition), height var(--srf-transition); }
  .bubble { position: fixed; pointer-events: auto; box-sizing: border-box; width: min(320px, calc(100vw - 24px)); padding: var(--srf-spacing-md); border: var(--srf-border-width) solid var(--srf-border-strong); border-radius: var(--srf-radius); background: var(--srf-panel-elevated); color: var(--srf-text); box-shadow: var(--srf-double-shadow, var(--srf-shadow)); }
  .head { display: flex; align-items: baseline; gap: var(--srf-spacing-xs); }
  .title { font-size: var(--srf-font-size-body, var(--srf-font-size-md)); font-weight: var(--srf-font-weight-bold); }
  .count { margin-left: auto; color: var(--srf-text-muted); font-size: var(--srf-font-size-caption, var(--srf-font-size-xs)); }
  .text { margin: var(--srf-spacing-xs) 0 0; color: var(--srf-text-muted); font-size: var(--srf-font-size-body, var(--srf-font-size-sm)); line-height: 1.6; }
  .foot { display: flex; gap: var(--srf-spacing-xs); margin-top: var(--srf-spacing-md); }
  button { appearance: none; cursor: pointer; padding: var(--srf-spacing-xs) var(--srf-spacing-md); border: var(--srf-border-width) solid var(--srf-border-strong); border-radius: var(--srf-radius); background: var(--srf-panel-overlay); color: var(--srf-text); font-family: inherit; font-size: var(--srf-font-size-body, var(--srf-font-size-sm)); }
  button:hover { border-color: var(--srf-accent); color: var(--srf-accent-hover); }
  button.next { margin-left: auto; border-color: var(--srf-accent); background: var(--srf-accent); color: var(--srf-bg); }
  @media (prefers-reduced-motion: reduce) { .ring { transition: none; } }
`;

/** `<strat-onboarding-tour>`：三步 spotlight 轻引导。 */
export class StratOnboardingTourElement extends HTMLElement {
  /** 三步词表（宿主注入 —— 组件不关心业务目标从哪来）。 */
  steps: readonly OnboardingTourStep[] = [];
  private _index = 0;
  private _ready = false;
  /** 本实例的「已走过」记忆（localStorage 写不进时的兜底 —— 隐私模式下别反复弹）。 */
  private _done = false;

  connectedCallback(): void {
    if (this._ready) return;
    this._ready = true;
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${TOUR_STYLE}</style>
      <div class="veil" data-role="veil-t"></div>
      <div class="veil" data-role="veil-b"></div>
      <div class="veil" data-role="veil-l"></div>
      <div class="veil" data-role="veil-r"></div>
      <div class="ring" data-role="ring"></div>
      <div class="bubble" data-role="bubble" role="dialog">
        <div class="head"><span class="title" data-role="title"></span><span class="count" data-role="count"></span></div>
        <p class="text" data-role="text"></p>
        <div class="foot"><button type="button" data-role="skip">跳过</button><button type="button" class="next" data-role="next">下一步</button></div>
      </div>`;
    root.querySelector('[data-role="next"]')?.addEventListener('click', () => this.next());
    root.querySelector('[data-role="skip"]')?.addEventListener('click', () => this.finish(true));
    this.addEventListener('keydown', this.onKeydown);
    window.addEventListener('resize', this.onResize);
  }

  disconnectedCallback(): void {
    this.removeEventListener('keydown', this.onKeydown);
    window.removeEventListener('resize', this.onResize);
  }

  private onKeydown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') this.finish(true);
  };

  private onResize = (): void => this.layout();

  /** 读一次性标记（真源是 localStorage；本实例的兜底记忆只在存储不可用时生效）。 */
  private isDone(): boolean {
    if (this._done) return true;
    try { return globalThis.localStorage?.getItem(ONBOARDING_TOUR_DONE_KEY) === '1'; } catch { return false; }
  }

  /** 写一次性标记（写不进就只剩本实例记忆 —— 本次会话内不再弹）。 */
  private markDone(): void {
    this._done = true;
    try { globalThis.localStorage?.setItem(ONBOARDING_TOUR_DONE_KEY, '1'); } catch { /* 存储不可用：兜底记忆已生效。 */ }
  }

  /** 开始走三步（宿主决定何时开始 —— 首启向导走完之后）。已走过 = 不出现。 */
  start(): void {
    if (this.isDone() || this.steps.length === 0) return;
    this._index = 0;
    this.hidden = false;
    this.renderStep();
  }

  /** 从宿主上摘掉（宿主在卸载时调）。 */
  unmount(): void {
    this.remove();
  }

  /** 下一步；已是最后一步 → 收场并写一次性标记。 */
  private next(): void {
    if (this._index + 1 >= this.steps.length) {
      this.finish(false);
      return;
    }
    this._index += 1;
    this.renderStep();
  }

  /** 收场：写标记 + 收起 + 派事件（skipped=true 表示中途跳过）。 */
  private finish(skipped: boolean): void {
    this.markDone();
    this.hidden = true;
    this.dispatchEvent(
      new CustomEvent(ONBOARDING_TOUR_DONE_EVENT, { bubbles: true, composed: true, detail: { skipped } })
    );
  }

  /** 渲染当前步的文案 + 位置（spotlight 洞 + 气泡）。 */
  private renderStep(): void {
    const step = this.steps[this._index];
    const root = this.shadowRoot;
    if (!step || !root) return;
    const set = (role: string, text: string): void => {
      const el = root.querySelector(`[data-role="${role}"]`);
      if (el) el.textContent = text;
    };
    set('title', step.title);
    set('text', typeof step.text === 'function' ? step.text() : step.text);
    set('count', `${this._index + 1}/${this.steps.length}`);
    set('next', this._index + 1 >= this.steps.length ? '完成' : '下一步');
    this.layout();
  }

  /** 摆位：目标元素上挖洞（洞里照常可看可点），气泡贴在洞边（下方不够就上方）。 */
  private layout(): void {
    const root = this.shadowRoot;
    const step = this.steps[this._index];
    if (!root || !step) return;
    const bubble = root.querySelector<HTMLElement>('[data-role="bubble"]');
    const ring = root.querySelector<HTMLElement>('[data-role="ring"]');
    const veils = (['t', 'b', 'l', 'r'] as const).map(
      (side) => root.querySelector<HTMLElement>(`[data-role="veil-${side}"]`)
    );
    if (!bubble || !ring || veils.some((v) => !v)) return;
    const rect = step.target()?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      // 目标不在（还没渲染 / 被藏了）→ 不挖洞，气泡居中，流程不中断。
      for (const veil of veils) veil!.style.display = 'none';
      ring.style.display = 'none';
      bubble.style.left = '50%';
      bubble.style.top = '50%';
      bubble.style.transform = 'translate(-50%, -50%)';
      return;
    }
    // 洞 = 目标盒往外扩 4px；四块遮罩分别盖住洞的上 / 下 / 左 / 右。
    // why 不用「超大 box-shadow 挖洞」：Chromium 画不出 spread 100vmax 的阴影（实测整片被丢弃，
    // 画面看着像没有蒙层）—— 四块遮罩是确定画得出来的做法。
    const pad = 4;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x1 = Math.max(0, rect.left - pad);
    const y1 = Math.max(0, rect.top - pad);
    const x2 = Math.min(vw, rect.right + pad);
    const y2 = Math.min(vh, rect.bottom + pad);
    const place = (el: HTMLElement, x: number, y: number, w: number, h: number): void => {
      el.style.display = 'block';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    };
    place(veils[0]!, 0, 0, vw, y1);
    place(veils[1]!, 0, y2, vw, Math.max(0, vh - y2));
    place(veils[2]!, 0, y1, x1, Math.max(0, y2 - y1));
    place(veils[3]!, x2, y1, Math.max(0, vw - x2), Math.max(0, y2 - y1));
    ring.style.display = 'block';
    ring.style.left = `${x1}px`;
    ring.style.top = `${y1}px`;
    ring.style.width = `${Math.max(0, x2 - x1)}px`;
    ring.style.height = `${Math.max(0, y2 - y1)}px`;
    const bubbleH = bubble.offsetHeight || 140;
    const below = rect.bottom + 12;
    bubble.style.transform = 'none';
    bubble.style.top = `${below + bubbleH <= vh ? below : Math.max(12, rect.top - 12 - bubbleH)}px`;
    bubble.style.left = `${Math.min(Math.max(12, rect.left), Math.max(12, vw - 332))}px`;
  }
}

/** 注册组件（幂等）。 */
export function defineOnboardingTour(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(ONBOARDING_TOUR_TAG)) return;
  customElements.define(ONBOARDING_TOUR_TAG, StratOnboardingTourElement);
}

/** 把轻引导挂到宿主（组合根的 HUD 宿主）→ 返回组件本体（自带 start / unmount）。 */
export function mountOnboardingTour(
  host: HTMLElement,
  options: { readonly steps: readonly OnboardingTourStep[] }
): StratOnboardingTourElement {
  defineOnboardingTour();
  const element = document.createElement(ONBOARDING_TOUR_TAG) as StratOnboardingTourElement;
  element.steps = options.steps;
  element.hidden = true;
  host.appendChild(element);
  return element;
}
