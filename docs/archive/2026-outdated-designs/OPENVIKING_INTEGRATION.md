# OpenViking 集成方案设计文档

## 1. 背景与目标

### 1.1 背景

Stratix 的 `MemoryManager` 当前使用简单的 JSON 文件持久化，仅支持：
- 短/中/长期记忆三层结构
- 基于关键词的简单搜索
- 无语义理解能力

OpenViking 是专为 Agent 设计的上下文数据库，提供：
- **Session 管理**：多轮对话上下文追踪
- **语义搜索**：基于向量检索的语义匹配
- **记忆提取**：自动从对话中提取关键记忆
- **资源管理**：文件/URL 资源的统一管理

### 1.2 目标

在 Stratix 的 `MemoryManager` 与 OpenViking 之间建立适配层：
1. **语义搜索增强**：将 MemoryManager 的关键词搜索升级为向量语义搜索
2. **跨 Agent 共享记忆**：通过 OpenViking Session 实现 Agent 间共享上下文
3. **Zone Context 增强**：OpenViking 作为 Zone 的共享记忆存储
4. **渐进式迁移**：保持向后兼容，现有的 JSON 记忆数据平滑迁移

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Stratix Agent                                │
│  ┌─────────────────┐     ┌──────────────────────────────────┐   │
│  │  MemoryManager  │────▶│     OpenVikingAdapter            │   │
│  │  (现有实现)      │     │  ┌────────────────────────────┐  │   │
│  │                 │     │  │ OpenVikingCache            │  │   │
│  │  - shortTerm    │     │  │ - sessionId                │  │   │
│  │  - midTerm      │     │  │ - localCache               │  │   │
│  │  - longTerm     │     │  │ - pendingOperations        │  │   │
│  │                 │     │  │ - fallbackMode             │  │   │
│  │                 │     │  └────────────────────────────┘  │   │
│  │                 │     │  ┌────────────────────────────┐  │   │
│  │                 │     │  │ OpenVikingHTTPClient       │  │   │
│  │                 │     │  │ - url: localhost:1933      │  │   │
│  │                 │     │  │ - apiKey / agentId         │  │   │
│  │                 │     │  └────────────────────────────┘  │   │
│  └─────────────────┘     └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌────────────────────────────┐
                    │   OpenViking Server        │
                    │   (openviking-server)       │
                    │                            │
                    │   - Session Store          │
                    │   - VikingFS (向量存储)     │
                    │   - Memory Extraction     │
                    │   - Semantic Index        │
                    └────────────────────────────┘
```

### 2.2 模块职责

| 模块 | 职责 |
|------|------|
| `OpenVikingAdapter` | 核心适配器：封装 OpenViking API，管理 session 和缓存 |
| `OpenVikingCache` | 本地缓存层：减少网络调用，加速热路径，支持降级 |
| `OpenVikingHTTPClient` | HTTP 客户端：封装 REST API 调用，自动重试 |
| `MemoryManager` (改造) | 保留现有接口，新增 `searchMemories()` 语义搜索方法 |
| `ZoneContextManager` | Zone 共享记忆：每个 Zone 对应一个 OpenViking session |

---

## 3. 接口适配层设计

### 3.1 OpenVikingAdapter 接口

```typescript
// src/stratix-agent/core/OpenVikingAdapter.ts

interface OpenVikingConfig {
  serverUrl: string;        // OpenViking Server URL (默认: http://localhost:1933)
  apiKey?: string;          // API Key (可选，用于认证)
  agentId: string;          // Agent 标识
  accountId?: string;       // 多租户 account
  timeout?: number;         // 请求超时 (默认 60s)

  // 缓存配置
  cache?: {
    enabled: boolean;
    maxSize: number;
    ttl: number;
  };

  // 降级配置
  fallback?: {
    enabled: boolean;
    healthCheckInterval: number;
    recoveryThreshold: number;
  };
}

interface SessionInfo {
  sessionId: string;
  createdAt: string;
  status: 'active' | 'archived';
}

interface SearchResult {
  uri: string;
  score: number;
  abstract?: string;
  overview?: string;
}

interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  errors?: string[];
}

class OpenVikingAdapter {
  constructor(config: OpenVikingConfig);

  // 生命周期
  async initialize(): Promise<void>;
  async close(): Promise<void>;
  async healthCheck(): Promise<boolean>;
  isFallbackMode(): boolean;

  // Session 管理
  async createSession(metadata?: Record<string, any>): Promise<SessionInfo>;
  async getSession(sessionId: string): Promise<SessionInfo>;
  async deleteSession(sessionId: string): Promise<void>;
  async listSessions(): Promise<SessionInfo[]>;

  // 消息管理
  async addMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<void>;
  async commitSession(sessionId: string): Promise<{ taskId: string }>;

  // 搜索
  async search(
    query: string,
    sessionId?: string,
    options?: { limit?: number; scoreThreshold?: number }
  ): Promise<SearchResult[]>;
  async find(
    query: string,
    targetUri?: string,
    options?: { limit?: number; scoreThreshold?: number }
  ): Promise<SearchResult[]>;

  // 资源管理
  async addResource(
    path: string,
    options?: { reason?: string; instruction?: string; wait?: boolean }
  ): Promise<{ rootUri: string }>;
  async readContent(uri: string): Promise<string>;
  async abstract(uri: string): Promise<string>;
  async overview(uri: string): Promise<string>;

  // 任务状态
  async getTask(taskId: string): Promise<{ status: string } | null>;

  // 队列管理
  async flushPendingOperations(): Promise<void>;
  getPendingCount(): number;
}
```

### 3.2 MemoryManager 扩展接口

```typescript
// 在现有 MemoryManager 上扩展

interface MemorySearchOptions {
  query: string;                    // 语义查询
  limit?: number;                   // 返回数量限制
  scoreThreshold?: number;          // 相似度阈值
  types?: MemoryEntry['type'][];   // 过滤类型
  useOpenViking?: boolean;          // 是否使用 OpenViking (默认 true)
}

interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  source: 'local' | 'openviking';  // 结果来源
}

interface SyncOptions {
  sessionId?: string;              // 指定 session
  batchSize?: number;              // 批量大小
  force?: boolean;                 // 强制同步
}

interface MemoryManager {
  // 现有接口保留...

  // 新增：语义搜索（兼容旧接口）
  async searchMemories(
    options: MemorySearchOptions
  ): Promise<MemorySearchResult[]>;

  // 新增：同步到 OpenViking
  async syncToOpenViking(options?: SyncOptions): Promise<SyncResult>;

  // 新增：从 OpenViking 恢复
  async restoreFromOpenViking(sessionId?: string): Promise<void>;

  // 新增：OpenViking 状态
  getOpenVikingStatus(): { connected: boolean; lastSync: number };

  // 新增：批量添加
  async batchAddMemories(entries: MemoryEntry[]): Promise<void>;
}
```

### 3.3 ZoneContextManager 接口

```typescript
// src/stratix-character-creator/core/ZoneContextManager.ts

interface ZoneSession {
  zoneId: string;
  sessionId: string;
  agentIds: string[];
  lastActivity: number;
}

class ZoneContextManager {
  // 每个 Zone 对应一个 OpenViking session
  async enterZone(zoneId: string, agentId: string): Promise<void>;
  async leaveZone(zoneId: string, agentId: string): Promise<void>;

  // Zone 内搜索（跨 Agent 共享记忆）
  async searchZone(
    zoneId: string,
    query: string
  ): Promise<SearchResult[]>;

  // 获取 Zone 上下文摘要
  async getZoneSummary(zoneId: string): Promise<string>;

  // 提交 Zone 记忆
  async commitZone(zoneId: string): Promise<void>;

  // 获取当前 Zone 内的 Agent
  getZoneMembers(zoneId: string): string[];
}
```

---

## 4. 数据模型映射

### 4.1 Stratix → OpenViking 映射

| Stratix 概念 | OpenViking 概念 | 映射说明 |
|-------------|---------------|---------|
| Agent | Agent | 通过 `X-OpenViking-Agent` header 标识 |
| Session | Session | 每个 Agent 一个 session，或每个 Zone 一个共享 session |
| ChatMessage | Message | 直接映射 `role` + `content` |
| MemoryEntry | VikingURI Resource | 通过 `add_resource` 存入，`abstract` 作为摘要 |
| Zone | Session | Zone 的 OKR 信息作为 session metadata |

### 4.2 消息格式对比

**Stratix ChatMessage**:
```typescript
{
  role: 'user' | 'assistant',
  content: string,
  timestamp?: string
}
```

**OpenViking Message**:
```json
{
  "role": "user",
  "content": "message content here"
}
```

### 4.3 记忆存储策略

| 记忆类型 | 存储位置 | 检索方式 |
|---------|---------|---------|
| 短期记忆 (shortTerm) | MemoryManager 内存 | 内存直接访问 |
| 中期记忆 (midTerm) | MemoryManager 内存 + OpenViking Cache | 关键词 + 语义 |
| 长期记忆 (longTerm) | OpenViking VikingFS | 语义搜索 |
| Zone 共享记忆 | OpenViking Zone Session | 语义搜索 + Session 上下文 |

---

## 5. 调用流程

### 5.1 Agent 启动流程

```
Agent 启动
    │
    ▼
初始化 MemoryManager
    │
    ▼
检查 OpenViking 健康状态
    │
    ├─── 可用 ───▶ 创建/恢复 Session
    │
    └─── 不可用 ──▶ 降级模式启动
                       │
                       ▼
              从本地 JSON 恢复记忆
    │
    ▼
从 OpenViking 恢复长期记忆到 MemoryManager.longTerm
    │
    ▼
Agent 开始处理请求
```

### 5.2 消息处理流程

```
接收用户消息
    │
    ▼
MemoryManager.addMessage() → shortTerm
    │
    ├─── shortTerm 溢出 ───▶ 晋升到 midTerm
    │                              │
    │                              ▼
    │                      加入同步队列
    │
    ▼
Agent 生成响应
    │
    ▼
addMessage(role='assistant', content=response)
    │
    ▼
定期 flushPendingOperations() 批量同步
    │
    ▼
定期 commit_session() 提取记忆
```

### 5.3 语义搜索流程

```
Agent 请求语义搜索
    │
    ▼
检查 OpenViking 状态
    │
    ├─── 可用 ───▶ 并行查询:
    │              - OpenViking.find() 语义搜索
    │              - 本地 searchLongTerm() 关键词搜索
    │              ▼
    │         合并结果，按 score 排序
    │
    └─── 降级模式 ──▶ 仅使用本地 searchLongTerm()
    │
    ▼
返回 MemorySearchResult[]
    │
    ▼
更新本地缓存
```

---

## 6. Zone Context 增强方案

### 6.1 设计理念

每个 Zone 对应一个 OpenViking Session：
- Zone 的 O (Objective) 和 KR (Prompt) 作为 session metadata
- Zone 内的 Agent 共享这个 session
- Agent 进入 Zone 时，自动加载 Zone session 的上下文

### 6.2 Zone Session 结构

```typescript
interface ZoneSessionConfig {
  zoneId: string;
  zoneTitle: string;        // O (Objective)
  zonePrompt: string;       // KR (Key Results)
  memberAgentIds: string[];
  createdAt: number;
}

// 存储在 OpenViking session metadata 中
```

### 6.3 Agent 进入 Zone 流程

```
Agent 调用 moveTo(zoneId)
    │
    ▼
检查是否已在 Zone 内
    │
    ├─── 已在 ───▶ 直接返回
    │
    ▼ (不在)
离开当前 Zone (如有)
    │
    ▼
加载 Zone Session (或创建新 Session)
    │
    ▼
同步 Zone 的 longTerm memories 到 Agent
    │
    ▼
更新 Agent 的 ZonePromptContext
```

---

## 7. 共享记忆机制

### 7.1 共享级别

| 级别 | 范围 | 实现 |
|-----|------|-----|
| Agent Private | 单 Agent | Agent 私有 session |
| Zone Shared | 同 Zone 内 Agent | Zone session (共享读写) |
| Project | 同项目 Agent | Project session (只读) |
| Global | 所有 Agent | 全局 knowledge base |

### 7.2 冲突处理

- Zone 共享记忆：最后写入优先 (Last-Write-Wins)
- Session commit 时检测冲突，保留高 importance 记忆
- 提供手动解决接口

---

## 8. 接口评审与优化

### 8.1 MemoryManager 接口评估

**现有接口分析**：

| 接口 | 评估 | 优化建议 |
|------|------|---------|
| `addMessage()` | ✅ 保留 | 异步化，内部触发 OpenViking 同步 |
| `getRecentMessages()` | ✅ 保留 | 增加 OpenViking 缓存查询 |
| `searchLongTerm()` | ⚠️ 需增强 | 改为语义搜索，支持混合检索 |
| `addLongTermMemory()` | ✅ 保留 | 同步写入 OpenViking |
| `buildContext()` | ✅ 保留 | 可注入 OpenViking 搜索结果 |
| `save()/load()` | ✅ 保留 | 保持本地 JSON 作为 fallback |
| `getSkillRecords()` | ✅ 保留 | - |

**新增接口**：

```typescript
interface MemoryManagerExtended {
  // 语义搜索 (新增)
  searchMemories(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  // OpenViking 同步 (新增)
  syncToOpenViking(options?: SyncOptions): Promise<SyncResult>;
  restoreFromOpenViking(sessionId?: string): Promise<void>;

  // 状态查询 (新增)
  getOpenVikingStatus(): { connected: boolean; lastSync: number };
  getSyncQueueSize(): number;

  // 批量操作 (新增)
  batchAddMemories(entries: MemoryEntry[]): Promise<void>;
}
```

### 8.2 接口变更影响评估

- **向后兼容**：现有接口保持不变，通过内部实现增强
- **API 破坏性变更**：无，所有新增方法均为可选
- **类型兼容性**：`MemoryEntry` 类型保持兼容

---

## 9. 性能考量与优化

### 9.1 延迟分析

| 操作 | 延迟 | 优化策略 |
|------|------|---------|
| HTTP 健康检查 | ~50ms | 缓存健康状态 30s |
| 创建 Session | ~100ms | Session 复用 |
| 添加消息 | ~80ms | 批量 + 异步 |
| 语义搜索 | ~200ms | 本地缓存优先 |
| commit_session | ~500ms+ | 后台异步执行 |

### 9.2 缓存策略

```typescript
interface CacheConfig {
  // 健康状态缓存
  healthTtl: 30_000,           // 30 秒
  healthStaleThreshold: 60_000, // 60 秒后强制刷新

  // 搜索结果缓存
  searchCacheEnabled: true,
  searchCacheMaxSize: 500,
  searchCacheTtl: 5 * 60_000,  // 5 分钟

  // Session 缓存
  sessionCacheTtl: 30 * 60_000, // 30 分钟

  // 消息批量
  messageBatchSize: 10,
  messageBatchInterval: 1000,  // 1 秒
}
```

### 9.3 性能优化措施

1. **连接复用**：使用 HTTP Keep-Alive，复用 TCP 连接
2. **批量操作**：消息先入本地队列，批量同步到 OpenViking
3. **异步 commit**：commit_session 后台执行，不阻塞主流程
4. **搜索降级**：OpenViking 不可用时回退到本地关键词搜索
5. **预取**：Agent 空闲时预加载可能需要的上下文

---

## 10. 降级方案设计

### 10.1 降级策略

```
┌─────────────────────────────────────────────────────────────┐
│                    请求入口                                   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │   OpenViking 可用？           │
            └───────────────────────────────┘
                    │               │
                   Yes              No
                    │               │
                    ▼               ▼
    ┌───────────────────┐   ┌───────────────────┐
    │  完整功能模式       │   │   降级模式         │
    │  - 语义搜索        │   │  - 本地 JSON 搜索  │
    │  - Session 管理    │   │  - 内存缓存        │
    │  - 跨 Agent 共享   │   │  - 队列延迟同步    │
    └───────────────────┘   └───────────────────┘
```

### 10.2 降级触发条件

```typescript
interface FallbackTrigger {
  // 健康检查连续失败次数
  healthCheckFailThreshold: 3,

  // 连续错误次数
  consecutiveErrorThreshold: 5,

  // 错误率阈值 (5分钟内)
  errorRateThreshold: 0.3,

  // 响应超时次数
  timeoutThreshold: 3,
}
```

### 10.3 降级模式行为

| 功能 | 正常模式 | 降级模式 |
|------|---------|---------|
| 语义搜索 | OpenViking find API | 本地关键词搜索 |
| 记忆存储 | 实时写入 OpenViking | 本地 JSON + 队列 |
| Session | OpenViking Session | MemoryManager 内存 |
| commit | 异步 commit | 跳过（仅本地存储）|
| 恢复 | 从 OpenViking 恢复 | 从本地 JSON 恢复 |

### 10.4 自动恢复

- 每 30 秒尝试健康检查
- 连续 3 次成功后自动切换回正常模式
- 切换时执行队列同步

---

## 11. 数据迁移方案

### 11.1 迁移策略：渐进式

```
Phase 1: 并行写入
├── 保持现有 JSON 存储
├── 同时写入 OpenViking
└── 记录迁移进度

Phase 2: 读扩散
├── 优先读 OpenViking
├── OpenViking 无数据时读 JSON
└── 缺失数据触发按需迁移

Phase 3: 切换
├── OpenViking 作为主存储
├── JSON 作为备份
└── 定期清理过期 JSON
```

### 11.2 迁移工具

```typescript
// scripts/migrate-memory.ts

interface MigrationResult {
  totalEntries: number;
  migratedEntries: number;
  failedEntries: number;
  duration: number;
}

async function migrateMemory(options: {
  sourcePath: string;      // 现有 JSON 文件路径
  targetSessionId?: string; // OpenViking session
  batchSize: number;       // 批量大小
  onProgress?: (p: number) => void;
}): Promise<MigrationResult>;
```

### 11.3 迁移执行

```bash
# 迁移单个 Agent 的记忆
npx ts-node scripts/migrate-memory.ts \
  --source ./memory/agent-123/memory.json \
  --target-session "agent-123-private"

# 批量迁移所有 Agent
npx ts-node scripts/migrate-memory.ts \
  --source ./memory/ \
  --batch-size 50
```

### 11.4 数据验证

- 迁移后自动验证记录数
- 抽样校验内容完整性
- 生成迁移报告

---

## 12. 分步骤实现计划

### Phase 1: 核心基础设施 (2-3 天)

| 任务 | 工期 | 依赖 |
|------|------|------|
| 1.1 OpenViking 服务化脚本 | 0.5 天 | - |
| 1.2 OpenVikingAdapter HTTP 客户端 | 1 天 | 1.1 |
| 1.3 OpenVikingAdapter Session 管理 | 0.5 天 | 1.2 |
| 1.4 单元测试 (Mock) | 0.5 天 | 1.2 |

### Phase 2: MemoryManager 集成 (2-3 天)

| 任务 | 工期 | 依赖 |
|------|------|------|
| 2.1 MemoryManager 扩展接口 | 0.5 天 | 1.3 |
| 2.2 语义搜索实现 | 0.5 天 | 2.1 |
| 2.3 同步机制实现 | 1 天 | 2.1 |
| 2.4 降级方案实现 | 0.5 天 | 2.3 |
| 2.5 集成测试 | 0.5 天 | 2.2-2.4 |

### Phase 3: Zone 增强 (2 天)

| 任务 | 工期 | 依赖 |
|------|------|------|
| 3.1 ZoneContextManager 实现 | 1 天 | 2.5 |
| 3.2 RTS 集成 | 0.5 天 | 3.1 |
| 3.3 UI 集成 | 0.5 天 | 3.1 |

### Phase 4: 优化与迁移 (1-2 天)

| 任务 | 工期 | 依赖 |
|------|------|------|
| 4.1 数据迁移工具 | 0.5 天 | 3.1 |
| 4.2 性能优化 | 0.5 天 | 2.5 |
| 4.3 监控与告警 | 0.5 天 | 4.2 |

---

## 13. 风险评估

### 13.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|-----|------|------|---------|
| OpenViking Server 不可用 | 高 | 中 | 降级到本地模式 |
| Session 同步延迟 | 中 | 低 | 异步 commit + 队列 |
| 向量化质量差 | 中 | 低 | 可调 threshold |
| 迁移数据丢失 | 高 | 低 | 并行写入 + 验证 |

### 13.2 运维风险

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| OpenViking 存储膨胀 | 中 | 定期清理 + 容量监控 |
| 多 Agent Session 冲突 | 中 | Session 隔离 |
| 服务启动依赖 | 中 | 健康检查 + 自动重启 |

### 13.3 安全风险

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| API Key 泄露 | 高 | 环境变量 + 密文配置 |
| 跨 Agent 数据泄露 | 高 | Session 隔离 + 权限控制 |

---

## 14. 配置参考

### 14.1 OpenViking Server 配置

```yaml
# ov.conf
[server]
host = 0.0.0.0
port = 1933
workers = 1

[auth]
mode = api_key  # trusted / dev
root_api_key = your-secret-key

[storage]
data_dir = ./openviking_data

[telemetry]
prometheus.enabled = false
```

### 14.2 Stratix 配置

```typescript
// src/stratix-agent/config/openviking.ts
export const openVikingConfig = {
  serverUrl: process.env.OPENVIKING_URL || 'http://localhost:1933',
  apiKey: process.env.OPENVIKING_API_KEY,
  agentId: 'stratix-agent',
  accountId: 'stratix-project',
  timeout: 60_000,

  // 缓存配置
  cache: {
    enabled: true,
    maxSize: 1000,
    ttl: 5 * 60_1000,  // 5 分钟
  },

  // 搜索配置
  search: {
    defaultLimit: 10,
    scoreThreshold: 0.5,
  },

  // Session 配置
  session: {
    autoCommit: true,
    commitInterval: 10 * 60_1000,  // 10 分钟
  },

  // 降级配置
  fallback: {
    enabled: true,
    healthCheckInterval: 30_000,
    recoveryThreshold: 3,
  },

  // 迁移配置
  migration: {
    batchSize: 50,
    parallelism: 3,
  },
};
```

---

## 15. 附录

### A. OpenViking API 快速参考

```bash
# 启动服务器
openviking-server --port 1933

# 健康检查
curl http://localhost:1933/health

# 创建 Session
curl -X POST http://localhost:1933/api/v1/sessions

# 添加消息
curl -X POST http://localhost:1933/api/v1/sessions/{id}/messages \
  -H "Content-Type: application/json" \
  -d '{"role": "user", "content": "hello"}'

# 语义搜索
curl -X POST http://localhost:1933/api/v1/search/find \
  -H "Content-Type: application/json" \
  -d '{"query": "what is openviking", "limit": 5}'

# 提交 Session
curl -X POST http://localhost:1933/api/v1/sessions/{id}/commit
```

### B. 相关文件路径

| 文件 | 用途 |
|------|------|
| `src/stratix-agent/core/MemoryManager.ts` | 现有 MemoryManager |
| `src/stratix-agent/core/OpenVikingAdapter.ts` | 需新增 |
| `src/stratix-character-creator/core/ZoneContextManager.ts` | 需新增 |
| `src/stratix-gateway/api/routes/agent.ts` | Agent 配置路由 |
| `scripts/start-openviking-server.sh` | 需新增 |
| `scripts/migrate-memory.ts` | 需新增 |

### C. 术语表

| 术语 | 定义 |
|------|------|
| VikingURI | OpenViking 资源地址格式 (e.g., `viking://resources/xxx`) |
| Session | OpenViking 会话，用于追踪多轮对话上下文 |
| commit | 提交 Session，触发 LLM 提取关键记忆 |
| Abstract | L0 级别摘要，资源的一句话概括 |
| Overview | L1 级别概览，资源的段落级描述 |

### D. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 2.0 | 2026-03-26 | 二次优化：增加接口评审、性能优化、降级方案、数据迁移方案 |
| 1.0 | 2026-03-26 | 初始版本 |
