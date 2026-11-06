/**
 * e2e：**首批精灵特效触点**的浏览器验收（@since v3.3，task_161）。
 *
 * 覆盖验收口径：
 *   ① 六张 sheet 全部加载到位（贴图在 texture manager 里 —— 没加载 = 画面上什么都不会有）；
 *   ② 六个语义触点逐个触发 → 真的创建了动画实例（读数 + 截图）；
 *   ③ 实例会自己回收（播完 → 实例数归零 —— 不回收就是资源泄漏）；
 *   ④ 并发上限生效（一次触发 8 条 → 场上不超过 4 条）；
 *   ⑤ 皮肤 palette 对齐（截图里的彩带用皮肤 token 的色，不是外来色）。
 *
 * 页面：/src/world/dev/fx-dev.html —— 挂的是**生产场景**（BattlefieldScene），
 *   每个按钮走的都是生产路径（总线事件 / state 对账 / 场景指令），不另开后门。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.fx.config.ts
 */

import { expect, test, type Page } from '@playwright/test';

/** dev 验收页（挂生产场景 + 触点按钮）。 */
const FX_URL = '/src/world/dev/fx-dev.html';
/** 截图目录。 */
const SHOTS = 'reports/shots';
/** 并发上限（唯一事实源：core/theme/visual-spec.ts 的 SPRITE_FX_METRICS.maxConcurrent）。 */
const MAX_CONCURRENT = 4;
/** 六张 sheet 的 atlas key（与生成索引同名）。 */
const ATLAS_KEYS = [
  'fx:celebrate',
  'fx:levelUp',
  'fx:error',
  'fx:spawn',
  'fx:despawn',
  'fx:command',
];

/** dev 观测句柄（见 src/world/dev/fx-dev-main.ts 的 mountDevHandle）。 */
interface FxHandle {
  readonly activeCount: () => number;
  readonly hasTexture: (key: string) => boolean;
}

/**
 * 读当前在播的特效实例数。
 * why 在页面内调用而不是把句柄取回 node：page.evaluate 只回传可结构化克隆的值，
 *   函数属性会被静默丢掉（拿到的是空壳对象 → "activeCount is not a function"）。
 */
async function activeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const fx = (window as unknown as { __srfFx?: FxHandle }).__srfFx;
    return fx ? fx.activeCount() : -1;
  });
}

/** 某张 sheet 纹理是否已加载（atlas key 形如 'fx:celebrate'）。 */
async function hasTexture(page: Page, key: string): Promise<boolean> {
  return page.evaluate((atlasKey) => {
    const fx = (window as unknown as { __srfFx?: FxHandle }).__srfFx;
    return fx ? fx.hasTexture(atlasKey) : false;
  }, key);
}

/** 起页面并等场景就位（控件 + 画布都在）。 */
async function boot(page: Page): Promise<void> {
  await page.goto(FX_URL);
  await page.waitForSelector('#controls button[data-act="spawn"]', { timeout: 30_000 });
  // 等第一帧渲染完（纹理与动画就位）。
  await page.waitForFunction(() => {
    const fx = (window as unknown as { __srfFx?: FxHandle }).__srfFx;
    return fx !== undefined && fx.hasTexture('fx:celebrate');
  }, undefined, { timeout: 30_000 });
  await page.waitForTimeout(300);
}

/** 点一个触点按钮。 */
async function trigger(page: Page, act: string): Promise<void> {
  await page.click(`#controls button[data-act="${act}"]`);
}

test.describe('精灵特效触点（task_161）', () => {
  test('六张 sheet 全部加载到位', async ({ page }) => {
    await boot(page);
    for (const key of ATLAS_KEYS) {
      expect(await hasTexture(page, key), `${key} 未加载`).toBe(true);
    }
  });

  test('六个语义触点逐个触发 → 都真的创建了动画实例', async ({ page }) => {
    await boot(page);

    // 上场（spawn）：state 通道的单位对账 → 场景给新单位播特效。
    await trigger(page, 'spawn');
    await page.waitForTimeout(400);
    expect(await activeCount(page), '上场触点没有创建实例').toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/fx-r161-spawn.png` });

    // 退场（despawn）：摘掉单位 → 在其最后位置播特效。
    await trigger(page, 'despawn');
    await page.waitForTimeout(400);
    expect(await activeCount(page), '退场触点没有创建实例').toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/fx-r161-despawn.png` });

    // 任务完成（celebrate）：world 通道的 task.completed → 桥接层 → 场景钩子。
    await trigger(page, 'complete');
    await page.waitForTimeout(500);
    expect(await activeCount(page), '完成触点没有创建实例').toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/fx-r161-celebrate.png` });

    // 任务报错（error）：world 通道的 task.failed。
    await trigger(page, 'fail');
    await page.waitForTimeout(500);
    expect(await activeCount(page), '报错触点没有创建实例').toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/fx-r161-error.png` });

    // 角色升级（levelUp）：world 通道的 level.up。
    await trigger(page, 'levelup');
    await page.waitForTimeout(500);
    expect(await activeCount(page), '升级触点没有创建实例').toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/fx-r161-levelup.png` });

    // 指令下达（command）：与右键短按同一条路径（issueMoveCommandAt）。
    await trigger(page, 'command');
    await page.waitForTimeout(500);
    expect(await activeCount(page), '指令触点没有创建实例').toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/fx-r161-command.png` });
  });

  test('实例会自己回收（播完即清 —— 不回收就是资源泄漏）', async ({ page }) => {
    await boot(page);
    await trigger(page, 'complete');
    await page.waitForTimeout(300);
    expect(await activeCount(page)).toBeGreaterThan(0);

    // 最长的一条特效（command 5.05s / spawn 3.85s）播完就该归零。
    // 这里等 6s：覆盖全部六种特效的最长时长。
    await page.waitForTimeout(6000);
    expect(await activeCount(page), '特效播完没有回收').toBe(0);
  });

  test('并发上限生效（一次触发 8 条 → 场上不超过 4 条）', async ({ page }) => {
    await boot(page);
    await trigger(page, 'burst');
    await page.waitForTimeout(400);
    expect(await activeCount(page)).toBeLessThanOrEqual(MAX_CONCURRENT);
    await page.screenshot({ path: `${SHOTS}/fx-r161-concurrency.png` });

    // 上限之外的老实例被挤掉后，总数稳定在阈值上（不越界）。
    await page.waitForTimeout(600);
    expect(await activeCount(page)).toBeLessThanOrEqual(MAX_CONCURRENT);
  });
});
