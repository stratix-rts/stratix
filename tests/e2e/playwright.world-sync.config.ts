/**
 * world-sync 默认连通性专用 Playwright 配置（@since v3.10，task_153）。
 *
 * why 不用仓库默认的 playwright.config.ts：
 *   默认配置的 globalSetup 会 `ProcessManager.fullCleanup()` —— 按端口 7523/7524
 *   把 dev vite 与网关进程一起杀掉再重起。本任务期间 **网关（7524）必须保持运行**
 *   （任务书：勿动网关进程），本任务只需要复用已经在跑的 7523。
 *   故本配置：**不挂 globalSetup / globalTeardown、不管 webServer** —— 与
 *   playwright.gateway-connection.config.ts 同一口径。
 *
 * 断连场景用**另一个 vite 实例**（7543，起动时带 STRATIX_WORLD_SYNC_URL=死端口），
 *   不动 7523 / 7524 —— 见 spec 顶部的说明。
 *
 * 用法：npx playwright test --config=tests/e2e/playwright.world-sync.config.ts
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/world-sync-default.spec.ts',
  // 断连场景要一个「端点指向死端口」的 dev 实例 —— globalSetup 起它、teardown 收干净。
  // ★ 它**不碰** 7523 / 7524（网关全程不动，7523 是别的剧本在用的实例）。
  globalSetup: './global-setup.world-sync.ts',
  // 单文件、单 worker —— e2e 起浏览器是 CPU 大户，别并发（见 PERFORMANCE_GUIDELINES）。
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:7523',
    ...devices['Desktop Chrome'],
  },
});
