/**
 * 文件职责：**QA-01 全流程端到端验收的 service 进程**（@since v3.3，task_221 / QA-01）。
 *
 * ============ 这一单验什么 ============
 *   冷启动 → 进副本（仪式）→ 选中 / 移动（IX-02 动画）→ 派单（真 agent 或桩进程）
 *   → 任务完成回报 → 切第二副本 → 回大厅，**全链真实跑通**。
 *
 * ============ 为什么单独造一个 service 进程（而不是起生产的 gateway）============
 *   生产的 `startGatewayService`（src/stratix-gateway/index.ts:191）把实例注册表**写死**成
 *   「只有默认沙盒」—— 没有 `workspaces.json` 那份持久清单 ⇒ **第二个副本在生产装配下不存在**。
 *   而「切第二副本」是本单的验收环节之一 ⇒ 验收进程按**生产的装配口径**（同一个
 *   `bootStratixService` + 同一个 `createInstanceRootResolver` + 同一套 roster 物化）把第二个
 *   副本登记进注册表。
 *   ★ 这是**验收侧的接线**，不是产品改动：生产代码一行没动（缺口照记，见任务书的缺口清单）。
 *
 * ============ 走的是真链路 ============
 *   world-sync（真 WebSocket，真协议 v3）→ service 的 core 总线 → core runtime 裁决
 *   → 全量快照回推 → 渲染层（真浏览器 + 真 vite dev server）投影。
 *   组合根是**生产组合根** `bootStratixService`；端口面是**生产端点** `attachWorldSyncEndpoint`。
 *
 * ============ 替身只有一处（且是生产里本来就有的接缝）============
 *   **CLI 二进制**：PATH 上放一个假 `claude`（e2e-tests/demo-flow/fake-claude.mjs 的副本）。
 *   why 不打真 claude：验收要确定性（每次跑出来一样、不花 token、不看网络）。
 *   被替掉的只有**最末端那一跳**（真 spawn 一个子进程，但那个子进程不是真 claude）；
 *   core 的裁决、队列、相位、回报、落库全是真的。
 *
 * ============ 端口 / 数据纪律（硬约束）============
 *   - 端口由外部钉死（SX_QA_PORT），**绝不**碰 7523 / 7524 / 7525 / 9222；
 *   - DATA_DIR、默认沙盒根、副本 B 根全在临时目录里 ⇒ **一个字节都不写进用户的仓**；
 *   - 进程 cwd = 沙盒根（不是仓根！）—— 退出副本时的归档文件（`.stratix/history/*.jsonl`）
 *     会写进实例根 ⇒ 实例根必须在临时目录。
 *
 * 输入：四个 `SX_QA_*` 环境变量（端口 / DATA_DIR / 沙盒根 / 副本 B 根）——
 *   逐项说明见下方「输入（环境变量）」段；其中 `SX_QA_DATA_DIR` 与 `SX_QA_INSTANCE_B_ROOT`
 *   缺失 ⇒ 启动即抛错（退出码 1），另两项有缺省（端口 7831 / 沙盒根 = 进程 cwd）。
 * 输入（环境变量）：
 *   SX_QA_PORT              service 端口（HTTP + world-sync WS 同一端口，与生产一致）。
 *   SX_QA_DATA_DIR          临时 DATA_DIR（SQLite + 世界态快照）。
 *   SX_QA_SANDBOX_ROOT      默认沙盒的项目根（= 进程 cwd 语义，但显式钉死）。
 *   SX_QA_INSTANCE_B_ROOT   第二个副本的项目根（夹具拷过去的副本）。
 * 输出：stdout 一行 `SX_QA_SERVICE_READY {json}`。
 * 禁止事项：
 *   1. 断言 —— 断言在驱动脚本（qa-full-flow.e2e.mjs）里，本文件只**如实回报所见**；
 *   2. 改生产行为 —— 本文件只接线，不改 core / service 的语义；
 *   3. 读用户的库 / 端口 —— DATA_DIR 与两个实例根都由外部钉在临时目录。
 *
 * @since v3.3，task_221。
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import cors from 'cors';
import express from 'express';

import {
  createInstanceRegistryWithDefaultSandbox,
} from '../../src/app/services/persistence/default-sandbox';
import { emitCommand, emitWorldEvent, onWorldEvent } from '../../src/core/bus';
import type { ProjectInstanceId, WorldEvent } from '../../src/core/types';
import { getDatabase } from '../../src/stratix-database';
import { createSessionStorageRoutes } from '../../src/stratix-gateway/api/routes/session-storage';
import { createStorageRoutes } from '../../src/stratix-gateway/api/routes/storage';
import { attachWorldSyncEndpoint } from '../../src/stratix-gateway/api/websocket/world-sync/endpoint';
import { WORLD_SYNC_PATH } from '../../src/stratix-gateway/api/websocket/world-sync/protocol';
import { bootStratixService } from '../../src/stratix-gateway/service/boot';
import { createServiceStorage } from '../../src/stratix-gateway/service/storage';

// ============================================================================
// 子进程探针（QA 侧观测；不改产品码、不改行为）
// ============================================================================

/**
 * 给 child_process.spawn 挂一层观测：谁被拉起来了、cwd 是哪、退出码多少。
 * why 需要它：任务执行环的**最末端一跳**（真 spawn CLI）在产品里是静默的 ——
 *   任务卡住时，「到底有没有 spawn 出子进程」是定位到层的关键分叉
 *   （没 spawn = 队列/守门/编排层的问题；spawn 了但没退出 = 传输层的问题）。
 * ★ 只观测不改行为：原样调用原 spawn，只多打几行日志。
 */
function installSpawnProbe(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const childProcess = require('node:child_process') as {
    spawn: (command: string, args: readonly string[], options: Record<string, unknown>) => {
      stdout?: { on: (event: string, cb: (chunk: Buffer) => void) => void } | null;
      stderr?: { on: (event: string, cb: (chunk: Buffer) => void) => void } | null;
      on: (event: string, cb: (...args: never[]) => void) => void;
    };
  };
  const bornAt = Date.now();
  /** 相对开机时刻的毫秒数（看时间线用）。 */
  const stamp = (): string => String(Date.now() - bornAt);
  const original = childProcess.spawn;
  childProcess.spawn = function patchedSpawn(
    command: string,
    args: readonly string[],
    options: Record<string, unknown>,
  ) {
    console.log(
      `[qa-spawn] t=${stamp()}ms ${command} ${JSON.stringify(args).slice(0, 160)} cwd=${String(options?.cwd ?? '(继承)')}`,
    );
    const child = original.call(childProcess, command, args, options);
    child.stdout?.on('data', (chunk: Buffer) => {
      console.log(`[qa-stdout] t=${stamp()}ms ${chunk.toString('utf-8').slice(0, 400)}`);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      console.log(`[qa-stderr] t=${stamp()}ms ${chunk.toString('utf-8').slice(0, 400)}`);
    });
    child.on('close', ((code: number | null) => {
      console.log(`[qa-spawn-close] t=${stamp()}ms ${command} code=${String(code)}`);
    }) as never);
    child.on('error', ((error: Error) => {
      console.log(`[qa-spawn-error] t=${stamp()}ms ${command} ${error.message}`);
    }) as never);
    return child;
  };
  // 心跳：证明 service 的事件循环是活的（区分「事件循环被堵」与「子进程慢」）。
  if (process.env.SX_QA_HEARTBEAT === '1') {
    const timer = setInterval(() => {
      console.log(`[qa-heartbeat] t=${stamp()}ms`);
    }, 5000);
    timer.unref?.();
  }
}

// ============================================================================
// 环境变量入口
// ============================================================================

const PORT = Number(process.env.SX_QA_PORT ?? '7831');
const DATA_DIR = process.env.SX_QA_DATA_DIR ?? '';
const SANDBOX_ROOT = process.env.SX_QA_SANDBOX_ROOT ?? process.cwd();
const INSTANCE_B_ROOT = process.env.SX_QA_INSTANCE_B_ROOT ?? '';

/** 第二个副本的实例 id（与 e2e-tests/m1-instance-switch 一致）。 */
const INSTANCE_B_ID: ProjectInstanceId = 'wsp_instance_b';

// ============================================================================
// 小工具
// ============================================================================

/** 第二个副本的注册表条目（路径 = 夹具目录 ⇒ 「路径在？」为真）。 */
function instanceBView(): Parameters<typeof createInstanceRegistryWithDefaultSandbox>[0]['views'] {
  return [
    {
      instanceId: INSTANCE_B_ID,
      projectId: 'spx_qa_b_7e2d9c4a10b85f36d47a1c92',
      path: INSTANCE_B_ROOT,
      title: '赤岩前哨',
      lastOpenedAt: 0,
      pinned: false,
      archived: false,
      status: 'idle',
    },
  ];
}

// ============================================================================
// 装配（照抄 src/stratix-gateway/index.ts + src/stratix-gateway/service/boot.ts 的顺序）
// ============================================================================

async function main(): Promise<void> {
  if (!DATA_DIR || !INSTANCE_B_ROOT) {
    throw new Error('缺少环境变量：SX_QA_DATA_DIR / SX_QA_INSTANCE_B_ROOT');
  }
  installSpawnProbe();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'textures'), { recursive: true });

  // ===== ⓪ 开库（真库；建在临时目录，不碰用户的真实库）+ 存储件 =====
  const storage = await createServiceStorage({ dataDir: path.join(DATA_DIR, 'db') });
  const db = getDatabase().getDatabase() as unknown as Parameters<
    typeof bootStratixService
  >[0]['db'];

  // ===== ⓪' 注册表：默认沙盒（恒在）+ 第二个副本 =====
  const instanceRegistry = createInstanceRegistryWithDefaultSandbox({
    cwd: SANDBOX_ROOT,
    branch: null,
    views: instanceBView(),
  });

  // ===== ① 组合根（生产组合根；执行环 = 真 CLI transport，PATH 上是假 claude）=====
  const booted = bootStratixService({
    storage,
    db,
    snapshotPath: path.join(DATA_DIR, 'world-snapshot.json'),
    instanceRegistry,
    logger: (line: string): void => console.log(`[qa-service] ${line}`),
  });
  const service = booted.service;

  // ===== ② world 通道留档（service 侧广播了什么，验收脚本据此定位层）=====
  onWorldEvent((event: WorldEvent): void => {
    if (event.type === 'project.changed') {
      console.log(`[qa-event] project.changed instanceId=${String(event.instanceId)}`);
      return;
    }
    if (event.type === 'unit.position') {
      console.log(`[qa-event] unit.position unitId=${event.unitId} x=${event.x} y=${event.y}`);
      return;
    }
    if (
      event.type === 'task.queued' ||
      event.type === 'task.started' ||
      event.type === 'task.completed' ||
      event.type === 'task.failed'
    ) {
      console.log(`[qa-event] ${event.type} taskId=${event.task.id} status=${event.task.status}`);
      return;
    }
    if (event.type === 'unit.click' || event.type === 'unit.move' || event.type === 'selection.box') {
      console.log(`[qa-event] ${event.type}`);
    }
  });

  // ===== ③ HTTP 面（/health + 静态纹理 + 只读存储 API；与生产同形）=====
  const app = express();
  app.use(cors());
  app.use('/textures', express.static(path.join(DATA_DIR, 'textures')));
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', mode: 'qa-e2e', port: PORT });
  });
  app.use('/api/storage', createStorageRoutes(storage));
  app.use('/api/storage', createSessionStorageRoutes(storage));

  const server = http.createServer(app);
  // world-sync 端点（与生产同一份实现 + 同一组端口）。
  attachWorldSyncEndpoint(server, {
    store: service.store,
    dispatch: emitCommand,
    dispatchEvent: emitWorldEvent,
    subscribeWorldEvents: onWorldEvent,
  });

  await new Promise<void>((resolve) => {
    server.listen(PORT, '127.0.0.1', () => resolve());
  });

  console.log(
    `SX_QA_SERVICE_READY ${JSON.stringify({
      port: PORT,
      worldSyncPath: WORLD_SYNC_PATH,
      dataDir: DATA_DIR,
      sandboxRoot: SANDBOX_ROOT,
      instanceBRoot: INSTANCE_B_ROOT,
      instanceIds: instanceRegistry.list().map((view) => view.instanceId),
    })}`
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
    `[qa-service] 启动失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
