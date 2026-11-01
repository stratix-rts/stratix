# task_082 service: world-sync WS 端点——快照广播+命令回传+ack

## 描述

前后端分离 B2。按 task_081 契约在 gateway 实现传输端：Electron 壳（及任何客户端）连上即得世界态、发命令即落地。方案：docs/SERVICE-SPLIT-PLAN.md B2 节、docs/WORLD-SYNC.md（B1 产物）。

## Requirements

1. gateway 挂 `/world-sync` WS 端点（HTTP server upgrade 或独立 path，与现有 openclaw WS 路由共存不冲突）。
2. 客户端 `hello` → 立即推当前 snapshot（不等下一次变更）。
3. `store.subscribe` → **节流 100ms 合并** → 推 snapshot（seq 由 service 侧统一发号、单调递增；节流丢弃的中间态不推，只推最新）。
4. 收 `command.forward` → `emitCommand` → 回读核对落点（语义对齐 src/stratix-gateway/mcp/context.ts 现有回读核对模式）→ 回 `command.ack`；超时无落点回 internal_error ack（绝不假装成功，铁律 4）。
5. 断连客户端清理 + 心跳踢死链（实现模式参考 src/stratix-gateway/api/websocket/StatusSync.ts 的 ping/pong + WeakMap 存活标记，但**不复用其事件面**——那是 v2 编排事件，两个世界）。
6. 多客户端：变更广播给所有已 hello 客户端（Electron 壳 + 浏览器调试页并存）。

## Acceptance

- [ ] 内存 duplex WS 单测：hello 后必收 snapshot（含真实 store 数据）
- [ ] 命令往返 ack：command.forward → 状态变更 → command.ack ok
- [ ] 无人接管命令（如未知类型）超时 → internal_error ack
- [ ] seq 单调递增（连续推送断言）
- [ ] 两客户端并存各自收广播
- [ ] `npx tsc --noEmit` 0 错 + `npx jest` 全绿

## deliverables

- src/stratix-gateway/api/websocket/world-sync/（endpoint + session 管理）
- 单测（ duplex socket 注入式，不起真端口）

## 实施记录（B2 落地于本单）

- 产物：`world-sync/endpoint.ts`（端点：统一发号 / 节流广播 / 落点探针 / 心跳）、`world-sync/session.ts`（单连接会话：五型分派）、`__tests__/endpoint.test.ts`（10 例，内存 duplex socket）、`__tests__/helpers/memory-socket.ts`、`scripts/smoke-world-sync.ts`（真端口 7797 冒烟）。
- 接线：`src/stratix-gateway/index.ts` 挂 `/ws/world-sync`（与 openclaw 的 WS 路由共存：各自只认自己的路径），数据面 = 本进程 service 的 core store + core 总线；关停时随 gateway 一起收干净。
- 关键口径：seq **全 service 统一发号**（每份 snapshot 一个号，多客户端可比）；ack 的 seq = 核对时**已发出的最新 snapshot 的 seq**（对齐协议 §4.2 的 42/43 口径）；ack 先于广播到达（广播走 100ms 节流窗口）。

## 契约缺口记录（发现即记，**不改契约层**）

以下三处是 B2 实现中撞到的**协议/契约缺口**，本单未硬改 protocol.ts，留给后续单：

1. **「已受理但无状态落点」没有表达位**。core 的 `unit.move` / `camera.center` 落点在世界层坐标（不进 WorldState），端点的回读核对看不到落点 → 只能等到超时回 `internal_error`。
   协议 §2.2 的 ack 只有 ok/seq/error 三元，缺一个「已受理、无状态落点」的语义位（如 `ok:true, landed:false` 或专门的 code）。
2. **core 的业务拒绝无法精确归因**。core runtime 的 `handleCommand` 丢弃了各 manager 的裁决结果，端点只能靠「只新增了 warn/error 级 Notice」反推 `rejected` —— 是启发式，不是精确归因。
   要精确的 `rejected`，需要 core 回传裁决结果（属 core 契约变更，不在本单范围）。
3. **错误码词表缺 `not_registered`**。未发 `hello` 就发命令时，协议 §6 的六个码里没有对应项，本实现借用 `malformed_message`（并在 error 里带上 commandId 便于对账）。
   同类缺口：客户端误发 service→客户端方向的消息型（snapshot / command.ack / error），同样借用了 `malformed_message`。

另记（不算缺口，是实现取舍）：落点核对是**观测**而非精确归因 —— 核对窗口内若其它来源也改了状态，会被判为「已落地」。
