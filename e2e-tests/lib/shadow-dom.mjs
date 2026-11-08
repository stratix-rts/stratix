/**
 * 文件职责：**shadow DOM 深度操作工具**（真浏览器侧）—— 定位并点击「藏在影子树里」的控件。
 *
 * ============ 为什么需要它 ============
 *   Stratix 的 HUD 是 Web Components：真可点区域在组件**自己的 shadow DOM 里**。
 *   - `<strat-button>`：内部那个 `<button>` 才是可点的；`host.click()` 派到 host 上，
 *     内部按钮收不到 ⇒ **点了没反应**（而且很容易被误判成"产品坏了"）。
 *   - `<strat-battlefield-empty>` / `<strat-character-screen>`：内容全在影子树里，
 *     `document.querySelector('[data-role="action-create"]')` 根本找不到。
 *   ⇒ 断言要落到「用户真能点到的那一层」，就得沿 shadowRoot 逐层下钻。
 *
 * ============ 与向导探针（wizard-probe.mjs）的关系 ============
 *   - `wizard-probe.mjs`：**向导专用**，靠 init script 装进页面（`window.__wizClick` 等），
 *     带"动作表 / 提示 / 输入框 / 归属条"这种**语义快照**，是 `/tmp/cc-flow-probe3.mjs` 的转正；
 *   - 本文件：**通用**，按「选择器路径」下钻并点击，**不注入任何页面全局**——
 *     用来点向导**之外**的入口（战场空态 CTA / 顶栏「更多」菜单 / 角色中心空态 CTA）。
 *   两边口径一致：点得到 = 点**内部**那个真按钮。
 *
 * ============ 口径 ============
 *   - 路径第一段在 `document` 里找，之后每一段在上一节点的子树里找，**先影子树、再光 DOM**：
 *     · 影子树优先 —— 组件自己的内容在那儿；
 *     · 光 DOM 兜底 —— **slot 投影**的元素（如 `<strat-empty-state>` 里用 `<slot>` 投进来的
 *       「新建角色」按钮）住在**光 DOM**，只在影子树里 querySelector 是找不到的。
 *   - 命中的是自定义元素（带 shadowRoot）⇒ 点它影子树里的第一个真控件（`<button>` / `<a>`）；
 *   - 三种结果分开报：**missing**（没有这个控件）/ **disabled**（有但禁用了）/ **clicked**。
 *     分开报的意义：失败时能一眼分清"入口不存在"与"入口被禁用"——这两者的修法完全不同。
 *
 * 输入：一个 Playwright Page + 选择器路径（字符串数组）。
 * 输出：`{ status: 'clicked' | 'missing' | 'disabled', at?: number, selector?: string }`。
 * 禁止事项：
 *   1. 在本文件里断言 —— 判定归驱动脚本（service-harness 的 must()）；
 *   2. 依赖文案 —— 按 `data-role` / `data-action` 这类语义键取，文案会改、语义键不会；
 *   3. 改产品码 —— 只读 DOM、只点按钮。
 */

/* eslint-env browser */
// 页面内代码跑在浏览器里（page.evaluate 的回调体在页面上下文执行）⇒ 浏览器全局是合法的。

/**
 * 沿 shadowRoot 逐层下钻，找一个节点（不点）。
 *
 * @param {import('playwright').Page} page 页面。
 * @param {readonly string[]} path 选择器路径（第一段在 document 里找，其余逐层下钻）。
 * @returns {Promise<{ found: boolean, at?: number, selector?: string }>} 结果。
 */

export async function deepFind(page, path) {
  return page.evaluate((p) => {
    const queryWithin = (scope, selector) => {
      const inShadow = scope.shadowRoot?.querySelector(selector) ?? null;
      if (inShadow) return inShadow;
      return scope.querySelector(selector);
    };
    let scope = document;
    for (let index = 0; index < p.length; index += 1) {
      const selector = p[index];
      const found = queryWithin(scope, selector);
      if (!found) return { found: false, at: index, selector };
      // 下一段在命中节点的子树里找（影子树优先，光 DOM 兜底）。
      scope = found;
    }
    return { found: true };
  }, [...path]);
}

/**
 * 沿 shadowRoot 逐层下钻并**点击**（真用户等价：点内部那个真按钮）。
 *
 * @param {import('playwright').Page} page 页面。
 * @param {readonly string[]} path 选择器路径。
 * @returns {Promise<{ status: 'clicked' | 'missing' | 'disabled', at?: number, selector?: string }>} 结果。
 */
export async function deepClick(page, path) {
  return page.evaluate((p) => {
    const queryWithin = (scope, selector) => {
      const inShadow = scope.shadowRoot?.querySelector(selector) ?? null;
      if (inShadow) return inShadow;
      return scope.querySelector(selector);
    };
    let node = null;
    let scope = document;
    for (let index = 0; index < p.length; index += 1) {
      const selector = p[index];
      const found = queryWithin(scope, selector);
      if (!found) return { status: 'missing', at: index, selector };
      node = found;
      scope = found;
    }
    if (!node) return { status: 'missing', at: 0, selector: p[0] };

    // 自定义元素 ⇒ 真用户点的是它影子树里的控件；普通元素（如战场空态里的 <button>）点它自己。
    let clickable = node;
    if (node.shadowRoot) {
      const inner = node.shadowRoot.querySelector('button, a[href], [role="button"]');
      if (inner) clickable = inner;
    }
    if (clickable.disabled) return { status: 'disabled', at: p.length - 1, selector: p[p.length - 1] };
    clickable.click();
    return { status: 'clicked' };
  }, [...path]);
}

/**
 * 取某个节点的可见文本（截断）。
 *
 * @param {import('playwright').Page} page 页面。
 * @param {readonly string[]} path 选择器路径。
 * @param {number} [maxLength] 截断长度。
 * @returns {Promise<string>} 文本（找不到 = 空串）。
 */
export async function deepText(page, path, maxLength = 200) {
  return page.evaluate(
    ({ p, max }) => {
      const queryWithin = (scope, selector) => {
        const inShadow = scope.shadowRoot?.querySelector(selector) ?? null;
        if (inShadow) return inShadow;
        return scope.querySelector(selector);
      };
      let scope = document;
      let node = null;
      for (const selector of p) {
        const found = queryWithin(scope, selector);
        if (!found) return '';
        node = found;
        scope = found;
      }
      return (node?.textContent ?? '').trim().slice(0, max);
    },
    { p: [...path], max: maxLength }
  );
}
