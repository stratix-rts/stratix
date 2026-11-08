/**
 * 文件职责：**PERF-01 冷启动基线的渲染层进程（vite preview / 生产产物）**（@since v3.3，task_230 / PERF-01）。
 *
 * ============ 为什么要有这个进程（与 vite-server.ts 并列）============
 *   `vite-server.ts` 量的是 **dev server**：页面要逐个拉 273 个模块、每个还要现转译
 *   ⇒ 那段开销**用户拿不到**（用户拿的是 rollup 打完的 bundle）。
 *   本进程服务**生产产物**（dist/perf-frontend/）⇒ 量出来的是「用户实际执行的那份代码」。
 *   两个进程都跑同一套基线 ⇒ 基线能同时回答：
 *     「开发期热启动要多久」与「用户首次打开要多久」。
 *
 * ============ 与 dev server 版的差异（只有三处，其余同构）============
 *   ① 服务对象：`build.outDir` 的静态产物（不是模块图）；
 *   ② `/api` / `/textures` / `/ws` 仍代理到**本次基线自己的 service**（端口由环境变量钉死）；
 *   ③ 场景 create 打点**在构建期就注入了**（perf-build.ts）⇒ 本进程不需要再注。
 *
 * 输入：两个环境变量 ——
 *   SX_PERF_VITE_PORT      本次基线的前端端口（缺省 7624）；
 *   SX_PERF_SERVICE_PORT   页面相对 URL 的代理目标 = 本次基线的 service 端口（缺省 7841）。
 * 输出：stdout 一行 `SX_PERF_VITE_READY {json}`。
 * 禁止事项：
 *   1. 代理到 7524 / 7525 —— 那是用户实例，本单一个字节都不许碰；
 *   2. 改产物目录里的文件 —— 只读。
 *
 * @since v3.3，task_230。
 */

import * as path from 'node:path';

import { preview } from 'vite';

/** 仓库根（本文件在 e2e-tests/perf-baseline/ 下 ⇒ 上溯两级）。 */
const REPO_ROOT = path.resolve(__dirname, '../..');

const VITE_PORT = Number(process.env.SX_PERF_VITE_PORT ?? '7624');
const SERVICE_PORT = Number(process.env.SX_PERF_SERVICE_PORT ?? '7841');
const OUT_DIR = process.env.SX_PERF_OUT_DIR ?? 'dist/perf-frontend';

async function main(): Promise<void> {
  const server = await preview({
    // 配置在本文件里装配好 ⇒ 不让 vite 再去读仓库那份（免得代理被写回 7524）。
    configFile: false,
    root: REPO_ROOT,
    // 与仓库构建同口径：入口在站点根，产物用相对路径引用（file:// 下也能用）。
    base: './',
    build: { outDir: OUT_DIR },
    preview: {
      host: '127.0.0.1',
      port: VITE_PORT,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${SERVICE_PORT}`,
          changeOrigin: true,
          ws: true,
        },
        '/textures': {
          target: `http://127.0.0.1:${SERVICE_PORT}`,
          changeOrigin: true,
        },
        '/ws': {
          target: `ws://127.0.0.1:${SERVICE_PORT}`,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  });

  console.log(
    `SX_PERF_VITE_READY ${JSON.stringify({
      port: VITE_PORT,
      servicePort: SERVICE_PORT,
      root: REPO_ROOT,
      mode: 'preview',
      outDir: OUT_DIR,
    })}`,
  );

  const shutdown = async (): Promise<void> => {
    await server.httpServer.close();
  };
  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `[perf-preview] 启动失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
