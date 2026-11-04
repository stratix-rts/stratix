/**
 * 文件职责：**统一空态组件**（@since v3.8，task_136）—— 面板「没有数据」时的统一呈现。
 *
 *   统一口径（所有面板共用同一套模式，取代"各写各的"）：
 *     图标位（CSS 画的雷达环，不依赖字体字形 → 像素皮肤不缺字）
 *     + 一句话（插槽：调用方给文案，组件只管版式）
 *     + 可选动作（按钮：点了派 `strat-empty-action` 事件）
 *
 * 输入：DOM 属性 `icon`（图位文案，可空）/ `action`（动作按钮文案，可空）。
 * 输出：`<strat-empty-state>` 自定义元素；动作点击 → 冒泡的 `strat-empty-action` 事件。
 * 禁止事项：
 *   1. import world / app —— HUD 组件不认识战场与组合根；
 *   2. 自己发 HudCommand —— 组件只派 DOM 事件，命令由调用方（面板）接；
 *   3. 写死色值 —— 一律走 `--srf-*` 皮肤 token（现代 / 像素两套都对）；
 *   4. 用字形当图标 —— 像素皮肤是像素字体，特殊字形会变豆腐块，故图标一律 CSS 画。
 *
 * ★ 为什么用「插槽」而不是组件自己生成文案：
 *   各面板的文案各不相同（会话 / 日志 / 角色各说各的），但**版式**必须一致。
 *   把文案留给调用方（light DOM 插槽）、版式收进组件（shadow DOM），
 *   既统一了外观，又不把各面板的措辞塞进组件里硬编码。
 */

export const EMPTY_STATE_TAG = 'strat-empty-state';

/** 动作点击事件名（冒泡 + composed → 面板在自身 shadow 外也能收到）。 */
export const EMPTY_STATE_ACTION_EVENT = 'strat-empty-action';

/** 动作载荷。 */
export interface EmptyStateActionDetail {
  /** 动作槽位名（当前只有 'primary'；留出扩展位）。 */
  readonly action: string;
}

/**
 * 组件样式表（shadow DOM 内）。
 * why 全部用 `--srf-*` token：换皮肤 = 换 token 表，组件零改动。
 * 字号写法带兜底（新名 → 旧名）：排版 token 在演进（body / title / caption），
 *   兜底链保证两代 token 表下字号都落到位（不落到"变量未定义"→继承默认）。
 */
const EMPTY_STATE_STYLE = `
  :host { display: block; }
  .wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--srf-spacing-sm);
    padding: var(--srf-spacing-lg) var(--srf-spacing-sm);
    text-align: center;
    border: var(--srf-border-width) dashed var(--srf-border);
    border-radius: var(--srf-radius);
    color: var(--srf-text-muted);
    font-size: var(--srf-font-size-body, var(--srf-font-size-sm));
    line-height: var(--srf-line-height-body, var(--srf-line-height));
  }
  /* 图标位：CSS 画的雷达环（同心圈 + 中心点）—— 不依赖任何字形。 */
  .icon {
    position: relative;
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
    border: var(--srf-border-width) solid var(--srf-border-strong);
    border-radius: var(--srf-radius-pill);
  }
  .icon::before {
    content: "";
    position: absolute;
    inset: 5px;
    border: var(--srf-border-width) solid var(--srf-accent);
    border-radius: var(--srf-radius-pill);
    opacity: 0.65;
  }
  .icon::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 4px;
    height: 4px;
    transform: translate(-50%, -50%);
    background: var(--srf-accent);
    border-radius: var(--srf-radius-pill);
  }
  .body { display: block; }
  slot { color: inherit; font-size: inherit; line-height: inherit; }
  .action {
    appearance: none;
    cursor: pointer;
    padding: var(--srf-spacing-xs) var(--srf-spacing-md);
    border: var(--srf-border-width) solid var(--srf-border-strong);
    border-radius: var(--srf-radius);
    background: var(--srf-panel-elevated);
    color: var(--srf-text);
    font-family: inherit;
    font-size: var(--srf-font-size-body, var(--srf-font-size-sm));
    transition: border-color var(--srf-transition), color var(--srf-transition);
  }
  .action:hover { border-color: var(--srf-accent); color: var(--srf-accent-hover); }
  .action[hidden] { display: none; }
`;

/** `<strat-empty-state>`：面板空态的统一组件。 */
export class StratEmptyStateElement extends HTMLElement {
  /** shadow DOM 已建标记（避免重复 attach）。 */
  private ready = false;

  static get observedAttributes(): string[] {
    return ['icon', 'action'];
  }

  /**
   * 构造期就建 shadow（@since v3.8，task_136）。
   * why 不等 connectedCallback：元素可能先被 createElement 造出来、稍后才进 DOM
   *   （面板按需建元素时很常见）—— 那时若还没影子，属性设置与断言都会落空。
   */
  constructor() {
    super();
    this.build();
    this.sync();
  }

  /** 建影子 DOM（构造期一次；connectedCallback 不再重建）。 */
  private build(): void {
    {
      const root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = EMPTY_STATE_STYLE;
      const wrap = document.createElement('div');
      wrap.className = 'wrap';
      wrap.setAttribute('part', 'wrap');

      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.setAttribute('data-role', 'icon');
      icon.setAttribute('aria-hidden', 'true');

      const body = document.createElement('div');
      body.className = 'body';
      const slot = document.createElement('slot');
      body.appendChild(slot);

      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'action';
      action.setAttribute('data-role', 'action');
      action.hidden = true;
      action.addEventListener('click', () => {
        this.dispatchEvent(
          new CustomEvent<EmptyStateActionDetail>(EMPTY_STATE_ACTION_EVENT, {
            bubbles: true,
            composed: true,
            detail: { action: 'primary' },
          })
        );
      });

      wrap.append(icon, body, action);
      root.append(style, wrap);
      this.ready = true;
    }
  }

  attributeChangedCallback(): void {
    if (this.ready) this.sync();
  }

  /** 属性 → 视图（图位文案 + 动作按钮）。 */
  private sync(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const icon = root.querySelector('[data-role="icon"]');
    const action = root.querySelector<HTMLButtonElement>('[data-role="action"]');
    const glyph = (this.getAttribute('icon') ?? '').trim();
    if (icon) icon.textContent = glyph;
    const actionLabel = (this.getAttribute('action') ?? '').trim();
    if (action) {
      action.textContent = actionLabel;
      action.hidden = actionLabel === '';
    }
  }
}

/** 注册组件（幂等：重复 define 会抛，故先查）。 */
export function defineEmptyState(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(EMPTY_STATE_TAG)) return;
  customElements.define(EMPTY_STATE_TAG, StratEmptyStateElement);
}

/**
 * 造一个空态元素（面板里的惯用写法：`el.innerHTML` 之外的安全构造）。
 * @param text 文案（放插槽里 —— light DOM，故 textContent 断言仍能读到）。
 */
export function createEmptyState(text: string, options: { icon?: string; action?: string } = {}): StratEmptyStateElement {
  defineEmptyState();
  const el = document.createElement(EMPTY_STATE_TAG) as StratEmptyStateElement;
  if (options.icon) el.setAttribute('icon', options.icon);
  if (options.action) el.setAttribute('action', options.action);
  el.textContent = text;
  return el;
}
