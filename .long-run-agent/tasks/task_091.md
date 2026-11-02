# task_091 core: session 域模型——types+状态机+manager（纯逻辑）

## 描述

v3.2a S1：会话域地基。方案 docs/SESSION-PLAN.md 第 2 节（先读它——域模型/状态机/五 kind 接线策略全在里面）。纯逻辑单：不碰存储、不碰 Electron、不碰 service 接线。

## Requirements

1. 新模块 `src/core/session/`：`types.ts`（SessionRecord/SessionKind/SessionStatus/SessionEvent 信封/命令载荷）+ `machine.ts`（状态转移表）+ `manager.ts`（createSession/appendEvent/interruptSession/closeSession + WorldState.sessions 投影 + MAX_SESSIONS=200 FIFO 淘汰 closed 最旧）+ `index.ts` 出口。
2. WorldState 增补 `sessions: SessionRecord[]`（types.ts 契约，照 links/messages 增补惯例：可选字段/默认空数组，不破既有构造点）。
3. HudCommand 增补 `session.interrupt { sessionId }`（types.ts，最小载荷）。
4. 自动 title（2a 规则版）：createSession 时按 kind+首条消息截断生成 12-20 字 title（纯函数 `deriveSessionTitle`，确定性，无 LLM）。
5. 状态机非法转移必须拒绝并返回结构化错误（对齐 mission/task machine 模式），单测覆盖全合法转移+全非法转移。
6. 事件 seq 会话内单调递增；appendEvent 在 interrupted/closed 状态下的语义：closed 拒绝，interrupted 允许记「中断标记后事件」（如恢复尝试）——语义写进契约注释。
7. 组合根不接线（S3 的事）；本单只交付纯模块+单测。

## Acceptance

- [ ] 状态机全转移表单测（合法+非法各≥8 用例）
- [ ] manager 单测：create/append/interrupt/close/FIFO 淘汰/seq 单调
- [ ] deriveSessionTitle 纯函数单测（五 kind 各≥2）
- [ ] types.ts 增补不破既有构造点（npx tsc --noEmit 0 错）
- [ ] npx jest 全绿
- [ ] 本单不改 app/hud/gateway 任何文件（git diff 验证 src/core 外为空）

## deliverables

- src/core/session/{types,machine,manager,index}.ts + 单测
- src/core/types.ts（sessions + session.interrupt 增补）
