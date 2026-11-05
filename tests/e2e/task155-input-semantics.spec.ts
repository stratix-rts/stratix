/**
 * e2e：输入语义定稿（@since v3.11，task_155）—— 提示词默认 + `/` 前缀命令 + 标题 Agent 后置生成。
 *
 * 覆盖验收口径：
 *   ① 底部只有**一个**输入面（常驻「任务标题」框没了，任务条里的行内标题 chip 也没了）；
 *   ② `/` 开头走**命令**路径（help / theme 照旧能执行 —— 既有命令行为不受影响）；
 *   ③ 非 `/` 开头一律是**提示词**：回车直接发起任务，**没有标题确认环节**
 *      （不弹新建任务对话框）；
 *   ④ 发起后任务条标题初始是**占位**「生成中…」（标题由 Agent 首轮回报生成）。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.task155.config.ts
 *   （该配置不挂 globalSetup —— 不会杀掉在跑的 7523 / 7524。）
 *
 * ★ 为什么走**本地模式**（`?stratix-remote=0`）：远程模式下任务是在网关进程里跑的 ——
 *   派一条提示词会让网关**真的拉起一个 CLI agent**（副作用大且不确定）。
 *   本地模式下浏览器自带的 core 是真相源，且没有 cliChat 桥 → 任务只落 queued，
 *   任务单停在 running —— 「标题初始是占位」这条断言因此是确定的。
 *   （「标题被换成生成值」由 jest 覆盖：app 层 task-service 的回报通道 + core 的
 *   applyGeneratedTitle，见 src/app/__tests__/task-service.test.ts。）
 */

import { expect, test, type Page } from '@playwright/test';

/** 本地模式（不走网关）：浏览器自己的 core 是真相源，任务不会被真 agent 执行。 */
const APP_URL = '/?stratix-remote=0';
const SHOTS = 'reports/shots';
const DIALOG = 'strat-new-task-dialog';

/** 面板回执区文案。 */
function outputText(page: Page) {
  return page.locator('strat-command-panel').locator('[data-role="output"]').innerText();
}

/** 起页面：进主屏、跳过首启向导与轻引导、等命令面板就位。 */
async function boot(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(800);
  }
  // 轻引导（三步指路）会盖住底栏 —— 不跳过的话它把点击全拦下来。
  const tourSkip = page.locator('strat-onboarding-tour [data-role="skip"]');
  if (await tourSkip.count()) {
    await tourSkip.first().click();
    await page.waitForTimeout(400);
  }
}

/** 世界态快照（走既有 dev 观测句柄，不开后门）。 */
async function snapshot(page: Page): Promise<{
  units: ReadonlyArray<{ id: string; name: string }>;
  missions: ReadonlyArray<{ id: string; title: string; phase: string }>;
}> {
  return page.evaluate(() => {
    const app = (window as unknown as {
      __srfApp?: { snapshot: () => unknown };
    }).__srfApp;
    return app?.snapshot() as {
      units: ReadonlyArray<{ id: string; name: string }>;
      missions: ReadonlyArray<{ id: string; title: string; phase: string }>;
    };
  });
}

/**
 * 建一个能承接任务的角色（走**真命令**通道，不造数据）——
 * 提示词直发需要承接人，没有角色时面板会如实说「没有可承接的角色」。
 */
async function createAgent(page: Page, name: string): Promise<void> {
  await page.evaluate((agentName) => {
    const app = (window as unknown as {
      __srfApp?: { emitCommand: (command: unknown) => void };
    }).__srfApp;
    app?.emitCommand({
      type: 'character.create',
      name: agentName,
      agentKind: 'claude-code',
      persona: '验收用角色，只回一句话。',
      skinId: 'default',
    });
  }, name);
  // 等角色上场（单位随角色一起建 —— 建角色即建单位）。
  await expect
    .poll(async () => (await snapshot(page)).units.some((u) => u.name === name), { timeout: 10_000 })
    .toBe(true);
}

test.describe('输入语义定稿（task_155）', () => {
  test('底部只有一个输入面：标题框与行内 chip 都没了', async ({ page }) => {
    await boot(page);

    const panel = page.locator('strat-command-panel');
    // 可见输入面只有一个（composer）。
    const visible = await panel.evaluate((root) => {
      const shadow = (root as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (!shadow) return -1;
      return Array.from(shadow.querySelectorAll('input, textarea')).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length;
    });
    expect(visible).toBe(1);

    // 发起流程里不再有标题编辑环节：常驻标题框、行内 chip、「发起」按钮都不存在。
    expect(await panel.locator('[data-role="draft"]').count()).toBe(0);
    expect(await panel.locator('[data-role="task-title"]').count()).toBe(0);
    expect(await panel.locator('[data-role="task-submit"]').count()).toBe(0);

    await page.locator('.hud-bottom-bar').screenshot({
      path: `${SHOTS}/task155-r11-bottom-single-input-ck155.png`,
    });
  });

  test('/ 开头走命令路径：help / theme 照旧能执行', async ({ page }) => {
    await boot(page);

    const composer = page.locator('strat-command-panel').locator('textarea[data-role="query"]');
    await composer.click();

    // /help → 命令清单照旧。
    await composer.fill('/help');
    await composer.press('Enter');
    await expect.poll(() => outputText(page)).toContain('可用命令');

    // /theme → 照旧切皮肤。
    await composer.fill('/theme');
    await composer.press('Enter');
    await expect.poll(() => outputText(page)).toContain('像素风');
  });

  test('非 / 开头回车 → 直接发起任务，没有标题确认步骤', async ({ page }) => {
    await boot(page);
    await createAgent(page, '十五测-甲');

    const composer = page.locator('strat-command-panel').locator('textarea[data-role="query"]');
    await composer.click();
    await composer.fill('把事件总线的重构做完');
    await composer.press('Enter');

    // ① 没有标题确认环节：新建任务对话框**没被打开**（元素常驻在 DOM 里，open 才算打开）。
    const dialogOpen = async (): Promise<boolean> =>
      page.evaluate(() =>
        document.querySelector('strat-new-task-dialog')?.hasAttribute('open') ?? false
      );
    expect(await dialogOpen()).toBe(false);
    await expect(page.locator(DIALOG)).toBeHidden();
    // ② 回执直说「已派发任务」。
    await expect.poll(() => outputText(page)).toContain('已派发任务');

    // ③ 任务单已立（占位标题 · 在办相位），任务挂在它身上。
    await expect
      .poll(async () => (await snapshot(page)).missions.length, { timeout: 5000 })
      .toBeGreaterThan(0);
    const mission = (await snapshot(page)).missions[0];
    expect(mission?.title).toBe('生成中…');
    expect(mission?.phase).toBe('running');

    // ④ 任务条（只读回显）显示占位标题 —— 这就是「标题待生成」看得见的地方。
    const bar = page.locator('strat-command-panel').locator('[data-role="task-bar"]');
    await expect(bar).toBeVisible({ timeout: 3000 });
    await expect(bar.locator('[data-role="task-bar-title"]')).toHaveText('生成中…');

    await page.locator('.hud-bottom-bar').screenshot({
      path: `${SHOTS}/task155-r11-taskbar-placeholder-ck155.png`,
    });
  });

  test('命令与提示词的分家是硬的：裸命令名（无 /）不再当命令', async ({ page }) => {
    await boot(page);
    await createAgent(page, '十五测-乙');

    const composer = page.locator('strat-command-panel').locator('textarea[data-role="query"]');
    await composer.click();

    // 「theme」没有 / 前缀 → 是提示词，不是命令（既有命令只能靠 / 触发）。
    await composer.fill('theme');
    await composer.press('Enter');

    await expect.poll(() => outputText(page)).toContain('已派发任务');
    expect(await outputText(page)).not.toContain('像素风');
  });
});
