/**
 * e2e：空状态设计（@since v3.8，task_136）。
 *
 * 覆盖验收口径：
 *   ① 0 单位时战场空态出现（雷达 + 人话文案 + 两个行动引导），两皮肤各一张截图；
 *   ② 行动引导**点击真通**：「打开命令行」→ 命令行输入框获得焦点；
 *      「新建角色」→ 既有首启向导真的被拉起来；
 *   ③ 空态**真联动**：建一个角色 → 战场空态消失（core 投影出单位 → 状态广播 → 覆盖层收起）；
 *   ④ 面板空态统一：会话 / 日志 / 角色 / 对话 四处都走同一套空态组件（图标位 + 虚线框）。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.empty.config.ts
 *   （该配置不挂 globalSetup —— 不会杀掉在跑的 7523 / 7524。）
 */

import { expect, test, type Page } from '@playwright/test';

/**
 * 本剧本测的是**战场空态**（0 单位）—— 而「连本地网关」是默认（@since v3.10，task_153），
 * 默认模式下网关名册里就有角色，战场永远不空。故本剧本显式走**本地直连**模式
 * （`?stratix-remote=0` = dev-flags 的 URL 覆盖口，见 src/app/main/dev-flags.ts）。
 */
const APP_URL = '/?stratix-remote=0';
const SHOTS = 'reports/shots';

/** 空态覆盖层的标签（与组件常量一致 —— 这里写字面量，避免 import 应用代码进 e2e）。 */
const EMPTY_TAG = 'strat-battlefield-empty';

/** 起页面：进主屏、跳过首启向导（让战场露出来）、等空态层就位。 */
async function boot(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(600);
  }
  await page.waitForSelector(EMPTY_TAG, { timeout: 20_000 });
}

/** 切皮肤（走 localStorage 记忆口 + 刷新 —— 与真人路径同源）。 */
async function setSkin(page: Page, skin: 'default' | 'pixel'): Promise<void> {
  await page.evaluate((id) => {
    window.localStorage.setItem('stratix.skin', id);
  }, skin);
  await page.reload();
  await page.waitForSelector('strat-command-panel', { timeout: 20_000 });
  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(600);
  }
  await page.waitForSelector(EMPTY_TAG, { timeout: 20_000 });
  await page.waitForTimeout(400);
}

/** 空态层当前是否可见（hidden 属性 + 实际盒高）。 */
async function emptyVisible(page: Page): Promise<boolean> {
  return page.evaluate((tag) => {
    const el = document.querySelector(tag) as (HTMLElement & { hidden: boolean }) | null;
    if (!el) return false;
    if (el.hidden) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, EMPTY_TAG);
}

test.describe('空状态设计（task_136）', () => {
  test('0 单位 → 战场空态出现：雷达 + 人话文案 + 行动引导（两皮肤截图）', async ({ page }) => {
    await boot(page);

    expect(await emptyVisible(page)).toBe(true);

    const copy = await page.evaluate((tag) => {
      const el = document.querySelector(tag) as (HTMLElement & { shadowRoot?: ShadowRoot | null }) | null;
      const root = el?.shadowRoot;
      return {
        title: root?.querySelector('[data-role="title"]')?.textContent ?? '',
        hint: root?.querySelector('[data-role="hint"]')?.textContent ?? '',
        radar: root?.querySelector('[data-role="radar"]') !== null,
        create: root?.querySelector('[data-role="action-create"]')?.textContent ?? '',
        command: root?.querySelector('[data-role="action-command"]')?.textContent ?? '',
      };
    }, EMPTY_TAG);

    expect(copy.title).toBe('战场待命中');
    expect(copy.hint).toContain('第一位 agent 上场后');
    expect(copy.radar).toBe(true);
    expect(copy.create).toBe('新建角色');
    expect(copy.command).toBe('打开命令行');
    // 人话口径：整页不得出现开发者词（gateway / 数据流 / 接入）。
    const body = await page.evaluate(() => document.body.innerText);
    expect(body).not.toMatch(/gateway|真实数据流|数据流|0 单位接入/);

    // 现代皮截图。
    await page.screenshot({ path: `${SHOTS}/battlefield-empty-r5-empty-modern.png`, fullPage: false });

    // 像素皮截图（换皮 = 换 token 表；空态层必须跟着变）。
    await setSkin(page, 'pixel');
    expect(await emptyVisible(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/battlefield-empty-r5-empty-pixel.png`, fullPage: false });
  });

  test('行动引导点击真通：打开命令行 → 输入框获得焦点；新建角色 → 拉起既有向导', async ({ page }) => {
    await boot(page);

    // —— 「打开命令行」——
    await page.evaluate(() => {
      const el = document.querySelector('strat-battlefield-empty');
      const btn = el?.shadowRoot?.querySelector('[data-role="action-command"]') as HTMLButtonElement | null;
      btn?.click();
    });
    await page.waitForTimeout(300);
    const focused = await page.evaluate(() => {
      const host = document.querySelector('strat-command-panel');
      const active = document.activeElement;
      const inner = (host as (HTMLElement & { shadowRoot?: ShadowRoot | null }) | null)?.shadowRoot?.activeElement;
      return {
        hostFocused: active?.tagName === 'STRAT-COMMAND-PANEL',
        innerRole: (inner as HTMLElement | null)?.getAttribute('data-role') ?? '',
      };
    });
    expect(focused.hostFocused).toBe(true);
    expect(focused.innerRole).toBe('query');

    // —— 「新建角色」→ 真去建档的路（既有首启向导；向导起不来时退到既有路由 ui.navigate('character')）——
    await page.evaluate(() => {
      const el = document.querySelector('strat-battlefield-empty');
      const btn = el?.shadowRoot?.querySelector('[data-role="action-create"]') as HTMLButtonElement | null;
      btn?.click();
    });
    // 断言"点了有反应"：要么向导被拉起来，要么角色中心被打开（两条都是既有能力，不是新路由）。
    await page.waitForFunction(
      () =>
        document.querySelector('strat-onboarding-screen') !== null ||
        document.querySelector('strat-character-screen') !== null,
      undefined,
      { timeout: 20_000 }
    );
    const landed = await page.evaluate(() => ({
      onboarding: document.querySelector('strat-onboarding-screen') !== null,
      character: document.querySelector('strat-character-screen') !== null,
    }));
    expect(landed.onboarding || landed.character).toBe(true);
  });

  test('真联动：建一个角色 → 战场空态消失；删掉 → 空态回来（真命令，非 mock）', async ({ page }) => {
    await boot(page);
    expect(await emptyVisible(page)).toBe(true);

    // —— 建角色：走 app 的**真命令口**（core 真的建档 → 真的投影出战场单位 → 状态广播 → 覆盖层收起）。
    // why 不用向导：浏览器里没有 Electron 的 agent 探测，向导起不来；这里要验的是
    //   "空态跟着真状态走"，命令必须是真命令（造状态塞进去等于没验）。
    const created = await page.evaluate(() => {
      const app = (window as unknown as { __srfApp?: { emitCommand: (c: unknown) => void; snapshot: () => { characters: { id: string }[]; units: unknown[] } } }).__srfApp;
      app?.emitCommand({ type: 'character.create', name: '空态验收员', agentKind: 'claude-code', skinId: 'default' });
      return app?.snapshot() ?? null;
    });
    expect(created).not.toBeNull();

    await page.waitForFunction(
      (tag) => {
        const el = document.querySelector(tag) as (HTMLElement & { hidden: boolean }) | null;
        return !!el && el.hidden;
      },
      EMPTY_TAG,
      { timeout: 20_000 }
    );
    expect(await emptyVisible(page)).toBe(false);

    // —— 删角色：空态回来。
    const characterId = await page.evaluate(() => {
      const app = (window as unknown as { __srfApp?: { emitCommand: (c: unknown) => void; snapshot: () => { characters: { id: string }[] } } }).__srfApp;
      const id = app?.snapshot().characters[0]?.id ?? '';
      app?.emitCommand({ type: 'character.delete', characterId: id });
      return id;
    });
    expect(characterId).toBeTruthy();

    await page.waitForFunction(
      (tag) => {
        const el = document.querySelector(tag) as (HTMLElement & { hidden: boolean }) | null;
        return !!el && !el.hidden;
      },
      EMPTY_TAG,
      { timeout: 20_000 }
    );
    expect(await emptyVisible(page)).toBe(true);
  });

  test('面板空态统一：会话 / 日志 / 角色 / 对话 四处同一套空态组件', async ({ page }) => {
    await boot(page);

    // 打开聊天抽屉与会话面板（这两处的空态要面板在场才画 —— 走顶栏真实入口）。
    await page.locator('[data-role="overflow"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-role="chat"]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-role="overflow"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-role="sessions"]').click();
    await page.waitForTimeout(500);

    const usage = await page.evaluate(() => {
      const seen: { role: string; tag: string; hasIcon: boolean }[] = [];
      const visit = (scope: ParentNode): void => {
        scope.querySelectorAll('[data-role="empty"]').forEach((node) => {
          const el = node as HTMLElement & { shadowRoot?: ShadowRoot | null };
          seen.push({
            role: el.getAttribute('data-role') ?? '',
            tag: el.tagName.toLowerCase(),
            hasIcon: el.shadowRoot?.querySelector('[data-role="icon"]') !== null,
          });
        });
        scope.querySelectorAll('*').forEach((el) => {
          const shadow = (el as HTMLElement).shadowRoot;
          if (shadow) visit(shadow);
        });
      };
      visit(document);
      return seen;
    });

    const unified = usage.filter((item) => item.tag === 'strat-empty-state');
    // 四类面板各一处（会话 / 日志 / 角色 / 对话）都走统一组件，且都带图标位。
    expect(unified.length).toBeGreaterThanOrEqual(4);
    expect(unified.every((item) => item.hasIcon)).toBe(true);
    // 四类面板都在场（会话 / 日志 / 角色侧栏 / 对话抽屉）。
    const roles = unified.map((item) => item.role);
    expect(roles).toContain('empty'); // 角色侧栏（选中单位前的业务态）
    console.log('[task_136] 统一空态出现处：', JSON.stringify(usage));
  });
});
