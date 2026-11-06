/**
 * 文件职责：HUD 通用按钮基类（Web Component）—— 全部视觉属性走 CSS 变量，组件零硬编码样式。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 screens/widgets 层级 + §3 token 体系。
 * 输入：HTML 属性 `label` / `icon` / `variant` / `disabled` / `aria-label` / `aria-pressed`；
 *      用户点击事件（click）。
 * 输出：标准 `<button>` 子树（Shadow DOM 内）+ CustomEvent `strat-button-click`。
 * 禁止事项：
 *   1. 硬编码任何颜色 / 字体 / 边框 / 圆角 —— 全部走 var(--srf-*)；
 *   2. 引入 Vue / React / 任何 UI 库 —— 原生 CustomElement + Shadow DOM；
 *   3. 直接调 core/bus —— 按钮只发 DOM 事件，业务语义由父级 main-screen 经 bus-adapter 转发；
 *   4. 阻塞主线程 —— Shadow DOM 同步 build，注册动作必须是副作用幂等（重复 register 不许报错）。
 *
 * ============ 图标与微交互（@since v3.6，task_121）============
 *   - `icon` 属性：挂图标名（widgets/icon-set.ts 的 IconName）→ 渲染 inline SVG。
 *     **顶栏的 emoji（🔊 / 🎬 / ▶ / ⋯）就是被它替掉的** —— emoji 是字形不是图标，
 *     跟"描边线条风"对不上（见 icon-set.ts 文件头）。
 *   - `label` 为空 + 有 `icon` = 纯图标钮（顶栏四件）；两者都有 = 图标 + 文字（菜单项）。
 *   - hover / active / disabled 三态走 CSS（不写 JS）：hover 变色 + 上浮 1px，
 *     active 压回去，disabled 半透 —— 这是"DOM 层零微交互"的底线补丁。
 *
 * 使用：
 *   const btn = document.createElement('strat-button');
 *   btn.setAttribute('label', '提交');
 *   btn.setAttribute('variant', 'primary');
 *   btn.addEventListener('strat-button-click', () => adapter.dispatch({...}));
 *   document.body.appendChild(btn);
 */

import { MOTION_REDUCED_CSS } from '../theme/motion-tokens';

import { iconSvg, isIconName } from './icon-set';

export const STRAT_BUTTON_TAG = 'strat-button';

/** 按钮语义变体；具体颜色全部由 token 决定，本组件不写颜色字面量。 */
export type StratButtonVariant = 'default' | 'primary' | 'danger';

interface StratButtonAttrs {
  label: string;
  /** 图标名（widgets/icon-set.ts 的 IconName）；null = 无图标。 */
  icon: string | null;
  variant: StratButtonVariant;
  disabled: boolean;
  /** 无障碍名（@since v3.4，task_089；@since v3.6 task_121 改为纯图标钮后更关键）：
   *  纯图标按钮（🔊 / 🎬 / ▶ / ⋯ 的 SVG 版）没有可见文字，读屏需要一个真正的名字 ——
   *  由宿主透传到内部 <button> 的 aria-label。 */
  ariaLabel: string | null;
  /** 开关态（@since v3.4，task_089）：true / false / null（非开关）。
   *  「开关点亮即状态」的可访问口径：视觉用 variant，点亮态用 aria-pressed。 */
  ariaPressed: string | null;
}

const DEFAULT_ATTRS: StratButtonAttrs = {
  label: '',
  icon: null,
  variant: 'default',
  disabled: false,
  ariaLabel: null,
  ariaPressed: null,
};

/**
 * 工厂：构造 StratButton 类。
 * 用 defineOnce 包装避免重复注册（hot-reload / 多次 import 场景）；返回元素构造器。
 */
export function defineStratButton(): typeof HTMLElement {
  if (customElements.get(STRAT_BUTTON_TAG)) {
    return customElements.get(STRAT_BUTTON_TAG) as unknown as typeof HTMLElement;
  }

  class StratButton extends HTMLElement {
    private _attrs: StratButtonAttrs = { ...DEFAULT_ATTRS };

    static get observedAttributes(): readonly string[] {
      return ['label', 'icon', 'variant', 'disabled', 'aria-label', 'aria-pressed'];
    }

    connectedCallback(): void {
      // 幂等：开发期 hot-reload 会重复进入 connectedCallback，必须清空重建。
      this.attachShadow({ mode: 'open' });
      this.render();
    }

    attributeChangedCallback(_name: string, oldVal: string | null, newVal: string | null): void {
      if (oldVal === newVal) return;
      this._attrs = {
        label: this.getAttribute('label') ?? DEFAULT_ATTRS.label,
        icon: this.getAttribute('icon'),
        variant: (this.getAttribute('variant') as StratButtonVariant) ?? DEFAULT_ATTRS.variant,
        disabled: this.hasAttribute('disabled'),
        ariaLabel: this.getAttribute('aria-label'),
        ariaPressed: this.getAttribute('aria-pressed'),
      };
      if (this.isConnected) this.render();
    }

    private render(): void {
      const root = this.shadowRoot;
      if (!root) return;

      // 无障碍属性透传（@since v3.4，task_089）：宿主写 aria-label / aria-pressed，
      // 内部 <button> 原样带上 —— 图标按钮才有读得出来的名字与开关态。
      const ariaLabelAttr = this._attrs.ariaLabel
        ? ` aria-label="${escapeHtml(this._attrs.ariaLabel)}"`
        : '';
      const ariaPressedAttr = this._attrs.ariaPressed !== null
        ? ` aria-pressed="${escapeHtml(this._attrs.ariaPressed)}"`
        : '';

      // 图标（@since v3.6，task_121）：inline SVG（图标组唯一来源 widgets/icon-set.ts）。
      // 认不出的图标名一律当"无图标" —— 不画半截图形，也不抛错。
      const iconName = this._attrs.icon;
      const iconMarkup = iconName && isIconName(iconName) ? iconSvg(iconName) : '';
      // 文字：纯图标钮没有文字（可访问名由 aria-label 给）；图标 + 文字 = 菜单项。
      const labelMarkup = this._attrs.label ? escapeHtml(this._attrs.label) : '';
      const content = iconMarkup
        ? `${iconMarkup}${labelMarkup ? `<span class="text">${labelMarkup}</span>` : ''}`
        : labelMarkup;

      // 全部颜色 / 字体 / 边框 / 圆角都走变量。组件零硬编码：grep 不到任何颜色字面量。
      root.innerHTML = `
        <style>
          :host {
            display: inline-block;
            /* 图标颜色从 host 继承（currentColor）—— hover 时整枚图标跟着变色。 */
            color: var(--srf-text);
            transition: color var(--srf-motion-hover);
          }
          /* 微交互（@since v3.6）：hover = 变主色（图标随之变色）+ 上浮 1px。
             why 挂在 :host 上而不是 button 上：图标按钮没有可见文字，
             「变色」必须落在图标自己身上才看得见；按钮底色变化只是配角。 */
          :host(:hover:not([disabled])) { color: var(--srf-accent); }
          /* 菜单项：撑满一行 + 内容左对齐（图标在文字左侧）。 */
          :host([stretch]) { display: block; }
          :host([stretch]) button { width: 100%; justify-content: flex-start; }
          button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: var(--srf-spacing-xs);
            padding: var(--srf-spacing-xs) var(--srf-spacing-md);
            background: var(--srf-panel);
            color: inherit;
            /* 外圈宽度走 var（@since task_135）：像素皮 = 1px 外实 + 1px 内衬线（双线，
               外框尺寸与现代皮一致）；现代皮拿不到本变量 → 兜底 var(--srf-border-width) = 原样。 */
            border: var(--srf-outer-border-width, var(--srf-border-width)) solid var(--srf-border);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-sm);
            font-weight: var(--srf-font-weight-semibold);
            line-height: var(--srf-line-height);
            cursor: pointer;
            /* 双线边框（@since v3.8，task_135）：外圈是元素自己的 border，
               这层是贴着 border **内侧**的 1px 亮线（inset 阴影 = 不占位 = 不动布局）。
               现代皮拿不到 --srf-inner-line → transparent → 与 task_121 一字不差。 */
            box-shadow: var(--srf-double-shadow, var(--srf-shadow));
            /* 四角角块（task_135）：直角缺角感 —— 2×2 方块钉在四角（background 不占位）。
               现代皮：--srf-notch-size 兜底 0px + 颜色 transparent = 什么都不画。 */
            background-image:
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent)),
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent)),
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent)),
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent));
            background-size: var(--srf-notch-size, 0px) var(--srf-notch-size, 0px);
            background-position: left top, right top, left bottom, right bottom;
            background-repeat: no-repeat;
            transition: background var(--srf-motion-hover), border-color var(--srf-motion-hover), color var(--srf-motion-hover), box-shadow var(--srf-motion-hover), transform var(--srf-motion-hover);
          }
          button:hover:not(:disabled) {
            background: var(--srf-panel-elevated);
            border-color: var(--srf-border-strong);
            transform: translateY(-1px);
          }
          /* active：压回原位 + 底色回落 —— 一次"按下去"的手感。
             @since v3.7（task_128）：像素皮的"按下去"是**真硬位移**（2px 右下），
             不是现代皮的原地压回。--srf-press-offset 只在像素皮存在（skin-pixel-layer.css），
             现代皮走 var() 兜底 0px —— 等价于原来的 translateY(0)，现代皮一个像素都不变。 */
          button:active:not(:disabled) {
            /* 按压（@since v3.8，task_135）：像素皮 = **压进 1px 的硬边**（inset 内衬线），
               现代皮 = 兜底 none = 与 task_121 完全一致（原地压回、阴影清零）。 */
            box-shadow: var(--srf-press-shadow, none);
            transform: translate(var(--srf-press-offset, 0px), var(--srf-press-offset, 0px));
            background: var(--srf-panel);
          }
          button:focus-visible {
            outline: var(--srf-border-width) solid var(--srf-accent);
            outline-offset: var(--srf-spacing-xxs);
          }
          button:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
          :host([variant="primary"]) button {
            background: var(--srf-accent);
            color: var(--srf-bg);
            border-color: var(--srf-accent);
          }
          :host([variant="primary"]) button:hover:not(:disabled) { background: var(--srf-accent-hover); color: var(--srf-bg); }
          :host([variant="danger"]) button { color: var(--srf-danger); }
          /* 图标尺寸跟着字号走（1em）：按钮 12px → 约 14px；小字处自动变小。
             @since v3.7（task_128）：像素皮下图标换**硬笔**——描边加粗到 2px + crispEdges 渲染
             （CSS 的 stroke-width 覆盖 SVG 的 presentation attribute，故图标组零改动）。
             现代皮走 var() 兜底（1.5px / geometricPrecision）—— 与 task_121 的现代图标完全一致。 */
          svg.srf-icon {
            width: 1.15em;
            height: 1.15em;
            display: block;
            flex: none;
            stroke-width: var(--srf-icon-stroke, 1.5);
            shape-rendering: var(--srf-icon-rendering, geometricPrecision);
          }
        ${MOTION_REDUCED_CSS}
        </style>
        <button type="button" ${this._attrs.disabled ? 'disabled' : ''}${ariaLabelAttr}${ariaPressedAttr}>${content}</button>
      `;

      const btn = root.querySelector('button');
      if (btn) {
        // 不写 inline onclick —— 走标准 addEventListener，避免与框架风格冲突。
        btn.addEventListener('click', this.onClick);
      }
    }

    private onClick = (ev: Event): void => {
      ev.stopPropagation();
      if (this._attrs.disabled) return;
      this.dispatchEvent(new CustomEvent('strat-button-click', {
        bubbles: true,
        composed: true,
        // icon 一并带上（@since v3.6，task_121）：纯图标钮没有文字 label，
        // 消费方要认"点了哪个"得看图标名或宿主上的 data-role。
        detail: { label: this._attrs.label, variant: this._attrs.variant, icon: this._attrs.icon },
      }));
    };
  }

  customElements.define(STRAT_BUTTON_TAG, StratButton);
  return StratButton as unknown as typeof HTMLElement;
}

/**
 * HTML 文本转义的最简实现：组件文本可能包含用户输入，避免 innerHTML 注入。
 * @since v3.6 改为具名导出：screens / panels 渲染用户数据（角色名、提示词）时同样要转义，
 *   各屏各抄一份转义函数必然出现"这屏忘了转义"的注入漏洞，故提到 widget 层共用（纯增补，不改行为）。
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] as string);
}
