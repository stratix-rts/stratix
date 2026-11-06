/**
 * 文件职责：**service 进程的启动器**（前后端分离 C1 / task_084）——
 *   以「独立进程」形态拉起 gateway（service + HTTP/MCP + world-sync 端点），
 *   供 e2e 剧本在**没有 Electron** 的前提下驱动 agent 干活。
 * 输入：环境变量（端口 / 数据目录 / 是否切真 CLI）。
 * 输出：stdout 一行 `SX_SERVICE_READY {json}`（含 pid 与端口）—— 剧本据此判定「起来了」。
 *
 * why 单独一个进程：这条剧本要证明的核心主张是「**壳关了 agent 照常干活**」——
 *   所以执行环必须活在一个**与 Electron 无关**的进程里（service 常驻），而不是渲染进程里。
 *   剧本自己拉这个进程、自己记 pid、自己精确收 —— 不用 pkill 按名扫杀。
 *
 * why 用注入口而不是环境变量换执行器（fake CLI）：
 *   执行器属于「谁造 service 谁决定」的装配口径 —— 生产路径与测试路径在代码里一眼分得开。
 *   `SX_REAL_CLI=1` 时**不给**注入口 → service 走生产口径（真 spawn claude）。
 *
 * 禁止事项：
 *   1. 在这里改 core 状态 / 造数据 —— 本进程只负责「把 service 拉起来」，真相由 core 裁决；
 *   2. 占用 7523 / 7524 / 9222 等在用端口 —— 端口全部由环境变量注入，默认走备用端口；
 *   3. 退出时留下子进程 —— gateway 的 standalone 模式注册了 SIGTERM/SIGINT 的优雅退出。
 *
 * 跑法（一般由 e2e 剧本拉起）：
 *   SX_SERVICE_PORT=7797 SX_WS_PORT=7798 SX_DATA_DIR=/tmp/xxx npx tsx e2e-tests/service-resident/service-process.ts
 *
 * @since task_084（service-split C1）。
 */

import { startGatewayService } from '../../src/stratix-gateway';

import { createFakeTransportFactory } from './fake-cli';

/** HTTP / MCP / world-sync 端口（默认走备用端口，绝不碰 7523 / 7524 / 9222）。 */
const PORT = Number(process.env.SX_SERVICE_PORT ?? 7797);
/** 状态同步 WS 端口（gateway 的 StatusSyncService；与 HTTP 端口分开，避免占用用户实例的 7525）。 */
const WS_PORT = Number(process.env.SX_WS_PORT ?? 7798);
/** 数据目录（存档 / 纹理 / OpenClaw 配置）—— 剧本给一个临时目录，绝不碰用户的真实数据目录。 */
const DATA_DIR = process.env.SX_DATA_DIR ?? 'stratix-data';
/** 是否切真 CLI（'1' = 不注入替身，走生产口径 spawn 真 claude）。 */
const REAL_CLI = process.env.SX_REAL_CLI === '1';

// ★ 环境变量先钉死：gateway 启动时会 load src/stratix-gateway/.env —— 那份文件里
//   PORT=7524 / WS_PORT=7525 正是**用户 dev 实例**的端口。dotenv 不覆盖已存在的环境变量，
//   所以这里先把两个端口写进 env，用户的实例就碰不到（否则本进程会跟用户实例抢 7525 → EADDRINUSE）。
process.env.PORT = String(PORT);
process.env.WS_PORT = String(WS_PORT);
process.env.BIND_ADDRESS = '127.0.0.1';
process.env.DATA_DIR = DATA_DIR;
// NocoDB 明确关掉（用户那份 .env 若开了，本进程不跟着开）。
process.env.NOCO_ENABLED = 'false';

async function main(): Promise<void> {
  const instance = await startGatewayService({
    port: PORT,
    bindAddress: '127.0.0.1',
    dataDir: DATA_DIR,
    mode: 'standalone',
    ...(REAL_CLI ? {} : { serviceTransport: createFakeTransportFactory() }),
  });

  // 就绪标记：一行 JSON，剧本按前缀抓（不靠日志猜）。
  console.log(
    `SX_SERVICE_READY ${JSON.stringify({
      pid: process.pid,
      port: PORT,
      wsPort: WS_PORT,
      dataDir: DATA_DIR,
      realCli: REAL_CLI,
    })}`
  );

  // 挂住进程：gateway 的 standalone 模式已注册 SIGTERM / SIGINT（优雅收尾后 process.exit）。
  // 这里**不再**自己注册退出钩子 —— 重复收尾（关两次 world-sync / StatusSync）反而制造噪音。
  void instance;
}

main().catch((error: unknown) => {
  console.error('[service-process] 启动失败：', error);
  process.exit(1);
});
