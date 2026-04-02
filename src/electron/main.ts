/**
 * Stratix Electron 主进程
 *
 * 在 Electron 内部启动完整的 Gateway 服务，包括：
 * - Gateway HTTP 服务（仅本地访问）
 * - 数据存储服务（Electron userData 目录）
 * - Tailscale 集成
 * - OpenClaw 直连支持
 */

import fs from 'fs';
import path from 'path';

import { app, BrowserWindow, ipcMain, safeStorage, dialog } from 'electron';
import { ensureDirSync } from 'fs-extra';

import { startGatewayService } from '../stratix-gateway';
import { dataStoreService } from '../stratix-gateway/dataStoreService';
import { WebSocketOpenClawAdapter } from '../stratix-openclaw-adapter/WebSocketOpenClawAdapter';
import { EmbeddedTailscale } from '../stratix-tailscale/EmbeddedTailscale';

let mainWindow: BrowserWindow | null = null;
let gatewayService: any = null;
let tailscale: EmbeddedTailscale | null = null;
let activeOpenClawConnection: WebSocketOpenClawAdapter | null = null;
let userDataPath: string = '';
let texturesDir: string = '';

/**
 * 初始化所有服务
 */
async function initializeServices() {
  userDataPath = app.getPath('userData');
  // 1. 确定数据目录（Electron userData）
  const dataDir = path.join(userDataPath, 'data');
  console.log('[Electron] Data directory:', dataDir);

  // 设置纹理存储目录
  texturesDir = path.join(dataDir, 'textures');
  ensureDirSync(texturesDir);
  console.log('[Electron] Textures directory:', texturesDir);

  // 2. 启动 Gateway 服务（嵌入式，仅本地访问）
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
  // ==================== Dialog IPC ====================
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: '选择文件夹',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    return { success: true, path: result.filePaths[0] };
  });

  // ==================== Texture IPC ====================
  ipcMain.handle('texture:upload', async (_event, { characterId, imageData, filename }) => {
    try {
      const matches = imageData.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
      if (!matches) {
        return { success: false, error: 'Invalid image data format' };
      }

      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const textureFilename = filename || `${characterId}.${ext}`;
      const texturePath = path.join(texturesDir, textureFilename);

      const buffer = Buffer.from(matches[2], 'base64');
      fs.writeFileSync(texturePath, buffer);

      const stats = fs.statSync(texturePath);
      console.log(`[TextureService] Uploaded: ${textureFilename} (${stats.size} bytes)`);

      return {
        success: true,
        data: {
          filePath: textureFilename,
          width: 832,
          height: 3456,
          animations: ['walk', 'idle', 'run'],
          generatedAt: stats.mtimeMs
        }
      };
    } catch (error: any) {
      console.error('[TextureService] Upload failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('texture:check', async (_event, filePath: string) => {
    try {
      const texturePath = path.join(texturesDir, filePath);

      if (fs.existsSync(texturePath)) {
        const stats = fs.statSync(texturePath);
        return {
          exists: true,
          url: `/textures/${filePath}`,
          size: stats.size,
          generatedAt: stats.mtimeMs
        };
      }

      return { exists: false, url: null };
    } catch (error) {
      console.error('[TextureService] Check failed:', error);
      return { exists: false, url: null };
    }
  });

  ipcMain.handle('texture:delete', async (_event, filePath: string) => {
    try {
      const texturePath = path.join(texturesDir, filePath);

      if (fs.existsSync(texturePath)) {
        fs.unlinkSync(texturePath);
        console.log(`[TextureService] Deleted: ${filePath}`);
      }

      return { success: true };
    } catch (error: any) {
      console.error('[TextureService] Delete failed:', error);
      return { success: false, error: error.message };
    }
  });

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

  ipcMain.handle('tailscale:connectNode', async (_event, nodeId: string) => {
    if (!tailscale) return false;
    try {
      const nodes = await tailscale.discoverOpenClawNodes();
      const node = nodes.find((n: any) => n.peer?.id === nodeId || n.peer?.id === `pn_${nodeId}`);
      if (!node) {
        console.error('[Electron] Tailscale node not found:', nodeId);
        return false;
      }
      if (!node.healthy) {
        console.error('[Electron] Tailscale node not healthy:', node.url);
        return false;
      }
      // Configure the gateway's OpenClaw proxy with the node's endpoint
      const response = await fetch('http://127.0.0.1:7524/api/stratix/openclaw/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: node.url, apiKey: '' }),
      });
      const result = await response.json();
      return result.success === true || result.connected === true;
    } catch (error) {
      console.error('[Electron] tailscale:connectNode failed:', error);
      return false;
    }
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

  ipcMain.handle('openclaw:sendMessage', async (_event, { message, sessionId }) => {
    try {
      const response = await fetch('http://127.0.0.1:7524/api/stratix/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId }),
      });
      return await response.json();
    } catch (error: any) {
      console.error('[Electron] openclaw:sendMessage failed:', error);
      return { code: 500, message: error.message, data: null };
    }
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
  } = require('@/agent-platform/ipc');

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
