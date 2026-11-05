/**
 * e2e：底部双框合一 + 新建角色一级入口（@since v3.10，task_154）。
 *
 * ★ @since v3.11（task_155）输入语义定稿后的口径变更：
 *   · 底部仍只有**一个**输入面，但**行内标题 chip 与「发起」按钮已删** ——
 *     发起流程里不再有标题编辑环节（标题由 Agent 首轮回报生成）；
 *   · 命令一律带 `/` 前缀（`/help` / `/mission` / `/theme`）——
 *     非 `/` 开头一律是提示词（回车直接发起任务）。
 *   提示词直发的全流程断言在 tests/e2e/task155-input-semantics.spec.ts。
 *
 * 覆盖验收口径：
 *   ① 底部只有**一个**输入框（常驻的「任务标题」框已删）；
 *   ② 发起流程里没有标题编辑环节（行内 chip / 「发起」按钮都不存在）；
 *   ③ 短命令零回归（/help / /mission / /theme 照旧能执行）；
 *   ④ 顶栏「+ 角色」可见 → 直达**建档表单**（首启向导，不落到角色中心那种死路）；
 *   ⑤ 全流程「点按钮 → 填表 → 保存 → 上场 → toast」：单位 ≤5s 上战场 + toast「已上场」
 *      （测完把测试角色删掉，别留垃圾档案）。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.task154.config.ts
 *   （该配置不挂 globalSetup —— 不会杀掉在跑的 7523 / 7524。）
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/src/app/main/index.html';
const SHOTS = 'reports/shots';
const DIALOG = 'strat-new-task-dialog';

/** 测试角色名前缀（跑完删掉，不留垃圾档案）。 */
const TEST_NAME_PREFIX = '十一测-';

/** 起页面：进主屏、必要时跳过首启向导与轻引导、等命令面板就位。 */
async function boot(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(800);
  }
  // 轻引导（三步指路）会盖住底栏 —— 不跳过的话它把点击全拦下来（Pointer events 被截）。
  const tourSkip = page.locator('strat-onboarding-tour [data-role="skip"]');
  if (await tourSkip.count()) {
    await tourSkip.first().click();
    await page.waitForTimeout(400);
  }
}

/** 面板里的输入面（@since v3.11，task_155：只有 composer —— 行内标题 chip 已删）。 */
function inputs(page: Page) {
  return page.locator('strat-command-panel').locator('textarea[data-role="query"]');
}

/** 当前**可见**的输入框个数（隐藏的不算）。 */
async function visibleInputCount(page: Page): Promise<number> {
  return inputs(page).evaluateAll((els) =>
    els.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).length
  );
}

/** 面板回执区文案。 */
function outputText(page: Page) {
  return page.locator('strat-command-panel').locator('[data-role="output"]').innerText();
}

/** toast 宿主里的文案列表。 */
async function toastTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.querySelector('strat-toast-host');
    if (!host) return [];
    return Array.from(host.shadowRoot?.querySelectorAll('.toast') ?? []).map((t) => t.textContent ?? '');
  });
}

/** 战场单位名列表（真状态 —— 不是造出来的假数据）。 */
async function unitNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const app = (window as unknown as {
      __srfApp?: { snapshot: () => { units: { name: string }[] } };
    }).__srfApp;
    return (app?.snapshot().units ?? []).map((u) => u.name);
  });
}

test.describe('底部双框合一（task_154）', () => {
  test('底部只有一个输入框：常驻标题框已删（前后对照截图）', async ({ page }) => {
    await boot(page);

    // ① 平时只有 composer 一个输入面。
    expect(await visibleInputCount(page)).toBe(1);

    // ② 常驻的「任务标题」框彻底没了（不是被藏起来 —— DOM 里就不该有）。
    const oldDraft = page.locator('strat-command-panel').locator('[data-role="draft"]');
    expect(await oldDraft.count()).toBe(0);

    // ③ 底栏本身也不该有第二个 input（composer 之外）。
    const barInputs = await page.locator('.hud-bottom-bar').evaluate((bar) => {
      const panel = bar.querySelector('strat-command-panel') as
        | (HTMLElement & { shadowRoot?: ShadowRoot | null })
        | null;
      const root = panel?.shadowRoot;
      if (!root) return 0;
      return Array.from(root.querySelectorAll('input, textarea')).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length;
    });
    expect(barInputs).toBe(1);

    await page.locator('.hud-bottom-bar').screenshot({
      path: `${SHOTS}/task154-r11-bottom-single-input-ck154.png`,
    });
  });

  test('发起流程里不再有标题编辑环节（@since v3.11，task_155 收编）', async ({ page }) => {
    await boot(page);

    const panel = page.locator('strat-command-panel');
    const composer = panel.locator('textarea[data-role="query"]');
    await composer.click();
    await page.keyboard.insertText(
      '请把事件总线的重构做完，拆成采集层、归一化层与分发层三层。\n采集层只负责拉取原始事件。'
    );

    // ① 行内标题 chip 与「发起」按钮都不在了（154 建的，155 收编删除）。
    expect(await panel.locator('[data-role="task-title"]').count()).toBe(0);
    expect(await panel.locator('[data-role="task-submit"]').count()).toBe(0);

    // ② 标题草稿改成**首行派生**（⌘K 面板与命令清单读的是同一句）。
    const draft = await page.evaluate(() => {
      const el = document.querySelector('strat-command-panel') as
        | (HTMLElement & { draftTitle?: string })
        | null;
      return el?.draftTitle ?? '';
    });
    expect(draft).toBe('请把事件总线的重构做完，拆成采集层、归一化层与分发层三层。');

    await page.locator('.hud-bottom-bar').screenshot({
      path: `${SHOTS}/task154-r11-bottom-taskbar-ck154.png`,
    });
  });

  test('短命令零回归：/help / /mission / /theme 照旧能执行', async ({ page }) => {
    await boot(page);

    const composer = page.locator('strat-command-panel').locator('textarea[data-role="query"]');
    await composer.click();

    // /help → 命令清单照旧。
    await composer.fill('/help');
    await composer.press('Enter');
    await expect.poll(() => outputText(page)).toContain('可用命令');

    // /mission <标题> → 照旧开新建任务对话框（命令路径没被提示词语义吞掉）。
    await composer.fill('/mission 走查验收任务');
    await composer.press('Enter');
    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await expect(dialog).toContainText('走查验收任务');
    await page.locator(`${DIALOG} button.option[data-action="cancel"]`).click();

    // /theme → 照旧切皮肤。
    await composer.fill('/theme');
    await composer.press('Enter');
    await expect.poll(() => outputText(page)).toContain('像素风');
  });
});

test.describe('新建角色一级入口（task_154）', () => {
  test('顶栏「+ 角色」可见 → 点它直达建档表单（向导，不是角色中心死路）', async ({ page }) => {
    await boot(page);

    const button = page.locator('[data-role="create-character"]');
    await expect(button).toBeVisible();
    await expect(button).toContainText('角色');

    await button.click();

    // 直达**建档表单**：首启向导被拉起来（扫描步 = 建档流程第一步）。
    const wizard = page.locator('strat-onboarding-screen');
    await expect(wizard).toBeVisible({ timeout: 10_000 });
    await expect(wizard.locator('[data-role="scan-summary"]')).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/task154-r11-topbar-create-character-ck154.png` });
  });

  test('全流程：点按钮 → 填表 → 保存 → 上场（≤5s）→ toast「已上场」，测完删掉', async ({ page }) => {
    await boot(page);

    // 记录测试前的角色数（跑完按名字删干净）。
    const before = await unitNames(page);

    await page.locator('[data-role="create-character"]').click();
    const wizard = page.locator('strat-onboarding-screen');
    await expect(wizard).toBeVisible({ timeout: 10_000 });

    // ① 扫描步：只勾一个 agent（其余取消 —— 建档名单 = 勾选集）。
    const boxes = wizard.locator('input[data-role="scan-select"]');
    const total = await boxes.count();
    expect(total).toBeGreaterThan(0);
    let kept = '';
    for (let i = 0; i < total; i += 1) {
      const box = boxes.nth(i);
      const kind = (await box.getAttribute('data-kind')) ?? '';
      if (!kept && (await box.isChecked())) {
        kept = kind;
        continue;
      }
      if (await box.isChecked()) await box.uncheck();
    }
    expect(kept).not.toBe('');

    await wizard.locator('[data-action="next"]').click();

    // ② 起名步：填名（带测试前缀），主按钮随之可用。
    const nameInput = wizard.locator('input[data-role="name-input"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    const testName = `${TEST_NAME_PREFIX}顶栏入口`;
    await nameInput.fill(testName);

    await wizard.locator('[data-action="next"]').click();

    // ③ 人设步：点一个预设（预设路径免问卷）。
    const preset = wizard.locator('[data-role="preset-card"]').first();
    await expect(preset).toBeVisible({ timeout: 5000 });
    await preset.click();
    await wizard.locator('[data-action="next"]').click();

    // ④ 确认步 → 完成建档。
    await expect(wizard.locator('[data-role="summary-row"]')).toBeVisible({ timeout: 5000 });
    const started = Date.now();
    await wizard.locator('[data-action="submit"]').click();

    // ⑤ 上场：≤5s 内战场出现该单位（core 同一次广播里投影出来）。
    await expect
      .poll(async () => (await unitNames(page)).includes(testName), { timeout: 5000 })
      .toBe(true);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThanOrEqual(5000);

    // ⑥ toast：轻提示「已上场」。
    await expect
      .poll(async () => (await toastTexts(page)).some((t) => t.includes('已上场')), { timeout: 5000 })
      .toBe(true);

    await page.screenshot({ path: `${SHOTS}/task154-r11-character-onboarded-ck154.png` });

    // ⑦ 测完删掉（别留垃圾档案）。
    const removed = await page.evaluate((name) => {
      const app = (window as unknown as {
        __srfApp?: {
          emitCommand: (c: unknown) => void;
          snapshot: () => { characters: { id: string; name: string }[] };
        };
      }).__srfApp;
      const target = app?.snapshot().characters.find((c) => c.name === name);
      if (!target) return false;
      app?.emitCommand({ type: 'character.delete', characterId: target.id });
      return true;
    }, testName);
    expect(removed).toBe(true);

    await expect
      .poll(async () => (await unitNames(page)).includes(testName), { timeout: 5000 })
      .toBe(false);
    expect(await unitNames(page)).toEqual(before);
  });
});
