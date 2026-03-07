# Stratix 统一架构文档

## 📋 项目概述

Stratix 现已实现**统一架构**，支持两种部署模式：
1. **Web 服务模式** - 传统 Gateway 服务
2. **Electron 桌面应用** - 完整独立的桌面应用

两种模式**共享同一份业务逻辑代码**，通过中间件适配层自动适配运行环境。

---

## 🏗️ 架构设计

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      前端应用层                              │
│            (Vue + Phaser, 代码完全相同)                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   中间件适配层 ⭐                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ServiceLocator (自动环境检测)                       │   │
│  │  ↓                                                   │   │
│  │  ServiceProvider (统一接口)                          │   │
│  │  - saveAgent(), loadAgent()                          │   │
│  │  - connectOpenClaw(), sendMessage()                  │   │
│  │  - discoverNodes(), connectNode()                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                            ↓                                 │
│  ┌──────────────────┐          ┌────────────────────────┐  │
│  │ WebProvider      │          │ ElectronProvider       │  │
│  │ (HTTP + WS)      │          │ (IPC + 本地服务)        │  │
│  └──────────────────┘          └────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    服务实现层                                │
│  Web 模式:                        Electron 模式:              │
│  ┌──────────────────┐            ┌────────────────────┐    │
│  │ Gateway 服务      │            │ Electron Main      │    │
│  │ - Express        │            │ - Gateway (内置)   │    │
│  │ - DataStore      │            │ - DataStore        │    │
│  │ - WebSocket      │            │ - Tailscale        │    │
│  │ - OpenClaw 代理   │            │ - OpenClaw 直连    │    │
│  └──────────────────┘            └────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 文件结构

```
src/
├── stratix-core/
│   └── services/                    # ⭐ 中间件适配层
│       ├── ServiceProvider.ts       # 服务接口定义
│       ├── WebServiceProvider.ts    # Web 模式实现
│       ├── ElectronServiceProvider.ts # Electron 模式实现
│       ├── ServiceLocator.ts        # 服务定位器
│       └── index.ts                 # 导出
│
├── stratix-gateway/
│   ├── index.ts                     # ⭐ Gateway 服务 (可复用)
│   ├── dataStoreService.ts          # 数据服务
│   └── api/routes/                  # API 路由
│
├── electron/
│   ├── main.ts                      # ⭐ Electron 主进程
│   └── preload.ts                   # ⭐ 预加载脚本
│
└── [其他模块...]
```

---

## 🎯 核心特性

### 1. 统一的服务访问

**前端代码无需修改**，自动适配两种模式：

```typescript
import { services } from '@/stratix-core/services';

// 保存 Agent
await services.saveAgent(config);

// 连接 OpenClaw
await services.connectOpenClaw(config);

// 发送消息
await services.sendOpenClawMessage('Hello');

// 发现 Tailscale 节点
const nodes = await services.discoverTailscaleNodes();
```

### 2. 自动环境检测

```typescript
class ServiceLocator {
  getProvider(): ServiceProvider {
    if (this.isElectron()) {
      return new ElectronServiceProvider();
    } else {
      return new WebServiceProvider();
    }
  }
  
  private isElectron(): boolean {
    return !!(window as any).electronAPI;
  }
}
```

### 3. Gateway 服务可复用

**独立运行**:
```bash
STANDALONE_MODE=true node dist/stratix-gateway/index.js
```

**嵌入式运行**:
```typescript
// Electron main.ts
import { startGatewayService } from '../stratix-gateway';

await startGatewayService({
  port: 7524,
  bindAddress: '127.0.0.1',
  mode: 'embedded',
});
```

---

## 🚀 部署模式

### 模式 A: Web 服务

**启动命令**:
```bash
npm run dev              # 开发模式
npm run build:backend    # 构建
npm run start:web        # 生产模式
```

**特点**:
- ✅ 独立 HTTP 服务
- ✅ 监听端口 3010
- ✅ 支持远程访问
- ❌ 需要单独运行

**数据目录**: `./stratix-data`

---

### 模式 B: Electron 桌面应用

**启动命令**:
```bash
npm run electron:dev     # 开发模式
npm run electron:build   # 构建应用
```

**特点**:
- ✅ 完整独立应用
- ✅ 内置 Gateway 服务
- ✅ 本地数据存储
- ✅ Tailscale 集成
- ✅ OpenClaw 直连

**数据目录**: `~/Library/Application Support/Stratix/data` (macOS)

---

## 📝 使用指南

### Web 模式使用

1. **启动 Gateway**:
   ```bash
   npm run dev:backend
   ```

2. **访问前端**:
   ```bash
   npm run dev:frontend
   # 访问 http://localhost:7523
   ```

3. **构建生产版本**:
   ```bash
   npm run build
   npm run start:web
   ```

---

### Electron 模式使用

1. **开发模式**:
   ```bash
   npm run electron:dev
   ```

2. **构建应用**:
   ```bash
   npm run electron:build
   ```

3. **安装应用**:
   - macOS: `release/Stratix.dmg`
   - Windows: `release/Stratix Setup.exe`
   - Linux: `release/Stratix.AppImage`

---

## 🔧 配置说明

### Gateway 服务配置

```typescript
interface GatewayServiceOptions {
  port?: number;              // 端口号 (默认 3010)
  bindAddress?: string;       // 监听地址 (默认 '0.0.0.0')
  dataDir?: string;           // 数据目录 (默认 './stratix-data')
  mode?: 'standalone' | 'embedded'; // 运行模式
}
```

### 环境变量

```bash
# Gateway 服务
PORT=3010                     # HTTP 端口
WS_PORT=3011                  # WebSocket 端口
DATA_DIR=./stratix-data       # 数据目录
BIND_ADDRESS=0.0.0.0          # 监听地址
STANDALONE_MODE=true          # 独立运行模式

# Electron
STRATIX_TAILSCALE_AUTH_KEY=   # Tailscale 认证密钥
```

---

## 📊 对比矩阵

| 特性 | Web 模式 | Electron 模式 |
|------|----------|---------------|
| Gateway 服务 | ✅ 独立进程 | ✅ 内置 |
| 数据服务 | ✅ 文件存储 | ✅ 文件存储 |
| Tailscale | ❌ 不支持 | ✅ 完整支持 |
| OpenClaw | ✅ 代理 | ✅ 直连 + 代理 |
| 远程访问 | ✅ 支持 | ❌ 本地 |
| 系统托盘 | ❌ | ✅ |
| 自动更新 | ❌ | ✅ |
| 原生通知 | ❌ | ✅ |

---

## 🎯 开发指南

### 添加新服务

1. **定义接口** (`ServiceProvider.ts`):
   ```typescript
   export interface ServiceProvider {
     newService(): Promise<Result>;
   }
   ```

2. **Web 实现** (`WebServiceProvider.ts`):
   ```typescript
   async newService(): Promise<Result> {
     const response = await fetch('/api/new-service');
     return response.json();
   }
   ```

3. **Electron 实现** (`ElectronServiceProvider.ts`):
   ```typescript
   async newService(): Promise<Result> {
     return await this.electronAPI.invoke('service:newService');
   }
   ```

4. **Electron IPC** (`main.ts`):
   ```typescript
   ipcMain.handle('service:newService', async () => {
     // 实现逻辑
   });
   ```

---

## 🔍 故障排查

### 问题 1: Electron 无法启动

**检查**:
- Node.js 版本 (需要 22+)
- 依赖安装 (`npm install`)
- 构建输出 (`npm run build:electron`)

### 问题 2: 数据目录权限

**解决**:
```bash
# macOS/Linux
chmod -R 755 ~/Library/Application\ Support/Stratix/data

# Windows
icacls "%APPDATA%\Stratix\data" /grant Users:F
```

### 问题 3: Tailscale 连接失败

**检查**:
- Tailscale 客户端是否安装
- 是否已登录 Tailscale
- 防火墙规则

---

## 📚 相关文档

- [OpenClaw 统一连接管理器](./openclaw-unified-connection.md)
- [迁移指南](./MIGRATION_GUIDE.md)
- [Electron 打包指南](../electron/README.md)

---

## 🎊 版本信息

- **架构版本**: v2.0.0
- **完成日期**: 2026-02-25
- **最后更新**: 2026-02-25
