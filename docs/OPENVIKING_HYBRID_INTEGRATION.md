# OpenViking 混合集成方案

## 1. 背景与目标

### 现状
- MemoryManager 使用本地 JSON 文件存储
- 仅有关键词搜索，无语义理解能力

### 目标
- **本地记忆**：快速读写，立即持久化
- **远程记忆**：OpenViking 语义搜索 + 跨 Agent 共享
- **混合协同**：读写都走本地 + 远程同步，搜索合并两地结果
- **零侵入**：现有接口完全不变，OpenViking 作为可选扩展

---

## 2. 架构设计

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                     MemoryManager                             │
│  ┌────────────────┐    ┌─────────────────────────────────┐  │
│  │  本地存储       │    │     OpenVikingClient            │  │
│  │  (JSON 文件)   │    │  (HTTP 调用，异步同步)           │  │
│  │                │    │                                 │  │
│  │  shortTerm    │    │  - search() 语义搜索             │  │
│  │  midTerm      │◄───┤  - sync() 异步同步               │  │
│  │  longTerm     │    │  - commit() 提取记忆             │  │
│  └────────────────┘    └─────────────────────────────────┘  │
│            ▲                         │                        │
│            │                         ▼                        │
│            │              ┌─────────────────────┐              │
│            └──────────────│  OpenViking Server  │              │
│                            │  (独立部署，端口1933) │              │
│                            │  - Session 管理    │              │
│                            │  - 向量存储        │              │
│                            │  - 记忆提取        │              │
│                            └─────────────────────┘              │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 配置

```env
OPENVIKING_URL=http://localhost:1933  # 可选，不配置则纯本地模式
OPENVIKING_API_KEY=xxx               # 可选，生产环境使用
```

---

## 3. 数据流设计

### 3.1 写入流程

```
addMessage() / addLongTermMemory()
    │
    ├──▶ 本地 JSON (同步写入，立即持久化)
    │
    └──▶ OpenViking (异步同步，非阻塞)
              │
              ▼
         写入内存队列 (pendingOperations)
              │
              ▼ (定期 flush，或队列满)
         POST /api/v1/sessions/{id}/messages
              │
              ▼ (定期 commit，或达到阈值)
         POST /api/v1/sessions/{id}/commit
              │
              ▼
         OpenViking LLM 提取关键记忆，建立向量索引
```

### 3.2 读取流程

```
searchMemories(query)
    │
    ├──▶ 本地搜索 (关键词匹配，同步返回)
    │
    └──▶ OpenViking 语义搜索 (异步，结果返回后合并)
              │
              ▼
         合并两地结果，按 score 排序
              │
              ▼
         返回 MemorySearchResult[]
```

### 3.3 搜索结果合并策略

| 场景 | 处理方式 |
|------|---------|
| 两地都有结果 | 按 score 排序，去重 |
| 仅本地有结果 | 直接返回 |
| 仅远程有结果 | 直接返回 |
| OpenViking 不可用 | 仅返回本地结果 |

---

## 4. 接口设计

### 4.1 OpenVikingClient (新增)

```typescript
// src/stratix-agent/core/OpenVikingClient.ts

interface OpenVikingConfig {
  serverUrl: string;    // 默认: http://localhost:1933
  apiKey?: string;
  agentId: string;
  timeout?: number;
}

interface SearchResult {
  uri: string;
  score: number;
  content?: string;
  abstract?: string;
}

class OpenVikingClient {
  constructor(config: OpenVikingConfig);

  // 健康检查
  async healthCheck(): Promise<boolean>;

  // 语义搜索
  async search(query: string, options?: {
    limit?: number;
    scoreThreshold?: number;
  }): Promise<SearchResult[]>;

  // 同步消息到 OpenViking
  async addMessage(sessionId: string, role: 'user' | 'assistant', content: string): Promise<void>;

  // 提交 Session，触发记忆提取
  async commit(sessionId: string): Promise<void>;

  // 刷新待同步操作
  async flush(): Promise<void>;

  // 获取待同步数量
  getPendingCount(): number;
}
```

### 4.2 MemoryManager 扩展

**现有接口完全不变**，内部新增：

```typescript
// 新增：语义搜索
async searchMemories(
  query: string,
  options?: { limit?: number; useOpenViking?: boolean }
): Promise<Array<{ entry: MemoryEntry; score: number; source: 'local' | 'openviking' }>>;

// 新增：获取 OpenViking 状态
getOpenVikingStatus(): { connected: boolean; pendingSync: number };
```

---

## 5. 实现步骤

### Phase 1: 核心 (1-2 天)

| 任务 | 说明 |
|------|------|
| OpenVikingClient 实现 | HTTP 客户端，约 150 行 |
| 健康检查 + 搜索 | 最基础的两个接口 |
| 内存队列 | 待同步操作的队列 |

### Phase 2: 集成 (1 天)

| 任务 | 说明 |
|------|------|
| 读写流程对接 | MemoryManager 读写时触发 OpenViking 同步 |
| 搜索合并 | 合并本地和远程搜索结果 |

### Phase 3: 优化 (可选)

| 任务 | 说明 |
|------|------|
| Session 管理 | 每个 Agent 一个 Session |
| 定期 commit | 后台任务定期触发 |
| 降级处理 | OpenViking 不可用时的处理 |

---

## 6. 配置参考

### 6.1 环境变量

```env
# OpenViking 服务地址
OPENVIKING_URL=http://localhost:1933

# API Key (可选，生产环境使用)
OPENVIKING_API_KEY=your-secret-key

# Agent 标识
OPENVIKING_AGENT_ID=stratix-agent
```

### 6.2 OpenViking Server 部署

```bash
# 启动 OpenViking Server
openviking-server --port 1933

# 或 Docker
docker run -p 1933:1933 openviking/openviking
```

---

## 7. 风险与注意事项

| 风险 | 缓解 |
|------|------|
| OpenViking Server 不可用 | 本地独立工作，同步操作入队待后续 |
| 网络延迟 | 搜索操作异步，结果合并后返回 |
| 数据一致性 | 本地优先，同步失败重试 |

---

## 8. 与原方案对比

| | 原方案 (OPENVIKING_INTEGRATION.md) | 本方案 (混合) |
|--|-----------------------------------|--------------|
| 模块数 | 5+ | **1** |
| 代码量 | ~1500 行 | **~300 行** |
| Session 管理 | 完整实现 | **后续迭代** |
| 降级机制 | 三级降级 | **后续迭代** |
| 数据迁移 | 三阶段 | **不做** |
| 开发周期 | 7-10 天 | **2-3 天** |

---

## 9. 附录

### 9.1 OpenViking API 参考

```bash
# 健康检查
GET /health

# 创建 Session
POST /api/v1/sessions

# 添加消息
POST /api/v1/sessions/{id}/messages
Body: { "role": "user|assistant", "content": "..." }

# 提交 Session (触发记忆提取)
POST /api/v1/sessions/{id}/commit

# 语义搜索
POST /api/v1/search/find
Body: { "query": "...", "limit": 10 }
```

### 9.2 术语表

| 术语 | 定义 |
|------|------|
| Session | OpenViking 会话，对应一个 Agent 的对话上下文 |
| commit | 提交 Session，触发 LLM 提取关键记忆并建立向量索引 |
| hybrid | 本地 + 远程混合，本地立即持久化，远程异步同步 |

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026-03-26 | 初始版本，轻量混合方案 |
