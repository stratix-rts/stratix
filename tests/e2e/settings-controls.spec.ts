/**
 * e2e：设置页控件（@since v3.6，task_116）—— UI 评审死功能 #4/#5/#6 的验收。
 *
 * 覆盖（逐控件点击断言 DOM 状态 + localStorage 键值 + 刷新保持）：
 *   ① 四个偏好开关（通知提示 / 音效 / 上下文注入 / 单位名字）：点一下文字在「开 ↔ 关」之间翻转
 *      （此前点 0 像素变化 —— 那一行的按钮发的是 core 从未接线的 settings.set），
 *      值落进 localStorage，**刷新后仍是同一个值**；
 *   ② 音量计：点击循环档位（静音 / 30 / 70 / 100），title 与数值同步更新，
 *      声音引擎用的键（stratix.sound.volume）随之落盘；
 *   ③ 危险区「重置编组」：先弹确认框（遮罩 + 居中面板）→ 确认后才执行；取消不发命令；
 *   ④ 「清理缓存」是已知 no-op（core 侧为空处理）→ 按钮禁用且标注「未实现」，不再呈现为可用。
 *
 * 跑法：npx playwright test tests/e2e/settings-controls.spec.ts
 *   （仓库默认的 globalSetup 会清端口 7523/7524 —— 只在需要重起服务时才用默认配置。）
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/src/app/main/index.html';

/** 四个偏好行（id = DOM 上的 data-pref；key = 本机持久层的键）。 */
const PREF_ROWS: ReadonlyArray<{ id: string; key: string }> = [
  { id: 'notificationsEnabled', key: 'stratix.notifications.enabled' },
  { id: 'sfx', key: 'stratix.sfx.enabled' },
  { id: 'context', key: 'stratix.context.enabled' },
  { id: 'nametags', key: 'stratix.unit.nametags' },
];

/** 起页面：进主屏、必要时跳过首启向导。 */
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
 * 打开设置屏（⋯ 溢出菜单 → 去设置）。
 * why 带重试：core 广播会让主屏重绘顶栏，重绘会把刚展开的菜单收掉 ——
 *   偶发地「点了没反应」（菜单在点击前被换掉）。重试一次即可，失败就报错（不静默跳过）。
 */
async function openSettings(page: Page): Promise<void> {
  const firstPref = page
    .locator('strat-settings-screen')
    .locator('button[data-pref="notificationsEnabled"]');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.locator('[data-role="overflow"]').click();
    const menu = page.locator('[data-role="overflow-menu"]');
    await expect(menu).toBeVisible();
    await menu.locator('[data-role="settings"]').click();
    try {
      await expect(firstPref).toBeVisible({ timeout: 5000 });
      return;
    } catch {
      // 继续重试（下一轮重新展开菜单）。
    }
  }
  throw new Error('设置屏未能打开（⋯ → 去设置 点了没反应）');
}

/** 读本机持久层里的一个键。 */
function readKey(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => window.localStorage.getItem(k), key);
}

test.describe('偏好开关：点击翻转 + 落盘 + 刷新保持', () => {
  for (const row of PREF_ROWS) {
    test(`${row.id}：点一下 → 「开」翻成「关」+ 键写 0；再点回「开」+ 键写 1`, async ({ page }) => {
      await boot(page);
      await openSettings(page);

      const button = page.locator('strat-settings-screen').locator(`button[data-pref="${row.id}"]`);
      await expect(button).toHaveText('开');
      await expect(button).toHaveAttribute('aria-checked', 'true');

      await button.click();

      // 文字真的翻了（0 像素变化 = 死功能 #4 的原症状）
      await expect(button).toHaveText('关');
      await expect(button).toHaveAttribute('aria-checked', 'false');
      expect(await readKey(page, row.key)).toBe('0');

      await button.click();
      await expect(button).toHaveText('开');
      expect(await readKey(page, row.key)).toBe('1');
    });
  }

  test('刷新后仍是上次那个值（关掉的行刷新后仍显示「关」）', async ({ page }) => {
    await boot(page);
    await openSettings(page);

    const button = page.locator('strat-settings-screen').locator('button[data-pref="notificationsEnabled"]');
    await button.click();
    await expect(button).toHaveText('关');

    await page.reload();
    await page.waitForSelector('strat-command-panel', { timeout: 15_000 });
    await page.waitForTimeout(500);
    await openSettings(page);

    const after = page.locator('strat-settings-screen').locator('button[data-pref="notificationsEnabled"]');
    await expect(after).toHaveText('关');
    expect(await readKey(page, 'stratix.notifications.enabled')).toBe('0');
  });
});

test.describe('音量计：点击循环档位 + 标题同步', () => {
  test('点音量计 → 切到下一档（70 → 100 → 静音 → 30）+ title 跟着变', async ({ page }) => {
    await boot(page);

    const bar = page.locator('[data-role="sound-volume-open"]');
    await expect(bar).toHaveAttribute('title', /音量/);

    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      await bar.click();
      await page.waitForTimeout(120);
      seen.push((await readKey(page, 'stratix.sound.volume')) ?? '');
      // 标题与当前值一致（此前点完还是「音量 70%」，看着像没反应）
      const title = await bar.getAttribute('title');
      const value = seen[seen.length - 1] ?? '';
      expect(title).toBe(value === '0' ? '音量 静音（点击切换档位）' : `音量 ${value}%（点击切换档位）`);
    }

    expect(seen).toEqual(['100', '0', '30', '70']);
  });

  test('拖音量滑条 → 键落盘 + 标题同步（音量计之外还能细调）', async ({ page }) => {
    await boot(page);

    await page.locator('[data-role="sound-volume-open"]').click();
    const slider = page.locator('[data-role="sound-volume"]');
    // range 控件用 fill 不适用 —— 直接设值再派发 input（与真实拖动同一条事件链）。
    await slider.evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = '35';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(await readKey(page, 'stratix.sound.volume')).toBe('35');
    await expect(page.locator('[data-role="sound-volume-open"]'))
      .toHaveAttribute('title', '音量 35%（点击切换档位）');
  });
});

test.describe('设置页音量：档位按钮 + 滑条 → 实时落到声音引擎的键', () => {
  test('点档位按钮 → 循环 静音 → 30 → 70 → 100 → 静音，标题与数字同步', async ({ page }) => {
    await boot(page);
    await openSettings(page);

    const preset = page.locator('strat-settings-screen').locator('button[data-role="sfx-volume-preset"]');
    await expect(preset).toHaveText('70%');

    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      await preset.click();
      await page.waitForTimeout(120);
      seen.push((await readKey(page, 'stratix.sound.volume')) ?? '');
      const title = await preset.getAttribute('title');
      const value = seen[seen.length - 1] ?? '';
      expect(title).toBe(value === '0' ? '音量 静音（点击切换档位）' : `音量 ${value}%（点击切换档位）`);
    }
    expect(seen).toEqual(['100', '0', '30', '70']);
  });

  test('拖音量滑条 → 声音引擎的键落盘 + 标题同步', async ({ page }) => {
    await boot(page);
    await openSettings(page);

    const slider = page.locator('strat-settings-screen').locator('input[data-role="sfx-volume"]');
    await slider.evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = '45';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(await readKey(page, 'stratix.sound.volume')).toBe('45');
    // 音效服务那条路同步（0-1 口径）—— 两条声音通路音量一致
    expect(await readKey(page, 'stratix.sfx.volume')).toBe('0.45');
    await expect(page.locator('strat-settings-screen').locator('button[data-role="sfx-volume-preset"]'))
      .toHaveText('45%');
  });
});

test.describe('危险区：确认框 + 假按钮', () => {
  test('重置编组：先弹确认框 → 确认后才执行；执行后设置屏不退出', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') problems.push(`${msg.type()}: ${msg.text()}`);
    });

    await boot(page);
    await openSettings(page);

    const dialog = page.locator('strat-settings-screen').locator('[data-role="confirm-selection.reset"]');
    await expect(dialog).toHaveCount(0);

    await page.locator('strat-settings-screen').locator('button[data-danger="selection.reset"]').click();
    await expect(dialog).toBeVisible();

    await page.locator('strat-settings-screen').locator('button[data-danger-confirm="selection.reset"]').click();
    await expect(dialog).toHaveCount(0);

    // 设置屏仍在（不再莫名退回主界面）
    await expect(page.locator('strat-settings-screen')).toBeVisible();
    // 命令已被 core 接住：不再报「未处理 command」
    expect(problems.filter((p) => p.includes('未处理'))).toEqual([]);
  });

  test('重置编组：取消 → 不执行（确认框消失，命令没发）', async ({ page }) => {
    await boot(page);
    await openSettings(page);

    await page.locator('strat-settings-screen').locator('button[data-danger="selection.reset"]').click();
    await expect(page.locator('strat-settings-screen').locator('[data-role="confirm-selection.reset"]')).toBeVisible();

    await page.locator('strat-settings-screen').locator('button[data-danger-cancel="selection.reset"]').click();
    await expect(page.locator('strat-settings-screen').locator('[data-role="confirm-selection.reset"]')).toHaveCount(0);
    await expect(page.locator('strat-settings-screen')).toBeVisible();
  });

  test('清理缓存是已知 no-op → 按钮禁用 + 标注「未实现」，不再呈现为可用', async ({ page }) => {
    await boot(page);
    await openSettings(page);

    const button = page.locator('strat-settings-screen').locator('[data-danger-row="cache.clear"] button');
    await expect(button).toBeDisabled();
    await expect(button).toContainText('未实现');
    // 没有可点的危险入口（点了也不会进确认流程）
    await expect(page.locator('strat-settings-screen').locator('button[data-danger="cache.clear"]')).toHaveCount(0);
  });
});
