# System Zone Agent 化重设计 — 开发状态 v2

**创建时间**: 2026-04-06 14:55
**重拆时间**: 2026-04-06 15:16
**最后更新**: 2026-04-06 15:16

## Phase A：基础设施

| Task | 标题 | 状态 | 开始时间 | 完成时间 |
|------|------|------|---------|---------|
| A1 | 新增类型定义（DiffHunk / SystemZoneFileModification / SafetyAssessment + Proposal 扩展） | pending | - | - |
| A2 | 新建 SystemZoneSkillExecutor（注册到 createExecutor） | pending | - | - |
| A3 | 新建 DiffApplier（完整 unified diff 应用器 + fallback） | pending | - | - |
| A4 | 新建 Agent 定义文件（4 个 Agent config + soul + skills） | pending | - | - |
| A5 | 修改 Executor.buildModificationPlan（修复空转 bug + DiffApplier 集成入口） | pending | - | - |
| A6 | 新建 SystemZoneManager（Zone 实例创建 + 模块注入串联 A1-A5） | pending | - | - |

## Phase B：核心链路

| Task | 标题 | 状态 | 开始时间 | 完成时间 |
|------|------|------|---------|---------|
| B1 | Strategist modifications 生成 prompt + 实现 | pending | - | - |
| B2 | Executor DiffApplier 集成（执行流程支持 diff） | pending | - | - |
| B3 | Guardian 安全审查 prompt + 实现 | pending | - | - |
| B4 | SystemZoneFileModification → FileModification 映射函数 | pending | - | - |
| B5 | DiffApplier 单元测试 | pending | - | - |

## Phase C：协作流程

| Task | 标题 | 状态 | 开始时间 | 完成时间 |
|------|------|------|---------|---------|
| C1 | SystemZoneCycle 状态机 + 编排逻辑 | pending | - | - |
| C2 | Agent 间上下文传递 | pending | - | - |
| C3 | FitnessEvaluator 反馈循环（变差自动回滚） | pending | - | - |
| C4 | SystemZoneCycle 单元测试 | pending | - | - |

## Phase D：UI 适配

| Task | 标题 | 状态 | 开始时间 | 完成时间 |
|------|------|------|---------|---------|
| D1 | System Zone 面板对接 Agent 架构 | pending | - | - |
| D2 | 手动触发 + 自动循环 API | pending | - | - |

## 当前活跃 Task
**无** — 等待用户确认后开始 A1
