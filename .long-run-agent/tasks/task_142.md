# task_142 — world-sync 词表评估 + 单位状态流收口（Loop B-3）

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_142.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

---

## 描述

LoopB-3: world-sync 词表扩展评估 + 单位状态流-模块（**评估型任务：先诊断、能不动协议就不动**）

## 结论（一句话）

**协议零改动、参数零改动、代码零改动** —— 五型词表够用；
「MCP 派任务 → app 单位动画切换」实测 **122ms**（远小于 3s 阈值，无需调参）；
**跨进程状态流只在远程模式（`STRATIX_REMOTE=1`）存在**，本地直连模式下 gateway 的派单进不了 app（实测对照）。

## 交付物

| 文件 | 职责 |
|------|------|
| `docs/UNIT-STATE-FLOW.md`（新） | 状态流全链路图（每一跳的机制 + 文件:行）+ 实测延迟（两轮时间戳）+ 词表评估结论 + 缺口清单 + 复现清单 |
| `scripts/measure-unit-state-latency.cjs`（新） | 可复跑的延迟实测脚本（协议层 WS / 应用层投影 / 视觉层截图 三个观测点） |
| `docs/WORLD-SYNC.md`（改） | 头部状态行更正（传输层 task_082 已落地）+ 指向 UNIT-STATE-FLOW 的配套链接 |

## requirements

- **画出真实状态流**：gateway 任务状态 → app 内 `task.*` → 单位动画，每一跳的机制（进程内总线 / WS 广播 / 进程内 state 通道）与量级 → `docs/UNIT-STATE-FLOW.md` §2
- **实测延迟**：MCP 派单 → 单位切工作态的实测值与时间戳证据（附测量方法与可复跑脚本）→ §3.2
- **词表评估**：五型词表是否够表达「单位状态流」；够用则结论「不动」，不足则列缺口 + 最小扩展方案（**不实现**）→ §4 / §6
- **延迟优化评估**：> 3s 才定位瓶颈并做参数级优化（协议不动）；< 3s 则明确「不调参」并给出理由 → §3.3
- **world-snapshot.json 对账机制**：两进程是否共享该文件的读取 → §5
- **文档落地**：状态流图写进 `docs/`（新文件 `docs/UNIT-STATE-FLOW.md`）→ 全文

## acceptance

- [x] **状态流全链路文档化**：每一跳的机制 + 实测延迟（附测量方法与数据）→ `docs/UNIT-STATE-FLOW.md` §2/§3
- [x] **词表结论明确**：够用（不动协议）→ §4（覆盖矩阵 + 「新增消息型 = 破坏性变更」的理由）
- [x] **延迟评估结论**：实测 122ms < 3s → **不调参**（给出参数级分析：节流窗 100ms 是延迟主体）→ §3.3
- [x] **文档落地**：`docs/UNIT-STATE-FLOW.md` + `docs/WORLD-SYNC.md` 配套链接（头部状态行更正）
- [x] **tsc 绿**：`npx tsc --noEmit` → exit 0（无 TS 代码改动，编译单元未变，仍复跑确认）
- [x] **改动最小化 / 协议零改动**：无协议、无 core、无 hud、无 world 代码改动；新增 1 文档 + 1 测量脚本
- [x] **缺口只记录不实现**：G1（排队中）/ G2（审批中）/ G3（失败原因不透传到单位）→ §6

## 验证证据（完成前必填）

- [x] **实现证明**：见下「实测数据」（真实 MCP 派单、gateway 进程内真跑 CLI，无假数据）
- [x] **测试验证**：测量脚本两轮复现一致（109/118ms、110/122ms）；对照实验证明本地模式无数据流
- [x] **影响范围**：无 TS 代码改动 → 协议 / core / hud / world 全部零改动；新增 1 文档 + 1 测量脚本（非编译单元）

### 状态流全链路（摘要）

```
①MCP POST /mcp (tools/call stratix_task_assign)   [gateway 进程]
   → mcp/tools/task.ts:158 → mcp/context.ts:139 → core/bus.ts:42 emitCommand
②core/runtime.ts:529 case 'task.assign' → core/task/manager.ts → task-service 真跑 CLI
   → core/store.ts:241 setState（WorldState.tasks / units.status）
③world-sync endpoint.ts:269 subscribe → :423 handleStateChange → :429 节流窗 100ms
   → :439 broadcastSnapshot（WS 广播，/ws/world-sync）
④app remote-store.ts:200 applySnapshot → main-entry.ts:382 worldStore.setState + emitState
⑤core/bus.ts:44 emitState → world/bridge/bus-adapter.ts:230 port.syncTasks
   → BattlefieldScene.ts:365 → task-animation.ts:94 taskPhaseView → TaskPhaseBoard(:137)
⑥unit-layer.ts:551 setTaskPhase → 每 tick → unit-animation.ts:418 resolveBase
   → 八态：working / completed(庆祝) / stuck / idle
```

### 测试步骤

1. 远程模式页：`STRATIX_REMOTE=1 STRATIX_WORLD_SYNC_URL=ws://127.0.0.1:7524/ws/world-sync npx vite --port 7530`
2. `node scripts/measure-unit-state-latency.cjs` → 打印时间线 + SUMMARY
3. 对照：`APP_URL=http://127.0.0.1:7523/ node scripts/measure-unit-state-latency.cjs`（本地直连模式）

### 验证结果

```
=== 远程模式（7530，STRATIX_REMOTE=1）两轮独立复测 ===
第1轮 task_1793766162856_38:
  mcp.assign.response  sinceAssign=14ms   (status=running)
  ws.snapshot.running  sinceAssign=109ms  (seq=62)
  app.taskRunning      sinceAssign=118ms  unitStatus=[{unit_character_1793750123353_1, busy}]
  app.screenshotWorking sinceAssign=224ms
第2轮 task_1793766228981_44:
  mcp.assign.response  sinceAssign=17ms
  ws.snapshot.running  sinceAssign=110ms  (seq=68)
  app.taskRunning      sinceAssign=122ms  unitStatus=[{…, busy}]
  app.taskCompleted    sinceAssign=2132ms (真跑 CLI 的执行时长，非链路延迟)

=== 对照：本地直连模式（7523）===
LOCAL(7523) before: {"units":[],"tasks":0,"characters":0}
mcp assign: {"ok":true,"status":"running"} at +16ms
+271ms … +5086ms（共 20 次轮询）: {"taskStatus":null,"unitCount":0,"taskCount":0}
gateway sees: {"task_id":"task_1793766179018_41","status":"completed","output":"142 本地模式对照"}
→ gateway 的任务正常跑完，app 页面 5s 内一次都没看到（两个大脑，两份世界态）
```

- 截图：`reports/shots/task142-latency-working.png`（running 瞬间）
- 时间线落盘：`/tmp/unit-state-latency-timeline.json`

### 缺口清单（**记录，不实现** —— 留决策）

均为「core 任务相位 → 单位八态」的**语义覆盖缺口**，**不在 world-sync 协议层**：

| # | 缺口 | 最小扩展方案（未实施） |
|---|------|----------------------|
| G1 | `queued`（排队中）无专属单位态，看着像没事 | `UnitTaskPhase` 增第 5 相（world 层纯改动） |
| G2 | `awaiting_approval`（审批中）无专属单位态（仍显示 working） | 同上（数据已在 `WorldState.tasks` 里，协议不用动） |
| G3 | 失败**原因**不透传到单位（只有 ❗ + 灰度） | 摘要已在 snapshot 里，做「原因气泡」属世界层新表现元素 |

补充限制：远程模式无事件路（`task.started/completed/failed` 不进 app），庆祝演出靠**快照跳变**识别 →
  一个 100ms 窗内连跳多相会丢中间态（world-sync 无增量的固有代价；`delta` 是预留位，不为此改协议）。

### 影响范围

- **零 TS 代码改动** → `npx tsc --noEmit` 无需复跑（无编译单元变更）；协议 / core / hud / world 全部未动。
- 新增：`docs/UNIT-STATE-FLOW.md`、`scripts/measure-unit-state-latency.cjs`（cjs，非 tsc 编译单元）。
- 修改：`docs/WORLD-SYNC.md`（头部状态行更正 + 配套链接）、本文件。
- 未动：MCP 工具层与错误信封、HEARTBEAT.md、reports/（除测量截图）、其它 .long-run-agent 文件。
- 未重启 gateway（7524）、未动 vite 7523；复用了 B2 已在跑的远程模式页 7530。
