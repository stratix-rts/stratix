/**
 * e2e：**⌘K 命令面板**（@since v3.9，task_150）—— 全应用键盘可达。
 *
 * 覆盖验收口径：
 *   ① ⌘K 唤起 → 输两个字模糊命中 → Enter 执行，**全程无鼠标**（键位序列断言 + 截图）；
 *   ② ≥15 条命令注册；底栏 composer 的五命令 + 中文别名零回归（真实应用里敲一遍）；
 *   ③ 不可用命令灰态 + 原因（截图留证）；
 *   ④ ESC 栈语义：栈顶先关（面板开在对话框之上 → 先关面板，对话框后关）；
 *   ⑤ 最近使用置顶（localStorage，5 条上限）。
 *
 * 双皮肤截图：文件名 `-r9` 前缀 + `-ck` 后缀（现代皮 / 像素皮各一套）。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.command-palette.config.ts
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/src/app/main/index.html';
const SHOTS = 'reports/shots';
const SKIN_KEY = 'stratix.skin';

interface PaletteState {
  open: boolean;
  ids: string[];
  selected: string | null;
  focusIsSearch: boolean;
  disabled: { id: string; text: string }[];
  status: string;
  groupNames: string[];
}

async function boot(page: Page, skin: 'default' | 'pixel' = 'default'): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
  // 清掉上一次跑留下的最近使用（置顶断言要可复现）；皮肤键单独写 —— 写完要 reload 才生效。
  await page.evaluate(
    ([key, value]) => {
      localStorage.removeItem('srf-recent-commands:v1');
      localStorage.setItem(key as string, value as string);
    },
    [SKIN_KEY, skin] as const
  );
  await page.reload();
  await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(400);
  }
}

async function paletteState(page: Page): Promise<PaletteState> {
  return page.evaluate(() => {
    const host = document.querySelector('strat-command-palette') as
      | (HTMLElement & { shadowRoot: ShadowRoot })
      | null;
    if (!host?.shadowRoot) {
      return { open: false, ids: [], selected: null, focusIsSearch: false, disabled: [], status: '', groupNames: [] };
    }
    const root = host.shadowRoot;
    const panel = root.querySelector('[data-role="panel"]') as HTMLElement | null;
    const search = root.querySelector('[data-role="search"]') as HTMLInputElement | null;
    const items = Array.from(root.querySelectorAll('button.item')) as HTMLButtonElement[];
    const selectedEl = root.querySelector('button.item[data-selected="true"]') as HTMLElement | null;
    const statusEl = root.querySelector('[data-role="status"]') as HTMLElement | null;
    return {
      open: !!panel && !panel.hidden,
      ids: items.map((i) => i.getAttribute('data-command') ?? ''),
      selected: selectedEl?.getAttribute('data-command') ?? null,
      focusIsSearch: root.activeElement === search,
      disabled: items
        .filter((i) => i.disabled)
        .map((i) => ({ id: i.getAttribute('data-command') ?? '', text: (i.textContent ?? '').trim() })),
      status: (statusEl?.textContent ?? '').trim(),
      groupNames: Array.from(root.querySelectorAll('.group-name')).map((g) => (g.textContent ?? '').trim()),
    };
  });
}

/**
 * 唤起命令面板（键位序列，全程无鼠标）。
 * why 先试 ⌘K：macOS 上浏览器自己绑了 ⌘K（地址栏搜索）—— 真按不到页面上时就退到 Ctrl+K，
 *   应用两个键都收（单测里断言过 metaKey / ctrlKey 两条路）。
 */
async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(250);
  let state = await paletteState(page);
  if (!state.open) {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(250);
    state = await paletteState(page);
  }
  expect(state.open, '⌘K / Ctrl+K 应当唤起命令面板').toBe(true);
}

/** 当前激活的皮肤 id（读 style[data-srf-theme] 的启用态）。 */
async function activeTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLStyleElement>('style[data-srf-theme]'));
    const active = nodes.find((n) => !n.disabled);
    return active?.getAttribute('data-srf-theme') ?? null;
  });
}

/** 把焦点放进底栏 composer 的编辑区（键盘路径：先聚焦再打字）。 */
async function focusComposer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.querySelector('strat-command-panel') as
      | (HTMLElement & { shadowRoot: ShadowRoot })
      | null;
    const el = host?.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="query"]');
    el?.focus();
  });
  await page.waitForTimeout(120);
}

test.describe('⌘K 命令面板（@since v3.9，task_150）', () => {
  test('① 命令注册清单：≥15 条 + 分组 + 五条 CLI 词表同源', async ({ page }) => {
    await boot(page);

    const registry = await page.evaluate(async () => {
      const path = '/src/hud/lib/command-registry.ts';
      const mod = (await import(/* @vite-ignore */ path)) as unknown as {
        APP_COMMANDS: { id: string; title: string; aliases: string[]; group: string }[];
        APP_COMMAND_GROUP_ORDER: string[];
        CLI_BINDINGS: { name: string; aliases?: string[] }[];
      };
      return {
        count: mod.APP_COMMANDS.length,
        ids: mod.APP_COMMANDS.map((c) => c.id),
        groups: mod.APP_COMMAND_GROUP_ORDER,
        cli: mod.CLI_BINDINGS.map((b) => ({ name: b.name, aliases: b.aliases ?? [] })),
      };
    });

    console.log('【命令注册清单】');
    registry.ids.forEach((id, i) => console.log(`  ${String(i + 1).padStart(2, '0')}. ${id}`));
    console.log(`  共 ${registry.count} 条；分组序：${registry.groups.join(' / ')}`);
    console.log(`  CLI 词表：${registry.cli.map((b) => b.name).join(' · ')}`);

    expect(registry.count).toBeGreaterThanOrEqual(15);
    expect(registry.groups).toEqual([
      'recent',
      'task',
      'character',
      'view',
      'appearance',
      'help',
    ]);
    // 底栏 composer 的五条 CLI 命令 —— 词表同源（收编到共享注册表）。
    expect(registry.cli.map((b) => b.name)).toEqual(['mission', 'theme', 'settings', 'replay', 'help']);
    expect(registry.cli.find((b) => b.name === 'theme')?.aliases).toEqual(['主题', '皮肤']);
  });

  test('② ⌘K → 输两字模糊命中 → Enter 执行（全程无鼠标）+ 双皮肤截图', async ({ page }) => {
    await boot(page, 'default');

    // —— 现代皮 ——
    await openPalette(page);
    let state = await paletteState(page);
    expect(state.open).toBe(true);
    // 唤起即可打字：焦点直接进搜索框（不用再按一下 Tab）。
    expect(state.focusIsSearch).toBe(true);
    // 分组标题渲染。
    expect(state.groupNames.length).toBeGreaterThanOrEqual(3);
    await page.locator('strat-command-palette .panel').screenshot({
      path: `${SHOTS}/-r9-cmdk-list-default-ck.png`,
    });

    // 输两个汉字 → 子序列模糊命中「切换到像素风」。
    await page.keyboard.type('像素');
    await page.waitForTimeout(200);
    state = await paletteState(page);
    expect(state.ids).toContain('theme.pixel');
    expect(state.selected).toBe('theme.pixel');
    await page.locator('strat-command-palette .panel').screenshot({
      path: `${SHOTS}/-r9-cmdk-search-default-ck.png`,
    });

    // Enter 执行 —— 皮肤真的切了（不是「看起来执行了」）。
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    expect(await activeTheme(page)).toBe('pixel');
    expect((await paletteState(page)).open).toBe(false);

    // —— 像素皮（同一套键位再来一遍）——
    await page.reload();
    await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
    const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
    if (await skip.count()) {
      await skip.first().click();
      await page.waitForTimeout(400);
    }
    expect(await activeTheme(page)).toBe('pixel');

    await openPalette(page);
    await page.keyboard.type('日志');
    await page.waitForTimeout(200);
    const pixelState = await paletteState(page);
    expect(pixelState.ids).toContain('log.open');
    await page.locator('strat-command-palette .panel').screenshot({
      path: `${SHOTS}/-r9-cmdk-search-pixel-ck.png`,
    });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    expect((await paletteState(page)).open).toBe(false);
  });

  test('③ 不可用命令灰态 + 原因（派发任务：0 角色 / 0 指令）', async ({ page }) => {
    await boot(page, 'default');

    await openPalette(page);
    await page.keyboard.type('派发');
    await page.waitForTimeout(200);

    const state = await paletteState(page);
    const dispatch = state.disabled.find((d) => d.id === 'task.dispatch');
    expect(dispatch, '「派发任务」应当是灰态').toBeTruthy();
    // 灰按钮必须解释自己为什么灰（task_148 的死按钮语言）。
    expect(dispatch?.text.length ?? 0).toBeGreaterThan(0);
    console.log(`【灰态原因】${dispatch?.id} → ${dispatch?.text}`);

    await page.locator('strat-command-palette .panel').screenshot({
      path: `${SHOTS}/-r9-cmdk-disabled-default-ck.png`,
    });
  });

  test('④ ESC 栈语义：面板在栈顶 → 先关面板，下面的对话框后关', async ({ page }) => {
    await boot(page, 'default');

    // 底栏 composer 敲 mission → 打开新建任务对话框（键盘路径，无鼠标）。
    await focusComposer(page);
    await page.keyboard.type('/mission 冒烟任务');
    await page.keyboard.press('Enter');
    await page.waitForSelector('strat-new-task-dialog', { timeout: 10_000 });
    const dialogOpen = async (): Promise<boolean> =>
      page.evaluate(() =>
        document.querySelector('strat-new-task-dialog')?.hasAttribute('open') ?? false
      );
    expect(await dialogOpen()).toBe(true);

    // 再开命令面板 → 面板压在对话框上面（栈顶）。
    await openPalette(page);
    expect((await paletteState(page)).open).toBe(true);

    // 第一次 ESC：关面板（栈顶），对话框**不动**。
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    expect((await paletteState(page)).open).toBe(false);
    expect(await dialogOpen(), '栈顶是面板 —— 对话框不该被顺手关掉').toBe(true);

    // 第二次 ESC：栈顶变成对话框 → 关对话框。
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    expect(await dialogOpen(), '栈顶轮到对话框 → 这才关它').toBe(false);
  });

  test('⑤ 底栏 composer 五命令零回归（真实应用里敲一遍 help）', async ({ page }) => {
    await boot(page, 'default');

    await focusComposer(page);
    await page.keyboard.type('/help');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    const output = await page.evaluate(() => {
      const host = document.querySelector('strat-command-panel') as
        | (HTMLElement & { shadowRoot: ShadowRoot })
        | null;
      const el = host?.shadowRoot?.querySelector('[data-role="output"]') as HTMLElement | null;
      return (el?.textContent ?? '').trim();
    });
    console.log(`【composer help 回执】\n${output}`);

    // 五条 CLI 命令都在（词表同源于共享注册表）。
    for (const name of ['mission', 'theme', 'settings', 'replay', 'help']) {
      expect(output).toContain(name);
    }
  });

  test('⑥ 最近使用置顶（执行过的命令下次排第一，localStorage 封顶 5 条）', async ({ page }) => {
    await boot(page, 'default');

    // 执行一次「打开设置」→ 记进最近使用。
    await openPalette(page);
    await page.keyboard.type('设置');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('srf-recent-commands:v1') ?? '[]') as string[]
    );
    expect(stored[0]).toBe('settings.open');
    expect(stored.length).toBeLessThanOrEqual(5);

    // 再开面板 → 「打开设置」排第一。
    await openPalette(page);
    const state = await paletteState(page);
    expect(state.ids[0]).toBe('settings.open');
  });
});
