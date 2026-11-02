# task_101 v3.2b-B2：resume 全栈——agent-chat-service 续跑接线 + HUD/MCP 面

## 描述

v3.2b-B2：把「会话恢复（resume）」从 core 基础（task_100 已落地 `src/core/session/` 的
`manager.resume` + `context-replay.ts`）接到**全栈三面**：互聊引擎（续跑）、HUD（恢复按钮）、
MCP（写面工具）。方案见 `docs/SESSION-PLAN.md` §2（session.resume 命令设计）与
§8（第一期只做 peer_chat）。

现状缺口：core 有恢复能力，但没有入口 —— 没人发 `session.resume`，互聊循环也不会重启；
HUD 没有按钮；MCP 没有写面工具。

## requirements

1. **agent-chat-service 续跑接线**（`src/app/services/agent-chat-service.ts`）：
   - 接 `session.resume`：用 context-replay（task_100 的 `buildContextSnapshot`）的回灌消息
     列表**重建参与者上下文**（作为系统注入历史）；
   - **重启互聊循环**：参与者仍在场 → 继续轮转；角色不存在 → **如实报错不降级**
     （不另起新讨论、不静默跳过）；
   - 恢复后 `status=active`，事件追加「（续聊恢复）」。
2. **HudCommand `session.resume { sessionId }`**：gateway 命令路由对齐 `session.interrupt` 现有模式
   （core runtime 只转发给注入的恢复端口，端口缺席 → `reportUnhandled`）。
3. **HUD 面板**：interrupted 会话行加「恢复」按钮（复用中断按钮样式惯例，
   `src/hud/panels/session-panel.ts`）。
4. **MCP 写面工具 `session_resume`**（对齐 2a 工具 description 四要素 + 错误码），
   `docs/MCP-SPEC.md` 增补。
5. **只支持 peer_chat**：其他 kind 如实报错 `unsupported_kind`（不降级、不代偿）。

## acceptance

- [x] 单测：resume 路由（合法恢复 / 非法 kind / 角色缺失报错不降级）全过
- [x] `npx tsc --noEmit` 0 错 + `npm run build` 通过
- [x] service 层验证：interrupted 会话 resume 后可继续追加新消息且状态变 active
      （用测试替身验证，不真跑 agent）
- [x] HUD 面板按钮与命令接线有测试或可查证实现

## deliverables

- src/app/services/agent-chat-service.ts（resume 续跑：回灌上文 + 重启轮转）
- src/app/services/session-event-log.ts（进程内会话事件日志，给 core 当事件源）
- src/app/main/main-entry.ts（组合根：注入引擎级恢复端口 + 事件日志）
- src/core/runtime.ts / src/core/types.ts（session.resume 命令与恢复端口契约）
- src/stratix-gateway/api/websocket/world-sync/protocol.ts（命令协议对齐）
- src/stratix-gateway/service/stratix-service.ts（service 组合根：注入 core 级恢复端口）
- src/hud/panels/session-panel.ts / src/hud/panels/session-catalog.ts（恢复按钮）
- src/stratix-gateway/mcp/tools/session.ts（stratix_session_resume 写面工具）
- src/stratix-gateway/mcp/server.ts / index.ts（工具注册）
- docs/MCP-SPEC.md（§2.13 增补）
- src/app/__tests__/agent-chat-resume.test.ts
- src/app/__tests__/session-event-log.test.ts
- src/core/__tests__/session-resume-runtime.test.ts
- src/stratix-gateway/mcp/__tests__/session-resume.test.ts
- src/hud/__tests__/session-panel.test.ts（恢复按钮三例）
- src/stratix-gateway/mcp/__tests__/transport.test.ts / registry.test.ts（工具件数 12→13）

## 验证记录（2026-11-02）

见 `docs/rubric/agent_task_101.md`：jest 73 suites / 1308 tests + MCP 10 suites / 100 tests 全绿，
typecheck 与 build 通过。

### 未尽事项（如实记录）

- MCP 的 `stratix_session_resume` 走的是 **core 级恢复**（翻状态位 + 建回灌快照 + 记 resumed 事件）；
  service 进程内没有互聊引擎，**续聊对话由渲染进程的引擎接手**（两副面孔，已在 MCP-SPEC §2.13 写明）。
- 渲染侧事件日志是**进程内**的（页面重载即失），故渲染侧恢复在重载后无上文可回灌。
- 恢复后的轮数用缺省 3（原场次轮数无留痕）。
