# task_047 任务队列管理
## 需求
任务队列可见可控：取消排队任务、失败重派按钮（037 遗留）、当前队列完整展示。
## 要点
1. HudCommand 增 task.cancel（queued→cancelled；running 不强杀，提示先停止）
2. 失败任务卡片「重派」按钮 → 新建同 prompt 任务
3. 单位卡片队列区：完整队列列表（状态徽标）+ 取消操作
4. character_tasks 状态机扩展 cancelled 态（词表+DAO+UI）
## 验收
- 排队中可取消；失败可一键重派；队列全程可见
- typecheck/jest 全绿

---

## 验证结果（执行记录，2026-10-25）

**结论：全绿，验收达成。**

- `npm run typecheck`：通过（0 错误）
- `npx jest --silent`：131 suites passed / **2980 passed** / 0 failed（基线 2958 → 净增 22，无回归）

### 改动文件（14）

| 层 | 文件 | 内容 |
|---|---|---|
| core | `src/core/types.ts` | TaskStatus 增 cancelled；HudCommand 增 `task.cancel {taskId}`；WorldEvent 增 `task.cancelled` |
| core | `src/core/task/machine.ts` | cancel 动作（仅 queued→cancelled，占位 output）；TERMINAL 增 cancelled；dropSettledTasks 覆盖 |
| core | `src/core/task/manager.ts` | `cancelTask()` 返回 `TaskCancelOutcome`（not-found / not-queued + status）；Notice 分流文案（running→「先停止」） |
| core | `src/core/runtime.ts` | task.cancel 分发 + task.cancelled 接地补注 |
| core | `src/world/dev/main.ts` | dev 事件面板 describe 补 task.cancelled |
| app | `src/app/services/task-service.ts` | task.cancelled → 落库 + 内存队列剔除；pump 出队防御（仅 queued 进 transport）；getState 类型面扩 tasks |
| app | `src/app/services/persistence/task-record-dao.ts` | 词表五态；四态老表重建迁移（DDL 指纹检测幂等） |
| db | `src/stratix-database/StratixDatabase.ts` | schema_version 4→5；createTables/migrateTasks 双路径五态 DDL + 重建迁移 |
| hud | `src/hud/components/task-output/task-output-catalog.ts` | 相位徽标补 cancelled；terminal 判定覆盖 cancelled |
| hud | `src/hud/panels/agent-catalog.ts` | CharacterTaskQueueModel.items（在办全显 + 终态最近 3 条倒序）；buildTaskCancelCommand；签名覆盖条目 |
| hud | `src/hud/panels/agent-panel.ts` | 队列完整列表渲染（徽标/摘要/取消仅 queued/重派仅 failed）+ 点击分发 |

### 迁移方案（schema v5）

SQLite CHECK 不可 ALTER → **重建表迁移**（建五态新表 → INSERT SELECT 全字段搬运 → DROP → RENAME → 重建索引），保留 CHECK 而非放弃约束（词表是 DAO 第一道闸，方案与理由两处文件头注明）。识别老表用 sqlite_master DDL 含 `'cancelled'` 指纹，幂等可重跑；StratixDatabase（schema_version 路径）与 DAO ensureCharacterTasksTable（自立兜底路径）同构双保险。

### 未尽事项

- running 任务的「先停止」中止动作：本任务范围外（规格明确不强杀），核心拒绝路径已留好 Notice 提示与 error code。
- 队列列表终态窗口固定 3 条（MAX_VISIBLE_SETTLED_TASKS），更早历史在 SQLite 审计里，未做 UI 翻页。
