# Stratix MCP 接口设计规范（第一期工具面 + 扩展规范）

> **状态**：第一期冻结（Spec v1.2）　**性质**：规范文档（不含实现代码）
> **适用范围**：Stratix 对外提供的 MCP server 及其工具面（tool surface）
> **取代**：`docs/MCP_SERVER_DESIGN.md`（v2 Zone 时代草案 —— Zone 已按 `docs/REFACTOR_PLAN_V3.md` D5 决策砍掉，其中 `stratix.list_zones` 等工具面不再成立）
> **维护责任**：见 [§5.4](#54-规范文档的维护责任)
> **版本演进**：见 [§5.5](#55-版本演进记录只加不删)（只加不删 —— 每一行变更都追加，旧行不改不删）

---

## 目录

- [0. 设计前提](#0-设计前提)：[0.1 消费者与心智模型](#01-消费者与心智模型)｜[0.2 权威依据](#02-权威依据)｜[0.3 范围与非目标](#03-范围与非目标)｜[0.4 术语](#04-术语)｜[0.5 拓扑定位](#05-拓扑定位新旧拓扑对比)
- [1. 工具设计五原则](#1-工具设计五原则)：[1.1 动词 + 资源命名，单动作工具](#11-原则一动词--资源命名单动作工具)｜[1.2 合并发生在工具内部](#12-原则二合并发生在工具内部)｜[1.3 返回 meaningful context](#13-原则三返回-meaningful-context)｜[1.4 token 效率](#14-原则四token-效率)｜[1.5 描述工程](#15-原则五描述工程)
- [2. 第一期工具面](#2-第一期工具面)：[2.0 通用约定](#20-通用约定)｜[2.1 world_snapshot](#21-stratix_world_snapshot)｜[2.2 task_assign](#22-stratix_task_assign)｜[2.3 task_status](#23-stratix_task_status)｜[2.4 task_cancel](#24-stratix_task_cancel)｜[2.5 mission_create](#25-stratix_mission_create)｜[2.6 mission_status](#26-stratix_mission_status)｜[2.7 chat_send](#27-stratix_chat_send)｜[2.8 registry](#28-stratix_registry)｜[2.9 mission_checkpoint](#29-stratix_mission_checkpoint)
- [3. 一致性铁律](#3-一致性铁律)：[3.1 投影而非新功能层](#31-投影而非新功能层)｜[3.2 状态机约束](#32-状态机约束对-mcp-同样生效)｜[3.3 不暴露的能力](#33-mcp-不暴露的能力)｜[3.4 只读与写的分界](#34-只读面与写面的分界)
- [4. 扩展规范](#4-扩展规范)：[4.1 工具注册表架构](#41-工具注册表架构)｜[4.2 域前缀与命名位](#42-域前缀与命名位)｜[4.3 新工具上线流程](#43-新工具提案到上线的流程)｜[4.4 MCP server 接入方式](#44-mcp-server-的接入方式)
- [5. 版本与演进](#5-版本与演进)：[5.1 变更原则](#51-工具面变更原则)｜[5.2 重命名与废弃](#52-重命名与废弃)｜[5.3 变更分类](#53-变更分类与流程)｜[5.4 维护责任](#54-规范文档的维护责任)｜[5.5 演进记录](#55-版本演进记录只加不删)
- [附录](#附录-a返回信封与错误码总表)：[A 信封与错误码](#附录-a返回信封与错误码总表)｜[B description 模板](#附录-bdescription-写作模板)｜[C 评审清单](#附录-c新工具评审清单)

---

## 0. 设计前提

### 0.1 消费者与心智模型

Stratix 是本地 agent 团队指挥台：角色绑定 CLI agent（Claude Code / Codex / OpenCode / Kimi / OpenClaw …），task 派单，mission 编组。MCP server 的消费方**不是人**，而是**CLI agent harness** —— 已跑在 Claude Code / OpenCode / OpenClaw 里的模型实例。三条取向随之而来：

1. **形状对齐，不做创新**：模型后训练已熟悉 Claude Code 系工具风格（动词 + 资源、参数直白、错误自解释）。接口相似即零学习成本迁移；为"更优雅"发明新范式是负收益。
2. **模型是调用者，不是终端用户**：返回值的第一读者是模型，它要据此决定**下一步调什么**。故返回必须带"状态 + 查法"，而不是给人看的漂亮文本。
3. **上下文预算是硬约束**：任务窗口里有系统提示、人设、战场快照、工具清单。工具返回多一个字段都是乘数 → 默认摘要、展开按需。

### 0.2 权威依据

| 依据 | 我们从中取的规则 |
|------|------------------|
| MCP 官方规范（server/tools）+ 官方 server 实现惯例 | 工具以 `name` / `description` / `inputSchema` 描述，`inputSchema` 是 JSON Schema；工具执行错误用结果里的 `isError` 表达，协议/参数错误走 JSON-RPC error；分页列表结果顺序必须稳定（游标语义），否则客户端无法缓存；工具名用 `snake_case`（官方 filesystem server 的 `read_file` / `list_directory` / `move_file` 是既成事实） |
| Anthropic《Writing effective tools for agents》 | 工具粒度贴合 agent 的真实决策点；描述写清"何时用 / 何时不用"；返回给 agent 下一步所需的信息，且省 token |
| Stratix 仓库既有铁律 | 工具是 `core` 总线契约（`HudCommand` / `WorldState`）的投影，不是新功能层（§3） |
| [SERVICE-SPLIT-PLAN.md](SERVICE-SPLIT-PLAN.md) §2 / §5 铁律 1·2·6 | 真相唯一（MCP 与 service 同进程同实例，见 [§0.5](#05-拓扑定位新旧拓扑对比)）；裁决在 core（写走 `emitCommand`）；存储独占（写在本进程，其余经 API 读） |

> 本文档不逐条引用规范原文。涉及"规范要求"的表述以强度标注：**须** = 违反即打回；**宜** = 默认做法，偏离须在评审记录里说明理由。

### 0.3 范围与非目标

**范围内**：工具的命名、参数、返回、错误语义；工具与 Stratix 内部状态机的映射；扩展与演进流程。

**范围外（第一期明确不做）**：❌ MCP resources / prompts 暴露（第一期只做 tools，resources/prompts 取舍待第二期单独评审）；❌ 渲染层操作（相机、选择集、小地图、编组槽位、主题色，见 §3.3）；❌ 文件系统读写（agent 自带文件工具，Stratix 的磁盘不是共享工作面）；❌ 流式推送（MCP 是请求-响应模型，实时流靠轮询快照获得）。

### 0.4 术语

**域（domain）** = 命名空间与工具名前缀（`world` / `task` / `mission` / `chat` / `registry`，未来的 `zone` / `pipeline` …）；**动作（verb）** = 工具做的那个动作（取自受控词表 `list` / `get` / `create` / `assign` / `send` / `cancel` / `snapshot` …）；**资源（resource）** = 动作作用的实体（`task` / `mission` / `character` / `world`）；**受理回执** = 写操作成功后返回的"状态句"（标识 + 状态 + 下一步查法）；**通道（channel）** = 调用进来的通路（`ui` / `mcp` / `script` / `agent`，进审计用）。

**依赖解锁（dependency unlock）** = 某条编组任务的**前置任务全部进入终态**（`done` / `cancelled`）后，这条任务**变为可被确认**。解锁**不是新相位** —— 真相在相位上，判定现算即得（`isMissionUnlocked`）；"解锁"只是"允许确认"的结论，且**不自动确认**（谁来确认仍需显式动作）。**brief（任务正文契约）** = 挂在编组任务上的结构化正文（需求 / 验收标准 / 交付物 / 约束），是关于"这件事要做成什么样"的长期事实，与「派单 prompt」（派给执行者的一句话指令）分开。**检查点（checkpoint）** = 编组任务上的一条 **append-only 记账行**（这一刻发生了什么），**不改相位**，终态任务不再接受记账。

### 0.5 拓扑定位（新旧拓扑对比）

> **真相源**：[SERVICE-SPLIT-PLAN.md](SERVICE-SPLIT-PLAN.md)（目标拓扑 §2 + 迁移期双模式 §8）｜[WORLD-SYNC.md](WORLD-SYNC.md)（视图侧 WS 协议）

本规范说的是**工具面**（MCP tools）。工具面挂在哪儿、真相在谁身上，是拓扑问题 —— 说清楚它，工具的返回值才有确定口径。

#### 新拓扑（现行）：MCP 与 service 同进程，见真状态

```
                    ┌────────────────────────────────────────┐
                    │  Service（gateway 进程，常驻 daemon）    │
                    │  core runtime ── mission/task 状态机    │
                    │  task-service（执行环，直接 spawn CLI）   │
                    │       │                                 │
                    │       ▼                                 │
                    │  cli-transport ──► claude / kimi 子进程 │
                    │  SQLite（独占写）                        │
                    │  ┌──────────┬──────────┬──────────┐     │
                    │  │ MCP      │ REST API │ WS       │     │
                    └──┴────▲─────┴────▲─────┴────▲─────┴─────┘
                           │stdio      │HTTP      │WS (world-sync)
        ┌──────────────────┘           │          └───────────────┐
        ▼                              ▼                          ▼
  外部 MCP client               浏览器/API client          Electron 壳（可选）
  （Claude Code 等）                                        hud/world 纯视图
```

对 MCP 这一侧的三个要点：

1. **同进程同实例**：gateway 启动时**先 boot service 再挂 `/mcp` 路由**（`src/stratix-gateway/index.ts`），故 `createCoreMcpHost({ store: service.store })` 拿到的是 service 持有的那份 core store —— **工具看见的是真战场**（改造前是空 store，`units` 恒为 0）。
2. **写只有一条路**：工具的写操作一律 `emitCommand` 投给 core 状态机裁决（§3.2），MCP 不自己改 store。派单后回读状态核对结果，命令没人接管时报 `internal_error`（明说"没落地"），**绝不假装成功**。
3. **大件走 REST 不走广播**：任务全文只从 SQLite 读（§2.3），跨进程读走 `GET /api/storage/tasks/:id/output`；world-sync 的 `snapshot` 只带摘要 —— 与 §3.1「投影而非新功能层」同口径。

#### 旧拓扑（改造前 · 已退役）：MCP 与战场不同进程，看不见战场

```
┌──────────────────────── Electron 进程 ────────────────────────┐
│  ┌──────────────────────────────┐                             │
│  │  渲染进程 = 组合根            │                             │
│  │  core runtime（世界态住在渲染里）│                             │
│  │  task-service                 │                             │
│  └───────────┬──────────────────┘                             │
│              │ IPC（chat:run / chat:abort）                   │
│  ┌───────────▼──────────────────┐                             │
│  │  Electron main               │                             │
│  │  CLI spawn（唯一 spawn 点）    │                             │
│  │  SQLite 写（多进程开同一文件） │                             │
│  └──────────────────────────────┘                             │
└───────────────────────────────────────────────────────────────┘
        ▲ 关掉窗口 = 大脑停机（agent 一起死）
        │
   gateway /mcp（挂在空 store 上 → units 恒为 0，看不见战场）
```

旧拓扑的四处要害 —— 与新拓扑逐条对照：

| 维度 | 旧拓扑 | 新拓扑 |
|------|--------|--------|
| 大脑（core runtime） | 渲染进程 | **service 常驻进程** |
| 关掉 Electron | agent 一起停机 | **只丢视图，agent 照跑** |
| CLI spawn 点 | Electron main（经 IPC 中转） | **service 直接 spawn** |
| 存储 | 多进程开同一个 SQLite | **service 独占写，其余经 API 读** |
| MCP 能否见战场 | 看不见（units 恒为 0） | **同进程真态** |
| 视图数据源 | 进程内直连 core store | **WS world-sync 全量快照** |
| 客户端数量 | 一个 Electron | **多客户端（MCP / REST / WS / 多个壳）** |

> **旧路径的退役标记**（只注不删，铁律 7）：`src/electron/main.ts` 的 CLI spawn 职责段、`src/app/main/main-entry.ts` 的本地直连装配/开关段、`src/stratix-gateway/mcp/context.ts` 里已过时的跨进程拓扑说明段 —— 三处均已打 `@deprecated` 并写明迁移指引。迁移期双模式（远程 `STRATIX_REMOTE=1` / 本地回退不设）见 [SERVICE-SPLIT-PLAN.md §8](SERVICE-SPLIT-PLAN.md#8-收尾节迁移期双模式)。

---

## 1. 工具设计五原则

每条给出：**规则**（可判定）→ **正例** → **反例**。正反例全部取自 Stratix 真实场景并给出代码依据位置。

### 1.1 原则一：动词 + 资源命名，单动作工具

**规则**：① 名称形态 `stratix_<域>_<动词>_<资源>`（单域工具可省域，如 `stratix_registry`），全小写 `snake_case`；② 一个工具**只对应一个状态迁移或一个只读查询**；③ **禁止 `action` 万能参数** —— 不得出现 `action: 'create' | 'cancel' | 'status'` 这类把多动作压进一个枚举的写法；④ 允许的参数化维度是**过滤/选择**（`filters`、`include_output`）而非动作分支 —— 过滤器不改变状态，且各有独立 schema 描述。

**正例**：`stratix_task_assign` / `stratix_task_status` / `stratix_task_cancel` 是三个工具，因为它们对应三条互不相同的世界状态迁移：派单 → `HudCommand.task.assign`（`src/core/types.ts` 第 1133 行起，联合类型定义在第 964 行起）；取消 → `task.cancel`（第 1146 行）；查状态 → 只读 `WorldState.tasks`。三者的参数与边界完全不同：取消**只认 `queued` 相位**（`src/core/task/machine.ts` 的 `applyTaskAction` → `cancel` 分支），running 与终态一律 `illegal-transition` —— 拆成三个工具，"取消不了"这条边界就写在 `stratix_task_cancel` 的 description 里，模型看到就知道该先 `stratix_task_status`。

**反例**：

```jsonc
// ❌ action 万能参数
{ "name": "stratix_task", "inputSchema": { "properties": {
    "action": { "enum": ["assign", "status", "cancel"] }, "id": { "type": "string" },
    "prompt": { "type": "string" } } } }
```

① **参数条件无法表达**：`prompt` 只在 `assign` 时必填，`id` 只在 `status`/`cancel` 时必填；JSON Schema 只能全写可选，于是 `assign` 不给 prompt 也过校验，直到运行时才报错。② **枚举猜错成本高**：模型须先猜对 `action` 字面量，猜错得到的是"非法枚举值"而不是"你少了一步"。③ **边界语义被稀释**："仅 queued 可取消"藏在某个分支里，模型读 description 读不到，只能试错。

### 1.2 原则二：合并发生在工具内部

**规则**：① 一个工具可把**多个既有状态迁移串起来**完成一个业务动作（多步 workflow 合成一次调用）；② 合并是"内部串起既有迁移"，**不是**"把多动作塞进一个工具的枚举参数"（与原则一互为反面）；③ 合并必须**原子** —— 串中任一步非法则整次调用失败，不留半截状态；④ 合并步骤必须在 description 里写出来（模型要知道一次调用背后发生了什么）。

**正例**：`stratix_mission_create(title, units, auto_confirm=true)` 一次调用完成三件事 —— 建任务 `mission.create`（`src/core/types.ts` 第 1016 行）→ 指派编组 `mission.assign`（第 1009 行）→ 接单开工 `mission.confirm(decision='accept')`（第 1010 行）。关键在第三步：`src/core/mission/manager.ts` 的 `decideMission` 在 `accept` 时把 `decide` 与 `start` 两个状态机动作**合并进同一次写入**（`[{ type: 'decide', decision }, { type: 'start' }]`），落点即 `running`；同文件的 `commit` 是**原子**口径 —— 串中任一步非法则整条作废、状态原样返回。业务上这叫"发起一个已接单开工的编组任务"，在人类语境里就是一句话，不该拆成三次调用。

**反例**：

```jsonc
// ❌ 多动作塞一个工具
{ "name": "stratix_mission", "inputSchema": { "properties": {
    "action": { "enum": ["create", "assign", "confirm", "cancel"] }, "mission_id": { "type": "string" },
    "title": { "type": "string" }, "unit_ids": { "type": "array" } } } }
```

调用方被迫自己记顺序："先 create（拿 mission_id）→ 再 assign → 再 confirm"。而 `confirm` **只认 `pending` 相位**（`src/core/mission/machine.ts` 的 `decide` 分支，`current.phase !== 'pending'` 即拒），顺序错了只得到 `illegal-transition`，且错误不告诉你"漏了上一步"。更糟的是 `create` 与 `assign` 拆开后，`create` 产生的**草稿任务**（`unitIds` 为空 → `phase='draft'`）会滞留战场 —— 调用方在两次调用之间中断，就留下一条永远没人接的孤儿任务。

### 1.3 原则三：返回 meaningful context

**规则**：① **禁止裸成功返回**（`{ "ok": true }` / `"done"` 一律不接受）；② 写操作必须返回**受理回执**，至少含三要素 —— **标识**（`task_id` / `mission_id`）、**状态**（落点相位 + 被作用对象的名字）、**状态查询方法**（`poll: { tool, args }`，机器可执行）；③ 只读操作必须返回**可直接使用的结论**，而不是原始数据块；④ 失败返回必须带**机器可读错误码** + 一句话 `message` + 下一步建议 `hint`。

**正例**（完整样例见 §2.2）：`{ "ok": true, "data": { "task_id": "task_1754..._3", "character": { "id": "ch_kimi", "name": "Kimi" }, "status": "queued", "mission_id": null, "poll": { "tool": "stratix_task_status", "args": { "task_id": "task_1754..._3" } } } }` —— 模型据此知道：单号是什么、派给了谁、现在在排队、想看结果调哪个工具带什么参数，**下一次调用的参数不需要模型去猜或回忆**。

**反例**：`{ "ok": true }` —— 模型：任务 id 呢？我怎么查它？`{ "ok": false, "message": "派单失败" }` —— 没绑定 agent？角色不存在？队列满了？三种情况的补救完全不同。

### 1.4 原则四：token 效率

**规则**：① **默认摘要，展开按需** —— 任何可能很大的字段（任务输出全文、任务指令全文、角色人设、聊天历史）默认只回摘要，全文用显式参数按需展开；② **列表默认有界** —— 任何列表返回带截断标记（`truncated` + `returned` / `total`）；③ **不回内部噪声** —— 不返回数据库主键、内部序号、渲染用 id、协议行（如 `PLAN_WAIT` 标记）；④ **默认响应体量目标**：单工具默认响应 ≤ **约 800 token**；⑤ **不重复上下文里已有的东西** —— 快照类工具不重复回灌模型刚拿到的回执。

**正例**：`stratix_task_status` 默认返回**摘要**输出 —— Stratix 本身就这样设计：`CharacterTask.output` 在 core 里**只存摘要**（上限 `MAX_TASK_SUMMARY_LEN = 2000`，`src/core/types.ts` 第 82 行），全文落 SQLite 的 `tasks` 表（第 351 行注）；MCP 沿用这个分寸，`include_output=true` 才去取全文。`stratix_world_snapshot` 同理：`missions` 上限 100（`MAX_MISSIONS`）、`tasks` 上限 100（`MAX_TASKS`）、`characters` 上限 64（`MAX_CHARACTERS`），一次全量回灌必然撑爆上下文，故默认按 `filters` 切片 + `limit` 收口。

**反例**：`{ "ok": true, "data": { "characters": [/* 64 个角色，含完整人设 */], "tasks": [/* 100 条任务，含每条完整输出全文 */], "missions": [/* 100 条，含指派名单 */], "notices": [/* 50 条 */] } }` —— 这是把 `WorldState` 整个 JSON 化发给模型：几万 token，且九成内容与当前决策无关。模型真正需要的通常只是"现在谁在忙、有什么在办"。

### 1.5 原则五：描述工程

**规则**：每个工具的 `description` 须含四要素，缺一不可 —— **何时用**（解决哪类问题、典型场景；反例写法："任务相关工具"）、**何时不用**（明确排除的场景，指向正确工具；不写 → 模型乱用）、**边界情况**（相位限制、上限、默认值、截断行为；不写 → 模型只能试错）、**错误语义**（会遇到哪些错误码、含义、是否可重试；不写 → 模型把可重试错误当致命错误）。**风格**：祈使句、点名具体对象、不寒暄、不重复工具名 —— 像 Claude Code 的工具说明那样，写"用这个做 X，用那个做 Y"。

**正例**（`stratix_task_assign` 的完整 description 见 §2.2）：四要素齐备 —— "何时用"给出典型场景（写代码 / 查资料 / 审阅），"何时不用"点名替代工具（`stratix_chat_send` / `stratix_mission_create`），"边界"写明并发度、超时上限、`mission_id` 的回报语义，"错误"逐条列出错误码并标注可重试性。

**反例**："这个工具用于任务相关的操作。" —— 四要素全缺，模型只能靠猜或试错消耗轮次。"这是一个非常强大的工具，可以帮助你完成各种任务分配工作！" —— 形容词不携带任何决策信息。

---

## 2. 第一期工具面

### 2.0 通用约定

**命名**：全部 `stratix_` 前缀 + `snake_case`，禁止 `stratix.` 点号分隔（点号不是合法标识符字符，且 MCP 生态惯例是下划线）。

**工具清单的确定性顺序**：`tools/list` 按每件工具自己的**排序位**（`ToolSpec.order` = 工具在清单里的位次）稳定返回；同位再按工具名**码位序**兜底（不用 `localeCompare` —— locale 相关排序跨环境不稳定）。不排序或按注册顺序排会让客户端提示词缓存随服务重启抖动 —— 顺序稳定是缓存友好的前提，也是 MCP 分页游标语义的前提。

**排序位 ≠ 本文档的条目号**：两者**不再逐一对应**，是两套编号。条目号按「只加不删」递增（新条目永远追加在末尾，如 §2.9）；排序位按**域聚拢**（`mission` 域的工具挨在一起）。新增工具时：条目号取当前最大条目号 +1，排序位插进自己域的位置 —— 既有工具之间的相对次序不变。

**返回信封**：统一信封，成功 `ok=true`；失败 `ok=false` 且 MCP 结果带 `isError=true`（业务失败），**协议级/参数级失败**走 JSON-RPC error（不设 `isError`）。完整定义见[附录 A](#附录-a返回信封与错误码总表)。

```jsonc
// 成功
{ "ok": true, "data": { /* 工具特有载荷 */ } }
// 失败（isError = true）
{ "ok": false, "error": { "code": "character_offline", "message": "「Kimi」当前离线，任务无法执行",
                          "retryable": true, "hint": "等 CLI 恢复在线后重新派单，或换一位在线角色" } }
```

**core / app 错误码 → MCP 错误码映射**（MCP 码是 core 码的稳定超集，映射只在附录 A 一处维护）：

| core / app 侧来源 | MCP 错误码 |
|--------------------|-----------|
| `MissionRejectionCode.not-found`（`src/core/mission/manager.ts` 第 44 行） | `mission_not_found` |
| `MissionRejectionCode.empty-title` / `TaskRejectionCode.empty-prompt` / `prompt-too-long` | `invalid_arguments` |
| `MissionRejectionCode.limit-exceeded` / `TaskRejectionCode.limit-exceeded` | `mission_capacity_exceeded` / `task_capacity_exceeded` |
| `MissionRejectionCode.illegal-transition` / `MissionErrorCode.illegal-transition` | `illegal_transition` |
| 终态拒绝（`appendMissionCheckpoint` 的终态分支，`src/core/mission/machine.ts`） | `mission_terminal` |
| `TaskRejectionCode.not-found` | `task_not_found` |
| `TaskRejectionCode.illegal-transition` / `TaskCancelOutcome.code='not-queued'` | `task_not_cancellable` |
| `guardTaskCharacter` → `TASK_MSG_NO_PROFILE`（`src/app/services/task-service.ts`） | `unknown_character` |
| `guardTaskCharacter` → `TASK_MSG_UNBOUND` / `TASK_MSG_NOT_INSTALLED` / `taskOfflineReason(...)` | `character_unbound` / `agent_not_installed` / `character_offline` |

**origin 审计字段**：所有写类工具接受可选 `origin`，取值 `ui` | `mcp` | `script` | `agent`。

- 缺省时服务端按**调用通道**自动标注：经 MCP 进来的记 `mcp`。
- **经 MCP 派单且派单方本身是 agent 时，必须显式传 `origin='agent'`** —— 审计面要能区分"人派的单"和"agent 派的单"；这是审计要求而非装饰，不显式标注则所有经 MCP 的派单都记成 `mcp`，事后无法追责。
- 传其它值 → `invalid_arguments`。**允许的显式值只有 `agent` 与 `script`**：`mcp` 冗余（缺省即它），`ui` 拒绝 —— UI 通道的事实不许由 MCP 冒充。

### 2.1 `stratix_world_snapshot`

**description**

> 读取战场现状快照：当前在场的单位（agent）、在办与历史任务、角色名册。
> **何时用**：派单前确认"谁现在空闲"、判断某任务的进展、汇报当前战况。
> **何时不用**：只想看一条任务的细节 —— 用 `stratix_task_status`；只想看某条编组任务 —— 用 `stratix_mission_status`。
> **边界**：只读，不改变任何状态。默认只回计数与精简条目（每段最多 `limit` 条，默认 20、上限 100）；被截断时 `truncated=true` 且 `returned < total`。不返回角色人设全文与任务输出全文。
> **错误**：`invalid_arguments`（过滤器取值非法）。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "filters": {
      "type": "object",
      "properties": {
        "domains": { "type": "array", "items": { "type": "string", "enum": ["units", "missions", "tasks", "characters"] }, "description": "要哪几段。缺省 = 全部四段。" },
        "unit_ids": { "type": "array", "items": { "type": "string" }, "description": "只看这些单位。" },
        "unit_status": { "type": "array", "items": { "type": "string", "enum": ["idle", "busy", "offline", "error"] } },
        "mission_phase": { "type": "array", "items": { "type": "string", "enum": ["draft", "pending", "confirmed", "running", "done", "cancelled"] } },
        "task_status": { "type": "array", "items": { "type": "string", "enum": ["queued", "running", "awaiting_approval", "completed", "failed", "cancelled"] } },
        "character_ids": { "type": "array", "items": { "type": "string" } },
        "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

**返回（成功）**

```json
{ "ok": true, "data": {
  "taken_at": 1754000000000, "totals": { "units": 6, "missions": 2, "tasks": 3, "characters": 4 },
  "units": { "returned": 6, "total": 6, "truncated": false, "items": [
    { "id": "unit_kimi", "name": "Kimi", "status": "busy", "online": true, "character_id": "ch_kimi", "mission_id": "mission_1753..._1" } ] },
  "missions": { "returned": 2, "total": 2, "truncated": false, "items": [
    { "id": "mission_1753..._1", "title": "重构路由层", "phase": "running", "unit_count": 2 } ] },
  "tasks": { "returned": 3, "total": 3, "truncated": false, "items": [
    { "id": "task_1754..._3", "character_id": "ch_kimi", "status": "running", "created_at": 1754000000000, "summary": "补一条单测覆盖…" } ] },
  "characters": { "returned": 4, "total": 4, "truncated": false, "items": [
    { "id": "ch_kimi", "name": "Kimi", "agent_kind": "kimi", "level": 7, "online": true } ] } } }
```

**映射**：只读 `WorldState`（`src/core/types.ts` 第 894 行）的投影，不落任何命令。

### 2.2 `stratix_task_assign`

**description**

> 派一条角色任务：把一段自由文本指令交给指定角色，由该角色绑定的 CLI agent 执行，产出文本结果。
> **何时用**：需要某个角色干一件具体的事（写代码、查资料、审阅）。
> **何时不用**：只问一句话或要一次讨论 —— 用 `stratix_chat_send`；要编组多人协同 —— 用 `stratix_mission_create`。
> **边界**：每个角色串行执行（并发 1），入队即返回、不等执行完。任务最长 `timeout_ms`（默认 600000，上限 600000），超时判失败。`mission_id` 给了就把该任务挂在这条编组任务上，任务终态自动回报给它（完成 → 编组任务收尾；失败 → 按中止收尾）。
> **错误**：`unknown_character` / `character_unbound` / `agent_not_installed` / `character_offline`（可重试）/ `task_capacity_exceeded`（可重试）/ `invalid_arguments`（prompt 为空或超长、origin 非法）。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "character": { "type": "string", "description": "角色 id（见 stratix_registry）。" },
    "prompt": { "type": "string", "minLength": 1, "maxLength": 20000, "description": "任务指令原文。上限 20000 码点（MAX_TASK_PROMPT_LEN）。" },
    "mission_id": { "type": ["string", "null"], "description": "关联的编组任务 id；缺省 = 普通派发。" },
    "timeout_ms": { "type": "integer", "minimum": 1000, "maximum": 600000, "default": 600000, "description": "执行超时（毫秒）。" },
    "origin": { "type": "string", "enum": ["agent", "script"], "default": "mcp", "description": "审计来源。缺省按调用通道记为 mcp；agent 经 MCP 派单必须显式传 agent。" }
  },
  "required": ["character", "prompt"],
  "additionalProperties": false
}
```

**返回（成功）**

```json
{ "ok": true, "data": {
  "task_id": "task_1754..._3",
  "character": { "id": "ch_kimi", "name": "Kimi", "agent_kind": "kimi" },
  "status": "queued", "mission_id": null, "origin": "agent", "timeout_ms": 600000, "queued_at": 1754000000000,
  "poll": { "tool": "stratix_task_status", "args": { "task_id": "task_1754..._3" } } } }
```

**映射**：`HudCommand.task.assign`（`src/core/types.ts` 第 1133 行）→ `core/task/manager` → app 层 `task-service` 出队执行。

**边界补充**：`timeout_ms` 是**执行期**超时，属 app 层执行器口径（`src/app/services/task-service.ts` 的 `DEFAULT_TASK_TIMEOUT_MS = 600_000`），不进 core 契约（core 契约文件零 IO，见 `src/core/types.ts` 文件头禁止事项 4）；若执行器尚未支持单任务超时，服务端按缺省 600000 执行并在回执里回显实际生效值。**守门说明**：core / app 侧守门（`guardTaskCharacter`）在**出队时**裁决，不满足时任务落 `failed`（状态里看得见原因）；MCP 侧在**入队前**做同一份守门的前置检查，不满足直接以错误码拒绝 —— 省一次轮询、错误更明确，且**不改变 app 层的裁决权**（app 侧仍会再守一次）。

### 2.3 `stratix_task_status`

**description**

> 读取一条角色任务的当前状态与结果摘要。
> **何时用**：派单后查进展；任务回报完成时取结果。
> **何时不用**：只想知道"还有谁在忙" —— 用 `stratix_world_snapshot`；要取消一条排队中的任务 —— 用 `stratix_task_cancel`。
> **边界**：`include_output=false`（缺省）时 `output` 是**摘要**（core 侧 `CharacterTask.output` 本就只存摘要，上限 2000 码点）；`include_output=true` 时取 SQLite 里的**全文**（可能很长，仅在确需原文时用）。任务处于 `awaiting_approval` 时额外返回 `plan`（计划草稿，待用户裁决；此时任务不会自行继续）。
> **错误**：`task_not_found`。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "task_id": { "type": "string" },
    "include_output": { "type": "boolean", "default": false, "description": "true = 返回执行结果全文；false = 只回摘要。" }
  },
  "required": ["task_id"],
  "additionalProperties": false
}
```

**返回（成功）**

```json
{ "ok": true, "data": {
  "task_id": "task_1754..._3",
  "character": { "id": "ch_kimi", "name": "Kimi" },
  "status": "completed", "mission_id": "mission_1753..._1",
  "created_at": 1754000000000, "started_at": 1754000010000, "ended_at": 1754000075000,
  "output": "已补 3 条单测：…（摘要，截断至 2000 码点）", "output_truncated": true, "plan": null,
  "poll": { "tool": "stratix_task_status", "args": { "task_id": "task_1754..._3" } } } }
```

**映射**：只读 `WorldState.tasks`（`src/core/types.ts` 第 937 行）；`include_output=true` 时额外读 SQLite 的 `tasks` 表全文。

### 2.4 `stratix_task_cancel`

**description**

> 取消一条**排队中**的角色任务。
> **何时用**：派错了单、任务不再需要，在它开跑之前叫停。
> **何时不用**：任务已经在跑 —— 取消**不杀在跑的任务**，此时会返回 `task_not_cancellable`（在跑的任务只能等它跑完或失败）；任务已终态 —— 同上，历史不改写。
> **边界**：只有 `queued` 相位可取消；`running` / `awaiting_approval` / 终态一律拒绝并回当前相位。取消不产生结果输出（`output` 恒为固定占位文案「任务在排队时被取消」）。
> **错误**：`task_not_found` / `task_not_cancellable`。

**inputSchema**

```json
{ "type": "object", "properties": { "task_id": { "type": "string" } }, "required": ["task_id"], "additionalProperties": false }
```

**返回（成功）**

```json
{ "ok": true, "data": {
  "task_id": "task_1754..._4", "status": "cancelled", "previous_status": "queued",
  "output": "任务在排队时被取消",
  "poll": { "tool": "stratix_task_status", "args": { "task_id": "task_1754..._4" } } } }
```

**映射**：`HudCommand.task.cancel`（`src/core/types.ts` 第 1146 行）→ `core/task/manager.ts` 的 `cancelTask`，其结构化结果区分 `not-found` 与 `not-queued`（`TaskCancelOutcome`）。

### 2.5 `stratix_mission_create`

**description**

> 新建一条编组任务（mission）并指派给一组战场单位；默认一次性完成"建任务 → 指派 → 接单开工"，直接进入 `running`。
> **何时用**：需要多个角色协同完成一件事（一个写代码、一个审阅、一个出文档）。
> **何时不用**：只派一个人 —— 用 `stratix_task_assign`；只想查现有编组任务 —— 用 `stratix_mission_status`。
> **边界**：`units` 是战场单位 id 列表（可空；空 = 草稿任务，不会自己开工）。单位 id 不存在时**静默剔除**并在 `dropped_units` 里报数（不猜、不报错）。`auto_confirm=false` 时任务停在 `pending` 待确认 —— 第一期 MCP 不提供确认工具，确认留给 UI 面板裁决（core 口径：`confirm` 只认 `pending`）。编组任务上限 100 条，超限拒绝新建。
> **正文与依赖**：`brief` 是这条任务的结构化正文契约（`requirements` 需求 / `acceptance` 验收标准 / `deliverables` 交付物 / `constraints` 约束），四段皆可选，**只记不校验**（不会自动写进派单 prompt）。`depends_on` 是前置编组任务 id 列表（上限 32）：**带依赖的编组会在依赖满足前拒绝 `confirm`** —— 任务停在 `pending`，回执的 `blocked_by_dependencies` 报出还差哪几个前置（这是**正常结果**，不是失败：任务已建成，只是还不能开工）。
> **错误**：`invalid_arguments`（title 为空或超长 / brief 段名非法或超长 / `depends_on` 超 32 条）/ `mission_capacity_exceeded`（可重试）/ `illegal_transition`。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string", "minLength": 1, "maxLength": 200, "description": "任务标题。core 只校验非空，200 码点上限是 MCP 侧自设（防超长标题进状态广播）。" },
    "units": { "type": "array", "items": { "type": "string" }, "maxItems": 256, "description": "指派的战场单位 id 列表。上限 256（MAX_SELECTION_SIZE）。" },
    "auto_confirm": { "type": "boolean", "default": true, "description": "true = 内部完成建任务→指派→接单开工（落到 running）；false = 停在 pending 待 UI 确认。" },
    "brief": {
      "type": "object",
      "properties": {
        "requirements": { "type": "string", "maxLength": 500, "description": "需求：要做什么（做什么算满足需求）。" },
        "acceptance": { "type": "string", "maxLength": 500, "description": "验收标准：怎样算做完 —— 这条任务\"算不算做完\"的判据。" },
        "deliverables": { "type": "string", "maxLength": 500, "description": "交付物：交什么出来（文件 / 报告 / 结论）。" },
        "constraints": { "type": "string", "maxLength": 500, "description": "约束：不能碰什么 / 必须怎么做。" }
      },
      "additionalProperties": false,
      "description": "任务本身的结构化正文契约（四段皆可选；只记不校验，不会自动写进派单 prompt）。"
    },
    "depends_on": { "type": "array", "items": { "type": "string" }, "maxItems": 32, "description": "前置编组任务 id 列表（上限 32）。前置未收尾时本任务不被允许确认（core 守门）。" }
  },
  "required": ["title"],
  "additionalProperties": false
}
```

> brief 四段各 500 码点上限是 **MCP 侧自设**（与 title 的 200 码点同理）：正文随 `MissionView` 进状态全量广播，而编组任务上限 100 条 —— 四段无界的正文能把一次广播撑爆。

**返回（成功）**

```json
{ "ok": true, "data": {
  "mission_id": "mission_1753..._1", "title": "重构路由层", "phase": "running", "auto_confirm_applied": true,
  "units": [ { "id": "unit_kimi", "name": "Kimi" }, { "id": "unit_codex", "name": "Codex" } ],
  "dropped_units": 0, "created_at": 1754000000000,
  "brief_fields": [ "requirements", "acceptance" ],
  "depends_on": [ "mission_1752..._1" ],
  "next": { "tool": "stratix_task_assign", "args": { "mission_id": "mission_1753..._1" }, "hint": "派具体任务时带上 mission_id，任务终态会自动回报到这条编组任务" },
  "poll": { "tool": "stratix_mission_status", "args": { "mission_id": "mission_1753..._1" } } } }
```

**返回（成功 · 依赖未满足，`confirm` 被 core 拒绝）**

```json
{ "ok": true, "data": {
  "mission_id": "mission_1753..._2", "title": "进攻北门", "phase": "pending", "auto_confirm_applied": false,
  "units": [ { "id": "unit_codex", "name": "Codex" } ],
  "dropped_units": 0, "created_at": 1754000000000,
  "depends_on": [ "mission_1752..._1" ],
  "blocked_by_dependencies": [ "mission_1752..._1" ],
  "next": { "tool": "stratix_mission_status", "args": { "mission_id": "mission_1753..._2" }, "hint": "前置任务收尾后这条才能被确认（第一期 MCP 不提供确认工具，确认留给 UI 面板）" },
  "poll": { "tool": "stratix_mission_status", "args": { "mission_id": "mission_1753..._2" } } } }
```

- `auto_confirm_applied` 的口径是"**auto_confirm 真的生效了吗**"（落到 `running` 才算生效）—— 依赖未满足时它是 `false`，不糊报"已自动开工"。
- `brief_fields` 只报**记了哪几段**（段名列表）：正文是调用方刚发来的，原样回灌是浪费上下文（§1.4）。
- `depends_on` 回**core 实际记下的**那一份（归一后：去重 / 丢自依赖 / 截断到 32）。

**映射**（一次调用内部串起三步，见 §1.2）：

```
mission.create ──▶ mission.assign ──▶ mission.confirm(accept)
                                         └─ core 内部合并 decide + start → running
```

对应 `HudCommand` 的 `mission.create` / `mission.assign` / `mission.confirm`（`src/core/types.ts` 第 1009–1016 行）。`brief` / `depends_on` 随 `mission.create` 命令透传给 core（`mission.create` 的载荷字段 `brief` / `dependsOn`），归一（trim / 丢空段 / 去重 / 丢自依赖）在 core 的 `machine.ts` 里做 —— MCP 不另写一份规则。

### 2.6 `stratix_mission_status`

**description**

> 读取编组任务（mission）的状态；带 `mission_id` 读单条，不带则列出最近的编组任务。
> **何时用**：查一条编组任务的进展与它下面的角色任务；回话前确认"这件事推进到哪了"。
> **何时不用**：查单个角色的任务 —— 用 `stratix_task_status`；查全场忙闲 —— 用 `stratix_world_snapshot`。
> **边界**：只读。列模式默认返回最近 20 条（`limit` 可调，上限 100），按创建时间倒序；被截断时 `truncated=true`。单条模式附带该任务下的角色任务摘要（任务 id、承接角色、状态）。
> **错误**：`mission_not_found` / `invalid_arguments`。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "mission_id": { "type": ["string", "null"], "description": "缺省 = 列出最近若干条编组任务。" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 }
  },
  "additionalProperties": false
}
```

**返回（成功 · 单条）**

```json
{ "ok": true, "data": {
  "mission": { "id": "mission_1753..._1", "title": "重构路由层", "phase": "running", "unit_count": 2, "created_at": 1754000000000,
    "units": [ { "id": "unit_kimi", "name": "Kimi" }, { "id": "unit_codex", "name": "Codex" } ] },
  "tasks": [
    { "id": "task_1754..._3", "character": { "id": "ch_kimi", "name": "Kimi" }, "status": "completed" },
    { "id": "task_1754..._4", "character": { "id": "ch_codex", "name": "Codex" }, "status": "running" } ],
  "task_totals": { "total": 2, "completed": 1, "running": 1, "failed": 0 } } }
```

**映射**：只读 `WorldState.missions` + 按 `CharacterTask.missionId` 关联 `WorldState.tasks`。

### 2.7 `stratix_chat_send`

**description**

> 给指定角色发一轮对话，等这一轮回复回来。
> **何时用**：提问、讨论、澄清需求 —— 需要来回对话而不是一次性交付。
> **何时不用**：要一份确定的产出物 —— 用 `stratix_task_assign`（任务有结果摘要、有超时、有归档）；要多人讨论 —— 先 `stratix_mission_create` 编组，再各自发消息。
> **边界**：本工具**同步等一轮**（受服务端单轮超时约束），返回该轮回复文本（超过 2000 码点截断并标 `reply_truncated`）。同一角色同时只允许一轮在跑；已有轮次在跑时返回 `chat_busy`，**不静默丢弃**。对话历史不随本工具返回（历史在 UI 抽屉与落库表里），需要历史请用扩展位 `stratix_chat_history`。
> **错误**：`unknown_character` / `character_unbound` / `agent_not_installed` / `character_offline`（可重试）/ `chat_busy`（可重试）/ `invalid_arguments`。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "character": { "type": "string", "description": "角色 id（见 stratix_registry）。" },
    "message": { "type": "string", "minLength": 1, "maxLength": 8000 }
  },
  "required": ["character", "message"],
  "additionalProperties": false
}
```

**返回（成功）**

```json
{ "ok": true, "data": {
  "message_id": "msg_1754..._7",
  "character": { "id": "ch_kimi", "name": "Kimi" },
  "status": "completed",
  "reply": "路由层重构已完成，改动集中在 src/hud/bridge/bus-adapter.ts…",
  "reply_truncated": false, "duration_ms": 8420, "session_id": "sess_9f2c…" } }
```

**映射**：app 层 `chat-service`（`src/app/services/chat-service.ts` 的 `ChatService.send(characterId, text)`）；单轮超时沿用其默认档（`DEFAULT_CHAT_ROUND_TIMEOUT_MS`），超时的轮次按失败语义回报（`status` 非 `completed`，附失败原因）。注意 `HudCommand.chat.send`（`src/core/types.ts` 第 1081 行）是**给外部会话（link）**用的，不是给角色发消息 —— 两者不可混用，MCP 侧只走角色会话。

### 2.8 `stratix_registry`

**description**

> 列出工作台上"可操作的对象"：可用的 CLI agent、角色名册、战场单位名册。
> **何时用**：第一次派单前查"有哪些角色、分别绑的是哪个 CLI、谁在线"；拿到 `unknown_character` 错误后查该用哪个 id。
> **何时不用**：查任务进展 —— 用 `stratix_task_status` / `stratix_mission_status`；查总体忙闲分布 —— 用 `stratix_world_snapshot`。
> **边界**：只读。返回三段：`agents`（本地 CLI agent 探测结果）、`characters`（角色名册：id、名字、绑定的 agent 种类、等级、在线位）、`units`（战场单位：id、名字、关联角色、忙闲）。**不含**角色人设全文与外部会话凭据。列表按 id 字典序稳定排序。
> **错误**：`internal_error`。

**inputSchema**

```json
{ "type": "object", "properties": {}, "additionalProperties": false }
```

**返回（成功）**

```json
{ "ok": true, "data": {
  "agents": [
    { "kind": "claude-code", "tier": "T1", "installed": true, "status": "installed", "version": "2.1.0" },
    { "kind": "kimi", "tier": "T1", "installed": true, "status": "installed", "version": null } ],

  "characters": [
    { "id": "ch_kimi", "name": "Kimi", "agent_kind": "kimi", "level": 7, "online": true, "unit_id": "unit_kimi" } ],
  "units": [ { "id": "unit_kimi", "name": "Kimi", "character_id": "ch_kimi", "status": "busy", "online": true } ],
  "totals": { "agents": 2, "characters": 1, "units": 1 } } }
```

**映射**：只读 `WorldState.detectedAgents` / `WorldState.characters` / `WorldState.units`（`src/core/types.ts`）。

### 2.9 `stratix_mission_checkpoint`

> **排序位**：第 7 位（插在 `mission_status` 之后、`registry` 之前 —— `mission` 域的工具聚在一起；条目号 §2.9 按「只加不删」追加在末尾）。

**description**

> 往一条编组任务上记一条检查点 —— append-only 的一行记账（这一刻发生了什么）。
> **何时用**：长任务推进过程中留下可追溯的痕迹 —— 派了谁、卡在哪一步、阶段性结论是什么。
> **何时不用**：想写任务本身的契约（需求 / 验收标准 / 交付物）—— 那是 `brief`（`stratix_mission_create` 的 `brief` 段），不是记账；只想看任务当前相位 —— 用 `stratix_mission_status`。
> **边界**：记账**不改相位**（`draft` / `pending` / `confirmed` / `running` 都能记）；终态（`done` / `cancelled`）拒绝，回 `mission_terminal`（终态不改写历史，与 core 的终态铁律同口径）。`note` 上限 500 码点（MCP 侧自设，防超长文本进状态广播）；每条任务最多留 64 条（core 的 `MAX_MISSION_CHECKPOINTS`，超限丢最旧）。记账是**静默**的（成功与否都不发通知 —— 记账是高频后台动作，逐条通知会冲垮通知队列）。
> **错误**：`mission_not_found`（任务不存在）/ `mission_terminal`（任务已收尾）/ `invalid_arguments`（`note` 为空或超长）。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "mission_id": { "type": "string", "minLength": 1, "description": "编组任务 id（见 stratix_mission_status）。" },
    "note": { "type": "string", "minLength": 1, "maxLength": 500, "description": "这一刻发生了什么（一行记账）。上限 500 码点（MCP 侧自设）。" }
  },
  "required": ["mission_id", "note"],
  "additionalProperties": false
}
```

**返回（成功）**

```json
{ "ok": true, "data": {
  "mission_id": "mission_1753..._1", "title": "重构路由层", "phase": "running",
  "note": "派两人出门，先探北门", "at": 1754000000000,
  "checkpoint_count": 1, "checkpoint_limit": 64,
  "next": { "tool": "stratix_task_assign", "args": { "mission_id": "mission_1753..._1" }, "hint": "派具体任务时带上 mission_id，任务终态会自动回报到这条编组任务" },
  "poll": { "tool": "stratix_mission_status", "args": { "mission_id": "mission_1753..._1" } } } }
```

**映射**：`HudCommand` 的 `mission.checkpoint`（`src/core/types.ts`）→ core 的 `mission.checkpointMission`（追加一条 `{ at, note }`，不改相位，终态由 core 拒绝）。**回执自己核实**：core 的记账是**静默**的（成功与否都不发通知），所以工具在命令之后**回读状态**核对这条记账真的落上了 —— 没落上就如实报 `internal_error`，绝不假装成功（与 `stratix_mission_create` 的"回读核对"同一口径）。

**已知缺口（读侧）**：只读面暂未暴露 `checkpoints` 全量 —— 模型能拿到**计数**（本工具回执）与**相位**，但读不到历史条目全文。补齐它要动 `stratix_mission_status` 的返回形状（§5.1 的"加参数优于改语义"允许加字段，但那是既有工具的契约变更，留待与其它读面需求一并评审）。

---

## 3. 一致性铁律

### 3.1 投影而非新功能层

**MCP 工具不是新功能，是 core 总线契约的投影。** 所有写操作最终落到既有的 `HudCommand`（`src/core/types.ts` 第 964 行起的联合类型）或既有 app 层服务；MCP **不新增**状态字段、**不新增**持久化表、**不新增**状态机。工具返回的一切都能在 `WorldState`（或其 SQLite 投影）里对上 —— MCP 不持有自己的真相源。最常见的违反形态是"MCP 侧自己记一张表以支持分页"：一旦如此，MCP 的视图就会和战场漂移，而 MCP 是**没有人看**的那一侧，漂移不会有人发现。

| MCP 工具 | 落点 | 说明 |
|----------|------|------|
| `stratix_task_assign` | `HudCommand.task.assign` | app 层 `task-service` 出队执行 |
| `stratix_task_cancel` | `HudCommand.task.cancel` | core 状态机裁决相位 |
| `stratix_mission_create` | `HudCommand.mission.create` + `.assign` + `.confirm` | 内部串起，见 §1.2 |
| `stratix_chat_send` | app 层 `chat-service.send` | 角色会话（非 link 会话） |
| 其余四个 | 无（只读） | 读 `WorldState` 投影 |

### 3.2 状态机约束对 MCP 同样生效

**MCP 没有"更宽松的通道"这回事。** 核心状态机在 `src/core/mission/machine.ts` 与 `src/core/task/machine.ts`（纯函数、唯一裁决点），MCP 触发的迁移与 UI 触发的迁移走**同一套**状态机、同一条判定 —— 状态机约束对 MCP 同样生效。

| 约束 | 事实位置 | MCP 侧表现 |
|------|---------|-----------|
| 任务取消只认 `queued`，且不杀在跑的任务 | `core/task/machine.ts` 的 `cancel` 分支 | `task_not_cancellable` + 回当前相位 |
| 编组任务确认只认 `pending` | `core/mission/machine.ts` 的 `decide` 分支 | `illegal_transition` |
| 带依赖的编组任务在**依赖满足前不被允许确认** | `core/mission/machine.ts` 的 `findMissingDependencies` + `core/mission/manager.ts` 的 confirm 守门 | `stratix_mission_create` 的 `confirm` 被拒 → 任务停在 `pending`，回执 `blocked_by_dependencies` 报出还差哪几个（**不是失败**：任务已建成） |
| **编组任务只有 `running` 才能被回报完成** | `core/mission/machine.ts` 的 `complete` 分支（仅认 `running`） | 不存在"直接置完成"的 MCP 工具；完成只能由 `running → done` 到达 |
| 终态不改写历史 | 两个 machine 的终态守卫 | 重复取消 / 重复回报一律拒绝；终态任务不接受检查点记账 → `mission_terminal` |
| 失败不自动重试 | `core/task/machine.ts`（无 retry 动作） | 重派 = 新的一次 `stratix_task_assign` |
| 队列/历史上限 | `MAX_TASKS=100` / `MAX_MISSIONS=100` / `MAX_CHARACTERS=64` | 满则拒绝并回 `*_capacity_exceeded`，绝不静默挤掉在办条目 |

**"非 running 不能被回报完成"要特别说清**：第一期**不提供**任何"把 mission 置为完成"的工具。编组任务的收尾只有一条路径 —— 挂在它下面的角色任务到达终态，由 app 层 `task-service` 的终态回报链（`task_076` 引入的 `missionId` 关联）驱动 `completeMission` / `cancelMission`。MCP 想让一条 mission 收尾，正确做法是派一条带 `mission_id` 的任务，而不是找一个"直接完成"的工具 —— 后者若存在，就等于给 MCP 开了一条绕过状态机的后门。

### 3.3 MCP 不暴露的能力

| 不暴露 | 理由 |
|--------|------|
| 渲染层操作（相机、选择集、小地图、编组槽位、主题色） | 渲染层是给**人**看的交互面；agent 调度任务不需要"把镜头挪过去"。且坐标真相在世界层（`UnitView` 刻意不含坐标，`src/core/types.ts` 第 156 行），暴露它等于把渲染细节写进接口契约 |
| Electron 生命周期（启动、退出、重载、更新） | 桌面壳的操作权属于用户；agent 进程不该有能力关掉用户的应用 |
| 文件系统（读写仓库、读日志文件） / 流式推送（订阅 WorldState 广播） | agent 自带文件工具，Stratix 的磁盘不是共享工作面（文件面也无法做有界广播）；MCP 工具调用是请求-响应，实时流靠轮询快照获得，暴露订阅会带来"连接常驻 + 断线补偿"一整套协议负担 |

一句话：**MCP 暴露"业务动作"，不暴露"实现机制"。**

### 3.4 只读面与写面的分界

- **只读工具**（`stratix_world_snapshot` / `stratix_task_status` / `stratix_mission_status` / `stratix_registry`）：读投影，无副作用，可随时调用、可并发调用。
- **写工具**（`stratix_task_assign` / `stratix_task_cancel` / `stratix_mission_create` / `stratix_mission_checkpoint` / `stratix_chat_send`）：产生状态迁移（或记账写入），须遵守 §3.2 的状态机约束。

**幂等要求**：同一个写调用重复发出，第二次应被状态机以明确错误码拒绝（`illegal_transition` / `task_not_cancellable`），**不得产生第二个实体**。MCP 不提供"幂等键"机制 —— 重复调用产生重复实体的风险，由"模型用回执里的 id 去查、去取消"来消解，而不是靠服务端猜。

---

## 4. 扩展规范

### 4.1 工具注册表架构

工具面由一张**注册表**统一描述，新增工具 = 注册一条，不改既有工具。

| 注册项（ToolSpec）字段 | 说明 |
|------|------|
| `name` | `stratix_<域>_<动词>_<资源>`，全局唯一，`snake_case` |
| `domain` / `verb` | 域前缀与动作词（域表见 §4.2） |
| `description` | 按[附录 B](#附录-bdescription-写作模板)写全四要素 |
| `inputSchema` | JSON Schema；必填项少、可选项多、每个参数带 `description` |
| `handler` | 实现：把参数翻译成既有命令/服务调用，返回信封 |
| `errors` | 该工具可能返回的错误码子集（必须 ⊆ 附录 A 总表） |
| `readOnly` | 是否只读（只读工具可被客户端缓存、可并发调用） |

**分层**（建议结构，实现时对齐仓库既有分层习惯）：

```
src/stratix-gateway/mcp/
├── server.ts      # MCP server 实例装配（协议层）
├── registry.ts    # 工具注册表：ToolSpec 集合 + 按名查找 + 确定性排序
├── envelope.ts    # 成功/失败信封与错误码映射（附录 A 的唯一实现处）
├── transport/     # stdio.ts（stdio）· http.ts（Streamable HTTP + 旧版 SSE 兼容端点）
└── tools/         # world.ts · task.ts · mission.ts · chat.ts · registry.ts（按域一文件）
```

**注册表的确定性**：`tools/list` 按每件工具自己的**排序位**（`ToolSpec.order`）返回（不是注册顺序、不是文件顺序）；同位再按 `name` 码位序兜底。顺序稳定 = 客户端提示词缓存稳定。排序位与本文档条目号是两套编号（见 §2.0）。

### 4.2 域前缀与命名位

**已占用域**（第一期）：`world`（`stratix_world_snapshot`）、`task`（`_assign` / `_status` / `_cancel`）、`mission`（`_create` / `_status` / `_checkpoint`）、`chat`（`_send`）、无域（`stratix_registry`）。

**预留命名位**：

| 预留域 / 位 | 规划中的工具 | 说明 |
|------------|-------------|------|
| `zone` | `stratix_zone_list` / `_create` / `_enter` / `_status` | **工作区域**。Zone 概念在 v3 已按 D5 砍掉，但"把若干角色圈进一个上下文/工位"是未来明确会有的能力，命名位先留出来，避免将来占用 `stratix_work_*` 或 `stratix_ctx_*` 之类与其它域撞车。**预留 ≠ 已实现**：`stratix_zone_*` 出现即表示该能力已上线，未上线前不得出现同名工具 |
| `pipeline` | `stratix_pipeline_start` / `_status` | 多 agent 流水线（core 已有 `PipelineSpec` 与 `pipeline.start` 命令，`src/core/types.ts` 第 1171 行）—— 第二期候选，第一期不实现 |
| `chat`（扩展位） | `stratix_chat_history` | 拉取某角色的历史消息（游标分页） |
| `mission`（扩展位） | `stratix_mission_confirm` | 人工确认编组任务（第一期确认权留给 UI） |

**动作词受控表**：新增工具优先取自 `list` / `get` / `create` / `update` / `assign` / `send` / `cancel` / `start` / `status` / `snapshot` / `search`。确需新动词时先在本节登记再用 —— 动词词表膨胀会让"同类工具"失去可预测性。

**已登记的扩展动词**：`checkpoint`（`stratix_mission_checkpoint`，§2.9）—— 在一条编组任务上追加一条 append-only 记账行（不改相位）。登记理由：它是"写一条记账"这一个动作，与 `create`（立任务）、`assign`（派活）都不是同一件事；不登记就得用 `update` 硬套，而 `update` 的语义是"改字段"，会把"只追加不改写"的记账语义说糊。

### 4.3 新工具提案到上线的流程

**Step 1 · 提案**：写清"要解决 agent 的哪个决策点"、"为什么现有工具做不到"、"是否落在 §3.3 的禁区"（一页提案，可放 PR 描述）。

**Step 2 · 规范评审**：对照[附录 C](#附录-c新工具评审清单)逐条过，评审人是本规范维护者（§5.4）。**评审通过前不写实现代码** —— 避免"先实现再补规范"，那会让工具面长成实现的历史遗留。

**Step 3 · 注册**：按 §4.1 落一条 ToolSpec，放在对应 `tools/<域>.ts`，`registry.ts` 汇总；新增域则新建 `tools/<域>.ts` 并在 §4.2 域表登记。

**Step 4 · description 撰写**：按[附录 B](#附录-bdescription-写作模板)写全四要素。**description 是工具的一部分，不是注释** —— 它进客户端提示词，是模型唯一的使用说明。

**Step 5 · 测试**（最低要求）：

| 测试 | 断言 |
|------|------|
| schema 快照测试 | `inputSchema` 与提交的快照一致（改 schema 必须改快照，防止静默改契约） |
| 成功路径测试 | 正常入参 → 成功信封 + 关键字段（尤其**回执含 id 与 poll**） |
| 错误路径测试 | 本工具声明的每个错误码各一条；写操作另须有一条"重复调用被状态机拒绝"的用例（§3.4 幂等要求） |
| 边界测试 | 上限值（长度上限、列表上限、队列满）与空值 |

**Step 6 · 文档同步**：本规范同步更新（§4.2 域表 / §2 工具条目 / 附录 A 错误码），与实现**同一个 PR** 提交 —— 规范与实现分两次提交，中间那一刻规范就是假的。

**新人照着做**：提案 → 评审 → 注册 → 写 description → 补五类测试 → 同步本规范，六步走完即可上线一个新工具，无需改动既有工具。

### 4.4 MCP server 的接入方式

**位置**：MCP server 作为 **gateway 内的一个模块**（`src/stratix-gateway/mcp/`），与业务网关同进程，复用 core 的总线与 store，不新开状态通道。

> 前后端分离后，这句「同进程」的准确含义见 [§0.5 拓扑定位](#05-拓扑定位新旧拓扑对比)：gateway 进程**就是** service 进程（先 boot service 再挂 `/mcp`），故 MCP 与 service 同进程同实例、MCP 看见的是真战场。

**为什么放 gateway 而不是 core**：core 是"引擎无关、零 IO、纯逻辑"（`src/core/README.md` 的 Allowed / Forbidden 铁律），而 MCP server 要开 socket、处理协议帧、管会话 —— 放进 core 会直接破掉 core 的分层铁律；且 MCP 工具要读写 core 的状态，需要一个**在 core 之上**的应用层，gateway 正是那个位置（`docs/REFACTOR_PLAN_V3.md` §2 里 gateway 是"业务网关与外部 agent 连接"的所在）。

| 模式 | 端点 | 用途 | 要点 |
|------|------|------|------|
| **stdio** | `stratix-mcp --transport stdio` | 本机 MCP client 拉起子进程（Claude Code / OpenCode 等） | 一进程一 client；stdout 只输出协议帧，日志走 stderr |
| **HTTP** | `POST /mcp`（Streamable HTTP） | 远程 / 多 client 共享 | 默认只监听 `127.0.0.1`；保留旧版 SSE 端点（`/mcp/sse` + `/mcp/messages`）兼容老 client |

两种模式**共享同一份注册表与 handler** —— 传输层只负责收发帧，工具语义完全一致。这是硬要求：stdio 下跑通的行为，HTTP 下必须一模一样（否则调试时永远在怀疑"是不是 transport 的问题"）。

**安全边界**（第一期）：MCP client 与 Stratix 同机同用户，**不做多租户鉴权**；但 HTTP 端点**必须**绑 `127.0.0.1`（不绑 `0.0.0.0`）—— 工作台的数据面（角色档案、任务内容）不应暴露到局域网。工具入参一律走 schema 校验后再落命令，不允许"万能透传"绕过 core 的守门；origin 字段用于审计留痕，但**不作为信任凭据**（它由调用方自称，不构成鉴权）。

---

## 5. 版本与演进

### 5.1 工具面变更原则

**只加不删**：工具一旦发布**不删除** —— client 侧提示词里可能已硬编码工具名，删掉会让那些 client 在运行时才发现工具消失（要么报错，要么更糟：静默换了一个行为不同的工具）。**加参数优于改语义**：给已有工具加**可选**参数（缺省行为不变）允许，改变已有参数的含义或缺省行为不允许。**加工具优于改工具**：能力扩展优先走新工具，而不是把旧工具改成多形态。

### 5.2 重命名与废弃

重命名走 **alias 过渡期**：① 新名与旧名**同时注册**（旧名作为 alias 指向同一 handler），过渡期**至少两个发布周期**；② 过渡期内旧名的 `description` 开头标注 `【已废弃，将于 <版本> 移除，请改用 <新名>】`；③ 新名上线时同步更新本规范、§4.2 域表、相关文档示例；④ 过渡期结束移除旧名，并在变更日志记一笔。

### 5.3 变更分类与流程

| 变更类型 | 允许 | 流程 |
|---------|------|------|
| 新增工具 | ✅ | §4.3 全流程 + §2 增条目 + 附录 A 错误码核对 |
| 新增可选参数 | ✅ | 缺省行为必须与旧版一致；schema 快照测试同步更新 |
| 新增错误码 | ✅（总表已有则复用） | 附录 A 更新；相关工具的 `errors` 声明同步 |
| 重命名工具 | ⚠️ | §5.2 的 alias 过渡期 |
| 删除工具 / 参数 | ❌ | 不允许（§5.1） |
| 改变已有参数语义 | ❌ | 不允许；须新开工具 |
| 改变状态机约束 | ⚠️ | 属 core 契约变更：先改 `src/core/types.ts` 的契约注释与状态机，再改 MCP 描述，两者同 PR |

### 5.4 规范文档的维护责任

| 项 | 责任 |
|----|------|
| 文档 owner / 变更触发 | Stratix 工作台维护者（与 `src/core/types.ts` 契约 owner 同一人）；触发条件：工具面任何增删改、core 状态机约束变化、错误码总表变化 |
| 同步要求 | 实现与本规范**同一个 PR**；CI 校验"改了 `src/stratix-gateway/mcp/tools/**` 必须同时改 `docs/MCP-SPEC.md`" |
| 版本号 | 本文档头部 Spec 版本；工具面发生**破坏性**变更时主版本 +1（破坏性变更按 §5.2 走过渡期，实际很少发生） |
| 冲突裁决 | 文档与实现不一致时以**代码**为准并**立刻修文档** —— 文档撒谎比文档缺失更贵 |

### 5.5 版本演进记录（只加不删）

本表**只追加**：每次工具面变更**新增一行**，旧行不改、不删、不重写（§5.1「只加不删」在文档层的自证 —— 演进史本身也是一段只增不改的历史）。本表从 v1.1 起建立；v1.0 之前的工具面变更（第一期八件工具的实现）没有逐条记录，其历史以 git commit 为准（`f43d005` 规范初稿 / `3baf559` 骨架 / `bf9a78b` 八工具齐备）。

| 版本 | 日期 | 变更 | 兼容性 |
|------|------|------|--------|
| v1.2 | 2026-11-02 | **新增章节** §0.5「拓扑定位（新旧拓扑对比）」—— 写清 MCP 在前后端分离后的位置：gateway 进程即 service 进程，先 boot service 再挂 `/mcp`，故工具见真状态（附新旧拓扑 ASCII 对比图与逐维度对照表）；§0.2 权威依据增列 SERVICE-SPLIT-PLAN；§4.4 增注指回 §0.5 | ✅ 纯文档：工具面**零变更** —— 工具名 / 参数 / 返回 / 错误码 / `tools/list` 顺序全部未动 |
| v1.1 | 2026-11-01 | **新增工具** `stratix_mission_checkpoint`（§2.9，记一条 append-only 检查点）；**新增可选参数** `stratix_mission_create` 的 `brief`（四段结构化正文）与 `depends_on`（前置任务链，§2.5）；**新增错误码** `mission_terminal`（附录 A）；**新增术语** 依赖解锁 / brief / 检查点（§0.4）；`tools/list` 顺序改为按**排序位**（§2.0），新工具插在 `mission_status` 之后、`registry` 之前（既有工具之间的相对次序不变） | ✅ 纯增量：既有 8 件工具的名字、参数、语义与缺省行为**均未变**（`brief` / `depends_on` 缺省即"裸任务"，与 v1.0 逐字节一致）；`auto_confirm_applied` 的口径在**新增的依赖未满足分支**上才出现差异（`false` = auto_confirm 没能生效），v1.0 的三条既有路径取值不变 |

---

## 附录 A：返回信封与错误码总表

**成功信封**：`{ "ok": true, "data": { /* 工具特有载荷 */ } }`

**失败信封**（MCP 结果 `isError = true`；JSON-RPC 层错误不套此信封）：

```json
{ "ok": false, "error": {
    "code": "character_offline",
    "message": "「Kimi」当前离线，任务无法执行",
    "retryable": true,
    "hint": "等 CLI 恢复在线后重新派单，或换一位在线角色" } }
```

**错误码总表**（MCP 工具只能使用本表中的码；新增须先改本表）：

| code | 含义 | 可重试 | 典型触发 |
|------|------|--------|---------|
| `invalid_arguments` | 入参不满足 schema 或工具层校验 | ❌ | title 空白 / prompt 超 20000 码点 / origin 非法 / 过滤器取值非法 |
| `unknown_character` | 角色 id 不在名册中 | ❌ | `guardTaskCharacter` → `TASK_MSG_NO_PROFILE` |
| `character_unbound` | 角色未绑定 CLI agent | ❌ | `TASK_MSG_UNBOUND` |
| `agent_not_installed` | 绑定的 CLI 未被检出 | ❌ | `TASK_MSG_NOT_INSTALLED` |
| `character_offline` | 绑定的 CLI 健康监测判离线 | ✅ | `taskOfflineReason(...)` |
| `chat_busy` | 该角色已有对话轮次在跑 | ✅ | chat-service 忙碌锁命中 |
| `task_not_found` | 任务 id 不在状态里 | ❌ | `TaskRejectionCode.not-found` |
| `task_not_cancellable` | 任务不在 `queued` 相位 | ❌ | `TaskCancelOutcome.code='not-queued'` |
| `task_capacity_exceeded` | 任务队列已满（100） | ✅ | `TaskRejectionCode.limit-exceeded` |
| `mission_not_found` | 编组任务 id 不存在 | ❌ | `MissionRejectionCode.not-found` |
| `mission_capacity_exceeded` | 编组任务数已满（100） | ✅ | `MissionRejectionCode.limit-exceeded` |
| `mission_terminal` | 编组任务已收尾（done / cancelled），不再接受该操作 | ❌ | 终态拒绝（`appendMissionCheckpoint` 的终态分支） |
| `illegal_transition` | 状态机拒绝该迁移 | ❌ | `MissionErrorCode.illegal-transition` |
| `internal_error` | 内部异常 | ✅ | 未归类的异常 |

**错误语义约定**：`message` 是**面向人的一句话**（可直接转述给用户），不是堆栈；`hint` 是**面向模型的下一步**（该调什么、该改什么、该等什么）；`retryable` 只表达"同样的输入重试是否可能成功"（如离线恢复后重试），不表达"该不该重试"（该不该由模型按场景判断）。

---

## 附录 B：description 写作模板

```
<动词短语开头，说明这个工具做什么>。
何时用：<解决 agent 的哪类决策点；典型场景 1~2 个>。
何时不用：<相近但该用别的工具的场景，点名正确工具>。
边界：<相位限制 / 上限 / 缺省值 / 截断行为 / 并发限制>。
错误：<可能出现的错误码及其含义与可重试性>。
```

**样例（`stratix_task_cancel` 的 description 原文）**：

> 取消一条**排队中**的角色任务。
> 何时用：派错了单、任务不再需要，在它开跑之前叫停。
> 何时不用：任务已经在跑 —— 取消**不杀在跑的任务**，此时会返回 `task_not_cancellable`（在跑的任务只能等它跑完或失败）；任务已终态 —— 同上，历史不改写。
> 边界：只有 `queued` 相位可取消；`running` / `awaiting_approval` / 终态一律拒绝并回当前相位。取消不产生结果输出（`output` 恒为固定占位文案「任务在排队时被取消」）。
> 错误：`task_not_found` / `task_not_cancellable`。

**反例**："取消任务。" —— 没有何时用、何时不用、边界与错误，模型不知道"running 能不能取消"，只能试。"取消一个还没开始执行的任务，如果任务已经在运行将会返回错误。" —— 有边界，但没有**错误码**、没有可重试性、没有"何时不用"。

---

## 附录 C：新工具评审清单

评审逐条打勾，任一条不过则退回。

**命名与粒度**：名称为 `stratix_<域>_<动词>_<资源>`，`snake_case`，无点号、无驼峰；一个工具只做一个动作，无 `action` / `op` / `mode` 这类万能枚举参数；动词取自 §4.2 受控词表（或已在该节登记），域已在 §4.2 域表登记（新增域也要登记）。

**描述**：四要素写全（何时用 / 何时不用 / 边界情况 / 错误语义）；明确点名"何时不用"时该用的正确工具；边界写明上限、缺省值、截断行为、相位限制；错误段列出本工具的错误码与可重试性。

**Schema 与返回**：`inputSchema` 是合法 JSON Schema 且必填项最少、都是真必填；每个参数带 `description`，有上下界的写明 `minimum` / `maximum` / `maxLength` / `maxItems`；无参工具的 schema 是 `{"type":"object","properties":{},"additionalProperties":false}`；成功返回是**受理回执**（含标识 + 状态 + 查法 `poll`），不是裸 `ok`；只读工具返回可直接使用的结论，写工具返回回执；默认响应 ≤ 约 800 token，大字段默认摘要、展开按需；列表返回带 `returned` / `total` / `truncated`。

**一致性与边界**：写操作落到既有 `HudCommand` 或既有 app 层服务，不新增状态、状态机、持久化表；违反的状态机约束在 description 里写明（如"仅 queued 可取消"）；错误码全部取自附录 A 总表，未新增码；不触碰 §3.3 的禁区（渲染层 / Electron 生命周期 / 文件系统 / 流式推送）；与现有工具不重叠（重叠说明该合并进已有工具，而非新开一个）。

**测试与文档**：schema 快照测试在位；成功路径 + 每条声明错误码的错误路径 + 边界用例齐备；写工具有一条"重复调用被状态机拒绝"的用例；本规范 §2 / §4.2 / 附录 A 与实现**同一个 PR** 更新。
