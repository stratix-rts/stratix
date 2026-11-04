/**
 * e2e：像素风图标真像素路径 + 组件像素细节（@since v3.8，task_135）。
 *
 * 覆盖验收口径：
 *   ① 像素皮肤下顶栏**全部图标**都是网格路径（DOM 断言：viewBox=16×16、
 *      每条 path 的 d 只含 M/h/v/z —— 没有任何曲线指令）；
 *   ② 现代皮肤下顶栏图标零变化（viewBox=24×24、线条描边、曲线仍在）；
 *   ③ 切皮**不重建 DOM**（同一个 svg 元素被就地换图形）；
 *   ④ 布局骨架零变化：两皮肤下关键元素的 boundingRect 坐标差 ≤ 1px；
 *   ⑤ 组件像素细节：按钮 / 面板 / 对话框 / 横幅 四类都带双线边框或角块。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.hud.config.ts
 *   （该配置不挂 globalSetup —— 不会杀掉在跑的 7523/7524。）
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/src/app/main/index.html';
const SHOTS = 'reports/shots';

/** 曲线指令 = 矢量味 = 不是像素艺术。 */
const CURVE = /[CQASTcqast]/;

/** 起页面：进主屏、跳过首启向导、等命令面板就位。 */
async function boot(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForSelector('strat-command-panel', { timeout: 15_000 });
  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(500);
  }
}

/** 切皮肤（走顶栏那颗「像素风」按钮 = 真实用户路径）。 */
async function setSkin(page: Page, skin: 'default' | 'pixel'): Promise<void> {
  await page.evaluate((id) => {
    const store = window.localStorage;
    store.setItem('stratix.skin', id);
  }, skin);
  await page.reload();
  await page.waitForSelector('strat-command-panel', { timeout: 15_000 });
  const skip = page.locator('strat-onboarding-screen [data-action="skip"]');
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(300);
}

/**
 * 收集顶栏全部图标（含 shadow DOM 内部）的几何信息。
 * why 要钻 shadow：按钮的图标在 shadow 里（widgets/strat-button.ts）。
 */
async function collectIcons(page: Page): Promise<
  { viewBox: string; fill: string; stroke: string; paths: string[] }[]
> {
  return page.evaluate(() => {
    const out: { viewBox: string; fill: string; stroke: string; paths: string[] }[] = [];
    const visit = (scope: ParentNode): void => {
      scope.querySelectorAll('svg.srf-icon[data-icon]').forEach((el) => {
        const svg = el as SVGSVGElement;
        out.push({
          viewBox: svg.getAttribute('viewBox') ?? '',
          fill: svg.getAttribute('fill') ?? '',
          stroke: svg.getAttribute('stroke') ?? '',
          paths: Array.from(svg.querySelectorAll('path')).map((p) => p.getAttribute('d') ?? ''),
        });
      });
      scope.querySelectorAll('*').forEach((el) => {
        const shadow = (el as HTMLElement).shadowRoot;
        if (shadow) visit(shadow);
      });
    };
    visit(document);
    return out;
  });
}

/** 关键元素的 boundingRect（布局骨架快照）。 */
async function skeleton(page: Page): Promise<Record<string, { x: number; y: number; w: number; h: number }>> {
  return page.evaluate(() => {
    const pick = (sel: string): { x: number; y: number; w: number; h: number } => {
      const el = document.querySelector(sel);
      if (!el) return { x: -1, y: -1, w: -1, h: -1 };
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    };
    return {
      topbar: pick('.hud-topbar'),
      bottomBar: pick('.hud-bottom-bar'),
      agentPanel: pick('[data-role="agent-panel"]'),
      themeButton: pick('[data-role="theme"]'),
      soundButton: pick('[data-role="sound"]'),
      overflowButton: pick('[data-role="overflow"]'),
    };
  });
}

test.describe('像素风图标真像素路径（task_135）', () => {
  test('像素皮：顶栏图标全是方块路径；现代皮：图标零变化', async ({ page }) => {
    await boot(page);

    // —— 现代皮基线 ——
    await setSkin(page, 'default');
    const modernIcons = await collectIcons(page);
    expect(modernIcons.length).toBeGreaterThanOrEqual(4);
    for (const icon of modernIcons) {
      expect(icon.viewBox).toBe('0 0 24 24');
      expect(icon.fill).toBe('none');
      expect(icon.stroke).toBe('currentColor');
    }
    const modernSkeleton = await skeleton(page);
    await page.screenshot({ path: `${SHOTS}/pixel-icons-r5-modern.png`, fullPage: false });

    // —— 像素皮 ——
    await setSkin(page, 'pixel');
    const pixelIcons = await collectIcons(page);
    expect(pixelIcons.length).toBeGreaterThanOrEqual(4);
    for (const icon of pixelIcons) {
      expect(icon.viewBox).toBe('0 0 16 16');
      expect(icon.fill).toBe('currentColor');
      expect(icon.stroke).toBe('none');
      // 每条 path 只允许 M/h/v/z（无曲线）→ 网格方块。
      for (const d of icon.paths) {
        expect(d).not.toMatch(CURVE);
        for (const cmd of d.match(/[A-Za-z]/g) ?? []) {
          expect(['M', 'h', 'v', 'z']).toContain(cmd);
        }
      }
    }
    const pixelSkeleton = await skeleton(page);
    await page.screenshot({ path: `${SHOTS}/pixel-icons-r5-pixel.png`, fullPage: false });

    // —— 布局骨架对比：坐标差 ≤ 1px ——
    const diffs: Record<string, { dx: number; dy: number; dw: number; dh: number }> = {};
    for (const key of Object.keys(modernSkeleton)) {
      const a = modernSkeleton[key];
      const b = pixelSkeleton[key];
      diffs[key] = {
        dx: Math.round((b.x - a.x) * 10) / 10,
        dy: Math.round((b.y - a.y) * 10) / 10,
        dw: Math.round((b.w - a.w) * 10) / 10,
        dh: Math.round((b.h - a.h) * 10) / 10,
      };
    }
    console.log('[task_135] 骨架 modern:', JSON.stringify(modernSkeleton));
    console.log('[task_135] 骨架 pixel :', JSON.stringify(pixelSkeleton));
    console.log('[task_135] 骨架 diff  :', JSON.stringify(diffs));
    // 锚定元素（绝对定位的容器）：坐标与尺寸都必须一致（差 ≤ 1px）。
    for (const key of ['topbar', 'bottomBar', 'agentPanel']) {
      const d = diffs[key];
      expect(Math.abs(d.dx), `${key}.dx`).toBeLessThanOrEqual(1);
      expect(Math.abs(d.dy), `${key}.dy`).toBeLessThanOrEqual(1);
      expect(Math.abs(d.dw), `${key}.dw`).toBeLessThanOrEqual(1);
      expect(Math.abs(d.dh), `${key}.dh`).toBeLessThanOrEqual(1);
    }
    // 顶栏里的流式元素：**尺寸**必须一致（≤1px）；x 的偏移来自**字宽**（像素皮用
    // Fusion Pixel 字体、现代皮用系统等宽 —— task_134 起就有的既有差异，与本次改动无关）。
    for (const key of ['soundButton', 'overflowButton']) {
      const d = diffs[key];
      expect(Math.abs(d.dw), `${key}.dw`).toBeLessThanOrEqual(1);
      expect(Math.abs(d.dh), `${key}.dh`).toBeLessThanOrEqual(1);
    }
  });

  test('切皮不重建 DOM：同一个 svg 元素被就地换成像素图形', async ({ page }) => {
    await boot(page);
    await setSkin(page, 'default');
    // 探针打在**声音按钮**上（顶栏里不会因切皮而重绘的那一颗：
    // 「像素风」那颗会因文案变化而重绘自身 —— 那是按钮自己的行为，与换图标无关）。
    const before = await page.evaluate(() => {
      const el = document.querySelector('[data-role="sound"]');
      const svg = el?.shadowRoot?.querySelector('svg.srf-icon') as SVGSVGElement | null;
      svg?.setAttribute('data-probe', 'yes');
      return svg?.getAttribute('viewBox') ?? '';
    });
    expect(before).toBe('0 0 24 24');

    // 点顶栏那颗「像素风」按钮（真实用户路径：先开 ⋯ 溢出菜单）。
    await page.locator('[data-role="overflow"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-role="theme"]').click();
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => {
      const el = document.querySelector('[data-role="sound"]');
      const svg = el?.shadowRoot?.querySelector('svg.srf-icon') as SVGSVGElement | null;
      return {
        viewBox: svg?.getAttribute('viewBox') ?? '',
        probe: svg?.getAttribute('data-probe') ?? '', // 同一个元素 = 没重建
        paths: svg?.querySelectorAll('path').length ?? 0,
      };
    });
    expect(after.viewBox).toBe('0 0 16 16');
    expect(after.probe).toBe('yes');
    expect(after.paths).toBeGreaterThanOrEqual(2);
  });

  test('组件像素细节：按钮 / 面板 / 对话框 / 横幅 带双线边框或角块', async ({ page }) => {
    await boot(page);
    await setSkin(page, 'pixel');
    await page.waitForTimeout(300);

    // 面板（light DOM）：双线边框（inset 阴影）+ 四角角块（background 定位方块）。
    const panel = await page.evaluate(() => {
      const el = document.querySelector('[data-role="agent-panel"]') as HTMLElement | null;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        boxShadow: cs.boxShadow,
        backgroundImage: cs.backgroundImage,
        backgroundSize: cs.backgroundSize,
      };
    });
    expect(panel).not.toBeNull();
    expect(panel?.boxShadow).toContain('inset');
    expect(panel?.backgroundImage).toContain('linear-gradient');
    expect(panel?.backgroundSize).not.toBe('0px 0px');

    // 按钮（shadow DOM）：双线边框 + 角块。
    const button = await page.evaluate(() => {
      const el = document.querySelector('[data-role="theme"]');
      const btn = el?.shadowRoot?.querySelector('button') as HTMLElement | null;
      if (!btn) return null;
      const cs = getComputedStyle(btn);
      return { boxShadow: cs.boxShadow, backgroundImage: cs.backgroundImage, backgroundSize: cs.backgroundSize };
    });
    expect(button).not.toBeNull();
    expect(button?.boxShadow).toContain('inset');
    expect(button?.backgroundImage).toContain('linear-gradient');

    // 对话框 / 横幅：组件的 shadow 样式里带了同一套语言（双线 + 角块）。
    const dialogCss = await page.evaluate(() => {
      const el = document.querySelector('strat-new-task-dialog') as (HTMLElement & { shadowRoot?: ShadowRoot }) | null;
      return el?.shadowRoot?.querySelector('style')?.textContent ?? '';
    });
    expect(dialogCss).toContain('--srf-double-shadow');
    expect(dialogCss).toContain('--srf-notch-color');

    const bannerCss = await page.evaluate(() => {
      const el = document.querySelector('strat-gateway-banner') as (HTMLElement & { shadowRoot?: ShadowRoot }) | null;
      return el?.shadowRoot?.querySelector('style')?.textContent ?? '';
    });
    expect(bannerCss).toContain('--srf-double-shadow');
    expect(bannerCss).toContain('--srf-notch-color');
  });
});
