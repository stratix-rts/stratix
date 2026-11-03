/**
 * e2e：图标系统 + DOM 微交互基线（@since v3.6，task_121）。
 *
 * 覆盖验收口径：
 *   ① 顶栏**无 emoji**：原来 🔊 / 🎬 / ▶ / ⋯ 四个字形全部换成 inline SVG；
 *   ② 顶栏任一按钮 hover 有可见态变化（computed style 前后不同）；
 *   ③ 主要面板（更多菜单 / 会话面板 / 日志抽屉 / 设置页）出入场有 120–180ms 的 CSS transition；
 *   ④ 信息层级三档按钮点击后当前层点亮（激活态可见）。
 *
 * 跑法（**不要**用仓库默认配置 —— 它的 globalSetup 会杀掉 7523/7524 上的进程）：
 *   npx playwright test --config=tests/e2e/playwright.hud.config.ts
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/src/app/main/index.html';

/** emoji 码位：表情 / 符号 / 杂项 / 装饰（含 ▶ ⚠️ 等"看着像图标"的字形）。 */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}\u{2300}-\u{23FF}\u{2B50}\u{203C}\u{2049}\u{2122}\u{2139}\u{3030}\u{303D}\u{3297}\u{3299}]/u;

/** 起页面：进主屏、必要时跳过首启向导、等命令面板就位。 */
async function boot(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForSelector('strat-command-panel', { timeout: 15_000 });

  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(500);
  }
}

/**
 * 收集一棵 DOM 子树的全部可见文本（**含 shadow DOM**）——
 * 按钮的文字/图标都在 shadow 里，只扫 light DOM 会漏。
 */
async function collectText(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const parts: string[] = [];
    const walk = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent ?? '');
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        parts.push(el.getAttribute('title') ?? '');
        parts.push(el.getAttribute('aria-label') ?? '');
        parts.push(el.textContent ?? '');
      }
      // 元素 / 文档片段（shadow root）都继续往下走。
      const shadow = (node as HTMLElement).shadowRoot;
      if (shadow) walk(shadow);
      node.childNodes.forEach(walk);
    };
    const root = document.querySelector(sel);
    if (root) walk(root);
    return parts.join(' ');
  }, selector);
}

/** 读某个元素的 computed transition（duration 列表 + 属性列表）。 */
async function transitionOf(
  page: Page,
  selector: string,
  root: 'document' | 'shadow' = 'document',
): Promise<{ duration: string; property: string }> {
  return page.evaluate(
    ({ sel, useShadow }) => {
      const host = document.querySelector(sel) as (Element & { shadowRoot: ShadowRoot | null }) | null;
      if (!host) return { duration: '', property: '' };
      const target = useShadow && host.shadowRoot
        ? host.shadowRoot.querySelector('.body')
        : host;
      if (!target) return { duration: '', property: '' };
      const cs = getComputedStyle(target);
      return { duration: cs.transitionDuration, property: cs.transitionProperty };
    },
    { sel: selector, useShadow: root === 'shadow' },
  );
}

/** 解析 "0.14s, 0.14s" 形式的时长列表 → 毫秒数组。 */
function durationsMs(duration: string): number[] {
  return duration
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => (part.endsWith('ms') ? parseFloat(part) : parseFloat(part) * 1000));
}

test.describe('图标系统 + 微交互基线（task_121）', () => {
  test('① 顶栏无 emoji：四件按钮都是 inline SVG', async ({ page }) => {
    await boot(page);

    const topbarText = await collectText(page, '.hud-topbar');
    const emoji = Array.from(topbarText).filter((ch) => EMOJI_RE.test(ch));
    expect(emoji, `顶栏残留 emoji：${emoji.join('')}`).toEqual([]);

    // 四件按钮（声音 / 导演 / 演示 / 更多）都渲染出 SVG，且描边取 currentColor。
    for (const role of ['sound', 'director', 'demo', 'overflow']) {
      const svg = page.locator(`[data-role="${role}"] svg.srf-icon`);
      await expect(svg, `${role} 按钮没有 SVG 图标`).toHaveCount(1);
      expect(await svg.getAttribute('stroke')).toBe('currentColor');
      expect(await svg.getAttribute('stroke-width')).toBe('1.5');
    }

    // 溢出菜单五项：图标 + 文字（文字没丢）。
    await page.locator('[data-role="overflow"]').click();
    const menu = page.locator('[data-role="overflow-menu"]');
    await expect(menu).toBeVisible();
    for (const role of ['chat', 'sessions', 'character', 'settings', 'theme']) {
      await expect(menu.locator(`[data-role="${role}"] svg.srf-icon`)).toHaveCount(1);
    }
  });

  test('② 顶栏按钮 hover 有可见态变化（computed style 前后不同）', async ({ page }) => {
    await boot(page);

    for (const role of ['sound', 'director', 'demo', 'overflow']) {
      const button = page.locator(`[data-role="${role}"]`);
      const before = await button.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, background: cs.backgroundColor, transform: cs.transform };
      });

      await button.hover();
      await page.waitForTimeout(300);

      const after = await button.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, background: cs.backgroundColor, transform: cs.transform };
      });

      // 至少有一项变了（颜色 / 亮度 / 描边 / 位移）才算"看得见的 hover"。
      expect(
        after.color !== before.color
        || after.background !== before.background
        || after.transform !== before.transform,
        `${role} 按钮 hover 后 computed style 没变化`,
      ).toBe(true);
    }
  });

  test('③ 主要面板出入场有 120–180ms 的 CSS transition', async ({ page }) => {
    await boot(page);

    // 更多菜单（顶栏 ⋯ 弹层）
    const menuTransition = await transitionOf(page, '[data-role="overflow-menu"]');
    expect(menuTransition.duration, '更多菜单没有 transition').not.toBe('');
    expect(menuTransition.property).toContain('opacity');
    for (const ms of durationsMs(menuTransition.duration)) {
      expect(ms).toBeGreaterThanOrEqual(120);
      expect(ms).toBeLessThanOrEqual(180);
    }

    // 会话面板 / 日志抽屉（shadow 内的 .body）
    for (const tag of ['strat-session-panel', 'strat-log-drawer']) {
      const t = await transitionOf(page, tag, 'shadow');
      expect(t.duration, `${tag} 没有 transition`).not.toBe('');
      expect(t.property).toContain('opacity');
      for (const ms of durationsMs(t.duration)) {
        expect(ms).toBeGreaterThanOrEqual(120);
        expect(ms).toBeLessThanOrEqual(180);
      }
    }

    // 设置页（走全屏弹窗壳：遮罩 + 居中面板）
    await page.locator('[data-role="overflow"]').click();
    await page.locator('[data-role="settings"]').click();
    const panel = page.locator('.hud-modal-panel');
    await expect(panel).toBeVisible();
    const panelTransition = await transitionOf(page, '.hud-modal-panel');
    expect(panelTransition.duration, '设置页弹窗没有 transition').not.toBe('');
    for (const ms of durationsMs(panelTransition.duration)) {
      expect(ms).toBeGreaterThanOrEqual(120);
      expect(ms).toBeLessThanOrEqual(180);
    }
  });

  test('④ 信息层级三档：点 L2 → 当前层点亮（激活态可见）', async ({ page }) => {
    await boot(page);

    const button = page.locator('.hud-layer-switch-btn[data-layer="L2"]');
    await expect(button).toBeVisible();

    const before = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
    await button.click();
    await page.waitForTimeout(300);

    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const after = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(after, 'L2 激活后底色没变（看不出来）').not.toBe(before);

    // 其它两档熄灭。
    await expect(page.locator('.hud-layer-switch-btn[data-layer="L1"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.hud-layer-switch-btn[data-layer="L3"]')).toHaveAttribute('aria-pressed', 'false');
  });
});
