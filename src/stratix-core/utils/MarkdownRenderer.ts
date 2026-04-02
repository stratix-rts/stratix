import hljs from 'highlight.js';
import { marked, Renderer } from 'marked';
import { markedHighlight } from 'marked-highlight';

// Configure marked with syntax highlighting
marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  })
);

// Think tag extension for reasoning display
const thinkExtension = {
  name: 'think',
  level: 'block' as const,
  start(src: string) {
    return src.match(/<think/)?.index;
  },
  tokenizer(src: string) {
    const rule = /^<think>[\s\S]*?(?:<\/think>|$)/;
    const match = rule.exec(src);
    if (match) {
      const raw = match[0];
      const isComplete = raw.endsWith('</think>');
      const content = raw.replace(/<\/?think>/g, '');
      return {
        type: 'think',
        raw,
        content,
        isComplete,
      };
    }
    return undefined;
  },
  renderer(token: Record<string, unknown>) {
    const isComplete = token.isComplete as boolean | undefined;
    const content = token.content as string;
    const borderStyle = isComplete !== false
      ? 'border-left: 3px solid #888;'
      : 'border-left: 3px dashed #aaa;';
    const cursor = isComplete === false ? '<span class="thinking-cursor">...</span>' : '';
    return `<span class="think" style="display: block; background: rgba(128, 128, 128, 0.1); color: #888; font-size: 11px; padding: 8px 12px; border-radius: 4px; margin: 8px 0; ${borderStyle}">🤔 ${content}${cursor}</span>\n`;
  },
};

// Custom renderer for code blocks with copy button
const copyButtonScript = `
<script>
function copyCode(button) {
  const code = button.previousElementSibling;
  const text = code.textContent;
  navigator.clipboard.writeText(text).then(() => {
    button.textContent = '✓';
    setTimeout(() => { button.textContent = '📋'; }, 1500);
  }).catch(() => {
    button.textContent = '✕';
    setTimeout(() => { button.textContent = '📋'; }, 1500);
  });
}
</script>`;

const codeBlockWrapper = (code: string, language: string, escaped: boolean) => {
  const langLabel = language && language !== 'plaintext' ? `<span class="code-lang">${language}</span>` : '';
  return `<div class="code-block-wrapper">
  ${langLabel}
  <button class="copy-button" onclick="copyCode(this)">📋</button>
  <pre><code class="hljs language-${language}">${escaped ? code : escapeHtml(code)}</code></pre>
</div>`;
};

const escapeHtml = (text: string): string => {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
};

// Override code block renderer
const renderer = new Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const language = lang || 'plaintext';
  const highlighted = hljs.getLanguage(language)
    ? hljs.highlight(text, { language }).value
    : hljs.highlightAuto(text).value;
  return codeBlockWrapper(highlighted, language, true);
};

marked.use({
  renderer,
  extensions: [thinkExtension],
});

// Inject copy script once into document
let scriptInjected = false;
const injectCopyScript = () => {
  if (scriptInjected || typeof document === 'undefined') return;
  scriptInjected = true;
  const script = document.createElement('script');
  script.textContent = copyButtonScript.replace(/<\/?script>/g, '');
  document.head.appendChild(script);
};

/**
 * 渲染 markdown 文本（支持语法高亮和代码复制按钮）
 */
export function renderMarkdown(content: string): string {
  if (typeof document !== 'undefined') {
    injectCopyScript();
  }
  return marked.parse(content, { async: false }) as string;
}
