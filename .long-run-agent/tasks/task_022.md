# task_022

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_022.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 代码 + 测试

## 描述

world/hud: 本地 agent 检测器（which+version 扫描，T1-T3 名单，结果进 WorldState.detectedAgents）-模块

## requirements

新增 src/app/services/agent-detector.ts（Electron 主进程侧）：按 docs/AGENT-MATRIX.md T1-T3 名单逐个 which+--version 探测（每项 10s 超时），返回 DetectedAgent{kind, installed, version, path, tier}。经 IPC/preload 暴露给渲染层，检测结果并入 WorldState.detectedAgents 广播。纯 Node 可测：探测函数接受注入的 execFn。

## design

不阻塞启动：异步探测，逐个出结果逐个广播。名单常量与 AGENT-MATRIX.md 对齐（claude-code, codex, opencode, kimi, openclaw, gemini, qwen, crush, goose, aider, copilot）。

## acceptance

- tsc 零错误
- 注入假 execFn 的单测：已装/未装/超时三态
- jest 新增套件全绿
- 真机跑一次 dev 输出探测日志（claude/openclaw 必检出）

## 交付物

按 design 落地的新增/修改文件 + 对应测试

## 验证证据（完成前必填）

- [x] **实现证明**: 简要说明如何实现
- [x] **测试验证**: typecheck + 对应目录 jest 输出原样贴出
- [x] **影响范围**: 是否影响其他功能

### 实现说明

1. **契约（src/core/types.ts）**
   - 新增 `AgentDetectionTier`（T1/T2/T3）、`DetectableAgentKind` + `DETECTABLE_AGENT_KINDS`（T1-T3 全量 11 种，
     与 `AgentKind`（已绑定种类）**分表**：后者是前者的子集，混用会让 T2/T3 无处安放）；
   - 新增 `AgentDetectionStatus`（installed / not-installed / timeout / failed）与 `DetectedAgent`
     （kind / tier / installed / status / version / path）；
   - `WorldState` 新增**可选**字段 `detectedAgents?: DetectedAgent[]`（可选增补，不破既有构造点；
     名单固定 11 项 → 体积天然有界）。

2. **检测器（src/app/services/agent-detector.ts，新增）**
   - 名单 `AGENT_DETECTION_TARGETS`（T1×5 / T2×4 / T3×2，binary 名唯一），与 docs/AGENT-MATRIX.md 一一对应；
     `verifyAgentRoster()` 自检名单与契约词表一致（主进程启动时打自检日志）；
   - **注入式执行器** `ExecFn`（`command, args, {timeoutMs} → {code, stdout, stderr, timedOut?}`）——
     检测逻辑不认识 child_process，单测注入假 execFn 即可覆盖三态；
   - `detectAgent()`：先 `which` 定位（失败 → not-installed，**不再**跑版本命令），再对解析出的绝对路径跑 `--version`；
     **超时由检测器自己兜底**（`runGuarded` + Promise.race 计时器），注入的 execFn 永不返回也不会卡住整轮；
   - `detectAllAgents()`：**逐条探测、逐条回调**（onResult），不等全部结束（不阻塞启动）；支持 AbortSignal 取消；
   - `mergeDetectedAgents()`：同 kind 覆盖、新 kind 追加（快照只有一份真相）；
   - `formatDetectionLog()`：真机日志格式（脚本与主进程共用同一条路径）。

3. **真实执行器（src/app/services/node-exec.ts，新增）**
   - `createNodeExec()`：基于 child_process（默认 execFile 不经 shell；win32 退回 shell 以支持 .cmd 包装器）；
     超时 kill 子进程并标 `timedOut`（**超时 ≠ 未装**：退出码 143/-1 与 127 必须分开）。

4. **状态落地（src/core/store.ts）**
   - 新增 `setDetectedAgents()`（整份替换语义）；同内容重复写入**不广播**（重复扫描不该把两侧白白重渲染一遍）。

5. **接线（Electron 主进程 → IPC/preload → 渲染层 → core 广播）**
   - `src/electron/main.ts`：启动后 `startAgentDetection()`（不阻塞窗口加载），逐条结果并入快照并
     `webContents.send('agent:detected:update', …)`；另提供 `ipcMain.handle('agent:detected:snapshot')`；
     退出前 abort（资源清理）。
   - `src/electron/preload.ts`：暴露 `agentDetection.snapshot()` / `agentDetection.onUpdate(cb)`。
   - `src/app/main/main-entry.ts`：**先订阅、后拉快照**（反过来的话"订阅前到达的推送"会永久丢失），
     结果写 `worldStore.setDetectedAgents()` → 由 core/runtime.ts 既有的 store 订阅广播 WorldState（**未新增广播通道**）。

### 测试验证

- `src/app/__tests__/agent-detector.test.ts`（新增）：名单自检 / 已装·未装·超时三态 / 逐条回调与不阻塞 /
  取消信号 / 并入 WorldState 并经 core 总线广播 / 同内容不重复广播 / merge 语义 / 三处接线守门。
- `src/core/__tests__/store.test.ts`：新增 `setDetectedAgents` 四例（写入广播 / 整份替换 / 同内容不广播 / 内容变则广播）。
- 命令输出见下。

### 影响范围

- 仅新增 `src/app/services/**`（Node 侧检测器 + 真实执行器）、`src/app/__tests__/agent-detector.test.ts`、
  `scripts/detect-agents.ts`（真机跑一次的脚本 + `npm run detect:agents`）。
- 契约侧只做**可选字段**增补（`WorldState.detectedAgents?`）+ store 新增一个写入方法，
  既有构造点（core/hud 单测夹具）编译不受影响；`jest src/core src/hud src/world` 全绿（658 passed）。
- 未触碰 `src/world` / `src/hud` 渲染层；未引入新依赖；未改 HEARTBEAT.md / lra 配置。
- 已知边界（非本任务范围，已在交付说明里写明）：
  1. **纯 vite dev（无 Electron）下不探测** —— 渲染进程没有 child_process，探测只能在 Node 侧跑；
     此时 `WorldState.detectedAgents` 保持空数组（"尚未检测"）。
  2. **Electron 主进程需重启**才能拿到检测能力（主进程代码不热更新）；已在跑的实例仍是旧主进程。
  3. 首启引导屏**尚未**渲染这份检测结果（本任务只出数据，不碰渲染层）。

### 验证结果

```
$ npm run typecheck
> stratix@0.1.0 typecheck
> tsc --noEmit
（零输出 = 零错误）

$ npm run typecheck:tests
> stratix@0.1.0 typecheck:tests
> tsc -p tsconfig.test.json --noEmit
（零输出 = 零错误）

$ npx tsc -p tsconfig.electron.json --noEmit
（零输出 = 零错误 —— Electron 主进程 / preload 编译通过）

$ npx jest src/app --silent
Test Suites: 3 passed, 3 total
Tests:       33 passed, 33 total
Snapshots:   0 total
Time:        2.358 s

$ npx jest src/core src/app --silent
Test Suites: 15 passed, 15 total
Tests:       315 passed, 315 total
Snapshots:   0 total
Time:        3.441 s, estimated 4 s

$ npx jest src/hud src/world --silent
Test Suites: 17 passed, 17 total
Tests:       343 passed, 343 total
Snapshots:   0 total
Time:        4.207 s

$ npm run build:electron          # 主进程 + preload 编译 / 打包（含新检测器）
  dist/electron/electron/main.cjs  4.6mb ⚠️
  ⚡ Done in 210ms
  [bundle-electron] Bundled main.js -> main.cjs

$ npm run build:frontend          # 渲染层不含检测器（无 child_process）
  ✓ 50 modules transformed.
  ✓ built in 1m 56s
```

**真机跑一次（Electron 主进程实际探测日志）** —— `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --config electron.config.json`：

```
[Electron] Agent Platform IPC handlers registered
[Electron] Entry: src/app/main/index.html (v3 new UI, 单入口)
[Electron] Loading from Vite dev server: http://127.0.0.1:7523/src/app/main/index.html
[agent-detector] claude-code (T1) ✓ 已安装 · 2.1.270 · /Users/kingj/.local/bin/claude
[agent-detector] codex (T1) ✗ 未安装
[agent-detector] opencode (T1) ✓ 已安装 · 1.2.6 · /Applications/ServBay/package/node/22/22.21.1/bin/opencode
[agent-detector] kimi (T1) ✓ 已安装 · 1.48.0 · /Users/kingj/.local/bin/kimi
[agent-detector] openclaw (T1) ✓ 已安装 · 2026.4.2 · /Applications/ServBay/package/node/22/22.21.1/bin/openclaw
[agent-detector] gemini (T2) ✗ 未安装
[agent-detector] qwen (T2) ✗ 未安装
[agent-detector] crush (T2) ✗ 未安装
[agent-detector] goose (T2) ✗ 未安装
[agent-detector] aider (T3) ✗ 未安装
[agent-detector] copilot (T3) ✗ 未安装
```

→ **claude / openclaw 均已检出**（验收要求），另检出 opencode / kimi。

同一路径的独立脚本（`npm run detect:agents`，与主进程同一个 detector + 同一个 node-exec）：

```
[agent-detector] claude-code (T1) ✓ 已安装 · 2.1.270 · /Users/kingj/.local/bin/claude
...
[agent-detector] 合计 11 项，已安装 4 项，未确认 0 项
```
