# agent_task_129 —— v3.7 MCP 名册清理最小闭环：`stratix_character_delete` 工作文档

> 任务：task_129 —— MCP 复测报告 **N4**（P4·中）的修正：**名册只进不出**，试错 / 评估型 agent 建的废角色永远留在名册里，没有任何删除手段。
> 评估证据：`/Users/kingj/.openclaw/workspace/reports/2026-11-04-stratix-mcp-review.md` §3-N4（"character_create 没有逆向工具 …… 建议补 `stratix_character_remove`（或 retire），至少文档明示『名册清理走 UI』"）。
> 依据：docs/MCP-SPEC.md §2.17（新条目）/ §3.1 / §3.2 / §4.2 / §5.5；core 的角色域语义（`src/core/character/manager.ts` / `unit-projection.ts`）。
> 分支：demo/v3.3（commit 前缀 v3.7）。日期：2026-11-04。

## 1. 缺口与修法

| 缺口 | 现象 | 修法 | 为什么这么修 |
|---|---|---|---|
| **N4**（结构性） | MCP 工具面**没有任何删角色的入口** —— `stratix_registry` / `stratix_world_snapshot` 只读名册，`stratix_character_create` 只进不出。评估轮留下的 4 个「复测-」角色只能 UI 侧清理；名册顶到 `MAX_CHARACTERS = 64` 后连正常建档都建不出来 | 新增 `stratix_character_delete`：`character_id` 必填；**占用中的角色拒绝删除并说清原因**；删除后名册与战场单位同时消失（不留幽灵单位）；删不存在的 id 报明确错误 | core 侧**本来就没有删除语义**（`WorldState.characters` 只增），所以本任务要补的是 core 的写入面（`HudCommand.character.delete` → `character/manager.ts` 的 `deleteCharacter`），MCP 只做**投影**（§3.1），不重写一套角色系统 |
| **删了会留孤儿** | 角色被删但它的战场单位还在 → 渲染侧画出"没档案的野单位"；更糟的是角色手上有活 → "任务在跑、承人没了"的孤儿单 | 删除与占用判定都落在 core 的**同一次 `setState`**：删角色 + 撤它的单位一起写；占用中的角色**直接拒发** | 角色与单位是"同一次广播里的一对"，分两次写会广播两遍，中间那一帧会出现名册与战场漂移 |

## 2. 关键设计：「占用」到底怎么算（口径写死在 core 一处）

删除的闸门有两档，判定抽成**纯函数** `src/core/character/delete-guard.ts` 的 `findCharacterDeleteBlock(state, characterId)`：

| 档位 | 判定 | 为什么这样判 |
|---|---|---|
| **在任务中**（`character-busy`） | 该角色还有未收尾的**角色任务**（`queued` / `running` / `awaiting_approval`），**或**它的战场单位仍挂在一条编组任务上（`unit.missionId` 非空）/ 单位状态不是 `idle` | 两条都要看：角色任务队列（`state.tasks`）与编组任务（`state.units` 的 `missionId`）是**两本账** —— 编组任务在跑时未必有对应的角色任务条目 |
| **在线**（`character-online`） | 该角色有**在办会话**（`character_chat` 会话处于 `active`，即正在对话） | **不拿 `units[].online` 当闸门**：那是 CLI 进程健康态，**缺省即在线** —— 拿它当闸门会把名册里绝大多数角色都锁死，等于没有删除工具。真正占着这个角色的是"在办会话" |

**判定只有一份**：core 的 manager 在同一次 `setState` 内用它做**权威裁决**（防并发：判在前、写在后，中间没有别的写入插进来），MCP 工具在发命令**前**用同一份函数做**快筛**，只为把拒绝理由说清。两处各写一份必然漂移（一个说"在任务中"、一个说"在忙"）。

**错误码不新增**（沿用附录 A 的"不新增码"纪律，与 task_123 同一条）：不存在 → `unknown_character`；在任务中 → `illegal_transition`；在线 → `chat_busy`；缺参 → `invalid_arguments`；命令没人接管 → `internal_error`。复用码的代价是这一档不叫"删不掉"，靠 message / hint 说清楚。

**动词登记**：`delete` 不在受控动词表里 —— 按 §4.2 的规矩先登记再用（`cancel` 撤的是"活"，`delete` 删的是"角色"，不是一件事）。

## 3. 交付物

| 文件 | 职责 |
|---|---|
| `src/core/character/delete-guard.ts`（新） | 占用判定的**纯函数**（在任务中 / 在线），core 与 MCP 共用 |
| `src/core/character/manager.ts` | 新增 `deleteCharacter`：同一次 `setState` 内删角色 + 撤它的战场单位；被拒走 Notice |
| `src/core/character/index.ts` | 出口加一行（`export * from './delete-guard'`） |
| `src/core/types.ts` | `HudCommand` 增补 `character.delete` |
| `src/core/runtime.ts` | `handleCommand` 接线 `character.delete` → manager（不再走 onUnhandled） |
| `src/stratix-gateway/mcp/tools/character.ts` | `stratix_character_delete` 工具（四要素描述 + inputSchema + 快筛 + 下发 + 回读核实） |
| `src/stratix-gateway/mcp/server.ts` | 注册新工具（排序位 18，既有 17 件相对次序不变）；工具件数注释 十七 → 十八（3 处） |
| `src/stratix-gateway/mcp/index.ts` | 导出 `characterDeleteTool` |
| `src/stratix-gateway/mcp/__tests__/character-delete.test.ts`（新，7 例） | 删除闭环 / 删不存在 / 缺参 / 在任务中 / 在线 / 终态任务不算占用 / 命令没人接管 |
| `src/stratix-gateway/mcp/__tests__/registry.test.ts`、`transport.test.ts` | 固定 `tools/list` 清单的用例（十七 → 十八件） |
| `src/stratix-gateway/api/websocket/world-sync/protocol.ts` | HUD 命令白名单增 `character.delete`（该表由 `HudCommand['type']` 推导，core 加命令必同步） |
| `docs/MCP-SPEC.md` | 新增 §2.17；改 §0 目录、§3.1 投影表、§3.4 写工具清单、§4.2 域表 + 登记 `delete` 动词、§5.5（v1.11 行） |
| `docs/rubric/agent_task_129_mcp_character_delete.md` | 本工作文档 |

## 4. 验证（实测）

- `npx tsc --noEmit` → 无输出（绿）。
- `npx jest src/stratix-gateway/mcp src/core --maxWorkers=2` → **54 套件 / 980 例全绿**（含新增 7 例）。
- 活体（重启 gateway 7524 后 curl `/mcp`）：
  - `tools/list` → **18 件**，`stratix_character_delete` 在 `character_create` 之后。
  - 4 个「复测-」角色逐个删净 → `world_snapshot` `totals: {units:0, missions:0, tasks:0, characters:0}`，**零残留**。
  - 删不存在的 id（连打两次）→ `unknown_character`，不崩、不假成功。
  - 占用中的角色 → `illegal_transition`「当前在任务中，不能删除：还挂在编组任务 mission_… 上」；撤掉该编组任务后同一角色删成功。

## 5. 未尽事项

- **落库侧未跟进**：角色档案的持久化链路挂在**渲染进程**一侧的存档协调器（按名册 diff 写回 SQLite），其台账收缩（"角色被删"）分支至今没有命令路径可走（见 `game-save-coordinator.ts` 的既有注释）。本工具删的是**世界态**里的角色；渲染进程一侧的名册同步与库行删除留待后续任务（与 §2.16 的持久化边界同一条分界）。
- **"在线"这一档没有 MCP 侧活体验证**：`character_chat` 会话（`active`）在 MCP 面前没有可用的构造路径（`stratix_chat_send` 在本部署全局不可用 —— 报告 N1），该档由 core 单测覆盖（`character-delete.test.ts` 的"在线"用例）。
