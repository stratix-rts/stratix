/**
 * 文件职责：markdown 渲染管线的单测（@since v3.9，task_145）。
 *
 * 覆盖四条硬契约（见 src/hud/lib/markdown.ts 头部）：
 *   1. GFM 样本正确渲染（代码块 / 列表 / 表格 / 链接 / 行内 code）；
 *   2. XSS 样本被消毒（<script> / <img onerror> / javascript: 链接）；
 *   3. 纯文本回归无损（textContent 与原文逐字相同）；
 *   4. 降级：渲染异常回退纯文本，不崩。
 * 外加：复制按钮真的把代码写进剪贴板。
 *
 * @jest-environment jsdom
 */

import {
  enhanceMarkdown,
  MARKDOWN_CSS,
  renderMarkdown,
} from '../lib/markdown';

/** 把渲染结果放进真实 DOM（jsdom 里 innerHTML 会走真实解析器）。 */
function mount(html: string): HTMLElement {
  const box = document.createElement('div');
  box.innerHTML = html;
  document.body.appendChild(box);
  return box;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderMarkdown — GFM 渲染', () => {
  const sample = [
    '# 标题',
    '',
    '段落里有个 `inlineCode`。',
    '',
    '- 第一项',
    '- 第二项',
    '',
    '| 列 A | 列 B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '[链接](https://example.com)',
  ].join('\n');

  test('代码块带 language 类（语言标签从 class 读）', () => {
    const box = mount(renderMarkdown(sample));
    const code = box.querySelector('pre > code');
    expect(code).not.toBeNull();
    expect(code?.className).toContain('language-js');
    expect(code?.textContent).toContain('const x = 1;');
  });

  test('列表渲染成 <ul> / <li>', () => {
    const box = mount(renderMarkdown(sample));
    expect(box.querySelectorAll('ul li').length).toBe(2);
  });

  test('表格渲染成 table / tr / td', () => {
    const box = mount(renderMarkdown(sample));
    expect(box.querySelector('table')).not.toBeNull();
    expect(box.querySelectorAll('table tr').length).toBe(2); // 表头 + 1 行
    expect(box.querySelector('table th')?.textContent).toContain('列 A');
  });

  test('链接渲染成 <a href>', () => {
    const box = mount(renderMarkdown(sample));
    const a = box.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com');
  });

  test('行内 code 渲染成 <code>（不含 pre）', () => {
    const box = mount(renderMarkdown('段落里有个 `inlineCode`。'));
    const codes = Array.from(box.querySelectorAll('code'));
    expect(codes.length).toBe(1);
    expect(codes[0].textContent).toBe('inlineCode');
    expect(codes[0].closest('pre')).toBeNull();
  });

  test('标题渲染成 h1', () => {
    const box = mount(renderMarkdown('# 标题'));
    expect(box.querySelector('h1')?.textContent).toBe('标题');
  });
});

describe('renderMarkdown — XSS 消毒', () => {
  test('<script> 不落 DOM（当文本）', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    const box = mount(html);
    expect(box.querySelector('script')).toBeNull();
    expect(box.textContent).toContain('<script>alert(1)</script>');
  });

  test('<img onerror> 不落 DOM（当文本）', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    const box = mount(html);
    expect(box.querySelector('img')).toBeNull();
    expect(box.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  test('javascript: 链接被剥掉 href', () => {
    const html = renderMarkdown('[点我](javascript:alert(1))');
    const box = mount(html);
    const a = box.querySelector('a');
    expect(a).not.toBeNull();
    const href = a?.getAttribute('href') ?? '';
    expect(href.toLowerCase().replace(/\s/g, '')).not.toContain('javascript:');
  });

  test('on* 事件属性不落 DOM', () => {
    const html = renderMarkdown('<div onclick="alert(1)">x</div>');
    const box = mount(html);
    for (const el of Array.from(box.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
      }
    }
  });
});

describe('renderMarkdown — 纯文本回归', () => {
  const plain = '第一行\n第二行\t带制表符\n普通 ASCII 与中文混排 <不是标签>';

  test('textContent 与原文逐字相同', () => {
    const box = mount(renderMarkdown(plain));
    expect(box.textContent).toBe(plain);
  });

  test('空串返回空串', () => {
    expect(renderMarkdown('')).toBe('');
  });

  test('渲染异常不抛出（降级纯文本）', () => {
    // 极端输入：未闭合的 HTML + 深层嵌套 + 控制字符
    const nasty = '<div><span><b>' + 'x'.repeat(5000) + ' </div>';
    expect(() => renderMarkdown(nasty)).not.toThrow();
  });
});

describe('enhanceMarkdown — 代码块增强', () => {
  test('加语言标签 + 复制按钮', () => {
    const box = mount(renderMarkdown('```ts\nconst a = 1;\n```'));
    enhanceMarkdown(box);
    const lang = box.querySelector('.md-code-lang');
    const copy = box.querySelector('[data-role="code-copy"]');
    expect(lang?.textContent).toBe('ts');
    expect(copy).not.toBeNull();
    expect(box.querySelector('.md-code')).not.toBeNull();
  });

  test('复制按钮真的写剪贴板', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const box = mount(renderMarkdown('```js\nconst a = 1;\n```'));
    enhanceMarkdown(box);
    const copy = box.querySelector<HTMLButtonElement>('[data-role="code-copy"]');
    copy?.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('const a = 1;');
  });

  test('链接新窗口打开并切断 opener', () => {
    const box = mount(renderMarkdown('[链接](https://example.com)'));
    enhanceMarkdown(box);
    const a = box.querySelector('a');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });

  test('重复调用不叠加按钮（幂等）', () => {
    const box = mount(renderMarkdown('```js\nx\n```'));
    enhanceMarkdown(box);
    enhanceMarkdown(box);
    expect(box.querySelectorAll('[data-role="code-copy"]').length).toBe(1);
  });
});

describe('MARKDOWN_CSS — 样式契约', () => {
  test('代码块有内滚上限（长输出不撑爆面板）', () => {
    expect(MARKDOWN_CSS).toMatch(/\.md-content pre \{[^}]*max-height/);
  });

  test('内容字号走 token（双皮肤 + 内容/铬分级）', () => {
    expect(MARKDOWN_CSS).toContain('--srf-font-size-content');
    expect(MARKDOWN_CSS).toContain('--srf-line-height-content');
  });

  test('reduced-motion 下复制按钮无过渡', () => {
    expect(MARKDOWN_CSS).toContain('prefers-reduced-motion');
  });
});
