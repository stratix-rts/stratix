/**
 * e2e：排版与信息层级系统（@since v3.8，task_137）。
 *
 * 覆盖验收口径：
 *   ① 顶栏可见元素位 ≤4（7 → 4 的减密度改版），且四个位逐位对上；
 *   ② 当前任务一句话在位（标题级字号 + 单行截断 + title 提示）；
 *   ③ **≥4 个高频界面**的三级字阶可辨（标题 / 正文 / 辅助 = 3 个不同的 computed font-size）；
 *   ④ 布局骨架大体不变（顶栏 / 左栏 / 右栏 / 底岛的 boundingRect 对照输出）。
 *
 * 跑法（**不要**用仓库默认配置 —— 它的 globalSetup 会杀掉 7523/7524 上的进程）：
 *   npx playwright test --config=tests/e2e/playwright.type-scale.config.ts
 *
 * 前后对照：把 src/hud/screens/main-screen.ts 换回 HEAD 版本再跑一次（PHASE=before），
 *   即得「改前」截图与度量；换回新版本跑（PHASE=after）即得「改后」。
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/src/app/main/index.html';

/** 当前阶段：before = 改前（HEAD 版顶栏）/ after = 改后（默认）。 */
const PHASE = process.env.T137_PHASE ?? 'after';

/** 取某个宿主（shadow 组件）里某个后代元素的 computed font-size。 */
async function fontSizeIn(page: Page, hostSel: string, innerSel: string): Promise<string> {
  return page.evaluate(
    ([host, inner]) => {
      const node = document.querySelector(host);
      const root = node?.shadowRoot ?? node;
      const el = root?.querySelector(inner);
      return el ? getComputedStyle(el).fontSize : 'MISSING';
    },
    [hostSel, innerSel] as const,
  );
}

/** 取文档流里某个元素自身的 computed font-size。 */
async function fontSizeOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? getComputedStyle(el).fontSize : 'MISSING';
  }, sel);
}

async function boot(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForSelector('strat-command-panel', { timeout: 15_000 });
  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(300);
}

test('顶栏减密度 + 三级字阶 + 骨架对照（task_137）', async ({ page }) => {
  await boot(page);

  // ── ① 顶栏可见元素位 ────────────────────────────────────────────────
  const items = await page.$$eval('.hud-topbar [data-topbar-item]', (els) =>
    els.map((el) => el.getAttribute('data-topbar-item')),
  );
  // ── ② 当前任务一句话 ────────────────────────────────────────────────
  // 改前（PHASE=before）没有这个元素 —— 取不到就如实记 MISSING，不让整条用例挂掉。
  const taskTitle = (await page.textContent('.hud-topbar [data-role="current-task-title"]').catch(() => null)) ?? 'MISSING';
  const taskTitleAttr =
    (await page.getAttribute('.hud-topbar [data-role="current-task-title"]', 'title').catch(() => null)) ?? 'MISSING';
  const taskOverflow = await page
    .$eval('.hud-topbar [data-role="current-task-title"]', (el) => {
      const style = getComputedStyle(el);
      return { textOverflow: style.textOverflow, whiteSpace: style.whiteSpace, overflow: style.overflow };
    })
    .catch(() => ({ textOverflow: 'MISSING', whiteSpace: 'MISSING', overflow: 'MISSING' }));

  // ── ③ ≥4 个高频面的三级字阶（computed style 抽查）──────────────────
  const scales: Record<string, Record<string, string>> = {
    main: {
      title: await fontSizeOf(page, '.hud-topbar [data-role="current-task-title"]'),
      body: await fontSizeOf(page, '.hud-topbar [data-role="unit-count"]'),
      caption: await fontSizeOf(page, '.hud-topbar [data-role="status-capsule"]'),
    },
    status: {
      title: await fontSizeIn(page, 'strat-status-screen', '.title'),
      body: await fontSizeIn(page, 'strat-status-screen', '.metric-value'),
      caption: await fontSizeIn(page, 'strat-status-screen', '.metric-label'),
    },
    session: {
      title: await fontSizeIn(page, 'strat-session-panel', '.title'),
      body: await fontSizeIn(page, 'strat-session-panel', '.body'),
      caption: await fontSizeIn(page, 'strat-session-panel', '.chip'),
    },
  };

  // 设置页（走 ⋯ 菜单进去）：子屏是弹窗，样式在 shadow 里。
  await page.click('[data-role="overflow"]');
  await page.waitForTimeout(200);
  await page.click('[data-role="settings"]');
  await page.waitForTimeout(400);
  scales.settings = {
    title: await fontSizeIn(page, 'strat-settings-screen', '.title'),
    body: await fontSizeIn(page, 'strat-settings-screen', '.row-label'),
    caption: await fontSizeIn(page, 'strat-settings-screen', '.group-name'),
  };
  await page.screenshot({ path: `reports/shots/type-scale-r5-settings-${PHASE}.png` });
  // 回主屏（设置页的返回按钮 / ESC 都收口到 ui.navigate(main)）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── ④ 布局骨架：四个区块的 boundingRect（前后对照输出）──────────────
  const rects = await page.evaluate(() => {
    const pick = (sel: string): Record<string, number> => {
      const el = document.querySelector(sel);
      if (!el) return { missing: 1 };
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      topbar: pick('.hud-topbar'),
      railLeft: pick('.hud-rail-left'),
      railRight: pick('.hud-rail-right'),
      bottomBar: pick('.hud-bottom-bar'),
    };
  });

  // 顶栏截图（改前 / 改后各一张）
  await page.screenshot({ path: `reports/shots/type-scale-r5-full-${PHASE}.png` });
  const bar = await page.$('.hud-topbar');
  if (bar) await bar.screenshot({ path: `reports/shots/type-scale-r5-topbar-${PHASE}.png` });

  const metrics = { phase: PHASE, items, taskTitle, taskTitleAttr, taskOverflow, scales, rects };
  console.log(`T137_METRICS ${JSON.stringify(metrics)}`);

  if (PHASE === 'after') {
    // 减密度：7 位 → 4 位（-43%），功能零丢失（声音 / 导演 / 演示仍在 ⋯ 菜单里）。
    expect(items).toEqual(['brand', 'task', 'capsule', 'overflow']);
    expect(items.length).toBeLessThanOrEqual(4);
    // 当前任务一句话在位 + 单行截断规则生效
    expect(taskTitle).toBeTruthy();
    expect(taskTitleAttr).toBe(taskTitle);
    expect(taskOverflow.textOverflow).toBe('ellipsis');
    // ≥4 个高频面三级字阶可辨：每面三个不同字号
    for (const [surface, scale] of Object.entries(scales)) {
      const sizes = new Set(Object.values(scale));
      expect({ surface, distinct: sizes.size, scale }).toEqual({ surface, distinct: 3, scale });
    }
  }
});
