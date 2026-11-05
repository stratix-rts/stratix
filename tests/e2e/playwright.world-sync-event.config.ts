/**
 * world-sync **世界事件转发**专用 Playwright 配置（@since v3.3，task_156）。
 *
 * why 不用仓库默认的 playwright.config.ts：
 *   默认配置的 globalSetup 会 `ProcessManager.fullCleanup()` —— 按端口 7523/7524
 *   把 dev vite 与网关进程一起杀掉再重起。本剧本期间 **网关（7524）必须保持运行**
 *   （远程模式的真相源就在那里），故本配置：**不挂 globalSetup / globalTeardown、不管 webServer**
 *   —— 与 playwright.world-sync.config.ts 同一口径，只是本剧本不需要「死端口」那个第二实例。
 *
 * 用法：npx playwright test --config=tests/e2e/playwright.world-sync-event.config.ts
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/world-sync-event-forward.spec.ts',
  // 单文件、单 worker —— e2e 起浏览器是 CPU 大户，别并发（见 PERFORMANCE_GUIDELINES）。
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:7523',
    ...devices['Desktop Chrome'],
  },
});
