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
  };
  
  // OpenClaw
  openclaw: {
    connectDirect: (endpoint: string, config: any) => Promise<boolean>;
    disconnectDirect: () => Promise<void>;
  };
}

const electronAPI: ElectronAPI = {
  // 通用服务调用
  invoke: ipcRenderer.invoke.bind(ipcRenderer),
  
  // Tailscale
  tailscale: {
    getStatus: () => ipcRenderer.invoke('tailscale:status'),
    discoverNodes: () => ipcRenderer.invoke('tailscale:discover'),
    getNodes: () => ipcRenderer.invoke('tailscale:nodes'),
    getLoginUrl: () => ipcRenderer.invoke('tailscale:loginUrl'),
    login: (authKey) => ipcRenderer.invoke('tailscale:login', authKey),
    isRunning: () => ipcRenderer.invoke('tailscale:isRunning'),
    needsAuth: () => ipcRenderer.invoke('tailscale:needsAuth'),
    onEvent: (callback) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('tailscale:event', handler);
      return () => ipcRenderer.removeListener('tailscale:event', handler);
    },
  },
  
  // OpenClaw
  openclaw: {
    connectDirect: (endpoint, config) => ipcRenderer.invoke('openclaw:connect', endpoint, config),
    disconnectDirect: () => ipcRenderer.invoke('openclaw:disconnect'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
