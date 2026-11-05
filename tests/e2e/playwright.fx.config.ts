/**
 * 特效触点验收专用 Playwright 配置（@since v3.3，task_161）。
 *
 * why 单独一份配置：本剧本打的是 **dev 验收页**（/src/world/dev/fx-dev.html），
 *   不连网关、不碰 7524 —— 故不挂 globalSetup / globalTeardown（那两份会按 7523 / 7524
 *   把 dev vite 与网关一起杀掉再起，本任务期间网关必须保持运行）。
 *   只复用已经在跑的 7523（vite HMR）。
 *
 * 用法：npx playwright test --config=tests/e2e/playwright.fx.config.ts
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/fx-touchpoints.spec.ts', '**/fx-code-route.spec.ts'],
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
