# task_151

## 描述

回归修复 —— agent 面板表单提交后 `pipeline.start` 断流。

## requirements

1. 判定：`agent-panel-pipeline.test.ts` 的 2 个失败用例，是「产品行为真断了」还是「测试没跟上」。
2. 真实表单提交必须仍能启动 pipeline（产品行为为准）。
3. 回归修复的归因写清楚：哪一刀引入、为什么测试当时没拦住。
4. 最小改动；不动 gateway/；零新依赖；不动 HEARTBEAT.md / .long-run-agent（除本文件）。

## acceptance

- [x] `agent-panel-pipeline.test.ts` 全绿
- [x] `npx jest src/hud --silent` 全绿（1396 = 既有 1395 + 新增回归用例 1）
- [x] `npx tsc --noEmit` 零错
- [x] 归因写清楚（本文件「归因」一节）

## 归因（结论）

**不是产品行为断了，是测试夹具没跟上 —— 但顺带挖出同一刀引入的两个真缺陷，已一并修。**

### 引入的那一刀

**不在 95ea722（148）里，也不在 150 的命令注册表迁移里。**

- `git log --oneline -6 -- src/hud/panels/agent-panel.ts` → 最后一次改动是 **b8c42e3（147）**；
  `git show 95ea722 -- src/hud/panels/agent-panel.ts` → **空 diff**（148 的死按钮治理落在
  `new-task-dialog.ts`，没碰 agent 面板）。
- 真正的引入点是**工作区里没提交的改动**：`git diff src/hud/panels/agent-panel.ts` 里有一坨
  「派发按钮禁用态 + 缺什么说明」的实现（`syncSubmitState` / `resolveSubmitState` +
  `root.addEventListener('input'|'change')`），代码注释自称 `@since v3.9，task_148`，
  但**任何 task 文件都没记过它**（`grep -rln 'syncSubmitState' .long-run-agent/` → 无命中），
  也没进任何提交 —— 是一次**写了没提交、没写工作文档、没补测试**的孤儿改动。

### 失败机制（为什么命令数组是空的）

1. 新增的「派发」按钮禁用态由 **`input` / `change` 事件驱动**重算（`syncSubmitState`）。
2. `agent-panel-pipeline.test.ts` 的夹具用 `input.value = '…'` **裸赋值**模拟用户输入 ——
   裸赋值**不触发事件**（真实浏览器里打字/粘贴/撤销/输入法/自动填充都会触发）。
3. 于是按钮停在「议题为空 → 禁用」态；`.click()` 作用在 `disabled` 按钮上被浏览器吞掉 →
   命令端口一条都收不到 → `expect(harness.commands).toHaveLength(1)` 实收 `[]`。
   第二个用例 `harness.commands[0]` 是 `undefined`，读 `.spec` 崩 —— 同一个根因。

### 产品行为到底断没断（探针实测，已删除探针文件）

临时探针（jsdom，真实事件）跑出四条结论：

| 场景 | 结果 |
|---|---|
| A 真实用户路径：切流水线 → 打字（input 事件）→ 点派发 | **`pipeline.start` 正常发出** —— 产品没断 |
| D 自定义两站：选角色（change）+ 填模板（input）→ 点派发 | **正常发出**，steps 载荷正确 —— 产品没断 |
| B 单任务表单刚打开、议题为空 | 按钮 **enabled** → 点下去静默无反应 —— **真缺陷（死按钮本体）** |
| C 流水线会话禁用过 → 关表单 → 再开单任务表单 | 按钮**残留禁用态**，title 还挂着流水线的理由 —— **真缺陷（跨会话脏状态）** |

A/D 证明：**真实表单提交仍能启动 pipeline，产品行为没断**；
B/C 证明：同一刀确实留了两个真缺陷（正是 148 想治的「静默死按钮」，只是漏了单任务侧和开表单路径）。

### 为什么测试当时没拦住

1. 那坨改动**从没提交**，从没有 CI/全量扫描跑过它。
2. 它**没带任何测试** —— 治理面（禁用态 + 缺什么说明）一行断言都没有。
3. 既有夹具（`input.value =` 裸赋值）在旧行为下**恰好能过**：旧代码按钮永远 enabled，
   派发与否只由构造器说了算；新门控一落地，所有裸赋值的夹具**静默失效**
   （点不动 ≠ 断言失败，是「没发命令」这种看起来像别的 bug 的失败）。
4. 全量扫描时这坨改动正好躺在工作区里 —— 与 148-150 的提交窗口重叠，就被记成了「148-150 引入的回归」。

## 改动

### 产品（`src/hud/panels/agent-panel.ts`）

1. **补完那坨孤儿改动并修它的两个真缺陷**（`openTaskForm` 里显式 `syncSubmitState()`）：
   - `setFormMode('single')` 在「上一轮也是单任务」时走**早退分支** → 早退路径上
     `syncSubmitState` 不会被调 → 按钮停在上一轮的禁用态（缺陷 C）。
   - 单任务侧从来没被治理过：空指令时按钮仍 enabled、点下去静默无反应（缺陷 B）。
   - 修法：**派发可用态按「本次表单的当前内容」重算**，开表单时必算一次。

### 测试（夹具跟上新契约，断言一条没动）

2. `agent-panel-pipeline.test.ts`：新增 `typeIssue` / `selectStation` / `typeTemplate` 三个
   夹具助手 —— **赋值 + 派发真实 `input` / `change` 事件**；口径与 `chat-drawer` 测试的
   `typeDraft`（`character-chat-drawer.test.ts:186`）完全一致 —— 那是本仓库既有的、
   同一个治理面（`disabled` + 事件驱动重算）的成熟先例。
   `pipeline.start` 的断言（命令类型 / spec.name / spec.steps / issue / 表单关闭）**一字未改**。
3. `agent-panel.test.ts`：4 处「裸赋值 + 点派发」的夹具补 `input` 事件（同口径）。
4. `agent-panel-pipeline.test.ts` 新增 1 条回归用例：空议题禁用 + 写明缺什么，
   关表单再开不留上一轮的脏禁用态/脏理由（锁死缺陷 C）。

### 没动

- gateway（7524）、命令端口语义、命令注册表（150）、HEARTBEAT.md、`.long-run-agent`（除本文件）。
- 工作区里其它人的在飞改动（`task-animation.ts` / `unit-layer.ts` / `BattlefieldScene.ts` /
  `main-entry.ts` / `hello-loop-entry.ts` / `hud-dev-entry.ts` 等）—— 一律不碰、不提交。

## 未尽事项（留给后续，不在本任务范围）

- **Ctrl+Enter 快捷键在流水线模式下走的是单任务路径**（`agent-panel.ts:636` 直接调
  `submitTaskForm()`，不分流模式）→ 流水线模式按 Ctrl+Enter 会发出 `task.assign` 而不是
  `pipeline.start`。这是 task_051 就有的老问题，不在 148-150 窗口内，未在本任务动。
- Ctrl+Enter **不受付发按钮禁用态约束**（按钮禁用时快捷键仍能提交）—— 与 148 的治理口径
  不一致，等同一刀收口。
- 孤儿改动 `syncSubmitState` 的原始设计者未留工作文档，本任务据代码自洽性补齐了
  「开表单时必算一次」的缺口；若原作者另有设计意图，需回溯确认。

## 交付物

- `src/hud/panels/agent-panel.ts`（产品：开表单时重算派发可用态）
- `src/hud/__tests__/agent-panel-pipeline.test.ts`（夹具 + 回归用例）
- `src/hud/__tests__/agent-panel.test.ts`（夹具）
- 本文件
