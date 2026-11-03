/**
 * e2e：网关连通性**三级**（在线 / 降级 / 离线）—— @since v3.7，task_127。
 *
 * 覆盖复测报告（reports/2026-11-04-stratix-ui-review.md 新发现 #2）的原症状与验收口径：
 *   ① 在线（HTTP 通 + 实时通道通）→ 横幅隐藏，态势屏「网关连接」行显示「已连接」；
 *   ② **半连接**（HTTP 通、实时通道断）→ 横幅亮出「连接降级 · 数据可用，实时通道断开」，
 *      态势屏那一行显示「连接降级」—— 两处**不再**出现「未连接」却功能可用的矛盾；
 *   ③ 离线（HTTP 不通）→ 横幅「网关未连接 · 多数功能暂时没有数据」（task_114 原文案不变），
 *      那一行显示「未连接」。
 *
 * why 用「网络拦截」模拟而不是改产品代码：
 *   半连接是**环境事实**（网关活着但实时通道断了），测试侧拦截 WS 握手即可复现；
 *   产品代码里不留任何「假装断网」的后门（改产品逻辑造假 = 假实现）。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.gateway-connection.config.ts
 *   （该配置不挂 globalSetup / 不管 webServer —— 复用已在跑的 7523/7524，不动网关进程。）
 */

import { expect, test, type Page } from '@playwright/test';

const APP_URL = '/';
/** 实时通道（WS）端点 —— 与 app/services/gateway-link.ts 的探测地址一致。 */
const WS_PATTERN = '**/ws/world-sync';
/** 网关健康端点（HTTP 面）。 */
const HEALTH_PATTERN = '**/health';

/** 起页面并等 HUD 就位。 */
async function boot(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForSelector('strat-status-screen', { timeout: 15_000 });
  // 注意：横幅宿主是 `all: initial` 的零尺寸元素 —— 等「attached」而不是「visible」。
  await page.waitForSelector('strat-gateway-banner', { state: 'attached', timeout: 15_000 });
}

/** 全局横幅本体（隐藏 = 在线）。 */
function banner(page: Page) {
  return page.locator('strat-gateway-banner [data-role="gateway-banner"]');
}

/** 横幅标题。 */
function bannerTitle(page: Page) {
  return page.locator('strat-gateway-banner [data-role="title"]');
}

/** 横幅说明。 */
function bannerDetail(page: Page) {
  return page.locator('strat-gateway-banner [data-role="detail"]');
}

/** 态势屏「网关连接」那一行的取值。 */
function connectionValue(page: Page) {
  return page.locator('strat-status-screen [data-sys="connection"] [data-role="sys-value"]');
}

/** 态势屏「网关连接」那一行的说明。 */
function connectionDetail(page: Page) {
  return page.locator('strat-status-screen [data-sys="connection"] [data-role="sys-detail"]');
}

test.describe('网关连通性三级（在线 / 降级 / 离线）', () => {
  test('在线 → 横幅隐藏，状态行「已连接」', async ({ page }) => {
    await boot(page);

    // 等探测周期跑过一轮（2s 周期）—— 首帧是乐观的「在线」，不等于探到了。
    // 放宽到多等几轮：dev 首次加载时 vite 正在转译模块，机器忙起来偶发探活超时。
    await page.waitForTimeout(4_000);

    await expect(banner(page)).toHaveAttribute('data-state', 'online');
    await expect(banner(page)).toBeHidden();
    await expect(connectionValue(page)).toHaveText('已连接', { timeout: 20_000 });
    await expect(connectionDetail(page)).toHaveText('数据与实时通道均可用');

    await page.screenshot({ path: 'test-results/gateway-connection-online.png' });
  });

  test('半连接（HTTP 通、实时通道断）→ 降级：文案说清「数据可用」，不出现「未连接」', async ({ page }) => {
    // 实时通道握手即断 —— HTTP 面照常通（网关活着，只是实时通道断了）。
    await page.routeWebSocket(WS_PATTERN, (ws) => {
      ws.close();
    });

    await boot(page);

    await expect(bannerTitle(page)).toHaveText('连接降级', { timeout: 20_000 });
    await expect(bannerDetail(page)).toHaveText('数据可用，实时通道断开');
    // 关键断言：降级态**不得**出现「未连接」（那与「数据照样可用」自相矛盾）。
    await expect(bannerTitle(page)).not.toContainText('未连接');
    await expect(connectionValue(page)).toHaveText('连接降级', { timeout: 20_000 });
    await expect(connectionDetail(page)).toHaveText('数据可用，实时通道断开');
    // 横幅与状态行说的是同一件事（同一真相源）。
    await expect(bannerTitle(page)).toHaveText('连接降级');
    await expect(connectionValue(page)).toHaveText('连接降级', { timeout: 20_000 });

    await page.screenshot({ path: 'test-results/gateway-connection-degraded.png' });
  });

  test('全断（HTTP 不通）→ 离线：task_114 原文案不变', async ({ page }) => {
    await page.route(HEALTH_PATTERN, (route) => route.abort());

    await boot(page);

    await expect(bannerTitle(page)).toHaveText('网关未连接', { timeout: 20_000 });
    await expect(bannerDetail(page)).toHaveText('多数功能暂时没有数据');
    await expect(connectionValue(page)).toHaveText('未连接', { timeout: 20_000 });

    await page.screenshot({ path: 'test-results/gateway-connection-offline.png' });
  });
});
