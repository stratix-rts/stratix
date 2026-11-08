/**
 * 文件职责：**shadow DOM 穿透测试工具**（探针转正；@since v3.3，task_228 · CC-03）。
 *
 * ============ 为什么需要它（不是"测试洁癖"）============
 *   HUD 的按钮全是自定义元素 `<strat-button>`（src/hud/widgets/strat-button.ts）：
 *   真正的可点区域在它**自己的 shadow DOM 里**（内部那个 `<button>`）。
 *   于是有一处极易踩的坑：
 *     · `host.click()` —— 派的是 click 到 host 元素上，**不会**触发内部按钮的监听；
 *     · 内部按钮的 click 被 strat-button 拦下（stopPropagation）后改派 `strat-button-click`
 *       （冒泡 + composed）—— 这才是消费方（屏）真正接的那条链。
 *   所以「脚本点不动」与「产品坏了」是两件事：不穿透就会把前者误判成后者
 *   （task_226 的入口回归就踩过：主屏顶栏只听 `strat-button-click`，host.click() 根本不触发）。
 *
 * ============ 来源：设计实证阶段的手写探针 ============
 *   本工具提炼自 `/tmp/cc-flow-probe3.mjs`（设计文档 docs/DESIGN-character-creation.md §6 附件）
 *   里的 `window.__wizClick` / `window.__wizDump` / `window.__wizFillName`：
 *   探针在真浏览器里手动穿透 strat-button 才能一步步走完向导 ——
 *   把它转成**仓内可复用工具**（本文件，jest 侧；e2e 侧的同款封装见
 *   `e2e-tests/lib/wizard-probe.mjs`），以后任何"点 HUD 按钮"的测试都直接用。
 *
 * ============ 口径（与 strat-button.ts 的实现对齐）============
 *   - 找得到内部 `<button>` → 点它（**真用户等价**：用户点到的就是它）；
 *   - 内部按钮 disabled / host 带 disabled 属性 → 返回 'disabled'（点不动，如实说）；
 *   - 目标不存在 → 返回 'missing'（调用方据此断言"按钮在不在"，而不是静默通过）。
 *   三种结果都区分开 —— 断言失败时能一眼看出是"没有这个按钮"还是"按钮被禁用了"。
 */

/** 点一个控件的结果：点了 / 点不动（禁用）/ 压根没有。 */
export type WidgetClickStatus = 'clicked' | 'disabled' | 'missing';

/** 一个 strat-button 的摘要（探针 `__wizDump` 的 jest 版）。 */
export interface WidgetSummary {
  /** `data-action` 值（向导屏用它路由动作）。 */
  readonly action: string | null;
  /** `data-role` 值（屏用它标记语义位置）。 */
  readonly role: string | null;
  /** 按钮文案（`label` 属性）。 */
  readonly label: string | null;
  /** 是否处于禁用态。 */
  readonly disabled: boolean;
}

/** 一批控件的快照（探针 `__wizDump` 的 jest 版）：动作表 + 提示文案 + 输入框。 */
export interface WidgetDump {
  readonly actions: readonly WidgetSummary[];
  readonly hints: readonly string[];
  readonly inputs: readonly {
    readonly type: string;
    readonly placeholder: string;
    readonly value: string;
    readonly disabled: boolean;
  }[];
}

/**
 * 取控件 shadow 里的真 `<button>`（strat-button 的点击点）。
 *
 * @param node 控件元素（通常是 `<strat-button>`）。
 * @returns 内部按钮；不是 strat-button（或没渲染出来）→ null。
 */
export function innerButtonOf(node: HTMLElement): HTMLButtonElement | null {
  const root = node.shadowRoot;
  if (!root) return null;
  return root.querySelector('button');
}

/**
 * 控件是否禁用（两个口径都看）。
 *
 * why 两个都看：strat-button 把 `disabled` **同时**写在 host 属性与内部按钮上，
 *   但消费方（测试 / 屏）读到的可能是任意一个 —— 只看一个会漏判。
 */
export function isWidgetDisabled(node: HTMLElement): boolean {
  if (node.hasAttribute('disabled')) return true;
  return innerButtonOf(node)?.disabled === true;
}

/**
 * 点一个控件（真用户等价：strat-button 点它 shadow 里的真按钮）。
 *
 * @param node 目标控件。
 * @returns 'clicked' / 'disabled'（点不动）/ 'missing'（内部按钮没渲染出来）。
 */
export function clickWidget(node: HTMLElement): WidgetClickStatus {
  if (isWidgetDisabled(node)) return 'disabled';
  const inner = innerButtonOf(node);
  if (!inner) {
    // 不是 strat-button（普通按钮 / 复选框 / 单选框）→ 直接点它自己。
    node.click();
    return 'clicked';
  }
  inner.click();
  return 'clicked';
}

/** 在一个根（一般是 shadowRoot）里找控件；找不到 → null。 */
export function queryWidget(root: ParentNode, selector: string): HTMLElement | null {
  return (root.querySelector(selector) as HTMLElement | null) ?? null;
}

/** 在一个根里找一批控件（保持文档顺序）。 */
export function queryWidgets(root: ParentNode, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll(selector)) as HTMLElement[];
}

/**
 * 按 `data-action` 找控件（向导屏的动作路由键）。
 *
 * @param root 搜索根。
 * @param action 动作名（如 'next' / 'use-default-template' / 'rescan'）。
 */
export function widgetByAction(root: ParentNode, action: string): HTMLElement | null {
  return queryWidget(root, `[data-action="${action}"]`);
}

/**
 * 按 `data-action` 点控件（探针 `__wizClick` 的 jest 版）。
 *
 * @returns 'clicked' / 'disabled' / 'missing'（这个动作在不在）。
 */
export function clickByAction(root: ParentNode, action: string): WidgetClickStatus {
  const node = widgetByAction(root, action);
  if (!node) return 'missing';
  return clickWidget(node);
}

/**
 * 快照一个根里的控件（探针 `__wizDump` 的 jest 版）。
 *
 * @param root 搜索根。
 */
export function dumpWidgets(root: ParentNode): WidgetDump {
  const actions = queryWidgets(root, 'strat-button').map((node) => ({
    action: node.getAttribute('data-action'),
    role: node.getAttribute('data-role'),
    label: node.getAttribute('label'),
    disabled: isWidgetDisabled(node),
  }));
  const hints = queryWidgets(root, '[class*=hint], [class*=empty], [class*=warn]')
    .map((node) => (node.textContent ?? '').trim().slice(0, 120))
    .filter((text) => text.length > 0);
  const inputs = queryWidgets(root, 'input').map((node) => {
    const input = node as HTMLInputElement;
    return {
      type: input.type,
      placeholder: input.placeholder ?? '',
      value: (input.value ?? '').slice(0, 40),
      disabled: input.disabled,
    };
  });
  return { actions, hints, inputs };
}

/**
 * 填一个文本输入框（探针 `__wizFillName` 的 jest 版）。
 *
 * why 要手动派 `input` 事件：屏是**事件驱动**的（`addEventListener('input')`），
 *   直接改 `value` 不会触发它 —— 改了值但屏不知道，等于没填。
 *
 * @param root 搜索根。
 * @param selector 输入框选择器（默认起名框 `[data-role="name-input"]`）。
 * @param value 要填的值。
 * @returns 填上了 → true；没有这个输入框 → false。
 */
export function fillTextInput(
  root: ParentNode,
  value: string,
  selector = '[data-role="name-input"]'
): boolean {
  const input = root.querySelector(selector) as HTMLInputElement | null;
  if (!input) return false;
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}
