# agent_task_123 —— v3.6 MCP 名册供给最小闭环：`stratix_character_create` 工作文档

> 任务：task_123 —— MCP 评估报告「结构性缺口」的修正：补上**名册供给**入口（MCP 侧唯一能建角色的工具）。
> 评估证据：`/Users/kingj/.openclaw/workspace/reports/2026-11-03-stratix-mcp-review.md`（§七 / §4-1：没有任何工具能建角色 → 名册为 0 时 `mission_assign` / `mission_create(auto_confirm:true)` 全线 `illegal_transition`，agent 无法通过 MCP 组出一支队伍）。
> 依据：docs/MCP-SPEC.md §2.16 / §3.1 / §3.2 / §3.4 / §4.2 / §5.5；core 的建档语义（`src/core/character/manager.ts` / `profile.ts` / `unit-projection.ts`）。
> 分支：demo/v3.3（commit 前缀 v3.6）。日期：2026-11-04。

## 1. 缺口与修法

| 缺口 | 现象 | 修法 | 为什么这么修 |
|---|---|---|---|
| **§七 / §4-1**（结构性） | MCP 工具面**没有任何建角色的入口** —— `stratix_registry` 只读名册、`stratix_world_snapshot` 只读名册切片。空实例上 agent 连一条单都发不出去：`task_assign` 必然 `unknown_character`，`mission_create(auto_confirm:true)` 因为没有可编组的单位而建不出任务。**MCP 侧无法从零组出一支队伍** | 新增 `stratix_character_create`：`name` 必填（重名拒绝），`archetype` / `persona` / `skin_id` 选填（各有合理缺省），建档即上场（角色落库的同时在战场上多一个单位），回执给 `character_id` + 完整角色对象 + `unit_id` + 下一步指引 | 建档的**全部语义**（重名判定、上限、等级/经验缺省、战场单位投影）都已在 core 里 —— `HudCommand.character.create` → `core/runtime.ts` → `character/manager.ts` → `createAgentProfile` + `toCharacterUnit`。MCP 只做**投影**，不重写一套角色系统（§3.1） |
| **闭环断点** | 上一批（task_120）补的 `mission_confirm` / `mission_cancel` 只能在**已有角色**的战场上有意义；名册为 0 时它们无从谈起 | 回执里带 `next`（下一步直接是 `stratix_mission_create`，`args.units` 带上刚建角色的 `unit_id`）+ `poll`（`stratix_registry`） | agent 的默认动作链是"读现状 → 写一步 → 再读"；把"下一步怎么写"直接写进回执，agent 就不必反推该调哪件工具 |

## 2. 关键设计：`archetype` = 绑定的本地 CLI agent 种类

core 的 `character.create` 命令要求 `agentKind` + `skinId`，MCP 侧不能凭空造一套"角色原型"词表：

- **`archetype` → core 的 `agentKind`**：取值直接取 `core/types.ts` 的 `AGENT_KINDS`（claude-code / codex / opencode / kimi / openclaw / dsh），缺省 `claude-code`（仓库既有 demo 与首启引导的默认绑定）。回执里以 `agent_kind` 回显这个绑定关系。
- **`skin_id` → core 的 `skinId`**：取值直接取 `core/theme/skin-registry` 的 `SKINS`，缺省 `default`。不另抄一份词表。
- **初始等级 / 经验不开放成参数**：core 建档口径恒为 level 1 / exp 0，MCP 侧编造这两项等于对 core 撒谎（工具头注释第 3 条）。
- **人设有界**：core 的 `PERSONA_MAX_LEN` 是 32000（管状态广播体积），但本工具的**回执要整份回显角色对象** —— MCP 侧自设更紧的上限 2000 码点，两者是两件事。

## 3. 交付物

| 文件 | 职责 |
|---|---|
| `src/stratix-gateway/mcp/tools/character.ts`（新） | `stratix_character_create` 工具（四要素描述 + inputSchema + 准入快筛 + 建档 + 回执） |
| `src/stratix-gateway/mcp/server.ts` | 注册新工具（排序位 17，既有 16 件相对次序不变）；工具件数注释 十六 → 十七（3 处） |
| `src/stratix-gateway/mcp/index.ts` | 导出 `characterCreateTool` |
| `src/stratix-gateway/mcp/__tests__/character.test.ts`（新，10 例） | 建档闭环（真 core 运行时）/ 缺省值 / 显式参数 / 名册准入 / 命令没人接管 |
| `src/stratix-gateway/mcp/__tests__/registry.test.ts` | 固定 `tools/list` 清单的用例（十六 → 十七件） |
| `src/stratix-gateway/mcp/__tests__/transport.test.ts` | 同上（HTTP / stdio 两处清单） |
| `docs/MCP-SPEC.md` | 新增 §2.16；改 §0（版本 v1.9 → v1.10）、§3.1（投影表）、§3.2（容量）、§3.4（写面）、§4.2（域表新开 character 域）、§5.5（v1.10 行） |
| `docs/rubric/agent_task_123_mcp_character_create.md` | 本工作文档 |

**core 侧零改动** —— 建档语义本来就在 core 里（`HudCommand.character.create` 是既有命令），本任务只是给它开一个 MCP 门面。

## 4. 设计要点

- **不新增错误码**（附录 C 铁律）：重名 / 名册已满 / 参数形状非法统统复用 `invalid_arguments`（各自带不同 message 与 hint）；"命令没人接管"复用 `internal_error`。
- **准入判定只有一份**：工具在发命令**前**只做一次**快筛**，且口径直接复用 core 的 `hasDuplicateCharacterName`（不另抄一份重名规则）；权威裁决仍在 core 的同一次 `setState` 内（防并发抢名）。
- **回执自己核实（不假装成功）**：发命令后**回读**世界态 —— 找不到新角色 = 命令没人被接管 → 如实报 `internal_error`，而不是回一句"建好了"。
- **建档即上场是 core 的既有语义**，不是本工具发明的：core 在同一次落库里把角色投影成战场单位（`core/character/unit-projection.ts`，单位 id = `unit_<角色 id>`）。本工具只把那个 `unit_id` 捞出来交给调用方。
- **四要素描述**：与既有 16 件同风格（何时用 / 何时不用 / 边界 / 错误）；「何时不用」里点明"只看名册用 `stratix_registry`、本工具只建档不改档"。
- **排序位与条目号是两套编号**：条目号 §2.16 按「只加不删」追加在末尾；排序位 17 追加在既有 16 件之后，既有工具相对次序不变（`tools/list` 的顺序是客户端提示词缓存的一部分，不能抖）。
- **不动的地方**：task_118 刚收敛的错误信封层（`envelope.ts` / `transport/http.ts`）零改动；core 既有建档语义逐字未变；不新增依赖；不引 mock 数据。

## 5. 验证（实测 · 网关 7524 手动重启后 curl）

**环境**：网关静态运行（无 nodemon），改完代码按任务书手动重启 —— `kill 34770` → `PORT=7524 npm run start:dev`（后台）→ 等 3 s → `lsof -ti :7524` = 35402。
（注意：`npm run start:dev` 默认 `PORT || 3010`，3010 被另一个项目的 vite preview 占着，必须显式 `PORT=7524`。）

**① `tools/list`（十七件，新工具在末位）**：

```
count: 17
 - stratix_world_snapshot / stratix_task_assign / stratix_task_status / stratix_task_cancel
 - stratix_mission_create / stratix_mission_status / stratix_mission_checkpoint
 - stratix_mission_confirm / stratix_mission_cancel
 - stratix_chat_send / stratix_registry
 - stratix_session_list / stratix_session_get / stratix_session_interrupt / stratix_session_resume / stratix_session_fork
 - stratix_character_create
```

**② 建档 → 拿到角色 id 与战场单位 id**：

```
POST stratix_character_create {"name":"Neo","archetype":"claude-code","persona":"你是负责重构的资深 coding agent，改动保持最小"}
→ { "ok": true, "data": {
      "character_id": "character_1793725749271_1",
      "unit_id": "unit_character_1793725749271_1",
      "character": { "id": "character_1793725749271_1", "name": "Neo",
                     "persona": "你是负责重构的资深 coding agent，改动保持最小",
                     "level": 1, "experience": 0,
                     "agent_kind": "claude-code", "skin_id": "default",
                     "external_session_id": null, "appearance": null, "context_enabled": null },
      "next": { "tool": "stratix_mission_create", "args": { "units": ["unit_character_1793725749271_1"] },
                "hint": "给它起个任务标题就能开工（units 传这个角色的战场单位 id）" },
      "poll": { "tool": "stratix_registry", "args": {} } } }
```

**③ 闭环：拿上一步的 `unit_id` 建编组任务 → 直接开到 running**（此前空名册时这一步必然失败）：

```
POST stratix_mission_create {"title":"MCP 名册供给闭环验证","units":["unit_character_1793725749271_1"],"auto_confirm":true}
→ { "ok": true, "data": { "mission_id": "mission_1793725750981_1", "title": "MCP 名册供给闭环验证",
                          "phase": "running", "auto_confirm_applied": true,
                          "units": [ { "id": "unit_character_1793725749271_1", "name": "Neo" } ],
                          "dropped_units": 0, "created_at": 1793725750981, ... } }
```

**④ 名册里看得见这个角色，且它已挂在编组任务上**（`stratix_world_snapshot` 的 `characters` / `units` / `missions` 三段）：

```
characters → { "returned": 1, "total": 1, "items": [
                 { "id": "character_1793725749271_1", "name": "Neo",
                   "agent_kind": "claude-code", "level": 1, "online": true } ] }
units     → { "returned": 1, "total": 1, "items": [
                 { "id": "unit_character_1793725749271_1", "name": "Neo", "status": "idle",
                   "online": true, "character_id": "character_1793725749271_1",
                   "mission_id": "mission_1793725750981_1" } ] }
missions  → { "returned": 1, "total": 1, "items": [
                 { "id": "mission_1793725750981_1", "title": "MCP 名册供给闭环验证",
                   "phase": "running", "unit_count": 1 } ] }
totals    → { "units": 1, "missions": 1, "tasks": 0, "characters": 1 }
```

**⑤ 三条拒绝路径（都是"说人话"而不是干巴巴的码）**：

```
# 重名（大小写不敏感）
{ "ok": false, "error": { "code": "invalid_arguments",
  "message": "名册里已有同名角色「neo」",
  "hint": "换一个名字（重名按大小写不敏感判定），或用 stratix_registry 看现有名册" } }

# 名字缺失
{ "ok": false, "error": { "code": "invalid_arguments", "message": "参数 name 缺失",
  "hint": "补齐必填参数 name 后重试" } }

# 原型取值非法
{ "ok": false, "error": { "code": "invalid_arguments",
  "message": "参数 archetype 只能是：claude-code / codex / opencode / kimi / openclaw / dsh",
  "hint": "按工具 description 里的边界改参数后重试" } }
```

**⑥ 回归**：

```
npx tsc --noEmit                                       → 零输出（exit 0）
npx jest src/stratix-gateway/mcp --silent --maxWorkers=1 → Test Suites: 14 passed / Tests: 150 passed
```

## 6. 未尽事项

- **MCP 建的角色在 headless 网关模式下**不落库**：实测重启网关后 `stratix_registry` 的 `characters` 为空（`totals: {"agents":12,"characters":0,"units":0}`），启动日志同样显示 `boot ok（characters=0 units=0 …)`。原因是**落库链路挂在渲染进程一侧**（`app/services/persistence/game-save-coordinator` 靠 diff 渲染侧 store 落库），网关进程只负责**读**（`service/world-restore.ts`）。本任务不碰持久化拓扑（超出范围，且会动到 app/渲染层），但外部 agent 若靠 MCP 建角色，需要知道"重启即失"；同理 missions 是纯内存（既有事实，见 task_120 工作文档）。
- **本工具只建档、不改档**：改名 / 改人设 / 换皮肤仍走界面（`character.edit` 面未开放给 MCP），已在工具描述的「何时不用」里写明。
- **未安装的 CLI 也能建档**：`archetype` 取值只校验"是不是 core 词表里的六家"，不校验本机装没装 —— 绑定未安装的 CLI 会在**派单**时被拒（`agent_not_installed`）。这一层校验属于"派单"语义，不属于"建档"，故不在本工具里做。
- **`stratix_session_fork` 的规范条目仍待补**（沿自 task_120，本次未动）。
