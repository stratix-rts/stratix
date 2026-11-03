# Stratix MCP 接口设计规范（第一期工具面 + 扩展规范）

> **状态**：第一期工具面冻结（Spec v1.10）＋ §6 v2 设计章（**未实现**，见 §6 抬头）　**性质**：规范文档（不含实现代码）
> **适用范围**：Stratix 对外提供的 MCP server 及其工具面（tool surface）
> **取代**：`docs/MCP_SERVER_DESIGN.md`（v2 Zone 时代草案 —— Zone 已按 `docs/REFACTOR_PLAN_V3.md` D5 决策砍掉，其中 `stratix.list_zones` 等工具面不再成立）
> **维护责任**：见 [§5.4](#54-规范文档的维护责任)
> **版本演进**：见 [§5.5](#55-版本演进记录只加不删)（只加不删 —— 每一行变更都追加，旧行不改不删）

---

## 目录

- [0. 设计前提](#0-设计前提)：[0.1 消费者与心智模型](#01-消费者与心智模型)｜[0.2 权威依据](#02-权威依据)｜[0.3 范围与非目标](#03-范围与非目标)｜[0.4 术语](#04-术语)｜[0.5 拓扑定位](#05-拓扑定位新旧拓扑对比)
- [1. 工具设计五原则](#1-工具设计五原则)：[1.1 动词 + 资源命名，单动作工具](#11-原则一动词--资源命名单动作工具)｜[1.2 合并发生在工具内部](#12-原则二合并发生在工具内部)｜[1.3 返回 meaningful context](#13-原则三返回-meaningful-context)｜[1.4 token 效率](#14-原则四token-效率)｜[1.5 描述工程](#15-原则五描述工程)
- [2. 第一期工具面](#2-第一期工具面)：[2.0 通用约定](#20-通用约定)｜[2.1 world_snapshot](#21-stratix_world_snapshot)｜[2.2 task_assign](#22-stratix_task_assign)｜[2.3 task_status](#23-stratix_task_status)｜[2.4 task_cancel](#24-stratix_task_cancel)｜[2.5 mission_create](#25-stratix_mission_create)｜[2.6 mission_status](#26-stratix_mission_status)｜[2.7 chat_send](#27-stratix_chat_send)｜[2.8 registry](#28-stratix_registry)｜[2.9 mission_checkpoint](#29-stratix_mission_checkpoint)｜[2.10 session_list](#210-stratix_session_list)｜[2.11 session_get](#211-stratix_session_get)｜[2.12 session_interrupt](#212-stratix_session_interrupt)｜[2.13 session_resume](#213-stratix_session_resume)｜[2.14 mission_confirm](#214-stratix_mission_confirm)｜[2.15 mission_cancel](#215-stratix_mission_cancel)｜[2.16 character_create](#216-stratix_character_create)｜[2.17 character_delete](#217-stratix_character_delete)
- [3. 一致性铁律](#3-一致性铁律)：[3.1 投影而非新功能层](#31-投影而非新功能层)｜[3.2 状态机约束](#32-状态机约束对-mcp-同样生效)｜[3.3 不暴露的能力](#33-mcp-不暴露的能力)｜[3.4 只读与写的分界](#34-只读面与写面的分界)
- [4. 扩展规范](#4-扩展规范)：[4.1 工具注册表架构](#41-工具注册表架构)｜[4.2 域前缀与命名位](#42-域前缀与命名位)｜[4.3 新工具上线流程](#43-新工具提案到上线的流程)｜[4.4 MCP server 接入方式](#44-mcp-server-的接入方式)
- [5. 版本与演进](#5-版本与演进)：[5.1 变更原则](#51-工具面变更原则)｜[5.2 重命名与废弃](#52-重命名与废弃)｜[5.3 变更分类](#53-变更分类与流程)｜[5.4 维护责任](#54-规范文档的维护责任)｜[5.5 演进记录](#55-版本演进记录只加不删)
- [6. v2 设计章](#6-v2-设计章四条工程模式草案--未实现)（**未实现**）：[6.0 四模式总览](#60-四模式总览)｜[6.1 waterfall 工具管线](#61-waterfall-工具管线)｜[6.2 capability seam 三件套](#62-capability-seam-三件套)｜[6.3 事件日志 + 投影](#63-事件日志--投影)｜[6.4 可逆注册](#64-可逆注册)｜[6.5 交叉约束与落地顺序](#65-四模式的交叉约束与落地顺序)
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

**撤掉（remove）** vs **叫停（cancel）** = 同一件事的两种收尾：**撤掉**针对**从未开工**的编组任务（`draft` / `pending`）—— 它什么都还没发生，世界态里不必留墓碑，撤掉即从战场消失（占用的单位一并释放）；**叫停**针对**已经开跑**的编组任务 —— 得有个"被叫停了"的交代，故留一条 `cancelled` 终态墓碑（历史不改写）。判据只有一份（core 的 `canRemoveMission`，§2.15）。

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

**返回信封**：统一信封，成功 `ok=true`；失败 `ok=false` 且 MCP 结果带 `isError=true`（业务失败），**协议级/参数级失败**走 JSON-RPC error（不设 `isError`）。完整定义见[附录 A](#附录-a返回信封与错误码总表)；传输层各类失败的具体错误码见 [§4.4 传输层错误信封](#44-mcp-server-的接入方式)。

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
| 会话读口查到 id 不存在（`SessionReadPort.readSession` 回 null，`src/app/services/persistence/session-reader.ts:44`） | `session_not_found` |
| `SessionRejectionCode.not-found`（会话写面：`src/core/session/manager.ts`） | `session_not_found` |
| `SessionRejectionCode.illegal-transition`（core/session/machine.ts 的 interrupt 分支） | `illegal_transition` |
| 会话 kind 不在工具面允许的集合内（本工具面的 kind 边界，见 §2.12 / §2.13） | `unsupported_kind` |

**origin 审计字段**：所有写类工具接受可选 `origin`，取值 `ui` | `mcp` | `script` | `agent`。

- 缺省时服务端按**调用通道**自动标注：经 MCP 进来的记 `mcp`。
- **经 MCP 派单且派单方本身是 agent 时，必须显式传 `origin='agent'`** —— 审计面要能区分"人派的单"和"agent 派的单"；这是审计要求而非装饰，不显式标注则所有经 MCP 的派单都记成 `mcp`，事后无法追责。
- 传其它值 → `invalid_arguments`。**允许的显式值是 `mcp` / `agent` / `script`**：`mcp` 与缺省同义（显式传它也合法 —— schema 的 `default` 必须在自己的 `enum` 内，否则那张 schema 自相矛盾、严格模式的校验器会直接拒收），`ui` 拒绝 —— UI 通道的事实不许由 MCP 冒充。

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
    "origin": { "type": "string", "enum": ["mcp", "agent", "script"], "default": "mcp", "description": "审计来源（取值 mcp / agent / script；ui 不接受）。缺省按调用通道记为 mcp；agent 经 MCP 派单必须显式传 agent。" }
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
> **何时不用**：只派一个人 —— 用 `stratix_task_assign`；只想查现有编组任务 —— 用 `stratix_mission_status`；任务已经建好、只是卡在待确认 —— 用 `stratix_mission_confirm` 放行；建错了要撤掉 —— 用 `stratix_mission_cancel`。
> **边界**：`units` 是战场单位 id 列表（可空；空 = 草稿任务，不会自己开工）。单位 id 不存在时**静默剔除**并在 `dropped_units` 里报数（不猜、不报错）。`auto_confirm=false` 时任务停在 `pending` 待确认 —— 用 `stratix_mission_confirm` 放行开工、用 `stratix_mission_cancel` 撤掉（core 口径：`confirm` 只认 `pending`）。`auto_confirm=true` 时若有效名单为空（单位 id 全不存在），任务无法进入 `running`，回 `illegal_transition`。编组任务上限 100 条，超限拒绝新建。
> **正文与依赖**：`brief` 是这条任务的结构化正文契约（`requirements` 需求 / `acceptance` 验收标准 / `deliverables` 交付物 / `constraints` 约束），四段皆可选，**只记不校验**（不会自动写进派单 prompt）。`depends_on` 是前置编组任务 id 列表（上限 32）：**带依赖的编组会在依赖满足前拒绝 `confirm`** —— 任务停在 `pending`，回执的 `blocked_by_dependencies` 报出还差哪几个前置（这是**正常结果**，不是失败：任务已建成，只是还不能开工）。
> **错误**：`invalid_arguments`（title 为空或超长 / brief 段名非法或超长 / `depends_on` 超 32 条）/ `mission_capacity_exceeded`（可重试）/ `illegal_transition`。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string", "minLength": 1, "maxLength": 200, "description": "任务标题。core 只校验非空，200 码点上限是 MCP 侧自设（防超长标题进状态广播）。" },
    "units": { "type": "array", "items": { "type": "string" }, "maxItems": 256, "description": "指派的战场单位 id 列表。上限 256（MAX_SELECTION_SIZE）。" },
    "auto_confirm": { "type": "boolean", "default": true, "description": "true = 内部完成建任务→指派→接单开工（落到 running）；false = 停在 pending 待确认（用 stratix_mission_confirm 放行）。" },
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
  "next": { "tool": "stratix_mission_status", "args": { "mission_id": "mission_1753..._2" }, "hint": "前置任务收尾后用 stratix_mission_confirm 放行这条（依赖未满足时确认会被 core 拒绝）" },
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

**`auto_confirm=false` 时这条链只走到 `mission.assign`**（任务停在 `pending`）：放行由 `stratix_mission_confirm`（§2.14）接手 —— 走的是**同一条** `mission.confirm` 命令、同一套 core 守门；建错了要撤掉则由 `stratix_mission_cancel`（§2.15）接手。

### 2.6 `stratix_mission_status`

**description**

> 读取编组任务（mission）的状态；带 `mission_id` 读单条，不带则列出最近的编组任务。
> **何时用**：查一条编组任务的进展与它下面的角色任务；回话前确认"这件事推进到哪了"。
> **何时不用**：查单个角色的任务 —— 用 `stratix_task_status`；查全场忙闲 —— 用 `stratix_world_snapshot`。
> **边界**：只读。列模式默认返回最近 20 条（`limit` 可调，上限 100），按创建时间倒序；被截断时 `truncated=true`。单条模式附带该任务下的角色任务摘要（任务 id、承接角色、状态），并读回 `brief`（结构化正文）与 `checkpoints`（append-only 记账行，全量，上限 64 条）—— 写进去的契约与记账都读得回来。
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
    "units": [ { "id": "unit_kimi", "name": "Kimi" }, { "id": "unit_codex", "name": "Codex" } ],
    "brief": { "requirements": "拆掉旧总线", "acceptance": "单测全绿" },
    "checkpoints": [ { "at": 1754000000000, "note": "派两人出门，先探北门" } ],
    "checkpoint_count": 1, "checkpoint_limit": 64 },
  "tasks": [
    { "id": "task_1754..._3", "character": { "id": "ch_kimi", "name": "Kimi" }, "status": "completed" },
    { "id": "task_1754..._4", "character": { "id": "ch_codex", "name": "Codex" }, "status": "running" } ],
  "task_totals": { "total": 2, "completed": 1, "running": 1, "failed": 0 } } }
```

**映射**：只读 `WorldState.missions` + 按 `CharacterTask.missionId` 关联 `WorldState.tasks`。

**读回面（v1.8 补齐）**：单条模式回 `brief` 正文与 `checkpoints` 全量（`brief` 缺省时该字段不出现；`checkpoints` 恒为数组，未记账时为空数组；顺序即记账顺序，旧 → 新）。why 必须有这一面：经 MCP 写进去的契约与记账若读不回来，就成了"只写不读"的审计流 —— 调用方只能靠 create 回执里那句 `brief_fields`（只报段名）猜正文。`checkpoint_limit` 与 `stratix_mission_checkpoint` 回执里的 `checkpoint_limit` 同值（core 的 `MAX_MISSION_CHECKPOINTS` = 64，超限丢最旧；读面另兜一层尾截断，只回最新 64 条）。

### 2.7 `stratix_chat_send`

**description**

> 给指定角色发一轮对话，等这一轮回复回来。
> **何时用**：提问、讨论、澄清需求 —— 需要来回对话而不是一次性交付。
> **何时不用**：要一份确定的产出物 —— 用 `stratix_task_assign`（任务有结果摘要、有超时、有归档）；要多人讨论 —— 先 `stratix_mission_create` 编组，再各自发消息。
> **边界**：本工具**同步等一轮**（受服务端单轮超时约束），返回该轮回复文本（超过 2000 码点截断并标 `reply_truncated`）。同一角色同时只允许一轮在跑；已有轮次在跑时返回 `chat_busy`，**不静默丢弃**。对话历史不随本工具返回（历史在 UI 抽屉与落库表里）；MCP 侧目前没有读对话历史的工具，别去找不存在的名字。
>
> **注（v1.8 修正）**：本描述原先指向"扩展位 `stratix_chat_history`" —— 该工具只在 §4.2 的**预留命名位**表里登记，**尚未实现**，tools/list 里没有它（悬空引用：agent 会按图索骥扑空）。也不能改指 `stratix_session_get`：角色对话的消息本体在 `chat_messages` 表里，不在会话事件流里（会话侧只有一条空的 `round` 记账事件），`session_get` 读不到对话正文。
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

**读侧缺口已补齐（v1.8）**：本节原先记着"只读面暂未暴露 `checkpoints` 全量"的缺口 —— `stratix_mission_status` 的单条模式现已回 `checkpoints` 全量（与 `brief` 正文一起，见 §2.6），记账不再是只写不读的审计流。

---

### 2.10 `stratix_session_list`

> **排序位**：第 10 位（`session` 域新开 —— 排在既有九件之后，既有工具之间的相对次序不变；条目号 §2.10 按「只加不删」追加在末尾）。

**description**

> 列出工作台上的会话（会话域摘要）—— 按种类 / 状态过滤，分页取一段。
> **何时用**：想看"最近发生过哪些会话" —— 哪场互聊卡住了、哪条会话被中断了、哪条任务会话跑完了；想拿到一个会话 id 再去拉它的明细。
> **何时不用**：查任务本身的进展与产出 —— 用 `stratix_task_status`；查编组任务 —— 用 `stratix_mission_status`；拉某条会话的事件明细 —— 用 `stratix_session_get`。
> **边界**：只读，不改变任何状态。kind 五选一（`character_chat` 聊天 / `peer_chat` 互聊 / `task_run` 任务 / `mission_run` 编队 / `shell_link` 连接）、status 四选一（`active` / `idle` / `interrupted` / `closed`）；都不给 = 不过滤。按创建时间倒序（最新的在前）；limit 默认 20、上限 100；offset 是**位置**（0 起），给了负数按 `invalid_arguments` 报错而不是悄悄夹成 0。这里只给摘要 —— 事件正文（消息 / 轮次 / 中断原因）不在列表里，要明细用 `stratix_session_get`。
> **错误**：`invalid_arguments`（kind / status 词表外 / limit 越界 / offset 为负）/ `internal_error`（本进程没有会话读口 —— 不回空列表冒充"没有会话"）。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "kind": { "type": "string", "enum": ["character_chat", "peer_chat", "task_run", "mission_run", "shell_link"], "description": "只看这一类会话；缺省 = 全部五类。" },
    "status": { "type": "string", "enum": ["active", "idle", "interrupted", "closed"], "description": "只看这一种状态的会话；缺省 = 不按状态过滤。" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20, "description": "本页最多返回几条（默认 20，上限 100）。" },
    "offset": { "type": "integer", "minimum": 0, "default": 0, "description": "从第几条开始（0 起；是位置，不是窗口 —— 负数报错）。" }
  },
  "additionalProperties": false
}
```

**返回（成功）**

```json
{ "ok": true, "data": {
  "sessions": { "returned": 2, "total": 5, "truncated": true,
    "items": [
      { "id": "session_peer_chat_1753..._1", "kind": "peer_chat", "title": "互聊：侦察北门",
        "status": "active", "participants": ["agent-a", "agent-b"], "ref_id": null,
        "event_count": 12, "created_at": 1754000000000, "last_event_at": 1754000010000 }
    ] },
  "limit": 20, "offset": 0,
  "next": { "tool": "stratix_session_get", "args": { "session_id": "session_peer_chat_1753..._1" },
            "hint": "拉这条会话的详情与事件流；要另一条就把 session_id 换成列表里的 id" } } }
```

**分页口径**：`returned` = 本页条数；`total` = 命中过滤条件的总条数；`truncated` = **本页之后还有**别的会话（`total > offset + returned`）—— 只看"本页条数 < 总数"会把翻到最后一页也说成"还有更多"（骗模型的翻页判断）。

**查法链**：`stratix_session_list` → `next` 指向 `stratix_session_get`（拉明细）→ `stratix_session_get` → `poll` 指向它自己（会话推进时再调一次就能看到新事件）。

**映射**：读口 = core 的 `SessionReadPort`（`src/core/session/types.ts:182`）—— **纯回调契约，core 不认存储实现**（零 IO 铁律，与 `SessionPersistPort` 同一纪律）。生产实现 = service 侧 SQLite 的**同进程直读**（`src/stratix-gateway/mcp/context.ts:89` → `src/app/services/persistence/session-reader.ts:44`），数据与 service 侧只读 API `GET /api/storage/sessions` 是同一份。

> **为什么读库而不读 WorldState**：WorldState.sessions 只带**在办会话的摘要**（上限 `MAX_SESSIONS = 200`，且裁掉已关闭的最旧会话），而**事件本体根本不入广播**（性能铁律：广播体积必须有界）。外部 agent 要看的是「发生过什么」，故读面以库为准。
>
> **拓扑合法性**：MCP 与 service 同进程（§0.5）→ 同进程读自己开的库，**不是**第二个进程开同一个库，故不违反铁律 6（SQLite 只由 service 进程打开写）。跨进程读（浏览器 / 外部 client）走 service 侧只读 API。
>
> **stdio 独立入口的例外**：`stratix-mcp --transport stdio` 拉起的是**另一个进程**（没有 service，也没有库）—— 那里的会话工具报 `internal_error`（库未初始化），会话面请在 HTTP 入口（gateway 的 `/mcp`，与 service 同进程）使用。

---

### 2.11 `stratix_session_get`

> **排序位**：第 11 位（`session` 域第二件，紧跟 `session_list`）。

**description**

> 读一条会话：会话摘要 + 事件流的一段（按 seq 正序，从旧到新）。
> **何时用**：想看某场互聊 / 某条会话"到底发生了什么"；查它被中断的原因；往前翻更早的事件。
> **何时不用**：只想知道有哪些会话 —— 用 `stratix_session_list`；查任务的产出全文 —— 用 `stratix_task_status`；查角色档案 —— 用 `stratix_registry`。
> **边界**：只读，不改变任何状态。事件按 seq 正序返回（seq 会话内单调，从 1 起）；limit 默认 50、上限 200；`before_seq` 是**游标**（取该序号**之前**的一段，用于往前翻页 —— 把返回的最早一条的 seq 再传回来即可继续往前翻）；会话里更早还有事件时 `has_more=true`。事件正文按事件类型原样返回（`message` 事件带 author / text，`interrupt` 事件带 reason），MCP 不做总结。
> **错误**：`session_not_found`（会话 id 不存在）/ `invalid_arguments`（`session_id` 为空 / `before_seq` 非正整数 / limit 越界）/ `internal_error`（本进程没有会话读口）。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "session_id": { "type": "string", "minLength": 1, "description": "会话 id（见 stratix_session_list）。" },
    "before_seq": { "type": "integer", "minimum": 1, "description": "游标：只取 seq 小于它的那些事件；缺省 = 取最新的一段。" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 200, "default": 50, "description": "本页最多返回几条事件（默认 50，上限 200）。" }
  },
  "required": ["session_id"],
  "additionalProperties": false
}
```

**返回（成功）**

```json
{ "ok": true, "data": {
  "session": { "id": "session_peer_chat_1753..._1", "kind": "peer_chat", "title": "互聊：侦察北门",
               "status": "active", "participants": ["agent-a", "agent-b"], "ref_id": null,
               "event_count": 12, "created_at": 1754000000000, "last_event_at": 1754000010000,
               "closed_at": null },
  "events": { "returned": 2, "total": 12, "limit": 50, "before_seq": null, "has_more": true,
              "items": [
                { "seq": 1, "type": "created", "payload": { "title": "互聊：侦察北门", "participants": ["agent-a"] }, "at": 1754000000000 },
                { "seq": 2, "type": "message", "payload": { "author": "agent-a", "text": "北门有人" }, "at": 1754000000500 }
              ] },
  "poll": { "tool": "stratix_session_get", "args": { "session_id": "session_peer_chat_1753..._1" } } } }
```

**事件分页口径**：事件流按 `seq` **正序**返回（从旧到新）；`total` 取会话摘要的事件计数（会话域的权威计数），`has_more` = 本页最早一条的 seq 不为 1（更早还有事件，可把该 seq 作为下一次调用的 `before_seq` 继续往前翻）。

**映射**：同 §2.10 —— 读口 = core 的 `SessionReadPort`（`src/core/session/types.ts:182`），生产实现 = 同进程直读 SQLite（`src/stratix-gateway/mcp/context.ts:89` → `src/app/services/persistence/session-reader.ts:44`）；事件读面用 `SessionEventView`（`src/core/session/types.ts:136` —— 载荷是 `unknown`：读路径不替库校验形状，脏行不该炸掉整页读取）。

**写面缺席（有意）**：本工具**只读**。收尾会话（close）仍不开放（会话域内部的事）—— 只读面与写面的分界见 §3.4。会话域的**写面**工具是 `stratix_session_interrupt`（§2.12）与 `stratix_session_resume`（§2.13）。

---

### 2.12 `stratix_session_interrupt`

> **排序位**：第 12 位（`session` 域第三件，紧跟 `session_get`；条目号 §2.12 按「只加不删」追加在末尾）。

**description**

> 中断一条会话：把进行中 / 空闲的会话显式转成 interrupted，并落一条中断标记事件（会话不再"悄悄没了"）。
> **何时用**：一场互聊卡住或超时了，想让它停下来并留下可见、可查的痕迹；想确认某条会话还活着、要不要叫停。
> **何时不用**：只是想知道有哪些会话、发生过什么 —— 用 `stratix_session_list` / `stratix_session_get`；要取消一条排队中的角色任务 —— 用 `stratix_task_cancel`（中断会话停不住任务）；要断开一条 agent 连接 —— 连接由 agent-link 命令管，MCP 不提供。
> **边界**：只认**互聊**会话（`peer_chat`）—— 其余四类一律 `unsupported_kind`：`character_chat` 是每角色一条长生命周期记录（背后没有在跑的对局可停），`task_run` / `mission_run` 是任务 / 任务单实体的生命周期镜像（随实体终态自动收尾，中断它停不住任务），`shell_link` 是 agent-link 连接的投影（中断它不断开连接）；只有 `active` / `idle` 可中断（已中断 / 已收尾的会话重复中断一律拒绝，历史不改写）；中断只改会话状态并记一条 `interrupt` 事件 —— 不杀进程、不回滚已经产生的消息；中断不等于恢复（续聊是另一件事，本工具不做）。
> **错误**：`session_not_found`（会话 id 不在本进程的状态里）/ `unsupported_kind`（该类会话不支持中断）/ `illegal_transition`（会话已中断或已收尾）/ `invalid_arguments`（`session_id` 为空）/ `internal_error`（命令没人接管）。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "session_id": { "type": "string", "minLength": 1, "description": "会话 id（见 stratix_session_list）。" }
  },
  "required": ["session_id"],
  "additionalProperties": false
}
```

**返回（成功）**

```json
{ "ok": true, "data": {
  "session_id": "session_peer_chat_1753..._1", "kind": "peer_chat", "title": "互聊：侦察北门",
  "status": "interrupted", "previous_status": "active",
  "event_count": 13, "last_event_at": 1754000020000,
  "poll": { "tool": "stratix_session_get", "args": { "session_id": "session_peer_chat_1753..._1" } } } }
```

**映射**：落点 = `HudCommand.session.interrupt`（`src/core/types.ts`）→ core runtime 裁决 → `core/session/manager.ts` 的 `interruptSession`（**原子地**「记一条 `interrupt` 事件 + 迁移到 interrupted」）。MCP 侧不另写一套相位判定 —— 投完命令读回 `WorldState.sessions` 核对结果（与 `stratix_task_cancel` 同一纪律）。

**为什么写面看 WorldState、读面看库**：会话**历史**在库（`sessions` / `session_events` 两张表，事件本体不进广播）；而中断的**裁决与落点**在本进程的状态里（manager 写的正是这份 `WorldState.sessions`）—— 库里那条会话本进程未必还在跑（服务重启后不在内存、已收尾被 FIFO 淘汰），对一条不在跑的会话发命令没有意义。故本工具以 `WorldState.sessions` 为存在性判据，找不到即 `session_not_found`（不拿库里那条"历史"冒充"现在在跑"）。

**kind 边界（为什么只认 peer_chat）**：中断的含义是"叫停一场正在进行的对话"，而互聊是唯一一种**会话记录与"正在跑的那场对话"一一对应**的 kind（`agent-chat-service` 开场建会话、超时 / 取消时把它转 `interrupted` —— 这正是"超时即丢"的解药）。其余四类会话背后没有"在跑的东西"：中断它们只会给出误导性的"已中断"。口径与 core 的 resume 策略一致（方案 §8 第一期只做 `peer_chat`）；放宽是纯增量（只加不删），将来别的 kind 真有可停的东西时再放开。

> **与 §3.2 的关系**：MCP 没有"更宽松的通道"这回事 —— 状态机（`core/session/machine.ts` 的 interrupt 分支：只认 `active` / `idle`）对 MCP 同样生效，已中断 / 已收尾的会话一律 `illegal_transition`（历史不改写）。本工具额外加的 kind 边界是**工具面**的收紧（不是放宽），不与状态机冲突。

---

### 2.13 `stratix_session_resume`

> **排序位**：第 13 位（`session` 域第四件，紧跟 `session_interrupt`；条目号 §2.13 按「只加不删」追加在末尾）。

**description**

> 恢复一条被中断的互聊会话：把它转回 active，并把回灌的上文重新喂给参与者（续跑）。
> **何时用**：一场互聊超时 / 被中断了，想让它从断的地方接着聊；想确认这条被中断的会话还能不能续上。
> **何时不用**：只是想知道有哪些会话、发生过什么 —— 用 `stratix_session_list` / `stratix_session_get`；要重新开始一场**新**讨论 —— 恢复是接着原来的聊（带上下文），新开一场不是；要取消一条排队中的角色任务 —— 用 `stratix_task_cancel`（恢复会话停不住任务）。
> **边界**：只认**互聊**会话（`peer_chat`）—— 其余四类一律 `unsupported_kind`：`character_chat` 是每角色一条长生命周期记录（背后没有对局可续），`task_run` / `mission_run` 是任务实体的生命周期镜像（续跑 = 重跑任务），`shell_link` 是 agent-link 连接的投影（续跑 = 重连）；只有 `interrupted` 可恢复（`active` / `idle` / `closed` 一律拒绝，历史不改写）；恢复只改会话状态、回灌上文并重启轮转 —— 不回滚已经产生的消息，也不凭空补写没发生过的发言。
> **错误**：`session_not_found`（会话 id 不在本进程的状态里）/ `unsupported_kind`（该类会话不支持恢复）/ `illegal_transition`（会话不是被中断的）/ `invalid_arguments`（`session_id` 为空）/ `internal_error`（命令没人接管，或会话历史未接入、回灌不出上文）。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "session_id": { "type": "string", "minLength": 1, "description": "会话 id（见 stratix_session_list）。" }
  },
  "required": ["session_id"],
  "additionalProperties": false
}
```

**返回（成功）**

```json
{ "ok": true, "data": {
  "session_id": "session_peer_chat_1753..._1", "kind": "peer_chat", "title": "互聊：侦察北门",
  "status": "active", "previous_status": "interrupted",
  "event_count": 15, "last_event_at": 1754000030000,
  "poll": { "tool": "stratix_session_get", "args": { "session_id": "session_peer_chat_1753..._1" } } } }
```

**映射**：落点 = `HudCommand.session.resume`（`src/core/types.ts`）→ core runtime 转发给**恢复端口**（注入件）→ 会话域的 `manager.resume`（`src/core/session/manager.ts`）：**原子地**「翻状态位 `interrupted → active` + 记一条 `resumed` 事件 + 由事件流构建上下文快照」。MCP 侧不另写一套准入判定 —— 投完命令读回 `WorldState.sessions` 核对结果（与 `stratix_session_interrupt` 同一纪律）。

**恢复端口的两副面孔（进程拓扑的必然）**：`session.resume` 的落点是**注入件**，谁持有互聊引擎谁注入 —— 渲染进程注入的是**引擎级**恢复（回灌上文后重启轮转，`src/app/services/agent-chat-service.ts` 的 `resume`）；service 进程注入的是 **core 级**恢复（只翻状态位 + 建快照，互聊引擎不在该进程，见 `src/stratix-gateway/service/stratix-service.ts`）。MCP server 与 service 同进程，故 MCP 走的是 core 级那一档：状态回 `active`、事件流里多一条 `resumed`；**对话本身**由持有引擎的那一侧接着跑。

**没有事件源就不恢复（不空转）**：回灌的前提是能读到这条会话的**事件流**（`manager.resume` 的 `read` 口）。读口缺席时 core **如实拒绝**（状态纹丝不动），MCP 侧据此报 `internal_error` 并说明"会话历史未接入、无法回灌上文" —— 绝不回一个"已恢复"的假回执。

**kind 边界（为什么只认 peer_chat）**：与 §2.12 同一口径（方案 [SESSION-PLAN.md](SESSION-PLAN.md) §8「resume 第一期只做 peer_chat」）：续跑的前提是"背后有一场能接着跑的对局"，互聊是唯一一种会话记录与"正在跑的那场对话"一一对应的 kind。

> **与 §3.2 的关系**：MCP 没有"更宽松的通道"—— 状态机（`core/session/machine.ts` 的 resume 分支：只认 `peer_chat` + `interrupted`）对 MCP 同样生效；不是被中断的会话一律 `illegal_transition`（历史不改写）。

---

### 2.14 `stratix_mission_confirm`

> **排序位**：第 8 位（插在 `mission_checkpoint` 之后 —— `mission` 域的工具聚在一起；条目号 §2.14 按「只加不删」追加在末尾）。
> **v1.9 新增**：`mission` 域的**确认面**（此前确认权只在 UI 面板，外部 agent 造出的 `pending` 编组任务是死路）。

**description**

> 确认一条待确认的编组任务（mission，`pending` 相位）并让它开工 —— 直接落到 `running`。
> **何时用**：`stratix_mission_create` 用了 `auto_confirm=false`（或前置依赖当时没满足）造出停在 `pending` 的编组任务，现在条件具备了，放它开工。
> **何时不用**：任务还没指派任何人（`draft` 相位）—— 没有可确认的编组，调用会被拒并说明；任务已经确认过或在跑 —— 重复确认会被拒（回 `illegal_transition`）；任务已收尾（`done` / `cancelled`）—— 回 `mission_terminal`；想放行一条**角色任务** —— 用 `stratix_task_assign`。
> **边界**：只认 `pending` 相位（core 的 `decide` 口径，工具不另写一套）；确认 = 接单并开工（core 内部合并 `decide` + `start`），不产生终态墓碑。前置依赖未满足时 core 拒绝确认 —— 这**不是失败**：任务还在 `pending`，回执的 `blocked_by_dependencies` 报出还差哪几个前置，等前置收尾后再确认一次即可。确认不派活：确认只是让编组任务开工，具体做什么仍要派带 `mission_id` 的角色任务。
> **错误**：`mission_not_found`（任务不存在）/ `illegal_transition`（相位不对：`draft` 无编组可确认 / 已确认过）/ `mission_terminal`（任务已收尾）/ `invalid_arguments`（`mission_id` 为空）。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "mission_id": { "type": "string", "minLength": 1, "description": "编组任务 id（见 stratix_mission_status）。" }
  },
  "required": ["mission_id"],
  "additionalProperties": false
}
```

**返回（成功 · 已开工）**

```json
{ "ok": true, "data": {
  "mission_id": "mission_1753..._1", "title": "重构路由层", "phase": "running", "confirmed": true,
  "units": [ { "id": "unit_kimi", "name": "Kimi" }, { "id": "unit_codex", "name": "Codex" } ],
  "next": { "tool": "stratix_task_assign", "args": { "mission_id": "mission_1753..._1" }, "hint": "派具体任务时带上 mission_id，任务终态会自动回报到这条编组任务" },
  "poll": { "tool": "stratix_mission_status", "args": { "mission_id": "mission_1753..._1" } } } }
```

**返回（成功 · 前置依赖未满足，`confirm` 被 core 拒绝）**

```json
{ "ok": true, "data": {
  "mission_id": "mission_1753..._2", "title": "进攻北门", "phase": "pending", "confirmed": false,
  "blocked_by_dependencies": [ "mission_1752..._1" ],
  "next": { "tool": "stratix_mission_status", "args": { "mission_id": "mission_1753..._2" }, "hint": "前置任务收尾后再调一次 stratix_mission_confirm（依赖未满足时确认会被 core 拒绝）" },
  "poll": { "tool": "stratix_mission_status", "args": { "mission_id": "mission_1753..._2" } } } }
```

- `confirmed` 的口径是"**确认真的生效了吗**"（相位从 `pending` 走到了 `running` 才算生效）—— 依赖未满足时它是 `false`，不糊报"已开工"。

**映射**：`HudCommand.mission.confirm`（`decision: 'accept'`）→ core 的 `mission.confirmMission`（`decide` + `start` 内部合并 → `running`）。**回执自己核实**：工具在命令之后**回读状态**，比对确认前后的相位 —— 只有"`pending` → `running`"才报成功；相位没动说明这次确认**没生效**（core 拒绝了），按"依赖未满足"或"相位不对"分别如实回报，**绝不假装成功**（与 `stratix_mission_create` / `stratix_mission_checkpoint` 的"回读核对"同一纪律）。

**依赖判定不另写一份**：回执里 `blocked_by_dependencies` 报的是 core 的 `findMissingDependencies`（`core/mission/machine.ts`）算出来的结果 —— MCP 不自己判断"前置满没满"。

---

### 2.15 `stratix_mission_cancel`

> **排序位**：第 9 位（紧跟 `stratix_mission_confirm`；条目号 §2.15 按「只加不删」追加在末尾）。
> **v1.9 新增**：`mission` 域的**撤掉面**（此前外部 agent 造出来的悬空 / 探针编组任务在 MCP 内**无法清理**）。

**description**

> 撤掉一条**还没开工**的编组任务（mission，`draft` / `pending` 相位）—— 它从战场移除，`world_snapshot` 里不再出现。
> **何时用**：自己建的任务不要了 —— 建错了、只是探针、前置依赖永远等不到的悬空任务；清理掉，别让它挂在战场上。
> **何时不用**：任务已经开工（`confirmed` / `running`）—— 撤任务不等于撤活儿（角色任务还在跑），调用会被拒并说明；任务已收尾（`done` / `cancelled`）—— 终态不改写历史（回 `mission_terminal`）；想放行一条待确认的任务 —— 用 `stratix_mission_confirm`；只想查 —— 用 `stratix_mission_status`。
> **边界**：只认**从未开工**的相位（`draft` / `pending`，core 的 `canRemoveMission` 守门，工具不另写一套）；撤掉的是任务本身 —— 它占用的单位一并释放，它身上的检查点记账也随任务一起消失（需要留痕就派一条带 `mission_id` 的角色任务，别指望编组任务的记账行当历史）。
> **错误**：`mission_not_found`（任务不存在）/ `illegal_transition`（已开工，撤不掉）/ `mission_terminal`（任务已收尾）/ `invalid_arguments`（`mission_id` 为空）。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "mission_id": { "type": "string", "minLength": 1, "description": "编组任务 id（见 stratix_mission_status）。" }
  },
  "required": ["mission_id"],
  "additionalProperties": false
}
```

**返回（成功）**

```json
{ "ok": true, "data": {
  "mission_id": "mission_1753..._3", "title": "v3.6 读回验证探针", "previous_phase": "pending",
  "removed": true, "units_released": 0,
  "note": "这条编组任务已从战场移除（world_snapshot 里不再出现），它占用的单位已释放。",
  "poll": { "tool": "stratix_world_snapshot", "args": { "filters": { "domains": ["missions"] } } } } }
```

**映射**：`HudCommand.mission.remove`（v3.6 新增）→ core 的 `mission.removeMission`（守门 `canRemoveMission`：只认 `draft` / `pending`）。**回执自己核实**：工具在命令之后**回读状态** —— 这条编组任务不见了才算撤成功；还在 = core 拒绝了，按当前相位如实回报 `illegal_transition`，绝不假装撤掉。

**与 core 的 `mission.cancel` 的分工（两个动作不是一回事，别混用）**：

| 动作 | 语义 | 相位 | 留下什么 |
|------|------|------|---------|
| `mission.remove`（本工具） | **撤掉** —— 这条任务从没开工，什么都没发生，世界态里不必留墓碑 | 只认 `draft` / `pending` | **不留痕**（任务从世界态消失，占用的单位释放） |
| `mission.cancel`（core 内部，UI 的「停止任务」走这条） | **叫停** —— 任务已经开跑过，得有个"被叫停了"的交代 | 任意非终态 → `cancelled` | 留一条终态墓碑（历史不改写） |

why 拆成两个动作：**撤任务不等于撤活儿** —— 已开工的任务背后有角色任务在跑，`remove` 一律拒绝（`illegal_transition`）；而终态是历史，改写不得。MCP 只暴露"撤掉从未开工的任务"这一件 —— 外部 agent 的清理需求（清理自己造的悬空 / 探针任务）到此为止，"叫停在跑的编组"是 UI 面板的活儿（§3.3：渲染层操作不通过 MCP 暴露）。

---

### 2.16 `stratix_character_create`

> **排序位**：第 17 位（排在 `stratix_session_fork` 之后 —— `character` 域目前只有这一件；条目号 §2.16 按「只加不删」追加在末尾）。
> **v1.10 新增**：**名册供给面**（此前 MCP 只能读名册不能建名册 —— 空实例上 agent 连派单都发不出去：`task_assign` 必然 `unknown_character`，`mission_create` 只能造永不开工的 `draft`）。

**description**

> 新建一个 agent 角色档案：起名、绑定一种本地 CLI agent（原型）、给一份人设提示词，角色随即出现在名册与战场上。
> **何时用**：名册是空的（或缺人手）时要开工 —— 先建角色，再派单 / 建编组；这是 MCP 侧唯一的名册供给入口。
> **何时不用**：只想看现有名册 —— 用 `stratix_registry`；只想看战场忙闲 —— 用 `stratix_world_snapshot`；角色已经在了、只是要改人设或改名 —— 本工具只建档，不改档（改档走界面）。
> **边界**：`name` 必填（trim 后非空，≤ 24 码点；与现有名册重名按大小写不敏感判定，**重名直接拒绝**）。`archetype` 缺省 `claude-code`（= 绑定的 CLI agent 种类，也就是名册里的 `agent_kind`）；`skin_id` 缺省 `default`；`persona` 缺省套 core 的默认人设模板（≤ 2000 码点，MCP 侧自设）。初始等级恒为 1、经验恒为 0（core 建档口径，MCP 不另设参数）。建档即上场：角色落库的同时在战场上多一个单位（`unit_id` 一并回给你），可直接拿去指派。
> **错误**：`invalid_arguments`（名字缺失 / 超长 / 重名 / 人设超长 / 原型或皮肤取值非法 / 名册已满）/ `internal_error`。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "minLength": 1, "maxLength": 24, "description": "角色名（必填）。trim 后非空、≤ 24 码点；与现有名册重名（大小写不敏感）会被拒绝。" },
    "archetype": { "type": "string", "enum": ["claude-code", "codex", "opencode", "kimi", "openclaw", "dsh"], "default": "claude-code", "description": "角色原型 = 绑定哪种本地 CLI agent（= 名册里的 agent_kind）。缺省 claude-code。绑定未安装的 CLI 时派单会被拒。" },
    "persona": { "type": "string", "maxLength": 2000, "description": "人设提示词（选填）。缺省 / 空串 → 套 core 的默认人设模板；≤ 2000 码点（MCP 侧自设）。" },
    "skin_id": { "type": "string", "enum": ["default", "pixel", "crimson", "forest", "ocean", "sunset", "mono", "aurora"], "default": "default", "description": "皮肤资源键（渲染侧染色用）。缺省 default。" }
  },
  "required": ["name"],
  "additionalProperties": false
}
```

**返回（成功）**

```json
{ "ok": true, "data": {
  "character_id": "character_1753..._1", "unit_id": "unit_character_1753..._1",
  "character": { "id": "character_1753..._1", "name": "Neo", "persona": "你是一名在 Stratix 工作台里干活的本地 coding agent：…",
                 "level": 1, "experience": 0, "agent_kind": "claude-code", "skin_id": "default",
                 "external_session_id": null, "appearance": null, "context_enabled": null },
  "next": { "tool": "stratix_mission_create", "args": { "units": ["unit_character_1753..._1"] }, "hint": "给它起个任务标题就能开工（units 传这个角色的战场单位 id）" },
  "poll": { "tool": "stratix_registry", "args": {} } } }
```

**映射**：`HudCommand.character.create` → core 的 `character/manager.ts` 的 `createCharacter`（建档合法性在 `character/profile.ts` 的纯函数）。**回执自己核实**：工具在命令之后**回读状态** —— 名册里多出新角色才算建成功；没多出来（命令没人接管）按 `internal_error` 如实回报，绝不假装建成功。

**"建档即上场"是 core 的既有语义，不是 MCP 加的**：角色落库的**同一次** `setState` 里，core 把角色投影成战场单位（`character/unit-projection.ts`，单位 id = `unit_<角色 id>`）—— 一次广播两侧同时看到「角色 + 单位」。因此本工具**不需要**另配一件 `stratix_unit_create`：战场单位是角色的投影，不是独立的可建实体。

**准入判定只有一份**：重名与名册上限的**权威裁决**在 core 的 `createCharacter`（同一次 `setState` 内判，防并发抢名）；工具只在发命令**前**做一次快筛（口径直接复用 core 的 `hasDuplicateCharacterName`），好让调用方立刻拿到可读的拒绝理由，而不是"建了但没建成"。

**错误码不新增**：名册已满（`MAX_CHARACTERS = 64`）没有对应的专用错误码（附录 A 只有 `mission_capacity_exceeded` / `task_capacity_exceeded`），故按附录 A 的"不新增码"纪律复用 `invalid_arguments`，并在 `hint` 里说清下一步（先移除不需要的角色再试）—— 复用码的代价是这一档不叫"容量已满"，靠 message / hint 把它说清楚。

**持久化边界**：角色档案的落库由 core 的存档协调器（`app/services/persistence/game-save-coordinator.ts`）按名册 diff 写回 SQLite —— 那条链路挂在**渲染进程**一侧。纯 headless 的 gateway 进程里，MCP 建的角色只存在于内存世界态（进程重启即失），这是 §0.5 拓扑的既有分界，**不是**本工具引入的偏差。

---

### 2.17 `stratix_character_delete`

> **排序位**：第 18 位（排在 `stratix_character_create` 之后 —— `character` 域两件写面挨在一起；条目号 §2.17 按「只加不删」追加在末尾）。
> **v1.11 新增**：**名册清理面**（`stratix_character_create` 的逆向工具 —— 此前名册只进不出：试错 / 评估型 agent 建出来的废角色永远留在名册里，顶到 `MAX_CHARACTERS` 就连正常建档都建不出来）。

**description**

> 删除一个 agent 角色档案：角色从名册消失，它在战场上的单位也一并撤下。
> **何时用**：名册里留着试错 / 废弃 / 出错的角色要清掉（角色建错了、重复了、CLI 换掉了）；名册满了建不出新角色时，先删掉用不上的那些。
> **何时不用**：只想看现有名册 —— 用 `stratix_registry`；只想改角色的名字 / 人设 / 形象 —— 那是改档不是删档；想停掉角色手头的活 —— 用 `stratix_task_cancel` 撤任务（任务撤不掉就等它收尾），删角色不撤任务。
> **边界**：`character_id` 必填（要删的角色 id，用 `stratix_registry` 查）。**占用中的角色删不掉**（会先说清原因，不静默跳过）：① 在任务中（还有没收尾的任务 / 战场单位还在执行编组任务）；② 在线（该角色有在办会话、正在对话）。删除后名册与战场同时少一位（不会出现"名册没了、战场上还留个单位"的幽灵单位）。删一个不存在的 id → 报 `unknown_character`（明确说没有这条角色），不当成删成功。
> **错误**：`invalid_arguments`（character_id 缺失）/ `unknown_character`（名册里没有这个 id）/ `illegal_transition`（角色在任务中）/ `chat_busy`（角色在线、有在办会话）/ `internal_error`。

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "character_id": { "type": "string", "minLength": 1, "description": "要删除的角色 id（必填）。用 stratix_registry 查名册里的真实 id。" }
  },
  "required": ["character_id"],
  "additionalProperties": false
}
```

**返回（成功）**

```json
{ "ok": true, "data": {
  "character_id": "character_1753..._1", "name": "Neo",
  "removed_unit_id": "unit_character_1753..._1",
  "next": { "tool": "stratix_registry", "args": {},
            "hint": "名册已更新（角色与它的战场单位都已撤下）—— 用 stratix_registry 复核" } } }
```

**映射**：`HudCommand.character.delete` → core 的 `character/manager.ts` 的 `deleteCharacter`（占用裁决在 `character/delete-guard.ts` 的纯函数）。**回执自己核实**：工具在命令之后**回读状态** —— 名册里不再有这个角色才算删成功；还在（命令没人接管）按 `internal_error` 如实回报，绝不假装删成功。

**占用判定只有一份**：核心在 `character/delete-guard.ts` 的 `findCharacterDeleteBlock`（纯函数，读 `WorldState`）判「在任务中 / 在线」；core 的 manager 在**同一次** `setState` 内用它做权威裁决，工具只在发命令**前**用它做一次快筛并把原因说清 —— 两处共用同一份口径，不会一个说"在任务中"、一个说"在忙"。

**"占用"怎么定义（口径写在这里，免得各猜各的）**：
- **在任务中** = 该角色还有未收尾的角色任务（`queued` / `running` / `awaiting_approval`），**或**它的战场单位仍挂在一条编组任务上（`unit.missionId` 非空）/ 单位状态不是 `idle`；
- **在线** = 该角色有**在办会话**（`character_chat` 会话处于 `active`，即正在对话）。
  why 不拿 `units[].online`（CLI 进程健康态，**缺省即在线**）当闸门：拿它当闸门会把名册里绝大多数角色都锁死 —— 等于没有删除工具。真正占着这个角色的是"在办会话"。

**错误码不新增**（附录 A 的"不新增码"纪律，与 §2.16 同一条）：角色不存在 → 复用 `unknown_character`；在任务中 → 复用 `illegal_transition`（message / hint 里说清"在任务中"与下一步）；在线 → 复用 `chat_busy`（角色正忙的既有档）。复用码的代价是这一档不叫"删不掉"，靠 message / hint 把它说清楚。

**持久化边界**：与 §2.16 同一条分界 —— 角色档案的落库在**渲染进程**一侧的存档协调器（按名册 diff 写回 SQLite），纯 headless 的 gateway 进程里角色只存在于内存世界态（进程重启即失）。本工具删的是**世界态里的角色**；渲染进程一侧的名册同步走既有 diff 链路。

---

## 3. 一致性铁律

### 3.1 投影而非新功能层

**MCP 工具不是新功能，是 core 总线契约的投影。** 所有写操作最终落到既有的 `HudCommand`（`src/core/types.ts` 第 964 行起的联合类型）或既有 app 层服务；MCP **不新增**状态字段、**不新增**持久化表、**不新增**状态机。工具返回的一切都能在 `WorldState`（或其 SQLite 投影）里对上 —— MCP 不持有自己的真相源。最常见的违反形态是"MCP 侧自己记一张表以支持分页"：一旦如此，MCP 的视图就会和战场漂移，而 MCP 是**没有人看**的那一侧，漂移不会有人发现。

| MCP 工具 | 落点 | 说明 |
|----------|------|------|
| `stratix_task_assign` | `HudCommand.task.assign` | app 层 `task-service` 出队执行 |
| `stratix_task_cancel` | `HudCommand.task.cancel` | core 状态机裁决相位 |
| `stratix_mission_create` | `HudCommand.mission.create` + `.assign` + `.confirm` | 内部串起，见 §1.2 |
| `stratix_mission_checkpoint` | `HudCommand.mission.checkpoint` | core 追加一条 append-only 记账（不改相位） |
| `stratix_mission_confirm` | `HudCommand.mission.confirm` | core 状态机裁决（只认 `pending`）；回读核对是否真的落到 `running` |
| `stratix_mission_cancel` | `HudCommand.mission.remove` | core 守门（只认没开工的 `draft` / `pending`）；撤掉后这条任务从世界态消失 |
| `stratix_chat_send` | app 层 `chat-service.send` | 角色会话（非 link 会话） |
| `stratix_session_interrupt` | `HudCommand.session.interrupt` | core 状态机裁决相位（只认 active / idle） |
| `stratix_session_resume` | `HudCommand.session.resume` | core 会话域裁决准入（只认 peer_chat + interrupted）+ 回灌上下文快照 |
| `stratix_character_create` | `HudCommand.character.create` | core 的 character manager 裁决（同名 / 上限 / 合法性）+ 建档即上场（投影战场单位） |
| `stratix_character_delete` | `HudCommand.character.delete` | core 的 character manager 裁决（占用：在任务中 / 在线）+ 同一次 `setState` 里撤下角色与它的战场单位 |
| 其余七件 | 无（只读） | 读 `WorldState` 投影 / 会话库投影 |

> （`stratix_session_fork` 已上线、规范条目待补 —— 它同样落在既有 `HudCommand.session.*` 面上，不改变本表的投影口径。）

### 3.2 状态机约束对 MCP 同样生效

**MCP 没有"更宽松的通道"这回事。** 核心状态机在 `src/core/mission/machine.ts` 与 `src/core/task/machine.ts`（纯函数、唯一裁决点），MCP 触发的迁移与 UI 触发的迁移走**同一套**状态机、同一条判定 —— 状态机约束对 MCP 同样生效。

| 约束 | 事实位置 | MCP 侧表现 |
|------|---------|-----------|
| 任务取消只认 `queued`，且不杀在跑的任务 | `core/task/machine.ts` 的 `cancel` 分支 | `task_not_cancellable` + 回当前相位 |
| 编组任务确认只认 `pending` | `core/mission/machine.ts` 的 `decide` 分支 | `illegal_transition`（`stratix_mission_confirm` 对 `draft`（没编组可确认）与已确认过 / 在跑的任务一律拒绝） |
| 编组任务的「撤掉」只认**从未开工**（`draft` / `pending`） | `core/mission/machine.ts` 的 `canRemoveMission` + `core/mission/manager.ts` 的 `removeMission` | `stratix_mission_cancel` 对已确认 / 在跑的任务拒绝（`illegal_transition`），对终态拒绝（`mission_terminal`）—— 撤任务不等于撤活儿 |
| 带依赖的编组任务在**依赖满足前不被允许确认** | `core/mission/machine.ts` 的 `findMissingDependencies` + `core/mission/manager.ts` 的 confirm 守门 | `stratix_mission_create` / `stratix_mission_confirm` 的 `confirm` 被拒 → 任务停在 `pending`，回执 `blocked_by_dependencies` 报出还差哪几个（**不是失败**：任务已建成） |
| **编组任务只有 `running` 才能被回报完成** | `core/mission/machine.ts` 的 `complete` 分支（仅认 `running`） | 不存在"直接置完成"的 MCP 工具；完成只能由 `running → done` 到达 |
| 终态不改写历史 | 两个 machine 的终态守卫 | 重复取消 / 重复回报一律拒绝；终态任务不接受检查点记账 → `mission_terminal` |
| 失败不自动重试 | `core/task/machine.ts`（无 retry 动作） | 重派 = 新的一次 `stratix_task_assign` |
| 队列/历史上限 | `MAX_TASKS=100` / `MAX_MISSIONS=100` / `MAX_CHARACTERS=64` | 满则拒绝并回 `*_capacity_exceeded`，绝不静默挤掉在办条目（角色名册满 → `invalid_arguments` + hint 先移除不需要的角色，§2.16） |

**"非 running 不能被回报完成"要特别说清**：第一期**不提供**任何"把 mission 置为完成"的工具。编组任务的收尾只有一条路径 —— 挂在它下面的角色任务到达终态，由 app 层 `task-service` 的终态回报链（`task_076` 引入的 `missionId` 关联）驱动 `completeMission` / `cancelMission`。MCP 想让一条 mission 收尾，正确做法是派一条带 `mission_id` 的任务，而不是找一个"直接完成"的工具 —— 后者若存在，就等于给 MCP 开了一条绕过状态机的后门。

### 3.3 MCP 不暴露的能力

| 不暴露 | 理由 |
|--------|------|
| 渲染层操作（相机、选择集、小地图、编组槽位、主题色） | 渲染层是给**人**看的交互面；agent 调度任务不需要"把镜头挪过去"。且坐标真相在世界层（`UnitView` 刻意不含坐标，`src/core/types.ts` 第 156 行），暴露它等于把渲染细节写进接口契约 |
| Electron 生命周期（启动、退出、重载、更新） | 桌面壳的操作权属于用户；agent 进程不该有能力关掉用户的应用 |
| 文件系统（读写仓库、读日志文件） / 流式推送（订阅 WorldState 广播） | agent 自带文件工具，Stratix 的磁盘不是共享工作面（文件面也无法做有界广播）；MCP 工具调用是请求-响应，实时流靠轮询快照获得，暴露订阅会带来"连接常驻 + 断线补偿"一整套协议负担 |

一句话：**MCP 暴露"业务动作"，不暴露"实现机制"。**

### 3.4 只读面与写面的分界

- **只读工具**（`stratix_world_snapshot` / `stratix_task_status` / `stratix_mission_status` / `stratix_registry` / `stratix_session_list` / `stratix_session_get`）：读投影，无副作用，可随时调用、可并发调用。
- **写工具**（`stratix_task_assign` / `stratix_task_cancel` / `stratix_mission_create` / `stratix_mission_checkpoint` / `stratix_mission_confirm` / `stratix_mission_cancel` / `stratix_chat_send` / `stratix_session_interrupt` / `stratix_session_resume` / `stratix_character_create` / `stratix_character_delete`）：产生状态迁移（或记账写入），须遵守 §3.2 的状态机约束。

**幂等要求**：同一个写调用重复发出，第二次应被状态机以明确错误码拒绝（`illegal_transition` / `task_not_cancellable` / `mission_not_found`），**不得产生第二个实体**。MCP 不提供"幂等键"机制 —— 重复调用产生重复实体的风险，由"模型用回执里的 id 去查、去取消"来消解，而不是靠服务端猜。

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

**已占用域**（第一期）：`world`（`stratix_world_snapshot`）、`task`（`_assign` / `_status` / `_cancel`）、`mission`（`_create` / `_status` / `_checkpoint` / `_confirm` / `_cancel`，§2.5 / §2.6 / §2.9 / §2.14 / §2.15 —— 编组域的建 / 查 / 记账 + **生命周期收尾**：确认开工、撤掉没开工的）、`chat`（`_send`）、`session`（`_list` / `_get` / `_interrupt` / `_resume`，§2.10 / §2.11 / §2.12 / §2.13 —— 会话域的读面 + 写面）、`character`（`_create`，§2.16 —— **名册供给**：建一个 agent 角色档案，建档即上场；`_delete`，§2.17 —— **名册清理**：删掉一个角色档案，角色与它的战场单位一并撤下）、无域（`stratix_registry`）。

**预留命名位**：

| 预留域 / 位 | 规划中的工具 | 说明 |
|------------|-------------|------|
| `zone` | `stratix_zone_list` / `_create` / `_enter` / `_status` | **工作区域**。Zone 概念在 v3 已按 D5 砍掉，但"把若干角色圈进一个上下文/工位"是未来明确会有的能力，命名位先留出来，避免将来占用 `stratix_work_*` 或 `stratix_ctx_*` 之类与其它域撞车。**预留 ≠ 已实现**：`stratix_zone_*` 出现即表示该能力已上线，未上线前不得出现同名工具 |
| `pipeline` | `stratix_pipeline_start` / `_status` | 多 agent 流水线（core 已有 `PipelineSpec` 与 `pipeline.start` 命令，`src/core/types.ts` 第 1171 行）—— 第二期候选，第一期不实现 |
| `chat`（扩展位） | `stratix_chat_history` | 拉取某角色的历史消息（游标分页） |

> **已转正（原预留位）**：`stratix_mission_confirm` —— 原为 `mission` 域的预留命名位（"人工确认编组任务（第一期确认权留给 UI）"）；**v1.9 起已实现**（§2.14），预留位转正，命名位按 §4.2 的"预留 ≠ 已实现"规矩撤销占用。

**动作词受控表**：新增工具优先取自 `list` / `get` / `create` / `update` / `assign` / `send` / `cancel` / `start` / `status` / `snapshot` / `search`。确需新动词时先在本节登记再用 —— 动词词表膨胀会让"同类工具"失去可预测性。

**已登记的扩展动词**：`checkpoint`（`stratix_mission_checkpoint`，§2.9）—— 在一条编组任务上追加一条 append-only 记账行（不改相位）。登记理由：它是"写一条记账"这一个动作，与 `create`（立任务）、`assign`（派活）都不是同一件事；不登记就得用 `update` 硬套，而 `update` 的语义是"改字段"，会把"只追加不改写"的记账语义说糊。

`interrupt`（`stratix_session_interrupt`，§2.12）—— 把一条在办会话显式转成"已中断"（并落一条中断标记事件）。登记理由：它与 `cancel`（取消一条排队中的任务）**不是同一件事** —— `cancel` 撤的是一条还没开跑的任务，`interrupt` 叫停的是一场**正在跑**的对话；用 `cancel` 硬套会把"取消排队"与"打断进行中"混成一个动词，模型分不清该在什么时候用哪个。

`resume`（`stratix_session_resume`，§2.13）—— 把一条被中断的会话接回进行中（回灌上文 + 重启轮转）。登记理由：它与 `start`（开一场新讨论）**不是同一件事** —— `start` 是"从头开始"，`resume` 是"从断的地方接着"，后者必须带上文；用 `start` 硬套会让模型以为可以丢掉上下文重开，而那正是"恢复"要避免的事。

`confirm`（`stratix_mission_confirm`，§2.14）—— 把一条**待确认**的编组任务放行开工（`pending → running`）。登记理由：它与 `assign`（派活给具体执行者）**不是同一件事** —— `assign` 派的是"谁去干什么"，`confirm` 放行的是"这条编组本身准不准开工"（core 侧合并了 `decide` + `start`）；也不该用 `start` 硬套 —— `start` 意味着"从头开一件事"，而 `confirm` 是对**已经建好、已经编组、已经挂起等裁决**的那条任务盖章放行，它的前提条件（`pending` 相位）是 core 守门的，模型不必自己判断。

`delete`（`stratix_character_delete`，§2.17）—— 把一个角色档案从名册里删掉。登记理由：它与 `cancel`（撤掉一条还没开跑的活）**不是同一件事** —— `cancel` 撤的是"任务"，`delete` 删的是"角色"；一个角色可能手上一条活都没有（试错留下的废角色），那就没有可 `cancel` 的东西，只能删。用 `cancel` 硬套会把"撤活"与"删人"混成一个动词，模型分不清该撤任务还是该清名册。

**`cancel` 已在受控词表内**，但两处用它的工具语义各自收窄、互不重叠：`stratix_task_cancel` 撤的是一条**排队中**的角色任务（§2.4），`stratix_mission_cancel` 撤的是一条**从未开工**的编组任务（§2.15，撤掉后任务从世界态消失）—— 两者都只认"还没开跑的那一个"，都不动已经在跑的东西。

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

**传输层错误信封（协议级失败一律 JSON-RPC 帧）**：MCP 端点上的**任何**失败都必须长成 JSON-RPC 帧 —— 绝不允许把宿主框架的裸错误体（如 `{"code":500,"message":"Internal server error"}`）漏给 client。漏出去等于把"可判定的错误码"降级成一句"内部错误"，agent 无法据此决定"重试 / 改参 / 查日志"，只能盲重试。

| 失败点 | 响应形状 | 错误码 |
|--------|----------|--------|
| 请求体不是合法 JSON（截断 / 畸形） | JSON-RPC error 帧，`id: null` | `-32700` Parse error |
| 请求体超上限（MCP 侧 1mb） | JSON-RPC error 帧，`id: null` | `-32600` Invalid Request |
| 帧不是合法 JSON-RPC 2.0 请求 | JSON-RPC error 帧，`id: null` | `-32600` Invalid Request |
| 未知方法 | JSON-RPC error 帧 | `-32601` Method not found |
| `tools/call` 缺工具名 / 未知工具 | JSON-RPC error 帧 | `-32602` Invalid params |
| 工具抛**未捕获异常**（不是 `McpToolError`） | JSON-RPC error 帧 | `-32603` Internal error |
| 工具**主动**抛 `McpToolError`（含 `internal_error`） | 失败信封 + `isError: true` | 附录 A 的业务码 |

三条硬约束：

1. **HTTP 状态码恒 200**（通知类请求 202 空体）—— 判据是帧里的错误码；用 4xx/5xx 承载协议错误会让部分 client 直接判"传输失败"，连帧都读不到。
2. **未捕获异常 ≠ 业务失败** —— 只有工具主动抛的 `McpToolError` 才走失败信封；崩溃一律 `-32603`。把崩溃报成 `internal_error` 会让 agent 以为"业务上拒绝"，从而去改参数重试，而不是查服务端日志。
3. **挂载位次是硬约束** —— `/mcp` 必须挂在宿主的全局 body 解析器**之前**：否则畸形 JSON 在到达 MCP 路由之前就被全局解析器抛掉，错误绕过 MCP 路由、落到宿主 app 级错误处理器（裸 500）。MCP 路由自带解析器（1mb 上限）并自己把解析错误读成 `-32700`。


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
| v1.11 | 2026-11-04 | **新增工具** `stratix_character_delete`（§2.17，**名册清理面**：删除一个 agent 角色档案 —— 落点 = 新增的 `HudCommand.character.delete`，core 同一次 `setState` 里撤下角色与它的战场单位，回执带 `character_id` + `name` + `removed_unit_id`）；**core 契约增补** —— `HudCommand` 新增 `character.delete`，占用裁决在 core（`character/manager.ts` 的 `deleteCharacter` + `character/delete-guard.ts` 的纯函数：① 在任务中（未收尾任务 / 单位仍挂在编组任务上）② 在线（该角色有在办会话））；`tools/list` 新增一件（十七件 → 十八件），排在 `character_create` 之后（既有工具之间的相对次序不变） | ✅ 纯增量：既有十七件工具的名字、参数、语义与缺省行为**均未变**；`tools/list` 的既有次序逐字未动；**不新增任何错误码**（复用 `unknown_character` / `illegal_transition` / `chat_busy` / `invalid_arguments` / `internal_error`）；不新增状态通道 / 持久化表 / 状态机（写面走既有 character manager 与既有 `WorldState` 字段）；占用判定**只有一份**（core 的 `findCharacterDeleteBlock`，工具只做发命令前的快筛） |
| v1.10 | 2026-11-04 | **新增工具** `stratix_character_create`（§2.16，**名册供给面**：新建一个 agent 角色档案 —— 落点 = 既有的 `HudCommand.character.create`，建档即上场（core 同一次 `setState` 里投影战场单位），回执带 `character_id` + 完整角色对象 + `unit_id`）；**新增域** `character`（§4.2 域表）；`tools/list` 新增一件（十六件 → 十七件），排在 `session_fork` 之后（既有工具之间的相对次序不变） | ✅ 纯增量：既有十六件工具的名字、参数、语义与缺省行为**均未变**；`tools/list` 的既有次序逐字未动；**不新增任何错误码**（复用 `invalid_arguments` / `internal_error`）；不新增状态通道 / 持久化表 / 状态机（写面走既有 `character.create` 命令与既有 character manager）；重名与名册上限的裁决**只有一份**（core 的 `createCharacter`，工具只做发命令前的快筛） |
| v1.9 | 2026-11-04 | **新增工具** `stratix_mission_confirm`（§2.14，把一条 `pending` 的编组任务放行开工）与 `stratix_mission_cancel`（§2.15，撤掉一条**从未开工**的编组任务 —— 撤掉后 `world_snapshot` 里不再出现）；**新增动词** `confirm` 登记（§4.2，`mission` 域的预留命名位 `stratix_mission_confirm` 转正）；**core 契约增补** —— `HudCommand` 新增 `mission.remove`（§3.1 / §3.2 / §2.15），守门在 core 的 `canRemoveMission`（只认 `draft` / `pending`；与 core 既有的 `mission.cancel`「叫停、留终态墓碑」分工明确）；**悬空引用修正** —— `stratix_mission_create`（§2.5）的描述不再自认"第一期 MCP 不提供确认工具"，改为指向 `stratix_mission_confirm` / `stratix_mission_cancel`；`tools/list` 新增两件（十四件 → 十六件），排在 `mission_checkpoint` 之后（既有工具之间的相对次序不变） | ✅ 纯增量：既有十四件工具的名字、参数、语义与缺省行为**均未变**；`tools/list` 的既有次序逐字未动；**不新增任何错误码**（复用 `mission_not_found` / `illegal_transition` / `mission_terminal` / `invalid_arguments` / `internal_error`）；core 侧只**增**一个动作（`mission.remove`），既有 `mission.cancel` 的语义与行为逐字未变（UI 的「停止任务」照旧留墓碑） |
| v1.8 | 2026-11-03 | **只写不读补读回** —— `stratix_mission_status`（§2.6）单条模式新增 `brief`（结构化正文全文）与 `checkpoints`（append-only 记账行全量，上限 64）两段读回面，附 `checkpoint_count` / `checkpoint_limit`（§2.9 的读侧缺口结清）；**悬空引用修正** —— `stratix_chat_send`（§2.7）描述不再指向尚未实现的 `stratix_chat_history`（也不改指 `stratix_session_get`：角色对话的消息本体在 `chat_messages` 表里，会话事件流里只有一条空的 `round` 记账事件）；**schema 自洽修正** —— `stratix_task_assign`（§2.2）的 `origin` 取值域补 `mcp`（`default: "mcp"` 原先不在自己的 `enum` 内，严格模式的校验器会拒收那张 schema），`ui` 仍拒绝 | ⚠️ **既有工具的返回形状变宽**：`mission_status` 单条模式的 `data.mission` 多出 `brief` / `checkpoints` / `checkpoint_count` / `checkpoint_limit` 四个字段（**加字段，不改语义**，既有字段逐字未动、列模式未动）；`origin` 显式取值集由 `{agent, script}` 扩为 `{mcp, agent, script}`（`mcp` 与缺省同义，`ui` 的拒绝口径未变）；工具名 / 参数名 / 错误码 / `tools/list` 顺序全部未动 |
| v1.7 | 2026-11-03 | **传输层错误信封收敛**（§4.4 新增「传输层错误信封」小节 + 附录 A 新增协议层错误表）—— 畸形 JSON 不再漏宿主框架的裸 `{"code":500}`，改回 JSON-RPC `-32700`（id=null）；工具抛未捕获异常不再冒充业务失败信封，改回 `-32603`；`/mcp` 的挂载位次固化为硬约束（必须排在全局 body 解析器之前）；`invalid_arguments` 的 message 区分为「参数缺失」与「类型不对」（`requireString` 少数字段文案） | ✅ 协议层修正，工具面**零变更** —— 十四件工具的名字、参数、语义、返回形状、`tools/list` 顺序全部未动；成功路径逐字未变；业务失败仍走失败信封 + `isError`（错误码总表除 `internal_error` 的「典型触发」描述澄清外未动）；仅未捕获异常的形状从 `internal_error` 信封改为 `-32603` JSON-RPC error |
| v1.6 | 2026-11-02 | **新增工具** `stratix_session_resume`（§2.13）—— 会话域写面的**第二件**（把一条被中断的互聊会话接回进行中：回灌上文 + 重启轮转，落点 = 既有的 `HudCommand.session.resume`）；**新增动词** `resume` 登记（§4.2）；`tools/list` 新增一件（十二件 → 十三件），排在 `session_interrupt` 之后（既有工具之间的相对次序不变） | ✅ 纯增量：既有十二件工具的名字、参数、语义与缺省行为**均未变**；`tools/list` 的既有十二件次序逐字未动；不新增任何状态通道 / 持久化表 / 状态机（写面走既有 `session.resume` 命令与既有会话状态机；§2.13 的 kind 边界与 §2.12 同一口径） |
| v1.5 | 2026-11-02 | **新增工具** `stratix_session_interrupt`（§2.12）—— 会话域的**写面第一件**（把一条在办会话转 interrupted 并落中断标记，落点 = 既有的 `HudCommand.session.interrupt`）；**新增错误码** `unsupported_kind`（附录 A）；**新增动词** `interrupt` 登记（§4.2）；`tools/list` 新增一件（十一件 → 十二件），排在 `session_get` 之后（既有工具之间的相对次序不变） | ✅ 纯增量：既有十一件工具的名字、参数、语义与缺省行为**均未变**；`tools/list` 的既有十一件次序逐字未动；不新增任何状态通道 / 持久化表 / 状态机（写面走既有 `session.interrupt` 命令与既有会话状态机） |
| v1.4 | 2026-11-02 | **新增工具** `stratix_session_list`（§2.10）与 `stratix_session_get`（§2.11）—— 会话域的**只读面**（外部 agent 由此看见会话）；**新增错误码** `session_not_found`（附录 A）；**新增域** `session`（§4.2 域表）；`tools/list` 新增两件（九件 → 十一件），排在既有九件之后（既有工具之间的相对次序不变） | ✅ 纯增量：既有九件工具的名字、参数、语义与缺省行为**均未变**；`tools/list` 的既有九件次序逐字未动；新增两件**只读**（不新增任何状态通道 / 持久化表 / 状态机） |
| v1.3 | 2026-11-02 | **新增章节** §6「v2 设计章：四条工程模式（草案 · 未实现）」—— 借 DeepSeek Harness 的四条工程模式（工具管线 waterfall / capability seam 三件套 / 事件日志 + 投影 / 可逆注册），逐条给出「现状对照 → 目标语义 → 迁移草案」；含 9 件工具的 waterfall 映射表 | ✅ 纯文档：**运行时代码零改动** —— 工具名 / 参数 / 返回 / 错误码 / `tools/list` 顺序全部未动；§6 全部内容是**未实现的设计**，与 §1–§5 冲突时以 §1–§5 为准 |
| v1.2 | 2026-11-02 | **新增章节** §0.5「拓扑定位（新旧拓扑对比）」—— 写清 MCP 在前后端分离后的位置：gateway 进程即 service 进程，先 boot service 再挂 `/mcp`，故工具见真状态（附新旧拓扑 ASCII 对比图与逐维度对照表）；§0.2 权威依据增列 SERVICE-SPLIT-PLAN；§4.4 增注指回 §0.5 | ✅ 纯文档：工具面**零变更** —— 工具名 / 参数 / 返回 / 错误码 / `tools/list` 顺序全部未动 |
| v1.1 | 2026-11-01 | **新增工具** `stratix_mission_checkpoint`（§2.9，记一条 append-only 检查点）；**新增可选参数** `stratix_mission_create` 的 `brief`（四段结构化正文）与 `depends_on`（前置任务链，§2.5）；**新增错误码** `mission_terminal`（附录 A）；**新增术语** 依赖解锁 / brief / 检查点（§0.4）；`tools/list` 顺序改为按**排序位**（§2.0），新工具插在 `mission_status` 之后、`registry` 之前（既有工具之间的相对次序不变） | ✅ 纯增量：既有 8 件工具的名字、参数、语义与缺省行为**均未变**（`brief` / `depends_on` 缺省即"裸任务"，与 v1.0 逐字节一致）；`auto_confirm_applied` 的口径在**新增的依赖未满足分支**上才出现差异（`false` = auto_confirm 没能生效），v1.0 的三条既有路径取值不变 |


---

## 6. v2 设计章：四条工程模式（草案 · 未实现）

> **性质**：**设计章 —— 只描述目标语义，不含实现**。本章任何一条都**未**进入运行时代码（`src/` 零改动）。
> **来源**：借 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的四条工程模式 —— ① 工具管线 waterfall（`pre-execute → execute → post-execute`）；② capability seams（Definition / Provider / Consumer）；③ session log（append-only 事件流 + 投影，"model-visible means logged"）；④ Cordis effect（可逆注册：挂载必带卸载）。
> **借的是模式，不是代码**：不引入任何 npm 依赖；dsh 的 session log **不取代** Stratix 的 WorldState 真相源（[SERVICE-SPLIT-PLAN.md](SERVICE-SPLIT-PLAN.md) 铁律 1）。本章的来源与边界见 [DSH-INTEGRATION-PLAN.md §3](DSH-INTEGRATION-PLAN.md#3-借逻辑mcp-spec-v2-章节task_087)。
> **与 §1–§5 的关系**：§1–§5 是**已冻结的第一期工具面**（规范与实现一致）；本章是**下一期设计**。两者冲突时**以 §1–§5 为准**，直到本章逐条评审并实现为止。
> **为什么写在本文档里而不是另起 `docs/MCP-SPEC-V2.md`**：四条模式与第一期工具面是**同一批工具的两种切面**（§2 讲"工具是什么"，§6 讲"工具怎么被调用、被挂载、被溯源"）。拆成两份文档，"工具 ↔ 段位"的对应关系就会跨文件漂移 —— 而漂移正是本文档 §5.4 明令禁止的（"文档撒谎比文档缺失更贵"）。若后续 §6 的篇幅压过主文档承载力，再拆不迟。

### 6.0 四模式总览

> **口径说明（v1.4 起 · v1.5 / v1.6 追记）**：本章的"现状对照"与映射表写于**九件工具**时代（v1.1）。此后新增的四件工具（`stratix_session_list` / `stratix_session_get`，§2.10 / §2.11；写面第一件 `stratix_session_interrupt`，§2.12；写面第二件 `stratix_session_resume`，§2.13）**未纳入本章的映射表** —— 本章是**未实现的设计章**，不改写；四件新工具按 §1–§5 的现行约定实现（读投影 / 投影既有命令、四要素 description、附录 A 错误码）。

| 模式 | 一句话 | 我们的现状（一句话） | 本章要收敛成的 |
|------|--------|----------------------|----------------|
| waterfall 工具管线 | 一次调用固定走三段守卫 | 三段散在九个 handler 里，各写各的 | 三段语义写死 + 挂点入表 |
| capability seam 三件套 | 定义 / 提供 / 消费三方各守其位 | 端口已注入，但"能力清单"没声明 | Provider 自陈能力，Consumer 按声明消费 |
| 事件日志 + 投影 | 事件是真相，state 是投影 | 只有物化 state，无事件流；seq 是版本号 | seq 的口径写死；工具返回逐字段可溯源 |
| 可逆注册 | 注册必带 disposer，卸载不留残 | runtime / 组合根有 stop 链，MCP 注册表**没有卸载** | 统一 disposer 契约 + 顺序规范 |

四模式的分工是**正交**的：§6.1 管**一次调用内部**的纵向流程；§6.2 管**工具与宿主之间**的横向契约；§6.3 管**状态的真相当层**（工具返回的每个字段从哪来）；§6.4 管**能力的挂载与卸载**。合起来回答同一个问题：**一个 agent 驱动的工具面，怎样做到可审计、可替换、可溯源、可拆。**

### 6.1 waterfall 工具管线

#### 6.1.1 现状对照

**现状：没有"管线"这个概念，只有每件工具各写各的三段。** 三段的语义事实上存在，但只写在各 handler 的注释里，规范里一处也没有：

| 段 | 事实位置 | 现状做法 |
|----|---------|---------|
| **pre-execute** | 九个 handler 各自开头 | ① 入参形状与上限校验（`args.ts` 的 `requireString` / `optionalInteger(min,max)` / `optionalStringArray` + `countCodePoints` —— 运行期**没有** schema 校验器，`tools/mission.ts` 的 `readBrief` 注释写明了这一点）；② 资源准入（`task_assign` 查 `MAX_TASKS`、`mission_create` 查 `MAX_MISSIONS`）；③ 角色守门（`tools/common.ts` 的 `guardCharacter` 四条：在档 / 绑了 agent / CLI 已检出 / 不离线，`assign` 与 `chat` 共用一份）；④ 存在性与终态校验（`task_cancel` 查任务在不在、`mission_checkpoint` 查编组在不在 + `isTerminalPhase`）；⑤ 审计标注（`origin` 值域校验 —— **只有 `task_assign` 认 `origin`**） |
| **execute** | `host.dispatchCommand(cmd)` | 统一是 fire-and-forget：core runtime **不回传命令结果**（`src/core/runtime.ts` 的 `handleCommand` 消费后落状态机，没有 ack 通道；world-sync 的 `command.ack` 是给 WS 命令面用的，MCP 不走那条路） |
| **post-execute** | 各 handler 的命令之后 | 回读核对，**匹配策略各不相同**：`task_assign` 差分任务集合并匹配 `characterId` + `prompt` 相等的新任务；`task_cancel` 比对 before/after 相位；`mission_create` 回读相位并以 `phase==='running'` 判 `auto_confirm` 是否生效；`mission_checkpoint` 回读最后一条 checkpoint 的 note 是否与入参相等（core 记账是静默的） |

**四处具体缺口**（都是当前事实，不是猜测）：

1. **段边界只存在于注释里**。规范里没有任何一处写明"pre 段不得改状态 / post 段不得改状态 / execute 是唯一写点"。工具作者只能靠读别人的 handler 推断该把新代码放哪 —— 于是 `task_assign` 的 pre 段里混着容量判定，`mission_create` 的 post 段里同时做了"落地核对"与"依赖是否满足"两件事，段位靠**注释**而非结构区分。
2. **回读核对的匹配策略脆弱**。`task_assign` 用"同角色 + 同 prompt + 新 id"做差分匹配并取 `.pop()` —— 同一角色**并发**派两条相同 prompt 的单时，两条都匹配，回执可能认错那条单。（并发派单当前被角色串行执行（并发 1）挡着大部分，但 `task.assign` 入队即返回，故"两条同 prompt 的单先后入队"是可达路径。）
3. **审计位落在 execute 段之外，且无处落地**。这一处有**两层**欠缺：
   - **覆盖欠缺**：§2.0 写的是"**所有**写类工具接受可选 `origin`"，而实现上**只有 `stratix_task_assign` 认 `origin`** —— `task_cancel` / `mission_create` / `mission_checkpoint` / `chat_send` 四件写工具的 schema 里都没有这个字段（§5.4 的口径是"文档与实现不一致时以代码为准并立刻修文档"；本章只**记录**该差异，不在第一期改 §2.0 的措辞 —— 那属于第一期契约变更，要走 §5.3）。
   - **落地欠缺**：即便在 `task_assign` 上，`origin` 也只在 MCP 侧被校验并**回显在回执里** —— `HudCommand.task.assign`（`src/core/types.ts`）**没有** origin 字段，`src/app` 与 `src/core` 全库检索 `origin` **零命中**。也就是说 §2.0 写的"origin 审计字段"目前**不落库、不可追责**：模型看到 `origin: "agent"`，但事后没有任何一行记录能佐证这条单真是 agent 派的。
4. **多步执行没有形状**。`mission_create` 一次调用发三条命令（create → assign → confirm），这在 §1.2 原则二下是合法的"合并发生在工具内部"，但 waterfall 的三段是**按调用**划的 —— "execute 段里串三步、post 段统一核对一次"这件事没有规范口径。

**只读工具的退化形态**：四件只读工具（`world_snapshot` / `task_status` / `mission_status` / `registry`）没有 execute 段，pre 段只做过滤器校验，post 段不存在 —— 它们是"读一次投影，投影本身就是结论"。

#### 6.1.2 目标语义

**一次工具调用 = 一次 waterfall，三段固定**：

| 段 | 职责 | 允许做什么 | 禁止做什么 | 失败语义 |
|----|------|-----------|-----------|---------|
| **pre-execute**（准入段） | ① 入参形状与上限；② 资源准入（容量 / 角色守门 / 存在性 / 终态）；③ 审计标注（origin / 通道） | 只读检查 | **不得**改任何状态；**不得**发命令 | 无副作用拒绝（信封 `ok=false` + 附录 A 的错误码），绝不"先执行再报错" |
| **execute**（执行段） | 把一次调用翻译成既有命令并投递 | `dispatchCommand` | **不得**做业务判定（它不知道"这条命令合不合法"，那是状态机的事）；**不得**直接改 store | 命令被状态机拒 = 由 post 段读出并转译成对应的错误码 |
| **post-execute**（核对段） | 回答一句"刚才那条命令**到底落地了没有**" | 只读核对 | **不得**改状态；**不得**重发命令 | 未落地 = `internal_error`（明说"没落地"），**绝不假装成功**（§2.9 记账回执的既有口径） |

**四条不变式**：

- **I1**：pre 段与 post 段**零副作用** —— 两段都只读。
- **I2**：execute 段是**唯一**写点，且只经 `dispatchCommand` 发 core 命令（§3.1：MCP 不自己改状态）。
- **I3**：post 段的判据只能是**状态事实**（WorldState / SQLite 投影），**不能**是"我刚发过命令"这件事本身。发过 ≠ 落地。
- **I4**：每件工具的三段挂点写在本章的映射表里；**改挂点 = 改契约**，走 §5.3 的变更流程。

**多步执行的形状**（`mission_create` 这类）：execute 段内部可串多步，**每一步各自被状态机独立裁决**（任一步被拒则整条作废，core 的 `commit` 已是原子口径），post 段**统一核对一次最终落点**（`phase` 与 `auto_confirm_applied`）。多步不产生多个 post 段。

**何时用**：写工具走三段齐全；只读工具走"pre（过滤器校验）+ 无 execute + 无 post"。**何时不用**：不要把 post 段做成"重试段" —— 核对失败是**报告**未落地，不是"再发一次命令"（重试会制造重复实体，违反 §3.4 的幂等要求；重复调用本来就该由状态机以明确错误码拒绝）。

**正例**（目标形态 · 伪代码，仅示意段位，不含实现）：

```ts
// pre：只读，零副作用
const admitted = admitTaskAssign(args, host.getWorldState()); // 形状 / 容量 / 守门 / origin
// execute：唯一写点，只发命令
host.dispatchCommand({ type: 'task.assign', characterId: admitted.characterId, prompt: admitted.prompt });
// post：只读核对，判据是状态事实
const landed = findLandedTask(host.getWorldState(), admitted); // 落地判据要能抗同 prompt 并发（见迁移草案 P2）
if (!landed) throw new McpToolError('internal_error', '派单未落地：…');
```

**反例**（两种违反段位的常见错解）：

```ts
// ❌ 反例一：把"重试"塞进 post 段 —— 发过命令不等于落地，重发会造出第二个任务
host.dispatchCommand(cmd);
if (!landed) { host.dispatchCommand(cmd); /* 重复实体 */ }

// ❌ 反例二：pre 段里发命令 —— 准入检查与执行混在一段，失败时"拒绝"其实已经产生副作用
if (!guard.ok) throw ...;      // 前半段：只读
host.dispatchCommand(cmd);     // 后半段：执行
if (!landed) throw ...;        // 失败时状态已被改动，pre 的"无副作用拒绝"落空
```

#### 6.1.3 迁移草案

**分三步，每步都标清是否动运行时**（本节只出草案，实施另开任务）：

| 步 | 内容 | 动运行时？ | 风险 |
|----|------|-----------|------|
| **P0** | 把三段语义与不变式写进本章（纯文档），并在每个 handler 的文件头把现有代码标注为 pre / execute / post 三段（注释标注，不改逻辑） | ❌ 否 | 零 |
| **P1** | 抽取**公共 pre 段**的只读判定（容量、角色守门、词表校验）到 `tools/common.ts` 的公共函数 —— **只做提取，不改判定口径**（`guardCharacter` 已是"两个消费者共用一份判定"的收敛点，照此扩到容量与词表） | ✅ 是（纯提取） | 低：判定口径逐字不动，用现有单测兜住 |
| **P2** | 引入**公共 post 段**核对助手，并把 `task_assign` 的匹配判据从"同角色 + 同 prompt 差分"换成**不依赖内容相等**的落地判据（见 §6.3 的变更计数，或"本进程命令回执"通道） | ✅ 是 | 中：改的是"回执认谁"的判据，需补并发用例 |

**P2 的备选判据（两条路，评审时二选一）**：

- **路 A · 变更计数**：core 在每次状态变更时递增一个单调计数，post 段比对"命令前后计数是否变化 + 新实体是否出现"。代价：要在 `WorldState` 之外暴露一个计数位 —— 属 core 契约变更，须走 §5.3 的 ⚠️ 流程。
- **路 B · 命令回执通道**：让 `dispatchCommand` 能拿到 core 的裁决结果（成功 / 拒绝码）。代价：动 core 总线的命令契约（`src/core/bus.ts` 与 runtime），比路 A 重，但它同时解决 §6.3 的"回读核对脆弱"与"命令没人接管只能靠差分猜"两个问题。

> **本节不做的事**：不把"三段"做成运行时的中间件框架（那会引入一层新的间接，与 core「零 IO、纯逻辑」与 gateway「不加无谓层次」的取向相悖）。三段是**规范里的概念**，落地形态是**函数内的三段**或**三个小函数**，不是一条管线对象。

#### 6.1.4 waterfall 映射表（9 件工具，完整）

> **注 · 工具件数**：第一期是**八件**工具（§2.1–§2.8），v1.1 又增了第九件 `stratix_mission_checkpoint`（§2.9），v1.4 再增两件会话只读工具（§2.10 / §2.11），v1.5 增了会话写面第一件（§2.12），v1.6 再增会话写面第二件（§2.13）—— 本表覆盖**v1.1 时的九件**（写作"9 件"）；后加的四件会话工具不在本表内（本章是未实现的设计章，见 §6.0 的口径说明）。

> **表 6.1-1 现状：三段挂在哪（写今天的事实）**

| # | 工具 | pre-execute（现状） | execute（现状） | post-execute（现状） | 缺口 |
|---|------|--------------------|----------------|-------------------|------|
| 1 | `stratix_world_snapshot` | 过滤器词表校验（`domains` / `unit_status` / `mission_phase` / `task_status`）+ `limit` 上下界 | 无（只读） | 无 | 段位未标注；过滤器校验与词表定义同文件两份（`world.ts` 的 `DOMAINS` 与 spec §2.1 各一份） |
| 2 | `stratix_task_assign` | `origin` 值域校验 + `prompt` 非空/上限 + `guardCharacter('assign')` + 队列容量（`MAX_TASKS`） | `dispatchCommand(task.assign)` | 差分任务集合 + 匹配 `characterId` + `prompt` 相等的新任务 | `mission_id` **存在性未校验**（指向不存在的编组时任务照派，终态回报链找不到收尾对象，错误只落日志，调用方看不见）；`origin` 不落库；差分匹配抗不了同 prompt 并发 |
| 3 | `stratix_task_status` | `task_id` 形状校验 | 无（只读） | 无 | `include_output=true` 时全文来自 SQLite（跨投影面），回落摘要时用 `output_truncated=true` 表达（见 §6.3） |
| 4 | `stratix_task_cancel` | `task_id` 形状校验 + **存在性**（查状态，不判状态） | `dispatchCommand(task.cancel)` | before/after 相位比对：`queued → cancelled` 才算成功；状态机拒了 → `task_not_cancellable`；没变 → `internal_error`（命令没人接管） | 段位未标注；「仍 queued」与「没人接管」靠推断区分（当前靠"排队中的任务被取消后必然变 cancelled"这一不变量） |
| 5 | `stratix_mission_create` | `title` 非空/上限 + `units` 条数上限 + `brief` 四段形状与长度 + `depends_on` 条数上限 + 容量（`MAX_MISSIONS`） | **三步**：`mission.create` → `mission.assign` →（`auto_confirm` 时）`mission.confirm(accept)` | 回读最终相位；以 `phase==='running'` 判 `auto_confirm_applied`；依赖未满足时用 core 的 `findMissingDependencies` 判定（**不另写一份依赖规则**） | post 段里混着"落地核对"与"依赖是否满足"两件事；多步执行的段位无规范口径 |
| 6 | `stratix_mission_status` | `mission_id` 形状 + `limit` 上下界 | 无（只读） | 无 | 列模式截断标记齐全（`returned`/`total`/`truncated`），无缺口 |
| 7 | `stratix_mission_checkpoint` | `mission_id` / `note` 形状 + `note` 上限（500 码点）+ **存在性** + **终态**（`isTerminalPhase`） | `dispatchCommand(mission.checkpoint)` | 回读最后一条 checkpoint 的 note 是否与入参相等（core 记账是静默的） | 记账是 domain 里**唯一的 append-only 事件行**，但没有统一的"事件已记录"契约（见 §6.3） |
| 8 | `stratix_chat_send` | `character` / `message` 形状 + `message` 上限（8000）+ `guardCharacter('chat')` + **端口存在性**（`host.sendChatRound` 未接 → `internal_error`） | 委托 `host.sendChatRound`（一轮对话，**同步等回复**） | 无（对话结果本身就是执行结果） | 端口未接是**运行期才发现**（见 §6.2）；本轮回复**不进 WorldState**（只在落库的对话表里），返回字段无状态侧对照物（见 §6.3） |
| 9 | `stratix_registry` | 无入参（schema 为空对象） | 无（只读） | 无 | 三段全空 —— 是"无管线"的合法形态，但**没有任何地方写明它合法** |

> **表 6.1-2 目标：收敛后的三段挂点**

| # | 工具 | pre（统一口径） | execute | post（统一口径） | 收敛动作 |
|---|------|-----------------|---------|-----------------|---------|
| 1 | `stratix_world_snapshot` | 过滤器词表校验（词表单一来源） | 无 | 无（读工具不核对） | P1：词表与 spec 同源 |
| 2 | `stratix_task_assign` | 形状 + 上限 + `origin` 值域 + **origin 落库位** + 角色守门 + 队列容量 + **`mission_id` 存在性** | `task.assign` | 落地判据（P2：变更计数 / 命令回执，抗同 prompt 并发） | P1 + P2 |
| 3 | `stratix_task_status` | 形状 | 无 | 无（**加** `output_source` 字段标来源，见 §6.3） | P0（文档）+ 后续加字段（§5.1 允许加参数/加字段） |
| 4 | `stratix_task_cancel` | 形状 + 存在性 | `task.cancel` | 相位比对不变（已是状态事实判据） | P0（标注段位） |
| 5 | `stratix_mission_create` | 形状 + 上限 + 容量 + **`brief` / `depends_on` 归一仍交 core** | 三步串起（每步独立裁决） | 一次核对最终落点 | P0（口径写死） |
| 6 | `stratix_mission_status` | 形状 + `limit` | 无 | 无 | P0 |
| 7 | `stratix_mission_checkpoint` | 形状 + 上限 + 存在性 + 终态 | `mission.checkpoint` | 核对最后一条（不变） | P0 |
| 8 | `stratix_chat_send` | 形状 + 上限 + 角色守门 + **端口能力声明**（§6.2） | `sendChatRound` 一轮 | 无（结果即执行结果） | P1（端口能力化） |
| 9 | `stratix_registry` | 无 | 无 | 无 | P0（明确"无管线"是合法形态） |

**何时用 / 何时不用这张表**：新增工具时**必须**在表 6.1-2 里加一行（P0 步骤：规范与实现同一个 PR，§4.3 Step 6）；修改既有工具的段位时**必须**走 §5.3 的变更流程。**不要**把表当实现细节 —— 它是契约的一部分：模型侧不读它，但它约束"工具作者往哪段放代码"，而这正是本模式要解决的问题。

### 6.2 capability seam 三件套

#### 6.2.1 现状对照

**现状：三件套其实已经在了，只是没被这样命名，也没被完整地守。**

| 件 | 我们的对应物 | 事实位置 | 守住了什么 | 没守住什么 |
|----|-------------|---------|-----------|-----------|
| **Definition**（定义） | `ToolSpec`（`src/stratix-gateway/mcp/types.ts`）+ 注册表（`registry.ts`） | `name` / `description` / `inputSchema` / `handler` / `errors` / `readOnly` / `order` | 工具**是什么**：名字、契约、排序位；重名当场抛错；返回顺序确定（`(order, name)`，码位序兜底） | `ToolSpec` 里 **定义与实现混在一处** —— `handler` 是实现，却是 Definition 的字段；Definition **不声明"我需要什么能力"** |
| **Provider**（提供） | `createCoreMcpHost`（`src/stratix-gateway/mcp/context.ts`）→ 产出 `McpHost` | 四个注入端口：`store`（→`getWorldState`）、`dispatch`（→`dispatchCommand`）、`readTaskOutput`（→`readTaskOutput`）、`sendChatRound`（→`sendChatRound`） | 工具**不直接 import** core / SQLite：工具语义与"状态从哪来、命令往哪投"解耦，单测可注入隔离实现 | Provider **不自陈能力**：能力集是"这次装配传了什么"，靠**逐个端口是否在场**隐式表达；**可选端口未接这件事，消费者只能在运行期发现** |
| **Consumer**（消费） | 九个 handler（`src/stratix-gateway/mcp/tools/*.ts`） | 只经 `host` 端口消费 | 工具**只依赖端口**，不认具体实现、不认进程拓扑 | Consumer **不声明"我消费什么"**：需求是**运行期**才暴露的（见下） |

**最典型的一处代价 —— 可选端口的"运行期才发现"**：`McpHost.sendChatRound` 是**可选**端口（`types.ts` 的 `readonly sendChatRound?:`）。生产装配处（`src/stratix-gateway/index.ts` 的 `createCoreMcpHost({ store: service.store })`）**没有接它** —— 于是 `stratix_chat_send` 在真实环境里跑，会在 pre 段命中"端口没接"并回 `internal_error`「本进程没有可用的角色对话通路」。

- ✅ **对的一面**：工具**没有编造回复**（§3.3 的诚实性），也没有在 gateway 里另造一套对话实现（那会造出第二份会话真相、破掉"同一角色同时只允许一轮在跑"）。这是 seam 存在的价值 —— 缺能力时**如实降级**。
- ❌ **欠的一面**：`tools/list` 仍然把 `stratix_chat_send` 报给客户端（它确实注册了），客户端**看不出**"这台机器上这个工具不可用"。工具的**能力需求**（Definition）与宿主的**能力供给**（Provider）之间**没有可对照的清单** —— 唯一能对齐的地方是代码里的"可选端口 + 缺省不接"这条约定，而它没有出现在任何规范文本里。

**另两处未守住的边界**：

- **Definition 与实现混住**：`ToolSpec.handler` 让"这份工具的契约"和"这份工具的代码"住在同一个对象里，于是"description 写了四要素"与"handler 真按四要素做了"没有结构性关联 —— 只能靠评审盯（§4.3 Step 4 与 §4.3 Step 6 是人工关口）。
- **Provider 的实现是单例化的默认值**：`createCoreMcpHost()` 缺省取 `worldStore` 单例与 `emitCommand`（`context.ts`）—— 单测靠显式传参隔离。**默认值即耦合**：不传参就默认连上真战场。

#### 6.2.2 目标语义

**三件套的职责边界**（写死，改动需走 §5.3）：

| 件 | 定义 | **允许** | **禁止** |
|----|------|---------|---------|
| **Definition** | 工具**是什么**：名字、描述、schema、错误码集、只读标记、排序位，以及**它消费哪些能力** | 描述能力**需求**（如 `requires: ['readWorldState', 'dispatchCommand']`） | 夹带实现细节（不得 import core / 不得读文件 / 不得持有可变状态） |
| **Provider** | 能力**从哪来**：把宿主能力适配成端口形状，并**自陈能力集** | 实现端口；声明"我这条链路提供哪些能力" | 替 Consumer 做业务判定（不在 Provider 里判相位、不在 Provider 里判容量） |
| **Consumer** | 能力**怎么用**：把一次调用翻译成既有命令 / 既有服务调用 | 只经端口消费；按 Definition 声明的 `requires` 断言可用性 | 越过端口直连 core / SQLite / DOM；自己造一份真相 |

**三条不变式**：

- **S1（需求可见）**：每件工具的 Definition 声明它**需要**哪些能力端口；Provider 声明它**提供**哪些能力端口。两者可对照 —— 缺的那个在装配时就该被看见，而不是在调用时才炸。
- **S2（能力缺失即降级，不即幻觉）**：端口缺失时，工具**如实报错**（现有行为正确，保留），且**报错口径要能说清是"这台机器没有这个能力"而不是"你这个参数不对"**。目标态：`internal_error` 的 message 里点出缺哪个端口（现状已点出"未接 sendChatRound 端口"，口径正确，保留）。
- **S3（Definition 不夹带实现）**：Definition 是**数据**，实现是**行为**。目标态：`ToolSpec` 保留 `handler` 字段（第一期形态，§5.1「只加不删」），但**契约面**（name / description / schema / errors / readOnly / order / requires）与**实现面**（handler）在评审与文档上分开看待：契约面进 §2 与附录，handler 进 `tools/<域>.ts`。

**何时用 / 何时不用**：**何时用** —— 任何"工具需要宿主提供某种能力"的地方（读状态、投命令、读全文、跑对话，以及将来的写库、发通知、访问网络）。**何时不用** —— 不要把 seam 做成"万能能力接口"（一个 `invoke(capability, payload)` 把四种能力糊成一个字符串路由，那等于没有类型，也没有 seam）。也不要为了"看起来分层"把 Provider 拆成多个工厂函数 —— 三件套的价值在**职责边界**，不在文件数量。

**正例**（目标形态 · 伪代码）：

```ts
// Definition：说清"我要什么"（新增字段，不改既有字段）
const chatSendTool: ToolSpec = {
  name: 'stratix_chat_send',
  requires: ['readWorldState', 'sendChatRound'],   // 声明需求
  handler: async (args, host) => { /* 只经 host 消费 */ },
};

// Provider：说清"我给什么"
const capabilities = { readWorldState: true, dispatchCommand: true, readTaskOutput: true, sendChatRound: false };
// 装配期就能算出"哪些工具这次不可用"，不必等调用
```

**反例**：

```ts
// ❌ 反例一：Definition 里夹实现 —— 契约与行为混住，无法"只审契约"
const chatSendTool: ToolSpec = { name: '…', handler: async (args) => { /* 直接 import 了 chat-service */ } };

// ❌ 反例二：Provider 替 Consumer 做判定 —— 裁决权从状态机挪到了装配层
const dispatch = (cmd) => { if (!allowed(cmd)) throw new Error('not allowed'); emitCommand(cmd); };
```

#### 6.2.3 迁移草案

| 步 | 内容 | 动运行时？ | 说明 |
|----|------|-----------|------|
| **P0** | 把三件套的职责边界与不变式写进本章（纯文档）；在 §4.1 的 `ToolSpec` 字段表里补一行 `requires`（**声明位**，尚未实现） | ❌ 否 | 零风险 |
| **P1** | 在 `ToolSpec` 上**加** `requires`（可选字段，缺省 = 不声明）；在 `createCoreMcpHost` 上**加** `capabilities()`（自陈能力集） | ✅ 是（纯增量，缺省行为不变） | 满足 §5.1「加参数优于改语义」 |
| **P2** | 装配期用 `requires` × `capabilities()` 算出一份"本机可用工具集"，供 `tools/list` 之外的诊断面使用（**不改 `tools/list` 的返回** —— 工具清单是客户端契约，删工具会破 §5.1） | ✅ 是 | 诊断面新增，不动既有契约 |

**端口 ↔ 三件套对照表**（现状 → 目标）：

| 端口（`McpHost`） | 提供方（Provider） | 消费者（Consumer） | 目标态能力名 | 现状缺口 |
|------------------|-------------------|-------------------|------------|---------|
| `getWorldState()` | `store`（缺省 `worldStore` 单例） | 四件只读工具 + 五件写工具（守门 / 存在性 / 容量判定） | `readWorldState` | 缺省值即耦合（不传参连真战场） |
| `dispatchCommand(cmd)` | `dispatch`（缺省 `emitCommand`） | 四件写工具 | `dispatchCommand` | 无回执（§6.1 的 post 段靠差分） |
| `readTaskOutput(taskId)` | `readTaskOutput`（缺省 SQLite 直读） | `task_status`（`include_output=true`） | `readTaskOutput` | 跨投影面（§6.3） |
| `sendChatRound(cid, text)` | `sendChatRound`（**可选**，生产未接） | `chat_send` | `sendChatRound` | **运行期才发现缺失**（S1 待落地） |

> **命名规范（本节定死）**：`Definition` = `ToolSpec`；`Provider` = 实现 `McpHost` 的那侧（生产 = `createCoreMcpHost`）；`Consumer` = `tools/*.ts` 里的 handler。端口方法名保持现状（`getWorldState` / `dispatchCommand` / `readTaskOutput` / `sendChatRound`）—— **不为了对齐 dsh 而改名**（改名会波及全部 handler，属 §5.3 的 ⚠️ 类变更，且收益为零）。

### 6.3 事件日志 + 投影

#### 6.3.1 现状对照

**现状：Stratix 是"纯投影"架构 —— 真相在别处，WorldState 是投影；但我们没有事件流。**

| 事实 | 位置 | 说明 |
|------|------|------|
| WorldState 是**物化状态**，不是事件流 | `src/core/store.ts` | store 持一份当前态，`setState` 覆盖；**没有**变更历史、**没有**事件追加 |
| WorldEvent 是**瞬态**的 | `src/core/bus.ts` 的 `onWorldEvent` | `unit.position` / `unit.speaking` / `exp.gained` / `level.up` 等事件**不进** WorldState（runtime 显式接地、不写状态），只做通知 |
| 唯一的 append-only 记账行 | `mission.checkpoint` → `MissionView.checkpoints` | domain 里**唯一**的事件式记录：只追加、不改写、终态拒记、上限 64 条**丢最旧**（`MAX_MISSION_CHECKPOINTS`） |
| 任务派发 / 取消**不留事件行** | `HudCommand.task.assign` / `.cancel` | 状态机落状态即完事；**没有**"谁在什么时候派了这条单"的行 |
| `origin` 不落库 | 全库检索 `src/app` / `src/core` 零命中 | §2.0 描述的审计来源目前只是回执里的一个字段 |
| `seq` 是**状态版本号** | `docs/WORLD-SYNC.md` §3 | service 侧统一发号、全 service 单调递增、不按连接计数；首个 snapshot 的 seq = 1；**快照即版本**（seq 代表"这份快照 = 版本 N 的完整状态"，快照永远是完整的）；ack 的 seq 是"核对后的状态版本"（可能小于或大于客户端最近收到的 snapshot 的 seq）；**seq 只用于诊断与对账，不用于增量合并**；跨连接不可比（service 重启从 1 重新计数，客户端不得跨连接比较 seq，也不得据此决定要不要更新）；**seq ≠ 业务时间**（两个 snapshot 的 seq 差值不代表中间发生了多少次变更 —— 状态变更可能被合并广播） |

**"seq = 事件序"这个说法今天是不成立的** —— 我们没有事件流，只有**合并广播后的投影版本号**。一次用户操作可能只产生一次 `setState`（runtime 的"一次用户操作一次广播"铁律），所以"投影版本数"与"业务事件数"**不是一回事**。把它叫"事件序"会造出一个我们并不具备的能力承诺。

**"重放 = 重投影"今天也不成立** —— 没有事件流，就没有"重放"；我们能做的只有"重新读一遍真相源、重算一遍投影"（即再读一次 WorldState / SQLite），这**不是**重放，而是**重投影**。

**"model-visible means logged"（凡是模型看得见的，都必须被记下来）对我们意味着什么** —— 逐条推论（这是本节的核心）：

- **推论 A · 每个返回字段都要能指到投影来源**。今天九件工具的返回字段来源**没有一处写在规范里** —— 规范只写了"返回什么"，没写"这个值从哪来"。模型拿到 `stratix_task_status` 的 `output`，分不清它是状态里的摘要（≤2000 码点）还是 SQLite 里的全文（可能很长）—— 只靠 `output_truncated` 这个布尔量去猜。
- **推论 B · 跨投影面是常态，必须显式标注**。至少三个来源面：**① WorldState**（战场投影）、**② SQLite**（`tasks` 表的输出全文、对话落库表）、**③ app 服务返回值**（`chat_send` 的一轮回复 —— 它**不进 WorldState**，只能靠落库表对账）。今天这三面在返回里**混在一起**，没有字段级的来源标注。
- **推论 C · "看得见的动作"必须留痕**。模型能让世界发生的事：派单、取消、建编组、记账、发对话。今天只有**记账**（mission checkpoints）留痕，**派单 / 取消 / 建编组都不留事件行**，`origin` 也不落库 —— 也就是说 §2.0 承诺的"审计来源"在事实上是空的：**模型看得见自己做了什么，但那件事没有一行记录**。这是"model-visible means logged"在我们这里最尖锐的一处欠账。
- **推论 D · 留痕 ≠ 事件日志**。我们要的是**审计行**（谁、何时、做了什么、结果如何），不是**可重放的事件流**。前者是 append-only 的**事实行**，后者要能重建状态 —— 后者的成本（core 零 IO 铁律、全量广播体积、合并广播语义）与收益不成比例，**不做**。

#### 6.3.2 目标语义

**四条**（T1–T4）：

- **T1 · state 是投影，投影必须可溯源**：工具返回的**每个字段**都要能指到来源面（state / sqlite / service）。指不到 = 违规。落地形态：规范里为每件工具写一张**字段来源表**（本章 6.3.4），以及返回里给跨面字段加**来源标注**（加字段，不改语义 —— §5.1 允许）。
- **T2 · seq 是投影版本序，不是事件序**：`seq` 标识"这份投影是第几版"，**不是**事件条数、**不是**时间戳、**不是**增量游标。这条与 [WORLD-SYNC.md §3](WORLD-SYNC.md#3-状态版本-seq-规则) 现有口径**完全一致**，本章只是把它明确写成"版本序"并明确**否定**"事件序"这一读法 —— 因为我们没有事件流，承诺事件序就是承诺一个不存在的能力。
- **T3 · 重放 = 重投影**：要重建一份状态，走"重读真相源 + 重算投影"，**不是**"重放副作用"。我们**不提供**"重放某条命令"的能力，也不提供"重放到某个版本"的能力（没有事件流就做不到）。要撤销，走状态机提供的显式迁移（取消、终态拒改写）。
- **T4 · model-visible means logged**：凡是**模型看得见的动作**，都要留一条**审计行**；凡是**模型看得见的字段**，都要能指到投影来源。审计行是 append-only 的事实行（不是事件流），且**它本身不构成第二份真相** —— 它记的是"发生过什么"，真相仍在状态机。

**何时用 / 何时不用**：**何时用** —— 新增工具时同步补字段来源表与审计口径；给工具加跨面字段时同步加来源标注。**何时不用** —— 不要把审计行做成**第二份状态**（审计行不可被查询成"当前状态"，那是状态机与 WorldState 的活）；不要为了"可重放"去造事件流（成本与收益不成比例，且会破 core 零 IO 铁律）。

**正例**（目标形态 · 伪代码）：

```ts
// ✅ 字段级来源标注：模型知道这个值从哪来，也知道截断意味着什么
return toToolResult({ ok: true, data: {
  task_id: task.id,
  output,                       // 来自 state（摘要）或 sqlite（全文）
  output_source: includeOutput && full !== null ? 'sqlite' : 'state',  // ← v2 新增字段
  output_truncated: outputTruncated,
}});
```

**反例**：

```ts
// ❌ 反例一：模型看得见的动作不留痕 —— 事后无法回答"这条单是谁派的"
host.dispatchCommand({ type: 'task.assign', characterId, prompt });  // 没有任何一行记录

// ❌ 反例二：把 seq 当事件序用 —— 我们没有事件流
if (snapshot.seq > lastSeq) { /* 以为漏了中间的事件，重放或补拉 —— 做不到 */ }

// ❌ 反例三：审计行变成第二份状态
auditRows[cmdId] = { status: 'running' };  // ← 这是在自造状态机
```

#### 6.3.3 迁移草案

| 步 | 内容 | 动运行时？ | 备注 |
|----|------|-----------|------|
| **P0** | 在本章写出**九件工具的字段来源表**（纯文档）；规范 §2 各工具补一句"返回字段来源" | ❌ 否 | 零风险，也是后面两步的对照底本 |
| **P1** | 落一张 **MCP 工具调用审计表**（SQLite，append-only）：`tool_name` / `参数摘要` / `origin` / `通道` / `时间戳` / `结果码` / `落地与否`。**只记不读** —— 先把事实行攒起来，读面另议 | ✅ 是（新增一张表 + 一处写入） | 写面在 gateway（唯一 MCP 装配点）；**不新增状态字段、不改 core 契约**（§3.1 不破） |
| **P2** | 给跨面字段加**来源标注**（`output_source` 等）：**加字段、不改语义**，缺省行为不变（§5.1 / §5.3「新增可选字段 ✅」） | ✅ 是（纯增量） | 与 §6.1 的 post 段配套：post 段核对时也知道自己核对的是哪一面 |
| **P3（可选，评审后定）** | 引入**单调变更计数**（core 侧），供 §6.1 的 post 段做"确实变过"的判据 | ✅ 是（**core 契约变更**） | 须走 §5.3 的 ⚠️ 流程；与 §6.1 P2 的路 A 是同一件事，**做一次不做两次** |

**明确不做（本节）**：

- ❌ **不做全量事件日志** —— core 零 IO 铁律、全量广播体积、既有"一次用户操作一次广播"的合并语义，三者都与它相悖；且 §3.1 规定 MCP 不新增持久化表以外的状态源。
- ❌ **不做增量合并** —— world-sync §7.2 已把增量列为"预留、本期不实现"，本章不改这一条。
- ❌ **不做"重放命令"能力** —— 没有事件流就做不到；撤销走状态机的显式迁移（§3.2）。
- ❌ **不用审计行重建状态** —— 审计行是"发生过什么"，不是"现在是什么"。

#### 6.3.4 字段来源表（九件工具 · P0 产出）

| 工具 | 返回字段的来源面 | 跨面？ | 说明 |
|------|----------------|--------|------|
| `stratix_world_snapshot` | **state**（units / missions / tasks / characters 四段） | 否 | 全部来自一次 `getWorldState()`；`taken_at` 是工具自取的墙钟（不是状态字段） |
| `stratix_task_assign` | **state**（新任务的 id / status / mission_id / created_at） | 否 | 回执里的 `character` 来自 state 的角色投影；`origin` 是**请求侧标注**（无落库位，见 §6.3.1 推论 C）；`timeout_ms` 是**生效常量**（不是状态字段） |
| `stratix_task_status` | **state**（状态与摘要）+ **sqlite**（`include_output=true` 时的输出全文） | ✅ | 全文不可得时回落摘要并标 `output_truncated=true`；v2 加 `output_source` |
| `stratix_task_cancel` | **state**（取消后的相位、占位 output） | 否 | `previous_status` 是**回读前**的观察值 |
| `stratix_mission_create` | **state**（新编组的 id / phase / unitIds / brief / dependsOn / checkpoints） | 否 | `dropped_units` 是**差分算出的**（请求去重名单 − core 采纳名单）；`auto_confirm_applied` 由相位推得；`blocked_by_dependencies` 用 core 的 `findMissingDependencies` 现算 |
| `stratix_mission_status` | **state**（编组投影 + 名下任务摘要） | 否 | 列表按创建时间倒序，排序在工具侧现算 |
| `stratix_mission_checkpoint` | **state**（最后一条 checkpoint 的 note / at + 计数） | 否 | core 的记账是**静默**的，故回执靠 post 段回读核对 |
| `stratix_chat_send` | **service**（app 层 chat-service 的一轮结果）+ **sqlite**（对话落库表，历史不在返回里） | ✅ | `reply` **不进 WorldState** —— 只靠落库表对账；`session_id` / `message_id` 由宿主给（拿不到为 null，不编造） |
| `stratix_registry` | **state**（detectedAgents / characters / units） | 否 | 探测结果由 app 层写进 state，本工具**不重跑探测** |

### 6.4 可逆注册

#### 6.4.1 现状对照

**现状：可逆注册在"进程级"已经做到了，在"能力级"没有做到。**

**已经做到的（进程与子系统级）**：

| 事实 | 位置 | 口径 |
|------|------|------|
| core runtime 的 `start()` 返回 **stop 闭包** | `src/core/runtime.ts` | 重复 start 是 **no-op**（返回同一个 stop，不叠加订阅）；stop 撤销三处订阅（`store.subscribe` / `onCommand` / `onWorldEvent`）**并停掉 agentLink**（"连接是外部资源，运行时停了就必须关"） |
| core bus 的订阅返回 `Unsubscribe` | `src/core/bus.ts` | 退订是订阅的对偶动作 |
| app 层服务各有 stop | `task-service` / `progression-service` / `pipeline-service` / `health-monitor` | 口径一致（都返回 stop 闭包）；`progression-service` 的注释把这层要求写成了明文：「返回 stop 闭包（**资源必须可清理**，页面卸载时调用）」 |
| 组合根有**顺序化的关闭链** | `src/stratix-gateway/index.ts` 的 `shutdown()` | `runStep(name, fn)` 逐步执行、**收集错误而不中断**、最后按错误数给退出码；顺序是"先停大脑（`booted.stop()`），再停周边子系统"，`worldSyncEndpoint.close()` 在 HTTP server 关闭之前 |

**没有做到的（能力与注册级）**：

| 缺口 | 事实位置 | 后果 |
|------|---------|------|
| **MCP 工具注册表没有卸载** | `src/stratix-gateway/mcp/registry.ts` | `registerTool` 重名抛错，但**没有 `unregisterTool`**；工具集是静态数组 `DEFAULT_MCP_TOOLS`（`server.ts`），装配即生效，**没有任何卸载路径** |
| **`/mcp` 路由挂上后没有 unmount** | `src/stratix-gateway/index.ts` 的 `app.use('/mcp', ...)` | 目前靠 HTTP server 整体关闭兜住（进程退出场景没问题），但**热重载 / 换装配 / 多实例**场景没有干净的拆法 |
| **MCP server 没有 dispose** | `createMcpServer` / `createDefaultMcpServer` | server 实例不持有需要释放的资源（stdio / HTTP 的连接由传输层管），但**接口上没有"这件事结束了"的表达** |
| **runtime 的 stop 闭包有一处重放风险** | `src/core/runtime.ts` 的 `start()` | stop 闭包把 `stop` 变量置空后，**再次 start 会新建订阅**；此时**重放旧的 stop 闭包**不会误退新订阅（mitt 的 `off` 本身幂等），但会把 `stop` 句柄一并置空 —— 于是 `runtime.running` 报 false，而新那次的订阅**再也拆不掉**（句柄已丢）。典型的"卸载不干净"形态 |

**当前的实际影响有限**（诚实说明）：Stratix 是**单进程常驻**应用，进程退出即一切结束，MCP 工具集是静态的 —— 所以上面几处缺口今天**没有变成线上故障**。它们会在**桥 B（Stratix-as-dsh-plugin，`DSH-INTEGRATION-PLAN.md` §2）**这类"在同一进程里挂载 / 卸载一块能力"的场景里变成真问题 —— 那正是可逆注册模式要解决的场景。

#### 6.4.2 目标语义

**可逆注册（reversible registration）**：**每一次注册都必须配一个 disposer；调用 disposer 之后，系统必须回到注册之前的状态。**

**四条不变式**：

- **R1（注册必带 disposer）**：注册一个东西（工具、订阅、定时器、路由、连接）**必须**同时产出一个 `() => void`。没有 disposer 的注册**不允许**存在 —— "注册了但拆不掉"的东西会随时间累积，且累积在**没人看的那一侧**（MCP 侧正是如此，§3.1）。
- **R2（disposer 幂等）**：同一个 disposer **重复调用**必须安全：第二次是 no-op，不报错、不二次释放、不影响**注册之后**建立的新资源。
- **R3（卸载恢复原状）**：disposer 执行后，被注册对象**从可见面上消失**（`tools/list` 里没有它、路由不再命中、订阅不再回调），且**不留下**它的任何残留（未清的定时器、未关的连接、未退的订阅）。
- **R4（顺序 = 依赖倒序）**：多个 disposer 按**注册的逆序**执行（后注册先拆），且**单个 disposer 抛错不阻断其余 disposer** —— 拆卸失败要**记账并继续**，不能因为一个挂了就让其余全留着。

**何时用 / 何时不用**：**何时用** —— 任何"挂上去的东西将来要摘下来"的场景：MCP 工具注册、传输层路由、总线订阅、定时器、子进程连接、插件装配。**何时不用** —— 进程级常量（`worldStore` 单例、`emitCommand`）**不登记 disposer**：它们与进程同生共死，给它们造 disposer 是虚假的安全感。

**正例**（目标形态 · 伪代码）：

```ts
// ✅ 注册即带 disposer，且 disposer 幂等 + 不误伤后来的注册
const registry = createToolRegistry();
const off = registry.registerTool(myTool);       // ← registerTool 返回 disposer（现状：返回 spec，要改）
off();                                            // 幂等：再调一次是 no-op
```

**反例**：

```ts
// ❌ 反例一：注册了但没有拆法 —— 卸载后工具还在清单里
registry.registerTool(myTool);          // 返回 spec，不是 disposer；没人能把它摘掉

// ❌ 反例二：disposer 不幂等 —— 拆两次就崩
const off = () => { subscription.off(); subscription.off(); };  // 第二次抛错或误伤

// ❌ 反例三：拆卸顺序错了 —— 先拆了提供者，后拆消费者，消费者还在回调
offProvider();   // 先
offConsumer();   // 后  ❌ 应当逆序：offConsumer(); offProvider();
```

#### 6.4.3 迁移草案

**统一 disposer 契约**（本节定死）：

| 项 | 约定 |
|----|------|
| 形状 | `() => void`（同步）；需要异步清理的包一层并由调用方 await |
| 幂等 | 重复调用安全；内部用"已拆卸"标志位保证只拆一次 |
| 错误 | 抛错由**调用方**处理（拆卸链收集错误并继续，R4）；disposer 本身**不吞**错误 |
| 作用域 | 只拆**自己注册的那一份** —— 绝不影响注册之后建立的新资源（R2 的关键） |

**分层落地**（每层的现状 → 目标）：

| 层 | 现状 | 目标 | 动运行时？ |
|----|------|------|-----------|
| **core runtime** | `start()` 返回 stop 闭包（重复 start 是 no-op）；**旧闭包重放会误清新句柄** | stop 闭包改为"**每次 start 一个独立句柄**，各自幂等"；旧句柄重放只拆自己那一次 | ✅ 是（小改，纯 runtime 内部） |
| **core bus** | `subscribe` 返回 `Unsubscribe` | 已符合契约，不动 | ❌ |
| **app 层服务** | 各有 stop 闭包，口径一致 | 统一到 disposer 契约（幂等 + 逆序）；由组合根的关闭链统一驱动 | ✅ 是（小改） |
| **MCP 工具注册表** | `registerTool` 返回 spec；**无 unregister** | `registerTool` 返回 **disposer**（同时仍可拿到 spec —— 兼容现有调用）；新增 `unregisterTool(name)`；注册表支持"一次装配一批 → 一个 disposer 全撤" | ✅ 是（**加不改**：现有 `buildToolRegistry` 的调用方零改动） |
| **MCP 路由 / server** | `app.use('/mcp', ...)` 无 unmount；server 无 dispose | server 暴露 `dispose()`（释放传输层资源）；路由 unmount 与 server dispose 合成一个 disposer，挂进组合根关闭链 | ✅ 是 |
| **组合根关闭链** | 已有 `runStep` 顺序化关闭 + 收集错误 | **保持不变**，只把新 disposer 接进去（先拆消费者、后拆提供者） | ✅ 是（接线） |

**关闭链的目标顺序（依赖倒序）**：

```
① 停止"产生新工作"的源头      （abandoned task requeuer 的定时器）
② 停"消费工作"的子系统        （service runtime / agent runtimes / 编排同步）
③ 拆"对外暴露的能力"          （MCP server dispose → /mcp 路由 unmount → world-sync endpoint close）
④ 关"承载能力的通道"          （HTTP server close）
```

> 现状的关闭链已经是这个顺序（`booted.stop()` → `AgentRuntimeService.stopAll()` → `worldSyncEndpoint.close()` → HTTP server close），目标只是**把 MCP 那两件（server dispose / 路由 unmount）插进第 ③ 步**，其余不动。

**本节不做的事**：不引入 Cordis 或任何插件运行时进 gateway / core（`DSH-INTEGRATION-PLAN.md` §4 明确禁止）—— 借的是"可逆注册"的**语义**，不是它的运行时。

### 6.5 四模式的交叉约束与落地顺序

**交叉约束**（四条模式之间的接口，改一条要看另外三条）：

| 约束 | 说明 |
|------|------|
| **X1 · waterfall 的 post 段依赖 §6.3 的溯源** | post 段要判"落地了没有"，判据必须是**状态事实**（T1）。今天有两处让这条判据打折：① `task_assign` 的落地判据是"同角色 + 同 prompt 差分"，本质是**猜**而不是**对账**（§6.1 缺口 2）；② `origin` 这类审计标注根本不在任何投影面上，post 段无从核对（§6.3 推论 C）。**这两处是同一条链上的** —— post 段想变可靠，得先有 §6.3 的溯源与审计行。 |
| **X2 · seam 的 Provider 能力集依赖 §6.1 的段位** | 端口缺失要在**装配期**可见（S1），前提是"哪些工具需要哪些端口"已经被声明 —— 也就是 §6.1 的 pre 段已经统一（否则"需要的端口"本身就散在各处说不清）。 |
| **X3 · 可逆注册依赖 seam 的 Provider 可替换** | Provider 若写死单例（`worldStore` / `emitCommand` 缺省值），卸载就无从谈起 —— 换一套 Provider 再拆旧的那套，才是"可逆"的完整形态。故 §6.4 的目标形态是"**Provider 可替换 + 注册可拆**"的组合。 |
| **X4 · §6.3 的审计行不得成为第二份真相** | 审计行记"发生过什么"，状态机记"现在是什么"；两者混在一起就是 §3.1 破规（§3.1 原文：MCP 侧自己记一张表，视图就会和战场漂移，而 MCP 是没有人看的那一侧）。审计行**只追加、不查询成状态**。 |

**落地顺序（建议）**：**§6.2 P0/P1（seam 声明位）→ §6.3 P0（字段来源表）→ §6.3 P1（审计行）→ §6.1 P1（pre 段提取）→ §6.1 P2 + §6.3 P3（落地判据 / 变更计数，一起做）→ §6.4（可逆注册）**。

理由：前两步是纯增量与纯文档，把"能力需求"与"字段来源"这两张底表立起来；审计行（P1）是 X1 的上游（没有溯源就没有可靠的 post 段）；pre 段提取（P1）是纯提取、风险最低；post 段改造与变更计数一起做，避免两次动 core；可逆注册放最后 —— 它在当前单进程常驻拓扑下没有真实压力，等桥 B 真的要热挂载时再做，且那时 §6.2 的 Provider 可替换已经就位（X3）。

**这一章的自我约束**：本章**不引入**任何依赖、**不改动**任何运行时代码、**不新增**工具或错误码。§1–§5 的第一期工具面**一字未动** —— 本章的所有内容在评审通过并逐项实施之前，一律视为**提案**。

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
| `mission_terminal` | 编组任务已收尾（done / cancelled），不再接受该操作 | ❌ | 终态拒绝（`appendMissionCheckpoint` 的终态分支；`stratix_mission_confirm` / `stratix_mission_cancel` 对终态任务同样拒绝，§2.14 / §2.15） |
| `illegal_transition` | 状态机拒绝该迁移 | ❌ | `MissionErrorCode.illegal-transition` / 编组任务相位不对（确认只认 `pending`、撤掉只认没开工，§2.14 / §2.15） |
| `session_not_found` | 会话 id 不存在 | ❌ | `SessionReadPort.readSession` 回 null（`src/app/services/persistence/session-reader.ts:44`）/ `SessionRejectionCode.not-found` |
| `unsupported_kind` | 该类会话不支持此操作 | ❌ | 会话 kind 不在工具面允许的集合内（`stratix_session_interrupt` / `stratix_session_resume` 只认 `peer_chat`，见 §2.12 / §2.13） |
| `internal_error` | 内部异常 | ✅ | 工具**主动判定**的内部失败：数据面端口未接（`sendChatRound` / `readSessions`）、命令没人接管、状态在操作中消失 |

**协议层错误（JSON-RPC error，不套失败信封）**：失败发生在"帧进不来 / 方法不在 / 崩了"这一层，不套上面的信封，直接回 JSON-RPC error 帧（错误码与触发点见 [§4.4 传输层错误信封](#44-mcp-server-的接入方式)）：

| JSON-RPC code | 含义 | 典型触发 |
|---------------|------|---------|
| `-32700` | Parse error | 请求体不是合法 JSON |
| `-32600` | Invalid Request | 帧不是合法 JSON-RPC 2.0 请求 / body 超限 / `GET /mcp` |
| `-32601` | Method not found | 未知方法 |
| `-32602` | Invalid params | `tools/call` 缺工具名 / 未知工具 |
| `-32603` | Internal error | 工具抛未捕获异常 / 传输层兜底 |

**边界**：`internal_error`（信封）与 `-32603`（JSON-RPC error）的分界是**谁判定的** —— 工具主动判定并给了下一步（"端口没接""命令没人接管"）→ 信封 + `internal_error`；没人判定、只是崩了 → `-32603`。把崩溃包成 `internal_error` 会让 agent 误以为是业务拒绝。

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
