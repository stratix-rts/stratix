/**
 * Stratix Electron 主进程
 * 
 * 在 Electron 内部启动完整的 Gateway 服务，包括：
 * - Gateway HTTP 服务（仅本地访问）
 * - 数据存储服务（Electron userData 目录）
 * - Tailscale 集成
 * - OpenClaw 直连支持
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { startGatewayService } from '../stratix-gateway';
import { dataStoreService } from '../stratix-gateway/dataStoreService';
import { EmbeddedTailscale } from '../stratix-tailscale/EmbeddedTailscale';
import { WebSocketOpenClawAdapter } from '../stratix-openclaw-adapter/WebSocketOpenClawAdapter';

let mainWindow: BrowserWindow | null = null;
let gatewayService: any = null;
let tailscale: EmbeddedTailscale | null = null;
let activeOpenClawConnection: WebSocketOpenClawAdapter | null = null;

/**
 * 初始化所有服务
 */
async function initializeServices() {
  // 1. 确定数据目录（Electron userData）
  const dataDir = path.join(app.getPath('userData'), 'data');
  console.log('[Electron] Data directory:', dataDir);
  
  // 2. 初始化数据服务
  await dataStoreService.initialize(dataDir);
  console.log('[Electron] Data service initialized');
  
  // 3. 启动 Gateway 服务（嵌入式，仅本地访问）
  gatewayService = await startGatewayService({
    port: 7524,
    bindAddress: '127.0.0.1', // 仅本地，不暴露
    dataDir,
    mode: 'embedded',
  });
  console.log('[Electron] Gateway service started (internal)');
  
  // 4. 启动 Tailscale
  tailscale = new EmbeddedTailscale({
    openClawPort: 18789,
    stateDir: path.join(dataDir, 'tailscale'),
    hostname: 'stratix',
    authKey: process.env.STRATIX_TAILSCALE_AUTH_KEY,
    healthCheckInterval: 60000,
  });
  
  const tailscaleStarted = await tailscale.start();
  if (tailscaleStarted) {
    tailscale.startHealthCheck();
  }
  console.log('[Electron] Tailscale started');
}

/**
 * 创建主窗口
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'Stratix',
  });
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../frontend/index.html'));
  }
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * 设置 IPC 处理程序
 */
function setupIPC() {
  // ==================== Tailscale IPC ====================
  ipcMain.handle('tailscale:status', async () => {
    return tailscale?.getStatus() || null;
  });
  
  ipcMain.handle('tailscale:discover', async () => {
    if (!tailscale) return [];
    return tailscale.discoverOpenClawNodes();
  });
  
  ipcMain.handle('tailscale:nodes', async () => {
    return tailscale?.getOpenClawNodes() || [];
  });
  
  ipcMain.handle('tailscale:loginUrl', async () => {
    return tailscale?.getLoginURL() || null;
  });
  
  ipcMain.handle('tailscale:login', async (_event, authKey?: string) => {
    return tailscale?.login(authKey) || false;
  });
  
  ipcMain.handle('tailscale:isRunning', async () => {
    return tailscale?.isTailscaleRunning() || false;
  });
  
  ipcMain.handle('tailscale:needsAuth', async () => {
    return tailscale?.needsAuthentication() || false;
  });
  
  // ==================== OpenClaw IPC ====================
  ipcMain.handle('openclaw:connect', async (_event, endpoint: string, config: any) => {
    try {
      if (activeOpenClawConnection) {
        await activeOpenClawConnection.disconnect();
      }
  
      const adapter = new WebSocketOpenClawAdapter({
        endpoint,
        accountId: config.accountId || 'stratix',
        apiKey: config.apiKey,
      });
  
      await adapter.connect();
      const status = await adapter.getStatus();
      
      if (status.connected) {
        activeOpenClawConnection = adapter;
        return { success: true, deviceId: adapter.getDeviceId() };
      } else {
        await adapter.disconnect();
        return { success: false, error: status.error };
      }
    } catch (error) {
      console.error('[Electron] OpenClaw connect failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Connection failed' };
    }
  });
  
  ipcMain.handle('openclaw:disconnect', async () => {
    if (activeOpenClawConnection) {
      await activeOpenClawConnection.disconnect();
      activeOpenClawConnection = null;
    }
    return { success: true };
  });
  
  // ==================== 数据服务 IPC ====================
  ipcMain.handle('service:saveAgent', async (_event, config) => {
    return await dataStoreService.getStore().saveAgent(config);
  });
  
  ipcMain.handle('service:loadAgent', async (_event, id) => {
    return await dataStoreService.getStore().loadAgent(id);
  });
  
  ipcMain.handle('service:deleteAgent', async (_event, id) => {
    await dataStoreService.getStore().deleteAgent(id);
  });
  
  ipcMain.handle('service:listAgents', async () => {
    return await dataStoreService.getStore().listAgents();
  });
  
  ipcMain.handle('service:getOpenClawStatus', async () => {
    if (!activeOpenClawConnection) {
      return { connected: false, error: 'Not connected' };
    }
    
    const status = await activeOpenClawConnection.getStatus();
    return {
      connected: status.connected,
      endpoint: status.connected ? 'local' : undefined,
    };
  });
}

/**
 * 启动应用
 */
app.whenReady().then(async () => {
  try {
    await initializeServices();
    setupIPC();
    createWindow();
  } catch (error) {
    console.error('[Electron] Failed to start:', error);
    app.quit();
  }
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/**
 * 窗口关闭处理
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    tailscale?.stop();
    app.quit();
  }
});

/**
 * 应用退出前清理资源
 */
app.on('before-quit', async () => {
  console.log('[Electron] Shutting down...');
  
  // 停止 Tailscale
  tailscale?.stop();
  console.log('[Electron] Tailscale stopped');
  
  // 关闭 OpenClaw 连接
  if (activeOpenClawConnection) {
    await activeOpenClawConnection.disconnect();
    console.log('[Electron] OpenClaw connection closed');
  }
  
  // 关闭 Gateway 服务
  if (gatewayService?.close) {
    await gatewayService.close();
    console.log('[Electron] Gateway service stopped');
  }
  
  // 创建数据备份
  try {
    await dataStoreService.getBackupManager()?.createBackup();
    console.log('[Electron] Data backup created');
  } catch (error) {
    console.error('[Electron] Backup failed:', error);
  }
});
