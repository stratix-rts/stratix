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

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `CDP_BASE` | `127.0.0.1:9222` | CDP 调试端口（换端口 / 换机器时用） |
| `SX_POLL_INTERVAL_MS` | `3000` | 轮询间隔 |
| `SX_TIMEOUT_MS` | `300000` | 轮询超时（5 分钟） |

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
- 本目录**不 import 任何 `src/**` 模块**：脚本跑在 node 侧，通过 CDP 操作页面，
  与仓库实现解耦 —— core 契约变了，改脚本里的口径注释即可，不需要引入构建链。
