# PERF-01 · 冷启动到首帧 · 时间基线

> 权威任务：`.long-run-agent/tasks/task_230.md`（task_230，v3.3）
> 本单是 production 优化循环的**第 1 链**：只做**测量 + 记录 + 分析**，**没有实现任何优化**。
> （第 2 链 PERF-02 / task_231 已实施本单 §6 候选 1 —— 落地结果与前后对照见 **§9**。）
> 测量脚本：`e2e-tests/perf-baseline.e2e.mjs`（+ `e2e-tests/perf-baseline/` 下的配套脚本，清单见 §8）——
> **可重跑、端口动态挑、临时 DATA_DIR，绝不碰用户的 7523 / 7524 / 7525 / 9222**。

---

## 0. 结论摘要（先看这一段）

| # | 结论 | 依据 |
|---|---|---|
| 1 | **最大段 = service 进程冷启**（prod 口径 586ms，占「真实冷启动」1414ms 的 **41%**）。 | 表 1 / 表 3b |
| 2 | service 冷启里 **最大的一段是「模块装载」**（node 启动 + tsx 转译 + 模块求值）：**338ms（dev 采样，占 service 的 60%）/ 366ms（prod 采样，占 62%）**；**真正的业务装配只有 76ms**（dbInit 51 + branchProbe 13 + bootService 5 + listen 7）。 | 表 1 |
| 3 | 这段「模块装载」（338~366ms）是**开发期成本**（tsx 现场转译）。生产打包的后端是 `tsc` 产物、不走 tsx ⇒ **它在真实产品里会显著缩水**。本单没量 electron 打包产物的后端冷启（缺口见 §7）。 | §7 缺口 1 |
| 4 | 渲染侧（**生产产物**）：DCL 236ms → FCP 252ms → 大厅面板 494ms → 战场 scene create **473ms**。最大段是 **模块执行 + Phaser 启动（236→473ms，237ms）**。 | 表 2b |
| 5 | dev server 下渲染侧慢一截且是**开发态专属**：模块图 273 个文件逐个拉取 + 逐个转译 ⇒ DCL 628ms（是生产产物的 2.7 倍）。**同一份源码**换成生产 bundle，战场 scene create 从 893ms → 473ms（**-420ms**）。 | 表 2a vs 2b |
| 6 | **roster 物化不是瓶颈**：进副本（带名册的实例 B）实测 service 侧 **5ms**。默认沙盒根本不物化（沙盒不误伤）。 | 表 3a / 3b |
| 7 | **唯一一处「产品语义造成」的延迟**：点「进入」→ 生效 = **122ms**，其中 service 侧裁决只花 **5ms**，剩下 ~100ms 全花在 world-sync 的 **100ms 快照节流窗口**上（`WORLD_SYNC_SNAPSHOT_THROTTLE_MS`，endpoint.ts:217）。**→ 已由 PERF-02 落地（122ms → 24~35ms），见 §9。** | 表 3a / 3b + §6 候选 1 + §9 |
| 8 | 生产 gateway（`src/stratix-gateway/index.ts` 全量装配）冷启 **966ms** vs 最小复刻 **561ms** ⇒ 多挂的子系统（MCP / dataStore / OpenClaw / 状态同步）**值 405ms**。 | 表 1 对照行 + §6 候选 2 |

**优化候选（只登记，不实现）**

| 候选 | 归类 | 预期收益量级 | 风险 | 改动面 |
|---|---|---|---|---|
| ① world-sync 快照节流 100ms → 25ms（或关键事件直发） | **已实施**（PERF-02 / task_231，见 §9） | 实例切换可见延迟 **-75ms**（122→~45ms）；端到端 -75ms | 中低（需保住高频事件侧的合并） | 1 个常量 + 1 条旁路（~30 行）+ 1 个单测 |
| ② 后端子系统懒加载 + 渲染侧拆包/延后 Phaser | **独立分支（改动面 ≥3 万行量级）** | 后端冷启 **-200~400ms**；首屏 **-200ms 量级** | 中高（改的是装配语义，不是行数） | src/world（28.7k 行）+ src/app（52.3k 行）+ vite 分包 |

---

## 1. 环境与口径

### 1.1 环境

| 项 | 值 |
|---|---|
| HEAD | `1331227`（分支 `demo/v3.3`） |
| Node | v22.22.2（tsx 运行） |
| OS / 架构 | Darwin 25.3.0 / arm64 |
| CPU | Apple M1 Ultra |
| 浏览器 | Playwright 1.58.2 的 Chromium（headless） |
| 测量日期 | 2026-11-09 |
| 机器状态 | 空闲（未并行跑其它 CPU 密集任务）；第 1 轮的浏览器冷启有 ~1s 离群，中位数口径已吸收 |

### 1.2 两种「渲染侧形态」

| 形态 | 含义 | 为什么都要量 |
|---|---|---|
| `dev` | **vite dev server**（仓库那份 `vite.config.ts` 原样复用，只换端口/代理目标） | 开发期体感（`npm run dev` 之后多久能看见画面） |
| `prod` | **vite preview 服务生产产物**（`dist/perf-frontend/`，rollup 打完的 bundle） | **用户实际下载/执行的那份代码**（dev 的 273 个模块逐个转译，用户拿不到） |

service 侧与形态无关（两种形态跑的是同一个 service 进程）⇒ §2 只给一张表，并附 prod 形态的独立复现值。

### 1.3 口径定义

- **service 侧**：计时基准 = 驱动脚本自己 spawn 子进程的那一瞬（`Date.now()`）；分段计时基准 = 进程内 `process.uptime()`
  （**必须**用它：node 启动 + tsx 转译发生在模块体之前，`Date.now()` 的基准太晚，量不到）。
- **渲染侧**：页面时钟 `performance.now()`，`navigation start` 为 0 点 ⇒ 与 FCP / DOMContentLoaded 同一把尺。
  - `FCP` = `performance.getEntriesByType('paint')` 里的 `first-contentful-paint`；
  - `首屏` = `strat-lobby-panel` 元素**挂载**时刻（MutationObserver 记录，`document.querySelector` 命中即记）；
  - `战场 scene create` = 场景类的 `create()` **返回之后**打的 `performance.mark`（= 场景建完、层都建好了）。
- **端到端**：起点 = spawn service；终点 = `window.__srfApp.snapshot().activeInstanceId === 'wsp_sandbox'`（**页面可点进沙盒**）。

### 1.4 打点是怎么做的（零产品改动）

「战场 scene create 完成」在产品码里**没有任何可观测点**（world 层零 DOM；Phaser 3.90 的 dist 里没有 `window.PHASER_GAME`；
场景实例也没暴露给页面）⇒ 只能在**构建期注入**：

- 注入发生在**测试侧**（`e2e-tests/perf-baseline/scene-marks.ts`，一个 vite 插件）：
  给 `BattlefieldScene` / `LobbyScene` / `FxAssetScene` 的 `create` 包一层，**多打一条 `performance.mark`**；
- 仓库里的 `src/**` **一个字节都没改** ⇒ 产品路径零行为变化（`tsc` 也绿，见 §7）；
- dev 形态在 dev server 侧注入，prod 形态在**生产构建**侧注入 ⇒ 两个形态用的是同一份注入代码（口径一致）。

---

## 2. 维度一 · service 侧（spawn → `/health` ok 的分段）

数据来源：dev 形态那一轮的三次采样（service 与形态无关）；括号内是 prod 形态的**独立复现**采样。

| 分段 | 含义 | 第1轮 | 第2轮 | 第3轮 | **中位数** | 占总时长 |
| --- | --- | --- | --- | --- | --- | --- |
| **spawn → `/health` ok（总）** | 进程起到第一次应答 | 536 | 567 | 561 | **561ms** | 100% |
| ├ `startup` | node 启动 + tsx 转译 + 模块求值 | 326 | 338 | 354 | **338ms** | **60%** |
| ├ `branchProbe` | git 分支探测（spawn 一次 git） | 14 | 13 | 13 | **13ms** | 2% |
| ├ `dbInit` | SQLite 开库 + 建表兜底（`createServiceStorage`） | 49 | 52 | 51 | **51ms** | 9% |
| ├ `registry` | 实例注册表（默认沙盒物化 + 副本清单） | 0 | 0 | 0 | **0ms** | 0% |
| ├ `bootService` | 组合根（core runtime + 执行环 + 世界态恢复 + agent 探测起跑） | 4 | 5 | 5 | **5ms** | 1% |
| ├ `listen` | HTTP + world-sync 端点挂上、端口开始听 | 7 | 7 | 6 | **7ms** | 1% |
| └ `totalUptime` | 进程内总计 | 400 | 415 | 428 | **415ms** | 74% |
| **（对照）生产 gateway spawn → `/health` ok** | `src/stratix-gateway/index.ts` 全量装配（MCP / dataStore / OpenClaw / 状态同步…） | 917 | 966 | 969 | **966ms** | — |

*prod 形态的独立复现采样*：`spawn → /health ok` = 799 / 586 / 564 ⇒ **中位数 586ms**；`startup` = 587 / 366 / 326 ⇒ **366ms**；
`dbInit` = 50 / 52 / 76 ⇒ **52ms**。两次采样同一量级（service 侧有 ~25ms 的机器噪声）。

**读法**

- service 冷启 = **561ms**，其中 **338ms（60%）是「把代码装进内存」**（node 冷启 + tsx 转译 + 模块求值），
  **只有 76ms 是真正的业务装配**（dbInit 51 + branch 13 + boot 5 + listen 7）；
- 561 − 415 = 146ms = 进程 spawn 往返 + 驱动侧 `/health` 首帧轮询 + READY 打印的差；
- **roster 物化不在开机链上**：`materializeInstanceRoster` 对默认沙盒直接 skip（沙盒不误伤），
  它只在**进非沙盒实例**时发生 ⇒ 实测 5ms（见 §4），**不是**开机瓶颈；
- 生产 gateway 比最小复刻多 **405ms**（966 − 561）⇒ 那些额外子系统是后端冷启的**第二根杠杆**（候选 2）。

---

## 3. 维度二 · 渲染侧（navigation → FCP → 首屏 → 战场 scene create）

### 3.1 dev 形态（vite dev server）

| 分段 | 第1轮 | 第2轮 | 第3轮 | **中位数** |
| --- | --- | --- | --- | --- |
| navigation `responseEnd`（HTML 到手） | 25.6 | 25.2 | 24.5 | **25.2ms** |
| `DOMContentLoaded`（273 个模块拉完 + 转译 + 求值） | 628 | 645 | 609 | **628ms** |
| **FCP**（首次内容绘制） | 644 | 660 | 624 | **644ms** |
| 主屏（`strat-status-screen` 挂载） | 626 | 643 | 607 | **626ms** |
| **首屏**（`strat-lobby-panel` 挂载） | 650 | 670 | 633 | **650ms** |
| 画布挂载（`canvas`） | 860 | 894 | 862 | **862ms** |
| **战场 scene create 完成** | 893 | 934 | 893 | **893ms** |
| 战场 scene create（点进沙盒那一次） | — | — | — | **—（不重建，见 §7 缺口 3）** |
| fx 素材 scene create 完成 | 933 | 971 | 927 | **933ms** |
| 页面错误 | 无 | 无 | 无 | — |

**读法**：dev 的最大段是 **模块图装载（25ms → 628ms = 603ms，占到 scene create 的 68%）**——
这是 **dev 专属开销**（273 个文件逐个 HTTP 往返 + 逐个现转译），用户拿不到。

### 3.2 prod 形态（生产产物 · vite preview）

| 分段 | 第1轮 | 第2轮 | 第3轮 | **中位数** |
| --- | --- | --- | --- | --- |
| navigation `responseEnd`（HTML 到手） | 15.0 | 6.8 | 7.2 | **7.2ms** |
| `DOMContentLoaded`（bundle 下载 + 顶层执行） | 300 | 236 | 230 | **236ms** |
| **FCP**（首次内容绘制） | 320 | 252 | 248 | **252ms** |
| 主屏（`strat-status-screen` 挂载） | 298 | 234 | 229 | **234ms** |
| **首屏**（`strat-lobby-panel` 挂载） | 573 | 494 | 491 | **494ms** |
| 画布挂载（`canvas`） | 525 | 454 | 451 | **454ms** |
| **战场 scene create 完成** | 548 | 473 | 469 | **473ms** |
| 战场 scene create（点进沙盒那一次） | — | — | — | **—（不重建，见 §7 缺口 3）** |
| fx 素材 scene create 完成 | 608 | 534 | 527 | **534ms** |
| 页面错误 | 无 | 无 | 无 | — |

**读法（prod 形态 = 用户实际拿到的那份代码）**

- **最大段 = 模块执行 + Phaser 启动**：DCL 236ms → 画布 454ms → 战场 scene create 473ms ⇒ 这 237ms 是
  「bundle 顶层执行 + Phaser 3 起 + 素材就位 + 场景建」；
- 首屏（大厅面板挂载）比 FCP 晚 **242ms** ⇒ **首屏在等大厅数据与卡片渲染**（world-sync 快照回来 + 面板渲染）；
- prod vs dev：**战场 scene create 893 → 473ms（-420ms，-47%）**、FCP 644 → 252ms（-392ms）。

---

## 4. 维度三 · 端到端（起 service + 起前端 → 页面可点进沙盒）

### 4.1 dev 形态

| 分段 | 第1轮 | 第2轮 | 第3轮 | **中位数** |
| --- | --- | --- | --- | --- |
| **spawn → 进沙盒成功（总，含浏览器起进程）** | 3515 | 2454 | 2425 | **2454ms** |
| ├ spawn → service `/health` ok | 536 | 567 | 561 | **561ms** |
| ├ spawn → vite READY | 1416 | 1210 | 1210 | **1210ms** |
| ├ 浏览器起进程（vite READY → 浏览器就绪） | 1009 | 134 | 134 | **134ms** |
| └ vite READY → 进沙盒成功 | 2099 | 1244 | 1215 | **1244ms** |
| ├ navigation → 大厅面板挂载 | 867 | 672 | 635 | **672ms** |
| └ 点「进入」→ `activeInstanceId` 变更（沙盒） | 122 | 116 | 126 | **122ms** |
| 　　└ 其中 service 侧（点击 → 裁决完） | 7 | 9 | 8 | **8ms** |
| 点「进入」→ 副本 B 生效（**含 roster 物化**） | 118 | 120 | 119 | **119ms** |
| 　　└ 其中 service 侧（含物化） | 5 | 6 | 5 | **5ms** |
| 退出副本 → 回到大厅 | 119 | 119 | 116 | **119ms** |

### 4.2 prod 形态

| 分段 | 第1轮 | 第2轮 | 第3轮 | **中位数** |
| --- | --- | --- | --- | --- |
| **spawn → 进沙盒成功（总，含浏览器起进程）** | 3803 | 2177 | 2081 | **2177ms** |
| ├ spawn → service `/health` ok | 799 | 586 | 564 | **586ms** |
| ├ spawn → preview READY | 1414 | 1210 | 1211 | **1211ms** |
| ├ 浏览器起进程（preview READY → 浏览器就绪） | 1375 | 138 | 120 | **138ms** |
| └ preview READY → 进沙盒成功 | 2389 | 967 | 870 | **967ms** |
| ├ navigation → 大厅面板挂载 | 576 | 504 | 498 | **504ms** |
| ├ 首启向导收场（prod 才出现，见 §7 缺口 4） | 113 | 84 | 78 | **84ms** |
| └ 点「进入」→ `activeInstanceId` 变更（沙盒） | 122 | 134 | 120 | **122ms** |
| 　　└ 其中 service 侧（点击 → 裁决完） | 5 | 30 | 5 | **5ms** |
| 点「进入」→ 副本 B 生效（**含 roster 物化**） | 119 | 119 | 117 | **119ms** |
| 　　└ 其中 service 侧（含物化） | 6 | 5 | 5 | **5ms** |
| 退出副本 → 回到大厅 | 117 | 119 | 118 | **119ms** |

### 4.3 端到端的口径修正（**必读**）

端到端这一格里有**两项 harness 自身的开销**，真实产品**没有**：

| harness 开销 | prod 中位数 | 说明 |
|---|---|---|
| 前端服务器冷启（vite dev / preview 起进程到 READY） | **625ms**（1211 − 586） | 真实产品的前端是**静态产物**（electron 直接 `file://` 加载），没有这一段 |
| 无头浏览器起进程 | **138ms** | 真实产品是 electron 窗口起进程，口径不同 |

⇒ **prod 的「真实产品冷启动」≈ 2177 − 625 − 138 = 1414ms**，分解为：

| 段 | 耗时 | 占真实冷启动 |
| --- | --- | --- |
| **service 进程冷启** | **586ms** | **41%** ← 最大段 |
| 页面加载 → 大厅可点（bundle 下载 + 执行 + Phaser + 大厅渲染） | 504ms | 36% |
| 首启向导收场 | 84ms | 6% |
| 点「进入」→ 生效（≈ 100ms 全是 world-sync 节流） | 122ms | 9% |
| 其它（轮询间隙等） | ~118ms | 8% |

---

## 5. 最大段结论

1. **最大段 = service 进程冷启（586ms / 41%）**，而它的内部最大段是**模块装载（338~366ms / service 的 60~62%）**——
   也就是「把代码装进内存」，**不是**业务逻辑。真正不可省的只有 **76ms**（dbInit 51 + branch 13 + boot 5 + listen 7）。
2. **渲染侧（prod）的最大段 = 模块执行 + Phaser 启动（237ms）**，其次是「FCP → 大厅面板挂载」的 242ms（在等数据与卡片渲染）。
3. **dev 与 prod 的差 = 420ms**（战场 scene create 893 → 473）⇒ **「用生产 bundle 而不是 dev server」本身就是最大的单点收益**，
   而它**已经落地**（`npm run build:frontend`），本单只是把它量化。
4. **roster 物化 5ms、DB init 51ms、git 分支探测 13ms** —— 量完就排除了，**都不是**瓶颈。
5. **唯一一处产品语义造成的延迟**：实例切换的可见延迟 = **122ms**，其中 **~100ms 是 world-sync 的 100ms 快照节流**
   （service 侧只花 5ms）⇒ 收益明确、改动面极小（§6 候选 1）。

---

## 6. 优化候选（本单只分析；候选 1 已由 PERF-02 / task_231 实施，见 §9）

### 候选 1 · world-sync 快照节流 100ms → 25ms（关键事件直发）—— **已实施**（PERF-02 / task_231 ⇒ §9）

| 项 | 内容 |
| --- | --- |
| **定位** | `src/stratix-gateway/api/websocket/world-sync/endpoint.ts:217`（`WORLD_SYNC_SNAPSHOT_THROTTLE_MS = 100`）+ `scheduleBroadcast()`（同文件 524~532 行）。端点已暴露 `snapshotThrottleMs` 选项 ⇒ 改口径不需要改协议、不需要改前端。 |
| **证据** | 点「进入」→ `activeInstanceId` 变更 = **122ms**，其中 service 侧裁决 **5ms** ⇒ **~100ms 是「等节流窗口」**（`scheduleBroadcast` 用 `setTimeout(throttleMs)` 排下一次广播 ⇒ 第一次变更也得等满一窗）。退出副本回大厅同样 **119ms**。 |
| **预期收益量级** | 每次实例切换 / 状态确认的可见延迟 **-75ms**（122 → ~45ms）；端到端「可点进沙盒」**-75ms**（prod 口径 1414ms 的 **5%**）。每次进出副本都省一遍。 |
| **风险** | **中低**。节流窗是防广播风暴的闸；单纯把窗口调到 25ms ⇒ 高频状态事件（`unit.position` 等）的广播频率 ×4。**建议改法**：位置类事件仍走 100ms 合并，只有「实例切换 / `project.changed`」这类**低频但关键**的变更走**立即广播**（首播不等窗口）⇒ 高频路径的广播量完全不变。协议面不变（有回执核对），前端零改动。 |
| **改动面** | **小**：1 个常量 + 端点里 1 条「关键事件直发」旁路（约 20~40 行）+ 1 个单测（节流行为：高频合并仍在、低频关键事件不等窗）。**不碰 core、不碰前端、不碰协议格式**。 |
| **验收口径** | 跑本单脚本（prod 三轮）看「点「进入」→ 生效」是否降到 ~40ms；再跑 QA harness 全量（world-sync 有回执核对，行为面应不变）。 |

### 候选 2 · 后端子系统懒加载 + 渲染侧拆包 / 延后 Phaser —— **独立分支（改动面 ≥3 万行量级）**

| 项 | 内容 |
| --- | --- |
| **定位** | ① `src/stratix-gateway/index.ts` 的全量装配（比最小复刻多 **405ms**：MCP / dataStore / OpenClaw / 状态同步等）；② 渲染侧 `src/app/main/main-entry.ts` 的 `new Phaser.Game({...})` 装配 + `vite.config.ts` 的分包（当前 **main 959kB + phaser 1208kB** gzip 后 288 + 330kB ⇒ 已超 `docs/PERFORMANCE_GUIDELINES.md` 的 500KB/chunk 线）。 |
| **证据** | prod 渲染侧：Phaser 起 + 素材 + 场景建 = **237ms**（DCL 236 → scene create 473）；首屏在 FCP 之后还要 **242ms** 才把大厅面板挂上。 |
| **预期收益量级** | 后端冷启 **-200~400ms**（把「非首屏必需」的子系统挪到 `/health` 应答之后起跑）；首屏 **-200ms 量级**（拆包 + Phaser 延后/按需加载）。两项合计可把「真实产品冷启动」从 1414ms 压到 **~900ms 量级**。 |
| **风险** | **中高**。改的是**装配语义**而不是行数：① 后端有些子系统要求 world / store 已就绪，延后要逐个确认「首帧前必须就绪」的白名单；② 渲染侧延后 Phaser 要处理「快照先到、场景后建」的状态回放与「输入早到」的排队 —— 这会碰 world 层**零 DOM**铁律的边界。 |
| **改动面** | **大**。触及 `src/world`（**28.7k 行**）+ `src/app`（**52.3k 行**）的装配根与 vite 分包配置 ⇒ **改动面 ≥3 万行量级、且改的是核心装配语义 ⇒ 按规矩走独立分支 + 全量回归**，不进本轮。 |
| **明确** | **本轮不做**，只登记。 |

> **关于「≥3 万行需独立分支的大改」这条门槛的口径**：本仓库 `src/` 合计 233k 行，
> 单层规模为 `src/app` 52.3k / `src/world` 28.7k / `src/stratix-gateway` 26.2k 行。
> 候选 2 之所以归到「独立分支」，**不是因为它有 3 万行 diff**，而是因为它同时满足两条：
> 改动面跨 `world` + `app` 两层（≥3 万行量级）**且**改的是装配语义（需要全量回归 + 独立分支的验证节奏）。
> 候选 1 则是典型的**小链条**：单文件、常量级、能在本轮内测完。

---

## 7. 已知缺口 / 偏差（**读数前必读**）

| # | 缺口 / 偏差 | 影响 | 下一链怎么办 |
| --- | --- | --- | --- |
| 1 | **service 侧是 `tsx` 起的**（开发期口径）。生产打包的后端是 `tsc` 产物，不走现场转译。 | §2 的 338ms「模块装载」在真实产品里会显著缩水 ⇒ 候选 2 的收益量级是**上界**。 | 量一次 **electron 打包产物**的后端冷启（`dist/` 里跑），把开发期口径与产品口径分开记。 |
| 2 | 端到端里的**前端服务器冷启（625ms）+ 无头浏览器起进程（138ms）**是 harness 自身的开销，真实产品没有。 | 端到端总时长（2177ms）**不能**直接当产品指标。 | §4.3 已扣掉；下一链应改用「electron 起进程 → 窗口可点」的口径。 |
| 3 | **点进沙盒时战场 scene 不重建**（`sceneCreateAfterEnterMs` 恒为 null）—— 已知 GAP-01：`project.changed` 不在 world-sync 的下行白名单里。 | 「scene create」只能量到**开机那一次**；实例切换的渲染侧延迟只能量到状态生效（122ms）。 | 修 GAP-01（把 `project.changed` 加进下行白名单）后重测——那会顺带影响 §6 候选 1 的收益口径。 |
| 4 | **prod 形态出现了首启向导（dev 形态没有）**，多付 ~84ms 收场。 | 只影响「点进沙盒」这一段（prod 端到端 +84ms），不影响 FCP / scene create 两段口径。 | 已在本单隔离出来单列；成因未查（可能是 dev 态该组件是懒加载 chunk）。 |
| 5 | fx 素材输入**两侧不同构**：dev 用仓内快照（`assets/fx/`，6 个基础变体），prod 用发布期烘焙（24 个 atlas，含 2 套皮肤 + 变体）。 | fx scene create 在 battlefield scene create **之后 40~61ms** ⇒ 不影响关键段结论。 | 若下一链要单独量 fx 链，两侧必须统一输入。 |
| 6 | 首轮 `browserLaunch` 有 ~1s 离群（磁盘缓存冷），另有两轮 `onboardingMs` ~275ms（dev 形态下向导没出现，那段只是定位器等待）。 | 中位数口径已吸收；`onboardingMs` 在 dev 形态下**无意义**。 | — |
| 7 | 三次采样只能分辨**几十毫秒级**差异；本单的候选 1 收益（75ms）刚好在可分辨边缘。 | 候选 1 实施后需要**更多轮次**（≥9 轮）才能确认。 | 下一链给候选 1 配一组「9 轮 + 前后对照」的复测脚本。 |

---

## 8. 复跑方式

```bash
# ① dev 形态（vite dev server）—— 约 3 分钟
node e2e-tests/perf-baseline.e2e.mjs --mode dev  --runs 3 --out /tmp/perf-dev.json

# ② prod 形态（生产产物）—— 先构建（约 3 分钟）再量（约 3 分钟）
node e2e-tests/perf-baseline.e2e.mjs --mode prod --runs 3 --build --out /tmp/perf-prod.json
```

脚本行为（详见 `e2e-tests/perf-baseline.e2e.mjs` 文件头）：

- **端口动态挑**：vite 7600-7699 / service 7800-7899，**显式避开** 7523 / 7524 / 7525 / 9222；
- **临时 DATA_DIR**：`os.mkdtemp()` ⇒ 一个字节都不写进用户的仓 / 库；每轮结束按 pid 精确回收进程 + 删临时目录；
- **不碰用户实例**：代理目标一律指向本轮自己的 service 端口；
- **零产品改动**：场景 create 的打点是 vite 侧注入的（`e2e-tests/perf-baseline/scene-marks.ts`），
  仓库 `src/**` 一个字节都没改。

配套文件：

| 文件 | 职责 |
| --- | --- |
| `e2e-tests/perf-baseline.e2e.mjs` | 驱动脚本（三个维度 × N 轮，出 markdown 表 + JSON） |
| `e2e-tests/perf-baseline/perf-service-process.ts` | 被测 service 进程（**分段掐表**版） |
| `e2e-tests/perf-baseline/vite-server.ts` | 被测渲染层（dev 形态） |
| `e2e-tests/perf-baseline/preview-server.ts` | 被测渲染层（prod 形态） |
| `e2e-tests/perf-baseline/perf-build.ts` | 生产构建（带同一份打点注入） |
| `e2e-tests/perf-baseline/scene-marks.ts` | 场景 create 打点注入器（dev / prod 共用同一份） |

---

## 9. 优化后对照（PERF-02 / task_231 —— §6 候选 1 已实施）

> 本节是**优化链第 2 环**的落地记录：§6 候选 1 已实现并复测（HEAD `0553ff7` + 本节改动）。
> 实施内容（改动面 = 1 个常量 + 1 条旁路，全在 gateway 侧，core / world / hud / 协议零改动）：
>
> ① `WORLD_SYNC_SNAPSHOT_THROTTLE_MS`：**100ms → 25ms**（`src/stratix-gateway/api/websocket/world-sync/endpoint.ts`）；
> ② **关键事件旁路**：`进副本 / 退副本 / 单位上场 / 单位移除`（= 状态面里「激活实例」或「单位集合」
>    这两处**结构**变了）**不等节流窗**，立刻发一帧快照；高频变化（提示 / 选择 / 任务相位…）照旧按 25ms 合并。
>    判定在 **gateway 侧**（core 零 IO 铁律：时延策略是传输层的事，core 只管状态对不对）。
>
> 复测口径与 §1.3 完全一致（同一个 `e2e-tests/perf-baseline.e2e.mjs`，各 3 轮取中位数）：

```bash
node e2e-tests/perf-baseline.e2e.mjs --mode dev  --runs 3 --out /tmp/perf-after-dev.json
node e2e-tests/perf-baseline.e2e.mjs --mode prod --runs 3 --build --out /tmp/perf-after-prod.json
```

### 9.1 关键段前后对照（中位数）

| 段 | 形态 | 优化前（§4） | **优化后** | 变化 |
| --- | --- | --- | --- | --- |
| **点「进入」→ `activeInstanceId` 变更（沙盒）** | dev | **122ms** | **24ms** | **-98ms** |
| 同上 | prod | **122ms** | **35ms** | **-87ms** |
| 点「进入」→ 副本 B 生效（**含 roster 物化**） | dev | 119ms | **19ms** | -100ms |
| 同上 | prod | 119ms | **19ms** | -100ms |
| 退出副本 → 回到大厅 | dev | 119ms | **20ms** | -99ms |
| 同上 | prod | 119ms | **16ms** | -103ms |
| └ 其中 service 侧裁决 | dev / prod | 5~8ms | **5ms** | 不变（裁决没动，动的是「裁决完到客户端看见」） |

**逐轮原始值（优化后）**

| 形态 | 段 | 第1轮 | 第2轮 | 第3轮 | 中位数 |
| --- | --- | --- | --- | --- | --- |
| dev | 点「进入」→ 沙盒生效 | 45 | 24 | 14 | **24ms** |
| dev | 点「进入」→ 副本 B 生效 | 24 | 18 | 19 | **19ms** |
| dev | 退出副本 → 回大厅 | 20 | 18 | 26 | **20ms** |
| dev | service 侧裁决（副本 B） | 6 | 5 | 5 | **5ms** |
| prod | 点「进入」→ 沙盒生效 | 8 | 36 | 35 | **35ms** |
| prod | 点「进入」→ 副本 B 生效 | 20 | 19 | 19 | **19ms** |
| prod | 退出副本 → 回大厅 | 7 | 19 | 16 | **16ms** |
| prod | service 侧裁决（副本 B） | 5 | 5 | 5 | **5ms** |

**目标达成**：验收目标「点进入→生效 ≤50ms」⇒ dev **24ms** / prod **35ms**，**达标**（基线 122ms）。

### 9.2 读法与口径边界（别过度解读）

- **归因只认关键段**：本单只动 world-sync 的快照节流 ⇒ 归因落在「点进入→生效 / 副本 B 生效 / 退出回大厅」
  这三段（-87 ~ -103ms，与「等一窗 100ms」同量级 ✓）。
- **端到端总时长不归因**：dev「spawn→进沙盒成功」2454 → 2171ms、prod 2177 → 1647ms，
  掉的幅度**大于**关键段的 -87ms ⇒ 那部分来自机器状态与轮次噪声（浏览器起进程离群、磁盘缓存冷），
  **不是**本次改动的功劳。故 §4.3 的「真实产品冷启动 ≈ 1414ms」应理解为「再减 ~90ms」，
  而不是按端到端总时长的落差折算。
- **3 轮够用**：§7 缺口 7 说「几十毫秒级差异需 ≥9 轮」—— 本次的差是 **~90ms**（远大于噪声），
  且三轮**方向一致**（三轮全部 <50ms，优化前三轮全部 ≈120ms）⇒ 3 轮即可判定。
- **prod 的 35ms 里含客户端轮询粒度**：页面用 `waitForFunction`（raf 轮询，≈16ms/次）观测
  `activeInstanceId` ⇒ 端到端测得值含最多 ~16ms 的观测误差；真实生效时刻比这更早。
- **未变的东西**：service 侧裁决仍 5ms（core 没动）；战场 scene create（进沙盒那一次）仍为 `—`
  （GAP-01 未修：`project.changed` 仍不在下行白名单，见 §7 缺口 3）。

### 9.3 这一环的副作用（已核对）

| 副作用 | 核对结论 |
| --- | --- |
| 高频事件的广播量 | **不变**：高频路径仍走 25ms 合并窗（单测②：5 次变更 ⇒ 1 帧）。窗口 100→25 会让**纯表现态**变更的广播频率上限 ×4，但实测链路上这类变更极少（`unit.position` 走 `event.push` 事件面，不进快照面）。 |
| 切副本的中间帧 | 结构变化会**多发一帧**（换实体 + 改激活实例是两拍 ⇒ 两帧）。中间帧是「B 的实体 + 旧的激活实例」，world 桥接层按 `activeInstanceId` 做 scope 过滤（`world/bridge/bus-adapter.ts`）⇒ 该帧的单位**不会**被渲染 ⇒ 无可见闪烁。 |
| 协议 / 前端 | **零改动**：协议消息型与字段没变，前端零改动。 |
