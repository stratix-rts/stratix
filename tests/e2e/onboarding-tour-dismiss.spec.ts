/**
 * e2e：轻引导退场（@since v3.9，task_152）—— 用户实测「点跳过后浮层不退场 / 模态框遮挡页面」。
 *
 * 覆盖验收口径：
 *   ① 点「跳过」→ 浮层**当场消失**（DOM 里不再有这个浮层）+ 底层交互恢复 + 一次性标记写入；
 *   ② 三步走完「完成」→ 同样当场退场；
 *   ③ ESC 关闭引导生效（焦点不在引导里也要生效）；
 *   ④ 二次打开不再现（既有持久化口径不破坏）。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.onboarding-tour.config.ts
 *   （该配置不挂 globalSetup —— 不会杀掉在跑的 7523 / 7524。）
 */

import { expect, test, type Page } from '@playwright/test';

/**
 * 首启向导只在「名册为空」时出现 —— 而「连本地网关」是默认（@since v3.10，task_153），
 * 默认模式下网关名册里就有角色，向导不会拉起。故本剧本显式走**本地直连**模式
 * （`?stratix-remote=0` = dev-flags 的 URL 覆盖口，见 src/app/main/dev-flags.ts）。
 */
const APP_URL = '/?stratix-remote=0';
const SHOTS = 'reports/shots';
const TOUR_TAG = 'strat-onboarding-tour';
/** 一次性标记键（组件常量 —— 这里写字面量，避免 import 应用代码进 e2e）。 */
const TOUR_DONE_KEY = 'stratix.onboarding.tour.done';

/** 起页面（清 localStorage 模拟首开）+ 等主屏就位。 */
async function boot(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
}

/** 浮层是否还在（DOM 里存在 = 还在；只看显示会漏掉「隐藏但仍占位」的壳）。 */
async function tourMounted(page: Page): Promise<boolean> {
  return page.evaluate((tag) => document.querySelectorAll(tag).length > 0, TOUR_TAG);
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

/** 底层交互是否恢复：顶栏「更多」菜单点得开、菜单项在。 */
async function underlyingInteractive(page: Page): Promise<boolean> {
  await page.click('[data-role="overflow"]');
  await page.waitForTimeout(400);
  const visible = await page
    .locator('[data-menu-item="theme"]')
    .first()
    .isVisible()
    .catch(() => false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return visible;
}

test.describe('轻引导退场（task_152）', () => {
  test('点「跳过」→ 浮层当场消失 + 交互恢复 + 写标记', async ({ page }) => {
    await boot(page);
    await page.waitForSelector(`${TOUR_TAG}:not([hidden])`, { timeout: 25_000 });
    expect(await tourMounted(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/onboarding-tour-r10-01-before-skip.png` });

    await page.click(`${TOUR_TAG} [data-role="skip"]`);
    // 当场（不等动画）就该没了 —— 断言 DOM 里不再有这个浮层。
    await page.waitForFunction(
      (tag) => document.querySelectorAll(tag).length === 0,
      TOUR_TAG,
      { timeout: 3_000 }
    );
    expect(await tourMounted(page)).toBe(false);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), TOUR_DONE_KEY)).toBe('1');
    // 退场后底层完全可交互。
    expect(await underlyingInteractive(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/onboarding-tour-r10-02-after-skip.png` });
  });

  test('三步走完「完成」→ 同样当场退场', async ({ page }) => {
    await boot(page);
    await page.waitForSelector(`${TOUR_TAG}:not([hidden])`, { timeout: 25_000 });
    expect(await tourStep(page)).toEqual({ title: '先试试命令行', count: '1/3', next: '下一步' });

    await page.click(`${TOUR_TAG} [data-role="next"]`);
    expect(await tourStep(page)).toEqual({ title: '建一个角色', count: '2/3', next: '下一步' });
    await page.click(`${TOUR_TAG} [data-role="next"]`);
    expect(await tourStep(page)).toEqual({ title: '看战场态势', count: '3/3', next: '完成' });
    await page.screenshot({ path: `${SHOTS}/onboarding-tour-r10-03-step3.png` });

    await page.click(`${TOUR_TAG} [data-role="next"]`);
    await page.waitForFunction(
      (tag) => document.querySelectorAll(tag).length === 0,
      TOUR_TAG,
      { timeout: 3_000 }
    );
    expect(await tourMounted(page)).toBe(false);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), TOUR_DONE_KEY)).toBe('1');
    expect(await underlyingInteractive(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/onboarding-tour-r10-04-after-complete.png` });
  });

  test('ESC 关闭引导生效（焦点不在引导里也关得掉）', async ({ page }) => {
    await boot(page);
    await page.waitForSelector(`${TOUR_TAG}:not([hidden])`, { timeout: 25_000 });

    // 焦点没落在引导里（用户只是看着它）—— 这正是之前 ESC 关不掉的原因。
    await page.evaluate(() => (document.body as HTMLElement).focus());
    await page.keyboard.press('Escape');

    await page.waitForFunction(
      (tag) => document.querySelectorAll(tag).length === 0,
      TOUR_TAG,
      { timeout: 3_000 }
    );
    expect(await tourMounted(page)).toBe(false);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), TOUR_DONE_KEY)).toBe('1');
    expect(await underlyingInteractive(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/onboarding-tour-r10-05-after-esc.png` });
  });

  test('二次打开不再现（持久化口径不破坏）', async ({ page }) => {
    await boot(page);
    await page.waitForSelector(`${TOUR_TAG}:not([hidden])`, { timeout: 25_000 });
    await page.click(`${TOUR_TAG} [data-role="skip"]`);
    await page.waitForFunction(
      (tag) => document.querySelectorAll(tag).length === 0,
      TOUR_TAG,
      { timeout: 3_000 }
    );

    await page.reload();
    await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
    await page.waitForTimeout(2500);
    expect(await tourMounted(page)).toBe(false);
  });
});
