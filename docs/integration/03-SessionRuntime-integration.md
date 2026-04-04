# SessionRuntime 深度集成方案（修订版）

> 结论：不需要新建 Manager，Gateway 已经通过 EnhancedStratixAgent 间接使用了 SessionRuntime。问题只是 transcript/usage 数据没有暴露给 Gateway。

---

## 1. 现状分析

### 1.1 实际调用链路（已接通）

```
Gateway HTTP /api/stratix/agent/chat
    → StratixAgent.chat()
        → EnhancedStratixAgent.chat()
            → this.runtime.executeTurn()    ← SessionRuntime 在这里
                → LLM 调用（经 RetryPolicyEngine）
                → transcript 持久化到 .transcripts/
                → usage 累计到 session.usage
```

**SessionRuntime 已经在工作了。** 问题不是"没接入"，而是：

1. Gateway 没有暴露 transcript/usage 数据的 API 端点
2. Gateway 的 `/agents/orchestration/*` 路径（OpenClawAgent/LLMAgent）不经过 SessionRuntime

### 1.2 两个断点

| 断点 | 说明 | 影响 |
|------|------|------|
| 数据不可见 | EnhancedStratixAgent 内部有 transcript/usage，但 Gateway 没有暴露 | 前端看不到会话历史和 token 用量 |
| 编排路径绕过 | AgentOrchestrationService 启动的 Agent 有独立循环 | 编排模式下的 session 没有被追踪 |

---

## 2. 目标状态（精简版）

不做大架构改动，只做两件事：

1. **暴露数据**：在 EnhancedStratixAgent 上加 getter，Gateway 加 2 个 API 端点
2. **编排路径可选接入**：给 AgentOrchestrationService 的 Agent 循环加上 usage 追踪（不强求走 SessionRuntime）

---

## 3. 集成方案

### 3.1 EnhancedStratixAgent 加 getter

```typescript
// src/stratix-agent/EnhancedStratixAgent.ts 新增：

/** 获取当前 session 的 transcript（最近 N 条） */
getTranscript(limit?: number): ChatMessage[] {
  return this.runtime.getRecentMessages(limit ?? 50);
}

/** 获取当前 session 的 token usage */
getUsage(): TokenUsage {
  return this.runtime.getUsage();
}

/** 获取 session ID */
getSessionId(): string {
  return this.runtime.getSessionId();
}
```

### 3.2 Gateway 加 API 端点

在 `src/stratix-gateway/api/routes/agent.ts` 新增：

```typescript
// GET /api/stratix/agent/transcript?agentId=xxx
router.get('/transcript', async (req, res) => {
  const { agentId, limit } = req.query;
  const agent = agentManager.getAgent(agentId);
  if (!agent) return res.json(requestHelper.notFound('Agent not found'));
  
  const transcript = agent.getTranscript(Number(limit) || 50);
  res.json(requestHelper.success(transcript));
});

// GET /api/stratix/agent/usage?agentId=xxx
router.get('/usage', async (req, res) => {
  const { agentId } = req.query;
  const agent = agentManager.getAgent(agentId);
  if (!agent) return res.json(requestHelper.notFound('Agent not found'));
  
  const usage = agent.getUsage();
  res.json(requestHelper.success(usage));
});
```

### 3.3 编排路径的 usage 追踪（可选）

AgentOrchestrationService 启动的 OpenClawAgent/LLMAgent 有独立循环，强行塞入 SessionRuntime 会改动太大。

**轻量方案**：在 AgentOrchestrationService 中维护一个简单的 `Map<agentId, UsageStats>`，每次 Agent 回调时累计，Gateway 通过 `/api/agents/orchestration/usage` 暴露。

---

## 4. 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/stratix-agent/EnhancedStratixAgent.ts` | 新增 3 个 getter |
| `src/stratix-agent/runtime/SessionRuntime.ts` | 确认 getRecentMessages/getUsage/getSessionId 方法存在 |
| `src/stratix-gateway/api/routes/agent.ts` | 新增 2 个 GET 端点 |

**总改动量：约 40 行代码，不涉及架构变动。**

---

## 5. 风险

| 风险 | 级别 | 说明 |
|------|------|------|
| transcript 数据量过大 | 低 | limit 参数控制返回条数 |
| Agent 未运行时无数据 | 低 | 返回空数组/零值即可 |
| 多 Agent 共享 transcript | 无 | 每个 EnhancedStratixAgent 有独立 SessionRuntime |

---

## 6. 验收标准

- [ ] `GET /api/stratix/agent/transcript?agentId=xxx` 返回最近 50 条消息
- [ ] `GET /api/stratix/agent/usage?agentId=xxx` 返回 token 用量
- [ ] Agent 未运行时返回空数据而非报错
- [ ] 测试通过
