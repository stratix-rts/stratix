# task_011

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_011.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3屏: log-drawer统一日志-模块

## requirements

把旧 `LogPanelModal.vue`（指令日志弹窗）与 `TaskLogViewer.vue`（任务日志弹窗）合并为
**一个** HUD 侧可折叠的「统一日志抽屉」，作为 v3 主屏常驻区块。

- 派生逻辑与渲染分离：`log-catalog.ts` 只做 WorldState → 视图模型的纯逻辑（零 DOM），
  `log-drawer.ts` 只负责把模型画成 Shadow DOM。
- **累积语义（与旧面板的根本差异）**：core 的 notices 有 6s TTL 且按 MAX_NOTICES 截断，
  若每次广播都"从 state 重画"，日志 6 秒后自己清空。故采用**增量消费**：见过的条目留在本地
  环缓冲里，直到被上限挤出或用户清空。首帧播种 state 里已有的通知与任务当前相位。
- 订阅 WorldState，覆盖两类来源：notices（核心通知）与 missions 的相位迁移。
- 过滤：按 missionId、按级别（info / warn / error，级别复用契约的 NoticeLevel，不另立词表）。
- 性能：环缓冲有界（MAX_LOG_ENTRIES=500）、已消费跟踪有界（FIFO）、
  两道签名闸门（`logSignature` 判日志源、`renderSignature` 判重渲染）避免无关广播触发重绘。
- 装配：挂进 `main-screen.ts` 的 `drawer-slot`，卸载时随之退订。

## acceptance

- [x] 订阅 WorldState，notices 与 missions 相位事件增量渲染成日志行
- [x] 支持 missionId 过滤与级别过滤
- [x] log-drawer 已挂进 main-screen，卸载时不泄漏订阅
- [x] typecheck（tsc --noEmit）0 错误
- [x] build（backend + frontend）通过
- [x] 渲染与过滤逻辑有单测覆盖

## 交付物

- `src/hud/panels/log-catalog.ts` —— 纯逻辑：增量合并 `mergeLogEntries` / 有界流 `createLogStream`
  / 过滤 `filterLogEntries` / 渲染模型 `buildLogModel` / 签名 `logSignature` / 格式化。
- `src/hud/panels/log-drawer.ts` —— `<strat-log-drawer>` Web Component + `mountLogDrawer` 装配工厂。
- `src/hud/__tests__/log-catalog.test.ts`、`src/hud/__tests__/log-drawer.test.ts` —— 单测。
- `src/hud/screens/main-screen.ts` —— 增加 drawer-slot 并挂载抽屉。

## 验证证据（完成前必填）

- [x] **实现证明**: `log-catalog.ts` 以 `createLogStream` 持有累积缓冲 + 已消费跟踪 + 溢出计数，
  `mergeLogEntries` 每次只并入"第一次见到"的 notice（id `notice:<id>`）与任务相位
  （id `mission:<id>:<phase>`，带相位以区分同一任务的多次迁移）；`log-drawer.ts` 经注入的
  `adapter.subscribe` 收广播，先过 `logSignature` 再过 `renderSignature` 才碰 DOM，
  渲染「时间/来源/级别/正文」四列 + 任务下拉 + 级别筹码。
- [x] **测试验证**: 见下方命令输出（typecheck 0 错、build 通过、log 单测 52/52、hud 全量 162/162）。
- [x] **影响范围**: 仅新增 `src/hud/` 下 2 个源文件 + 2 个测试文件，`main-screen.ts` 为增量接线
  （+12/-3 行，未改动 command-panel / agent-panel 的既有实现）。未触碰 `src/core`、`src/world`，
  未引入新依赖，未改动任何旧 Vue 组件。

### 测试步骤

1. `npx tsc --noEmit`
2. `npx jest src/hud --maxWorkers=1`
3. `npm run build`

### 验证结果

```
$ npx tsc --noEmit
(无输出，退出码 0)

$ npx jest src/hud/__tests__/log-catalog.test.ts src/hud/__tests__/log-drawer.test.ts --maxWorkers=1
Test Suites: 2 passed, 2 total
Tests:       52 passed, 52 total
Time:        2.881 s

$ npx jest src/hud --maxWorkers=1
Test Suites: 9 passed, 9 total
Tests:       162 passed, 162 total
Time:        2.879 s

$ npm run build          # = build:backend && build:frontend
✓ built in 2m 14s
(frontend 跑完即证明 backend 退出码为 0；仅有 vite 的 chunk>500kB 体积提示，非本次改动引入)

$ npx eslint src/hud/panels/log-drawer.ts src/hud/panels/log-catalog.ts src/hud/screens/main-screen.ts
(0 errors；两个测试文件命中仓库既有的 __tests__ ignore 规则，与同目录其它测试一致)
```