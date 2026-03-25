# Agent 聊天记忆系统设计文档

## 1. 背景与目标

### 当前问题

`AgentChatModal` 每次打开都是全新的对话，无历史记忆。用户无法：
- 继承之前的对话上下文继续交流
- 搜索过往讨论过的内容
- 跨会话保持记忆

### 目标

实现 Agent 聊天记忆系统，支持：
1. **短期记忆**：自动加载最近 N 条消息作为上下文
2. **历史检索**：意图识别 + 关键字搜索
3. **完全离线**：不依赖外部向量服务

---

## 2. 设计原则

### 2.1 混合检索策略

| 场景 | 策略 | 实现 |
|------|------|------|
| 短期记忆（<50 条） | 按时间倒序 | SQL ORDER BY timestamp DESC LIMIT N |
| 语义搜索 | 意图识别 + LIKE | LLM 提取关键字 + SQL LIKE |

### 2.2 隐私优先

- 所有数据存储在本地 SQLite
- 不上传任何对话内容到外部服务
- 支持完全离线运行

### 2.3 向后兼容

当前实现不引入外部依赖，后续可平滑升级到向量搜索（如 sqlite-vss）。

---

## 3. 架构设计

### 3.1 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    前端 (Vue/Phaser)                     │
│                  AgentChatModal.vue                      │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / API
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   Gateway (Node.js)                      │
│              /api/stratix/agent/:id/messages            │
└────────────────────────┬────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                              ▼
┌─────────────────────┐    ┌─────────────────────────────────┐
│   SQLite             │    │     StratixAgentExecutor       │
│ agent_chat_messages  │    │  (带 history context)          │
│ (消息持久化)          │    │                                 │
└─────────────────────┘    └─────────────────────────────────┘
```

### 3.2 数据流

```
用户发送消息
    │
    ▼
1. 保存用户消息到 SQLite
    │
    ▼
2. 构建 history context（最近 N 条）
    │
    ▼
3. 调用 /api/stratix/agent/chat
   body: { message, history: [...], config }
    │
    ▼
4. LLM 基于上下文回复
    │
    ▼
5. 保存 AI 回复到 SQLite
    │
    ▼
6. 返回回复给前端展示
```

---

## 4. 数据库设计

### 4.1 表结构

```sql
CREATE TABLE IF NOT EXISTS agent_chat_messages (
  message_id    TEXT PRIMARY KEY,      -- UUID
  agent_id      TEXT NOT NULL,         -- Agent 唯一标识
  role          TEXT NOT NULL,         -- 'user' | 'assistant'
  content       TEXT NOT NULL,         -- 消息内容
  timestamp     INTEGER NOT NULL,      -- Unix timestamp (毫秒)
  created_at    INTEGER NOT NULL       -- 创建时间
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_agent_chat_agent_id
  ON agent_chat_messages(agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_chat_timestamp
  ON agent_chat_messages(agent_id, timestamp DESC);
```

### 4.2 表关系

```
agents (已有)
    │
    │ 1:N
    ▼
agent_chat_messages
    │
    └── message_id (PK), agent_id, role, content, timestamp
```

---

## 5. API 设计

### 5.1 接口列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stratix/agent/:agentId/messages` | 获取消息列表 |
| GET | `/api/stratix/agent/:agentId/messages/search` | 搜索消息 |
| POST | `/api/stratix/agent/:agentId/messages` | 保存消息 |
| DELETE | `/api/stratix/agent/:agentId/messages` | 删除消息 |

### 5.2 接口详情

#### GET /api/stratix/agent/:agentId/messages

**Query Parameters:**
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| limit | number | 20 | 限制返回条数 |
| offset | number | 0 | 偏移量（分页） |

**Response:**
```json
{
  "code": 200,
  "data": {
    "messages": [
      {
        "messageId": "uuid-xxx",
        "agentId": "agent-123",
        "role": "user",
        "content": "你好",
        "timestamp": 1710000000000
      },
      {
        "messageId": "uuid-yyy",
        "agentId": "agent-123",
        "role": "assistant",
        "content": "你好！有什么可以帮助你的吗？",
        "timestamp": 1710000001000
      }
    ],
    "total": 45,
    "hasMore": true
  }
}
```

#### GET /api/stratix/agent/:agentId/messages/search

**Query Parameters:**
| 参数 | 类型 | 说明 |
|------|------|------|
| q | string | 搜索query |

**Response:**
```json
{
  "code": 200,
  "data": {
    "messages": [...],
    "query": "Python 开发",
    "matchedKeywords": ["Python", "开发"]
  }
}
```

#### POST /api/stratix/agent/:agentId/messages

**Request Body:**
```json
{
  "role": "user",
  "content": "消息内容",
  "timestamp": 1710000000000
}
```

**Response:**
```json
{
  "code": 200,
  "data": {
    "messageId": "uuid-xxx"
  }
}
```

---

## 6. 检索实现

### 6.1 意图识别流程

```
用户输入: "找一下之前聊的 Python 爬虫问题"

    │
    ▼ LLM 意图识别
{
  "intent": "搜索历史对话",
  "keywords": ["Python", "爬虫"]
}

    │
    ▼ SQL 构建
SELECT * FROM agent_chat_messages
WHERE agent_id = ?
  AND content LIKE '%Python%'
  AND content LIKE '%爬虫%'
ORDER BY timestamp DESC
LIMIT 10
```

### 6.2 LLM 提示词

```markdown
你是一个意图识别助手。用户输入可能想要搜索历史对话。

请分析用户输入，提取 2-5 个搜索关键字。

输出格式（JSON）：
{
  "intent": "搜索" | "浏览" | "其他",
  "keywords": ["keyword1", "keyword2", ...]
}

用户输入: {user_input}
```

---

## 7. 前端实现

### 7.1 消息加载时序

```
AgentChatModal 打开 (visible = true)
    │
    ▼ onMounted
GET /api/stratix/agent/:id/messages?limit=20
    │
    ▼
messages.value = response.data.messages
    │
    ▼
渲染消息列表
```

### 7.2 发送消息时序

```
用户点击发送
    │
    ▼
1. 构造消息对象
   { role: 'user', content: inputText, timestamp: now }

2. 保存到后端
   POST /api/stratix/agent/:id/messages

3. 添加到本地 messages
   messages.value.push(userMsg)

4. 构建 history context
   history = messages.value.map(m => ({ role: m.role, content: m.content }))

5. 调用 chat API
   POST /api/stratix/agent/chat
   body: { message: inputText, history, config, systemPrompt }

6. 保存 AI 回复
   POST /api/stratix/agent/:id/messages

7. 添加 AI 回复到 messages
   messages.value.push(aiMsg)

8. 滚动到底部
```

### 7.3 UI 设计

```
┌──────────────────────────────────────┐
│  🤖 Agent 名称           [🔍] [✕]   │
├──────────────────────────────────────┤
│                                      │
│  ┌─ 加载更多历史 ─────────────────┐ │
│  │  点击加载更早的消息...          │ │
│  └─────────────────────────────────┘ │
│                                      │
│  👤 2024-03-15 14:30                │
│  你好，请帮我分析这段 Python 代码     │
│                                      │
│      ┌─ AI 回复 ─────────────────┐   │
│      │ 你好！这是一个快速排序算法，│   │
│      │ 时间复杂度是 O(n log n)    │   │
│      └────────────────────────────┘   │
│                                      │
│  👤 2024-03-15 14:32                │
│  谢谢，能优化成 O(n) 吗？            │
│      ┌─ AI 回复 ─────────────────┐   │
│      │ 要达到 O(n) 可以使用基数   │   │
│      └────────────────────────────┘   │
│                                      │
├──────────────────────────────────────┤
│  [输入消息...                    ] [➤]│
└──────────────────────────────────────┘
```

---

## 8. 后续扩展

### 8.1 向量搜索升级路径

当需要更精准的语义搜索时：

1. 添加 `sqlite-vss` 扩展
2. 新增 `agent_chat_embeddings` 表
3. 实现 Embedding 服务（调用 Ollama）
4. 搜索时优先向量检索，fallback 到关键字

### 8.2 会话管理（可选）

```sql
CREATE TABLE agent_chat_sessions (
  session_id    TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  title         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

ALTER TABLE agent_chat_messages
  ADD COLUMN session_id TEXT;
```

---

## 9. 文件清单

| 文件路径 | 操作 | 说明 |
|---------|------|------|
| `src/stratix-database/StratixDatabase.ts` | 修改 | 添加 agent_chat_messages 表 |
| `src/stratix-database/AgentChatMessageRepository.ts` | 新建 | 消息 Repository |
| `src/stratix-data-store/StratixDataStore.ts` | 修改 | 添加 chat message 方法 |
| `src/stratix-gateway/api/routes/agent.ts` | 修改 | 添加 /messages 路由 |
| `src/stratix-core/executor/StratixAgentExecutor.ts` | 修改 | 支持 history context |
| `src/components/AgentChatModal.vue` | 修改 | 加载/保存历史消息 |

---

## 10. 测试计划

### 10.1 功能测试

| 测试项 | 步骤 | 预期结果 |
|--------|------|----------|
| 消息保存 | 发送消息后刷新页面 | 消息持久化存在 |
| 历史加载 | 发送 25 条，关闭再打开 | 显示最近 20 条 |
| 上下文继承 | 发送"继续上面的代码" | AI 理解上下文 |
| 搜索功能 | 输入"Python"，点击搜索 | 返回包含 Python 的历史消息 |

### 10.2 边界测试

| 测试项 | 步骤 | 预期结果 |
|--------|------|----------|
| 空 Agent | 刚创建的 Agent 无历史 | 显示空状态 |
| 长消息 | 发送 >1000 字符消息 | 正常保存/显示 |
| 特殊字符 | 发送 `{"key": "value"}` | 正确转义存储 |

---

## 11. 附录

### 11.1 相关文档

- [Agent 设计](./agent-design.md)
- [StratixAgent 配置](./stratix-agent-config.md)

### 11.2 参考

- [LangChain Memory](https://js.langchain.com/docs/concepts/memory/)
- [SQLite FTS5](https://www.sqlite.org/fts5.html) - 可选的全文本搜索扩展
