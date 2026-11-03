/**
 * Stratix Gateway 服务
 *
 * 支持独立运行和嵌入式运行两种模式：
 * - 独立模式：作为 HTTP 服务运行，监听指定端口
 * - 嵌入式模式：在 Electron 内部运行，仅本地访问
 *
 * 启动序列（前后端分离 A4 / task_080）：**先 boot service，再挂路由**——
 *   ① SQLite 初始化 + 存储件（A3）；
 *   ② boot service（A1 组合根 + A2 执行环 + A3 存储 + 世界态恢复 + agent 探测）；
 *   ③ 挂路由（含 /mcp —— 其数据面指向**本进程** service 的那份 core store）。
 *   boot 失败即进程退出：半启动的 gateway（路由已挂但大脑没醒）比不启动更糟。
 */

import http from 'http';
import path from 'path';

import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { ensureDirSync } from 'fs-extra';

import type { SqliteDatabaseLike } from '../app/services/persistence/game-save-dao';
import type { TaskTransportFactory } from '../app/services/task-service';
import { emitCommand } from '../core/bus';
import { OpenClawConnectionStore } from '../stratix-data-store/OpenClawConnectionStore';
import { initializeDatabase } from '../stratix-database';
import { createNocoDBService, type NocoDBServiceOptions } from '../stratix-nocodb';
import { OrchestrationSync } from '../stratix-orchestration/OrchestrationSync';

import { AgentRuntimeService } from './agent-runtime/AgentRuntimeService';
import agentRoutes from './api/routes/agent';
import agentOrchestrationRoutes from './api/routes/agentOrchestration';
import agentTaskRoutes from './api/routes/agentTask';
import commandRoutes, { setStatusSyncService as setCommandStatusSyncService } from './api/routes/command';
import lraRoutes from './api/routes/lra';
import openclawRoutes, { initWebSocketServer, initConnectionStore, destroyOpenClawWebSockets } from './api/routes/openclaw';
import { createSessionStorageRoutes } from './api/routes/session-storage';
import skillRoutes from './api/routes/skill';
import { createStorageRoutes } from './api/routes/storage';
import templateRoutes from './api/routes/template';
import textureRoutes from './api/routes/texture';
import { StatusSyncService } from './api/websocket/StatusSync';
import { attachWorldSyncEndpoint, type WorldSyncEndpoint } from './api/websocket/world-sync/endpoint';
import { WORLD_SYNC_PATH } from './api/websocket/world-sync/protocol';
import { dataStoreService } from './dataStoreService';
import { createCoreMcpHost } from './mcp/context';
import { createDefaultMcpServer, JSON_RPC_ERRORS, jsonRpcError } from './mcp/server';
import { createMcpHttpRouter } from './mcp/transport/http';
import { openClawProxyManager } from './openclaw/OpenClawProxyManager';
import { bootStratixService, type BootedStratixService } from './service/boot';
import { createServiceStorage } from './service/storage';




// NocoDB Service

let nocoDBServiceInstance: ReturnType<typeof createNocoDBService> | null = null;

/**
 * Gateway 服务配置
 */
export interface GatewayServiceOptions {
  /** 服务端口 (默认 3010) */
  port?: number;
  /** 监听地址 (默认 '0.0.0.0') */
  bindAddress?: string;
  /** 数据目录 (默认 './stratix-data') */
  dataDir?: string;
  /** 运行模式 */
  mode?: 'standalone' | 'embedded';
  /**
   * 任务执行的 transport 工厂（可选注入口，透传给 service 启动接线）。
   *
   * 缺省 = 直接 spawn 真实 CLI（生产口径）。
   * 给出即用它跑任务 —— e2e 剧本据此注入 fake adapter（确定性执行，不调真 CLI）。
   *
   * why 走注入口而不是环境变量：gateway 的装配选项本就是显式入参，
   *   「按环境变量换执行器」会让生产路径与测试路径在代码里分叉（看不清谁在跑什么）。
   */
  serviceTransport?: TaskTransportFactory;
}

/**
 * Gateway 服务实例
 */
export interface GatewayServiceInstance {
  app: express.Application;
  server: http.Server;
  statusSyncService: StatusSyncService;
  /** world-sync 端点（视图壳的状态面 / 命令面；前后端分离 B2）。 */
  worldSyncEndpoint: WorldSyncEndpoint;
  close: () => Promise<void>;
}

let defaultApp: express.Application | null = null;
let defaultServer: http.Server | null = null;
let statusSyncServiceInstance: StatusSyncService | null = null;

/**
 * 启动 Gateway 服务
 * 
 * @param options 服务配置
 * @returns Gateway 服务实例
 */
export async function startGatewayService(
  options: GatewayServiceOptions = {}
): Promise<GatewayServiceInstance> {
  // 加载环境变量
  dotenv.config({ path: path.resolve(__dirname, '.env') });
  
  const {
    port = parseInt(process.env.PORT || '3010', 10),
    bindAddress = process.env.BIND_ADDRESS || '127.0.0.1',
    dataDir = process.env.DATA_DIR || 'stratix-data',
    mode = 'standalone',
  } = options;
  
  // 创建 Express 应用
  const app = express();
  const WS_PORT = parseInt(process.env.WS_PORT || '3011', 10);
  const TEXTURES_DIR = path.join(dataDir, 'textures');
  
  // 确保目录存在
  ensureDirSync(TEXTURES_DIR);
  
  // 配置中间件
  app.use(cors());
  // 注：全局 body 解析器**不在这里**挂 —— 它必须排在 /mcp 路由**之后**，
  // 否则畸形 JSON 会先被它解析掉 → 错误跳过 /mcp 路由 → 落到 app 级错误处理器
  // → 客户端收到裸 {"code":500}（违反 JSON-RPC 2.0）。见下方 MCP 挂载处的说明。

  // 敏感 query 参数列表（日志脱敏）
  const SENSITIVE_PARAMS = ['apiKey', 'token', 'password', 'secret', 'auth'];

  // 日志中间件（自动脱敏敏感参数）
  app.use((req, res, next) => {
    let url = req.url;
    try {
      const urlObj = new URL(url, `http://localhost`);
      let hasSensitive = false;
      for (const param of SENSITIVE_PARAMS) {
        if (urlObj.searchParams.has(param)) {
          urlObj.searchParams.set(param, '***');
          hasSensitive = true;
        }
      }
      if (hasSensitive) {
        url = urlObj.pathname + urlObj.search;
      }
    } catch {
      // URL 解析失败时保持原样
    }
    console.log(`[${new Date().toISOString()}] ${req.method} ${url}`);
    next();
  });
  
  // 静态文件服务
  app.use('/textures', express.static(TEXTURES_DIR));

  // ===== 初始化 SQLite 数据库 + 存储归一（A3 / task_079）=====
  // 本进程是 SQLite 的**唯一写者**（铁律 6）：三个落库点（任务全文 / chat / exp_events）
  //   经 service/storage.ts 写；其余进程（Electron 壳 / 外部 client）经下面的读 API 读。
  console.log('Initializing SQLite database...');
  const db = await initializeDatabase({ dataDir });
  console.log('SQLite database initialized:', db.getPath());
  // 存储件 = service 侧 SQLite 的 owner（写口 + 读口；建表兜底在这一步跑）。
  // 开库是进程内单例（stratix-database），这里传同一个 dataDir —— 不会开第二个连接。
  const serviceStorage = await createServiceStorage({ dataDir });

  // ===== 启动 service（A4 / task_080）——**先 boot，后挂路由** =====
  // 顺序是本单的核心：路由挂上去的那一刻，MCP 的数据面就已经指向**本进程**的
  // core 运行时（A1 组合根 + A2 执行环 + A3 存储），此后 MCP 与 service 同进程见真状态
  //   （改造前 /mcp 挂在一个没人写过的 store 上 —— units 恒为 0）。
  // boot 失败即退出：半启动的 gateway（路由已挂但大脑没醒）比不启动更糟。
  //
  // 世界态快照（task_133）：missions + 角色名册落盘在 dataDir 下的 world-snapshot.json ——
  //   纯文本、可人工检查；坏档降级成空世界（不崩），进程照常服务。
  const snapshotPath = path.join(dataDir, 'world-snapshot.json');
  console.log('[service] boot start...');
  const booted = ((): BootedStratixService => {
    try {
      return bootStratixService({
        storage: serviceStorage,
        db: db.getDatabase() as unknown as SqliteDatabaseLike,
        snapshotPath,
        ...(options.serviceTransport ? { createTransport: options.serviceTransport } : {}),
      });
    } catch (error) {
      console.error('[service] boot failed:', error);
      if (mode === 'standalone') {
        process.exit(1);
      }
      throw error;
    }
  })();
  const service = booted.service;
  console.log(
    `[service] boot ok（characters=${booted.restore.characters} units=${booted.restore.units} ` +
      `records=${booted.restore.records} runtime=${service.runtime.running ? 'running' : 'stopped'}）`
  );
  console.log(
    `[service] 世界态快照：missions=${booted.snapshot.missions} characters=${booted.snapshot.characters} ` +
      `units=${booted.snapshot.units} skipped=${booted.snapshot.skipped} path=${snapshotPath}`
  );

  // MCP server（docs/MCP-SPEC.md §4.4）：HTTP 端点挂在 /mcp，与 stdio 入口共享同一份注册表与 handler。
  // 数据面复用 **service 的那份** core store + core 总线（不新开状态通道）——
  //   A4 起两者同进程同实例：MCP 看到的就是 service 持有的世界态（不再 units 0）。
  //
  // 挂载位次是**硬约束**（task_118）：/mcp 必须排在全局 express.json() **之前** ——
  //   全局解析器若先解析，畸形 JSON 会在到达本路由之前抛错 → 跳过 /mcp 路由 →
  //   落到 app 级错误处理器 → 客户端收到裸 {"code":500}（违反 JSON-RPC 2.0 的 -32700）。
  //   MCP 路由自带解析器（transport/http.ts，1mb 上限）并自己把解析错误读成 JSON-RPC 帧。
  app.use('/mcp', createMcpHttpRouter(createDefaultMcpServer(createCoreMcpHost({ store: service.store }))));

  // 注册路由
  // （全局 body 解析器挂在 /mcp 之后：MCP 自己解析，其余路由仍吃这一份 5mb 解析器）
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/stratix/agent', agentRoutes);
  app.use('/api/stratix/config/agent', agentRoutes);
  app.use('/api/agent', agentTaskRoutes);
  app.use('/api/stratix/command', commandRoutes);
  app.use('/api/stratix/config/template', templateRoutes);
  app.use('/api/stratix/texture', textureRoutes);
  app.use('/api/stratix/openclaw', openclawRoutes);
  app.use('/api/lra', lraRoutes);
  app.use('/api/agents/orchestration', agentOrchestrationRoutes);
  app.use('/api/skills', skillRoutes);
  // 读 API（A3 / task_079）：SQLite 的只读门面 —— 写在本进程独占，读经这里。
  app.use('/api/storage', createStorageRoutes(serviceStorage));
  // 会话读 API（task_092）：同一前缀下的会话那半边（摘要列表 + 事件流；同样只读）。
  app.use('/api/storage', createSessionStorageRoutes(serviceStorage));
  // 健康检查
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      mode,
      services: {
        http: 'running',
        websocket: 'running',
        dataStore: dataStoreService.isInitialized() ? 'initialized' : 'not initialized',
        sqlite: 'initialized',
      },
    });
  });
  
  // 错误处理
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Error:', err);
    // /mcp 端点**绝不**漏裸错误体（task_118）：MCP 走 JSON-RPC 2.0，
    // 客户端要的是错误码（-32700 / -32603 之类），不是一句 "Internal server error"。
    // 这里只兜住"绕过 MCP 路由、才落到 app 级"的漏网异常 → -32603。
    if (req.originalUrl?.startsWith('/mcp')) {
      if (res.headersSent) {
        next(err);
        return;
      }
      res.status(200).json(
        jsonRpcError(null, JSON_RPC_ERRORS.internalError, 'Internal error', {
          detail: err instanceof Error ? err.message : String(err),
        })
      );
      return;
    }
    res.status(500).json({
      code: 500,
      message: 'Internal server error',
      data: null,
      requestId: `stratix-req-${Date.now()}`,
    });
  });
  
  // 初始化 NocoDB 服务 (可选)
  const nocoEnabled = process.env.NOCO_ENABLED === 'true';
  if (nocoEnabled) {
    console.log('Initializing NocoDB service...');
    const nocoOptions: NocoDBServiceOptions = {
      port: parseInt(process.env.NOCO_PORT || '8080', 10),
      jwtSecret: process.env.NOCO_JWT_SECRET || 'stratix-nocodb-secret-2026',
      disableTelemetry: true,
    };
    nocoDBServiceInstance = createNocoDBService(nocoOptions);
    try {
      await nocoDBServiceInstance.start();
      console.log(`NocoDB service started at ${nocoDBServiceInstance.getUrl()}`);
    } catch (error) {
      console.warn('[Gateway] NocoDB service failed to start:', error);
      console.warn('[Gateway] Data Explorer will be unavailable');
    }
  }

  // 初始化数据服务
  console.log('Initializing data store...');
  await dataStoreService.initialize(dataDir);
  console.log('Data store initialized');
  
  // 初始化 OpenClaw 连接配置存储
  const openClawConnectionStore = new OpenClawConnectionStore(dataDir);
  await openClawConnectionStore.initialize();
  initConnectionStore(openClawConnectionStore);
  console.log('OpenClaw connection store initialized');
  
  // 初始化 OpenClaw 代理管理器
  await openClawProxyManager.initialize(dataDir);
  console.log('OpenClaw proxy manager initialized');
  
  // 创建 HTTP 服务器
  const server = http.createServer(app);
  
  // 初始化 WebSocket 服务器
  initWebSocketServer(server);

  // world-sync 端点（前后端分离 B2 / task_082）：视图壳（Electron / 浏览器）连上即得世界态、
  // 发命令即落地。路径 /ws/world-sync —— 与 openclaw 的 WS 路由**共存不冲突**
  // （各自只认自己的路径，互不处理对方的 upgrade 请求）。
  // 数据面直接指向**本进程** service 的那份 core store + core 总线
  //   （与 MCP 同源同实例 —— 客户端看到的就是 service 持有的真相）。
  const worldSyncEndpoint = attachWorldSyncEndpoint(server, {
    store: service.store,
    dispatch: emitCommand,
  });
  console.log(`[world-sync] endpoint ready on ${WORLD_SYNC_PATH}`);

  // 绑定端口（独立和嵌入模式都需要）
  await new Promise<void>((resolve) => {
    server.listen(port, bindAddress, () => {
      if (mode === 'standalone') {
        console.log(`Stratix Gateway running on ${bindAddress}:${port} (standalone mode)`);
      } else {
        console.log(`Stratix Gateway initialized in embedded mode (port: ${port}, bind: ${bindAddress})`);
      }
      resolve();
    });
  });
  
  // 启动状态同步服务
  const statusSyncService = new StatusSyncService(WS_PORT);
  setCommandStatusSyncService(statusSyncService);
  console.log(`WebSocket status sync running on port ${WS_PORT}`);

  // 启动遗弃任务定时复活（每5分钟检查一次）
  const abandonedTaskInterval = setInterval(async () => {
    try {
      const TaskQueueService = require('../stratix-orchestration/task-queue/TaskQueueService').TaskQueueService;
      const taskQueue = TaskQueueService.getInstance();
      const requeued = await taskQueue.requeueAbandonedTasks();
      if (requeued.length > 0) {
        console.log(`[Gateway] Requeued ${requeued.length} abandoned tasks: ${requeued.join(', ')}`);
      }
    } catch (err) {
      console.error('[Gateway] Failed to requeue abandoned tasks:', err);
    }
  }, 5 * 60 * 1000);
  console.log('[Gateway] Abandoned task requeuer started (every 5 min)');

  // 初始化 OrchestrationSync — 连接 Task/Agent 事件到 WebSocket
  try {
    const orchestrationSync = OrchestrationSync.getInstance();
    orchestrationSync.setStatusSync(statusSyncService);
    orchestrationSync.initialize();
    console.log('[Gateway] OrchestrationSync initialized');
  } catch (err) {
    console.warn('[Gateway] OrchestrationSync initialization failed:', err);
  }

  // 优雅关闭处理
  let shutdownComplete = false;
  const onShutdownComplete = (): void => {
    shutdownComplete = true;
  };

  const SHUTDOWN_TIMEOUT_MS = 10000; // 10 秒强制退出

  // 统一关闭逻辑：按顺序清理各子系统，收集错误并返回退出码
  const shutdown = async (signal?: string): Promise<number> => {
    const errors: Error[] = [];
    console.log(`Shutting down gracefully${signal ? ` (signal: ${signal})` : ''}...`);

    const runStep = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
      try {
        await fn();
        console.log(`[Gateway] ${name} completed`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`[Gateway] ${name} failed:`, error);
        errors.push(error);
      }
    };

    await runStep('Stop abandoned task requeuer', () => {
      if (abandonedTaskInterval) {
        clearInterval(abandonedTaskInterval);
      }
    });

    // service（A4 / task_080）：先停大脑（退执行环 / 养成回路 / runtime 订阅），再停周边子系统。
    await runStep('Stop Stratix service', () => {
      booted.stop();
    });

    await runStep('Stop agent runtimes', async () => {
      await AgentRuntimeService.getInstance().stopAll();
    });

    await runStep('Cleanup orchestration sync', () => {
      OrchestrationSync.getInstance().cleanup();
    });

    await runStep('Destroy OpenClaw proxy manager', () => {
      openClawProxyManager.destroy();
    });

    await runStep('Close OpenClaw websockets', () => {
      destroyOpenClawWebSockets();
    });

    await runStep('Close world-sync endpoint', () => {
      worldSyncEndpoint.close();
    });

    if (nocoDBServiceInstance) {
      await runStep('Stop NocoDB service', async () => {
        await nocoDBServiceInstance!.stop();
      });
    }

    await runStep('Close HTTP server', async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });

    await runStep('Close status sync service', () => {
      statusSyncService.close();
    });

    const exitCode = errors.length > 0 ? 1 : 0;
    if (exitCode !== 0) {
      console.error(`[Gateway] Shutdown completed with ${errors.length} error(s)`);
    } else {
      console.log('[Gateway] Shutdown completed successfully');
    }
    return exitCode;
  };

  const gracefulShutdown = async (signal?: string) => {
    const forceExitTimer = setTimeout(() => {
      console.error(`[Gateway] Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    let exitCode = 1;
    try {
      exitCode = await shutdown(signal);
      onShutdownComplete();
    } catch (err) {
      console.error('[Gateway] Unexpected error during shutdown:', err);
      exitCode = 1;
    } finally {
      clearTimeout(forceExitTimer);
      finalCleanup();
      process.exit(exitCode);
    }
  };

  const finalCleanup = (): void => {
    if (!shutdownComplete) {
      console.log('Final cleanup...');
    }
  };

  if (mode === 'standalone') {
    process.on('SIGTERM', () => {
      gracefulShutdown('SIGTERM').finally(finalCleanup);
    });
    process.on('SIGINT', () => {
      gracefulShutdown('SIGINT').finally(finalCleanup);
    });
    
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      gracefulShutdown('uncaughtException').finally(finalCleanup);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });
  }
  
  // 保存全局引用（用于独立运行模式）
  if (mode === 'standalone') {
    defaultApp = app;
    defaultServer = server;
    statusSyncServiceInstance = statusSyncService;
  }
  
  // 返回服务实例
  return {
    app,
    server,
    statusSyncService,
    worldSyncEndpoint,
    close: async () => {
      const exitCode = await shutdown();
      if (exitCode !== 0) {
        throw new Error(`Gateway shutdown completed with errors (exit code ${exitCode})`);
      }
    },
  };
}

/**
 * 独立运行模式：自动启动服务
 */
if (process.env.STANDALONE_MODE === 'true' || !module.parent) {
  console.log('Starting Gateway in standalone mode...');
  startGatewayService({
    mode: 'standalone',
  }).catch((error) => {
    console.error('Failed to start Gateway:', error);
    process.exit(1);
  });
}

// 导出 Express 应用和启动 Promise（向后兼容）
export { defaultApp as app, defaultServer as server };
