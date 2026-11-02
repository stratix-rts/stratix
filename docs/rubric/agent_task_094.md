# agent_task_094 —— 互聊接入会话域（S4）工作文档

> 任务：v3.2a S4（task_094）—— 互聊接入会话域（peer_chat）：轮次 / 中断落事件，修「超时即丢」。
> 方案：docs/SESSION-PLAN.md §2（接线表）/ §5（互聊改造）。
> 前置：S1 域模型（task_091，9a750c4）、S2 存储（task_092，015f2d2）、S3 组合根接线（task_093，2db46b0）。
> 日期：2026-11-02。

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/app/services/agent-chat-service.ts` | 会话域接线：开场建会话（peer_chat）/ 议题·每轮·插话各记一条 message 事件 / 中断转 interrupted + interrupt 事件 / 正常收尾 closed；deps 增可选 `sessions` 口 |
| `src/app/main/main-entry.ts` | 渲染侧组合根补线：`sessions: remote ? undefined : sessionManager`（与 S3 的 chat/task 同一口径） |
| `src/app/__tests__/agent-chat-service.test.ts` | 夹具接真 store + 真 SessionManager（事件信封截获，不碰 SQLite）；新增「会话域(peer_chat)」7 例；436 行超时用例族增断言（interrupted + interrupt 标记） |
| `.long-run-agent/tasks/task_094.md` | 验收勾选 + 验证记录（输出原样贴入） |
| `docs/rubric/agent_task_094.md` | 本工作文档 |

## 2. 关键设计决策

1. **中断只调 `interruptSession`，不再单独 `appendEvent('interrupt')`** —— 见任务 md 同节展开：
   manager 的 `interruptSession` 已原子地「记事件 + 迁移状态」，补第二次 = 同一条标记记两遍；
   顺序反了还会撞「已中断不能再中断」的非法迁移（凭空多一条警告）。净效果与任务书
   「appendEvent(type=interrupt) + interruptSession」一致，但事件流里只有一条 interrupt。
2. **会话写入面是旁路**：`deps.sessions` 缺省 / 建会话失败 / 记账抛错 → 互聊照常（只少一段历史）。
   与 S3 的 character_chat LITE 同一纪律（可用性优先于历史完整性）。
3. **不直接 import worldStore 单例**：`deps.sessions` 是注入口（core/session 的 SessionManager 类型），
   组合根注入 —— 对齐该文件既有依赖注入风格（view / getState / createTransport / persistMessage…）。
4. **议题与插话记成 author='用户'**（导出常量 `PEER_SESSION_USER_AUTHOR`）：author 语义是
   「谁在说」；发言者用角色名（阿尔法 / 贝塔）。
5. **回合之间叫停也算打断**：`stopRequested` 且无在飞回合可断 → interrupted（reason='用户停止互聊'），
   否则用户叫停的场次会被记成「讨论完成」。
6. **远程模式不接会话写入面**：与 S3 的 character_chat / task_run 同一口径（本地 worldStore 在远程
   模式下是投影缓存，本地写会被整帧覆盖 = 第二份真相）。
7. **不动 core/session**：会话域的状态机 / 事件信封 / 淘汰口径一个字没改（本单只接线）。

## 3. 未尽事项

- 本地直连模式下会话不入 SQLite（组合根的 sessionManager 没有 persist 口；会话两张表的写口在
  service 进程 storage.ts 里）→ 需 IPC 落库通道，属 S3/S7 的活。
- 远程模式下互聊不记会话（渲染侧写投影会被覆盖）→ 需把会话写面转发到 service，属 2b/S7。
- 被中断的会话不进 FIFO 淘汰池（core/session 只淘汰 closed）→ 长期使用会逼近 MAX_SESSIONS，
  口径待定（会话域 S1 的事）。
- 恢复续聊（interrupted → active + 上下文回灌）按方案放 2b；HUD 面板 S5、MCP S6、验收剧本 S7。
