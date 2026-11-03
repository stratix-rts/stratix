# agent_task_119 —— v3.6 MCP mission_status 读回 checkpoints/brief + 悬空引用与 enum 修正（P2）工作文档

> 任务：task_119 —— MCP 评估报告 §3-P2/P3/P4 三条缺口的修正。
> 评估证据：`/Users/kingj/.openclaw/workspace/reports/2026-11-03-stratix-mcp-review.md`（§3-P2 读不回 / §3-P3 悬空引用 / §3-P4 enum 与 default 矛盾）。
> 依据：docs/MCP-SPEC.md §2.0（origin 口径）/ §2.2 / §2.6 / §2.7 / §2.9（读侧缺口）/ §4.2（预留命名位）/ §5.5（演进行）。
> 分支：demo/v3.3（commit 前缀 v3.6）。日期：2026-11-03。

## 1. 三条缺口与各自的修法

| 缺口 | 现象 | 修法 | 为什么这么修 |
|---|---|---|---|
| **§3-P2**（高） | `mission_create` 带 `brief`、`mission_checkpoint` 记账成功，但 `mission_status` 单条模式只回元数据 + tasks + task_totals —— **写进去的东西读不回来**（只写不读的审计流） | `mission_status` 单条模式的 `data.mission` 增加 `brief`（正文全文）/ `checkpoints`（记账行全量）/ `checkpoint_count` / `checkpoint_limit` 四个字段 | create 回执只报 `brief_fields`（段名）是**给刚发来的人**看的；status 是**读回面**，读者可能是另一个 agent，正文必须给全。加字段不改语义（既有字段逐字未动、列模式未动） |
| **§3-P3**（中） | `stratix_chat_send` 描述指向"扩展位 `stratix_chat_history`" —— 该工具只在 §4.2 的**预留命名位**表里登记，**尚未实现**，tools/list 里没有它（agent 按图索骥扑空） | 描述里去掉这个名字，改成"MCP 侧目前没有读对话历史的工具" | **不能改指 `stratix_session_get`**：角色对话的消息本体在 `chat_messages` 表里，不在会话事件流里（会话侧只有一条空的 `round` 记账事件），`session_get` 读不到对话正文 —— 指过去是换一个坑 |
| **§3-P4**（中） | `task_assign` 的 `origin` schema：`enum:["agent","script"]` 而 `default:"mcp"` —— default 不在自己的 enum 内，schema 自相矛盾（严格模式的校验器会拒收） | 取值集扩为 `{mcp, agent, script}`，显式传 `mcp` 与缺省同义（都记 mcp，不算撒谎）；`ui` 仍拒绝 | 审计语义没变（"经 MCP 派单且派单方是 agent 时必须显式传 agent"），变的只是 schema 自洽性 |

## 2. 交付物

| 文件 | 职责 |
|---|---|
| `src/stratix-gateway/mcp/tools/mission.ts` | `mission_status` 单条模式新增读回面（`brief` / `checkpoints` / `checkpoint_count` / `checkpoint_limit`）；描述同步说明读回面 |
| `src/stratix-gateway/mcp/tools/chat.ts` | 去掉 `stratix_chat_history` 悬空引用 |
| `src/stratix-gateway/mcp/tools/task.ts` | `origin` 取值集与 `default` 自洽（`ORIGIN_VALUES = ['mcp','agent','script']`） |
| `src/stratix-gateway/mcp/__tests__/mission.test.ts`（+4 例） | 读回路径断言：brief 正文读回 / checkpoints 全量读回 / 裸任务不出现 brief 且 checkpoints 为空 / 读回面与状态事实一致 |
| `src/stratix-gateway/mcp/__tests__/task.test.ts`（+1 例） | 显式传 `origin:'mcp'` 合法且记 mcp |
| `src/stratix-gateway/mcp/__tests__/tool-contract.test.ts`（新，4 例） | **契约自洽性**回归护栏：① 描述里提到的每个 `stratix_*` 工具名都必须真实存在（悬空引用以后不能再犯）；② 带 `default` 的枚举参数，default 必须在 enum 内；③ chat_send 描述不含 `stratix_chat_history`；④ task_assign 的 origin enum/default |
| `docs/MCP-SPEC.md` | §2.0 origin 口径、§2.2 schema、§2.6 读回面（描述 + 返回块 + 「读回面」小节）、§2.7 悬空引用修正注记、§2.9 读侧缺口结清、§5.5 追加 v1.8 行 |
| `.long-run-agent/tasks/task_119.md` | 任务书回填（交付物 / 验证证据） |

## 3. 设计要点

- **读回面的形状**：`brief` 缺省时**不出现**该字段（与 core 的 `MissionBrief?` 可选性一致）；`checkpoints` **恒为数组**（未记账 = 空数组），并附 `checkpoint_count` / `checkpoint_limit`（后者与 `mission_checkpoint` 回执同值 = core 的 `MAX_MISSION_CHECKPOINTS` = 64）。
- **顺序语义**：`checkpoints` 顺序即记账顺序（旧 → 新，append-only）；`at` 是记账时刻（epoch ms，由 core 给）。
- **体积纪律**：读面再兜一层 `slice(-64)`（只回最新 64 条）—— core 已限 64 条，但读面是"给人看的那一份"，不能让一份无界数组进模型上下文（docs/PERFORMANCE_GUIDELINES.md）。
- **不动的地方**：task_118 刚收敛的错误信封层（`envelope.ts` / `transport/http.ts`）零改动；14 件工具的名字、参数名、错误码、`tools/list` 顺序全部未动；`mission_status` 列模式未动。

## 4. 验证（实测）

- **探针任务**：报告里的 `mission_1793715466139_1` 已随 dev 网关重启消失（missions 是**纯内存**、不落库 —— 见 MEMORY「任务系统」条），故按同一形状重建一条 draft 相位探针（`units:[]` + `auto_confirm:false`），带 `brief` 四段中的两段、记两条 checkpoint。
- **读回**：`mission_status` 单条模式原文回 `brief`（两段正文）+ `checkpoints`（两条，`at` 与 `note` 齐全）+ `checkpoint_count:2` + `checkpoint_limit:64`。
- **tools/list**：`chat_send` 描述不再出现 `stratix_chat_history`；`task_assign.origin` = `{"enum":["mcp","agent","script"],"default":"mcp"}`。
- **回归**：`npx tsc --noEmit` 零输出；`npx jest src/stratix-gateway/mcp` → 13 suites / 131 tests 全绿。
