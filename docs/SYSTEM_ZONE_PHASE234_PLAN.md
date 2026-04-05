# System Zone Phase 2-4 开发计划

> **创建时间**: 2026-04-05
> **状态**: Phase 1 ✅ 完成 → Phase 2 开发中

## 前提条件检查

- [ ] 测试覆盖率 ≥ 80%（Phase 2 启用前提）
- [ ] Guardian 熔断器验证通过
- [ ] Phase 1 全量测试通过

---

## Phase 2: Executor（代码修改能力）

### 2.1 核心能力

Executor 让 System Zone 从"只读分析"升级为"可执行修改"：
- 接收 Guardian 审批通过的提案
- 在隔离沙箱中执行代码修改
- 自动运行测试验证修改结果
- 失败时自动回滚

### 2.2 任务拆分

| Task | 内容 | 依赖 | 交付文件 |
|------|------|------|---------|
| **P2-01** | Executor 类型定义 + 执行状态机 | 无 | `executor/types.ts` |
| **P2-02** | Sandbox 隔离执行器（git worktree 沙箱） | P2-01 | `executor/Sandbox.ts` |
| **P2-03** | CodeModifier 代码修改引擎 | P2-01 | `executor/CodeModifier.ts` |
| **P2-04** | TestRunner 测试验证器 | P2-01 | `executor/TestRunner.ts` |
| **P2-05** | RollbackManager 回滚管理 | P2-02 | `executor/RollbackManager.ts` |
| **P2-06** | Executor 主类（编排 sandbox → modify → test → commit） | P2-02~05 | `executor/Executor.ts` |
| **P2-07** | Executor API 路由 + 权限增强 | P2-06 | `api/routes/executor.ts` |
| **P2-08** | Fitness 函数实现（覆盖率/复杂度/健康度） | P2-01 | `fitness/FitnessEvaluator.ts` |
| **P2-09** | 自动触发循环（从手动升级为条件触发） | P2-06, P2-08 | `SystemZone.ts` 更新 |
| **P2-10** | Executor 集成测试 | P2-06~09 | `__tests__/Executor.integration.test.ts` |

### 2.3 并行分组

```
Group A (可并行): P2-01 → P2-02, P2-03, P2-04, P2-05, P2-08
Group B (串行):   P2-06 → P2-07, P2-09 → P2-10
```

---

## Phase 3: 外部信息源自动接入

### 3.1 核心能力

- RSS/API/Webhook 自动抓取信息
- 信息去重和分类
- 与 Observer 管道对接

### 3.2 任务拆分

| Task | 内容 | 依赖 | 交付文件 |
|------|------|------|---------|
| **P3-01** | 外部信息源类型定义 + 数据库表 | 无 | `sources/types.ts`, migration |
| **P3-02** | RSS 源适配器 | P3-01 | `sources/adapters/RSSAdapter.ts` |
| **P3-03** | Webhook 接收器 | P3-01 | `sources/adapters/WebhookAdapter.ts` |
| **P3-04** | API Polling 适配器 | P3-01 | `sources/adapters/APIPollingAdapter.ts` |
| **P3-05** | 信息去重与分类引擎 | P3-01 | `sources/Deduplicator.ts` |
| **P3-06** | SourceManager（编排多个源 + 调度） | P3-02~05 | `sources/SourceManager.ts` |
| **P3-07** | 与 Observer 管道集成 | P3-06 | `Observer.ts` 更新 |
| **P3-08** | 外部源 API 路由 | P3-06 | `api/routes/sources.ts` |
| **P3-09** | Phase 3 集成测试 | P3-06~08 | `__tests__/Sources.integration.test.ts` |

### 3.3 并行分组

```
Group A (可并行): P3-01 → P3-02, P3-03, P3-04, P3-05
Group B (串行):   P3-06 → P3-07, P3-08 → P3-09
```

---

## Phase 4: 真正自举

### 4.1 核心能力

- System Zone 自主发现改进点（不依赖用户输入）
- 自主决策并执行改进
- 自我评估效果并迭代
- 进化方向引导与退化保护

### 4.2 任务拆分

| Task | 内容 | 依赖 | 交付文件 |
|------|------|------|---------|
| **P4-01** | 自举决策引擎类型 + 状态机 | 无 | `bootstrap/types.ts` |
| **P4-02** | 改进发现引擎（自主扫描 + 提案生成） | P4-01 | `bootstrap/DiscoveryEngine.ts` |
| **P4-03** | 决策引擎（风险/收益评估 + 自动审批） | P4-01 | `bootstrap/DecisionEngine.ts` |
| **P4-04** | 效果评估器（对比 before/after metrics） | P4-01 | `bootstrap/ImpactEvaluator.ts` |
| **P4-05** | 退化保护（性能/质量不能下降） | P4-01 | `bootstrap/RegressionGuard.ts` |
| **P4-06** | Bootstrap 主类（完整自主循环） | P4-02~05 | `bootstrap/BootstrapEngine.ts` |
| **P4-07** | 实验区 Zone 管理 | P4-06 | `bootstrap/ExperimentZone.ts` |
| **P4-08** | 自举 API 路由 + 手动/自动模式切换 | P4-06 | `api/routes/bootstrap.ts` |
| **P4-09** | Phase 4 端到端测试 | P4-06~08 | `__tests__/Bootstrap.e2e.test.ts` |

### 4.3 并行分组

```
Group A (可并行): P4-01 → P4-02, P4-03, P4-04, P4-05
Group B (串行):   P4-06 → P4-07, P4-08 → P4-09
```

---

## 总任务统计

| Phase | 任务数 | 可并行高峰 |
|-------|--------|-----------|
| Phase 2 | 10 | 5 |
| Phase 3 | 9 | 4 |
| Phase 4 | 9 | 4 |
| **总计** | **28** | - |

## 执行策略

1. **Phase 2 第一批**（4-5 个并行 agent）：P2-01 先行，然后 P2-02/03/04/05/08 并行
2. **Phase 2 第二批**（2-3 个并行 agent）：P2-06 → P2-07/09 并行 → P2-10
3. **Phase 3 第一批**：P3-01 → P3-02/03/04/05 并行
4. **Phase 3 第二批**：P3-06 → P3-07/08 并行 → P3-09
5. **Phase 4 第一批**：P4-01 → P4-02/03/04/05 并行
6. **Phase 4 第二批**：P4-06 → P4-07/08 并行 → P4-09
