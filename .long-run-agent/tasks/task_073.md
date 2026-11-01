# task_073 app: 中断轮部分输出落库（emitEvent 语义）——error/timeout/abort 轮的半截流式文本与错误事件持久化进 character_chat_messages

## 描述

对齐 Anthropic Engineering《Scaling Managed Agents》（2026-04）的 emitEvent 理念：session log 是 append-only 事件日志，durable record of events —— 记录「发生了什么」**包括失败**。

现状落库口径（chat-service.ts 文件头注释）：user 消息 send 守门后即时写①；assistant 消息 done 后写③；error 轮（timeout / cli_error / spawn_failed / nonzero_exit / aborted）的**已收流式半截文本不落库**，重开抽屉回读历史时该轮凭空消失（user 消息在、assistant 无踪）。

## Requirements

1. 先核实：读 runRound 的 catch/finally 分支，确认 error/abort 轮当前是否完全不落库（含错误标记）。
2. 落实：
   a. error/abort 轮：若已收到部分流式文本，落库为 assistant 消息，尾部加截断标记「（输出中断）」；role 仍是 assistant。
   b. 错误本身落库为一条 `role='system'` 消息，text 用现有 chatErrorText 的错误文案（或既有中断文案），使回读历史可见该轮失败原因。
   c. aborted 轮：部分文本 + 「（已中断）」标记同样落库；user 消息已在①即时写过，不重复写。
3. DAO/preload 兼容：character_chat_messages 表 role 列若是 TEXT 无 CHECK 约束则直接写；渲染层 role 联合类型不含 system 时，扩展 chat-history.ts 的 ChatHistorySaveMessage.role 与 chatHistoryEntryToDrawerInput 映射（system 渲染为居中/弱化系统行样式，复用现有 CSS token，不新增依赖）。role 联合类型定义位置先 grep 确认再改。
4. 历史回读（loadMessages → chatHistoryEntryToDrawerInput → drawer 回填）兼容三种 role；现有 user/assistant 气泡样式不变。
5. fire-and-forget 口径不变：落库失败只记日志不阻断对话。

## Acceptance

1. 新增/修改单测覆盖：中断轮（aborted）部分文本+截断标记落库；error 轮错误事件落库 system 行；空文本 error 轮只落 system 行不落空 assistant；历史回读含 system 行渲染为系统行样式。
2. `npx tsc --noEmit` 与 `npm test` 全绿（或至少受影响包全绿）。
3. 守门文案（NOT_INSTALLED / UNBOUND / NO_PROFILE / offline）维持**不入库**口径不回归——有测试钉死。
4. 最小改动：不动 transport/adapter 层，不引入新依赖。

## deliverables
- src/app/services/chat-service.ts（error/abort 轮落库逻辑）
- src/app/services/persistence/chat-history.ts（role 扩展与映射，如需）
- src/hud/components/chat-drawer/chat-drawer.ts（system 行渲染，如需）
- 对应单测文件（受影响包）

## 设计参考

- 对齐文档：Anthropic Engineering《Scaling Managed Agents》session 章节（emitEvent / durable record of events）。
- 核心文件：
  - `src/app/services/chat-service.ts`（runRound 落库时机）
  - `src/app/services/persistence/chat-history.ts`（role 类型与映射）
  - `src/app/services/persistence/chat-history-dao.ts`（确认无 role 约束）
  - `src/hud/components/chat-drawer/chat-drawer.ts`（system 行渲染样式，仅当 role 类型需要 UI 兼容时）
