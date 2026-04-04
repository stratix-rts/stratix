# CommandOrchestrator 深度集成方案（修订版）

> 结论：CommandOrchestrator 已经基本接好了。它定位为"命令发现"，CommandTransformer 定位为"命令执行"。当前不需要替代 CommandTransformer。

---

## 1. 现状分析

### 1.1 实际链路（已经接通）

```
Gateway HTTP POST /api/stratix/command/execute
    │
    ├─→ 命令注册（一次性）：
    │   CommandSourceAdapter.registerAgentCommands(agentConfig)
    │   → 遍历 skills，注册到 CommandOrchestrator    ← ✅ 已接入
    │
    ├─→ 命令发现：
    │   GET /api/stratix/command/commands?agentId=xxx
    │   → commandSourceAdapter.getOrchestrator().getCommands()  ← ✅ 已接入
    │
    └─→ 命令执行：
        commandTransformer.transformAndExecute(command, agentConfig)
        → ExecutorFactory.getExecutor()
        → executor.execute()                             ← CommandOrchestrator 不参与

Gateway HTTP GET /api/stratix/command/commands
    → commandSourceAdapter.getOrchestrator().getCommandNames()  ← ✅ 已接入
```

**CommandOrchestrator 不是死代码**——它被 CommandSourceAdapter 用于命令注册和发现。只是**执行路径**不经过它，这是正确的设计：

- **CommandOrchestrator**：统一命令注册、发现、过滤（做什么命令）
- **CommandTransformer**：协议转换、参数验证（怎么执行命令）
- **ExecutorFactory**：选择执行器（在哪执行）

### 1.2 真正的问题

| 问题 | 说明 |
|------|------|
| 命名误导 | "Orchestrator" 暗示它管执行，实际只管发现 |
| 每请求新建 | `command.ts` 每次请求创建新的 CommandSourceAdapter + Orchestrator |
| 注册遗漏 | 只在 `/execute` 路由注册，其他路由（如 chat）没注册 |

---

## 2. 目标状态（微调）

**不替代 CommandTransformer**。只做三件小事：

1. 明确 CommandOrchestrator 的定位和命名
2. 解决每请求新建问题
3. 确保所有命令路由都注册

---

## 3. 集成方案

### 3.1 解决每请求新建问题

`command.ts` 当前在模块顶层创建实例，实际上是单例。确认：

```typescript
// command.ts — 当前已经是模块级单例，没问题
const commandTransformer = new CommandTransformer();
const commandSourceAdapter = new CommandSourceAdapter(commandTransformer);
```

这已经是正确的——Node.js 模块只加载一次，所以是进程级单例。

### 3.2 确认命令注册覆盖

当前只在 `POST /execute` 路由中注册 agent commands。如果 `/chat` 等路由也需要命令发现，需要在那里也调用注册。

检查 `/chat` 路由是否需要命令发现：如果 chat 通过 ToolUseLoop 使用 skills，那么 skills 注册应该在 Agent 创建时做，而不是请求时。

### 3.3 文档/注释修正

在 CommandOrchestrator.ts 顶部加注释明确职责：

```typescript
/**
 * CommandOrchestrator - 命令发现与注册中心
 * 
 * 职责：统一注册和发现来自多个来源的命令（skill/plugin/workflow）
 * 不负责：命令执行（由 CommandTransformer + ExecutorFactory 负责）
 */
```

---

## 4. 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/stratix-core/command/CommandOrchestrator.ts` | 加职责注释 |
| `src/stratix-core/command/CommandSourceAdapter.ts` | 加桥接职责注释 |
| `src/stratix-gateway/api/routes/command.ts` | 确认单例无问题（已确认） |

**总改动量：约 10 行注释，无功能变更。**

---

## 5. 验收标准

- [x] CommandOrchestrator 被 CommandSourceAdapter 引用（已确认）
- [x] 命令发现 API 正常工作（已确认）
- [ ] 职责注释已添加
- [ ] 测试通过
