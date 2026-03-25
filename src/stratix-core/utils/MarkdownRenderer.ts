import { marked } from 'marked';

// Think tag extension for marked
const thinkExtension = {
  name: 'think',
  level: 'block',
  start(src: string) {
    return src.indexOf('<think>');
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

// Configure marked instance once
marked.use({ extensions: [thinkExtension] });

/**
 * 渲染 markdown 文本（支持 think 标签）
 */
export function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false }) as string;
}
