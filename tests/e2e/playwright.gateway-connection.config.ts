/**
 * 网关连通性三级态专用 Playwright 配置（@since v3.7，task_127）。
 *
 * why 不用仓库默认的 playwright.config.ts：
 *   默认配置的 globalSetup 会 `ProcessManager.fullCleanup()` —— 它按端口 7523/7524
 *   把 dev vite 与网关进程一起杀掉再重起。而本任务期间 **网关（7524）必须保持运行**
 *   （任务书：勿动网关进程），本任务只需要复用已经在跑的 7523。
 *   故本配置：**不挂 globalSetup / globalTeardown、不管 webServer**，
 *   只复用已经在跑的 7523（vite HMR）—— 与 playwright.hud.config.ts / cli 配置同一口径。
 *
 * 用法：npx playwright test --config=tests/e2e/playwright.gateway-connection.config.ts
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/gateway-connection.spec.ts',
  // 单文件、单 worker —— e2e 起浏览器是 CPU 大户，别并发（见 PERFORMANCE_GUIDELINES）。
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:7523',
    ...devices['Desktop Chrome'],
  },
});
