# SESSION-PLAN — v3.2 会话域（把会话做清楚）

> 状态：**已冻结**（2026-11-02 09:50，用户拍板方向+LRA/Claude Code 开发）
> 借鉴来源（不从头做）：dsh 事件溯源/fork-resume/auto-title/session-reference；OpenClaw 会话种类学/父子交互/后台任务推送；Claude Code/Kimi `--continue` 恢复体验
> 铁律延续：docs/SERVICE-SPLIT-PLAN.md 七铁律全部生效（尤其：真相源在 core、service 独占写、渐进迁移不搬旧数据）

## 1. 问题

会话散装五处、无统一域对象：角色聊天（SQLite 有历史无会话实体）、互聊（内存态超时即丢）、task 执行（全文在库不关联会话）、agent-link 连接（WorldState 投影）、world-sync 客户端（只有连接数）。用户看不到、管不了、中断即丢失。

## 2. 域模型（core/session）

### SessionRecord（WorldState.sessions，摘要入态、事件不入态）

```ts
{
  id: string                    // session_<kind>_<ts>_<n>
  kind: 'character_chat' | 'peer_chat' | 'task_run' | 'mission_run' | 'shell_link'
  title: string                 // 自动起名（2a 规则截断；2b LLM）
  participants: string[]        // characterId / agentId / clientId 视 kind
  status: 'active' | 'idle' | 'interrupted' | 'closed'
  refId?: string                // 关联实体（task_run→taskId 等）
  createdAt / lastEventAt / closedAt: number
  eventCount: number            // 摘要计数（事件本体在 SQLite）
}
```
上限对齐 links/messages 惯例（MAX_SESSIONS=200，FIFO 淘汰 closed 最旧）。

### 状态机（machine.ts，对齐 mission/task 模式）

```
active → idle          （静默阈值或显式）
active → interrupted   （超时/取消/进程死——互聊超时不再静默丢）
interrupted → active   （恢复续聊，2b 实现上下文续接）
idle → active
* → closed             （终态；task_run/mission_run 随实体终态自动 closed）
```

### SessionManager（manager.ts，对齐 missionManager 模式）

create / append(event) / interrupt / close + WorldState 投影 + 持久化端口注入（模式同 exp_events persister）。事件信封：`{ sessionId, seq, type, payload, createdAt }`（seq 会话内单调）。

### 各 kind 的接线策略（渐进：新写走新模型，旧表不迁移）

| kind | 会话粒度 | 历史读取器 | 事件写入 |
|---|---|---|---|
| character_chat | 每角色一个长生命周期会话 | 现有 chat-history-dao（不搬） | 只更新 lastEventAt/counters，事件本体仍是 chat_messages 表 |
| peer_chat（互聊） | 每场互聊一个 | session_events 表 | **全量事件落库**（轮次/消息/中断标记）——修「超时即丢」 |
| task_run | 每 task 执行一个（LITE） | character_tasks 全文表（不搬） | 仅 create/close 两事件 |
| mission_run | 每 mission 一个（LITE） | mission 域自身（不搬） | 仅 create/close |
| shell_link | 每 agent-link 会话一个 | WorldState.messages 投影（不搬） | 仅 create/close |

### HudCommand 增补

`session.interrupt { sessionId }`（2a 唯一新命令）；`session.resume`（2b）。

## 3. 存储（service 独占写，铁律 6）

- 新表 `sessions`（record 快照）+ `session_events`（append-only，索引 session_id+seq）
- DAO 对齐现有 persistence 模式；persister 注入 SessionManager
- REST：`GET /api/storage/sessions?kind=&status=`、`GET /api/storage/sessions/:id/events?beforeSeq=&limit=`（分页，只读）

## 4. 对外面

- **world-sync**：sessions 在 WorldState 里 → 快照自动带上，**零额外工作**（service-split 的红利）
- **MCP（2a 两个只读工具）**：`session_list`（kind/status 过滤+分页）、`session_get`（record+事件分页）；MCP-SPEC 增补工具章（description 四要素+错误码）。`session_interrupt` 写面工具放 2b
- **HUD 会话面板**（hud/panels/session-panel.ts，遵循现有 panel 惯例）：kind 筛选 chips / 状态徽标 / 进行中会话中断按钮（发 session.interrupt）/ 点击展开历史抽屉（kind 读取器路由）/ WorldState 订阅实时刷新 / 自动 title 展示

## 5. 互聊改造（S4，本批最直接的用户价值）

agent-chat-service 每轮/每消息/中断标记 → SessionManager.append；超时 → status=interrupted + 事件落「（互聊中断：原因）」；面板可见、历史可查。恢复续聊（interrupted→active 上下文回灌）明确放 2b。

## 6. 任务拆分（v3.2a，7 单）

| ID | 任务 | 依赖 |
|---|---|---|
| S1 task_091 | core/session 域模型——types+machine+manager+单测 | — |
| S2 task_092 | 存储——sessions/session_events 表+DAO+REST 读 API | S1 |
| S3 task_093 | service 接线——组合根挂 SessionManager+persister | S2 |
| S4 task_094 | 互聊接入会话域（修超时即丢） | S3 |
| S5 task_095 | HUD 会话面板 | S3 |
| S6 task_096 | MCP session_list/session_get+SPEC 增补 | S3 |
| S7 task_097 | 回归+验收剧本（互聊超时→面板可见→历史可查） | S4,S5,S6 |

链：S1→S2→S3→{S4,S5,S6 并行}→S7。

## 7. 明确不做（2b 及以后，触发时另立项）

resume/fork 上下文续接（dsh 深水区）、长会话压缩、MCP session_interrupt、LLM auto-title、session-reference 跨会话引用、task_run 全量事件化
