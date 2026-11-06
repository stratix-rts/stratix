# e2e-tests —— CDP 走查脚本

用 **Chrome DevTools Protocol** 直连运行中的 Stratix Electron 页面，做无人值守的 e2e 走查：
看世界状态、给角色派单、跑通一条战场任务（mission）全链。

脚本是**纯 JS（.mjs）**，只用 node 内置的 `fetch` / `WebSocket`，不引 npm 依赖、
不进 `tsc` 编译（见下方「与构建体系的关系」）。它们驱动的是**真实运行实例**，
不是 mock —— 命令经页面里的 HUD adapter 走真实的 core 命令通道落库。

---

## 目录

```
e2e-tests/
├── lib/cdp.mjs   # 公共封装：连页面 + Runtime.evaluate helper（走查探针共用）
├── lib/service-harness.mjs     # 公共封装：起服务 / 断言 / 回收 pid / MCP 调用 / world-sync 观察
├── probes/                      # **走查探针**（驱动已在跑的实例；QA-04 归整：探针脚本独立成目录）
│   ├── probe.mjs     # 连接探测 + 世界状态快照（角色 / 单位 / 任务 / 使命）
│   ├── assign.mjs    # 向指定角色派单，轮询至任务终态
│   └── mission.mjs   # mission 全链：create → confirm accept → 带 missionId 派单 → 轮询到收尾
├── service-resident.e2e.mjs           # **自起自收**的总验收剧本（服务常驻 / Electron 可选）
├── service-resident/fake-cli.ts        # fake CLI adapter（执行替身；--real 可切真 claude）
├── service-resident/service-process.ts # service 进程启动器（tsx 直跑）
├── session-domain.e2e.mjs             # **会话域验收剧本**（互聊超时 → 可见可查）
├── session-domain/session-capabilities.e2e.mjs # **会话域六能力验收剧本**（resume/fork/task_run/…）
├── session-domain/peer-cli.ts          # 静默 CLI adapter（互聊超时制造机）
├── session-domain/service-process.ts   # service 进程启动器 + 互聊夹具（tsx 直跑）
├── m0-project-context.e2e.mjs         # **M0 端到端验收剧本**（项目块 + cwd + 库零变化）
├── m0-project-context/fake-cli.ts     # 回报所见（prompt + cwd）的 CLI adapter（执行替身）
├── m0-project-context/service-process.ts # 生产组合根（真 service）+ 真派单（tsx 直跑）
├── m0-project-context/schema-baseline.ts  # 「M0 前」的库结构基线快照程序
├── m1-instance-switch.e2e.mjs         # **M1 端到端验收剧本**（切副本零残留 / 切回数据还在）
├── m1-instance-switch/instance-switch-process.ts # 战场侧进程脚本（seed / switch 两阶段）
├── m1-instance-switch/fake-cli.ts     # fake CLI adapter（替身）
├── m1-instance-switch/tsconfig.json   # 把 `phaser` 映射到桩模块（node 里跑不了真 Phaser）
├── m2-end-to-end.e2e.mjs              # **M2 端到端验收剧本**（双副本隔离 + 容量 + 回滚演练）
├── m2-end-to-end/m2-scenario.ts       # M2 五组能力观测进程（临时库真跑，写 JSON 报告）
├── qa-full-flow.e2e.mjs               # **QA-01 全流程验收剧本**（冷启动 → 进副本 → 选中/移动 → 派单 → 切副本 → 回大厅）
├── qa-full-flow/qa-service-process.ts # QA-01 的 service 进程装配
├── qa-full-flow/vite-server.ts        # QA-01 的 vite dev server（代理到本次验收自己的 service）
├── demo-flow.e2e.mjs                  # **演示收口剧本**（派活 → 框选 → 特效 → 回放 60s）
├── demo-flow/fake-claude.mjs          # 本地模式的假 claude 二进制（替身）
├── fixtures/                          # **入库夹具**：各场景的最小 `.stratix` 契约面
│   ├── m0-project/  m1-instance-b/  m2-instance-a/  m2-instance-b/
├── lobby-empty-card/                  # **大厅空卡探针**（task_213 / M2-12）：快照探针 + DOM 探针（详见其 README）
└── README.md
```

> **目录约定（QA-04 / task_224 归整）**
>
> - **探针脚本独立成目录**：驱动「已经在跑的实例」的走查探针（`probe` / `assign` / `mission`）
>   归在 `probes/`；与某个剧本绑定的探针留在该剧本目录内（如 `lobby-empty-card/`）。
> - **每个剧本 = 一个顶层驱动（`*.e2e.mjs`）+ 一个同名目录**（夹具 / helper / 替身）。
>   驱动与它的 helper **永远同处一个顶层**，避免「哪个 helper 属于哪支剧本」要靠猜。
> - **`lib/` 与 `fixtures/` 是横切面**：前者是公共封装，后者是入库夹具 —— 不属于任何一支剧本。

## 前置条件

1. **Node ≥ 22**（脚本要用全局 `fetch` / `WebSocket`；仓库本身要求 Node 23，见 `CLAUDE.md`）。
2. **Stratix 正在运行，且 Electron 开了远程调试端口 9222**。
   `npm run electron:dev` **不开**这个端口 —— 要么改用下面的分进程启动法，要么给
   `electron` 命令追加 `--remote-debugging-port=9222`。

   分进程启动（三个终端，或 `&` 后台）：

   ```bash
   # ① backend（gateway，默认 7524 / WS 7525）
   npm run dev:backend

   # ② frontend（vite，7523）
   npm run dev:frontend

   # ③ electron（先编译再起；--remote-debugging-port 是 Chromium 开关，直接透传给 electron）
   npm run build:electron
   npx electron . --config electron.config.json --remote-debugging-port=9222
   ```

3. 端口校验：

   ```bash
   curl -s http://127.0.0.1:9222/json/list | head -20   # 应看到 title 为 "Stratix v3" 的 page
   ```

## 用法

三个脚本输出约定一致：**stdout 出 JSON**（可 `| jq`），**stderr 出过程日志**（人读）。
退出码：`0` = 走查达成预期；`1` = 未达成 / 异常；`2` = 参数用法错。

| 脚本 | 用法 | 作用 |
|------|------|------|
| `probe.mjs` | `node e2e-tests/probes/probe.mjs` | 连接探测 + 打印世界状态 JSON（角色 / 单位 / 任务 / 使命 / 通知 / 检出 agent） |
| `assign.mjs` | `node e2e-tests/probes/assign.mjs <characterId> [prompt]` | 向指定角色派一单，轮询到任务终态（completed → 退出码 0） |
| `mission.mjs` | `node e2e-tests/probes/mission.mjs [characterId] [prompt]` | mission 全链闭环（mission 到 `done` → 退出码 0） |

> ⚠️ **路径已变（QA-04 / task_224 归整）**：这三个走查探针从 `e2e-tests/` 顶层移到了
> `e2e-tests/probes/`。旧路径（`node e2e-tests/probe.mjs`）**不再存在** ——
> 走查探针归到目录，是为了让「顶层 = 剧本」这条约定不留例外。

角色 id 用 `probe.mjs` 查（`characters[].id`）。`mission.mjs` 省略角色时自动挑一个
「已建档且场上有对应单位」的角色 —— mission 必须指派到在场的单位才成立。

## 剧本：service-resident.e2e.mjs（服务常驻 / Electron 可选）

前面三个脚本是**走查**：它们驱动一个已经在跑的实例。
`service-resident.e2e.mjs` 是**验收剧本**：它自己拉起 service 与 Electron、自己断言、自己收干净 ——
一条命令跑完「壳关了 agent 照常干活 → 壳拉起来视图恢复 → 壳重启状态无损」全链。

```bash
node e2e-tests/service-resident.e2e.mjs          # 默认：fake CLI adapter（确定性，不花 token）
node e2e-tests/service-resident.e2e.mjs --real   # 切真 claude（慢、要花钱、结果不确定）
node e2e-tests/service-resident.e2e.mjs --keep   # 保留临时目录（排查用）
```

**它做了什么**（断言逐条打印在末尾的「验收摘要」里，20 条）：

1. 起 **service**（gateway 单进程：执行环 + 存储 + HTTP/MCP + world-sync 端点）；
2. 经 **MCP** `stratix_world_snapshot` 断言真实 units 非空；
3. `stratix_task_assign`（执行走 **fake CLI adapter**）→ task completed → **mission done**；
4. 断言这一段**全程无 Electron 参与**（service 进程树里没有 Electron 子进程）；
5. 拉起 **Electron 远程模式**（`STRATIX_REMOTE=1` + `STRATIX_WORLD_SYNC_URL`）→ 断言视图恢复
   （world-sync 快照到达页面，units / tasks / missions 可见）；
6. **kill Electron → 再拉起** → 断言状态无损（seq 续推、无重复 mission / task）；
7. 收干净：只杀**自己拉起的 pid**（连同其后代树），退出后不留孤儿。

**端口与进程纪律**（与用户的 dev 实例共存，不碰它）：

| 角色 | 端口 | 说明 |
|------|------|------|
| service（HTTP / MCP / world-sync） | `7797` | `SX_SERVICE_PORT` 可改 |
| service 状态同步 WS | `7798` | `SX_WS_PORT` 可改 |
| Electron 远程调试（CDP） | `7799` | `SX_CDP_PORT` 可改 |
| 本剧本自己的 vite dev server | `7601` | `SX_VITE_PORT` 可改 |

- **不碰** 7523 / 7524 / 9222（用户的 dev 实例占着）：本剧本一个都不用，Electron 壳靠
  `STRATIX_DEV_SERVER_URL` 显式指址到自己的 vite，而不是「谁占着 7523 就连谁」；
- **不按进程名扫杀**（不 pkill / pgrep electron）：收尾只按**剧本自己记下的 pid** 精确回收，
  连同它的后代树 —— 按名扫杀会误杀用户正在跑的 Electron 实例；
- Electron 壳带 `--user-data-dir=<临时目录>`：不碰用户的 Electron 数据目录；
- service 的数据目录也是临时目录（每次跑都是干净世界 → 可重复执行）。

**唯一替身**：fake CLI adapter（`service-resident/fake-cli.ts`）只替掉**最末端那一跳**
（把真 claude 换成「node 回显 prompt」）—— core 的裁决、队列、相位、mission 回报全是真链路。

## 剧本：session-domain.e2e.mjs（会话域验收）

v3.2a 会话域（S1~S6）的**收口验收**：一条命令跑完「互聊开场 → 回合超时 →
会话显式 interrupted → 事件历史可查 → 面板数据源含 sessions」全链。

```bash
node e2e-tests/session-domain.e2e.mjs          # 替身模式（确定性，不花 token）
node e2e-tests/session-domain.e2e.mjs --keep   # 保留临时目录（排查用）
```

**它做了什么**（断言逐条打印在末尾的「验收摘要」里，20 条）：

1. 起 **service**（gateway 单进程：执行环 + 存储 + HTTP/MCP + world-sync 端点）；
2. 建两个角色（真命令 `character.create` 落地），等本地 CLI 探测出可用 agent；
3. 开一场互聊 → **MCP `stratix_session_list`** 看得见 `peer_chat` 且 `active`；
4. 制造**回合超时**（静默 CLI 替身：子进程真跑、真的不吭声）→ 会话显式转 **`interrupted`**，
   并落一条带原因的 `interrupt` 事件（`timeout：调用超时，已终止进程`）；
5. **MCP `stratix_session_get`** 读事件流：`created → message（议题）→ interrupt` 齐全；
6. **REST `GET /api/storage/sessions/:id/events`** 分页读同一段历史：全量页中断前后齐全、
   窗口页取到最新两条、游标页（`beforeSeq`）翻到更早的 `created`；
7. 派一单跑完 → **`task_run` 会话随终态 `closed`**（LITE 口径：只记 `created` + `closed`）；
8. **world-sync 快照含 `sessions`**（HUD 会话面板的数据源 —— 快照断言即面板输入面，**不开 Electron**）；
9. 收干净：静默子进程已被看门狗收掉、只杀**自己拉起的 pid**，退出后不留孤儿。

**唯一替身**：两个 CLI adapter，都只替掉**最末端那一跳**（CLI 二进制）——
① `service-resident/fake-cli.ts`（echo 型，派单用）；
② `session-domain/peer-cli.ts`（**静默型**，互聊用：子进程跑着但不输出任何字节）。
超时判定 / 杀进程树 / 错误码（`timeout`）/ 中断记账 / 会话状态迁移**全是真链路**
（`session-domain/peer-cli.ts` 只制造「一直不输出」这个前提，不自己判超时）。

**互聊夹具**：互聊编排服务住在渲染进程（抽屉 DOM 在那儿），headless 的 service 进程里没有它 ——
`session-domain/service-process.ts` 按**生产口径**把它装起来（视图口给记录型空实现，
执行环给静默 adapter，会话写入面绑**同一份 store + 同一个库连接**），
并挂一条**测试专用**路由 `POST /e2e/peer-chat` 供剧本触发互聊。
其余一切（MCP / REST / world-sync）都走产品口径。

**端口与进程纪律**（与 `service-resident.e2e.mjs` 同一套公用封装 `lib/service-harness.mjs`）：

| 角色 | 端口 | 说明 |
|------|------|------|
| service（HTTP / MCP / world-sync） | `7817` | `SX_SERVICE_PORT` 可改 |
| service 状态同步 WS | `7818` | `SX_WS_PORT` 可改 |

- **不碰** 7523 / 7524 / 9222（用户的 dev 实例占着）；
- **不按进程名扫杀**：收尾只按**剧本自己记下的 pid** 精确回收，连同其后代树；
- 数据目录是临时目录（每次跑都是干净世界 → 可重复执行）；
- 端口占用先查再用，撞上用户端口直接拒绝开跑。

## 剧本：m0-project-context.e2e.mjs（M0 端到端验收）

`docs/DESIGN-workspace.md` §8「M0-08」行的**收口验收**：在**含 `.stratix` 的目录**里真派一单，
断言三件事 —— ① prompt 含 `<stratix-project>` 项目块（含来源声明行）；② 子进程 cwd == 项目根；
③ **数据库零变化**（库结构与 M0 前逐字节一致，零 DDL）。

```bash
node e2e-tests/m0-project-context.e2e.mjs          # 替身模式（确定性，不花 token）
node e2e-tests/m0-project-context.e2e.mjs --keep   # 保留临时目录（排查用）
```

**它做了什么**（断言逐条打印在末尾的「验收摘要」里，17 条）：

1. 把入库夹具 `fixtures/m0-project/`（最小 `.stratix` 契约面）拷进临时目录 —— 那个目录就是**项目根**；
2. 用 `git archive` 展开 **M0 前**那个提交（M0-01 的父提交）的代码树，用**那棵树里的代码**建一次库、
   抄一次 `sqlite_master` ⇒ 「与 M0 前一致」是可复算的事实，不是断言文案；
3. 起**生产组合根**（`createStratixService` + service 侧执行环），在项目根派一单：
   core 总线派单 → task-service 拼 prompt → cli-transport **真拉子进程** → 子进程回报 →
   任务收尾 → **真落库**（`character_tasks` / `sessions`）；
4. 从**库里**把子进程的回报捞出来断言（完整往返，不是单点）：
   - ① 项目块在 prompt 里、开闭标签成对、含来源声明行、内容与契约一致
     （项目名 / id / 角色 / 默认角色 / 并发上限 / 指令文件）、位置在「角色设定之后、任务指令之前」、
     独立标签（不在 `<stratix-context>` 内）；
   - ② 子进程回报的 cwd（realpath）== 项目根；
   - ③ 派发全程 **零 DDL**（`sqlite_master` 逐字节一致 + `PRAGMA schema_version` 未变），
     且本轮库结构与 **M0 前基线**逐字节一致；
5. 收干净：临时目录删掉（`--keep` 保留），不留进程、不碰用户的库。

**唯一替身**：CLI 二进制（`m0-project-context/fake-cli.ts`）—— 它只回报「我看到的 prompt 与 cwd」，
超时判定 / 杀进程树 / 事件流 / 落库全是真链路。

**两处注入**（都是生产里本来就有的接缝）：项目根与 cwd 由验收脚本按「活跃实例注册表」（S6b，
尚未落地）的形状给值；被验的是「值一旦给对，派发链会不会把它带到 prompt 与子进程 cwd 上」。

**端口与进程纪律**：本剧本**不监听任何端口**（不起 HTTP/WS 服务），只 spawn 短命子进程，
故不与 7523 / 7524 / 9222 冲突；数据目录是临时目录（可重复执行）。

## 剧本：m1-instance-switch.e2e.mjs（M1 端到端验收 · 切副本零残留）

`docs/DESIGN-project-map.md` §7.1「M1-16」行的收口验收：进默认沙盒造数据 → 切到第二个副本 →
断言**无残留** → 切回 → 断言数据**还在**（是被换回来，不是被清空）。

```bash
node e2e-tests/m1-instance-switch.e2e.mjs          # 默认：替身模式（确定性）
node e2e-tests/m1-instance-switch.e2e.mjs --keep    # 保留临时目录（排查用）
```

**三条断言**：① 切副本不串数据（单位表空 / 地图槽归零 / 站位种子键分家）；
② 切回后旧数据完整；③ 零 DDL（库结构与 M1 前逐字节一致 —— 「M1 前」靠 `git archive`
把那个提交展开成临时代码树**用那棵树建一次库**取基线，不是嘴说）。

**为什么要两个进程**：站位种子是**启动读档**时写进键仓的 ⇒ 同一进程里造完再切副本，
读档那一步根本没发生，种子分区无从验。分进程 = 真重启一次，走**生产代码**的读档链。

**夹具**：`fixtures/m1-instance-b/`（第二个副本的最小 `.stratix` 契约面），跑时整份拷进临时目录。

## 剧本：m2-end-to-end.e2e.mjs（M2 端到端验收 · 双副本隔离 + 容量 + 回滚）

M2（多副本落库维度）的收口验收：在**临时库**上真跑五组能力，观测值写成 JSON 报告，
**断言在驱动层**（进程层只如实回报所见 —— 进程层自己判「通过」，失败会被吞掉）。

```bash
node e2e-tests/m2-end-to-end.e2e.mjs          # 默认：替身模式（确定性）
node e2e-tests/m2-end-to-end.e2e.mjs --keep    # 保留临时目录（排查用）
```

**五组观测**：① **副本间数据隔离**（characters / tasks / sessions / events 互不可见，
COALESCE 命中口径正确）；② **容量上限生效**（每 instance 64 角色 / 全局 512 /
session_events 每会话 512 + 每 instance 4096 ⇒ 滚动归档到 `history/`）；
③ **N4b 校验脚本可重跑**；④ **回滚矩阵演练**（校验失败 ⇒ 自动回滚）；
⑤ **N7 归属迁移**（预览 → 执行 → 撤销 闭环）。

**夹具**：`fixtures/m2-instance-a/` 与 `fixtures/m2-instance-b/`（两个真副本的最小契约面）。

## 剧本：qa-full-flow.e2e.mjs（QA-01 全流程验收）

v3.3 QA 轮的总验收：**真浏览器（Playwright）+ 真 vite dev server + 真 service 进程 +
真 world-sync 协议 v3 + 真 core 裁决 + 真 CLI 子进程**（PATH 上的假 claude = 桩进程）。

```bash
node e2e-tests/qa-full-flow.e2e.mjs          # 默认：替身模式（确定性）
node e2e-tests/qa-full-flow.e2e.mjs --keep    # 保留临时目录（排查用）
```

**断言链**：冷启动（连上 / 首份快照 / 大厅面板挂载 / `activeInstanceId` 显式 null）→
进副本（裁决 / 面板退场 / **仪式画出来**）→ 选中（真点击 → `selection.unitIds` 长度 1 /
revision 递增）→ 移动（右击 → `unit.move` 上行 → **下行 `event.push(unit.position)`** →
像素级证明是补间不是瞬移）→ 派单（queued → running → completed）→ 切副本 → 回大厅。

**三条硬纪律**：① **不碰用户实例**（端口在备用段里动态挑并显式避开 7523/7524/7525/9222；
数据全在 `os.tmpdir()` 下，**一个字节都不写进用户的仓 / 库**）；
② **可重跑**（每次新建临时目录 + 新端口探测 + 收尾按 pid 精确回收；断言只看观测值）；
③ **失败如实定位到层**（每条断言挂在环节上，末尾输出**缺口清单**）。

**已记账的缺口（本轮不改码）**：GAP-01 进副本仪式在**远程模式**下不演（差的是
「service 广播 → 客户端收到」这一跳）；GAP-02 副本内没有「退出副本 / 切副本」的界面出口。

## 剧本：demo-flow.e2e.mjs（演示收口剧本）

`docs/DEMO-PLAN.md` §11 的收口：把演示链「派活 → 框选 → 指令特效 → 干活动画 → 卡住 →
集火 → 完成插旗 → 区域点亮 → 里程碑 → 回放 60s」在**假 CLI** 下真跑一遍。

```bash
node e2e-tests/demo-flow.e2e.mjs            # 默认：fake CLI（确定性）
node e2e-tests/demo-flow.e2e.mjs --keep     # 保留临时目录（排查用）
SX_DEMO_PHASES=A,B node e2e-tests/demo-flow.e2e.mjs   # 只跑某几段（排查用）
```

**三段拓扑**（这一条链在三种形态里各跑一半，理由写在剧本文件头）：A 段走 dev 验收页
（卡住体态 / 集火在生产应用里不可达）；B 段走生产入口**本地模式**（任务生命周期事件由渲染进程
自己的 core 发出，远程模式听不到）；C 段走生产入口**远程模式**（回放读口基址由 world-sync
地址换协议得出，本地模式写死的是用户端口）。

**替身只落在最末端那一跳**：本地模式的 PATH 上的 `claude` 二进制 → `demo-flow/fake-claude.mjs`；
远程模式的 service 侧注入既有 fake CLI adapter。core 的裁决 / 队列 / 相位 / 落库全是真链路。

## 剧本：session-domain/session-capabilities.e2e.mjs（会话域六能力验收）

v3.2b-B9 的六项能力逐条落成可重复执行的剧本：resume / fork / task_run 全量事件化 /
长会话压缩 / @会话引用 / 自动起名。

```bash
node e2e-tests/session-domain/session-capabilities.e2e.mjs          # 默认：替身模式（确定性）
node e2e-tests/session-domain/session-capabilities.e2e.mjs --keep    # 保留临时目录（排查用）
```

**与老剧本（`session-domain.e2e.mjs`）的关系**：两支共用同一个 service 夹具
（`session-domain/service-process.ts`）与同一套进程纪律；本剧本**另起端口、另起数据目录**，
故可与老剧本各自独立跑、互不干扰。

> ⚠️ **路径已变（QA-04 / task_224 归整）**：本剧本原在 `e2e-tests/` 顶层，
> 现归到 `e2e-tests/session-domain/` —— 它复用的正是该目录里的 service 夹具与 peer CLI。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `CDP_BASE` | `127.0.0.1:9222` | CDP 调试端口（换端口 / 换机器时用） |
| `SX_POLL_INTERVAL_MS` | `3000` | 轮询间隔 |
| `SX_TIMEOUT_MS` | `300000` | 轮询超时（5 分钟） |
| `SX_SERVICE_PORT` | `7797`（`service-resident`）/ `7817`（`session-domain`）/ `7827`（`session-capabilities`） | 剧本自己的 service 端口 |
| `SX_WS_PORT` | `7798`（`service-resident`）/ `7818`（`session-domain`）/ `7828`（`session-capabilities`） | 剧本自己的状态同步 WS 端口 |
| `SX_CDP_PORT` | `7799` | 剧本自己的 Electron 调试端口 |
| `SX_VITE_PORT` | `7601` | 剧本自己的 vite dev server 端口 |
| `SX_DEMO_VITE_PORT` / `SX_DEMO_SERVICE_PORT` / `SX_DEMO_SERVICE_WS_PORT` | `7611` / `7811` / `7812` | `demo-flow` 剧本自己的 vite / service / WS 端口 |
| `SX_DEMO_PHASES` | 全跑 | `demo-flow` 只跑某几段（`A,B`）；不设 = A/B/C 三段全跑 |

> `qa-full-flow` **不读**这些环境变量：它在备用段里**动态挑**空闲端口
> （vite 7600-7699 / service 7800-7899），并显式避开用户的 7523 / 7524 / 7525 / 9222。
> `m1-instance-switch` 与 `m2-end-to-end` **不监听任何端口**（只 spawn 短命子进程）。
| `STRATIX_PEER_TURN_TIMEOUT_MS` | `10000` | 互聊回合超时（会话域剧本用；下界 10s，产品口径的覆盖链） |

## 脚本口径（与 core 契约一致，不是猜的）

- **状态真源**：HUD 的 Agent 侧栏自定义元素 `<strat-agent-panel>` 的 `lastState`
  —— 就是 core 广播的 WorldState 全量快照（`src/hud/panels/agent-panel.ts`）。
- **命令出口**：同一元素的 `adapter.dispatch`（HudCommand 单向通道，`src/core/runtime.ts` 转译）。
- **角色任务相位**（`src/core/types.ts` 的 `TaskStatus`）：
  `queued / running / awaiting_approval / completed / failed / cancelled`。
  后三个是终态；`awaiting_approval` 是**非终态**（在等用户裁决），轮询要继续等。
- **战场任务相位**（`MissionPhase`）：`draft / pending / confirmed / running / done / cancelled`。
  `mission.confirm` 的 `accept` 把 `confirmed → running` 合并成一次写入。
- **任务 → mission 回报**：`completed` → mission `done`；`failed` → mission `cancelled`（中止语义）。
  所以 mission 走到 `done` 的前提是那条任务真跑成了。

## 与构建体系的关系

- `tsconfig.json` / `tsconfig.app.json` / `tsconfig.test.json` 的 `include` 都只覆盖
  `src/**` 与 `tests/**`，**不含 `e2e-tests/`** —— 纯 JS 不进 `tsc`，也不进 `jest`（`jest.config.js` 的 roots 亦不含它）。
- **走查探针**（`probes/probe` / `probes/assign` / `probes/mission`）**不 import 任何 `src/**` 模块**：
  脚本跑在 node 侧，通过 CDP 操作页面，与仓库实现解耦 —— core 契约变了，改脚本里的口径注释即可，
  不需要引入构建链。
- **验收剧本**（`service-resident.e2e.mjs` + `service-resident/*.ts`、`session-domain.e2e.mjs` +
  `session-domain/*.ts`、`m0-project-context.e2e.mjs` + `m0-project-context/*.ts`、
  `m1-instance-switch.e2e.mjs` + `m1-instance-switch/*.ts`、`m2-end-to-end.e2e.mjs` +
  `m2-end-to-end/*.ts`、`qa-full-flow.e2e.mjs` + `qa-full-flow/*.ts`）是例外：它们要
  **拉起真实 service**（注入执行器替身、读真实 MCP / world-sync / 真库），
  所以那些 `.ts` helper 会 import `src/**`。
  它们同样不进 `tsc` / `jest`（不在 include / roots 里），由 `tsx` 直跑（见 `service-resident/service-process.ts` 的文件头）。
- **但它们进 lint**：`tsconfig.eslint.json` 的 `include` 覆盖 `e2e-tests/**/*` ——
  此前这一整棵树因为不在任何 tsconfig 工程里，`eslint .` 直接报解析错，等于**零 lint 覆盖**
  （QA-03 首跑发现，已修）。
- `lib/service-harness.mjs` 是多个验收剧本共用的**夹具层**（起服务 / 断言 / 回收 pid / MCP / world-sync）：
  端口与进程纪律集中在一处，改一处全体生效。
