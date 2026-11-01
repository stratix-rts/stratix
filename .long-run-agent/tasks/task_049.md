# task_049 任务审批门
## 需求
plan-first 类人设的 agent 执行任务先出计划，用户批准后继续执行（审批中间件）。
## 要点
1. persona 含「先计划后执行」特征（043 预设 plan 口径）→ task-service 发送时附「先输出计划，等待指令 PLAN_WAIT 结束标记」
2. 输出含 PLAN_WAIT → 任务挂起 awaiting_approval 态 → toast+单位头顶?提示
3. HUD 审批卡：计划全文+批准/驳回按钮 → 批准=续发「按计划执行」；驳回=任务 failed(reason=rejected)
4. 状态机扩展 awaiting_approval；超时策略（默认挂起不限时，文件头注明）
## 验收
- plan-first 人设 agent 派任务出现审批卡，批准后任务继续完成
- typecheck/jest 全绿

---

## 验证结果（2026-10-25）

- `npm run typecheck`：✅ 通过（0 error）。
- `npx jest --silent`：✅ **135 suites / 3091 passed / 6 skipped / 0 failed**（基线 3032 passed，+59 全部为本任务新增用例，无回归）。
- 新增/扩展用例覆盖：
  - 判定两路：`core/__tests__/persona-plan-first.test.ts`（手写标记路径）+ `hud/__tests__/onboarding-screen.test.ts`（plan-first 预设路径：RULES 带标记、其余预设不带）
  - 六态状态机：`core/__tests__/task.test.ts`（requestApproval/approve/reject 全合法链 + 全非法相位、awaiting 可 fail 逃生口、不可 cancel、capTaskPlan 截断、manager 事件面/忙闲派生、runtime 命令闭环 task.approve/task.reject）
  - 挂起检测与标记剥离：`extractPlanDraft` 纯函数（CRLF/空白/多标记行/句中不算/空计划）；落库的 awaiting 快照 plan/output 均无 PLAN_WAIT
  - 续发同 session：计划轮回传 sessionId → 批准后续发 `options.sessionId === 计划轮 sessionId`、prompt 为短指令（不重嵌 persona）；session 丢失退回首发拼装（persona+计划全文重述）
  - 事件流：`task.queued/started/awaiting_approval`（挂起不发 completed/failed、不 settle、不发 exp）；驳回走 `task.failed` 既有失败面
  - UI 条件渲染：agent-catalog 审批卡读数（awaiting→卡出现、running/failed→消失、签名翻转）、agent-panel DOM（计划全文 pre-wrap + 摘要 + 批准/驳回按钮 + 点击派发 task.approve/task.reject 命令 + HTML 转义）、task-output（六态徽标 + PLAN_WAIT 行剥离 + awaiting 自动展开）、task-fx（? 浮标驻留不自动过期、busy 环优先、批准盖回工作环/驳回换 !）
  - 迁移新老库：`app/__tests__/persistence/task-schema-v7.test.ts`（全新库 v7 / v6→v7 重建 artifacts 零丢失 / v5 / v4 全链 / DAO 自立路径 / 幂等无残留临时表）
  - 占位纪律：挂起期间 busy 不释放、后续任务排队不动；驳回/续段完成后队列续泵；重启丢挂单后批准 → failed(TASK_MSG_RESUME_LOST) 兑底
- schema：`character_tasks` 六态 CHECK + `plan TEXT NOT NULL DEFAULT ''`，schema_version 7；迁移沿用 047 重建方案（临时表 character_tasks_v7，artifacts 兜底先行）。
- 提交：`v3(task_049): 任务审批门`（选择性 add，不含 .long-run-agent 运行时文件）。
