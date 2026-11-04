/**
 * 文件职责：**战场空态覆盖层**（@since v3.8，task_136）—— 0 单位时的「待部署」仪式感。
 *
 *   战场空着不该是"缺席"，该是"待命中"：一块扫描雷达 + 一句人话 + 两个能点的下一步。
 *   本组件是**盖在画布上的专用空态层**（HUD 侧，不进 world）：
 *     - why 不挂 world：按钮要能触发 HUD 侧既有命令（ui.navigate / 命令行），
 *       world → HUD 没有既有通道（world 只发 WorldEvent，HUD 只收 HudCommand），
 *       在 world 侧做按钮就得新造一条路由 —— 明确不做；
 *     - why 不改布局骨架：本层是 absolute 覆盖层（pointer-events:none，只有按钮接管事件），
 *       不占版面、不挤压任何既有件。
 *
 * 输入：core 广播的 WorldState（只读 units 长度）+ 两个动作回调。
 * 输出：`<strat-battlefield-empty>` 覆盖层；动作点击 → `strat-battlefield-action` 事件。
 * 禁止事项：
 *   1. import world / app —— HUD 组件不认识战场与组合根；
 *   2. 自己发 HudCommand —— 组件只派 DOM 事件，命令由组合根（app 层）接；
 *   3. 写死色值 —— 一律 `--srf-*` 皮肤 token（现代 / 像素两套都对）；
 *   4. 拦画布事件 —— 空态层 pointer-events:none，只有按钮 auto（否则战场拖不动）。
 *
 * ★ 显隐口径：**units.length === 0** 才亮（唯一真相 = core 广播的单位表）。
 *   建一个角色 → core 投影出单位 → 空态消失；删掉角色 → 单位没了 → 空态回来（真实联动）。
 */

import type { WorldState } from '../../../core/types';

export const BATTLEFIELD_EMPTY_TAG = 'strat-battlefield-empty';

/** 动作点击事件名（冒泡 + composed）。 */
export const BATTLEFIELD_EMPTY_ACTION_EVENT = 'strat-battlefield-action';

/** 动作载荷。 */
export interface BattlefieldEmptyActionDetail {
  /** 'create' = 新建角色；'command' = 打开命令行。 */
  readonly action: 'create' | 'command';
}

/** 文案（人话口径 —— 不出现 gateway / 数据流这类开发者词）。 */
export const BATTLEFIELD_EMPTY_TITLE = '战场待命中';
export const BATTLEFIELD_EMPTY_HINT = '第一位 agent 上场后，这里会活起来';
export const BATTLEFIELD_EMPTY_TIPS = '左键框选 · 右键移动 · 滚轮缩放 · 双击跟随';

/**
 * 组件样式表（shadow DOM 内）。
 * why 动画走 CSS 而不是 JS 定时器：覆盖层是纯装饰，浏览器合成器跑它最省；
 *   且 prefers-reduced-motion 下自动停 —— 无障碍不靠"记得关"。
 * 颜色 / 尺寸 / 字号全走 `--srf-*` token（字号带新名→旧名兜底链）：
 *   换皮肤 = 换 token 表，组件零改动；两代排版 token 表下字号都落到位。
 */
const BATTLEFIELD_EMPTY_STYLE = `
  :host {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    /* 空态层不拦画布事件（战场要能拖 / 框选 / 缩放）；只有按钮自己开事件。 */
    pointer-events: none;
    z-index: 15;
  }
  :host([hidden]) { display: none; }
  .stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--srf-spacing-md);
    text-align: center;
    color: var(--srf-text);
    font-family: var(--srf-font-ui);
  }
  /* —— 雷达（待命光标）：同心圈 + 扫描扫线 + 中心待命光标 —— */
  .radar {
    position: relative;
    width: 168px;
    height: 168px;
    border: var(--srf-border-width) solid var(--srf-border-strong);
    border-radius: var(--srf-radius-pill);
    background:
      radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--srf-accent) 12%, transparent) 0%, transparent 62%),
      repeating-linear-gradient(0deg, var(--srf-border) 0 1px, transparent 1px 24px),
      repeating-linear-gradient(90deg, var(--srf-border) 0 1px, transparent 1px 24px);
    opacity: 0.9;
  }
  .ring {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    border: var(--srf-border-width) solid var(--srf-border-strong);
    border-radius: var(--srf-radius-pill);
    opacity: 0.55;
  }
  .ring.r1 { width: 116px; height: 116px; }
  .ring.r2 { width: 72px; height: 72px; }
  .ring.r3 { width: 30px; height: 30px; opacity: 0.8; }
  /* 扫描扫线：绕中心转（2.4s 一圈）。 */
  .sweep {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 50%;
    height: 2px;
    transform-origin: 0 50%;
    background: linear-gradient(90deg, var(--srf-accent), transparent);
    animation: srf-sweep 2.4s linear infinite;
  }
  /* 待命光标：中心十字 + 呼吸点。 */
  .cursor {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 12px;
    height: 12px;
    transform: translate(-50%, -50%);
    border: var(--srf-border-width) solid var(--srf-accent);
    border-radius: var(--srf-radius-pill);
    animation: srf-pulse 1.8s ease-in-out infinite;
  }
  .title {
    margin: 0;
    font-size: var(--srf-font-size-title, var(--srf-font-size-lg));
    font-weight: var(--srf-font-weight-bold);
    letter-spacing: 0.06em;
  }
  .hint {
    margin: 0;
    color: var(--srf-text-muted);
    font-size: var(--srf-font-size-body, var(--srf-font-size-md));
  }
  .tips {
    margin: 0;
    color: var(--srf-text-disabled);
    font-size: var(--srf-font-size-caption, var(--srf-font-size-xs));
  }
  .actions { display: flex; gap: var(--srf-spacing-sm); pointer-events: auto; }
  .action {
    appearance: none;
    cursor: pointer;
    padding: var(--srf-spacing-xs) var(--srf-spacing-md);
    border: var(--srf-border-width) solid var(--srf-border-strong);
    border-radius: var(--srf-radius);
    background: var(--srf-panel-overlay);
    color: var(--srf-text);
    font-family: inherit;
    font-size: var(--srf-font-size-body, var(--srf-font-size-sm));
    transition: border-color var(--srf-transition), color var(--srf-transition), background var(--srf-transition);
  }
  .action:hover { border-color: var(--srf-accent); color: var(--srf-accent-hover); }
  .action.primary {
    border-color: var(--srf-accent);
    background: color-mix(in srgb, var(--srf-accent) 18%, transparent);
    color: var(--srf-text);
  }
  .action.primary:hover { background: color-mix(in srgb, var(--srf-accent) 28%, transparent); }
  @keyframes srf-sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes srf-pulse {
    0%, 100% { opacity: 0.45; transform: translate(-50%, -50%) scale(1); }
    50% { opacity: 1; transform: translate(-50%, -50%) scale(1.25); }
  }
  @media (prefers-reduced-motion: reduce) {
    .sweep, .cursor { animation: none; }
  }
`;

/** `<strat-battlefield-empty>`：战场 0 单位时的待部署覆盖层。 */
export class StratBattlefieldEmptyElement extends HTMLElement {
  private ready = false;

  connectedCallback(): void {
    if (this.ready) return;
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = BATTLEFIELD_EMPTY_STYLE;

    const stage = document.createElement('div');
    stage.className = 'stage';

    const radar = document.createElement('div');
    radar.className = 'radar';
    radar.setAttribute('data-role', 'radar');
    radar.setAttribute('aria-hidden', 'true');
    for (const cls of ['ring r1', 'ring r2', 'ring r3', 'sweep', 'cursor']) {
      const part = document.createElement('i');
      part.className = cls;
      radar.appendChild(part);
    }

    const title = document.createElement('h2');
    title.className = 'title';
    title.setAttribute('data-role', 'title');
    title.textContent = BATTLEFIELD_EMPTY_TITLE;

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.setAttribute('data-role', 'hint');
    hint.textContent = BATTLEFIELD_EMPTY_HINT;

    const tips = document.createElement('p');
    tips.className = 'tips';
    tips.setAttribute('data-role', 'tips');
    tips.textContent = BATTLEFIELD_EMPTY_TIPS;

    const actions = document.createElement('div');
    actions.className = 'actions';
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'action primary';
    create.setAttribute('data-role', 'action-create');
    create.textContent = '新建角色';
    const command = document.createElement('button');
    command.type = 'button';
    command.className = 'action';
    command.setAttribute('data-role', 'action-command');
    command.textContent = '打开命令行';
    actions.append(create, command);

    stage.append(radar, title, hint, tips, actions);
    root.append(style, stage);

    const fire = (action: 'create' | 'command'): void => {
      this.dispatchEvent(
        new CustomEvent<BattlefieldEmptyActionDetail>(BATTLEFIELD_EMPTY_ACTION_EVENT, {
          bubbles: true,
          composed: true,
          detail: { action },
        })
      );
    };
    create.addEventListener('click', () => fire('create'));
    command.addEventListener('click', () => fire('command'));

    this.ready = true;
  }
}

/** 注册组件（幂等）。 */
export function defineBattlefieldEmpty(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(BATTLEFIELD_EMPTY_TAG)) return;
  customElements.define(BATTLEFIELD_EMPTY_TAG, StratBattlefieldEmptyElement);
}

/** 挂载选项。 */
export interface MountBattlefieldEmptyOptions {
  /** 状态订阅口（core 广播的 WorldState）。 */
  readonly subscribe: (handler: (state: WorldState) => void) => () => void;
  /** 「新建角色」点击回调（app 层接：既有向导 / 既有命令）。 */
  readonly onCreateCharacter?: () => void;
  /** 「打开命令行」点击回调。 */
  readonly onOpenCommand?: () => void;
}

/** 挂载结果。 */
export interface BattlefieldEmptyHandle {
  readonly element: StratBattlefieldEmptyElement;
  readonly unmount: () => void;
}

/**
 * 把战场空态覆盖层挂到宿主（组合根的 HUD 宿主）。
 * 显隐 = units.length === 0（唯一真相是 core 广播的单位表，不是本组件自己数）。
 */
export function mountBattlefieldEmpty(host: HTMLElement, options: MountBattlefieldEmptyOptions): BattlefieldEmptyHandle {
  defineBattlefieldEmpty();
  const element = document.createElement(BATTLEFIELD_EMPTY_TAG) as StratBattlefieldEmptyElement;
  element.hidden = true;
  host.appendChild(element);

  const onAction = (event: Event): void => {
    const detail = (event as CustomEvent<BattlefieldEmptyActionDetail>).detail;
    if (detail?.action === 'create') options.onCreateCharacter?.();
    else if (detail?.action === 'command') options.onOpenCommand?.();
  };
  element.addEventListener(BATTLEFIELD_EMPTY_ACTION_EVENT, onAction);

  const unsubscribe = options.subscribe((state) => {
    element.hidden = state.units.length > 0;
  });

  return {
    element,
    unmount: () => {
      unsubscribe();
      element.removeEventListener(BATTLEFIELD_EMPTY_ACTION_EVENT, onAction);
      element.remove();
    },
  };
}
