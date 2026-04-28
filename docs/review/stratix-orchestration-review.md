# stratix-orchestration 模块评审报告

## 概览

**模块路径**: `src/stratix-orchestration/`
**文件数量**: 18 个文件，5 个子目录
**核心职责**: Zone 的协调大脑，处理需求分解、任务分配、上下文管理、Agent 消息路由和后台任务执行。

### 关键子模块

| 子模块 | 文件 | 职责 |
|--------|------|------|
| **ZoneCoordinator** | `zone/ZoneCoordinator.ts` | Zone 协调核心，需求分解 + 任务分派 + 周期执行 |
| **TaskQueueService** | `task-queue/TaskQueueService.ts` | 任务队列（内存 + DB 持久化） |
| **ContextManager** | `context/ContextManager.ts` | 多层上下文管理 |
| **AgentMessageRouter** | `messaging/AgentMessageRouter.ts` | Agent 间消息路由 |
| **BackgroundAgentService** | `background/BackgroundAgentService.ts` | 后台 Agent 进程管理 |
| **ZoneManager** | `zone/ZoneManager.ts` | Zone 生命周期管理 |

---

## 代码质量

### ZoneCoordinator — `processRequirement` 无事务性

- `src/stratix-orchestration/zone/ZoneCoordinator.ts:374-479`
- `processRequirement` 中：部分任务被存入 `pendingTasks` 并持久化到 DB（L409-412），但若后续 `delegateTask` 失败，已入队的任务不会回滚。若 `auditLogRepository.log` 失败，整个流程继续不报错。
- **建议**：整个流程应在一个事务中，或实现补偿机制（compensating transactions）

### ZoneCoordinator — LLM 调用 API Key 在 header 中明文传递

- `src/stratix-orchestration/zone/ZoneCoordinator.ts:528-529`:
  ```typescript
  ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
  ```
- API Key 若日志开启会打印 header，存在泄露风险。

### ZoneCoordinator — Anthropic API URL 和 body 格式双重错误

- `src/stratix-orchestration/zone/ZoneCoordinator.ts:593-598`:
  ```typescript
  case 'anthropic':
    return {
      url: this.config.baseUrl || 'https://api.anthropic.com/v1/messages',
      // ...
    };
  ```
- Anthropic API 的 `/v1/messages` 需要 `{ model, messages, max_tokens }` 格式，但 `callLLM` 的 body 构造用的是 OpenAI 格式（`messages: [...]`），不遵循 Anthropic 规范。实际调用 Anthropic 会返回格式错误。

### ZoneCoordinator — `decomposeRequirement` 实为存根

- `src/stratix-orchestration/zone/ZoneCoordinator.ts:484-501`
- 注释说 "使用 LLM"，实际调用了 `callLLM`，但有 fallback 返回单一大任务。真正的 LLM 分解逻辑在 `parseTaskItems` 中，但从未被端到端测试验证。

### TaskQueueService — 单例滥用 + 内存池与 DB 可能不一致

- `src/stratix-orchestration/task-queue/TaskQueueService.ts:26-40`
- `zoneTaskPools: Map<string, string[]>` 在内存维护待执行任务池，但 DB 有 `tasks` 表。`addToZonePool` / `removeFromZonePool` 修改内存池，若 crash 或并发修改，两者会漂移。

### TaskQueueService — `getTasksByAgent` 双重数据源

- `src/stratix-orchestration/task-queue/TaskQueueService.ts:133-173`
- 同时查 `tasks` 表和 `task_flow` 表来获取 agent 任务。`task_flow` 是审计日志，但被当作任务源使用，说明 `tasks` 表的状态同步可能不及时。

### TaskQueueService — `requeueAbandonedTasks` 依赖可能不存在的表

- `src/stratix-orchestration/task-queue/TaskQueueService.ts:325`:
  ```sql
  LEFT JOIN agent_backgrounds ab ON t.assigned_agent_id = ab.agent_id
  ```
- `agent_backgrounds` 表若不存在，SQL 会报错。需确认 schema 迁移包含此表。

### ZoneManager — 动态 `require()` 导入

- `src/stratix-orchestration/zone/ZoneManager.ts:45`:
  ```typescript
  const { TaskQueueService } = require('../task-queue/TaskQueueService');
  ```
- 使用动态 `require()` 而非顶层 import，可能有路径问题。建议顶层 import。

### `any` 类型滥用

- `ZoneManager.ts:38`: `private taskQueueService: any = null;`
- `BackgroundAgentService.ts:21`: `private globalListeners: ((event: any) => void)[] = [];`

---

## 安全

### 权限检查可被绕过

- `ZoneCoordinator.checkPermission`（L1319-1338）在多数方法中调用，但 `processRequirement` 和 `getStatusSummary` **没有**调用权限检查。任何调用者都可以处理 requirement 和获取 zone 状态。

### LLM Prompt 注入风险

- `buildSystemPrompt`（L695-743）将 `this.title` 和 `this.prompt` 直接插入 system prompt，若 `zone.prompt` 来自用户输入且包含特殊格式，可能干扰 LLM JSON 输出解析。

### API Key 环境变量未校验

- `getLLMConfig` 从 `process.env.OPENAI_API_KEY` 等直接读取，无验证，若 env 未设置会传 `null` 给 LLM API（导致认证失败，但不会暴露 key）。

---

## 性能

### `zoneTaskPools` 优先级排序在每次 `addToZonePool` 时触发

- `src/stratix-orchestration/task-queue/TaskQueueService.ts:402-408`
- 每次加入新任务都重新排序整个池，当池很大时（100+ 任务）有 O(N log N) 开销。

### TaskQueueService 无分页

- `getTasksByZone` 返回所有任务，无分页。1000+ 任务时会有性能问题。

### ZoneCoordinator 循环无最大并发限制

- `executeCycle`（L329）设置 `setTimeout` 后异步执行下一次循环，无最大并发限制。

---

## 架构

### ZoneCoordinator 职责过重

- 1457 行的巨型类，涵盖：周期管理 + LLM 调用 + 任务分解 + 5 种分配策略 + 权限检查 + DB 持久化 + 审计日志 + 事件发布。建议拆分：`CycleManager`、`LLMClient`、`TaskAssigner`、`ZonePersistence`。

### 直接依赖 Repository，无法 mock

- `ZoneCoordinator` 直接 import `zoneRepository`、`taskFlowRepository`、`auditLogRepository` 等，而非通过接口注入。使其与数据库实现强耦合，单测必须使用真实数据库或完整的 mock。

### 依赖方向

```
ZoneCoordinator
  ├── zoneRepository (stratix-database)
  ├── taskFlowRepository (stratix-database)
  ├── auditLogRepository (stratix-database)
  ├── agentCapabilityRepository (stratix-database)
  ├── zoneCoordinatorConfigRepository (stratix-database)
  ├── ZoneCoordinatorEventEmitter
  └── PermissionOrchestrator (stratix-core)

TaskQueueService
  └── getDatabase() (stratix-database)
```

---

## 测试

- **完全没有测试文件**。`src/stratix-orchestration/` 下无任何 `.spec.ts`。
- 关键逻辑如 5 种任务分配策略、`processRequirement` 的事务性、`parseTaskItems` 的 JSON 解析容错性，完全无验证。

---

## 改进建议（按优先级）

### P0 — 必须修复

1. **修复 Anthropic API 调用格式**
   - `ZoneCoordinator.ts:593-598` — Anthropic 需要独立的 body 格式，不能复用 OpenAI 的 body
   - 建议分离 `callOpenAILLM` 和 `callAnthropicLLM`

2. **为 `processRequirement` 添加权限检查**
   - `processRequirement` 和 `getStatusSummary` 缺少 `checkPermission` 调用

3. **实现 LLM 响应验证**
   - `parseTaskItems` 对 LLM 返回的 JSON 无结构验证，直接信任
   - 建议用 Zod schema 验证 LLM 返回

### P1 — 强烈建议

4. **将 `ZoneCoordinator` 拆分为多个类**
   - 1457 行巨型类，建议拆为：`CycleManager`、`TaskDecomposer`、`TaskAssigner`、`ZonePersistence`

5. **解决 TaskQueueService 单例和内存池/DB 一致性**
   - 改为接受 `Database` 实例的构造函数注入
   - 确保 `zoneTaskPools` 和 `tasks` 表始终同步

6. **`getTasksByAgent` 的数据来源混乱**
   - 同时读 `tasks` 表和 `task_flow` 表，建议统一以 `tasks` 表为单一数据源

### P2 — 建议改进

7. **添加任务池排序优化**
   - 当前每次 `addToZonePool` 都全量排序，改为在 `dequeueTask` 时取最大优先级（或使用优先队列）

8. **确认 `agent_backgrounds` 表存在**
   - `requeueAbandonedTasks` 依赖此表

9. **补充单元测试**
   - 至少覆盖：5 种分配策略的边界情况、`parseTaskItems` 容错

10. **移除 `any` 类型**
    - `ZoneManager.ts:38`、`BackgroundAgentService.ts:21` — 定义具体接口类型替代
