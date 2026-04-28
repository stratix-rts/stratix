# OpenClaw 统一连接管理器 - 集成指南

## 概述

UnifiedOpenClawConnectionManager 提供了统一的 OpenClaw 连接接口，支持 Web 和 Electron 双模式，以及多种连接策略。

## 连接模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `auto` | 自动选择 | 默认推荐 |
| `local` | 本地 Gateway | Gateway 同机运行 |
| `remote` | 远程直连 | 远程服务器 |
| `tailscale` | Tailscale 节点 | Electron + Tailscale 网络 |

## 快速开始

### 1. 基础使用

```typescript
import { unifiedOpenClawConnectionManager } from '@/stratix-core/UnifiedOpenClawConnectionManager';
import type { UnifiedOpenClawConfig } from '@/stratix-core/stratix-protocol';

// 初始化连接
const config: UnifiedOpenClawConfig = {
  mode: 'auto',
  localEndpoint: 'http://127.0.0.1:18789',
  credentials: {
    accountId: 'stratix',
    apiKey: 'your-api-key',
  },
};

const connected = await unifiedOpenClawConnectionManager.initialize(config);

if (connected) {
  // 发送消息
  const response = await unifiedOpenClawConnectionManager.sendMessage('Hello, OpenClaw!');
  console.log(response.content);
}
```

### 2. 状态监听

```typescript
// 添加状态监听器
const removeListener = unifiedOpenClawConnectionManager.addStatusListener((status) => {
  console.log('Connection status:', status);
  
  if (status.connected) {
    console.log('Connected to:', status.accountId);
  } else {
    console.log('Disconnected:', status.error);
  }
});

// 移除监听器
removeListener();
```

### 3. Electron 内使用 Tailscale

```typescript
// 发现可用节点
const nodes = await unifiedOpenClawConnectionManager.discoverTailscaleNodes();
console.log('Available nodes:', nodes);

// 选择节点连接
const config: UnifiedOpenClawConfig = {
  mode: 'tailscale',
  tailscaleNodeId: nodes[0].nodeId,
  credentials: {
    accountId: 'stratix',
  },
};

await unifiedOpenClawConnectionManager.initialize(config);
```

## 策略说明

### LocalGatewayStrategy

通过 Gateway REST API 代理连接：
- Web 模式默认策略
- 自动处理认证和会话
- 支持多个并发连接

```typescript
const config: UnifiedOpenClawConfig = {
  mode: 'local',
  localEndpoint: 'http://127.0.0.1:18789',
  credentials: {
    accountId: 'my-account',
    apiKey: 'optional',
  },
};
```

### RemoteGatewayStrategy

直连远程 WebSocket：
- 需要显式 endpoint
- 直接 WebSocket 通信
- 适合 Electron 远程访问

```typescript
const config: UnifiedOpenClawConfig = {
  mode: 'remote',
  remoteEndpoint: 'ws://example.com:18789',
  credentials: {
    accountId: 'my-account',
    apiKey: 'required',
  },
};
```

### TailscaleStrategy

通过 Tailscale 网络连接节点：
- Electron 专属
- 自动节点发现
- 安全的内网访问

```typescript
const config: UnifiedOpenClawConfig = {
  mode: 'tailscale',
  tailscaleNodeId: 'node-abc-123',
  credentials: {
    accountId: 'my-account',
  },
};
```

## Auto 模式策略

Auto 模式按以下顺序尝试连接：

1. **本地 Gateway** - 检查 `127.0.0.1:18789`
2. **Tailscale 节点** - Electron 环境扫描可用节点
3. **远程兜底** - 使用配置的远程 endpoint

```typescript
const config: UnifiedOpenClawConfig = {
  mode: 'auto',
  localEndpoint: 'http://127.0.0.1:18789',
  remoteEndpoint: 'wss://backup.example.com',
  credentials: {
    accountId: 'stratix',
  },
};

// 自动选择最佳连接
await unifiedOpenClawConnectionManager.initialize(config);
```

## UI 集成

使用 OpenClawConnectionPanel 组件：

```typescript
import { OpenClawConnectionPanel } from '@/stratix-character-creator/ui/OpenClawConnectionPanel';

// 在 Phaser Scene 中创建
const panel = new OpenClawConnectionPanel(scene, {
  x: 100,
  y: 100,
  width: 400,
  height: 500,
  defaultMode: 'auto',
  onSave: (config) => {
    console.log('Config saved:', config);
  },
});
```

## 配置持久化

配置自动保存到 localStorage：

```typescript
// 保存
localStorage.setItem('stratix_openclaw_config', JSON.stringify(config));

// 加载
const saved = localStorage.getItem('stratix_openclaw_config');
const config = saved ? JSON.parse(saved) : null;
```

## Electron 特殊处理

### Preload 配置

```typescript
// src/electron/preload.ts
export interface ElectronAPI {
  openclaw: {
    connectDirect: (endpoint: string, config: any) => Promise<boolean>;
    disconnectDirect: () => Promise<void>;
  };
}
```

### Main 进程处理

```typescript
// src/electron/main.ts
ipcMain.handle('openclaw:connect', async (_event, endpoint, config) => {
  const adapter = new WebSocketOpenClawAdapter({
    endpoint,
    accountId: config.accountId,
    apiKey: config.apiKey,
  });
  
  await adapter.connect();
  return { success: adapter.isConnected() };
});
```

## 错误处理

```typescript
try {
  const connected = await unifiedOpenClawConnectionManager.initialize(config);
  
  if (!connected) {
    console.error('Connection failed');
  }
} catch (error) {
  console.error('Connection error:', error.message);
  
  // 降级策略
  if (error.message.includes('Tailscale')) {
    // 切换到本地模式
    config.mode = 'local';
    await unifiedOpenClawConnectionManager.initialize(config);
  }
}
```

## API 参考

### UnifiedOpenClawConnectionManager

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `initialize(config)` | 初始化连接 | `Promise<boolean>` |
| `connect(config?)` | 建立连接 | `Promise<boolean>` |
| `disconnect()` | 断开连接 | `Promise<void>` |
| `sendMessage(msg, opts)` | 发送消息 | `Promise<ChatResponse>` |
| `getStatus()` | 获取状态 | `Promise<OpenClawStatus>` |
| `isConnected()` | 是否连接 | `boolean` |
| `listAgents()` | 获取 Agent 列表 | `Promise<unknown[]>` |
| `discoverTailscaleNodes()` | 发现节点 | `Promise<TailscaleNode[]>` |
| `addStatusListener(fn)` | 添加状态监听 | `() => void` |
| `getConfig()` | 获取配置 | `UnifiedOpenClawConfig \| null` |
| `updateConfig(config)` | 更新配置 | `void` |

### OpenClawStatus

```typescript
interface OpenClawStatus {
  connected: boolean;
  accountId: string;
  lastActive: number;
  version?: string;
  error?: string;
}
```

### TailscaleNode

```typescript
interface TailscaleNode {
  nodeId: string;
  name: string;
  ipAddress: string;
  online: boolean;
  latency?: number;
}
```

## 最佳实践

1. **优先使用 Auto 模式** - 自动选择最佳连接
2. **添加状态监听** - 实时了解连接状态
3. **错误降级** - 准备备用连接方案
4. **配置持久化** - 保存用户偏好
5. **定期心跳** - 保持连接活跃

## 故障排查

### 问题：无法连接本地 Gateway

**检查清单**：
- Gateway 是否运行在 18789 端口
- 防火墙是否阻止连接
- CORS 配置是否正确

### 问题：Tailscale 节点不可用

**检查清单**：
- Tailscale 是否已登录
- 节点是否在线
- 网络是否可达

### 问题：远程连接超时

**检查清单**：
- endpoint URL 是否正确
- 网络延迟是否过高
- 服务端是否配置认证

## 相关资源

- [OpenClaw 官方文档](https://docs.openclaw.ai/)
- [Stratix Core 文档](./stratix-core/README.md)
- [Electron 集成指南](../../electron/README.md)
