# OpenClaw 统一连接管理器 - 迁移指南

## 📋 概述

本次迁移将 OpenClaw 连接功能统一为 `UnifiedOpenClawConnectionManager`，支持 Web 和 Electron 双模式，提供多种连接策略。

## 🎯 迁移目标

- ✅ 统一 Web 和 Electron 连接方式
- ✅ 支持多种连接模式 (auto/local/remote/tailscale)
- ✅ 简化 API 调用
- ✅ 提升用户体验

## 📦 变更清单

### 删除的文件

```
❌ src/stratix-character-creator/core/OpenClawService.ts
❌ src/stratix-character-creator/ui/OpenClawConfigPanel.ts
```

### 新增的文件

```
✅ src/stratix-core/UnifiedOpenClawConnectionManager.ts
✅ src/stratix-character-creator/ui/OpenClawConnectionPanel.ts
```

### 修改的文件

```
📝 src/stratix-core/stratix-protocol.ts - 添加新类型定义
📝 src/stratix-character-creator/types/index.ts - 导出新类型
📝 src/stratix-character-creator/CharacterCreatorScene.ts - 使用新面板
📝 src/stratix-character-creator/ui/BackendSelector.ts - 完全重写
📝 src/stratix-character-creator/ui/AgentChatPanel.ts - 更新 API 调用
📝 src/stratix-character-creator/ui/AgentListPanel.ts - 更新 API 调用
📝 src/stratix-character-creator/ui/index.ts - 更新导出
📝 src/electron/preload.ts - 添加直连 API
📝 src/electron/main.ts - 添加 IPC 处理
```

## 🔄 迁移步骤

### 1. API 调用变更

#### 旧代码 (OpenClawService)
```typescript
import { openClawService } from './core/OpenClawService';

// 连接测试
const result = await openClawService.testConnection();

// 发送消息
const response = await openClawService.chat(messages, systemPrompt);

// 获取 Agent 列表
const agents = await openClawService.listAgents();
```

#### 新代码 (UnifiedOpenClawConnectionManager)
```typescript
import { unifiedOpenClawConnectionManager } from '@/stratix-core/UnifiedOpenClawConnectionManager';

// 初始化连接
const connected = await unifiedOpenClawConnectionManager.initialize(config);

// 发送消息
const response = await unifiedOpenClawConnectionManager.sendMessage(message);

// 获取 Agent 列表
const agents = await unifiedOpenClawConnectionManager.listAgents();
```

### 2. 配置格式变更

#### 旧配置格式
```typescript
interface OpenClawConfig {
  endpoint: string;
  accountId: string;
  apiKey?: string;
}
```

#### 新配置格式
```typescript
interface UnifiedOpenClawConfig {
  mode: 'auto' | 'local' | 'remote' | 'tailscale';
  localEndpoint?: string;
  remoteEndpoint?: string;
  tailscaleNodeId?: string;
  credentials?: {
    accountId?: string;
    apiKey?: string;
  };
}
```

### 3. CharacterCreatorScene 集成

在 `CharacterCreatorScene.ts` 中，替换旧的 OpenClaw 配置面板：

```typescript
// 旧代码
import { OpenClawConfigPanel } from './ui';
private openClawConfigPanel: OpenClawConfigPanel | null = null;

// 新代码
import { OpenClawConnectionPanel } from './ui/OpenClawConnectionPanel';
import { unifiedOpenClawConnectionManager } from '@/stratix-core/UnifiedOpenClawConnectionManager';
private openClawConnectionPanel: OpenClawConnectionPanel | null = null;
```

### 4. BackendSelector 更新

新的 BackendSelector 支持连接模式选择和 Tailscale 配置：

```typescript
// 添加连接模式下拉框
<select id="oc-mode">
  <option value="auto">自动 Auto ⚡</option>
  <option value="local">本地 Local 🔌</option>
  <option value="remote">远程 Remote 🌐</option>
  <option value="tailscale">Tailscale 🕸️</option>
</select>

// Tailscale 勾选框 (Electron 环境)
<input type="checkbox" id="oc-tailscale-enabled" />
```

## 🚀 新功能特性

### 1. 连接模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `auto` | 自动选择最佳连接 | 默认推荐 |
| `local` | 本地 Gateway 代理 | Web 模式默认 |
| `remote` | 直连远程 WebSocket | 远程服务器 |
| `tailscale` | Tailscale 节点发现 | Electron 专属 |

### 2. Auto 模式策略

Auto 模式按以下顺序尝试连接：

1. **本地 Gateway** (127.0.0.1:18789)
2. **Tailscale 节点** (Electron 环境)
3. **远程 endpoint** (兜底方案)

### 3. Tailscale 支持

Electron 环境下强制启用 Tailscale，提供以下功能：

- 自动节点发现
- 安全的内网访问
- 降级到普通模式

## 📖 使用示例

### 基础使用

```typescript
import { unifiedOpenClawConnectionManager } from '@/stratix-core/UnifiedOpenClawConnectionManager';

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
  const response = await unifiedOpenClawConnectionManager.sendMessage('Hello!');
  console.log(response.content);
  
  // 获取状态
  const status = await unifiedOpenClawConnectionManager.getStatus();
  console.log(status);
}
```

### 状态监听

```typescript
// 添加状态监听器
const removeListener = unifiedOpenClawConnectionManager.addStatusListener((status) => {
  console.log('Status:', status);
});

// 移除监听器
removeListener();
```

### Electron Tailscale

```typescript
// 发现节点
const nodes = await unifiedOpenClawConnectionManager.discoverTailscaleNodes();

// 连接节点
const config: UnifiedOpenClawConfig = {
  mode: 'tailscale',
  tailscaleNodeId: nodes[0].nodeId,
  credentials: {
    accountId: 'stratix',
  },
};

await unifiedOpenClawConnectionManager.initialize(config);
```

## 🧪 测试验证

### Web 模式测试

```bash
# 1. 启动 Gateway
npm run dev:backend

# 2. 启动前端
npm run dev:frontend

# 3. 访问 http://localhost:7523
# 测试 Local/Remote/Auto 模式
```

### Electron 模式测试

```bash
# 开发模式
npm run electron:dev

# 构建应用
npm run electron:build
```

### 测试清单

- [ ] Local 模式连接本地 Gateway
- [ ] Remote 模式连接远程 WebSocket
- [ ] Auto 模式自动降级
- [ ] Tailscale 节点发现
- [ ] Tailscale 连接
- [ ] 配置持久化
- [ ] 状态实时更新
- [ ] 错误处理

## ⚠️ 注意事项

### 1. 配置迁移

旧的配置保存在 `localStorage` 的 `stratix_character_creator_openclaw` key 中，新配置保存在 `stratix_openclaw_config`。

迁移脚本（可选）：

```typescript
function migrateConfig() {
  const oldConfig = localStorage.getItem('stratix_character_creator_openclaw');
  if (oldConfig) {
    const parsed = JSON.parse(oldConfig);
    const newConfig: UnifiedOpenClawConfig = {
      mode: 'auto',
      localEndpoint: parsed.endpoint || 'http://127.0.0.1:18789',
      credentials: {
        accountId: parsed.accountId,
        apiKey: parsed.apiKey,
      },
    };
    localStorage.setItem('stratix_openclaw_config', JSON.stringify(newConfig));
  }
}
```

### 2. Electron 环境要求

- Node.js 22+
- Tailscale 客户端（推荐安装）
- 打包配置更新

### 3. 类型兼容性

保留了 `OpenClawConfigLocal` 和 `DirectLLMConfigLocal` 用于向后兼容，但推荐使用新类型。

## 🔗 相关文档

- [OpenClaw 官方文档](https://docs.openclaw.ai/)
- [统一连接管理器 API 文档](./openclaw-connection-manager.md)
- [Electron 集成指南](../../electron/README.md)
- [故障排查指南](./openclaw-troubleshooting.md)

## 📝 版本信息

- **迁移完成日期**: 2026-02-25
- **适用版本**: v1.0.0+
- **最后更新**: 2026-02-25

## 🆘 问题反馈

遇到问题请查看 [故障排查指南](./openclaw-troubleshooting.md) 或提交 Issue。
