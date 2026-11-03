/**
 * e2e：新建任务对话框（@since v3.6，task_112）。
 *
 * 覆盖验收口径：
 *   ① 底栏填标题 → 点「新建任务」→ 对话框 1s 内可见，单任务/流水线/派发/取消四按钮现身；
 *   ② 点「单任务」→ 态势面板任务计数 +1，且有 toast 反馈；
 *   ③ 全程 console 零报错（静默失败即回归）。
 *
 * 跑法：npx playwright test tests/e2e/new-task-dialog.spec.ts
 *   （仓库默认的 globalSetup 会清端口 7523/7524 —— 只在需要重起服务时才用默认配置。）
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/src/app/main/index.html';
const DIALOG = 'strat-new-task-dialog';

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

/** 顶栏胶囊里的任务计数（活跃任务数）。 */
async function missionCount(page: Page): Promise<number> {
  const text = await page.locator('[data-role="mission-count"]').first().innerText();
  return Number(text.trim());
}

/** toast 宿主里的文案列表。 */
async function toastTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.querySelector('strat-toast-host');
    if (!host) return [];
    return Array.from(host.shadowRoot?.querySelectorAll('.toast') ?? []).map((t) => t.textContent ?? '');
  });
}

/** 填标题 → 点「新建任务」。 */
async function openDialog(page: Page, title: string): Promise<void> {
  const panel = page.locator('strat-command-panel');
  await panel.locator('input[data-role="draft"]').fill(title);
  await panel.locator('button[data-command="mission.create"][data-scope="global"]').click();
}

test.describe('新建任务对话框', () => {
  test('填标题点「新建任务」→ 1s 内对话框可见，四按钮现身', async ({ page }) => {
    await boot(page);

    await openDialog(page, '走查验收任务');

    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible({ timeout: 1000 });

    for (const action of ['single', 'pipeline', 'dispatch', 'cancel']) {
      await expect(page.locator(`${DIALOG} button.option[data-action="${action}"]`)).toBeVisible();
    }
    // 对话框主体有尺寸（不是零尺寸的透明壳）。
    const box = await dialog.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);
  });

  test('点「单任务」→ 任务计数 +1 且有 toast 反馈，console 零报错', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await boot(page);

    const before = await missionCount(page);
    await openDialog(page, '走查验收任务');
    await page.locator(`${DIALOG} button[data-action="single"]`).click();

    await expect(page.locator('[data-role="mission-count"]').first()).toHaveText(String(before + 1));
    await expect(page.locator(`${DIALOG}`)).toBeHidden();

    // toast 反馈（core 的 Notice 进 toast 宿主）。
    await expect
      .poll(async () => (await toastTexts(page)).some((t) => t.includes('走查验收任务')), { timeout: 5000 })
      .toBe(true);

    expect(errors).toEqual([]);
  });

  test('点「取消」→ 对话框关闭，不建任务', async ({ page }) => {
    await boot(page);

    const before = await missionCount(page);
    await openDialog(page, '只是路过');
    await page.locator(`${DIALOG} button.option[data-action="cancel"]`).click();

    await expect(page.locator(DIALOG)).toBeHidden();
    expect(await missionCount(page)).toBe(before);
  });

  test('R4 双关闭途径：ESC 与点遮罩都能关掉对话框', async ({ page }) => {
    await boot(page);

    // ① ESC（遮挡控制器的统一 ESC 路由）
    await openDialog(page, '走查验收任务');
    await expect(page.locator(DIALOG)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(DIALOG)).toBeHidden();

    // ② 点遮罩（面板之外的空白处）
    await openDialog(page, '走查验收任务');
    await expect(page.locator(DIALOG)).toBeVisible();
    await page.locator(`${DIALOG} [data-role="backdrop"]`).click({ position: { x: 5, y: 5 } });
    await expect(page.locator(DIALOG)).toBeHidden();
  });
});
