/**
 * e2e：world-sync **默认连本地网关** + 断连降级 + 自动重连 —— @since v3.10，task_153。
 *
 * 起因（用户实测）：「功能上似乎未能联通，看不到 agent」。
 *   宿主诊断：task_083 的远程模式开关 STRATIX_REMOTE 默认关 → 浏览器开 7523 压根不连网关
 *   → 网关里的角色 / 任务 / 编组全流不进来 → 战场恒空。
 *   本单的产品语义反转：**连本地网关是默认，连不上才降级**。
 *
 * 四个场景（本文件逐个覆盖）：
 *   ① 连上：纯浏览器开 7523 → ≤5s 连上网关 → 网关名册里的角色（工头-133）带形象上场；
 *   ② 活样本进浏览器：MCP 侧新建角色（curl /mcp 的 tools/call）→ 浏览器 ≤3s 上场
 *      → character_delete 后下场（测完清理「十测-」前缀的数据）；
 *   ③ 断连降级：WS 握手被打断 → 127 的三级横幅亮「连接降级」（HTTP 面还通 → 数据可用）；
 *      恢复通道后 → **自动重连** → 角色重新上场；
 *   ④ 死端口（端点指向没人监听的端口）→ 横幅「未连接」+ **UI 不死**（HUD 照常在、能交互）。
 *
 * why ③ 用「网络拦截」而 ④ 用「死端口」：
 *   ③ 要验证的是**恢复**（通道恢复后自动重连）—— 拦截能精确控制「先断后通」；
 *   ④ 要验证的是**端点整体不可达**（含 HTTP 面）—— 那是环境事实，用真死端口最诚实
 *      （另起一个带 STRATIX_WORLD_SYNC_URL=ws://127.0.0.1:9999/ws/world-sync 的 vite 实例，
 *        端口 7543；**不动** 7523 / 7524，网关进程全程不碰）。
 *
 * 跑法：npx playwright test --config=tests/e2e/playwright.world-sync.config.ts
 */

import { expect, test, type Page } from '@playwright/test';

/** 主 dev 实例（默认装配 = 连本地网关）。 */
const APP_URL = '/';
/** 端点指向死端口的 dev 实例（起动时带 STRATIX_WORLD_SYNC_URL=ws://127.0.0.1:9999/ws/world-sync）。 */
const DEAD_ENDPOINT_APP_URL = 'http://127.0.0.1:7543/';
/** 网关 MCP 的 HTTP 端点（JSON-RPC over HTTP，任务书指定用 curl 造数据）。 */
const MCP_URL = 'http://127.0.0.1:7524/mcp';
/** 测试数据前缀（测完必须清理干净）。 */
const TEST_NAME = '十测-甲';
/** world-sync 通道（WS）。 */
const WS_PATTERN = '**/ws/world-sync';

/** 世界态的最小读数面（从 dev 观测句柄取 —— 走既有通道，不开后门）。 */
interface Snapshot {
  readonly characters: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly units: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly missions: ReadonlyArray<{ readonly id: string; readonly title: string; readonly phase: string }>;
}

/** 读当前世界态快照。 */
async function readSnapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const handle = (window as unknown as { __srfApp?: { snapshot: () => unknown } }).__srfApp;
    return handle?.snapshot() as Snapshot;
  });
}

/** 起页面并等 HUD 就位。 */
async function boot(page: Page, url: string = APP_URL): Promise<void> {
  await page.goto(url);
  await page.waitForSelector('strat-status-screen', { timeout: 20_000 });
  // 横幅宿主是 `all: initial` 的零尺寸元素 —— 等「attached」而不是「visible」。
  await page.waitForSelector('strat-gateway-banner', { state: 'attached', timeout: 20_000 });
}

/** 全局横幅本体（data-state = online / degraded / offline）。 */
function banner(page: Page) {
  return page.locator('strat-gateway-banner [data-role="gateway-banner"]');
}

/** 横幅标题。 */
function bannerTitle(page: Page) {
  return page.locator('strat-gateway-banner [data-role="title"]');
}

/** 调 MCP 工具（tools/call）。 */
async function callMcpTool(tool: string, args: Record<string, unknown>): Promise<string> {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });
  const payload = (await response.json()) as {
    result?: { content?: Array<{ text?: string }> };
    error?: { message?: string };
  };
  if (payload.error) throw new Error(`MCP 调用失败：${payload.error.message ?? '未知错误'}`);
  return payload.result?.content?.[0]?.text ?? '';
}

test.describe('world-sync 默认连本地网关（task_153）', () => {
  test('① 缺省即连：≤5s 连上网关，网关名册里的角色带形象上场', async ({ page }) => {
    const started = Date.now();
    await boot(page);

    // ≤5s 内拿到第一份快照（= world-sync 连上并收到 gateway 的全量快照）。
    await expect
      .poll(async () => (await readSnapshot(page)).characters.length, { timeout: 5_000 })
      .toBeGreaterThan(0);
    const elapsed = Date.now() - started;

    const state = await readSnapshot(page);
    // 活样本：网关里现存的「工头-133」必须出现在浏览器里（这就是用户报告里"看不到 agent"的正解）。
    expect(state.characters.map((item) => item.name)).toContain('工头-133');
    // 单位也上场（角色自带一个单位 —— 见 core 的 character.create 落点）。
    expect(state.units.map((item) => item.name)).toContain('工头-133');
    // 编组 / 任务数据同样流进来了（mission「加固城墙-133」在快照里）。
    expect(state.missions.map((item) => item.title)).toContain('加固城墙-133');

    // HUD 名册里看得到这个角色（不是只有内部状态有）。
    await expect(page.locator('strat-agent-panel')).toBeAttached({ timeout: 20_000 });

    await page.screenshot({ path: 'reports/shots/world-sync-r11-connected.png' });
    expect(elapsed).toBeLessThan(5_000);
  });

  test('② MCP 侧新建角色 → 浏览器 ≤3s 上场；character_delete 后下场', async ({ page }) => {
    await boot(page);
    await expect
      .poll(async () => (await readSnapshot(page)).characters.length, { timeout: 5_000 })
      .toBeGreaterThan(0);

    // ★ 先清场：名册里若已有同名的「十测-」角色（上一轮跑剩的），先删干净 ——
    //   否则「≤3s 上场」这条断言会被**本来就存在**的角色喂饱（假绿）。
    for (const item of (await readSnapshot(page)).characters) {
      if (!item.name.startsWith('十测-')) continue;
      await callMcpTool('stratix_character_delete', { character_id: item.id });
    }
    await expect
      .poll(
        async () =>
          (await readSnapshot(page)).characters.some((item) => item.name.startsWith('十测-')),
        { timeout: 5_000 },
      )
      .toBe(false);

    // 造数据（用「十测-」前缀，测完清理）。
    const created = await callMcpTool('stratix_character_create', { name: TEST_NAME });
    expect(created).toContain('十测-甲');

    // ≤3s 上场（快照广播是 100ms 节流 + WS 往返 —— 远小于 3s）。
    await expect
      .poll(
        async () => (await readSnapshot(page)).characters.some((item) => item.name === TEST_NAME),
        { timeout: 3_000 },
      )
      .toBe(true);
    expect((await readSnapshot(page)).units.map((item) => item.name)).toContain(TEST_NAME);

    await page.screenshot({ path: 'reports/shots/world-sync-r11-mcp-created.png' });

    // 删档 → 下场（不留测试垃圾）。
    const state = await readSnapshot(page);
    const target = state.characters.find((item) => item.name === TEST_NAME);
    expect(target).toBeTruthy();
    await callMcpTool('stratix_character_delete', { character_id: target!.id });
    await expect
      .poll(
        async () => (await readSnapshot(page)).characters.some((item) => item.name === TEST_NAME),
        { timeout: 5_000 },
      )
      .toBe(false);
  });

  test('③ 断连 → 降级横幅（数据可用）；通道恢复 → 自动重连 → 角色重新上场', async ({ page }) => {
    // 通道开关：false = 握手即断（模拟实时通道断）；true = 放行到真网关。
    let channelUp = false;
    await page.routeWebSocket(WS_PATTERN, (ws) => {
      if (channelUp) {
        ws.connectToServer();
        return;
      }
      ws.close();
    });

    await boot(page);

    // HTTP 面还通（网关活着）→ 三级态落在「降级」：数据可用，实时更新断了。
    await expect(bannerTitle(page)).toHaveText('连接降级', { timeout: 20_000 });
    await expect(banner(page)).toHaveAttribute('data-state', 'degraded');
    await page.screenshot({ path: 'reports/shots/world-sync-r11-degraded.png' });

    // 断连期间 UI 不死：HUD 照常在、状态屏读得出「连接降级」。
    await expect(page.locator('strat-status-screen')).toBeAttached();
    await expect(
      page.locator('strat-status-screen [data-sys="connection"] [data-role="sys-value"]'),
    ).toHaveText('连接降级', { timeout: 20_000 });

    // 恢复通道 → remote-store 的指数退避重连（500ms 起、×2、封顶 10s）自动接回。
    channelUp = true;
    await expect
      .poll(async () => (await readSnapshot(page)).characters.length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    expect((await readSnapshot(page)).characters.map((item) => item.name)).toContain('工头-133');

    await expect(banner(page)).toHaveAttribute('data-state', 'online', { timeout: 20_000 });
    await page.screenshot({ path: 'reports/shots/world-sync-r11-reconnected.png' });
  });

  test('④ 端点指向死端口 → 横幅「未连接」+ UI 不死', async ({ page }) => {
    await boot(page, DEAD_ENDPOINT_APP_URL);

    // HTTP 面也不通（死端口）→ 离线态（127 三级词表：bannerTitle = 「服务未连接」）。
    await expect(bannerTitle(page)).toHaveText('服务未连接', { timeout: 20_000 });
    await expect(banner(page)).toHaveAttribute('data-state', 'offline');

    // UI 不死：HUD 照常在、状态屏照常渲染。
    await expect(page.locator('strat-status-screen')).toBeAttached();
    await expect(
      page.locator('strat-status-screen [data-sys="connection"] [data-role="sys-value"]'),
    ).toHaveText('未连接', { timeout: 20_000 });

    await page.screenshot({ path: 'reports/shots/world-sync-r11-offline-dead-endpoint.png' });
  });
});
