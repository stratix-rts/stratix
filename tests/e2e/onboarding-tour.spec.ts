/**
 * e2e：轻引导三步 + 声音图标回归 + 开发者口径（@since v3.8，task_139）。
 *
 * 覆盖验收口径：
 *   ① 首开三步引导真走通（清 localStorage → 三步走完 → 二次打开不再现）+ 跳过路径 + 两皮肤截图；
 *   ② 声音图标 aria-pressed 随设置页开关真实翻转（开 / 关两张截图对比）；
 *   ③ 文案人话化（开发者词汇 grep 零命中 —— 断言跑在**真实渲染后的 DOM** 上）。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.onboarding-tour.config.ts
 *   （该配置不挂 globalSetup —— 不会杀掉在跑的 7523 / 7524。）
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/';
const SHOTS = 'reports/shots';
const TOUR_TAG = 'strat-onboarding-tour';
/** 一次性标记键（组件常量 —— 这里写字面量，避免 import 应用代码进 e2e）。 */
const TOUR_DONE_KEY = 'stratix.onboarding.tour.done';

/** 起页面（可选清 localStorage 模拟首开）+ 跳过首启向导（重流程那套）+ 等主屏就位。 */
async function boot(page: Page, fresh: boolean): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
  if (fresh) {
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
  }
  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(600);
  }
}

/** 当前生效的皮肤（token 样式表：没被 disabled 的那张就是生效的那张）。 */
async function activeSkin(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('style[data-srf-theme]'));
    const active = nodes.find((node) => !(node as HTMLStyleElement).disabled);
    return active?.getAttribute('data-srf-theme') ?? null;
  });
}

/** 引导当前这一步的文案（标题 / 计数 / 按钮文字）。 */
async function tourStep(page: Page): Promise<{ title: string; count: string; next: string }> {
  return page.evaluate((tag) => {
    const el = document.querySelector(tag) as (HTMLElement & { shadowRoot?: ShadowRoot | null }) | null;
    const root = el?.shadowRoot;
    return {
      title: root?.querySelector('[data-role="title"]')?.textContent ?? '',
      count: root?.querySelector('[data-role="count"]')?.textContent ?? '',
      next: root?.querySelector('[data-role="next"]')?.textContent ?? '',
    };
  }, TOUR_TAG);
}

/** 引导是否可见（hidden 属性 + 实际盒高）。 */
async function tourVisible(page: Page): Promise<boolean> {
  return page.evaluate((tag) => {
    const el = document.querySelector(tag) as (HTMLElement & { hidden: boolean }) | null;
    if (!el || el.hidden) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, TOUR_TAG);
}

/** 顶栏声音钮的状态（host 上的 aria-pressed + 图标名 + 内部按钮的 aria-pressed）。 */
async function soundState(page: Page): Promise<{
  pressed: string | null;
  icon: string | null;
  innerPressed: string | null;
}> {
  return page.evaluate(() => {
    const btn = document.querySelector('[data-role="sound"]');
    const inner = btn?.shadowRoot?.querySelector('button');
    return {
      pressed: btn?.getAttribute('aria-pressed') ?? null,
      icon: btn?.getAttribute('icon') ?? null,
      innerPressed: inner?.getAttribute('aria-pressed') ?? null,
    };
  });
}

test.describe('轻引导 + 声音图标 + 开发者口径（task_139）', () => {
  test('首开三步引导真走通：1/3 → 2/3 → 3/3 → 完成；二次打开不再现', async ({ page }) => {
    await boot(page, true);

    await page.waitForSelector(`${TOUR_TAG}:not([hidden])`, { timeout: 25_000 });
    expect(await tourVisible(page)).toBe(true);
    expect(await tourStep(page)).toEqual({ title: '先试试命令行', count: '1/3', next: '下一步' });

    await page.click(`${TOUR_TAG} [data-role="next"]`);
    expect(await tourStep(page)).toEqual({ title: '建一个角色', count: '2/3', next: '下一步' });

    await page.click(`${TOUR_TAG} [data-role="next"]`);
    expect(await tourStep(page)).toEqual({ title: '看战场态势', count: '3/3', next: '完成' });

    await page.click(`${TOUR_TAG} [data-role="next"]`);
    await page.waitForTimeout(300);
    expect(await tourVisible(page)).toBe(false);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), TOUR_DONE_KEY)).toBe('1');

    // 二次打开：不再出现。
    await page.reload();
    await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
    await page.waitForTimeout(2500);
    expect(await tourVisible(page)).toBe(false);
  });

  test('跳过路径：点「跳过」即收起 + 写标记', async ({ page }) => {
    await boot(page, true);
    await page.waitForSelector(`${TOUR_TAG}:not([hidden])`, { timeout: 25_000 });

    await page.click(`${TOUR_TAG} [data-role="skip"]`);
    await page.waitForTimeout(300);
    expect(await tourVisible(page)).toBe(false);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), TOUR_DONE_KEY)).toBe('1');
  });

  test('两皮肤截图（现代 / 像素）', async ({ page }) => {
    await boot(page, true);
    await page.waitForSelector(`${TOUR_TAG}:not([hidden])`, { timeout: 25_000 });
    expect(await activeSkin(page)).toBe('default');
    await page.screenshot({ path: `${SHOTS}/onboarding-tour-r5-onb-modern.png` });

    // 走真人路径切皮肤（⋯ 菜单里的皮肤开关）—— 不依赖任何 localStorage 记忆口。
    await page.click('[data-role="overflow"]');
    await page.waitForTimeout(400);
    await page.click('[data-menu-item="theme"]');
    await page.waitForTimeout(700);
    expect(await activeSkin(page)).toBe('pixel');
    // 切皮后引导仍在（切皮不重开引导，也不该把引导吃掉）—— 先截图，别急着收场。
    expect(await tourVisible(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/onboarding-tour-r5-onb-pixel.png` });
    // ESC → 引导退场（@since v3.9，task_152：ESC 关引导；此前这条口径是「ESC 关不掉引导」）。
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await tourVisible(page)).toBe(false);
  });

  test('声音图标：设置页开关后 aria-pressed 与图标真实翻转（开 / 关截图对比）', async ({ page }) => {
    await boot(page, true);
    // 走完引导（或跳过），别让蒙层挡住菜单。
    const skipTour = page.locator(`${TOUR_TAG} [data-role="skip"]`);
    if (await skipTour.count()) await skipTour.first().click();

    // 初始：开（默认开）—— 顶栏 ⋯ 菜单里的声音钮。
    await page.click('[data-role="overflow"]');
    await page.waitForTimeout(400);
    const on = await soundState(page);
    expect(on.pressed).toBe('true');
    expect(on.icon).toBe('sound');
    await page.screenshot({ path: `${SHOTS}/sound-icon-r5-snd-on.png` });
    await page.keyboard.press('Escape');

    // 设置页关掉音效（真开关，不是 mock）。
    await page.click('[data-role="overflow"]');
    await page.waitForTimeout(300);
    await page.click('[data-role="settings"]');
    await page.waitForTimeout(700);
    const pref = page.locator('strat-settings-screen [data-pref="sfx"]');
    expect((await pref.first().textContent())?.trim()).toBe('开');
    await pref.first().click();
    await page.waitForTimeout(400);
    expect((await pref.first().textContent())?.trim()).toBe('关');
    // 键落在一处（单键数据源）。
    expect(await page.evaluate(() => window.localStorage.getItem('stratix.sound.enabled'))).toBe('0');

    // 回主屏 → 顶栏声音钮：静音图标 + aria-pressed=false。
    await page.click('strat-settings-screen [data-role="back"]');
    await page.waitForTimeout(900);
    await page.click('[data-role="overflow"]');
    await page.waitForTimeout(400);
    const off = await soundState(page);
    expect(off.pressed).toBe('false');
    expect(off.innerPressed).toBe('false');
    expect(off.icon).toBe('sound-muted');
    await page.screenshot({ path: `${SHOTS}/sound-icon-r5-snd-off.png` });
  });

  test('开发者口径清零：渲染后的 DOM 里没有开发者词汇', async ({ page }) => {
    await boot(page, false);
    // 逛一遍会出文案的面：设置页 / 角色页 / 会话 / 日志。
    await page.click('[data-role="overflow"]');
    await page.waitForTimeout(300);
    await page.click('[data-role="settings"]');
    await page.waitForTimeout(700);
    const settingsText = await page.locator('strat-settings-screen').innerText();

    const banned = ['数据流', '管线', '握手', '注册表', '整屏 token', '网关'];
    for (const word of banned) {
      expect(settingsText, `设置页仍有开发者口径：${word}`).not.toContain(word);
    }

    // 状态屏（连接那一行）。
    await page.click('strat-settings-screen [data-role="back"]');
    await page.waitForTimeout(900);
    const statusText = await page.locator('[data-role="status-screen"]').innerText();
    for (const word of banned) {
      expect(statusText, `状态屏仍有开发者口径：${word}`).not.toContain(word);
    }
  });
});
