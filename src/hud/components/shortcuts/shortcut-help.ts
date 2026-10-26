/**
 * 文件职责：**快捷键帮助浮层** Web Component（`<strat-shortcut-help>`，task_058）——
 *   ? 键开关的全键位清单：SHORTCUT_CATALOG（shortcut-catalog 的集中常量）按分组渲染成
 *   两列清单（键位 / 说明），Esc / 点击遮罩 / × 钮关闭。纯展示组件：不订阅总线、不发命令，
 *   开关的唯一驱动是 shortcut-manager（经 open/close/toggle 公开方法）。
 * 输入：open() / close() / toggle() 的显式调用；清单数据 import 自 shortcut-catalog（hud 内互认合法）。
 * 输出：fixed 全屏遮罩 + 居中面板（Shadow DOM，皮肤 token）；关闭请求经 composed CustomEvent
 *   冒泡到 window（manager 监听后同步自己的 helpOpen 真相位）。
 * 禁止事项：
 *   1. import world/、app/、core/bus —— 铁律；本组件是纯 DOM 展示面；
 *   2. 正文走 innerHTML —— 键位/说明是本仓库静态文案，但保持 textContent 直写口径（零 XSS 面）；
 *   3. 自持「打开」真相 —— opened 只是渲染态镜像，开关决策在 manager，这里只执行；
 *   4. 泄漏监听 —— 遮罩/×钮监听随 Shadow DOM 销毁，无全局资源。
 *
 * @since v3.34（task_058）。
 */

import {
  SHORTCUT_CATALOG,
  SHORTCUT_CATEGORY_LABELS,
  formatShortcutDisplay,
  type ShortcutCategoryId,
} from './shortcut-catalog';

export const SHORTCUT_HELP_TAG = 'strat-shortcut-help';

/** 遮罩关闭请求的事件名（manager 在 window 上监听 —— composed 事件能穿出 Shadow DOM）。 */
export const SHORTCUT_HELP_CLOSE_REQUEST = 'shortcut-help-close-request';

/** 分组渲染顺序（= 类型词表顺序，抽成数组避免 Object.keys 的实现顺序耦合）。 */
const CATEGORY_ORDER: readonly ShortcutCategoryId[] = ['selection', 'groups', 'camera', 'help', 'mouse'];

/** 自定义元素的对外形状（manager 与测试按它操作）。 */
export interface StratShortcutHelpElement extends HTMLElement {
  /** 打开浮层（幂等：已开不动）。 */
  open(): void;
  /** 关闭浮层（幂等：已关不动）。 */
  close(): void;
  /** 开关切换；返回切换后的状态。 */
  toggle(): boolean;
  /** 当前渲染态（manager 的 helpOpen 是真相位，这里只是镜像）。 */
  readonly opened: boolean;
}

/**
 * 工厂：注册 `<strat-shortcut-help>`。
 * 幂等（与 defineToastHost / defineStratMinimap 同约定）：重复 register 返回已注册构造器。
 */
export function defineShortcutHelp(): typeof HTMLElement {
  if (customElements.get(SHORTCUT_HELP_TAG)) {
    return customElements.get(SHORTCUT_HELP_TAG) as unknown as typeof HTMLElement;
  }

  class StratShortcutHelp extends HTMLElement implements StratShortcutHelpElement {
    private _opened = false;
    private _domBuilt = false;

    get opened(): boolean {
      return this._opened;
    }

    connectedCallback(): void {
      if (!this._domBuilt) {
        this._domBuilt = true;
        this.buildDom();
      }
      // 重挂（元素复用）不携带上次的打开态：浮层是临时面。
      this.syncOpened(false);
    }

    disconnectedCallback(): void {
      this._opened = false;
    }

    open(): void {
      this.syncOpened(true);
    }

    close(): void {
      this.syncOpened(false);
    }

    toggle(): boolean {
      this.syncOpened(!this._opened);
      return this._opened;
    }

    private syncOpened(opened: boolean): void {
      const changed = this._opened !== opened;
      this._opened = opened;
      if (changed) {
        if (opened) this.setAttribute('open', '');
        else this.removeAttribute('open');
      }
      // 无障碍语义恒同步（重复设同值无害；首次进入也要设上，不依赖 changed 分支）：
      // 浮层即对话框（jsdom 不渲染样式，role/aria 是唯一机器可读面）。
      this.setAttribute('role', 'dialog');
      this.setAttribute('aria-hidden', opened ? 'false' : 'true');
    }

    private buildDom(): void {
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host { all: initial; }
          :host:not([open]) { display: none; }
          .backdrop {
            position: fixed;
            inset: 0;
            z-index: 60; /* toast(50) 之上：浮层打开时它是唯一焦点，反馈层不再抢戏 */
            display: flex;
            align-items: center;
            justify-content: center;
            padding: var(--srf-spacing-xl);
            box-sizing: border-box;
            background: var(--srf-backdrop);
            font-family: var(--srf-font-ui);
          }
          .panel {
            box-sizing: border-box;
            width: min(480px, 90vw);
            max-height: 80vh;
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: var(--srf-border-strong) transparent;
            padding: var(--srf-spacing-xl);
            background: var(--srf-panel);
            border: var(--srf-border-width) solid var(--srf-border-strong);
            border-radius: var(--srf-radius);
            box-shadow: var(--srf-shadow-lg);
            color: var(--srf-text);
          }
          .panel::-webkit-scrollbar { width: var(--srf-spacing-sm); }
          .panel::-webkit-scrollbar-thumb { background: var(--srf-border-strong); border-radius: var(--srf-radius-pill); }
          .head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--srf-spacing-md);
            margin-bottom: var(--srf-spacing-lg);
            padding-bottom: var(--srf-spacing-md);
            border-bottom: var(--srf-border-width) solid var(--srf-border);
          }
          .title { font-size: var(--srf-font-size-lg); font-weight: var(--srf-font-weight-semibold); }
          .hint { font-size: var(--srf-font-size-xs); color: var(--srf-text-muted); margin-left: var(--srf-spacing-md); }
          button {
            all: unset;
            cursor: pointer;
            color: var(--srf-text-muted);
            font-size: var(--srf-font-size-md);
            padding: var(--srf-spacing-xxs) var(--srf-spacing-xs);
            border-radius: var(--srf-radius);
            transition: color var(--srf-transition), background var(--srf-transition);
          }
          button:hover { color: var(--srf-text); background: var(--srf-panel-elevated); }
          button:active { color: var(--srf-accent); }
          button:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          h3 {
            margin: var(--srf-spacing-lg) 0 var(--srf-spacing-xs);
            font-size: var(--srf-font-size-xs);
            color: var(--srf-text-muted);
            font-weight: var(--srf-font-weight-semibold);
            letter-spacing: 0.04em;
          }
          .row {
            display: flex;
            justify-content: space-between;
            gap: var(--srf-spacing-md);
            padding: var(--srf-spacing-xs) 0;
            font-size: var(--srf-font-size-sm);
            line-height: var(--srf-line-height);
          }
          .row + .row { border-top: var(--srf-border-width) solid var(--srf-border); }
          .keys { flex-shrink: 0; color: var(--srf-accent); font-family: var(--srf-font-mono); }
          .desc { text-align: right; color: var(--srf-text-muted); }
        </style>
        <div class="backdrop" data-role="backdrop">
          <div class="panel" data-role="panel">
            <div class="head">
              <div class="title">快捷键<span class="hint">Esc / ? 关闭</span></div>
              <button type="button" data-role="close" aria-label="关闭帮助">×</button>
            </div>
            <div data-role="list"></div>
          </div>
        </div>
      `;

      // 清单渲染：目录是静态常量，构建期一次成型（改键位只动 shortcut-catalog，这里零改动）。
      const list = root.querySelector('[data-role="list"]');
      if (list) {
        for (const category of CATEGORY_ORDER) {
          const docs = SHORTCUT_CATALOG.filter((doc) => doc.category === category);
          if (docs.length === 0) continue;
          const heading = document.createElement('h3');
          heading.textContent = SHORTCUT_CATEGORY_LABELS[category];
          list.appendChild(heading);
          for (const doc of docs) {
            const row = document.createElement('div');
            row.className = 'row';
            const keys = document.createElement('span');
            keys.className = 'keys';
            keys.textContent = doc.keys.map(formatShortcutDisplay).join(' / ');
            const desc = document.createElement('span');
            desc.className = 'desc';
            desc.textContent = doc.description;
            row.append(keys, desc);
            list.appendChild(row);
          }
        }
      }

      // 关闭面 ×3：遮罩点击 / × 钮。都只发「请求」事件 —— 开关真相在 manager，
      // 它收到后调 close()（与 Esc 键同一条路，三条出口不会漂移）。
      const requestClose = (): void => {
        this.dispatchEvent(
          new CustomEvent(SHORTCUT_HELP_CLOSE_REQUEST, {
            bubbles: true,
            composed: true, // 穿出 Shadow DOM，manager 的 window 监听才能收到
          })
        );
      };
      root.querySelector('[data-role="close"]')?.addEventListener('click', requestClose);
      root.querySelector('[data-role="backdrop"]')?.addEventListener('click', (event) => {
        // 点遮罩才关（点面板内部冒泡到遮罩的不算 —— 面板是内容面）。
        if (event.target === root.querySelector('[data-role="backdrop"]')) requestClose();
      });
    }
  }

  customElements.define(SHORTCUT_HELP_TAG, StratShortcutHelp);
  return StratShortcutHelp as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂（与 mountToastHost / mountMinimap 同一装配口径）：建元素、挂进容器。
 * 开关接线归 shortcut-manager（mountShortcuts 一并完成）；单独挂载时元素只是静态浮层。
 */
export function mountShortcutHelp(host: HTMLElement): {
  readonly element: StratShortcutHelpElement;
  readonly unmount: () => void;
} {
  defineShortcutHelp();
  const element = document.createElement(SHORTCUT_HELP_TAG) as StratShortcutHelpElement;
  host.appendChild(element);
  return { element, unmount: () => { element.remove(); } };
}
