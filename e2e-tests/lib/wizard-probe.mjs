/**
 * 文件职责：**向导探针（浏览器侧）** —— 真浏览器里驱动「新建角色向导」的通用工具。
 *
 * ============ 来源：设计实证阶段的手写探针 ============
 *   本文件提炼自 `/tmp/cc-flow-probe3.mjs`（设计文档 docs/DESIGN-character-creation.md §6 附件）：
 *   那个探针用 `window.__wizClick` / `window.__wizDump` / `window.__wizFillName` 三个注入函数
 *   一步步走完了整个向导 —— **但它是临时脚本**：参数写死、逻辑没有沉淀、别人没法复用。
 *   本文件把它转成**仓内可复用**的库（init script + page 侧包装函数）：
 *   任何 e2e 剧本想驱动向导，直接 `installWizardProbe(context)` + `wizardClick(page, 'next')` 即可。
 *
 * ============ 为什么必须穿透 shadow DOM ============
 *   向导里的按钮全是 `<strat-button>` —— 真正的可点区域在它**自己的 shadow DOM 里**
 *   （内部那个 `<button>`）。`element.click()` 派到的是 host 元素上，**不会**触发内部按钮；
 *   而内部按钮的 click 被 strat-button 拦下（stopPropagation）后改派 `strat-button-click`
 *   （冒泡 + composed）—— 那才是屏真正接的那条链。
 *   ⇒ 不穿透就点不动，"点不动"还容易被误判成"产品坏了"。
 *   （jest 侧的同款封装在 src/hud/__tests__/helpers/shadow-widget.ts。）
 *
 * ============ 口径（与 src/hud/widgets/strat-button.ts 对齐）============
 *   - 找到 strat-button → 点它 shadow 里的真 `<button>`（真用户等价）；
 *   - host 带 `disabled` → 不点，返回 'disabled:<action>'（点不动，如实说）；
 *   - 没有这个动作 → 返回 'no-btn:<action>'（按钮在不在，如实说）。
 *   三种结果都区分开 —— 失败时能一眼看出是"没有这个按钮"还是"按钮被禁用了"。
 *
 * 输入：一个 Playwright BrowserContext（探针通过 init script 装进页面）。
 * 输出：注入页面全局 `window.__wizClick` / `__wizDump` / `__wizFillName`；
 *   并提供 page 侧的包装函数（`wizardClick` / `wizardDump` / `wizardFillName` / `wizardPresent`）。
 * 禁止事项：
 *   1. 在探针里**断言** —— 探针只如实回报所见，判定归驱动脚本（service-harness 的 must()）；
 *   2. 依赖具体文案 —— 探针按 `data-action` / `data-role` 取（语义键），文案会改、语义键不会；
 *   3. 改产品码 —— 探针只在页面里读 DOM、点按钮。
 */

/* eslint-env browser */
// 页面内代码跑在浏览器里（page.evaluate 的回调体在页面上下文执行）⇒ 浏览器全局是合法的。

/** 探针默认盯的根元素（向导屏）。 */

export const DEFAULT_WIZARD_ROOT = 'strat-onboarding-screen';

/**
 * 把探针装进一个 BrowserContext（每个新页面都会自动带上）。
 *
 * @param {import('playwright').BrowserContext} context 浏览器上下文。
 * @param {{ rootSelector?: string }} [options] 根元素选择器（默认向导屏）。
 */
export async function installWizardProbe(context, options = {}) {
  const rootSelector = options.rootSelector ?? DEFAULT_WIZARD_ROOT;
  await context.addInitScript((selector) => {
    /** 根元素的 shadow root（探针只在这棵树里找东西）。 */
    const root = () => document.querySelector(selector)?.shadowRoot ?? null;

    /**
     * 点一个动作按钮（穿透 strat-button 的 shadow DOM）。
     * @param {string} action `data-action` 值（'next' / 'use-default-template' / 'rescan' …）。
     * @returns {'clicked:'|'disabled:'|'no-btn:'|'no-wizard'} + action
     */
    window.__wizClick = (action) => {
      const sr = root();
      if (!sr) return 'no-wizard';
      const sb = [...sr.querySelectorAll('strat-button')].find(
        (b) => b.getAttribute('data-action') === action,
      );
      if (!sb) return 'no-btn:' + action;
      if (sb.hasAttribute('disabled')) return 'disabled:' + action;
      const inner = sb.shadowRoot?.querySelector('button') ?? sb;
      inner.click();
      return 'clicked:' + action;
    };

    /** 快照向导当前长什么样（动作表 + 提示 + 输入框 + 扫描行数 + 页脚原因）。 */
    window.__wizDump = () => {
      const sr = root();
      if (!sr) return null;
      const actions = [...sr.querySelectorAll('strat-button')].map((b) => ({
        action: b.getAttribute('data-action'),
        role: b.getAttribute('data-role'),
        label: b.getAttribute('label'),
        disabled: b.hasAttribute('disabled'),
      }));
      const hints = [...sr.querySelectorAll('[class*=hint], [class*=empty], [class*=warn]')]
        .map((h) => h.textContent.trim().slice(0, 80))
        .filter(Boolean);
      const inputs = [...sr.querySelectorAll('input')].map((i) => ({
        type: i.type,
        ph: i.placeholder ?? '',
        value: i.value.slice(0, 20),
        disabled: i.disabled,
      }));
      const footerReason = sr.querySelector('[data-role="footer-reason"]');
      const ownership = sr.querySelector('[data-role="ownership-bar"]');
      // 「已用默认模板」状态说明（人设步那一下的观测点；按语义键取，不靠 class 名）。
      const defaultTemplateState = sr.querySelector('[data-role="default-template-state"]');
      // 当前步（步骤条上 data-state="active" 的那一条）—— 断言"走到哪一步"靠它。
      const activeStep = sr.querySelector('[data-role="step"][data-state="active"]');
      return {
        actions,
        hints: hints.slice(0, 6),
        inputs: inputs.slice(0, 8),
        rows: sr.querySelectorAll('[data-role="scan-row"]').length,
        step: activeStep ? activeStep.getAttribute('data-step') : null,
        defaultTemplateState: defaultTemplateState
          ? defaultTemplateState.textContent.trim().slice(0, 120)
          : '',
        // 页脚原因（禁用带原因那条口径的观测点）。
        footerReason:
          footerReason && !footerReason.hasAttribute('hidden')
            ? footerReason.textContent.trim().slice(0, 160)
            : '',
        // 归属条（"将建到哪儿"那条口径的观测点）。
        ownership: ownership ? ownership.textContent.trim().slice(0, 160) : '',
      };
    };

    /** 填起名框（真用户等价：改值 + 派 input 事件）。 */
    window.__wizFillName = (name) => {
      const sr = root();
      const inp = sr?.querySelector('[data-role="name-input"]');
      if (!inp) return 'no-input';
      inp.focus();
      inp.value = name;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return 'filled';
    };

    /**
     * 扫描步「只勾选这一个 agent」（真用户等价：改勾选框 + 派 change 事件）。
     * why 需要：扫描步会把**所有**可建档 agent 默认勾上 —— 开发机上装着几个 CLI 就勾几个，
     *   后面几步就得逐个配人设，断言的判别力被机器环境带跑。
     *   收窄到唯一一个 ⇒ 断言只跟"用户选的那一个"有关。
     */
    window.__wizSelectOnly = (kind) => {
      const sr = root();
      if (!sr) return 'no-wizard';
      const boxes = [...sr.querySelectorAll('input[data-role="scan-select"]')];
      if (!boxes.length) return 'no-select';
      let found = false;
      for (const box of boxes) {
        const boxKind = box.getAttribute('data-kind');
        if (boxKind === kind) found = true;
        const want = boxKind === kind;
        if (box.checked !== want) {
          box.checked = want;
          box.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return found ? 'selected:' + kind : 'no-kind:' + kind;
    };
  }, rootSelector);
}

/** 向导是否挂着（页面里有没有那棵影子树）。 */
export async function wizardPresent(page) {
  return page.evaluate(
    (selector) => Boolean(document.querySelector(selector)?.shadowRoot),
    DEFAULT_WIZARD_ROOT,
  );
}

/**
 * 点一个动作按钮（探针 `__wizClick` 的 page 侧包装）。
 *
 * @param {import('playwright').Page} page 页面。
 * @param {string} action `data-action` 值。
 * @returns {Promise<string>} 'clicked:<action>' / 'disabled:<action>' / 'no-btn:<action>' / 'no-wizard'
 */
export async function wizardClick(page, action) {
  return page.evaluate((a) => window.__wizClick?.(a) ?? 'no-probe', action);
}

/**
 * 快照向导（探针 `__wizDump` 的 page 侧包装）。
 *
 * @param {import('playwright').Page} page 页面。
 * @returns {Promise<object|null>} 快照；向导不在场 → null。
 */
export async function wizardDump(page) {
  return page.evaluate(() => window.__wizDump?.() ?? null);
}

/**
 * 填起名框（探针 `__wizFillName` 的 page 侧包装）。
 *
 * @param {import('playwright').Page} page 页面。
 * @param {string} name 名字。
 * @returns {Promise<string>} 'filled' / 'no-input'
 */
export async function wizardFillName(page, name) {
  return page.evaluate((n) => window.__wizFillName?.(n) ?? 'no-probe', name);
}

/**
 * 扫描步「只勾选这一个 agent」（探针 `__wizSelectOnly` 的 page 侧包装）。
 *
 * @param {import('playwright').Page} page 页面。
 * @param {string} kind agent kind（如 'claude-code'）。
 * @returns {Promise<string>} 'selected:<kind>' / 'no-kind:<kind>' / 'no-select' / 'no-wizard'
 */
export async function wizardSelectOnly(page, kind) {
  return page.evaluate((k) => window.__wizSelectOnly?.(k) ?? 'no-probe', kind);
}
