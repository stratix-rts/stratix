# OpenClaw 统一连接管理器

## 项目概述

本项目实现了 Stratix 系统中 OpenClaw 连接的统一管理，支持 Web 和 Electron 双模式部署，提供多种连接策略的自动切换。

## 核心目标

✅ **目标 1**: 网页模式运行可以连接到远程或本地 OpenClaw  
✅ **目标 2**: Electron 应用打包后也可以连接到远程或本地 OpenClaw

## 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                   前端应用                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │  UnifiedOpenClawConnectionManager               │   │
│  │  ┌──────────────────────────────────────────┐  │   │
│  │  │  Connection Strategies                   │  │   │
│  │  │  • LocalGatewayStrategy  (Web 默认)       │  │   │
│  │  │  • RemoteGatewayStrategy (直连)           │  │   │
│  │  │  • TailscaleStrategy     (Electron)       │  │   │
│  │  └──────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │
         ├─ [Web] ──→ Vite Proxy → Gateway → OpenClaw
         │
         └─ [Electron]
                ├─ Local → IPC Bypass → OpenClaw
                └─ Tailscale → Node Discovery → Direct WS
```

## 文件结构

```
src/
├── stratix-core/
│   ├── stratix-protocol.ts                    # 类型定义 (已扩展)
│   ├── UnifiedOpenClawConnectionManager.ts    # 核心管理器 ⭐
│   ├── examples/
│   │   └── openclaw-connection-examples.ts    # 使用示例
│   └── __tests__/
│       └── UnifiedOpenClawConnectionManager.test.ts
│
├── stratix-character-creator/
│   ├── ui/
│   │   ├── OpenClawConnectionPanel.ts         # UI 组件 ⭐
│   │   ├── OpenClawConfigPanel.ts             # 旧版 (保留)
│   │   └── BackendSelector.ts                 # 后端选择器
│   └── core/
│       └── OpenClawService.ts                 # 服务层 (已更新)
│
└── electron/
    ├── main.ts                                 # 主进程 (已扩展)
    └── preload.ts                              # 预加载脚本 (已扩展)

docs/
└── openclaw-connection-manager.md              # 完整文档
```

## 连接模式对比

| 模式 | Web | Electron | 说明 |
|------|-----|----------|------|
| `auto` | ✅ | ✅ | 自动选择最佳连接 |
| `local` | ✅ | ✅ | 本地 Gateway 代理 |
| `remote` | ✅ | ✅ | 直连远程 WebSocket |
| `tailscale` | ❌ | ✅ | Tailscale 节点发现 |

## 快速开始

### 1. 导入管理器

```typescript
import { unifiedOpenClawConnectionManager } from '@/stratix-core/UnifiedOpenClawConnectionManager';
import type { UnifiedOpenClawConfig } from '@/stratix-core/stratix-protocol';
```

### 2. 初始化连接

```typescript
const config: UnifiedOpenClawConfig = {
  mode: 'auto', // 推荐
  localEndpoint: 'http://127.0.0.1:18789',
  credentials: {
    accountId: 'stratix',
    apiKey: 'your-api-key',
  },
};

const connected = await unifiedOpenClawConnectionManager.initialize(config);
```

### 3. 发送消息

```typescript
const response = await unifiedOpenClawConnectionManager.sendMessage('Hello!');
console.log(response.content);
```

## 特性

### ✅ 已实现

- [x] 统一连接管理器（单例模式）
- [x] 三种连接策略（Local/Remote/Tailscale）
- [x] Auto 模式自动降级
- [x] 状态监听和同步
- [x] Electron IPC 直连支持
- [x] Tailscale 节点发现
- [x] UI 连接面板组件
- [x] 配置持久化（localStorage）
- [x] 完整文档和示例

### 🔄 待优化

- [ ] 自动重连机制
- [ ] 连接池管理
- [ ] WebSocket 消息队列
- [ ] 离线缓存
- [ ] 性能监控

## 技术要点

### 1. 策略模式

```typescript
interface ConnectionStrategy {
  connect(config: UnifiedOpenClawConfig): Promise<boolean>;
  disconnect(): Promise<void>;
  sendMessage(message: string): Promise<ChatResponse>;
  getStatus(): Promise<OpenClawStatus>;
}
```

### 2. Electron 环境检测

```typescript
private detectEnvironment(): void {
  this.electronAPI = typeof window !== 'undefined' 
    ? (window as any).electronAPI 
    : null;
}

private isElectron(): boolean {
  return !!this.electronAPI;
}
```

### 3. Auto 模式逻辑

```typescript
1. 尝试本地 Gateway (127.0.0.1:18789)
2. 如果失败且是 Electron → 扫描 Tailscale 节点
3. 如果仍失败 → 使用远程 endpoint 兜底
```

## 测试建议

### Web 模式测试

```bash
# 1. 启动 Gateway
npm run dev:backend

# 2. 启动前端
npm run dev:frontend

# 3. 打开浏览器访问 http://localhost:7523
```

### Electron 模式测试

```bash
# 开发模式
npm run electron:dev

# 构建应用
npm run electron:build
```

## 关键 API

### UnifiedOpenClawConnectionManager

| 方法 | 说明 |
|------|------|
| `initialize(config)` | 初始化连接 |
| `connect(config?)` | 建立连接 |
| `disconnect()` | 断开连接 |
| `sendMessage(msg)` | 发送消息 |
| `getStatus()` | 获取状态 |
| `isConnected()` | 检查连接 |
| `discoverTailscaleNodes()` | 发现节点 |
| `addStatusListener(fn)` | 状态监听 |

### 状态类型

```typescript
interface OpenClawStatus {
  connected: boolean;
  accountId: string;
  lastActive: number;
  error?: string;
}
```

## 配置文件

配置存储在 `localStorage`:

```json
{
  "mode": "auto",
  "localEndpoint": "http://127.0.0.1:18789",
  "remoteEndpoint": "wss://backup.example.com",
  "credentials": {
    "accountId": "stratix",
    "apiKey": "***"
  }
}
```

## 故障排查

### 常见问题

1. **本地连接失败**
   - 检查 Gateway 是否运行
   - 确认端口 18789 可访问
   - 查看 CORS 配置

2. **Tailscale 节点不可用**
   - 确认 Tailscale 已登录
   - 检查节点在线状态
   - 验证网络连通性

3. **Electron 直连失败**
   - 检查 preload 脚本加载
   - 确认 IPC 处理程序注册
   - 验证 WebSocket 权限

## 参考资料

- [OpenClaw 官方文档](https://docs.openclaw.ai/)
- [OpenClaw Gateway 文档](https://docs.openclaw.ai/gateway)
- [Tailscale Serve 配置](https://docs.openclaw.ai/gateway/tailscale)
- [Phaser 3 文档](https://photonstorm.github.io/phaser3-docs/)

## 更新日志

### v1.0.0 (2026-02-25)

- ✅ 初始版本发布
- ✅ 统一连接管理器
- ✅ 三种连接策略
- ✅ Electron 集成
- ✅ UI 组件
- ✅ 完整文档

## 许可证

MIT License - Stratix Project
