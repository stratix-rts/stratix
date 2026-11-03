/**
 * 文件职责：**轻提示 toast 宿主** Web Component（`<strat-toast-host>`，task_039）—— 右上角
 *   轻提示的极简实现：show(text, tone) 追加一条气泡，TOAST_TTL_MS（3s）后自动移除；
 *   多条并排堆叠（新的在下面），元素离场时清空全部计时器。
 *   why 独立组件而不是塞进某个面板：toast 是**跨面板**的顶层反馈面（任务完成 / 失败来自
 *   任意角色的任意时刻），挂在 hud 根容器上，谁都能借组合根的接线借道它说话。
 * 输入：show() 的显式调用（组合根接 task-report 的 toast 口 —— hud 组件只被驱动，不订阅总线，
 *   与 chat-drawer 的流式公开方法同一装配口径）。
 * 输出：fixed 定位的 Shadow DOM 气泡栈（皮肤 token 渲染，无业务状态、无命令派发）。
 * 禁止事项：
 *   1. import world/、phaser、vue、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— 触发一律走组合根注入的调用（本组件零订阅零派发）；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token；
 *   4. 正文走 innerHTML —— 角色名 / 任务信息是外部输入，textContent 直写（XSS 面为零）；
 *   5. 泄漏计时器 —— disconnectedCallback 必须清光（元素反复挂卸不积累定时器，perf 硬约束）。
 *
 * @since v3.18（task_039）。
 * @since v3.6（task_116）通知总开关：show() 受设置页「通知提示」偏好门控
 *   （localStorage 键 stratix.notifications.enabled，'0' = 关）——
 *   让那个开关有真实消费者，而不是一个只翻文字的假控件。
 */

import { STRATIX_NOTIFICATIONS_TOGGLE_KEY } from '../../../core/types';

export const TOAST_HOST_TAG = 'strat-toast-host';

/** 单条轻提示的存活时长（ms）：3s —— 读完一句话的节奏，不打断操作。 */
export const TOAST_TTL_MS = 3000;

/** 语气词表：success=完成（绿）/ danger=失败（红）/ info=中性提示（蓝边）。 */
/**
 * 气泡语气色。@since v3.25（task_049）增 warn（srf-warn 黄 —— 审批门「等你裁决」的拉人
 * 提示，与战场 ? 浮标同一族；danger 保留给「出事了」）。
 */
export type ToastTone = 'info' | 'success' | 'warn' | 'danger';

/** 自定义元素的对外形状（组合根与测试按它操作）。 */
export interface StratToastHostElement extends HTMLElement {
  /** 追加一条轻提示（tone 缺省 info）；宿主未连接时安全 no-op。 */
  show(text: string, tone?: ToastTone): void;
  /** 当前在屏的轻提示条数（测试 / 调试观察口）。 */
  readonly toastCount: number;
  /** 当前在屏的轻提示文案（自上而下；测试断言用）。 */
  readonly visibleTexts: readonly string[];
}

/** HTML 属性值转义（tone 是词表内的受控值，防御性转义一层）。 */
function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] as string);
}

/**
 * 通知总开关是否打开（@since v3.6，task_116）。
 * 口径：值为 '0' = 关，其它（'1' / 缺键 / 读失败）= 开 —— 与设置页写入口径一致
 *   （settings-screen 的「通知提示」行写的就是这个键）。
 */
function notificationsEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(STRATIX_NOTIFICATIONS_TOGGLE_KEY) !== '0';
  } catch {
    return true; // 隐私模式 / 读失败：不让提示静默消失（宁多不少）
  }
}

/**
 * 工厂：注册 `<strat-toast-host>`。
 * 幂等（与 defineCharacterChatDrawer / defineChatDrawer 同约定）：重复 register 返回已注册构造器。
 */
export function defineToastHost(): typeof HTMLElement {
  if (customElements.get(TOAST_HOST_TAG)) {
    return customElements.get(TOAST_HOST_TAG) as unknown as typeof HTMLElement;
  }

  class ToastHost extends HTMLElement implements StratToastHostElement {
    private _stack: HTMLElement | null = null;
    /** 在屏气泡 → 其自动消失计时器（disconnected 时统一清光）。 */
    private readonly _active = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

    get toastCount(): number {
      return this._active.size;
    }

    get visibleTexts(): readonly string[] {
      return [...this._active.keys()].map((node) => node.textContent ?? '');
    }

    connectedCallback(): void {
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      // 局部变量接管：attachShadow 的返回不收窄 this.shadowRoot（TS 判 possibly-null），后续都走 root。
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `
        <style>
          /* 顶层反馈面：压在抽屉（z-index 40）之上；宿主不拦事件，交互留给气泡外的世界 */
          :host {
            all: initial;
            position: fixed;
            top: 0;
            right: 0;
            z-index: 50;
            pointer-events: none;
          }
          .stack {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: var(--srf-spacing-sm);
            padding: var(--srf-spacing-lg);
            font-family: var(--srf-font-ui);
          }
          .toast {
            max-width: min(320px, 80vw);
            box-sizing: border-box;
            padding: var(--srf-spacing-sm) var(--srf-spacing-md);
            background: var(--srf-panel-overlay);
            border: var(--srf-border-width) solid var(--srf-border-strong);
            border-left-width: var(--srf-spacing-xxs);
            border-radius: var(--srf-radius);
            color: var(--srf-text);
            font-size: var(--srf-font-size-sm);
            line-height: var(--srf-line-height);
            box-shadow: var(--srf-shadow-lg);
          }
          .toast[data-tone="success"] { border-color: var(--srf-success); }
          .toast[data-tone="danger"] { border-color: var(--srf-danger); }
          .toast[data-tone="info"] { border-color: var(--srf-accent); }
          .toast[data-tone="warn"] { border-color: var(--srf-warn); }
        </style>
        <div class="stack" data-role="stack" aria-live="polite"></div>
      `;
      this._stack = root.querySelector('[data-role="stack"]');
    }

    disconnectedCallback(): void {
      // 资源必须可清理：元素离场时清光计时器与气泡（否则定时器还会摸已卸载的 DOM）。
      for (const timer of this._active.values()) clearTimeout(timer);
      this._active.clear();
      this._stack = null;
    }

    show(text: string, tone: ToastTone = 'info'): void {
      const stack = this._stack;
      if (!stack) return; // 未连接（理论上组合根挂载后才会被调）：安全跳过
      // 通知总开关关着 → 不出提示（@since v3.6，task_116：让设置页那个开关有真实消费者）。
      if (!notificationsEnabled()) return;
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.setAttribute('data-tone', escapeAttr(tone));
      toast.setAttribute('role', 'status');
      // 正文 textContent 直写（不 innerHTML）：角色名 / 任务信息是外部输入，零 XSS 面。
      toast.textContent = text;
      stack.appendChild(toast);
      this._active.set(toast, setTimeout(() => this.dismiss(toast), TOAST_TTL_MS));
    }

    private dismiss(toast: HTMLElement): void {
      const timer = this._active.get(toast);
      if (timer !== undefined) clearTimeout(timer);
      this._active.delete(toast);
      toast.remove();
    }
  }

  customElements.define(TOAST_HOST_TAG, ToastHost);
  return ToastHost as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：本仓库面板的统一装配口径（与 mountCharacterChatDrawer 一致）——
 *   建元素、挂进容器，返回元素引用 + unmount 闭包（组合根要拿元素接 task-report 的 toast 口）。
 */
export function mountToastHost(host: HTMLElement): {
  readonly element: StratToastHostElement;
  readonly unmount: () => void;
} {
  defineToastHost();
  const element = document.createElement(TOAST_HOST_TAG) as StratToastHostElement;
  host.appendChild(element);
  // 移除元素触发 disconnectedCallback → 计时器清光。
  return { element, unmount: () => { element.remove(); } };
}
