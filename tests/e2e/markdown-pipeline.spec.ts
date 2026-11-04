/**
 * e2e：markdown 渲染管线（@since v3.9，task_145）。
 *
 * 覆盖验收口径：
 *   ① GFM 样本（```js 代码块 / 列表 / 表格 / 链接 / 行内 code）在气泡里正确渲染，前后对照截图；
 *   ② XSS 样本（<script> / <img onerror> / javascript: 链接）被消毒（断言 DOM 里没有危险节点）；
 *   ③ 复制按钮真复制（剪贴板断言）；
 *   ④ 400 行长输出在代码块内滚（容器不被撑爆）；
 *   ⑤ 纯文本回归（逐字无损）。
 *
 * why 直接 import 应用模块（/src/hud/lib/markdown.ts）而不是复制一份解析逻辑进 e2e：
 *   e2e 要验的是**真管线**（marked → DOMPurify → DOM）；复制逻辑等于测了个影子。
 *   vite dev server 会把 .ts 按需转译，import 走的是模块真实路径。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.markdown.config.ts
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/src/app/main/index.html';
const SHOTS = 'reports/shots';

/** GFM 样本：代码块 + 列表 + 表格 + 链接 + 行内 code。 */
const GFM_SAMPLE = [
  '# 任务报告',
  '',
  '本轮**完成**了两件事，细节见 `task_assign` 的返回。',
  '',
  '- 第一步：读取 brief',
  '- 第二步：派发子任务',
  '',
  '| 阶段 | 状态 |',
  '| --- | --- |',
  '| 解析 | 完成 |',
  '| 派发 | 进行中 |',
  '',
  '```js',
  'const result = await task_assign({ missionId: "m-1" });',
  'console.log(result);',
  '```',
  '',
  '[详情链接](https://example.com/detail)',
].join('\n');

/** XSS 样本：三件套（script / img onerror / javascript: 链接）。 */
const XSS_SAMPLE = [
  '<script>alert(1)</script>',
  '',
  '<img src=x onerror=alert(2)>',
  '',
  '[点我](javascript:alert(3))',
  '',
  '正常文字还在。',
].join('\n');

/** 进主屏（拿皮肤 token）；markdown 模块用动态 import 注入（vite 按需转译 .ts）。 */
async function boot(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(400);
  }
}

/**
 * 把 markdown 模块装进 window.__md。
 * why 要重试：vite 首次见到新依赖（dompurify）会触发依赖预打包并整页 reload，
 *   那一次 evaluate 必然失败 —— reload 后再试即可。
 */
async function loadMarkdown(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const ok = await page.evaluate(async () => {
        try {
          const mod = await import('/src/hud/lib/markdown.ts');
          (window as unknown as { __md: typeof mod }).__md = mod;
          return true;
        } catch {
          return false;
        }
      });
      if (ok) return;
    } catch {
      // 页面被 reload（执行上下文销毁）—— 重新加载后再试。
    }
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
  }
  throw new Error('markdown 模块加载失败（vite 依赖预打包未收敛）');
}

/**
 * 在页面里渲染一段 markdown 到指定容器 id，并注入 markdown 样式。
 * 返回容器本身（页面内已就位，可直接量）。
 */
async function renderInto(page: Page, hostId: string, sample: string): Promise<void> {
  await page.evaluate(
    async ([id, text]) => {
      const md = (window as unknown as {
        __md: { renderMarkdown: (s: string) => string; enhanceMarkdown: (r: ParentNode) => void; MARKDOWN_CSS: string };
      }).__md;
      const host = document.createElement('div');
      host.id = id;
      host.className = 'bubble';
      host.style.cssText =
        'position:fixed;left:608px;top:80px;width:560px;max-height:70vh;overflow:auto;' +
        'padding:16px;background:var(--srf-panel-elevated);color:var(--srf-text);' +
        'border:1px solid var(--srf-border);border-radius:8px;z-index:99999;font-family:var(--srf-font-ui);';
      const style = document.createElement('style');
      style.textContent = md.MARKDOWN_CSS;
      document.head.appendChild(style);
      const body = document.createElement('div');
      body.className = 'bubble-text md-content';
      body.innerHTML = md.renderMarkdown(text);
      host.appendChild(body);
      document.body.appendChild(host);
      md.enhanceMarkdown(host);
    },
    [hostId, sample] as const,
  );
}

test.describe('markdown 渲染管线', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await loadMarkdown(page);
  });

  test('① GFM 样本：代码块 / 列表 / 表格 / 链接 / 行内 code 全部渲染（前后对照截图）', async ({ page }) => {
    // 改前：纯文本直写（等价于旧行为）
    await page.evaluate((text) => {
      const host = document.createElement('div');
      host.id = 'md-before';
      host.style.cssText =
        'position:fixed;left:24px;top:80px;width:560px;max-height:70vh;overflow:auto;' +
        'padding:16px;background:#101418;color:#d8dee9;border:1px solid #333;border-radius:8px;' +
        'z-index:99998;font-family:var(--srf-font-ui);white-space:pre-wrap;';
      host.textContent = text;
      document.body.appendChild(host);
    }, GFM_SAMPLE);

    await renderInto(page, 'md-after', GFM_SAMPLE);
    await page.waitForSelector('#md-after pre code');

    const shape = await page.evaluate(() => {
      const host = document.querySelector('#md-after') as HTMLElement;
      const q = (s: string) => host.querySelectorAll(s).length;
      const code = host.querySelector('pre > code');
      return {
        h1: q('h1'),
        listItems: q('ul li'),
        tableRows: q('table tr'),
        links: q('a[href]'),
        inlineCode: q('code:not(pre code)'),
        codeBlocks: q('pre > code'),
        lang: code?.className ?? '',
        codeText: code?.textContent ?? '',
        linkHref: host.querySelector('a')?.getAttribute('href') ?? '',
        // 内容字号（阅读级：14px 起步 / 行高 1.6）
        contentFontSize: getComputedStyle(host.querySelector('.md-content') as HTMLElement).fontSize,
        contentLineHeight: getComputedStyle(host.querySelector('.md-content') as HTMLElement).lineHeight,
        preFontFamily: code ? getComputedStyle(code).fontFamily : '',
      };
    });

    expect(shape.h1).toBe(1);
    expect(shape.listItems).toBe(2);
    expect(shape.tableRows).toBe(3);
    expect(shape.links).toBe(1);
    expect(shape.inlineCode).toBe(1);
    expect(shape.codeBlocks).toBe(1);
    expect(shape.lang).toContain('language-js');
    expect(shape.codeText).toContain('task_assign');
    expect(shape.linkHref).toBe('https://example.com/detail');
    expect(parseFloat(shape.contentFontSize)).toBeGreaterThanOrEqual(14);
    expect(parseFloat(shape.contentLineHeight) / parseFloat(shape.contentFontSize)).toBeCloseTo(1.6, 1);
    expect(shape.preFontFamily.toLowerCase()).toContain('mono');

    // 前后对照截图
    await page.screenshot({ path: `${SHOTS}/markdown-r7-gfm-md.png`, fullPage: false });
    await page.locator('#md-after').screenshot({ path: `${SHOTS}/markdown-r7-gfm-after-md.png` });
    await page.locator('#md-before').screenshot({ path: `${SHOTS}/markdown-r7-gfm-before-md.png` });
  });

  test('② XSS 样本：script / img onerror / javascript: 全部被消毒', async ({ page }) => {
    await renderInto(page, 'md-xss', XSS_SAMPLE);
    await page.waitForSelector('#md-xss');

    const result = await page.evaluate(() => {
      const host = document.querySelector('#md-xss') as HTMLElement;
      const hrefs = Array.from(host.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
      return {
        scripts: host.querySelectorAll('script').length,
        imgs: host.querySelectorAll('img').length,
        onAttrs: Array.from(host.querySelectorAll('*')).filter((el) =>
          Array.from(el.attributes).some((a) => a.name.toLowerCase().startsWith('on')),
        ).length,
        hrefs,
        text: host.textContent ?? '',
      };
    });

    expect(result.scripts).toBe(0);
    expect(result.imgs).toBe(0);
    expect(result.onAttrs).toBe(0);
    for (const href of result.hrefs) {
      expect(href.toLowerCase().replace(/\s/g, '')).not.toContain('javascript:');
    }
    // 危险文本仍然以**文本**呈现（不是被吃掉）
    expect(result.text).toContain('正常文字还在。');

    await page.screenshot({ path: `${SHOTS}/markdown-r7-xss-md.png` });
  });

  test('③ 复制按钮真复制', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await renderInto(page, 'md-copy', '```js\nconst a = 1;\n```');
    await page.waitForSelector('#md-copy [data-role="code-copy"]');

    await page.locator('#md-copy [data-role="code-copy"]').click();
    await page.waitForTimeout(300);

    const label = await page.locator('#md-copy [data-role="code-copy"]').textContent();
    const clip = await page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return 'READ_FAILED';
      }
    });
    expect(label).toContain('已复制');
    expect(clip).toContain('const a = 1;');
  });

  test('④ 400 行长输出：代码块内滚，容器不被撑爆', async ({ page }) => {
    const long = ['```js', ...Array.from({ length: 400 }, (_, i) => `const line${i} = ${i};`), '```'].join('\n');
    await renderInto(page, 'md-long', long);
    await page.waitForSelector('#md-long pre');

    const metrics = await page.evaluate(() => {
      const host = document.querySelector('#md-long') as HTMLElement;
      const pre = host.querySelector('pre') as HTMLElement;
      const wrap = host.querySelector('.md-code') as HTMLElement;
      return {
        preScroll: pre.scrollHeight,
        preClient: pre.clientHeight,
        preOverflowY: getComputedStyle(pre).overflowY,
        preMaxHeight: getComputedStyle(pre).maxHeight,
        wrapHeight: wrap.getBoundingClientRect().height,
        hostHeight: host.getBoundingClientRect().height,
      };
    });
    // 内滚：内容高 > 盒高，且容器给了滚动
    expect(metrics.preScroll).toBeGreaterThan(metrics.preClient);
    expect(['auto', 'scroll']).toContain(metrics.preOverflowY);
    expect(parseFloat(metrics.preMaxHeight)).toBeGreaterThan(0);
    // 容器不被撑爆：代码块 + 外框高度被 max-height 兜住
    expect(metrics.wrapHeight).toBeLessThanOrEqual(parseFloat(metrics.preMaxHeight) + 120);

    await page.screenshot({ path: `${SHOTS}/markdown-r7-long-md.png` });
  });

  test('⑤ 纯文本回归：逐字无损', async ({ page }) => {
    const plain = '第一行\n第二行\t带制表符\n普通 ASCII 与中文混排 <不是标签>';
    await renderInto(page, 'md-plain', plain);
    await page.waitForSelector('#md-plain');
    const text = await page.evaluate(() => document.querySelector('#md-plain')?.textContent ?? '');
    expect(text).toBe(plain);
  });
});
