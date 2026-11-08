/**
 * 文件职责：**PERF-01 冷启动基线的 service 进程**（@since v3.3，task_230 / PERF-01）。
 *
 * ============ 这一单要什么 ============
 *   冷启动**分段**耗时：从进程起到 `/health` 可应答，中间每一段各多少毫秒。
 *   ⇒ 本文件是**生产装配口径的最小复刻**（与 e2e-tests/qa-full-flow/qa-service-process.ts
 *   同一套接线），唯一的差别是**每段都掐了表**。
 *
 * ============ 分段口径（每段的边界都写在代码里，不靠事后猜）============
 *   · `startup`      —— node 启动 + tsx 转译 + 模块求值（进程起到本文件模块体开头）
 *   · `branchProbe`  —— git 分支探测（生产 gateway 冷启动也会付这一笔：spawn 一次 git）
 *   · `dbInit`       —— SQLite 开库 + 建表兜底（生产口径：createServiceStorage）
 *   · `registry`     —— 实例注册表（默认沙盒物化 + 副本清单）
 *   · `bootService`  —— 组合根（core runtime + 执行环 + 世界态恢复 + agent 探测起跑）
 *   · `listen`       —— HTTP + world-sync 端点挂上、端口开始听
 *   （`spawn → /health ok` 的**总时长**由驱动脚本在自己的时钟上量 —— 含 tsx 冷启，本文件量不到）
 *
 * ============ 纪律（与 QA harness 同款）============
 *   - 端口由外部钉死（SX_PERF_PORT），**绝不**碰 7523 / 7524 / 7525 / 9222；
 *   - DATA_DIR 与沙盒根都在临时目录里 ⇒ **一个字节都不写进用户的仓**；
 *   - 进程 cwd = 沙盒根（退出副本时的归档文件写进实例根 ⇒ 实例根必须在临时目录）。
 *
 * 输入（环境变量）：
 *   SX_PERF_PORT           service 端口（HTTP + world-sync WS 同一端口，与生产一致）。
 *   SX_PERF_DATA_DIR       临时 DATA_DIR（SQLite + 世界态快照）。
 *   SX_PERF_SANDBOX_ROOT   默认沙盒的项目根（= 进程 cwd 语义，但显式钉死）。
 *   SX_PERF_INSTANCE_B_ROOT 第二个副本的项目根（**带名册** ⇒ 进副本时会发生 roster 物化）。
 * 输出：stdout 一行 `SX_PERF_SERVICE_READY {json}`（含 `stages` 分段耗时，单位 ms）。
 * 禁止事项：
 *   1. 断言 —— 断言在驱动脚本（perf-baseline.e2e.mjs）里，本文件只**如实回报所见**；
 *   2. 改生产行为 —— 本文件只接线 + 掐表，不改 core / service 的语义；
 *   3. 读用户的库 / 端口 —— DATA_DIR 与实例根都由外部钉在临时目录。
 *
 * @since v3.3，task_230。
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import cors from 'cors';
import express from 'express';

import { createInstanceRegistryWithDefaultSandbox } from '../../src/app/services/persistence/default-sandbox';
import { nodeProcessGitBranch } from '../../src/app/services/persistence/default-sandbox-node';
import { emitCommand, emitWorldEvent, onWorldEvent } from '../../src/core/bus';
import type { SqliteDatabaseLike } from '../../src/app/services/persistence/game-save-dao';
import { getDatabase } from '../../src/stratix-database';
import { attachWorldSyncEndpoint } from '../../src/stratix-gateway/api/websocket/world-sync/endpoint';
import { WORLD_SYNC_PATH } from '../../src/stratix-gateway/api/websocket/world-sync/protocol';
import { bootStratixService } from '../../src/stratix-gateway/service/boot';
import { createServiceStorage } from '../../src/stratix-gateway/service/storage';

// ============================================================================
// 环境变量入口
// ============================================================================

const PORT = Number(process.env.SX_PERF_PORT ?? '7841');
const DATA_DIR = process.env.SX_PERF_DATA_DIR ?? '';
const SANDBOX_ROOT = process.env.SX_PERF_SANDBOX_ROOT ?? process.cwd();
const INSTANCE_B_ROOT = process.env.SX_PERF_INSTANCE_B_ROOT ?? '';

/** 第二个副本的实例 id（与 e2e-tests/m1-instance-switch 一致）。 */
const INSTANCE_B_ID = 'wsp_instance_b';

/**
 * 进程起点到此刻的毫秒数（`process.uptime()` = 进程启动以来的秒数）。
 *
 * why 用它而不是 `Date.now()`：本进程是冷启动测量对象 ⇒ 「node 启动 + tsx 转译 + 模块求值」
 *   这一段**发生在模块体之前** ⇒ 只有 uptime 能把它算进来（Date.now() 的基准太晚）。
 * why 统一用 uptime 做**段内**差值：单调、不受系统时钟跳变影响。
 */
const uptimeMs = (): number => process.uptime() * 1000;

// ============================================================================
// 装配（与 e2e-tests/qa-full-flow/qa-service-process.ts 同口径）
// ============================================================================

async function main(): Promise<void> {
  if (!DATA_DIR) {
    throw new Error('缺少环境变量：SX_PERF_DATA_DIR');
  }

  /** 分段耗时（毫秒）；键名与文件头「分段口径」一一对应。 */
  const stages: Record<string, number> = {};

  // ===== ⓪ 起点：node 启动 + tsx 转译 + 模块求值 =====
  const tModuleReady = uptimeMs();
  stages['startup'] = Math.round(tModuleReady);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'textures'), { recursive: true });

  // ===== ⓪' 分支探测（生产 gateway 冷启动同样要付这一笔：spawn 一次 git）=====
  const tBranchStart = uptimeMs();
  const branch = nodeProcessGitBranch();
  stages['branchProbe'] = Math.round(uptimeMs() - tBranchStart);

  // ===== ① 开库 + 存储件（生产口径：createServiceStorage 开库并建表兜底）=====
  const tDbStart = uptimeMs();
  const storage = await createServiceStorage({ dataDir: path.join(DATA_DIR, 'db') });
  const db = getDatabase().getDatabase() as unknown as SqliteDatabaseLike;
  stages['dbInit'] = Math.round(uptimeMs() - tDbStart);

  // ===== ② 实例注册表（默认沙盒物化 + 副本清单）=====
  const tRegistryStart = uptimeMs();
  const instanceRegistry = createInstanceRegistryWithDefaultSandbox({
    cwd: SANDBOX_ROOT,
    branch,
    views: INSTANCE_B_ROOT
      ? [
          {
            instanceId: INSTANCE_B_ID,
            projectId: 'spx_perf_b_7e2d9c4a10b85f36d47a1c92',
            path: INSTANCE_B_ROOT,
            title: '赤岩前哨',
            lastOpenedAt: 0,
            pinned: false,
            archived: false,
            status: 'idle',
          },
        ]
      : [],
  });
  stages['registry'] = Math.round(uptimeMs() - tRegistryStart);

  // ===== ③ 组合根（生产组合根；世界态恢复 + 落盘件 + agent 探测起跑）=====
  const tBootStart = uptimeMs();
  const booted = bootStratixService({
    storage,
    db,
    snapshotPath: path.join(DATA_DIR, 'world-snapshot.json'),
    instanceRegistry,
    logger: (line: string): void => console.log(`[perf-service] ${line}`),
  });
  stages['bootService'] = Math.round(uptimeMs() - tBootStart);

  // ===== ⓪' 副本切换的世界事件留痕（墙钟 ⇒ 与驱动脚本的点击时刻同一把尺）=====
  // why 要它：`project.changed` 是 core 裁决完 project.enter 的产物 ⇒
  //   「点击时刻 → 这一行的时间戳」= service 侧的进副本耗时（**含 roster 物化**）。
  //   默认沙盒**不物化 roster**（沙盒不误伤，见 roster-materializer.ts）⇒
  //   要量物化得进**第二个副本**（带名册的那个）。
  onWorldEvent((event) => {
    if (event.type !== 'project.changed') return;
    console.log(
      `[perf-event] project.changed instanceId=${String(event.instanceId)} t=${Date.now()}`,
    );
  });

  // ===== ④ HTTP 面 + world-sync 端点 =====
  const tListenStart = uptimeMs();
  const app = express();
  app.use(cors());
  app.use('/textures', express.static(path.join(DATA_DIR, 'textures')));
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', mode: 'perf-e2e', port: PORT });
  });

  const server = http.createServer(app);
  attachWorldSyncEndpoint(server, {
    store: booted.service.store,
    dispatch: emitCommand,
    dispatchEvent: emitWorldEvent,
    subscribeWorldEvents: onWorldEvent,
  });

  await new Promise<void>((resolve) => {
    server.listen(PORT, '127.0.0.1', () => resolve());
  });
  stages['listen'] = Math.round(uptimeMs() - tListenStart);
  stages['totalUptime'] = Math.round(uptimeMs());

  console.log(
    `SX_PERF_SERVICE_READY ${JSON.stringify({
      port: PORT,
      worldSyncPath: WORLD_SYNC_PATH,
      dataDir: DATA_DIR,
      sandboxRoot: SANDBOX_ROOT,
      instanceIds: instanceRegistry.list().map((view) => view.instanceId),
      stages,
    })}`,
  );

  const shutdown = (): void => {
    try {
      booted.stop();
    } catch {
      // 已经在退了
    }
    server.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `[perf-service] 启动失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
