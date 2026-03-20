/**
 * Stratix Electron 主进程
 * 
 * 在 Electron 内部启动完整的 Gateway 服务，包括：
 * - Gateway HTTP 服务（仅本地访问）
 * - 数据存储服务（Electron userData 目录）
 * - Tailscale 集成
 * - OpenClaw 直连支持
 */

// Path alias resolution - must be at the top before any imports
const Module = require('module');
const pathResolve = require('path');
const fsResolve = require('fs');

console.log('[Electron] Starting path resolution setup...');
console.log('[Electron] baseDir:', pathResolve.join(__dirname, '..'));

const originalResolve = Module._resolveFilename;
const baseDir = pathResolve.join(__dirname, '..');

Module._resolveFilename = function(request: string, parent: any, isMain: any, options: any) {
  console.log('[Resolve]', request);
  if (request.startsWith('@stratix-') || request.startsWith('@/')) {
    let moduleName: string;
    let modulePath: string;
    
    if (request.startsWith('@/')) {
      moduleName = '@/';
      modulePath = request.slice(2);
    } else {
      const parts = request.split('/');
      moduleName = parts[0];
      modulePath = parts.slice(1).join('/');
    }
    
    const aliasMap: Record<string, string> = {
      '@stratix-core': pathResolve.join(baseDir, 'stratix-core'),
      '@stratix-openclaw-adapter': pathResolve.join(baseDir, 'stratix-openclaw-adapter'),
      '@stratix-gateway': pathResolve.join(baseDir, 'stratix-gateway'),
      '@stratix-tailscale': pathResolve.join(baseDir, 'stratix-tailscale'),
      '@stratix-data-store': pathResolve.join(baseDir, 'stratix-data-store'),
      '@/': baseDir,
    };
    
    if (aliasMap[moduleName]) {
      let newPath = modulePath 
        ? pathResolve.join(aliasMap[moduleName], modulePath) 
        : aliasMap[moduleName];
      
      // If the resolved path is a directory, add /index
      if (fsResolve.existsSync(newPath) && fsResolve.statSync(newPath).isDirectory()) {
        newPath = pathResolve.join(newPath, 'index.js');
      } else if (!newPath.endsWith('.js')) {
        // Add .js extension if not present
        newPath = newPath + '.js';
      }
      
      console.log('[Path Resolve]', request, '->', newPath);
      return newPath;
    } else {
      console.log('[Path Resolve] No alias for:', moduleName);
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import path from 'path';
import fs from 'fs';

import { startGatewayService } from '../stratix-gateway';
import { dataStoreService } from '../stratix-gateway/dataStoreService';
import { EmbeddedTailscale } from '../stratix-tailscale/EmbeddedTailscale';
import { WebSocketOpenClawAdapter } from '../stratix-openclaw-adapter/WebSocketOpenClawAdapter';

let mainWindow: BrowserWindow | null = null;
let gatewayService: any = null;
let tailscale: EmbeddedTailscale | null = null;
let activeOpenClawConnection: WebSocketOpenClawAdapter | null = null;
let userDataPath: string = '';

/**
 * 初始化所有服务
 */
async function initializeServices() {
  userDataPath = app.getPath('userData');
  // 1. 确定数据目录（Electron userData）
  const dataDir = path.join(userDataPath, 'data');
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
  
  // 尝试从 Vite 开发服务器加载（端口 7523-7530）
  const loadDevUrl = async () => {
    const ports = [7523, 7524, 7525, 7526, 7527, 7528, 7529, 7530];
    for (const port of ports) {
      try {
        const url = `http://127.0.0.1:${port}`;
        const response = await fetch(url, { method: 'HEAD' });
        if (response.ok) {
          console.log('[Electron] Loading from Vite dev server:', url);
          await mainWindow!.loadURL(url);
          mainWindow!.webContents.openDevTools();
          return true;
        }
      } catch {
        // 端口没有服务，继续尝试下一个
      }
    }
    return false;
  };

  // 尝试开发服务器，失败则加载本地文件
  loadDevUrl().then(success => {
    if (!success) {
      console.log('[Electron] Loading from local file');
      mainWindow!.loadFile(path.join(__dirname, '../frontend/index.html'));
    }
  });
  
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
  
  // ==================== Custom Providers IPC ====================
  ipcMain.handle('config:saveCustomProviders', async (_event, configJson: string) => {
    try {
      const configPath = path.join(userDataPath, 'custom-providers.config.json');
      fs.writeFileSync(configPath, configJson, 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('[Electron] Failed to save custom providers:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to save' };
    }
  });
  
  ipcMain.handle('config:loadCustomProviders', async () => {
    try {
      const configPath = path.join(userDataPath, 'custom-providers.config.json');
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        return { success: true, data: content };
      }
      return { success: true, data: null };
    } catch (error) {
      console.error('[Electron] Failed to load custom providers:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to load' };
    }
  });
  
  // ==================== API Key 加密存储 IPC ====================
  ipcMain.handle('apikey:save', async (_event, providerId: string, apiKey: string) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return { success: false, error: 'Encryption not available' };
      }
      
      const encrypted = safeStorage.encryptString(apiKey);
      const keysPath = path.join(userDataPath, 'api-keys.encrypted');
      
      let keys: Record<string, string> = {};
      if (fs.existsSync(keysPath)) {
        const existing = fs.readFileSync(keysPath);
        keys = JSON.parse(existing.toString('base64'));
      }
      
      keys[providerId] = encrypted.toString('base64');
      fs.writeFileSync(keysPath, Buffer.from(JSON.stringify(keys)));
      
      return { success: true };
    } catch (error) {
      console.error('[Electron] Failed to save API key:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to save' };
    }
  });
  
  ipcMain.handle('apikey:load', async (_event, providerId: string) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return { success: false, error: 'Encryption not available' };
      }
      
      const keysPath = path.join(userDataPath, 'api-keys.encrypted');
      if (!fs.existsSync(keysPath)) {
        return { success: true, data: null };
      }
      
      const keys = JSON.parse(fs.readFileSync(keysPath).toString('base64'));
      const encrypted = keys[providerId];
      
      if (!encrypted) {
        return { success: true, data: null };
      }
      
      const decrypted = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      return { success: true, data: decrypted };
    } catch (error) {
      console.error('[Electron] Failed to load API key:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to load' };
    }
  });
  
  ipcMain.handle('apikey:delete', async (_event, providerId: string) => {
    try {
      const keysPath = path.join(userDataPath, 'api-keys.encrypted');
      if (!fs.existsSync(keysPath)) {
        return { success: true };
      }
      
      const keys = JSON.parse(fs.readFileSync(keysPath).toString('base64'));
      delete keys[providerId];
      fs.writeFileSync(keysPath, Buffer.from(JSON.stringify(keys)));
      
      return { success: true };
    } catch (error) {
      console.error('[Electron] Failed to delete API key:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete' };
    }
  });
  
  ipcMain.handle('apikey:list', async () => {
    try {
      const keysPath = path.join(userDataPath, 'api-keys.encrypted');
      if (!fs.existsSync(keysPath)) {
        return { success: true, data: [] };
      }
      
      const keys = JSON.parse(fs.readFileSync(keysPath).toString('base64'));
      return { success: true, data: Object.keys(keys) };
    } catch (error) {
      console.error('[Electron] Failed to list API keys:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to list' };
    }
  });

  // ==================== Agent Platform IPC ====================
  const {
    registerWorkflowHandlers,
    registerProviderHandlers,
    registerExecutionHandlers,
  } = require('../agent-platform/ipc');

  const workflowHandlers = registerWorkflowHandlers(userDataPath, fs, path);
  const providerHandlers = registerProviderHandlers();
  const executionHandlers = registerExecutionHandlers();

  for (const [channel, handler] of Object.entries(workflowHandlers)) {
    ipcMain.handle(channel, handler as (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any);
  }

  for (const [channel, handler] of Object.entries(providerHandlers)) {
    ipcMain.handle(channel, handler as (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any);
  }

  for (const [channel, handler] of Object.entries(executionHandlers)) {
    ipcMain.handle(channel, handler as (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any);
  }

  console.log('[Electron] Agent Platform IPC handlers registered');
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
