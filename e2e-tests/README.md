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
├── lib/cdp.mjs   # 公共封装：连页面 + Runtime.evaluate helper（三脚本共用）
├── probe.mjs     # 连接探测 + 世界状态快照（角色 / 单位 / 任务 / 使命）
├── assign.mjs    # 向指定角色派单，轮询至任务终态
├── mission.mjs   # mission 全链：create → confirm accept → 带 missionId 派单 → 轮询到收尾
├── service-resident.e2e.mjs           # **自起自收**的总验收剧本（服务常驻 / Electron 可选）
├── service-resident/fake-cli.ts        # fake CLI adapter（执行替身；--real 可切真 claude）
├── service-resident/service-process.ts # service 进程启动器（tsx 直跑）
└── README.md
```

## 前置条件

1. **Node ≥ 22**（脚本要用全局 `fetch` / `WebSocket`；仓库本身要求 Node 23，见 `CLAUDE.md`）。
2. **Stratix 正在运行，且 Electron 开了远程调试端口 9222**。
   `npm run electron:dev` **不开**这个端口 —— 要么改用下面的分进程启动法，要么给
   `electron` 命令追加 `--remote-debugging-port=9222`。

   分进程启动（三个终端，或 `&` 后台）：

   ```bash
   # ① backend（gateway，默认 3010 / WS 3011）
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
| `probe.mjs` | `node e2e-tests/probe.mjs` | 连接探测 + 打印世界状态 JSON（角色 / 单位 / 任务 / 使命 / 通知 / 检出 agent） |
| `assign.mjs` | `node e2e-tests/assign.mjs <characterId> [prompt]` | 向指定角色派一单，轮询到任务终态（completed → 退出码 0） |
| `mission.mjs` | `node e2e-tests/mission.mjs [characterId] [prompt]` | mission 全链闭环（mission 到 `done` → 退出码 0） |

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

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `CDP_BASE` | `127.0.0.1:9222` | CDP 调试端口（换端口 / 换机器时用） |
| `SX_POLL_INTERVAL_MS` | `3000` | 轮询间隔 |
| `SX_TIMEOUT_MS` | `300000` | 轮询超时（5 分钟） |
| `SX_SERVICE_PORT` | `7797` | 剧本自己的 service 端口 |
| `SX_WS_PORT` | `7798` | 剧本自己的状态同步 WS 端口 |
| `SX_CDP_PORT` | `7799` | 剧本自己的 Electron 调试端口 |
| `SX_VITE_PORT` | `7601` | 剧本自己的 vite dev server 端口 |

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
- **走查脚本**（`probe` / `assign` / `mission`）**不 import 任何 `src/**` 模块**：脚本跑在 node 侧，
  通过 CDP 操作页面，与仓库实现解耦 —— core 契约变了，改脚本里的口径注释即可，不需要引入构建链。
- **验收剧本**（`service-resident.e2e.mjs` + `service-resident/*.ts`）是例外：它要**拉起真实 service**
  （注入执行器替身、读真实 MCP / world-sync），所以那两个 `.ts` helper 会 import `src/**`。
  它们同样不进 `tsc` / `jest`（不在 include / roots 里），由 `tsx` 直跑（见 `service-resident/service-process.ts` 的文件头）。
