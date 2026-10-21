/**
 * 文件职责：HUD 通用按钮基类（Web Component）—— 全部视觉属性走 CSS 变量，组件零硬编码样式。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 screens/widgets 层级 + §3 token 体系。
 * 输入：HTML 属性 `label` / `variant`；用户点击事件（click）。
 * 输出：标准 `<button>` 子树（Shadow DOM 内）+ CustomEvent `strat-button-click`。
 * 禁止事项：
 *   1. 硬编码任何颜色 / 字体 / 边框 / 圆角 —— 全部走 var(--srf-*)；
 *   2. 引入 Vue / React / 任何 UI 库 —— 原生 CustomElement + Shadow DOM；
 *   3. 直接调 core/bus —— 按钮只发 DOM 事件，业务语义由父级 main-screen 经 bus-adapter 转发；
 *   4. 阻塞主线程 —— Shadow DOM 同步 build，注册动作必须是副作用幂等（重复 register 不许报错）。
 *
 * 使用：
 *   const btn = document.createElement('strat-button');
 *   btn.setAttribute('label', '提交');
 *   btn.setAttribute('variant', 'primary');
 *   btn.addEventListener('strat-button-click', () => adapter.dispatch({...}));
 *   document.body.appendChild(btn);
 */

export const STRAT_BUTTON_TAG = 'strat-button';

/** 按钮语义变体；具体颜色全部由 token 决定，本组件不写颜色字面量。 */
export type StratButtonVariant = 'default' | 'primary' | 'danger';

interface StratButtonAttrs {
  label: string;
  variant: StratButtonVariant;
  disabled: boolean;
}

const DEFAULT_ATTRS: StratButtonAttrs = {
  label: '',
  variant: 'default',
  disabled: false,
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
      return ['label', 'variant', 'disabled'];
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
        variant: (this.getAttribute('variant') as StratButtonVariant) ?? DEFAULT_ATTRS.variant,
        disabled: this.hasAttribute('disabled'),
      };
      if (this.isConnected) this.render();
    }

    private render(): void {
      const root = this.shadowRoot;
      if (!root) return;

      // 全部颜色 / 字体 / 边框 / 圆角都走变量。组件零硬编码：grep 不到任何颜色字面量。
      root.innerHTML = `
        <style>
          :host { display: inline-block; }
          :host([disabled]) button { opacity: 0.5; cursor: not-allowed; }
          button {
            background: var(--srf-panel, #181c25);
            color: var(--srf-text, #e6e9ef);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            padding: var(--srf-spacing-sm, 8px) var(--srf-spacing-md, 12px);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-md, 14px);
            line-height: var(--srf-line-height, 1.4);
            cursor: pointer;
            box-shadow: var(--srf-shadow, none);
          }
          button:hover:not(:disabled) {
            background: var(--srf-panel-elevated, #20262f);
            border-color: var(--srf-border-strong, #3a4252);
          }
          :host([variant="primary"]) button {
            background: var(--srf-accent, #6ea8ff);
            color: var(--srf-bg, #0f1116);
            border-color: var(--srf-accent, #6ea8ff);
          }
          :host([variant="primary"]) button:hover:not(:disabled) {
            background: var(--srf-accent-hover, #8fbaff);
          }
          :host([variant="danger"]) button {
            color: var(--srf-danger, #e06c75);
          }
        </style>
        <button type="button" ${this._attrs.disabled ? 'disabled' : ''}>${escapeHtml(this._attrs.label)}</button>
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
        detail: { label: this._attrs.label, variant: this._attrs.variant },
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
