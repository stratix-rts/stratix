# agent_task_093 —— 会话域接线（S3）工作文档

> 任务：v3.2a S3（task_093）—— service 组合根挂 SessionManager + persister 注入 + 五 kind LITE 接线。
> 方案：docs/SESSION-PLAN.md §2（接线表）/ §3（存储）；域模型：S1（task_091，commit 9a750c4）；
> 存储：S2（task_092，commit 015f2d2）。
> 日期：2026-11-02。

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/core/session/types.ts` | 新增 `SessionPersistPort`（core 定义的回调契约：写什么由 core 定，往哪写由 app 定） |
| `src/core/session/manager.ts` | manager 选项增可选 `persist` 口；create / append / commit 三处随写随落（异常吞掉，不打断会话回路） |
| `src/core/runtime.ts` | 新增 `session.interrupt` 命令分发（与 mission / task 同一口径直调 manager） |
| `src/stratix-gateway/service/stratix-service.ts` | 组合根：SessionManager 实例 + persister 注入（缺省范式）+ 注入 runtime 与执行环 |
| `src/stratix-gateway/service/task-execution.ts` | 把 `sessions` 口透传给 task-service |
| `src/stratix-gateway/service/storage.ts` | 增两个会话写口（`persistSession` / `persistSessionEvent`） |
| `src/app/services/chat-service.ts` | character_chat LITE：首轮建会话、每轮末追加空 round 事件 |
| `src/app/services/task-service.ts` | task_run / mission_run LITE：任务终态时建会话并立刻收尾 |
| `src/core/agent-link/manager.ts` | shell_link LITE：建链成功建会话、断开 / dispose 收尾 |
| `src/app/main/main-entry.ts` | 渲染侧组合根：建一个 SessionManager 实例，注入 runtime / chat-service / task-service |
| `scripts/smoke-service.ts` | 会话段：create → append → **经总线 interrupt** → close；内存态 + SQLite 双侧可见 + 快照含 sessions |

单测：

- `src/core/__tests__/session-runtime.test.ts` —— session.interrupt 总线往返落点（打真总线 + 真 store）。
- `src/stratix-gateway/service/__tests__/session-wiring.test.ts` —— 持久化口缺省范式三态 + LITE 双侧可见 + 快照含 sessions（真 SQLite）。
- `src/core/agent-link/__tests__/session-link.test.ts` —— shell_link LITE（真协议对端 gateway-double）。
- `src/app/__tests__/chat-session.test.ts` —— character_chat LITE（首建 / 复用 / 空 round 不含正文 / 失败路径）。

## 2. 关键设计决策

1. **持久化口放在 core，但只放「回调契约」**：S2 的 persister 端口形状（`persistSession` / `persistEvent`）
   与 core 的信封**结构同形**，注入即可用、无需适配器；反过来若在组合根包一层 wrapper，
   事件信封（seq / payload / 时间戳）就要在组合根重建 —— 出现第二份真相源。故选 core 定义契约、
   app 实现落库：**core 从不 import DAO / SQLite（零 IO 铁律不破）**。
2. **缺省范式对齐 exp_events persister**：组合根的 `persistSession` 选项 ——
   **存储件在 → 自动接管**（会话摘要与事件随写随落两张表）；显式给了以显式为准；
   两者皆缺 = **不落库**（会话只活在 WorldState 里，不假装落库成功）。三种情形各有单测钉住。
3. **同一个 manager 实例贯穿三处**：runtime 的命令落点、chat / task 的业务侧记账、agent-link 的连接记账 ——
   三处写的是同一份 `WorldState.sessions`。组合根建一次，注入各处（mission / task 同一模式）。
4. **LITE 口径按方案 §2 表逐行落**：task_run / mission_run / shell_link 只记 **create + close 两事件**；
   character_chat **只更新 lastEventAt / 计数**（记一条**空**的 'round' 事件）——
   消息本体仍在 `chat_messages` 表，抄一份进 session_events 就是两份真相。
5. **落库失败只吞不抛**：会话域挂在对话回路与任务回路上，一次落库失败不该让对话中断
   （摘要还在 WorldState 里，缺一段历史不致命）；注入件自己记一行警告。
6. **远程模式不接会话写入面**：渲染侧组合根在远程模式下本地 runtime 不启动（真相在 service），
   本地再记一份会话 = 第二份真相（投影会被整帧覆盖）。
7. **world-sync 零改动**：`toWireState` 只摊平 `selectionGroups`，其余字段整体透传 → `sessions` 随快照走。
   验证结论记在任务 md（smoke 段 + 单测各钉一次）。

## 3. 未尽事项

- `peer_chat` 全量事件落库属 S4（agent-chat-service 本单未碰）。
- HUD 展示 / MCP 工具属 S5 / S6。
- `agent-link` 的 manager **没有生产实例**（只有单测与 `scripts/smoke-agent-link.ts` 在创建），
  故 shell_link 接线在生产链路上尚未生效；接线面已就绪，等 agent-link 接线单注入同一实例即可。
