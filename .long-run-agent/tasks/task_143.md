# task_143

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_143.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

task_assign mission_id 存在性校验+终态回报去向可追踪-模块

来源：MCP r4 评估 P1（实为 P2）—— 假 mission_id 照收、回执回显、任务真跑、终态回报静默蒸发（日志零异常）。

## requirements

- **入参校验**：`stratix_task_assign` 的 mission_id 不存在 → 拒收（错误信封 + hint + retryable:false），
  且**零副作用**（不建任务、不派 CLI）→ `src/stratix-gateway/mcp/tools/task.ts`
- **hint 指路**：明确指向 mission_create 回执或 world_snapshot 查真 id
- **终态兜底**：回报到达时 mission 已消失（建后被删）→ 不得静默蒸发：warn 日志 + 回执可追踪
  （unknown_mission 标记），不重建编组 → `src/stratix-gateway/service/mission-report.ts`（新增）
- **description 同步**：四段式风格，说明 mission_id 必须来自 mission_create 回执或 snapshot
- **不动其他工具 / 不动错误信封分型层 / 不引依赖 / 不 mock**
- **测试**：假 id 拒绝 / 真 id 通过 / 删除后回报兜底 三场景单测

## acceptance

- [x] **假 mission_id 被拒**：错误信封 + hint + retryable:false + 零副作用（任务数前后不变、无 CLI 执行）→ 实测 curl 证据
- [x] **真 id 流程无回归**：派一条真任务跑通（completed → 编组收尾 done → 会话原因「任务单完成」）
- [x] **竞态兜底有证据**：网关日志 warn + mission_run 会话 closed 事件标 unknown_mission；单测覆盖
- [x] **tools/list 仍 19 个**，task_assign 描述已更新
- [x] **tsc + jest 绿**：`npx tsc --noEmit` exit 0；`npx jest src/stratix-gateway` 312 passed
- [x] **结束时网关在跑**（7524 LISTEN）

## 交付物

1. **入参校验（零副作用）**：`src/stratix-gateway/mcp/tools/task.ts`
   - `stratix_task_assign` 派单前查名册：mission_id 不存在 → `mission_not_found`（retryable:false，
     hint 指 mission_create 回执 / world_snapshot），**在建单 / 派 CLI 之前**判掉 → 零副作用。
   - 描述同步更新（四段式）：mission_id 必须来自 mission_create 回执或 snapshot；错误行补 mission_not_found。
   - 错误码复用既有 `mission_not_found`（附录 A 已在册），**不动错误信封分型层**。
2. **终态兜底（回报去向可追踪）**：`src/stratix-gateway/service/mission-report.ts`（新增）+ 组合根接线
   - `settleMissionFromTaskReport()`：任务终态 → 编组任务收尾（completed→done / failed→cancelled）。
   - **竞态兜底**：回报到达时编组任务已被撤掉/删除 → ① warn 日志（网关日志可 grep）
     ② Notice 落世界态（source `service/mission-report`）③ **不重建**编组（断链不伪装成新任务）。
   - `src/app/services/task-service.ts`：新增可选端口 `missionExists`，mission_run 会话收尾原因如实标注
     `unknown_mission：编组任务已不存在，回报未送达` —— 会话事件流是 MCP 侧唯一查得到的回报去向痕迹。
3. **单测**：假 id 拒绝 / 真 id 通过 / 删除后回报兜底 三场景。

## 验证证据（完成前必填）

- [x] **实现证明**: 见上方交付物；核心两处 —— ① task_assign 派单前查名册（零副作用拒收）
  ② settleMissionFromTaskReport 的 unknown_mission 兜底（日志 + Notice + 会话标记，不重建编组）
- [x] **测试验证**: 单测 + 网关实测（curl）均通过，见下方「验证结果」
- [x] **影响范围**: tools/list 仍 19 个；task_assign / task_status / task_cancel / mission_* 行为回归全绿；
  正常路径（编组在 → 收尾成 done，会话原因「任务单完成」）不误伤。

### 测试步骤
1. 重启网关（kill 7524 → `nohup sh -c 'PORT=7524 npm run start:dev' >/tmp/stratix-gw-7524.log 2>&1 &`）
2. `tools/list` → 19 个 + task_assign 描述已更新
3. 假 id ×2 → `mission_not_found` 错误信封；任务数前后不变（0 → 0），日志无派单痕迹
4. 真 id → 派单成功 → 任务 completed → 编组相位 running → done；会话收尾原因「任务单完成」
5. 竞态：建 pending 编组 → 派单 → 立刻 mission_cancel（编组消失）→ 任务完成 →
   网关日志出现「终态回报落空 …（unknown_mission）」；会话收尾原因带 unknown_mission
6. `npx tsc --noEmit` + `npx jest src/stratix-gateway`（312 passed）+ `npx jest src/app src/core`（1554 passed）

### 验证结果

**假 id 拒收（实测 curl，两种错法）**
```
{"ok":false,"error":{"code":"mission_not_found","message":"编组任务「mission_R1_ID」不存在",
 "retryable":false,"hint":"mission_id 必须来自 stratix_mission_create 的回执（或 stratix_world_snapshot 的 missions 列表）：先用 mission_create 建一条，或用 snapshot 查真实 id 后重试"}}
{"ok":false,"error":{"code":"mission_not_found","message":"编组任务「mission_1793750127590_9」不存在", ...}}
```
零副作用：`tasks total = 0`（拒收前后一致），网关日志无任何派单 / CLI 痕迹。

**真 id 全链**：`task_assign` 回执 `mission_id=mission_1793750127590_1` → 任务 completed（输出「验收通过。」）
→ `mission_status` phase = `done` → mission_run 会话 closed 事件 reason = 「任务单完成」。

**竞态兜底（实测）**
```
[Stratix][service] 终态回报落空：编组任务「mission_1793766722857_5」已不存在（任务 task_1793766722867_4 / completed）—— 回报未送达（unknown_mission）
```
MCP 可查痕迹：`session_get` → closed 事件 reason = 「任务单完成（unknown_mission：编组任务已不存在，回报未送达）」；
`mission_status` → `mission_not_found`（编组确已消失）；编组**未被重建**。

**测试**：`npx jest src/stratix-gateway` → 28 suites / 312 tests passed；
`npx jest src/app src/core` → 96 suites / 1554 tests passed；`npx tsc --noEmit` → 无输出（exit 0）。
