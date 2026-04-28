# stratix-gateway 模块审查报告

## 概览

**模块目的**: Stratix Gateway HTTP 服务，提供 REST API、WebSocket 状态同步、Agent 编排、OpenClaw 代理管理

**文件统计**: 40+ 文件
- 入口: `index.ts` (服务启动)
- 核心: `GatewayEventBus.ts` (内部事件总线)
- 服务: `project/ZoneService.ts`, `dataStoreService.ts`, `lra/LRAService.ts`
- Agent: `agent/AgentOrchestrationService.ts`, `agent/agents/OpenClawAgent.ts`, `agent/agents/LLMAgent.ts`
- OpenClaw: `openclaw/OpenClawConnectionManager.ts`, `openclaw/OpenClawProxyManager.ts`
- API Routes: `api/routes/` (agent, command, lra, openclaw, project, skill, template, texture, zone, zone-context, zone-coordinator, zone-audit, systemZoneCycle, agentOrchestration, agentTask)
- 中间件: `api/retry/GatewayRetryAdapter.ts`

**关键导出**: `startGatewayService()`, `gatewayEventBus`, `ZoneService`

---

## 模块职责

Stratix Gateway 是后端核心服务，采用 Express.js 实现，提供以下能力：

1. **HTTP REST API** - 14+ 路由域（agent, command, lra, openclaw, project, skill, template, texture, zone, zone-context, zone-coordinator, zone-audit, agentOrchestration, agentTask）
2. **WebSocket 状态同步** - `StatusSyncService` 维护 WebSocket 连接，实时推送 Zone/Agent 状态
3. **Zone 生命周期管理** - `ZoneService` 封装 Zone CRUD、文件管理、任务管理、消息系统、软删除回收站
4. **Agent 编排** - `AgentOrchestrationService` 管理多 Agent 协作
5. **OpenClaw 代理** - `OpenClawProxyManager` / `OpenClawConnectionManager` 管理 OpenClaw 设备连接
6. **NocoDB 集成** - 可选的 NocoDB 服务集成
7. **优雅关闭** - SIGTERM/SIGINT 处理，清理定时任务和连接

### ZoneService 职责明细

ZoneService 是最核心的业务服务（约 1640 行），包含：

| 功能域 | 方法数 | 说明 |
|--------|--------|------|
| Zone CRUD | 8 | create, get, update, delete, restore, permanentlyDelete, emptyTrash, search |
| Zone Members | 4 | addMember, removeMember, addMembers, removeMembers |
| Zone Files | 10+ | addFile, addFiles, removeFile, getFileWithContent, refreshFile, scanFolder, searchFiles, getFileVersions, updateFileWithVersion, rollbackFileToVersion |
| Zone Tasks | 8 | getTasks, getTask, createTask, updateTask, deleteTask, claimTask, batchCreate, batchUpdate |
| Zone Messages | 3 | getMessages, getMessagesCount, addMessage |
| Import/Export | 2 | exportZone, cloneZone, importZone |
| 统计 | 1 | getZoneStatistics |

---

## 核心接口

### 导出

```typescript
// 服务入口
export async function startGatewayService(options?: GatewayServiceOptions): Promise<GatewayServiceInstance>

// 内部事件总线（单例）
export const gatewayEventBus: GatewayEventBus

// Zone 服务（单例）
export const zoneService: ZoneService
```

### GatewayEventBus 接口

```typescript
class GatewayEventBus extends EventEmitter {
  static getInstance(): GatewayEventBus

  // Channel 消息
  publishChannelMessage(projectId, channelId, message, subscriberIds): void
  onChannelMessage(handler): () => void
  onAgentMention(agentId, handler): () => void

  // Zone 事件
  publishZoneEvent(type, zoneId, projectId, data?): void
  onZoneEvent(handler): () => void
}
```

### ZoneService 接口

```typescript
class ZoneService {
  initialize(): Promise<void>
  setPermissionOrchestrator(orchestrator: PermissionOrchestrator): void

  // Zone CRUD
  getZones(projectId): Promise<Zone[]>
  getZone(zoneId): Promise<Zone | null>
  createZone(projectId, title, prompt, agentId): Promise<Zone>
  updateZone(zoneId, updates, agentId): Promise<Zone>
  deleteZone(zoneId, agentId): Promise<boolean>

  // Members
  addMember(zoneId, agentId, requesterId): Promise<Zone>
  removeMember(zoneId, agentId, requesterId): Promise<Zone>

  // Files
  addFile(zoneId, name, sourceType, source, fileType?, agentId?): Promise<ZoneFile>
  getFileWithContent(zoneId, fileId): Promise<{ file, content, cacheHit }>
  refreshFile(zoneId, fileId, force?, agentId?): Promise<ZoneFile>

  // Tasks
  createTask(zoneId, agentId, title): Promise<ZoneTask>
  claimTask(zoneId, taskId, agentId): Promise<ZoneTask>

  // Import/Export
  exportZone(zoneId): Promise<{ version, exportedAt, zone }>
  importZone(projectId, template, creatorAgentId?, agentId?): Promise<Zone>
  cloneZone(zoneId, options?, agentId?): Promise<Zone>
}
```

---

## 依赖关系

```
stratix-gateway
├── stratix-database (SQLite 初始化, Repository)
├── stratix-nocodb (可选 NocoDB 服务)
├── stratix-data-store (OpenClawConnectionStore)
├── stratix-core (PermissionOrchestrator, StratixStateStore)
├── stratix-project (types, ProjectChannelMessage)
├── stratix-orchestration (TaskQueueService - 动态 require)
├── stratix-systemzone (systemzone routes)
├── express, cors, dotenv, fs-extra (基础设施)
└── axios (HTTP 客户端)
```

### 被依赖

- `electron` - 作为主服务入口
- `stratix-core` - 通过 WebSocket StatusSync
- `stratix-project` - 使用 ZoneService 做 Zone CRUD
- 浏览器前端 - 通过 HTTP API 和 WebSocket

---

## 数据流

### HTTP 请求处理流

```
Client Request
  → Express Middleware (cors, json, logging)
  → Route Handler (e.g., zoneRoutes)
  → ZoneService (业务逻辑)
  → ZoneRepository (数据访问)
  → SQLite Database
  → GatewayEventBus.publishZoneEvent() (事件发布)
  → StatusSyncService (WebSocket 推送)
  → Connected Clients
```

### Zone 创建流

```
POST /api/zones
  → zoneRoutes.createZone()
  → ZoneService.createZone()
    → PermissionOrchestrator.checkPermission()
    → ZoneRepository.createZone()
    → ZoneService.syncZoneToStore() (StratixStateStore)
    → ZoneService.startZoneAgent() (OKR → TaskQueue)
    → GatewayEventBus.publishZoneEvent('zone:created')
    → StatusSyncService 广播
  → Response
```

### OpenClaw 连接流

```
OpenClaw Device → WebSocket → OpenClawConnectionManager
  → OpenClawProxyManager (代理转发)
  → gatewayEventBus (状态通知)
  → StatusSyncService (状态推送)
```

---

## 代码质量

### 优点

- **服务架构清晰**: 入口文件 `index.ts` 清晰组织了中间件、路由、服务初始化
- **GatewayEventBus 解耦**: 内部事件总线解耦了组件间通信
- **权限集成**: `ZoneService` 集成了 `PermissionOrchestrator`
- **优雅关闭**: `gracefulShutdown` 处理 SIGTERM/SIGINT
- **路由模块化**: 每个功能域有独立路由文件

### 问题

| 位置 | 问题 | 严重性 |
|------|------|--------|
| `index.ts:108-111` | 日志中间件无请求体过滤，可能打印敏感信息 | 中 |
| `GatewayEventBus.ts:40` | 使用 `EventEmitter` 而非 `EventEmitter2`，不支持命名空间 | 低 |
| `GatewayEventBus.ts:35` | `data?: any` 类型太宽泛 | 中 |
| `ZoneService.ts:43-44` | 缓存配置硬编码 (cacheExpiry, maxFileSize) | 低 |
| `index.ts:265` | `process.exit(0)` 在 gracefulShutdown 中直接退出，不等待其他清理 | 中 |

### 函数长度

- `startGatewayService()`: ~150 行 (稍长但可接受)
- `ZoneService` 方法: 长度合理
- API Routes: 每个 handler 10-30 行，结构良好

### 死代码

- 未发现明显死代码

---

## 安全

### 注入风险

| 位置 | 风险 | 评估 |
|------|------|------|
| `index.ts:105` | `express.json({ limit: '50mb' })` 无限制 | 中 (DoS 风险) |
| `ZoneService.ts:47` | `allowedUrlPatterns` 初始化为空，可能 SSRF | 中 |
| API Routes | 所有 user input 都直接传递给 service 层 | 低 (service 层有检查) |

### 权限系统

**位置**: `ZoneService.ts:76-100`
```typescript
private checkPermission(action: string, resource: string, agentId: string): void {
  // ...
  if (result.decision === 'deny') {
    throw new Error(`Permission denied: ${action} on ${resource} by ${agentId}`);
  }
  // 'ask' means user confirmation required — return 403 until UI confirmation flow is implemented
  if (result.decision === 'ask') {
```
- 权限决策正确处理，但 'ask' 返回 403 可能不符合预期

### 数据保护

- `index.ts` 使用 `dotenv.config()` 加载环境变量，API Key 等敏感数据通过环境变量管理
- ZoneService 有 URL 抓取的 IP 范围黑名单 (line 48-55)

---

## 性能

### 优点

- **WebSocket 状态同步**: `StatusSyncService` 提供实时状态推送
- **数据库初始化一次**: `initializeDatabase()` 和 `dataStoreService.initialize()` 在启动时完成
- **OpenClaw 连接池**: `OpenClawConnectionManager` 管理连接生命周期

### 问题

| 位置 | 问题 | 影响 |
|------|------|------|
| `index.ts:105` | JSON body limit 50MB 可能导致内存问题 | 中 |
| `index.ts:225-236` | 定时任务每 5 分钟检查遗弃任务，无上限控制 | 低 |
| `GatewayEventBus` | 使用 `EventEmitter`，不支持异步事件处理 | 低 |

---

## 架构

### 模块边界

```
index.ts (服务入口)
├── Express App
│   ├── middleware (cors, json, logging)
│   └── routes/
│       ├── /api/agent → agentTaskRoutes
│       ├── /api/lra → lraRoutes
│       ├── /api/projects → projectRoutes
│       ├── /api/zone-context → zoneContextRoutes
│       └── ...
├── GatewayEventBus (内部事件)
├── StatusSyncService (WebSocket)
├── ZoneService
├── OpenClawProxyManager
└── LRAService
```

### 依赖方向

```
startGatewayService
  ├── Express Routes → ZoneService, LRAService, etc.
  ├── StatusSyncService
  ├── OpenClawProxyManager
  └── dataStoreService
```

### 耦合

- **中等耦合**: 路由直接依赖 service 实例
- **单例模式**: `gatewayEventBus`, `openClawProxyManager` 使用单例

---

## 测试

### 覆盖率

- **无测试**: 模块无测试文件

### 建议

- 为 ZoneService 添加单元测试（特别是权限检查）
- 为 API routes 添加集成测试

---

## 横向联动

### 依赖的模块

| 模块 | 用途 |
|------|------|
| `stratix-database` | SQLite 数据库 |
| `stratix-nocodb` | NocoDB 服务 (可选) |
| `stratix-data-store` | OpenClawConnectionStore |
| `stratix-core` | state, permission |
| `stratix-project` | types |
| `stratix-orchestration` | TaskQueueService |
| `stratix-systemzone` | systemzone routes |
| `express`, `cors`, `dotenv`, `fs-extra` | 基础设施 |

### 依赖本模块的模块

- `electron` - 作为主服务入口
- `stratix-core` - 通过 WebSocket StatusSync

---

## 改进建议

### P0 - 应修复

1. **JSON body limit 过高** (`index.ts:105`)
   ```typescript
   app.use(express.json({ limit: '50mb' }));
   ```
   建议：根据实际需求降低到 1-5MB，并添加请求体大小验证

2. **URL 抓取安全 - allowedUrlPatterns 为空** (`ZoneService.ts:47`)
   ```typescript
   private allowedUrlPatterns: RegExp[] = []; // 允许的 URL 正则模式
   ```
   建议：默认阻止所有 URL，或提供安全的默认值

### P1 - 应修复

3. **gracefulShutdown 直接 process.exit** (`index.ts:265`)
   ```typescript
   process.exit(0);
   ```
   建议：添加回调机制，让其他组件先完成清理

4. **GatewayEventBus data 类型太宽泛** (`GatewayEventBus.ts:35`)
   ```typescript
   data?: any;
   ```
   建议：使用联合类型替代 any

### P2 - 可改进

5. **添加请求体日志过滤**
   - 日志中间件应过滤 sensitive 字段 (password, apiKey, token)

6. **添加健康检查详情**
   - 当前 `/health` 返回固定值，可检查实际 DB 连接等

7. **ZoneService 缓存配置外部化**
   - 将 `cacheExpiry`, `maxFileSize` 改为配置项

---

## 总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | B+ | 架构清晰，服务组织良好 |
| 安全 | B- | JSON limit 过高，URL 抓取需配置 |
| 性能 | B | 基本良好，有优化空间 |
| 架构 | A | 模块化良好，依赖清晰 |
| 测试 | D | 完全无测试 |
| 可维护性 | B+ | 代码组织良好，易于理解 |

**总体评估**: Gateway 服务模块架构清晰，路由模块化，权限系统集成良好。主要改进点是安全配置（JSON limit、URL 抓取）和测试覆盖。
