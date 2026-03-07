/**
 * OpenClaw 统一连接管理器 - 集成示例
 * 
 * 此文件展示如何在不同场景下使用统一连接管理器
 */

import { unifiedOpenClawConnectionManager } from '@/stratix-core/UnifiedOpenClawConnectionManager';
import type { UnifiedOpenClawConfig } from '@/stratix-core/stratix-protocol';

/**
 * 示例 1: 基础 Web 模式连接
 */
export async function exampleWebMode(): Promise<void> {
  console.log('=== Web Mode Example ===');
  
  const config: UnifiedOpenClawConfig = {
    mode: 'local',
    localEndpoint: 'http://127.0.0.1:18789',
    credentials: {
      accountId: 'stratix',
    },
  };

  try {
    const connected = await unifiedOpenClawConnectionManager.initialize(config);
    
    if (connected) {
      console.log('✓ Connected successfully');
      
      const status = await unifiedOpenClawConnectionManager.getStatus();
      console.log('Status:', status);
      
      const response = await unifiedOpenClawConnectionManager.sendMessage('Hello!');
      console.log('Response:', response.content);
    } else {
      console.log('✗ Connection failed');
    }
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

/**
 * 示例 2: Auto 模式（推荐）
 */
export async function exampleAutoMode(): Promise<void> {
  console.log('=== Auto Mode Example ===');
  
  const config: UnifiedOpenClawConfig = {
    mode: 'auto',
    localEndpoint: 'http://127.0.0.1:18789',
    credentials: {
      accountId: 'stratix',
      apiKey: process.env.OPENCLAW_API_KEY,
    },
  };

  const connected = await unifiedOpenClawConnectionManager.initialize(config);
  console.log(connected ? '✓ Auto-connected' : '✗ Connection failed');
}

/**
 * 示例 3: 远程直连模式
 */
export async function exampleRemoteMode(): Promise<void> {
  console.log('=== Remote Mode Example ===');
  
  const config: UnifiedOpenClawConfig = {
    mode: 'remote',
    remoteEndpoint: 'wss://openclaw.example.com',
    credentials: {
      accountId: 'my-account',
      apiKey: 'secret-key',
    },
  };

  const connected = await unifiedOpenClawConnectionManager.initialize(config);
  
  if (connected) {
    console.log('✓ Connected to remote');
    
    const agents = await unifiedOpenClawConnectionManager.listAgents();
    console.log('Available agents:', agents);
  }
}

/**
 * 示例 4: Electron + Tailscale
 */
export async function exampleTailscaleMode(): Promise<void> {
  console.log('=== Tailscale Mode Example ===');
  
  if (!(window as any).electronAPI) {
    console.log('Not running in Electron');
    return;
  }

  try {
    // 发现节点
    const nodes = await unifiedOpenClawConnectionManager.discoverTailscaleNodes();
    console.log('Discovered nodes:', nodes);
    
    if (nodes.length === 0) {
      console.log('No nodes available');
      return;
    }

    const config: UnifiedOpenClawConfig = {
      mode: 'tailscale',
      tailscaleNodeId: nodes[0].nodeId,
      credentials: {
        accountId: 'stratix',
      },
    };

    const connected = await unifiedOpenClawConnectionManager.initialize(config);
    
    if (connected) {
      console.log(`✓ Connected to node: ${nodes[0].name}`);
    }
  } catch (error: any) {
    console.error('Tailscale connection failed:', error.message);
  }
}

/**
 * 示例 5: 状态监听
 */
export async function exampleStatusListener(): Promise<void> {
  console.log('=== Status Listener Example ===');
  
  const removeListener = unifiedOpenClawConnectionManager.addStatusListener((status) => {
    console.log('Status update:', {
      connected: status.connected,
      accountId: status.accountId,
      lastActive: new Date(status.lastActive).toLocaleString(),
      error: status.error,
    });
  });

  const config: UnifiedOpenClawConfig = {
    mode: 'auto',
    localEndpoint: 'http://127.0.0.1:18789',
    credentials: {
      accountId: 'stratix',
    },
  };

  await unifiedOpenClawConnectionManager.initialize(config);
  
  setTimeout(() => {
    console.log('Removing listener...');
    removeListener();
  }, 60000);
}

/**
 * 示例 6: 错误处理和降级
 */
export async function exampleErrorHandling(): Promise<void> {
  console.log('=== Error Handling Example ===');
  
  let config: UnifiedOpenClawConfig = {
    mode: 'remote',
    remoteEndpoint: 'wss://primary.example.com',
    credentials: {
      accountId: 'stratix',
      apiKey: 'key-1',
    },
  };

  try {
    let connected = await unifiedOpenClawConnectionManager.initialize(config);
    
    if (!connected) {
      console.log('Primary failed, trying backup...');
      
      config = {
        mode: 'remote',
        remoteEndpoint: 'wss://backup.example.com',
        credentials: {
          accountId: 'stratix',
          apiKey: 'key-2',
        },
      };
      
      connected = await unifiedOpenClawConnectionManager.initialize(config);
    }
    
    console.log(connected ? '✓ Connected' : '✗ All attempts failed');
  } catch (error: any) {
    console.error('Connection error:', error.message);
  }
}

/**
 * 示例 7: 配置持久化
 */
export function exampleConfigPersistence(): void {
  console.log('=== Config Persistence Example ===');
  
  const config: UnifiedOpenClawConfig = {
    mode: 'auto',
    localEndpoint: 'http://127.0.0.1:18789',
    credentials: {
      accountId: 'stratix',
    },
  };
  
  localStorage.setItem('stratix_openclaw_config', JSON.stringify(config));
  
  const saved = localStorage.getItem('stratix_openclaw_config');
  const loadedConfig = saved ? JSON.parse(saved) : null;
  
  console.log('Saved config:', config);
  console.log('Loaded config:', loadedConfig);
}

/**
 * 示例 8: 在 Phaser Scene 中使用
 */
export class OpenClawExampleScene extends Phaser.Scene {
  private connectionPanel: any;
  
  constructor() {
    super({ key: 'OpenClawExampleScene' });
  }
  
  async create() {
    const config = {
      scene: this,
      x: 100,
      y: 100,
      width: 400,
      height: 500,
      defaultMode: 'auto' as const,
      onSave: (savedConfig: UnifiedOpenClawConfig) => {
        console.log('Config saved:', savedConfig);
      },
    };
    
    // 动态导入避免循环依赖
    const { OpenClawConnectionPanel } = await import(
      '@/stratix-character-creator/ui/OpenClawConnectionPanel'
    );
    
    this.connectionPanel = new OpenClawConnectionPanel(this, config);
  }
  
  async shutdown() {
    if (this.connectionPanel) {
      this.connectionPanel.destroy();
    }
    
    await unifiedOpenClawConnectionManager.disconnect();
  }
}
