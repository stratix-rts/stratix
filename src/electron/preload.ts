/**
 * Stratix Electron Preload
 * 
 * 暴露 Electron API 给渲染进程
 * 支持服务调用、Tailscale、OpenClaw 等功能
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  // 通用服务调用
  invoke: (channel: string, ...args: any[]) => Promise<any>;

  // Dialog
  dialog: {
    openDirectory: () => Promise<{ success: boolean; canceled?: boolean; path?: string }>;
  };

  // Tailscale
  tailscale: {
    getStatus: () => Promise<any>;
    discoverNodes: () => Promise<any[]>;
    getNodes: () => Promise<any[]>;
    getLoginUrl: () => Promise<string | null>;
    login: (authKey?: string) => Promise<boolean>;
    isRunning: () => Promise<boolean>;
    needsAuth: () => Promise<boolean>;
    onEvent: (callback: (event: any) => void) => () => void;
    connectNode: (nodeId: string) => Promise<boolean>;
  };

  // OpenClaw
  openclaw: {
    connectDirect: (endpoint: string, config: any) => Promise<boolean>;
    disconnectDirect: () => Promise<void>;
    sendMessage: (message: string, sessionId?: string) => Promise<any>;
  };

  // Custom Providers
  config: {
    saveCustomProviders: (configJson: string) => Promise<{ success: boolean; error?: string }>;
    loadCustomProviders: () => Promise<{ success: boolean; data: string | null; error?: string }>;
  };

  // API Keys (encrypted)
  apiKey: {
    save: (providerId: string, apiKey: string) => Promise<{ success: boolean; error?: string }>;
    load: (providerId: string) => Promise<{ success: boolean; data: string | null; error?: string }>;
    delete: (providerId: string) => Promise<{ success: boolean; error?: string }>;
    list: () => Promise<{ success: boolean; data: string[]; error?: string }>;
  };

  // Agent Platform - Workflow
  workflow: {
    list: () => Promise<{ success: boolean; workflows?: Array<{ id: string; name: string; updatedAt: number }>; error?: string }>;
    load: (id: string) => Promise<{ success: boolean; workflow?: any; error?: string }>;
    save: (id: string, workflow: any) => Promise<{ success: boolean; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    presets: () => Promise<{ success: boolean; presets?: any[]; error?: string }>;
    presetLoad: (presetId: string) => Promise<{ success: boolean; workflow?: any; error?: string }>;
  };

  // Agent Platform - Providers
  provider: {
    list: () => Promise<{ success: boolean; providers?: any[]; error?: string }>;
    models: (providerId: string) => Promise<{ success: boolean; models?: string[]; error?: string }>;
    test: (providerId: string, model: string, apiKey?: string) => Promise<{ success: boolean; message: string; latency?: number }>;
    create: (instanceId: string, providerId: string, model: string, apiKey?: string, options?: any) => Promise<{ success: boolean; error?: string }>;
  };

  // Agent Platform - Execution
  execution: {
    start: (workflowId: string, workflow: any, input: string) => Promise<{ success: boolean; executionId?: string; error?: string }>;
    status: (executionId: string) => Promise<{ success: boolean; execution?: any; error?: string }>;
    list: () => Promise<{ success: boolean; executions?: any[] }>;
    clear: (executionId?: string) => Promise<{ success: boolean }>;
  };

  // Texture
  texture: {
    upload: (characterId: string, imageData: string, filename?: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    check: (filePath: string) => Promise<{ exists: boolean; url?: string | null; size?: number; generatedAt?: number }>;
    delete: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  };
}

const electronAPI: ElectronAPI = {
  // 通用服务调用
  invoke: ipcRenderer.invoke.bind(ipcRenderer),

  // Dialog
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  },

  // Tailscale
  tailscale: {
    getStatus: () => ipcRenderer.invoke('tailscale:status'),
    discoverNodes: () => ipcRenderer.invoke('tailscale:discover'),
    getNodes: () => ipcRenderer.invoke('tailscale:nodes'),
    getLoginUrl: () => ipcRenderer.invoke('tailscale:loginUrl'),
    login: (authKey) => ipcRenderer.invoke('tailscale:login', authKey),
    isRunning: () => ipcRenderer.invoke('tailscale:isRunning'),
    needsAuth: () => ipcRenderer.invoke('tailscale:needsAuth'),
    connectNode: (nodeId) => ipcRenderer.invoke('tailscale:connectNode', nodeId),
    onEvent: (callback) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('tailscale:event', handler);
      return () => ipcRenderer.off('tailscale:event', handler);
    },
  },
  
  // OpenClaw
  openclaw: {
    connectDirect: (endpoint, config) => ipcRenderer.invoke('openclaw:connect', endpoint, config),
    disconnectDirect: () => ipcRenderer.invoke('openclaw:disconnect'),
    sendMessage: (message, sessionId) => ipcRenderer.invoke('openclaw:sendMessage', { message, sessionId }),
  },
  
  // Custom Providers
  config: {
    saveCustomProviders: (configJson) => ipcRenderer.invoke('config:saveCustomProviders', configJson),
    loadCustomProviders: () => ipcRenderer.invoke('config:loadCustomProviders'),
  },
  
  // API Keys (encrypted)
  apiKey: {
    save: (providerId, apiKey) => ipcRenderer.invoke('apikey:save', providerId, apiKey),
    load: (providerId) => ipcRenderer.invoke('apikey:load', providerId),
    delete: (providerId) => ipcRenderer.invoke('apikey:delete', providerId),
    list: () => ipcRenderer.invoke('apikey:list'),
  },

  // Agent Platform - Workflow
  workflow: {
    list: () => ipcRenderer.invoke('workflow:list'),
    load: (id) => ipcRenderer.invoke('workflow:load', id),
    save: (id, workflow) => ipcRenderer.invoke('workflow:save', id, workflow),
    delete: (id) => ipcRenderer.invoke('workflow:delete', id),
    presets: () => ipcRenderer.invoke('workflow:presets'),
    presetLoad: (presetId) => ipcRenderer.invoke('workflow:presetLoad', presetId),
  },

  // Agent Platform - Providers
  provider: {
    list: () => ipcRenderer.invoke('provider:list'),
    models: (providerId) => ipcRenderer.invoke('provider:models', providerId),
    test: (providerId, model, apiKey) => ipcRenderer.invoke('provider:test', providerId, model, apiKey),
    create: (instanceId, providerId, model, apiKey, options) =>
      ipcRenderer.invoke('provider:create', instanceId, providerId, model, apiKey, options),
  },

  // Agent Platform - Execution
  execution: {
    start: (workflowId, workflow, input) => ipcRenderer.invoke('execution:start', workflowId, workflow, input),
    status: (executionId) => ipcRenderer.invoke('execution:status', executionId),
    list: () => ipcRenderer.invoke('execution:list'),
    clear: (executionId) => ipcRenderer.invoke('execution:clear', executionId),
  },

  // Texture
  texture: {
    upload: (characterId, imageData, filename) =>
      ipcRenderer.invoke('texture:upload', { characterId, imageData, filename }),
    check: (filePath) => ipcRenderer.invoke('texture:check', filePath),
    delete: (filePath) => ipcRenderer.invoke('texture:delete', filePath),
  },

  // System Zone
  systemZone: {
    open: () => ipcRenderer.send('open-system-zone'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
