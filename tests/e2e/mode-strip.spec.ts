/**
 * e2e：模式状态指示（@since v3.6，task_117）。
 *
 * 覆盖死功能报告 P3#9 / P3#10 的原症状与验收口径：
 *   ① 演示模式（▶）开启 → 1s 内出现可见指示（写着是什么 + 怎么关）+ 顶栏按钮点亮；
 *   ② 导演镜头（🎬）同理 → 「导演镜头 ON」指示 + 顶栏按钮点亮；
 *   ③ 刷新后指示与 localStorage 一致（演示模式的记忆在 UI 有可见反映）；
 *   ④ 点指示可关闭（点完指示消失、按钮熄灭、localStorage 回到 off）。
 *
 * 跑法：npx playwright test tests/e2e/mode-strip.spec.ts
 *   （仓库默认的 globalSetup 会清端口 7523/7524 —— 只在需要重起服务时才用默认配置。）
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/src/app/main/index.html';
const STRIP = 'strat-mode-strip';

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

/** 指示细条本体（顶栏下方的全局细条；开着时才可见）。 */
function strip(page: Page) {
  return page.locator(STRIP);
}

/** 某个模式的指示项（demo / director）。 */
function item(page: Page, mode: 'demo' | 'director') {
  return page.locator(`${STRIP} [data-mode="${mode}"]`);
}

/** 顶栏开关按钮（▶ 演示 / 🎬 导演）。 */
function topbarButton(page: Page, role: 'demo' | 'director') {
  return page.locator(`strat-button[data-role="${role}"]`);
}

test.describe('模式状态指示（演示模式 / 导演镜头）', () => {
  test.beforeEach(async ({ page }) => {
    // 演示模式记在 localStorage 里 —— 每个用例从干净状态起。
    await page.goto(APP_URL);
    await page.evaluate(() => window.localStorage.clear());
  });

  test('开启演示模式 → 1s 内出现可见指示 + 顶栏按钮点亮', async ({ page }) => {
    await boot(page);

    // 未开启时不该有指示（不占版面、不留残影）。
    await expect(strip(page)).toBeHidden();

    await topbarButton(page, 'demo').click();

    // 1s 内出现可见指示（验收口径 1）。
    await expect(item(page, 'demo')).toBeVisible({ timeout: 1000 });
    await expect(item(page, 'demo')).toContainText('演示模式运行中');
    await expect(item(page, 'demo')).toContainText('点击退出');

    // 顶栏按钮点亮（点亮即状态 —— 不另挂文字标签）。
    await expect(topbarButton(page, 'demo')).toHaveAttribute('aria-pressed', 'true');
    await expect(topbarButton(page, 'demo')).toHaveAttribute('variant', 'primary');
  });

  test('开启导演镜头 → 出现「导演镜头 ON」指示 + 顶栏按钮点亮', async ({ page }) => {
    await boot(page);

    await topbarButton(page, 'director').click();

    await expect(item(page, 'director')).toBeVisible({ timeout: 1000 });
    await expect(item(page, 'director')).toContainText('导演镜头 ON');
    await expect(item(page, 'director')).toContainText('点击退出');
    await expect(topbarButton(page, 'director')).toHaveAttribute('aria-pressed', 'true');
    await expect(topbarButton(page, 'director')).toHaveAttribute('variant', 'primary');
  });

  test('刷新后指示与 localStorage 状态一致（演示模式的记忆在 UI 可见）', async ({ page }) => {
    await boot(page);
    await topbarButton(page, 'demo').click();
    await expect(item(page, 'demo')).toBeVisible({ timeout: 1000 });

    // 刷新 —— 演示模式的 localStorage 记忆应当直接反映到 UI 上。
    await page.reload();
    await page.waitForSelector('strat-command-panel', { timeout: 15_000 });
    const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
    if (await skip.count()) {
      await skip.first().click();
      await page.waitForTimeout(500);
    }

    await expect(item(page, 'demo')).toBeVisible({ timeout: 1000 });
    await expect(topbarButton(page, 'demo')).toHaveAttribute('aria-pressed', 'true');
    // 记忆的是「开」（'on'），不是「关」—— 否则指示是骗人的。
    expect(await page.evaluate(() => window.localStorage.getItem('stratix.demo-mode'))).toBe('on');
  });

  test('点指示即可退出（演示模式 / 导演镜头各自退出）', async ({ page }) => {
    await boot(page);

    // 演示模式：点指示 → 指示消失 + 按钮熄灭 + 记忆回到 off。
    await topbarButton(page, 'demo').click();
    await expect(item(page, 'demo')).toBeVisible({ timeout: 1000 });
    await item(page, 'demo').click();
    await expect(item(page, 'demo')).toBeHidden();
    await expect(strip(page)).toBeHidden();
    await expect(topbarButton(page, 'demo')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => window.localStorage.getItem('stratix.demo-mode'))).toBe('off');

    // 导演镜头：点指示 → 指示消失 + 按钮熄灭。
    await topbarButton(page, 'director').click();
    await expect(item(page, 'director')).toBeVisible({ timeout: 1000 });
    await item(page, 'director').click();
    await expect(item(page, 'director')).toBeHidden();
    await expect(strip(page)).toBeHidden();
    await expect(topbarButton(page, 'director')).toHaveAttribute('aria-pressed', 'false');
  });
});
