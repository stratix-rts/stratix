/**
 * e2e：皮肤系统（@since v3.6，task_115）。
 *
 * 覆盖验收口径（死功能 #3 的原症状）：
 *   ① 三处入口（设置页皮肤区 / ⋯ 菜单「像素风」/ 底栏命令「切换到像素风」）任一切换 →
 *      HUD 的 token **真的变了**（computed style 断言：边框宽度 / 背景色 / 主色 / 字体栈都不同）；
 *   ② localStorage 记住皮肤，**刷新后仍是同一套**；
 *   ③ 全程 console 无「未处理 command」警告（此前每切一次皮肤就报一条）。
 *
 * 跑法：npx playwright test tests/e2e/skin-switch.spec.ts
 *   （仓库默认的 globalSetup 会清端口 7523/7524 —— 只在需要重起服务时才用默认配置。）
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/src/app/main/index.html';
const SKIN_KEY = 'stratix.skin';

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

/** 读 HUD 皮肤 token（computed style —— 真落到 DOM 上的那一层）。 */
async function skinTokens(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const pick = (name: string): string => cs.getPropertyValue(name).trim();
    return {
      bg: pick('--srf-bg'),
      panel: pick('--srf-panel'),
      accent: pick('--srf-accent'),
      radius: pick('--srf-radius'),
      borderWidth: pick('--srf-border-width'),
      font: pick('--srf-font-ui'),
      fontSize: pick('--srf-font-size-md'),
    };
  });
}

/** 打开 ⋯ 溢出菜单（里面的「像素风」入口）。 */
async function openOverflow(page: Page): Promise<void> {
  await page.locator('[data-role="overflow"]').click();
  await expect(page.locator('[data-role="overflow-menu"]')).toBeVisible();
}

/** 点设置屏里的某个皮肤按钮（设置屏在 shadow DOM 里）。 */
async function clickSettingsSkin(page: Page, skin: 'default' | 'pixel'): Promise<void> {
  const button = page.locator('strat-settings-screen').locator(`button[data-skin="${skin}"]`);
  await button.click();
}

test.describe('皮肤切换', () => {
  test('⋯ 菜单切到像素风 → HUD token 真变（视觉不是 0 变化）', async ({ page }) => {
    await boot(page);
    const before = await skinTokens(page);

    await openOverflow(page);
    await page.locator('[data-role="theme"]').click();
    await page.waitForTimeout(400);

    const after = await skinTokens(page);
    // 直角边框 + 2px 硬边框 + 换主色 + 换背景 —— 四项都不同才算「视觉显著变化」。
    expect(after.borderWidth).not.toBe(before.borderWidth);
    expect(after.radius).not.toBe(before.radius);
    expect(after.accent).not.toBe(before.accent);
    expect(after.bg).not.toBe(before.bg);
    expect(after.font).not.toBe(before.font);
  });

  test('设置页皮肤区切换 → token 真变 + 记忆写进 localStorage', async ({ page }) => {
    await boot(page);
    const before = await skinTokens(page);

    await openOverflow(page);
    await page.locator('[data-role="settings"]').click();
    await expect(page.locator('strat-settings-screen')).toBeVisible();
    await clickSettingsSkin(page, 'pixel');
    await page.waitForTimeout(400);

    const after = await skinTokens(page);
    expect(after.borderWidth).not.toBe(before.borderWidth);
    expect(after.accent).not.toBe(before.accent);
    expect(await page.evaluate((key) => localStorage.getItem(key), SKIN_KEY)).toBe('pixel');
  });

  test('底栏命令「切换到像素风」→ token 真变', async ({ page }) => {
    await boot(page);
    const before = await skinTokens(page);

    await page.locator('strat-command-panel').locator('button[data-command="theme.pixel"]').click();
    await page.waitForTimeout(400);

    const after = await skinTokens(page);
    expect(after.borderWidth).not.toBe(before.borderWidth);
    expect(after.accent).not.toBe(before.accent);
  });

  test('刷新后仍是上次那套皮肤（记忆生效）', async ({ page }) => {
    await boot(page);
    await openOverflow(page);
    await page.locator('[data-role="theme"]').click();
    await page.waitForTimeout(400);
    const switched = await skinTokens(page);

    await page.reload();
    await page.waitForSelector('strat-command-panel', { timeout: 15_000 });
    await page.waitForTimeout(800);

    const reloaded = await skinTokens(page);
    expect(reloaded.borderWidth).toBe(switched.borderWidth);
    expect(reloaded.accent).toBe(switched.accent);
    expect(reloaded.font).toBe(switched.font);
    expect(await page.evaluate((key) => localStorage.getItem(key), SKIN_KEY)).toBe('pixel');
  });

  test('全程 console 无「未处理 command」警告', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') problems.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

    await boot(page);
    await openOverflow(page);
    await page.locator('[data-role="theme"]').click();
    await page.waitForTimeout(400);
    await openOverflow(page);
    await page.locator('[data-role="theme"]').click();
    await page.waitForTimeout(400);

    // 此前每切一次皮肤就报一条「[Stratix] 未处理 command: theme.set」—— 现在一条都没有。
    expect(problems.filter((p) => p.includes('未处理'))).toEqual([]);
    expect(problems.filter((p) => p.startsWith('pageerror'))).toEqual([]);
    // 资源加载失败（WS/后端未起）属环境噪音，不算皮肤回归 —— 但除此之外不许有告警/报错。
    expect(problems.filter((p) => !p.includes('Failed to load resource'))).toEqual([]);
  });
});
