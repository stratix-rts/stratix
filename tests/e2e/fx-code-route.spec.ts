/**
 * e2e：**代码路由特效**（二期）的浏览器验收（@since v3.3，task_162）。
 *
 * 覆盖评审文档（docs/research/pixelfx-runtime-poc.md）的四条验收口径：
 *   ① 世界锚定：相机平移时，特效的**世界坐标不变、屏幕坐标跟着平移** ——
 *      这就是「挂在世界里而不是贴在屏幕上」的可判定证据（不用靠肉眼）；
 *   ② 皮肤联动：切皮肤 → registry 里的调色板变了 → **下一个**特效实例用的就是新色；
 *   ③ 预算护栏：并发上限生效（一次播 8 条 → 场上不超过 2 条）；
 *   ④ 护栏实测：浏览器内基准跑出来的「并发 2」占用必须落在单帧预算内。
 *
 * 页面：/src/app/dev/fx-code-dev.html —— dev 验收入口（不进生产产物）。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.fx.config.ts
 */

import { expect, test, type Page } from '@playwright/test';

/** dev 验收页。 */
const FX_URL = '/src/app/dev/fx-code-dev.html';
/** 截图目录。 */
const SHOTS = 'reports/shots';
/** 并发上限（唯一事实源：core/theme/visual-spec.ts 的 CODE_FX_METRICS.maxConcurrent）。 */
const MAX_CONCURRENT = 2;
/** 单帧预算（ms）—— 60fps。 */
const FRAME_BUDGET_MS = 1000 / 60;
/** 演示单位的世界坐标（与 dev 页常量一致）。 */
const UNIT_X = 420;
const UNIT_Y = 320;

/** dev 观测句柄（见 src/app/dev/fx-code-dev-main.ts）。 */
interface CodeFxHandle {
  readonly play: (kind: string, x?: number, y?: number, flip?: boolean) => boolean;
  readonly activeCount: () => number;
  readonly renderHz: () => number;
  readonly lastCostMs: () => number;
  readonly pan: (dx: number, dy: number) => void;
  readonly cameraScroll: () => { readonly x: number; readonly y: number };
  readonly instanceSnapshots: () => readonly {
    readonly kind: string;
    readonly x: number;
    readonly y: number;
    readonly palette: readonly string[];
  }[];
  readonly screenPositions: () => readonly {
    readonly kind: string;
    readonly x: number;
    readonly y: number;
  }[];
  readonly palette: () => Readonly<Record<string, string>>;
  readonly tokenTable: () => Readonly<Record<string, string>>;
  readonly skin: () => string;
  readonly setSkin: (id: string) => void;
  readonly bench: () => Promise<string>;
}

/** 句柄快照（页面内取，避免跨进程丢函数）。 */
async function snapshot(page: Page): Promise<{
  world: readonly { kind: string; x: number; y: number; palette: readonly string[] }[];
  screen: readonly { kind: string; x: number; y: number }[];
  camera: { readonly x: number; readonly y: number };
  active: number;
  renderHz: number;
  lastCostMs: number;
  palette: Readonly<Record<string, string>>;
  tokens: Readonly<Record<string, string>>;
  skin: string;
}> {
  return page.evaluate(() => {
    const fx = (window as unknown as { __srfCodeFx?: CodeFxHandle }).__srfCodeFx;
    if (!fx) throw new Error('__srfCodeFx 未就绪');
    return {
      world: fx.instanceSnapshots(),
      screen: fx.screenPositions(),
      camera: fx.cameraScroll(),
      active: fx.activeCount(),
      renderHz: fx.renderHz(),
      lastCostMs: fx.lastCostMs(),
      palette: fx.palette(),
      tokens: fx.tokenTable(),
      skin: fx.skin(),
    };
  });
}

/** 起页面并等场景就位。 */
async function boot(page: Page): Promise<void> {
  await page.goto(FX_URL);
  await page.waitForSelector('#controls button[data-act="hit"]', { timeout: 30_000 });
  await page.waitForFunction(() => {
    const fx = (window as unknown as { __srfCodeFx?: CodeFxHandle }).__srfCodeFx;
    return fx !== undefined && fx.activeCount() >= 0;
  }, undefined, { timeout: 30_000 });
  await page.waitForTimeout(300);
}

test.describe('代码路由特效（task_162）', () => {
  test('世界锚定：相机一动，特效的世界坐标不变、屏幕坐标跟着走', async ({ page }) => {
    await boot(page);
    await page.evaluate(
      ([x, y]) => {
        const fx = (window as unknown as { __srfCodeFx?: CodeFxHandle }).__srfCodeFx;
        fx?.play('heal', x as number, y as number);
      },
      [UNIT_X, UNIT_Y],
    );
    await page.waitForTimeout(150);

    const before = await snapshot(page);
    expect(before.active, '特效没播起来').toBeGreaterThan(0);
    expect(before.world[0].x).toBeCloseTo(UNIT_X, 0);

    // 相机右移 200 世界 px。
    await page.evaluate(() => {
      const fx = (window as unknown as { __srfCodeFx?: CodeFxHandle }).__srfCodeFx;
      fx?.pan(200, 0);
    });
    await page.waitForTimeout(120);

    const after = await snapshot(page);
    expect(after.camera.x - before.camera.x, '相机没动').toBeCloseTo(200, 0);
    // 世界坐标不变 —— 特效挂在世界里。
    expect(after.world[0].x, '世界坐标变了 = 没锚在世界坐标').toBeCloseTo(before.world[0].x, 0);
    expect(after.world[0].y).toBeCloseTo(before.world[0].y, 0);
    // 屏幕坐标跟着相机反向平移 —— 这正是 scrollFactor=1 的世界锚定表现。
    expect(
      after.screen[0].x - before.screen[0].x,
      '屏幕坐标没跟着相机走',
    ).toBeCloseTo(-200, 0);

    await page.screenshot({ path: `${SHOTS}/fx-162-world-anchor.png` });
  });

  test('皮肤联动：切皮肤 → 调色板热读 → 下一个实例就用新色', async ({ page }) => {
    await boot(page);
    const before = await snapshot(page);
    expect(before.skin).toBe('default');

    await page.evaluate(() => {
      const fx = (window as unknown as { __srfCodeFx?: CodeFxHandle }).__srfCodeFx;
      fx?.setSkin('pixel');
    });
    await page.waitForTimeout(150);

    const after = await snapshot(page);
    expect(after.skin).toBe('pixel');
    // 皮肤 token 的色值确实换了（读口拿到的表变了）。
    expect(after.tokens['--srf-accent'], '切皮肤后 token 表没变').not.toBe(
      before.tokens['--srf-accent'],
    );
    expect(after.palette.accent, '切皮肤后调色板没变').not.toBe(before.palette.accent);

    // 新实例用的是**新皮肤**的色：实例调色板 = 当前 registry 调色板。
    await page.evaluate(
      ([x, y]) => {
        const fx = (window as unknown as { __srfCodeFx?: CodeFxHandle }).__srfCodeFx;
        fx?.play('heal', x as number, y as number);
      },
      [UNIT_X, UNIT_Y],
    );
    await page.waitForTimeout(120);

    const spawned = await snapshot(page);
    const instance = spawned.world[spawned.world.length - 1];
    expect(instance.kind).toBe('heal');
    // heal 的槽位是 [success ×5, accent, text, text] —— 首个槽位必须等于当前皮肤的 success 色。
    const success = spawned.palette.success;
    expect(success).toBeDefined();
    expect(instance.palette[0], '实例没用上皮肤色').toBe(success);
    expect(instance.palette[0]).not.toBe(before.palette.success);

    await page.screenshot({ path: `${SHOTS}/fx-162-skin-link.png` });
  });

  test('预算护栏：并发上限生效（一次播 8 条 → 场上不超过 2 条）', async ({ page }) => {
    await boot(page);
    await page.click('#controls button[data-act="burst"]');
    await page.waitForTimeout(200);

    const state = await snapshot(page);
    expect(state.active, '并发护栏没生效').toBeLessThanOrEqual(MAX_CONCURRENT);
    expect(state.active, '一条都没播').toBeGreaterThan(0);
    // 渲染频率受预算自适应约束：不得超过目标档。
    expect(state.renderHz).toBeLessThanOrEqual(30);
    expect(state.renderHz).toBeGreaterThanOrEqual(10);

    await page.screenshot({ path: `${SHOTS}/fx-162-concurrency.png` });
  });

  test('护栏实测：浏览器内基准 —— 并发 2 的单帧占用落在单帧预算内', async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page);

    const report = await page.evaluate(async () => {
      const fx = (window as unknown as { __srfCodeFx?: CodeFxHandle }).__srfCodeFx;
      return fx ? fx.bench() : '';
    });
    expect(report, '基准没跑出结果').not.toBe('');

    // 解析「并发 = 2」那一档：effect px 并发 js ms 上传 ms 合计 ms 占预算%
    const rows = report
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(impacts|spawn|scifi|holy|ui)\//.test(line));
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const cells = row.split(/\s+/);
      const concurrency = Number(cells[2]);
      const totalMs = Number(cells[5]);
      expect(Number.isFinite(totalMs), `基准行解析不出来：${row}`).toBe(true);
      if (concurrency === MAX_CONCURRENT) {
        expect(totalMs, `并发 2 的单帧占用超预算：${row}`).toBeLessThan(FRAME_BUDGET_MS);
      }
    }

    // 原始数字留在报告里（评审文档引用同一批数字）。
    console.log('\n=== 代码路由基准（浏览器内实测）===\n' + report + '\n');
  });
});
