# Zone & StratixAgent 执行管道修复与优化设计

**版本**: v1.0  
**日期**: 2026-04-27  
**状态**: 待评审  
**关联文档**:
- `docs/SYSTEM_ZONE_AGENT_REDESIGN.md`
- `docs/SZ_AGENT_REDESIGN_TASKS.md`
- `docs/ZONE_DESIGN.md`
- `docs/STRATIX_AGENT_DESIGN.md`

---

## 0. 设计原则

1. **管道优先** — 先打通数据流和调用链，再优化实现细节。
2. **当前实现为准** — 不引入新框架，在现有文件和接口上修补断裂点。
3. **最小侵入** — 新增字段用 `?` 可选；新增方法用组合而非继承。
4. **可验证** — 每个 Phase 结束必须有明确验证标准。
5. **先通后优** — 先让功能跑通，再拆分 God Class。

---

## 1. 现状诊断

### 1.1 核心断裂点总览

```
管道1: Agent 驱动
  SystemZoneManager 创建 4 个 StratixAgent ✅
  SystemZone.ts 直接调用原生模块，绕过 Agent ❌

管道2: 代码修改传递
  StrategistLLMEnhancer 输出 codeSuggestion（文本）
  BootstrapEngine.convertToExecutorProposal() 不转换 modifications
  Executor.buildModificationPlan() 读到空数组
  沙箱不改代码 → 空 commit → 伪成功 ❌

管道3: 任务分发执行
  ZoneCoordinator.delegateTask() 写数据库状态
  没有通知 Agent 的机制
  Agent 不知道有任务 → 永远 delegated ❌
```

### 1.2 架构层断裂

| 设计预期 | 当前实现 | 断裂表现 |
|---------|---------|---------|
| SystemZone 由 ZoneCoordinator 协调 | SystemZone 与 ZoneCoordinator 完全独立 | 成员管理、审计日志各走各的 |
| 4 个角色是 StratixAgent 实例 | SystemZoneManager 创建了 Agent，但 SystemZone.ts 不用 | Soul、Memory、Skill 全部闲置 |
| Agent 通过 skill 协议与 Zone 交互 | 直接调用 `.processAll()` / `.analyze()` | task_delegate/task_complete 未落地 |

### 1.3 管理层断裂

- `src/stratix-systemzone/api/routes/systemzone.ts` 自己维护一套 Observer/Strategist/Guardian/Executor 实例（内存 Map）
- `SystemZoneManager` 初始化了另一套 Agent + ZoneCoordinator + SkillExecutor
- 两套实例互不引用，路由层完全不使用 SystemZoneManager

---

## 2. 目标架构

### 2.1 修复后执行全景

```
┌──────────────────────────────────────────────────────────────┐
│                         System Zone                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                    ZoneCoordinator                       │ │
│  │  processRequirement → decompose → match → delegate      │ │
│  │  receiveTaskReport → update state → trigger cycle       │ │
│  └─────────────────────────────────────────────────────────┘ │
│         │ task_delegated event                                 │
│         ▼                                                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │               AgentTaskDispatcher                       │ │
│  │  订阅事件，调用 Agent.executeSkill()                    │ │
│  └────────────────────────────────────────────────────────┘ │
│         │ executeSkill(skillId, params)                      │
│         ▼                                                    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐  │
│  │Observer │ │Strategist│ │Guardian │ │   Executor      │  │
│  │ Agent   │ │ Agent   │ │ Agent   │ │   Agent         │  │
│  │ observe_│ │ scan_   │ │ review_ │ │   apply_diff    │  │
│  │  input  │ │ project │ │modifications│  run_tests   │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────────────┘  │
│         │          │          │          │                  │
│         └──────────┴──────────┴──────────┘                  │
│                      │                                       │
│         SystemZoneSkillExecutor（统一 executor）              │
│                      │                                       │
│         ┌────────────┼────────────┐                         │
│         ▼            ▼            ▼                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                  │
│  │ Observer │ │Strategist│ │ Executor │                  │
│  │ 模块(现有)│ │ 模块(现有)│ │ 模块(现有)│                  │
│  └──────────┘ └──────────┘ └──────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Phase 设计

### Phase 1：打通 Agent 驱动管道（P0）

**目标**：`SystemZone` 通过 `StratixAgent` skill 系统调用子模块，不再直接调用原生模块。

**改动文件**：
- `src/stratix-systemzone/SystemZoneManager.ts` — 完善 SkillExecutor 模块注入
- `src/stratix-systemzone/SystemZone.ts` — `observe()` / `analyze()` / `approveProposal()` 改为 Agent skill 调用
- `src/stratix-systemzone/agents/{observer,strategist,executor,guardian}.ts` — 确保 skill 参数匹配
- `src/stratix-agent/core/SystemZoneSkillExecutor.ts` — 补全注入后的 skill 实现

**关键改动**：

`SystemZoneManager` 同时持有原生模块和 Agent 实例，将原生模块注入 `SystemZoneSkillExecutor`：

```typescript
this.skillExecutor.injectModules({
  observer: observerModule,
  projectScanner: strategistModule.getScanner(),
  strategistLLM: strategistModule.getEnhancer(),
  diffApplier: this.diffApplier,
  testRunner: executorModule.getTestRunner(),
  sandbox: executorModule.getSandbox(),
  rollbackManager: executorModule.getRollbackManager(),
  codeModifier: executorModule.getCodeModifier(),
  pathProtection: guardianModule.getPathProtection?.() ?? new PathProtection(),
});
```

`SystemZone` 增加 `useAgentMode` 开关，内部通过 Agent 调用：

```typescript
async observe(): Promise<Insight[]> {
  if (this.useAgentMode && this.agents?.observer) {
    const result = await this.agents.observer.executeSkill('observe_input', {
      content: this.getPendingInputsSummary(), source: 'system-zone', type: 'analysis',
    });
    return result.result as Insight[];
  }
  // fallback: 原有直接调用
  return this.observer.processAll();
}
```

**验收标准**：
- [ ] Agent skill execution 日志有输出
- [ ] LLM 被调用并返回含 `modifications` 的 JSON
- [ ] `useAgentMode=false` 时原有逻辑不变
- [ ] `npx tsc --noEmit` 编译通过

---

### Phase 2：修复代码修改执行管道（P0）

**目标**：`modifications`（unified diff）从 Strategist → 传递到 Executor → 应用到沙箱。

**改动文件**：
- `src/stratix-systemzone/strategist/StrategistLLMEnhancer.ts` — prompt 要求输出 `modifications` 数组
- `src/stratix-systemzone/bootstrap/BootstrapEngine.ts` — `convertToExecutorProposal()` 补全 `modifications`
- `src/stratix-systemzone/executor/Executor.ts` — 无需修改

**关键改动**：

`ENRICH_PROPOSAL_PROMPT` 改造后要求 LLM 输出：

```json
{
  "title": "...",
  "description": "...",
  "modifications": [
    {
      "type": "edit",
      "path": "src/example.ts",
      "diff": "--- a/src/example.ts\n+++ b/src/example.ts\n@@ ...",
      "description": "修复 xxx"
    }
  ],
  "riskLevel": "...",
  "effortEstimate": "...",
  "reasoning": "..."
}
```

`enrichProposal()` 将 `modifications` 挂到返回的 `Proposal` 上。`BootstrapEngine` 转换时传递该字段。

**验收标准**：
- [ ] `enrichProposal()` 返回的 `Proposal.modifications.length > 0`
- [ ] `Executor.buildModificationPlan()` 读到非空数组
- [ ] 沙箱文件确实被修改，commit 非空

---

### Phase 3：打通 ZoneCoordinator 任务循环（P0）

**目标**：任务分派后 Agent 能执行；任务完成后触发下一轮 cycle。

**改动文件**：
- `src/stratix-systemzone/AgentTaskDispatcher.ts` — **新增**，订阅 ZoneCoordinator 事件，驱动 Agent
- `src/stratix-systemzone/SystemZoneManager.ts` — 实例化并启动 AgentTaskDispatcher
- `src/stratix-systemzone/index.ts` — 导出 AgentTaskDispatcher

**关键设计**：

`AgentTaskDispatcher` 订阅 `ZoneCoordinatorEventEmitter` 的 `task_delegated` 事件，匹配 `agentId` 后调用对应 Agent 的 `executeSkill()`，完成后回调 `ZoneCoordinator.receiveTaskReport()`。

```typescript
export class AgentTaskDispatcher {
  start(): void {
    const emitter = ZoneCoordinatorEventEmitter.getInstance();
    emitter.on((event: any) => {
      if (event.type === 'task_delegated' && event.zoneId === this.coordinator.zoneId) {
        this.handleTaskDelegated(event.taskId, event.agentId, event.task);
      }
    });
  }

  private async handleTaskDelegated(taskId: string, agentId: string, task: any) {
    const agent = this.resolveAgent(agentId);
    const skillId = this.mapTaskToSkill(task.type, task.title);
    const result = await agent.executeSkill(skillId, { taskId, ...task });
    await this.coordinator.receiveTaskReport({
      taskId, success: result.success, output: JSON.stringify(result.result),
    });
  }
}
```

**验收标准**：
- [ ] `createManualTask()` + assignee 后 1 秒内触发 Agent 执行
- [ ] 任务完成后状态变为 `completed` / `failed`
- [ ] 所有任务完成后 `checkAndTriggerCycle()` 被调用
- [ ] `audit_log` 和 `task_flow` 有完整记录

---

### Phase 4：统一 API 路由层与业务层（P1）

**目标**：消除 `systemzone.ts` 路由的双轨制。

**改动文件**：
- `src/stratix-systemzone/api/routes/systemzone.ts` — 删除内存 Map，委托给 SystemZoneManager
- `src/stratix-systemzone/SystemZoneManager.ts` — 添加单例 getter

**关键改动**：

```typescript
let globalSystemZoneManager: SystemZoneManager | null = null;
export function getSystemZoneManager(): SystemZoneManager {
  if (!globalSystemZoneManager) globalSystemZoneManager = new SystemZoneManager();
  return globalSystemZoneManager;
}
```

路由层改造：`getObserver(ownerId)` → `getSystemZoneManager().getSystemZone().observe()`

**验收标准**：
- [ ] 路由中不存在 `new Observer()` / `new Strategist()` 等直接实例化
- [ ] API 重启后 DB 能恢复 insights / proposals
- [ ] E2E 测试通过

---

### Phase 5：StratixAgent 代码质量优化（P1）

**目标**：拆分 God Class、消除循环依赖、替换动态 require。

**改动文件**：
- `src/stratix-agent/EnhancedStratixAgent.ts` — 拆分，行数目标 < 500
- `src/stratix-agent/core/WorkflowExecutor.ts` — **新增**
- `src/stratix-agent/core/ReflectionManager.ts` — **新增**
- `src/stratix-agent/core/EvolutionManager.ts` — **新增**
- `src/stratix-agent/core/TaskQueuePoller.ts` — **新增**，替代动态 require
- `src/stratix-core/types/agent-shared.ts` — **新增**，共享类型消除循环依赖

**验收标准**：
- [ ] `EnhancedStratixAgent.ts` 行数 < 500
- [ ] 无循环依赖报错
- [ ] 无动态 `require()`
- [ ] 现有测试全部通过

---

## 4. 实施顺序

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
```

- Phase 2 依赖 Phase 1（modifications 需通过 Agent skill 传递）
- Phase 3 依赖 Phase 1（AgentTaskDispatcher 需要 Agent 已注册 skill）
- Phase 4 依赖 Phase 3（路由层统一后需 AgentTaskDispatcher 驱动任务）
- Phase 5 可独立，建议最后做

---

## 5. 风险与回滚

| 风险 | 缓解措施 |
|-----|---------|
| LLM 调用次数增加 | 复用 Strategist scan 缓存 |
| `useAgentMode` 分支复杂度 | 验证后移除开关 |
| Prompt 输出格式不稳定 | 保留 `parseModificationPlan` 容错逻辑 |

**回滚**：每个 Phase 单独分支；`useAgentMode` 可切回直接调用；`AgentTaskDispatcher.stop()` 随时启停。

---

## 6. 变更日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-04-27 | v1.0 | 初始版本，基于代码审查输出 |
