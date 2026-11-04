/**
 * e2e：命令行命令注册表（@since v3.6，task_113）。
 *
 * 覆盖验收口径（死功能 #2 的原症状：底栏命令行敲什么都不认、Enter 毫无反应）：
 *   ① `mission <标题>` → 新建任务对话框 1s 内可见且标题已预填（复用 task_112 的通路）；
 *   ② `theme` → 皮肤真的换了（DOM 上那张 token 样式表变了，不是只发了一条命令）；
 *   ③ `settings` → 设置屏现身；
 *   ④ `replay` → 有人话回执（今天没活儿 / 网关不可用都给提示 + 重试指引）；
 *   ⑤ `help` → 列出全部可用命令；未匹配输入 → 也回一份可用命令清单。
 *
 * 跑法：npx playwright test tests/e2e/command-line.spec.ts
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

/** 在命令行里敲一串并回车（走真实键盘事件）。 */
async function runCommand(page: Page, raw: string): Promise<void> {
  const input = page.locator('strat-command-panel').locator('textarea[data-role="query"]');
  await input.fill(raw);
  await input.press('Enter');
}

/** 命令行回执区文案。 */
async function outputText(page: Page): Promise<string> {
  return page.locator('strat-command-panel').locator('[data-role="output"]').innerText();
}

/** 当前激活的皮肤（DOM 上那张没被 disable 的 token 样式表）。 */
async function activeSkin(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('style[data-srf-theme]'));
    const active = nodes.find((node) => !(node as HTMLStyleElement).disabled);
    return active?.getAttribute('data-srf-theme') ?? null;
  });
}

test.describe('命令行命令注册表', () => {
  test('mission <标题> → 新建任务对话框可见且标题已预填', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await boot(page);

    await runCommand(page, 'mission 走查验收任务');

    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible({ timeout: 1000 });
    // 标题已预填（对话框主体里能看见这句话）。
    await expect(dialog).toContainText('走查验收任务');

    expect(errors).toEqual([]);
  });

  test('theme → 皮肤真的换了（token 样式表切到 pixel）', async ({ page }) => {
    await boot(page);

    expect(await activeSkin(page)).toBe('default');

    await runCommand(page, 'theme');

    await expect.poll(() => activeSkin(page)).toBe('pixel');
    expect(await outputText(page)).toContain('像素风');
  });

  test('settings → 设置屏现身', async ({ page }) => {
    await boot(page);

    await runCommand(page, 'settings');

    await expect(page.locator('strat-settings-screen')).toBeVisible({ timeout: 1000 });
  });

  test('replay → 有人话回执（今天没活儿 / 网关不可用都给提示与重试指引）', async ({ page }) => {
    await boot(page);

    await runCommand(page, 'replay');

    // 回执里必须有话（不能是空白，也不能是错误码）。
    await expect.poll(() => outputText(page)).not.toBe('');
    const text = await outputText(page);
    expect(text).toContain('回放');
    // 网关连不上时给的是「没连上 + 怎么重试」，连得上但没活儿时给的是「今天还没有任务记录」。
    expect(
      text.includes('重试') || text.includes('今天还没有任务记录') || text.includes('正在回放今天')
    ).toBe(true);
  });

  test('help → 列出全部可用命令；未匹配输入 → 也回一份清单', async ({ page }) => {
    await boot(page);

    await runCommand(page, 'help');
    let text = await outputText(page);
    for (const usage of ['mission <标题>', 'theme', 'settings', 'replay', 'help']) {
      expect(text).toContain(usage);
    }

    await runCommand(page, '瞎敲的');
    text = await outputText(page);
    expect(text).toContain('没有匹配的命令');
    expect(text).toContain('mission <标题>');
    expect(text).toContain('replay');
  });

  test('键盘逐字输入含空格的命令：空格保留、命令命中（回归：空格曾被全局键吞掉）', async ({ page }) => {
    await boot(page);

    const input = page.locator('strat-command-panel').locator('textarea[data-role="query"]');
    await input.click();
    // 逐字敲（不是 fill / insertText）—— 只有真键盘事件才暴露"空格被吞"这个回归。
    await input.pressSequentially('mission 整理战场', { delay: 20 });
    await expect(input).toHaveValue('mission 整理战场');

    await input.press('Enter');

    // 命令解析命中：标题（空格之后那截）被带进对话框并预填。
    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible({ timeout: 1000 });
    await expect(dialog).toContainText('整理战场');
  });

  test('help → 五命令清单（含中文别名），且完整可见（复测 P2：help 零反馈）', async ({ page }) => {
    await boot(page);

    await runCommand(page, 'help');
    const text = await outputText(page);
    // 五条命令的用法都在。
    for (const usage of ['mission <标题>', 'theme [default|pixel]', 'settings', 'replay', 'help']) {
      expect(text).toContain(usage);
    }
    // 中文别名也在（别名同样是能敲的形态）。
    for (const alias of [
      '别名：任务 / 新建任务',
      '别名：主题 / 皮肤',
      '别名：设置',
      '别名：回放',
      '别名：帮助 / ?',
    ]) {
      expect(text).toContain(alias);
    }
    // 完整可见：清单没被裁成一行（裁掉 = 用户眼前没有反馈 = 等于没输出）。
    const clipped = await page
      .locator('strat-command-panel')
      .locator('[data-role="output"]')
      .evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(clipped).toBe(false);
  });
});
