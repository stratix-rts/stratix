# electron 模块代码审查

## 概览

**模块职责**: Stratix Electron 主进程和预加载脚本，负责在 Electron 内部启动 Gateway 服务、管理窗口、系统集成和 IPC 通信。

**文件统计**: 2 个源文件

| 文件 | 职责 |
|------|------|
| `main.ts` | Electron 主进程：服务初始化、窗口管理、IPC 处理 |
| `preload.ts` | 预加载脚本：通过 contextBridge 暴露 Electron API |

---

## 代码质量

### 优点

1. **安全隔离**: `contextBridge` + `contextIsolation: true` 确保渲染进程安全
2. **API 设计清晰**: `preload.ts` 导出类型化的 `ElectronAPI` 接口
3. **多窗口支持**: System Zone 可作为子窗口打开
4. **资源清理**: `before-quit` 事件正确清理 Tailscale、OpenClaw、Gateway
5. **敏感数据加密**: 使用 `safeStorage` 加密 API Keys

### 问题

#### 1. `main.ts:23` - `gatewayService: any` 类型

```typescript
let gatewayService: any = null;
```

Gateway 服务实例类型是 `any`，丢失了 TypeScript 类型安全。

#### 2. `main.ts:44-52` - 注释掉的代码块

```typescript
// [FIXME] 暂时禁用 — @noble/ed25519@3 ESM-only，与 CJS 构建不兼容
// electron:dev 已启动 standalone backend (7524)，IPC 已配置连接 7524
// gatewayService = await startGatewayService({
//   port: 7526,
//   bindAddress: '127.0.0.1',
//   dataDir,
//   mode: 'embedded',
// });
```

遗留注释代码块，应删除或标记为 TODO。

#### 3. `main.ts:233-247` - 硬编码端口列表重复

```typescript
const loadUrl = async () => {
  const ports = [7523, 7524, 7525, 7526, 7527, 7528, 7529, 7530];
  for (const port of ports) {
    // ...
  }
};
```

端口列表在 `loadDevUrl()` 和 `loadUrl()` 中重复定义两次 (line 94, 234)。

#### 4. `main.ts:298` - 硬编码端口

```typescript
const response = await fetch('http://127.0.0.1:7524/api/stratix/openclaw/connect', {...});
```

Gateway 端口 7524 硬编码，应使用环境变量或配置。

#### 5. `preload.ts:10-90` - `ElectronAPI` 接口大量使用 `any`

```typescript
export interface ElectronAPI {
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  tailscale: {
    getStatus: () => Promise<any>;
    // ...
  };
}
```

接口中使用 `any` 丢失类型安全，应使用具体类型。

#### 6. `main.ts:427-434` - JSON.parse 错误处理

```typescript
let keys: Record<string, string> = {};
if (fs.existsSync(keysPath)) {
  const existing = fs.readFileSync(keysPath);
  keys = JSON.parse(Buffer.from(existing.toString('base64'), 'base64').toString('utf-8'));
}
```

`JSON.parse` 缺少 try-catch，若文件损坏会导致崩溃。

#### 7. `main.ts:63-66` - Tailscale 启动失败静默

```typescript
const tailscaleStarted = await tailscale.start();
if (tailscaleStarted) {
  tailscale.startHealthCheck();
}
```

Tailscale 启动失败时无错误处理或日志，仅 `console.log` 输出一行。

---

## 安全

### 风险点

| 风险 | 等级 | 位置 | 说明 |
|------|------|------|------|
| API Key 加密 | 低 | `main.ts:418-466` | 使用 safeStorage，但 JSON.parse 无保护 |
| contextBridge 暴露 | 低 | `preload.ts:180` | 正确使用 contextIsolation |
| IPC 通道验证 | 中 | `main.ts:128-525` | 所有 IPC handler 无参数验证 |
| 硬编码端口 | 低 | `main.ts:298` | 7524 端口硬编码 |
| 子窗口 URL 注入 | 中 | `main.ts:233-247` | 从 URL query 参数加载，未校验 |

### 良好实践

1. **safeStorage 加密**: API Keys 使用 Electron 安全存储
2. **contextIsolation**: 渲染进程与 Node.js 隔离
3. **环境变量**: 部分配置使用 `process.env`

---

## 性能

### 优点

1. **延迟加载**: 开发服务器连接失败后才加载本地文件
2. **多端口探测**: 8 个端口探测，足够开发环境使用

### 问题

#### 1. `main.ts:86-90` - console-message 监听器

```typescript
mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
  if (level >= 3) { // 0=verbose, 1=info, 2=warn, 3=error
    console.log(`[Renderer error]: ${message}`);
  }
});
```

`console-message` 监听器长期存在，可能轻微影响性能。

---

## 架构

### 模块边界

```
electron/
├── main.ts (主进程)
│   ├── initializeServices() - 服务初始化
│   ├── createWindow() - 窗口管理
│   └── setupIPC() - IPC 处理
└── preload.ts (预加载)
    └── contextBridge.exposeInMainWorld('electronAPI')
```

### 依赖关系

```
electron (main.ts)
├── 依赖: stratix-gateway (startGatewayService)
├── 依赖: stratix-openclaw-adapter (WebSocketOpenClawAdapter)
├── 依赖: stratix-tailscale (EmbeddedTailscale)
├── 依赖: electron (BrowserWindow, ipcMain, safeStorage)
└── 依赖: fs-extra
```

### 架构问题

1. **IPC handler 分散**: 15+ 个 IPC handler 在 `setupIPC()` 中，可能需要拆分
2. **硬编码配置**: 端口、数据目录路径硬编码

---

## 测试

### 缺失覆盖

- 无测试文件

---

## 横向联动

### 依赖该模块的模块

| 模块 | 说明 |
|------|------|
| `electron` | 启动入口 |
| `stratix-gateway` | 嵌入启动 |
| `stratix-openclaw-adapter` | WebSocket 连接 |
| `stratix-tailscale` | Embedded Tailscale |

---

## 改进建议

### P0 (关键)

1. **修复 JSON.parse 错误处理**
   - 文件: `src/electron/main.ts:427-434`
   - 方案: 添加 try-catch 或使用 `JSON.parse` 的 safe 版本

2. **移除硬编码端口**
   - 文件: `src/electron/main.ts:298`
   - 方案: 从环境变量读取 Gateway 端口

### P1 (重要)

3. **提取重复的端口列表**
   - 文件: `src/electron/main.ts:94, 234`
   - 方案: 定义常量 `DEV_PORTS = [7523, ...]`

4. **添加 Tailscale 启动失败处理**
   - 文件: `src/electron/main.ts:63-66`
   - 方案: 启动失败时记录错误日志或告警

5. **类型化 ElectronAPI**
   - 文件: `src/electron/preload.ts`
   - 方案: 将 `any` 替换为具体类型

6. **删除遗留注释代码**
   - 文件: `src/electron/main.ts:44-52`
   - 方案: 删除或标记为 TODO

### P2 (优化)

7. **添加 IPC 参数验证**
   - 所有 `ipcMain.handle` 应验证参数

8. **添加单元测试**
   - 使用 Jest + electron-mock 测试 IPC handlers

---

## 总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | B+ | 整体良好，有遗留代码和重复 |
| 安全性 | B | safeStorage 加密，但 JSON.parse 缺保护 |
| 性能 | A | 轻量，无明显性能问题 |
| 架构 | B | 清晰，但 IPC handler 可拆分 |
| 测试 | D | 完全无测试 |

**核心改进方向**: 修复 JSON.parse 错误处理、移除硬编码端口和重复代码、建立测试。
