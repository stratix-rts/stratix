# agent_task_120 —— v3.6 MCP mission 生命周期收尾：confirm / cancel 工具（P2）工作文档

> 任务：task_120 —— MCP 评估报告「困惑点 #6」与「§4 缺失 #2」的修正：补上编组任务（mission）的**确认**与**撤掉**两件写面工具。
> 评估证据：`/Users/kingj/.openclaw/workspace/reports/2026-11-03-stratix-mcp-review.md`（§4-2 探针任务「无法清理」/ 困惑点 #6 悬空 pending）。
> 依据：docs/MCP-SPEC.md §2.5 / §2.14 / §2.15 / §3.1 / §3.2 / §3.4 / §4.2 / §5.5；core 的 mission 状态机（`src/core/mission/machine.ts`）。
> 分支：demo/v3.3（commit 前缀 v3.6）。日期：2026-11-04。

## 1. 缺口与修法

| 缺口 | 现象 | 修法 | 为什么这么修 |
|---|---|---|---|
| **§4-2**（高） | 遗留一条 draft 探针编组任务 `mission_1793718884545_12`（「v3.6 读回验证探针」，1 条 checkpoint）—— MCP 里**没有任何工具能清理它**：既不能确认、也不能撤掉，永久挂在战场上 | 新增 `stratix_mission_cancel`：撤掉**从未开工**（`draft` / `pending`）的编组任务 —— 它从世界态消失，`world_snapshot` 里不再出现，占用的单位一并释放 | 验收口径明确要「cancel 后 `world_snapshot` 不再出现」—— 留 `cancelled` 墓碑**不满足**这条（墓碑仍在快照里）。且外部 agent 的清理需求只到「清理自己造的悬空 / 探针任务」为止，「叫停在跑的编组」是 UI 面板的活儿（§3.3 渲染层操作不通过 MCP 暴露） |
| **困惑点 #6**（高） | `auto_confirm:false` 造出的 `pending` 编组任务在 MCP 内是**死路**：创建工具的描述自认「第一期 MCP 不提供确认工具，确认留给 UI 面板裁决」—— 外部 agent 无法让自己的任务开工 | 新增 `stratix_mission_confirm`：`pending → running`，走 core 既有的确认链（`mission.confirm`，core 内部合并 `decide` + `start`）；并把 `mission_create` 的描述同步改成指向这两件工具 | 确认的**准入判定必须只有一份** —— core 的 `decide` 分支（只认 `pending`）。MCP 不另写一套相位规则；工具只负责发命令 + **回读核对**（前后两份状态比对 `pending → running` 才报成功） |

## 2. 关键设计：cancel 拆成「撤掉」与「叫停」两个动作

核心语义难题：core 里已有的 `mission.cancel` 是**叫停**（任意非终态 → `cancelled`，留终态墓碑，UI 的「停止任务」走这条）。本任务要的 cancel 是**撤掉**（任务从世界态消失，不留墓碑）。两者不是一回事，硬复用 core 的 `mission.cancel` 会与验收口径（快照里不再出现）与「running 拒绝」两条同时冲突。

| 动作 | 语义 | 相位 | 留下什么 |
|------|------|------|---------|
| `mission.remove`（本任务新增，MCP `stratix_mission_cancel`） | **撤掉** —— 从没开工，什么都没发生，世界态里不必留墓碑 | 只认 `draft` / `pending` | **不留痕**（任务消失，单位释放） |
| `mission.cancel`（core 既有，UI「停止任务」） | **叫停** —— 已开跑，得有个"被叫停了"的交代 | 任意非终态 → `cancelled` | 留终态墓碑（历史不改写） |

**core 是唯一的裁决方**（§3.1 / §3.2）：新增 `HudCommand.mission.remove` → core runtime 转给 `MissionManager.removeMission` → 守门 `canRemoveMission`（`core/mission/machine.ts`，判据只有这一份：`draft` 或 `pending`）。MCP 侧**只发命令 + 回读核对**（撤不掉就如实报 `illegal_transition` 并按当前相位说人话），不自己判相位。

**依赖判定也不另写一份**：confirm 回执里的 `blocked_by_dependencies` 取自 core 的 `findMissingDependencies`。

## 3. 交付物

| 文件 | 职责 |
|---|---|
| `src/core/types.ts` | 新增 `HudCommand` 动作 `mission.remove`（含契约注释：与 `mission.cancel` 的分工） |
| `src/core/mission/machine.ts` | 新增 `canRemoveMission`（撤掉的唯一判据）+ 头部补一行口径说明 |
| `src/core/mission/manager.ts` | 新增 `MissionManager.removeMission`（落库 + 释放单位占用 + 通知） |
| `src/core/runtime.ts` | `mission.remove` → `mission.removeMission` |
| `src/stratix-gateway/api/websocket/world-sync/protocol.ts` | `HUD_COMMAND_TYPE_FLAGS` 增 `'mission.remove'`（编译期强制的世界同步白名单） |
| `src/stratix-gateway/mcp/tools/mission.ts` | 新增 `missionConfirmTool` / `missionCancelTool`（含四要素描述 + `next`/`poll` 回执）；`missionCreateTool` 的描述与 schema 同步去掉「不提供确认工具」 |
| `src/stratix-gateway/mcp/server.ts` | 注册两件工具（排序位 8 / 9，插在 `mission_checkpoint` 之后）；工具件数注释 十四 → 十六 |
| `src/stratix-gateway/mcp/index.ts` | 导出两件工具 |
| `src/stratix-gateway/mcp/tools/chat.ts` / `registry.ts` / `session.ts` | **仅**调整 `order` 字段（排序位按域聚拢，既有工具之间的相对次序不变） |
| `src/stratix-gateway/mcp/__tests__/mission.test.ts`（+9 例） | confirm/cancel 的成功与全部错误路径 |
| `src/stratix-gateway/mcp/__tests__/registry.test.ts` / `transport.test.ts` | 固定 `tools/list` 清单的用例（十四 → 十六件） |
| `src/core/__tests__/mission.test.ts`（+3 例） | `removeMission` 的落库 / 单位释放 / 已开工与终态拒绝 |
| `docs/MCP-SPEC.md` | 新增 §2.14 / §2.15；改 §0.4（术语）、§2.5（描述与 schema）、§3.1（投影表）、§3.2（状态机约束）、§3.4（写面）、§4.2（域表 + 动词登记 + 预留位转正）、附录 A（错误码典型触发）、§5.5（v1.9 行） |
| `docs/rubric/agent_task_120_mcp_mission_lifecycle.md` | 本工作文档 |

## 4. 设计要点

- **不新增错误码**：复用 `mission_not_found` / `illegal_transition` / `mission_terminal` / `invalid_arguments` / `internal_error`（附录 A 总表未动语义，只补了两处「典型触发」）。
- **回执自己核实（不假装成功）**：confirm 的成功判据是**比对确认前后的相位**（`pending → running`）—— 若前后都是 `running`（任务本来就在跑），说明这次 `decide` 被 core 拒了，报 `illegal_transition` 而不是"已确认"；cancel 的成功判据是**回读后这条任务不见了**，还在 = 被拒。
- **依赖未满足 = 不是失败**：confirm 时前置未满足 → core 拒绝 → 任务留在 `pending` → 回执 `ok:true` + `confirmed:false` + `blocked_by_dependencies`（与 `mission_create` 的既有口径一致）。
- **四要素描述**：两件工具的 description 都是「何时用 / 何时不用 / 边界 / 错误」四段式，与既有 14 件同风格；「何时不用」里明确区分了确认（放行）与撤掉（清理）两条路。
- **排序位与条目号是两套编号**：条目号 §2.14 / §2.15 按「只加不删」追加在末尾；排序位按域聚拢插进 `mission` 域内（第 8 / 第 9 位），既有工具之间的相对次序不变。
- **不动的地方**：task_118 刚收敛的错误信封层（`envelope.ts` / `transport/http.ts`）零改动；core 既有的 `mission.cancel` 语义与行为逐字未变（UI「停止任务」照旧留墓碑）；不新增依赖；不引 mock 数据。

## 5. 验证（实测 · 网关 7524 手动重启后 curl）

**环境**：网关静态运行（无 nodemon），改完代码按任务书手动重启 —— `kill 2975` → `PORT=7524 npm run start:dev`（后台）→ 等 8 s → `lsof -ti :7524` = 77434。

**① `tools/list`（十六件，两件新工具在 mission 域内）**：

```
count: 16
 - stratix_world_snapshot / stratix_task_assign / stratix_task_status / stratix_task_cancel
 - stratix_mission_create / stratix_mission_status / stratix_mission_checkpoint
 - stratix_mission_confirm / stratix_mission_cancel
 - stratix_chat_send / stratix_registry
 - stratix_session_list / stratix_session_get / stratix_session_interrupt / stratix_session_resume / stratix_session_fork
```

**② 新建 pending → confirm → running**（`units` 需真实单位：经 `/ws/world-sync` 的 `command.forward` 建了一个角色 `探针员` → `unit_character_1793723241858_1`）：

```
POST stratix_mission_create {"title":"v3.6 生命周期收尾验证编组","units":["unit_character_1793723241858_1"],"auto_confirm":false}
→ { "ok": true, "data": { "mission_id": "mission_1793723244969_1", "phase": "pending", "auto_confirm_applied": false, ... } }

POST stratix_mission_confirm {"mission_id":"mission_1793723244969_1"}
→ { "ok": true, "data": { "mission_id": "mission_1793723244969_1", "title": "v3.6 生命周期收尾验证编组",
                          "phase": "running", "confirmed": true,
                          "units": [ { "id": "unit_character_1793723241858_1", "name": "探针员" } ],
                          "next": { "tool": "stratix_task_assign", ... }, "poll": { ... } } }
```

**③ 撤掉探针 → `world_snapshot` 不再出现**（同形重建一条 draft 探针「v3.6 读回验证探针」+ 1 条 checkpoint）：

```
POST stratix_mission_cancel {"mission_id":"mission_1793723257826_6"}
→ { "ok": true, "data": { "mission_id": "mission_1793723257826_6", "title": "v3.6 读回验证探针",
                          "previous_phase": "draft", "removed": true, "units_released": 0,
                          "note": "这条编组任务已从战场移除（world_snapshot 里不再出现），它占用的单位已释放。" } }

world_snapshot {domains:[missions]} 撤前 → { "returned": 2, "total": 2, items: [ …验证编组(running), …探针(draft) ] }
world_snapshot {domains:[missions]} 撤后 → { "returned": 1, "total": 1, items: [ …验证编组(running) ] }
```

**④ pending 撤掉 → 单位释放**：

```
world_snapshot {domains:[units]} 撤前 → unit_character_1793723267484_2 … "mission_id": "mission_1793723275875_15"
POST stratix_mission_cancel {"mission_id":"mission_1793723275875_15"}
→ { "ok": true, "data": { "previous_phase": "pending", "removed": true, "units_released": 1 } }
world_snapshot {domains:[units]} 撤后 → unit_character_1793723267484_2 … "mission_id": null
```

**⑤ 三条拒绝路径**（都是"说人话"而不是干巴巴的相位不对）：

```
# running 撤不掉
{ "ok": false, "error": { "code": "illegal_transition",
  "message": "编组任务「v3.6 生命周期收尾验证编组」当前是 running 相位，只有还没开工的任务（draft / pending）能撤掉",
  "hint": "已开工的任务撤不掉（撤任务不等于撤活儿）—— 等它跑完，或先把它自己收尾" } }

# draft 确认不了
{ "ok": false, "error": { "code": "illegal_transition",
  "message": "编组任务「v3.6 草稿相位探针」当前是 draft 相位，只有待确认（pending）的编组任务能确认开工",
  "hint": "这条编组任务还没指派任何单位（draft 相位），没有可确认的编组 —— 用 stratix_registry 查战场单位 id，重新建一条并带上 units" } }

# 报告里的原始探针 id（本进程里已不存在 —— missions 纯内存不落库，网关重启即失）
{ "ok": false, "error": { "code": "mission_not_found", "message": "编组任务「mission_1793718884545_12」不存在",
  "hint": "用 stratix_mission_status 列出编组任务，确认 id" } }
```

**⑥ 回归**：

```
npx tsc --noEmit                                     → 零输出（exit 0）
npx jest src/stratix-gateway/mcp --silent --maxWorkers=1 → Test Suites: 13 passed / Tests: 140 passed
npx jest src/core src/stratix-gateway --silent --maxWorkers=1 → Test Suites: 62 passed / Tests: 1070 passed
```

## 6. 未尽事项

- **原始探针 id `mission_1793718884545_12` 无法在 live 实例里直接撤**：missions 是**纯内存**、不落库（见 MEMORY「任务系统」条），网关重启后原探针已不存在（`mission_not_found`）。故按**同一形状**（draft + 1 条 checkpoint + 同名「v3.6 读回验证探针」）重建一条并实测撤除成功 —— 证据见 §5-③。
- **`stratix_session_fork` 的规范条目仍待补**（本次未动，§3.1 已加脚注说明它同样落在既有 `HudCommand.session.*` 面上）。
- **UI 侧的「停止任务」仍走 core 的 `mission.cancel`**（留 `cancelled` 墓碑）—— 与 MCP 的「撤掉」是两个动作，HUD 侧本次零改动。
