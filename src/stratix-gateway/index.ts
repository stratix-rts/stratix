/**
 * Stratix Gateway 服务
 * 
 * 支持独立运行和嵌入式运行两种模式：
 * - 独立模式：作为 HTTP 服务运行，监听指定端口
 * - 嵌入式模式：在 Electron 内部运行，仅本地访问
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import { StatusSyncService } from './api/websocket/StatusSync';
import { setStatusSyncService } from './api/routes/command';
import agentRoutes from './api/routes/agent';
import commandRoutes from './api/routes/command';
import templateRoutes from './api/routes/template';
import textureRoutes from './api/routes/texture';
import openclawRoutes, { initWebSocketServer, initConnectionStore } from './api/routes/openclaw';
import { openClawProxyManager } from './openclaw/OpenClawProxyManager';
import { dataStoreService } from './dataStoreService';
import { OpenClawConnectionStore } from '../stratix-data-store/OpenClawConnectionStore';
import { ensureDirSync } from 'fs-extra';
import path from 'path';

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
}

/**
 * Gateway 服务实例
 */
export interface GatewayServiceInstance {
  app: express.Application;
  server: http.Server;
  statusSyncService: StatusSyncService;
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
    bindAddress = process.env.BIND_ADDRESS || '0.0.0.0',
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
  app.use(express.json({ limit: '50mb' }));
  
  // 日志中间件
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
  
  // 静态文件服务
  app.use('/textures', express.static(TEXTURES_DIR));
  
  // 注册路由
  app.use('/api/stratix/config/agent', agentRoutes);
  app.use('/api/stratix/agent', agentRoutes);
  app.use('/api/stratix/command', commandRoutes);
  app.use('/api/stratix/config/template', templateRoutes);
  app.use('/api/stratix/texture', textureRoutes);
  app.use('/api/stratix/openclaw', openclawRoutes);
  
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
      },
    });
  });
  
  // 错误处理
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Error:', err);
    res.status(500).json({
      code: 500,
      message: 'Internal server error',
      data: null,
      requestId: `stratix-req-${Date.now()}`,
    });
  });
  
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
  
  // 仅在独立模式下绑定端口
  if (mode === 'standalone') {
    await new Promise<void>((resolve) => {
      server.listen(port, bindAddress, () => {
        console.log(`Stratix Gateway running on ${bindAddress}:${port} (standalone mode)`);
        resolve();
      });
    });
  } else {
    console.log(`Stratix Gateway initialized in embedded mode (port: ${port}, bind: ${bindAddress})`);
  }
  
  // 启动状态同步服务
  const statusSyncService = new StatusSyncService(WS_PORT);
  setStatusSyncService(statusSyncService);
  console.log(`WebSocket status sync running on port ${WS_PORT}`);
  
  // 优雅关闭处理
  const gracefulShutdown = async () => {
    console.log('Shutting down gracefully...');
    
    await new Promise<void>((resolve) => {
      server.close(() => {
        console.log('HTTP server closed');
        resolve();
      });
    });
    
    statusSyncService.close();
    console.log('WebSocket server closed');
    
    process.exit(0);
  };
  
  if (mode === 'standalone') {
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      gracefulShutdown();
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
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      statusSyncService.close();
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
