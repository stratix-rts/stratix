# task_007

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_007.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3连接: agent-link外部agent连接重做-模块

## requirements

把「连外部 agent」这件事收进 core 层，做成可测试、可注入、有上限的模块（详见 `docs/REFACTOR_PLAN_V3.md` 第 1/2 节）。

1. **core 归位**：外部 agent 连接属 core，**零渲染依赖**（不许 import vue / phaser / DOM），上层（hud/world）只从 `src/core/agent-link/index.ts` 取，不许跨层 import 子文件。
2. **分层不倒挂**：`protocol`（编解码）→ `transport`（端口）→ `gateway-transport`（真实 IO）→ `session`（单会话状态机）→ `manager`（多会话 + WorldState 投影）。core 内部不认 IO，具体 transport 由上层注入。
3. **协议对齐现网**：REST 路由、请求体字段、响应信封、WS 代理地址、出入站帧形状，逐字对齐 `src/stratix-gateway/api/routes/openclaw.ts` 与 `src/stratix-openclaw-adapter/`（**只读参考，不改其本体**）。端点含凭据时脱敏后才进 WorldState；快照**不含 apiKey**。
4. **生命周期完整**：创建 / 恢复（带原会话键接上下文）/ 关闭 / 断线自动重连（指数退避、有预算上限）/ 请求背压，各相位与失败原因对 HUD 可见。**资源必须可清理**：无悬挂 Promise、无孤儿定时器、dispose 后不可再用。
5. **有上限**（perf 硬约束）：会话数、消息数（全局 + 单会话两级）都有硬顶，长跑不会把 WorldState 撑到每次广播都变重。
6. **装配进 core 运行时**：`createCoreRuntime` 支持注入 manager，随 runtime 的 start/stop 同生共死；未注入时既有命令行为不变（不破单测基线）。
7. **验收**：会话生命周期单测覆盖 + 与 gateway 协议联通的冒烟验证 + typecheck/build 全绿。

## 交付物

core 层的外部 agent 连接模块（零渲染依赖，全部落在 `src/core/agent-link/`）：

| 文件 | 职责 |
|------|------|
| `types.ts` | 域类型：建链参数 / 会话事件 / 可持久化快照 |
| `protocol.ts` | 编解码：地址拼装、脱敏、REST 信封、出站帧、入站解码、负载归一 |
| `transport.ts` | 端口（控制面 + 数据通道），core 只认接口不认 IO |
| `gateway-transport.ts` | 真实 IO：REST 打网关、WS 连网关代理地址 |
| `session.ts` | 单会话状态机：开户/建链/恢复/关闭/退避重连/请求背压 |
| `manager.ts` | 多会话 + WorldState 投影、消息两级裁剪、Notice 出口 |
| `index.ts` | 唯一对外出口（上层不许跨层 import 子文件） |

配套：`scripts/smoke-agent-link.ts`（真实 socket 上的网关协议冒烟）、`__tests__/`（6 组，含网关协议替身 `helpers/gateway-double.ts`）。

装配：`createCoreRuntime({ agentLink })` —— 注入式接线，manager 随 runtime 的 start/stop 同生共死。

## 验收标准

- [x] **会话生命周期单测覆盖**：创建（open/重复 open/并发 open/开户被拒/通道建不起来）、恢复（resume 带原会话键、已连接 no-op、reconnect 清零退避）、关闭（closing→closed、主动关闭不自动重连、在途请求被拒、销户失败尽力而为、dispose 后不可再用、建链途中 close 不复活会话）、重连（掉线自动退避重连、预算耗尽停在 error、退避窗口内 close 取消待执行重连）、事件回传（对话往返、远端消息/状态归一、raw 透传、脏帧降级、订阅者抛错隔离）—— `src/core/agent-link/__tests__/session.test.ts`
- [x] **与 gateway 协议联通的冒烟验证**：起按现网协议实现的网关桩（HTTP 控制面 + WS 代理数据面），走完整链路 命令 → 建链 → 对话往返 → 掉线自动重连 → 关闭 —— `npm run smoke:agent-link`
- [x] **装配进 createCoreRuntime**：`agentLink` 注入项已就位，runtime 停止时连接一并关闭（不留孤儿）—— `src/core/runtime.ts` + `__tests__/runtime-integration.test.ts`
- [x] **typecheck 全绿**：`npm run typecheck` 无输出
- [x] **build 全绿**：`npm run build`（tsc + vite build）成功
- [x] **零渲染依赖**：`src/core/agent-link/*.ts` 只依赖 `../types` / `../bus` / `../store` 与自身子模块，无 vue/phaser/DOM

## 验证证据（完成前必填）

- [x] **实现证明**: 自下而上五层 —— protocol（编解码）→ transport（端口）→ gateway-transport（真实 IO）→ session（单会话状态机）→ manager（多会话 + 状态投影）。协议逐字对齐现网只读参考：`proxyKeyOf` 与 `openclaw.ts:40 getProxyKey` 同构；`buildWsUrl` 与 `GatewayOpenClawAdapter.ts:69 getWebSocketUrl` 同构（`/api/stratix/openclaw/proxy/{proxyKey}/ws?clientId={accountId}`）；`isGatewayOk` 与 `StratixRequestHelper.isSuccess` 同为 code=200。协议对齐由 `__tests__/gateway-contract.test.ts`（逐字段校验帧与请求）守住。
- [x] **测试验证**: 见下方"验证结果"（agent-link 87 项 + core 150 项 + 全量 3120 项 / typecheck / build / smoke 全绿）。
- [x] **影响范围**: 只增不改既有行为。新增类型/字段（`AgentLinkView` / `AgentMessageView` / `MAX_AGENT_*` / `WorldState.links` / `WorldState.messages`）对既有消费方均为加法；runtime 未注入 manager 时这五条命令照旧走 onUnhandled，单测基线不破。全量 130 个测试套件零回归。未改动 `stratix-gateway` / `stratix-openclaw-adapter` 本体。

### 测试步骤
1. `npx jest src/core --maxWorkers=1` —— 会话生命周期 + 协议 + manager + runtime 集成
2. `npm run smoke:agent-link` —— 真实 HTTP + WebSocket socket 上验证网关协议
3. `npm run typecheck` && `npm run build` && `npx jest --maxWorkers=1`

### 验证结果

```
$ npx jest src/core --maxWorkers=1
Test Suites: 9 passed, 9 total
Tests:       150 passed, 150 total

$ npx jest src/core/agent-link --maxWorkers=1
Test Suites: 5 passed, 5 total
Tests:       87 passed, 87 total

$ npm run typecheck
> tsc --noEmit
（无输出 = 通过）

$ npm run build
> tsc && tsc-alias
> vite build
✓ built in 2m 15s

$ npm run smoke:agent-link
[1] HudCommand link.open → 建链
  ✓ 会话已连接：id=link_..._1 agentId=device_smoke0001 endpoint=http://127.0.0.1:18080（已脱敏）
  ✓ 网关桩记录的 WS 接入次数：1
[2] HudCommand chat.send → 往返
  ✓ 消息 → [you] ping
  ✓ 消息 ← [device_smoke0001] echo:ping
  ✓ 会话键已回写：sess_smoke_1
[3] 对端主动断开 → 自动重连
  ✓ 重连后仍 connected，会话键保持：sess_smoke_1
  ✓ 累计 WS 接入次数：1 → 2
[4] HudCommand link.close → 关闭
  ✓ 会话已关闭，网关桩收到 /disconnect 次数：1
  ✓ WorldState.links 仍保留视图：phase=closed

SMOKE PASS（10 项检查通过）

$ npx jest --maxWorkers=1
Test Suites: 130 passed, 130 total
Tests:       7 skipped, 3120 passed, 3127 total
Time:        35.005 s

$ NODE_OPTIONS='--max-old-space-size=4096' npx eslint --cache src/core scripts/smoke-agent-link.ts
✖ 0 problems（0 errors, 1 warning：scripts/ 命中 eslint ignore 规则）
```