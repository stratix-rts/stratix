/**
 * world-sync e2e 的 globalSetup（@since v3.10，task_153）。
 *
 * 起**第二个 vite 实例**（端口 7543），起动时带 `STRATIX_WORLD_SYNC_URL=ws://127.0.0.1:9999/ws/world-sync`
 *   —— 指向一个**没人监听的端口**，于是「端点整体不可达」是环境事实，而不是被拦截出来的假象。
 *
 * why 不动 7523 / 7524：任务书要求网关（7524）全程不碰；7523 是别的剧本在用的 dev 实例，
 *   把它重启成「死端口」会波及别的流程 —— 故另起一个实例顶替。
 *
 * teardown：跑完把这个 vite 收干净（不留后台进程 —— 见 PERFORMANCE_GUIDELINES「后台脚本用完即关」）。
 */

import { type ChildProcess, spawn } from 'child_process';

const DEV_PORT = 7543;
const READY_TIMEOUT_MS = 60_000;

/** 轮询等 vite 起来（探 HTTP 根）。 */
async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) return;
    } catch {
      // 还没起来 —— 继续等。
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`dev 实例未在 ${timeoutMs}ms 内就绪：${url}`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const child: ChildProcess = spawn(
    'npx',
    ['vite', '--port', String(DEV_PORT), '--strictPort'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        // 死端口：world-sync 端点指向没人监听的端口 → HTTP 面与 WS 面都不通。
        STRATIX_WORLD_SYNC_URL: 'ws://127.0.0.1:9999/ws/world-sync',
      },
      stdio: 'ignore',
    },
  );
  child.unref();

  await waitForServer(`http://127.0.0.1:${DEV_PORT}/`, READY_TIMEOUT_MS);

  return async () => {
    child.kill('SIGTERM');
  };
}
