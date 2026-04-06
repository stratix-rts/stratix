# System Zone 代码 Review 计划

> 创建时间: 2026-04-06
> 范围: 最近 3 天 System Zone 相关 commit（80+ commits）
> 方法: 按模块拆分，每个 task 由一个 agent 执行，边改边测边提交

---

## Review 原则

1. **读代码为主，不只是看 diff** — agent 必须读完整文件，理解上下文
2. **最小改动** — 只修 bug 和明显问题，不重构不新功能
3. **每个 agent 负责一个模块**，模块间文件不交叉
4. **改完必须编译验证**（`npx tsc --noEmit`，timeout 90s）
5. **不改测试文件**（本轮只审生产代码）

## Review 维度

每个 task 检查以下维度：
- **类型安全**: any/类型断言滥用、interface 与实际数据不匹配
- **错误处理**: 空 catch、异常吞没、未处理的 Promise rejection
- **边界条件**: null/undefined 检查、空数组、空字符串
- **逻辑正确性**: 条件判断、状态管理、数据流
- **资源管理**: 未关闭的连接/流、定时器泄漏、事件监听器未移除
- **代码风格**: 命名一致性、export 规范、import 顺序

---

## Task 分配

### T1: strategist 模块 (10 files)
**Agent**: Agent-1
**文件**:
- `strategist/ProjectScanner.ts` — 并行三扫，regex 解析，spawn 子进程
- `strategist/ProposalMapper.ts` — 扫描结果映射到 Proposal
- `strategist/Strategist.ts` — 主编排器
- `strategist/StrategistLLMEnhancer.ts` — LLM 增强，prompt 构建，响应解析
- `strategist/types.ts` — 类型定义
- `strategist/index.ts` — 导出

**Review 重点**:
- [ ] ProjectScanner: spawn 子进程是否正确处理 stderr？超时后是否清理子进程？
- [ ] ProjectScanner: regex 解析的边界情况（多行错误、编码问题）
- [ ] StrategistLLMEnhancer: LLM 响应解析的健壮性（JSON 格式变化、字段缺失）
- [ ] StrategistLLMEnhancer: parseEnrichResponse 中 effortMap/riskMap 的 fallback 是否合理
- [ ] ProposalMapper: 空扫描结果的处理
- [ ] types: Proposal 类型是否与实际 API 返回一致

**状态**: pending
**Commit**: -

---

### T2: observer 模块 (9 files)
**Agent**: Agent-2
**文件**:
- `observer/InputPreprocessor.ts` — 规则预处理
- `observer/InsightExtractor.ts` — LLM 洞察提取
- `observer/Observer.ts` — 主编排器，串联输入预处理 + LLM 分析
- `observer/types.ts` — Insight 类型定义
- `observer/index.ts` — 导出

**Review 重点**:
- [ ] InputPreprocessor: 规则解析的健壮性（格式错误的规则文件）
- [ ] InsightExtractor: LLM 调用的错误恢复
- [ ] Observer: 外部数据源集成时数据流向是否正确
- [ ] types: Insight 类型字段是否完整

**状态**: pending
**Commit**: -

---

### T3: executor + fitness 模块 (14 files)
**Agent**: Agent-3
**文件**:
- `executor/Executor.ts` — 主编排器
- `executor/CodeModifier.ts` — 代码修改
- `executor/Sandbox.ts` — git worktree 沙箱隔离
- `executor/TestRunner.ts` — 测试执行
- `executor/RollbackManager.ts` — 回滚管理
- `executor/types.ts`
- `executor/index.ts`
- `fitness/FitnessEvaluator.ts` — 健康度评估
- `fitness/types.ts`
- `fitness/index.ts`

**Review 重点**:
- [ ] Sandbox: git worktree 创建/清理是否成对？异常时 worktree 是否泄漏？
- [ ] TestRunner: 测试进程超时后是否清理？
- [ ] RollbackManager: 回滚操作本身的错误处理
- [ ] Executor: 生命周期管理（run → test → commit/rollback 串联）
- [ ] FitnessEvaluator: 评分算法的边界（全 0 分、NaN 防护）
- [ ] executor types: 状态枚举是否覆盖所有情况

**状态**: pending
**Commit**: -

---

### T4: bootstrap + guardian + sources 模块 (21 files)
**Agent**: Agent-4
**文件**:
- `bootstrap/BootstrapEngine.ts` — 自举引擎，cycle 管理
- `bootstrap/DecisionEngine.ts` — 自动决策
- `bootstrap/DiscoveryEngine.ts` — 自动发现
- `bootstrap/ExperimentZone.ts` — 实验隔离
- `bootstrap/ImpactEvaluator.ts` — 影响评估
- `bootstrap/RegressionGuard.ts` — 回归防护
- `bootstrap/types.ts`
- `bootstrap/index.ts`
- `guardian/CircuitBreaker.ts` — 熔断器
- `guardian/Guardian.ts` — 守卫主入口
- `guardian/PathProtection.ts` — 路径保护
- `guardian/PermissionMatrix.ts` — 权限矩阵
- `guardian/index.ts`
- `sources/SourceManager.ts` — 外部源管理
- `sources/Deduplicator.ts` — 去重
- `sources/adapters/` — RSS/API Polling/Webhook 适配器
- `sources/types.ts`
- `sources/index.ts`

**Review 重点**:
- [ ] BootstrapEngine: cycle 超时/中断时状态恢复
- [ ] DecisionEngine: 自动审批的边界（空 proposal、权限不足）
- [ ] CircuitBreaker: 半开状态下的流量控制
- [ ] PermissionMatrix: 权限检查的默认策略（deny-all vs allow-all）
- [ ] SourceManager: 外部源连接失败的重试/降级
- [ ] Deduplicator: 去重算法的正确性（哈希冲突、时间窗口）

**状态**: pending
**Commit**: -

---

### T5: API 层 + Store + UI composables (合并 review，轻量)
**Agent**: 主会话自行处理（文件少且改动分散）
**文件**:
- `api/auth/` — 认证
- `api/routes/` — API 路由
- `ui/composables/` — Vue composables
- `ui/logger.ts` — 日志
- `SystemZone.ts` — 主入口
- `types.ts` — 全局类型

**状态**: pending
**Commit**: -

---

## 进度

| Task | 状态 | Agent | Commit |
|------|------|-------|--------|
| T1 strategist | ✅ done | keen-pine | d1d6633 |
| T2 observer | ✅ done | amber-seaslug | 5e91c55 |
| T3 executor+fitness | ✅ done | tidal-tidepool | ba91b00 |
| T4 bootstrap+guardian+sources | ✅ done | tide-shell | 2830cb5 |
| T5 api+store+composables | ✅ done | 主会话 | 无需修改 |

---

## 完成标准

- 所有 5 个 task 完成 review
- 发现的问题全部修复并 commit
- `npx tsc --noEmit` 通过
- 更新此文件状态
