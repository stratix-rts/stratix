# System Zone Agent 化重设计 — 开发任务

**基于**: `docs/SYSTEM_ZONE_AGENT_REDESIGN.md` v1.0  
**创建时间**: 2026-04-06 14:55  
**状态**: 待开始  

---

## 总览

| Phase | 名称 | Task 数 | 依赖 |
|-------|------|---------|------|
| A | 基础设施 | 5 | 无 |
| B | 核心链路 | 4 | Phase A |
| C | 协作流程 | 3 | Phase B |
| D | UI 适配 | 2 | Phase C |

**总计 14 个 Task**

---

## Phase A：基础设施

### A1. Proposal 类型扩展
- **文件**: `src/stratix-systemzone/types.ts`
- **做什么**: 在 Proposal interface 中增加 `modifications`、`safetyAssessment`、`DiffHunk`、`DiffLine`、`FileModification`（新）、`SafetyAssessment`（新）类型定义
- **具体改动**:
  1. 新增 `DiffHunk` interface（oldStart, oldLines, newStart, newLines, header, lines）
  2. 新增 `DiffLine` interface（type: context/add/remove, content）
  3. 新增 `SystemZoneFileModification` interface（type, path, diff?, hunks?, content?, newPath?, description）— 用不同名字避免和 executor/types.ts 的 FileModification 冲突
  4. 新增 `SafetyAssessment` interface（approved, riskLevel, concerns, suggestions, confidence）
  5. 在 Proposal interface 增加 `modifications?: SystemZoneFileModification[]` 和 `safetyAssessment?: SafetyAssessment`
- **验收标准**:
  - [ ] TypeScript 编译通过（`npx tsc --noEmit`）
  - [ ] 不破坏现有代码（modifications 是可选字段）
  - [ ] 新类型可被 executor/types.ts 的 FileModification 兼容或可映射
- **验证**: `cd ~/code/Stratix && npx tsc --noEmit 2>&1 | head -20`

### A2. SystemZoneSkillExecutor 注册
- **文件**: `src/stratix-agent/core/SkillExecutors.ts`（新增 SystemZoneSkillExecutor 类 + 注册到 createExecutor）
- **新建文件**: `src/stratix-agent/core/SystemZoneSkillExecutor.ts`
- **做什么**:
  1. 新建 `SystemZoneSkillExecutor` 类，实现 `SkillExecutor` 接口
  2. 按 skillId 分派到 System Zone 内部模块：
     - `observe_input` → `Observer.processInput()`
     - `scan_project` → `ProjectScanner.scanAll()`
     - `generate_modifications` → `StrategistLLMEnhancer.enrichProposal()`
     - `validate_diff` → `DiffApplier.validateDiff()`（Phase B 才实现，先写接口）
     - `apply_diff` → `DiffApplier.applyDiff()`（Phase B 才实现，先写接口）
     - `run_tests` → `TestRunner.runTests()`
     - `create_sandbox` → `Sandbox.createSandbox()`
     - `destroy_sandbox` → `Sandbox.destroySandbox()`
     - `rollback` → `RollbackManager.rollback()`
  3. 在 `createExecutor()` switch 中注册 `'systemzone'` type
  4. 构造函数接收 System Zone 各模块实例（通过 setter 或 init 方法延迟注入，因为模块实例化顺序问题）
- **验收标准**:
  - [ ] TypeScript 编译通过
  - [ ] `createExecutor('systemzone')` 返回 SystemZoneSkillExecutor 实例
  - [ ] 每个 skillId 有对应的处理分支
- **验证**: `npx tsc --noEmit`

### A3. DiffApplier 骨架（替换 CodeModifier）
- **文件**: `src/stratix-systemzone/executor/DiffApplier.ts`（新建）
- **保留**: `CodeModifier.ts` 不删除，作为过渡期保留
- **做什么**:
  1. 新建 `DiffApplier` 类，提供以下方法：
     - `validateDiff(workDir: string, diff: string): Promise<{ valid: boolean; errors: string[] }>` — 用 `git apply --check` 验证
     - `applyDiff(workDir: string, diff: string): Promise<{ success: boolean; appliedFiles: string[]; errors: string[] }>` — 先 `git apply --check`，通过则 `git apply`
     - `applyDiffFallback(workDir: string, hunks: DiffHunk[]): Promise<...>` — 逐 hunk 精确匹配回退策略
     - `previewDiff(diff: string): Promise<...>` — 解析 diff 为前端可展示的结构
     - `rollbackDiff(workDir: string, diff: string): Promise<void>` — `git apply -R` 回滚
  2. 内部调用 `child_process.execSync` 执行 git 命令
  3. fallback 策略：按 hunk 的 oldStart 定位，验证 context lines，逐个应用
- **验收标准**:
  - [ ] TypeScript 编译通过
  - [ ] 给定有效 unified diff，`validateDiff` 返回 valid: true
  - [ ] `applyDiff` 能正确修改文件
  - [ ] fallback 逻辑结构完整（具体验证在 Phase B）
- **验证**: 编写简单测试用例或手动调用

### A4. Agent Soul 定义 + Skill 注册
- **新建目录**: `src/stratix-systemzone/agents/`
- **新建文件**:
  - `src/stratix-systemzone/agents/observer.ts` — Observer Agent 的 config + soul + skill 注册
  - `src/stratix-systemzone/agents/strategist.ts` — Strategist Agent
  - `src/stratix-systemzone/agents/executor.ts` — Executor Agent
  - `src/stratix-systemzone/agents/guardian.ts` — Guardian Agent
  - `src/stratix-systemzone/agents/index.ts` — 统一导出
- **做什么**:
  1. 每个 Agent 定义：AgentConfig（agentId, name, type, provider, model, temperature, maxTokens）+ SoulConfig（identity, personality, goals, constraints）
  2. 每个 Agent 注册其专属 skills（使用 `systemzone` executor）
  3. 导出 `createObserverAgent()`, `createStrategistAgent()` 等工厂函数
  4. 工厂函数返回 `StratixAgent` 实例（已注册好 skills）
- **验收标准**:
  - [ ] TypeScript 编译通过
  - [ ] 4 个工厂函数各自返回 StratixAgent 实例
  - [ ] 每个 Agent 的 skill 列表正确（通过 `agent.skills.list()` 验证）
- **验证**: `npx tsc --noEmit`

### A5. SystemZoneManager（Zone 实例 + Coordinator 创建）
- **新建文件**: `src/stratix-systemzone/SystemZoneManager.ts`
- **做什么**:
  1. 创建 `SystemZoneManager` 类
  2. `initialize()` 方法：
     - 确保 `system-zone` Zone 存在（zoneRepository.getZone or create）
     - 创建 ZoneCoordinator 实例（用已有的 ZoneCoordinator 类）
     - 创建 4 个 Agent 实例（调用 A4 的工厂函数）
     - 注册为 Zone 成员（zoneMemberRepository.addMember）
     - 注册能力（agentCapabilityRepository.setCapability）
     - 将 System Zone 内部模块实例注入到 SystemZoneSkillExecutor
  3. `getCycle()` 方法：返回 SystemZoneCycle 实例（Phase C 实现）
  4. `shutdown()` 方法：清理资源
- **验收标准**:
  - [ ] TypeScript 编译通过
  - [ ] `initialize()` 后 Zone 有 4 个成员
  - [ ] 能通过 `agentCapabilityRepository.getCapabilities()` 查到每个 Agent 的能力
- **验证**: `npx tsc --noEmit`

---

## Phase B：核心链路

### B1. Strategist Agent modifications 生成 prompt
- **文件**: `src/stratix-systemzone/agents/strategist.ts`（扩展）
- **做什么**:
  1. 编写 Strategist Agent 的核心 system prompt，要求 LLM 输出包含 modifications 的 JSON
  2. prompt 必须包含：
     - unified diff 格式说明和示例
     - 行号精确性要求
     - 上下文行必须和源文件完全一致的要求
     - 每个 modification 必须附带 description
     - 新文件用 type: "create" + content
     - 输出 JSON schema 定义
  3. 在 `generate_modifications` skill 中集成此 prompt
  4. 调用 StrategistLLMEnhancer 获取扫描数据作为 context
- **验收标准**:
  - [ ] prompt 包含完整的 diff 格式说明和约束
  - [ ] LLM 输出的 JSON 能被解析为 SystemZoneFileModification[]
  - [ ] diff 字段格式是标准 unified diff（有 `--- a/` 和 `+++ b/` 头部，有 `@@ ... @@` hunk 头）
- **验证**: 需要实际 LLM 调用验证（可后续集成测试）

### B2. Executor.buildModificationPlan 修复 + DiffApplier 集成
- **文件**: `src/stratix-systemzone/executor/Executor.ts`
- **做什么**:
  1. 修改 `buildModificationPlan()` 从 `proposal.modifications` 取值（替代 `(proposal as any).modifications`）
  2. 在 `applyModifications` 流程中集成 DiffApplier：
     - 如果 modification 有 `diff` 字段 → 用 DiffApplier
     - 如果 modification 只有 `content` → 走原来的 CodeModifier 逻辑
  3. 修改 proposal 到 ModificationPlan 的映射逻辑
  4. 保持向后兼容（旧的没有 modifications 的 proposal 仍然能走空数组逻辑）
- **验收标准**:
  - [ ] `buildModificationPlan` 从 `proposal.modifications` 取值（不再用 `as any`）
  - [ ] 有 diff 的 modification 通过 DiffApplier 应用
  - [ ] 无 diff 的 modification 走原 CodeModifier 逻辑
  - [ ] TypeScript 编译通过
- **验证**: `npx tsc --noEmit`

### B3. Guardian Agent 安全审查实现
- **文件**: `src/stratix-systemzone/agents/guardian.ts`（扩展）
- **做什么**:
  1. 编写 Guardian Agent 的 system prompt，要求审查 modifications 安全性
  2. 审查维度：路径安全性、影响范围、回滚风险、是否触及禁止路径
  3. 输出 SafetyAssessment（approved/rejected/conditional + concerns + suggestions + confidence）
  4. 在 `review_modifications` skill 中集成
  5. 高风险时：更新 Proposal.safetyAssessment，设置任务状态为 blocked
- **验收标准**:
  - [ ] Guardian prompt 包含完整审查维度
  - [ ] 输出符合 SafetyAssessment interface
  - [ ] 高风险时任务状态变 blocked
- **验证**: TypeScript 编译 + 审查逻辑可执行

### B4. DiffApplier fallback 策略完整实现
- **文件**: `src/stratix-systemzone/executor/DiffApplier.ts`（完善）
- **做什么**:
  1. 实现 `applyDiffFallback` 的逐 hunk 精确匹配逻辑：
     - 读取目标文件
     - 按 oldStart 定位行
     - 逐行验证 context lines
     - 匹配则应用 add/remove 行
     - 不匹配则记录错误
  2. 实现原子性：fallback 后有任何 hunk 失败 → 回滚所有已应用的 hunk
  3. 完善错误信息返回
- **验收标准**:
  - [ ] 逐 hunk 匹配逻辑正确
  - [ ] 部分 hunk 失败时整体回滚
  - [ ] 错误信息包含失败 hunk 详情
- **验证**: 单元测试或手动验证

---

## Phase C：协作流程

### C1. SystemZoneCycle 编排逻辑
- **新建文件**: `src/stratix-systemzone/SystemZoneCycle.ts`
- **做什么**:
  1. 创建 `SystemZoneCycle` 类，实现固定编排流程：
     ```
     observe → strategize → review → execute → evaluate
     ```
  2. 每一步通过 ZoneCoordinator.delegateTask() 驱动
  3. 每一步的结果通过 task_complete 回调接收
  4. 实现状态机管理 cycle 进度
  5. 接收用户输入作为 cycle 触发源
- **验收标准**:
  - [ ] 完整 cycle 5 步能顺序执行
  - [ ] 每步结果传递给下一步
  - [ ] 高风险时暂停等用户确认
- **验证**: 集成测试

### C2. Agent 间上下文传递
- **文件**: `src/stratix-systemzone/SystemZoneCycle.ts`（扩展）
- **做什么**:
  1. Observer 的 insights → 序列化为 JSON → 作为 Strategist task_delegate 的 context
  2. Strategist 的 modifications → 作为 Guardian task_delegate 的 context
  3. Guardian 的 safetyAssessment → 决定是否执行
  4. 所有中间结果保存到 Proposal 对象
- **验收标准**:
  - [ ] Observer 输出能被 Strategist 看到
  - [ ] Strategist 输出能被 Guardian 看到
  - [ ] 数据不丢失（完整传递）
- **验证**: 日志输出验证

### C3. FitnessEvaluator 反馈循环
- **文件**: `src/stratix-systemzone/SystemZoneCycle.ts` + `src/stratix-systemzone/fitness/`
- **做什么**:
  1. 在 cycle 的 evaluate 步骤调用 FitnessEvaluator
  2. 如果执行后系统变差（分数下降）→ 自动触发回滚
  3. 回滚使用 DiffApplier.rollbackDiff
  4. 记录评估结果到审计日志
- **验收标准**:
  - [ ] evaluate 步骤能执行 FitnessEvaluator
  - [ ] 变差时自动回滚
  - [ ] 评估结果记录到审计日志
- **验证**: 手动触发 cycle 并观察

---

## Phase D：UI 适配

### D1. System Zone 面板对接 Agent 架构
- **文件**: `src/stratix-systemzone/ui/SystemZoneConsole.vue`（扩展）
- **做什么**:
  1. 新增 Agent 状态 Tab（展示 4 个 Agent 的在线状态、当前任务、能力）
  2. 复用 ZoneAuditPanel 展示 Agent 活动日志
  3. 复用 ZoneTaskConfirmPanel 处理高风险确认
  4. 任务流转可视化（Observer → Strategist → Guardian → Executor）
- **验收标准**:
  - [ ] 能看到 4 个 Agent 的状态
  - [ ] 任务流转过程可视化
  - [ ] 高风险修改时弹出确认面板
- **验证**: 手动 UI 验证

### D2. 手动触发 + 自动循环
- **文件**: `src/stratix-systemzone/ui/` + `src/stratix-systemzone/api/`
- **做什么**:
  1. API 端点：`POST /api/system-zone/cycle/trigger`（手动触发）
  2. API 端点：`POST /api/system-zone/cycle/start`（开始自动循环）
  3. API 端点：`POST /api/system-zone/cycle/stop`（停止自动循环）
  4. UI 按钮对接这些端点
  5. 自动循环使用定时器（interval 可配置）
- **验收标准**:
  - [ ] 手动触发能跑一次完整 cycle
  - [ ] 自动循环能按 interval 反复执行
  - [ ] 停止按钮能中断循环
- **验证**: 手动测试

---

## 执行顺序

```
A1 → A2 → A3 → A4 → A5
                 ↓
              B1 → B2 → B3 → B4
                           ↓
                        C1 → C2 → C3
                                    ↓
                                 D1 → D2
```

## 开发约束

1. **每次只给 Claude Code 安排一个 Task**
2. **最小改动原则** — 不重构不相关代码
3. **每个 Task 完成后必须 `npx tsc --noEmit` 验证编译**
4. **遵循现有代码风格**（看周围代码怎么写的）
5. **不删除现有代码** — 标注 `@deprecated` 或保留兼容
6. **每个 Task 完成后 review 改动**
