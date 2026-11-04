/**
 * 文件职责：agent 文本的 **markdown 渲染管线**（@since v3.9，task_145）。
 *
 * 问题：agent 的 CLI 输出天然是 markdown（代码块 / 列表 / 表格 / 行内 code），
 *   产品却一律按纯文本渲染 —— 等于把最核心的阅读面做瞎了
 *   （用户原话：「聊天页里渲染气泡的时候也没有处理好 markdown 格式的渲染」）。
 *
 * 管线：**marked(GFM) → DOMPurify → 气泡 DOM**。
 *   why 不手搓解析器：markdown 语法边角太多（表格 / 嵌套列表 / 转义 / 引用），
 *     自研必出 bug，且修不动 —— 生产级渲染必须是库；
 *   why 必须消毒：agent 文本 = **不可信输入**（CLI 输出可以含任意内容），
 *     而 marked 只是解析器、**不做安全处理**（`[x](javascript:...)` 会原样吐出 href），
 *     XSS 防线必须是真库（DOMPurify），不是手写正则。
 *
 * 三条硬契约：
 *   1. **原始 HTML 一律当文本**（renderer.html 转义）：agent 文本里的 `<div>` / `<标题>`
 *      是字面量而不是标签 —— 纯文本必须逐字无损（转义后 DOM 的 textContent 与原文相同）。
 *   2. **DOMPurify 消毒是硬约束**：本模块的输出只可整块赋给 innerHTML，绝不可拼进字符串模板。
 *   3. **渲染异常回退纯文本**：try/catch 兜底，渲染器炸了也不能崩面板（降级优先于完美）。
 *
 * 输入：不可信文本（agent / CLI 输出）。
 * 输出：安全 HTML 字符串（renderMarkdown）+ Shadow-DOM 内增强（enhanceMarkdown）。
 * 禁止事项：
 *   1. 手写 markdown 解析 / 手写正则消毒（那是 marked + DOMPurify 的活）；
 *   2. 在本模块里写死颜色 / 字号字面量（配色与字阶一律走 token，见 MARKDOWN_CSS）；
 *   3. 引入 app / world / core-bus 依赖（hud 层边界铁律：本模块只认 DOM 与文本）。
 */

import DOMPurify from 'dompurify';
import { marked, Renderer } from 'marked';

import { escapeHtml } from '../widgets/strat-button';

/** 内容容器类名：各表面把自己的语义类名与之并列（如 `class="bubble-text md-content"`）。 */
export const MARKDOWN_CLASS = 'md-content';

/**
 * marked 调用参数。
 * - gfm: true —— 表格 / 任务列表 / 删除线（agent 输出里最常见的三样）。
 * - breaks: false —— **不把单换行折成 <br>**：纯文本里的 \n 原样留在 HTML 里，
 *   于是 DOM 的 textContent 与原文逐字相同（回归无损），显示时由 CSS 的 pre-wrap 折行。
 * - async: false —— 同步返回字符串（渲染管线必须在调用方栈里拿到结果）。
 */
const MARKED_OPTIONS = {
  gfm: true,
  breaks: false,
  async: false,
} as const;

/**
 * renderer 覆写：**原始 HTML 块当文本转义**。
 * why：agent 文本里的 HTML 是字面量（CLI 日志、`<标题>` 占位符），
 *   让它变成真标签既可能注入，也会把纯文本内容吃掉（`<标题>` 会整个消失）。
 */
const renderer = new Renderer();
renderer.html = (token) => escapeHtml(token.text);

/** DOMPurify 实例形态（只用到本模块需要的两个成员）。 */
interface Purifier {
  sanitize(html: string): string;
  isSupported?: boolean;
}

let cachedPurifier: Purifier | null = null;
let purifierResolved = false;

/**
 * 取 DOMPurify 实例（懒初始化，只取一次）。
 *
 * why 懒初始化：模块被 import 时不能碰 DOM —— hud 的部分单测跑在 node 环境（无 window），
 *   顶层求值 DOMPurify 会炸掉整个测试文件。
 * why 有缓存：DOMPurify 实例内部有钩子表，反复创建是纯浪费；一个页面的 window 是稳定的。
 */
function getPurifier(): Purifier | null {
  if (purifierResolved) return cachedPurifier;
  purifierResolved = true;
  try {
    const candidate = DOMPurify as unknown as Purifier;
    // Node（无 DOM）下 dompurify 的默认导出 isSupported=false 且根本没有 sanitize 方法。
    if (typeof candidate.sanitize === 'function' && candidate.isSupported !== false) {
      cachedPurifier = candidate;
    }
  } catch {
    cachedPurifier = null;
  }
  return cachedPurifier;
}

/**
 * 把不可信的 agent 文本渲染成**安全 HTML 字符串**。
 *
 * 契约：
 *   1. 返回值可直接赋给 innerHTML（已消毒）；
 *   2. 纯文本输入的 textContent 与原文逐字相同（`<标题>` / `<img onerror>` 都留作文本）；
 *   3. 任何异常都退回转义后的纯文本，绝不抛给调用方。
 *
 * @param text 不可信文本（agent / CLI 输出）。
 * @returns 安全 HTML 字符串（可空串）。
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  try {
    const parsed = marked.parse(text, { ...MARKED_OPTIONS, renderer }) as string;
    const purifier = getPurifier();
    if (!purifier) {
      // 没有 DOM 就没有 DOMPurify —— 那就没有 XSS 防线可言，宁可退回纯文本也不裸奔。
      return escapeHtml(text);
    }
    return purifier.sanitize(parsed).trim();
  } catch {
    // 渲染器炸了（畸形输入 / 未来的解析器回归）：面板不能因此崩，回退纯文本。
    return escapeHtml(text);
  }
}

/**
 * 在已插入 DOM 的 markdown 内容里补代码块外框（语言标签 + 一键复制）。
 *
 * why 放在 DOM 层而不是字符串层：复制按钮要挂真实的点击事件，
 *   语言标签要从 class="language-js" 里读 —— 都是 DOM 上的事。
 *
 * @param root 已渲染 markdown 的容器（面板自己的 shadow root 也行）。
 */
export function enhanceMarkdown(root: ParentNode): void {
  if (!root || typeof root.querySelectorAll !== 'function') return;

  // ── 代码块：等宽容器 + 语言标签 + 复制按钮 ───────────────────────────
  const blocks = Array.from(root.querySelectorAll('pre > code'));
  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre || pre.dataset.mdEnhanced === '1') continue;
    pre.dataset.mdEnhanced = '1';

    const wrap = document.createElement('div');
    wrap.className = 'md-code';

    const bar = document.createElement('div');
    bar.className = 'md-code-bar';

    const lang = document.createElement('span');
    lang.className = 'md-code-lang';
    // 语言标签只在有 lang 时出现（```js → js；裸 ``` → 不标）。
    const langName = /language-([\w+#.-]+)/.exec(code.className ?? '')?.[1] ?? '';
    lang.textContent = langName;
    if (!langName) lang.hidden = true;

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'md-code-copy';
    copy.dataset.role = 'code-copy';
    copy.textContent = '复制';
    copy.setAttribute('aria-label', '复制代码');
    copy.addEventListener('click', () => {
      void copyText(code.textContent ?? '', copy);
    });

    bar.append(lang, copy);
    pre.replaceWith(wrap);
    wrap.append(bar, pre);
  }

  // ── 链接：新窗口打开 + 切断 opener（href 已被 DOMPurify  vetted 过）────────
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
}

/**
 * 复制文本到剪贴板（优先异步剪贴板 API，失败退回复选框方案）。
 * @returns 是否复制成功。
 */
async function copyText(text: string, button: HTMLElement): Promise<boolean> {
  let ok = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    } catch {
      ok = false;
    }
  }
  button.textContent = ok ? '已复制' : '复制失败';
  window.setTimeout(() => {
    button.textContent = '复制';
  }, 1500);
  return ok;
}

/**
 * markdown 内容的样式（各面板在自己的 <style> 里拼上这一段 —— HUD 全是 Shadow DOM，
 * 样式不进 shadow root 就看不见）。
 *
 * 配色一律走 skin token（双皮肤适配的前提）；字阶走语义字阶 token
 * （内容 ≠ 铬：agent 内容是「读」的，字号起步 md=14px、行高 1.6；标签按钮仍是辅助字号）。
 */
export const MARKDOWN_CSS = `
.md-content {
  font-size: var(--srf-font-size-content, var(--srf-font-size-body, 14px));
  line-height: var(--srf-line-height-content, 1.6);
  color: var(--srf-text);
  overflow-wrap: anywhere;
}

.md-content p {
  margin: 0 0 0.55em;
  /* pre-wrap：保留原文换行与缩进（纯文本回归无损）——块之间的空白不在这里，不受影响 */
  white-space: pre-wrap;
}
.md-content p:last-child { margin-bottom: 0; }

.md-content h1, .md-content h2, .md-content h3,
.md-content h4, .md-content h5, .md-content h6 {
  margin: 0.8em 0 0.4em;
  font-size: 1.08em;
  font-weight: 600;
  line-height: 1.35;
  white-space: pre-wrap;
}
.md-content h1 { font-size: 1.25em; }
.md-content h2 { font-size: 1.15em; }

.md-content ul, .md-content ol {
  margin: 0 0 0.55em;
  padding-left: 1.5em;
}
.md-content li {
  margin: 0.2em 0;
  white-space: pre-wrap;
}
.md-content li > ul, .md-content li > ol { margin: 0.2em 0; }

.md-content blockquote {
  margin: 0 0 0.55em;
  padding: 0.1em 0 0.1em 0.8em;
  border-left: 3px solid var(--srf-border-strong);
  color: var(--srf-text-muted);
  white-space: pre-wrap;
}

.md-content hr {
  margin: 0.9em 0;
  border: 0;
  border-top: 1px solid var(--srf-border);
}

.md-content a {
  color: var(--srf-accent);
  text-decoration: underline;
  overflow-wrap: anywhere;
}

.md-content strong { font-weight: 600; }
.md-content em { font-style: italic; }
.md-content del { opacity: 0.7; }

/* 行内 code */
.md-content code {
  font-family: var(--srf-font-mono);
  font-size: 0.92em;
  background: var(--srf-panel-elevated);
  border: 1px solid var(--srf-border);
  border-radius: 4px;
  padding: 0.05em 0.32em;
  overflow-wrap: anywhere;
}

/* 代码块：长行折行（不横滚）+ 内滚上限（400 行也不撑爆面板） */
.md-content pre {
  margin: 0;
  padding: 0.6em 0.7em;
  background: var(--srf-panel-elevated);
  border: 1px solid var(--srf-border);
  border-radius: 6px;
  overflow: auto;
  max-height: 320px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.md-content pre code {
  background: none;
  border: 0;
  padding: 0;
  font-size: var(--srf-font-size-sm, 12px);
  line-height: 1.5;
}

/* 代码块外框：语言标签 + 一键复制 */
.md-code {
  margin: 0 0 0.55em;
  border: 1px solid var(--srf-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--srf-panel-elevated);
}
.md-code-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--srf-space-tight, 4px);
  padding: 0.2em 0.45em;
  background: var(--srf-panel);
  border-bottom: 1px solid var(--srf-border);
}
.md-code-lang {
  font-family: var(--srf-font-mono);
  font-size: var(--srf-font-size-caption, 12px);
  color: var(--srf-text-muted);
}
.md-code-copy {
  font-family: inherit;
  font-size: var(--srf-font-size-caption, 12px);
  line-height: 1.4;
  color: var(--srf-text-muted);
  background: transparent;
  border: 1px solid var(--srf-border);
  border-radius: 4px;
  padding: 0.1em 0.5em;
  cursor: pointer;
}
.md-code-copy:hover { color: var(--srf-text); border-color: var(--srf-border-strong); }
.md-code-copy:focus-visible { outline: 2px solid var(--srf-accent); outline-offset: 1px; }
.md-code pre {
  margin: 0;
  border: 0;
  border-radius: 0;
  max-height: 320px;
}

/* 表格：内滚（宽表不撑破面板） */
.md-content table {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  margin: 0 0 0.55em;
  border-collapse: collapse;
  font-size: 0.95em;
}
.md-content th, .md-content td {
  border: 1px solid var(--srf-border);
  padding: 0.3em 0.6em;
  text-align: left;
  white-space: pre-wrap;
}
.md-content th {
  background: var(--srf-panel-elevated);
  font-weight: 600;
}

/* 动效只在「允许动效」时开（reduced-motion 下复制按钮保持静态） */
@media (prefers-reduced-motion: no-preference) {
  .md-code-copy { transition: color 120ms ease, border-color 120ms ease; }
}
`;
