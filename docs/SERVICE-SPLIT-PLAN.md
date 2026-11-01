# SERVICE-SPLIT-PLAN — Stratix 前后端分离（OpenClaw 式架构）

> 状态：**已冻结**（2026-11-01，用户拍板「方案1：gateway 为相」+「类 OpenClaw dashboard/gateway 关系」+「LRA 管理、Claude Code CLI 开发」）
> 分支：`refactor/game-v3`（延续 v3 工作流；042 发版 tag 不含本批）
> 任务管理：LRA task_077 起，9 单；worker = `claude --print`，单单 600s 节奏
> 架构原则出处：用户原话「gateway 是枢纽、Electron 是可重启的壳——Managed Agents『brain 与 shell 分离』」

## 1. 目标

前后端分离。**service 常驻持有大脑，Electron 退化为可选视图壳**：

- **Service（gateway 进程，常驻 daemon）**
  - core runtime：worldStore、mission/task/character 状态机
  - **agent 连接与执行**：cli-transport spawn claude/kimi（每角色并发 1）
  - 存储：SQLite 独占（任务全文 / chat / exp events 落库）
  - 对外面：MCP（stdio+HTTP）/ REST API / WebSocket
- **Electron（可选壳）**
  - 纯视图客户端：WS 订阅状态快照、发 HudCommand
  - **关闭/重启不影响 agent 工作**；重连后全量快照恢复视图

类比：OpenClaw 的 gateway（daemon：会话/执行/存储）与 dashboard（可关可换的客户端）。

## 2. 目标拓扑

```
                    ┌────────────────────────────────────────┐
                    │  Service（gateway 进程，常驻）           │
                    │  core runtime ── mission/task 状态机    │
                    │  task-service（执行环，spawn CLI）       │
                    │       │                                 │
                    │       ▼                                 │
                    │  cli-transport ──► claude / kimi 子进程 │
                    │  SQLite（独占写）                        │
                    │  ┌──────────┬──────────┬──────────┐     │
                    │  │ MCP      │ REST API │ WS       │     │
                    └──┴────▲─────┴────▲─────┴────▲─────┴─────┘
                           │stdio      │HTTP      │WS (world-sync)
        ┌──────────────────┘           │          └───────────────┐
        ▼                              ▼                          ▼
  外部 MCP client               浏览器/API client          Electron 壳（可选）
  （Claude Code 等）                                        hud/world 纯视图
```

## 3. 现状与差距

| 组件 | 现位置 | 目标 | 任务 |
|------|--------|------|------|
| core runtime 装配 | `src/app/main/main-entry.ts`（渲染进程组合根） | service 进程 | A1 |
| task 执行环 | 渲染进程 task-service → cliChat IPC → Electron main spawn | service 进程直接 spawn | A2 |
| 落库（全文/chat/exp） | 渲染进程 persister / 多进程开同一 SQLite | service 独占写 + 读 API | A3 |
| MCP host | gateway 进程 `createCoreMcpHost()`（空态，units 0） | 同进程见真状态 | A4 |
| WS 状态面 | 无（StatusSync 是 v2 编排事件面，不复用） | world-sync 新协议 | B1/B2 |
| hud/world 数据源 | 进程内直连 core store/bus | 远程实现同接口 | B3 |

### 3.1 存储边界：dataStoreService（JSON）vs stratix-database（SQLite）— A3 落地

两套存储**互不相干**，不要混谈，也不要互相替代（A3 只动 SQLite 这一侧）：

| | `src/stratix-gateway/dataStoreService.ts` | `src/stratix-database`（SQLite） |
|---|---|---|
| 存什么 | 世界存档/角色/剧情的 **JSON 文档**（`stratix-data/*.json`） | 三张表：`character_tasks`（任务全文）/ `character_chat_messages`（对话历史）/ `exp_events`（经验事件） |
| 谁写 | gateway 进程内的 service 调用 | **只由 service 进程写**（A3 起：`src/stratix-gateway/service/storage.ts` 是唯一 owner） |
| 谁读 | 同进程内调用 | 同进程直读（MCP host 与 service 同进程）；跨进程走 `GET /api/storage/tasks/:id/output`、`GET /api/storage/chat/:characterId` |
| 库文件位置 | `stratix-data/`（仓库内） | gateway/service 进程：仓库 `stratix-data/stratix.db.sqlite`；Electron main：`~/Library/Application Support/Stratix/data/stratix.db.sqlite` |

**边界规则**：
1. **dataStoreService 不动**（本期冻结）——它不是 SQLite，不受铁律 6 约束；JSON 与 SQLite 是两套事实源，不得互相 import 或做双向同步。
2. **SQLite 写独占**：A3 起三落库点（任务全文 / chat persister / exp_events）的写入口全部收在 service 进程的存储件里；Electron main 的三条 `ipcMain.handle` 写通道**已退役**（`game:saveChatMessage` / `game:saveTask` / `game:saveExpEvent`）。
3. **读侧过渡**：Electron main 的读通道（`game:loadChatMessages` 等）**暂时保留**（渲染层读历史的兼容路径），读切 API 是 B 轨（Electron remote store）的收尾项。
4. **过渡缺口（如实记录）**：A3 只完成「写侧归位 + 读 API 就位」，**尚未做 A4 gateway 接线**，所以此时 Electron 壳内的写动作还没接到 service 的存储件上 —— A4 接线后由 service 侧落库补齐。两个物理库文件并存也是同一过渡期的现象，A4/B 轨收口时统一到 service 进程。

现状关键事实：
- `core/` 零渲染、传输无关，managers 全注入式——搬家友好
- `cli-transport` 依赖注入 ProcessFactory，本身无 Electron 耦合（只是调度在 Electron main）
- `agent-link/gateway-transport.ts` 已走 gateway HTTP/WS 通道（OpenClaw 代理路由）
- `gateway/mcp/context.ts` 注释明言「该进程挂着 core runtime，MCP 才能看见战场」——A4 后自动闭环

## 4. 任务清单（9 单，LRA task_077 起）

| ID | 任务 | 依赖 | 优先级 |
|----|------|------|--------|
| A1 | headless 组合根 `createStratixService()` | — | P0 |
| A2 | task-service 无头化（service 直接 spawn CLI） | A1 | P0 |
| A3 | 存储归一（SQLite service 独占写 + 读 API 骨架） | A1 | P0 |
| A4 | gateway 接线（启动挂 service，MCP 见真状态） | A2,A3 | P0 |
| B1 | world-sync WS 协议契约（类型+守卫+文档） | — | P0 |
| B2 | service 侧 world-sync 端点（广播+命令回传+ack） | A1,B1 | P0 |
| B3 | Electron remote store（CoreStore 远程实现） | B1 | P0 |
| C1 | e2e：不开 Electron，agent 照常干活，壳后恢复 | A4,B2,B3 | P0 |
| C2 | 拓扑定稿文档 + 旧路径 @deprecated 标记 | C1 | P1 |

双轨并行：A1+B1 可同时开；A1→{A2,A3 并行}→A4；B1→{B2(待A1),B3}→汇合 C1。

## 5. 设计守卫（铁律，任务 prompt 与 review 共用）

1. **真相唯一**：WorldState 真相源 = service 进程的 core store。Electron 是无状态视图：**重连 = 全量 snapshot 覆盖，不做增量合并**。
2. **裁决在 core**：mission/task 相位状态机只发生在 service 的 core runtime；UI 与 MCP 的写操作一律走 HudCommand（`emitCommand`），由状态机裁决落点。
3. **总线铁律不变**：hud/world 只依赖 `core/types.ts` 契约。B3 用「同接口远程实现」兑现——hud/world 源码零改动。
4. **绝不假装成功**：service 未启动 / 状态面未附着时，工具与远程 store 如实报 unavailable（internal_error / stale 标记），不返回空态假装正常。
5. **cli-transport 不引 Electron 依赖**（现状已满足，保持；违反即退回）。
6. **存储独占**：SQLite 只由 service 进程打开写；其余进程经 API 读。gateway 旧 `dataStoreService`（JSON 存储）不动，边界写入 A3 文档。
7. **渐进迁移**：Electron 本地直连装配保留为 dev 回退模式（B3 加开关，默认远程关）；A/B 轨全程旧路径可用，C2 才打 @deprecated（不删代码）。

## 6. 验收（C1 剧本即总验收）

1. 起 service（gateway 单进程）
2. MCP `world_snapshot` 返回真实 units（非 0）
3. `task_assign` → service spawn CLI → task completed → mission done ——**全程无 Electron 进程**
4. 拉起 Electron 远程模式 → 视图从全量快照恢复，units/tasks/missions 可见
5. 期间 kill Electron 再拉起，状态无损

## 7. 明确不做（本期）

- 不做多 service 部署/远程网络拓扑（同机单 service）
- 不做 snapshot 增量 patch 协议（预留 delta 字段，不实现）
- 不删 Electron main 任何代码（只标记）
- 不动 v2 遗留模块（stratix-orchestration / agent-platform 等，另行处置）

---

## 8. 收尾节（迁移期双模式）

> 本节是 C2（task_085）的收尾产物：**新旧拓扑并存期的操作手册** —— 怎么开远程模式、怎么开本地回退、
> 什么场景用哪个、什么场景**必须禁**本地直连。
> 真相源：本节 + [WORLD-SYNC.md](WORLD-SYNC.md)（视图侧协议）＋ [MCP-SPEC.md](MCP-SPEC.md) §0.5（MCP 侧拓扑）。

### 8.1 两个模式是什么

| | **远程模式（正式拓扑）** | **本地直连模式（dev 回退）** |
|---|---|---|
| 大脑住哪 | service 进程（gateway 常驻） | 渲染进程（Electron） |
| 状态从哪来 | WS `world-sync` 全量快照（本地整体覆盖） | 进程内直连 core store |
| 写走哪 | `command.forward` → service 的 core 裁决 | 本地 `emitCommand` → 本地 core 裁决 |
| CLI 谁 spawn | service 进程 | Electron main（经 `chat:run` IPC） |
| 谁写 SQLite | service 独占写 | 渲染进程经 IPC → Electron main DAO |
| MCP 能见战场 | ✅ 同进程真态 | ✅（同一个进程的同一份 store） |
| 关掉 Electron | 只丢视图，agent 照跑 | **agent 一起停机** |

### 8.2 开关名与开法

两个模式由**同一个开关**控制，开关名 `STRATIX_REMOTE`（严格等于 `'1'` 才算开）。
读法有两处来源（构建期 vite define + 运行时环境变量，见 `src/app/main/dev-flags.ts`）：

| 模式 | 开关 | 怎么开 |
|------|------|--------|
| **远程模式**（正式拓扑） | `STRATIX_REMOTE=1` | `STRATIX_REMOTE=1 npm run dev`（或 `STRATIX_REMOTE=1 npm run electron:dev`）；端点非默认时再加 `STRATIX_WORLD_SYNC_URL=ws://127.0.0.1:<port>/ws/world-sync`（缺省 `ws://127.0.0.1:7524/ws/world-sync`，与 gateway 同机） |
| **本地直连**（dev 回退） | 不设 `STRATIX_REMOTE` | **不设**（或设为非 `'1'` 的任意值）即走本地直连 —— 这是缺省口径，无需额外动作 |

配套：远程模式要求 **service 已在跑**（`npm run dev:backend` 起 gateway，它启动即 boot service）。
service 没起来时，壳连不上 WS，视图如实显示「未连接」而不是假装正常（铁律 4）。

C1 e2e 剧本（`e2e-tests/service-resident.e2e.mjs`）的实操姿势可作参照：起 service → `STRATIX_REMOTE=1` +
`STRATIX_WORLD_SYNC_URL=ws://127.0.0.1:<service 端口>/ws/world-sync` 起 Electron → 杀 Electron → 状态无损。

### 8.3 适用场景

**用远程模式（默认选择）：**

- 日常开发与联调 —— agent 要真干活（派单、跑任务、落库），service 必须在场。
- 多客户端 —— 外部 MCP client（Claude Code 等）+ REST 脚本 + Electron 壳同时看同一份真相。
- Electron 壳可能被随时关掉 / 重启的场景（用户习惯随手关窗口），且**不能**因此中断 agent。
- 任何需要「真相唯一」的判定：本地再裁决一遍就会造出第二份真相（铁律 1）。

**用本地直连模式（仅限 dev 回退）：**

- **纯前端开发**：只调 hud / world 的界面与交互，不碰 agent 执行环 —— 不想每次都起 service。
- 单进程起不来的应急联调：service 起不来时的临时自救。
- 旧路径回归：改动了本地直连那条链时，确认「旧路径仍然可用」（铁律 7 要求旧路径全程可用）。

### 8.4 何时禁（本地直连必须关掉的场景）

| 场景 | 为什么必须禁 |
|------|-------------|
| **生产 / 交付环境** | 本地直连 = 大脑在渲染进程：关窗口 agent 就死，与「service 常驻」的产品定义直接冲突 |
| **agent 需要长期值守**（跑长任务、无人盯屏） | 壳一关，执行环跟着停 —— 活干不完 |
| **多客户端同时接**（MCP + 脚本 + 多个壳） | 每多一个本地直连实例就多一份真相副本（铁律 1 破），且 SQLite 多进程共写（铁律 6 破） |
| **要验证「不开 Electron agent 照常干活」** | 本地直连下壳关了 agent 就停 —— 恰好验不出这条验收项（C1 §6-3） |
| **落库要可信** | 本地直连下渲染进程经 IPC 写库，service 侧不参与 —— 两套写入口并存 |

### 8.5 退役路线

本地直连模式的代码**全部保留**，只在三处打了 `@deprecated` 标记（只注不删，铁律 7）：

| 位置 | 标记内容 |
|------|---------|
| `src/electron/main.ts` | Electron main 的 **CLI spawn 职责段**（`chatRuns` 表 + `chat:run` / `chat:abort` 两条 IPC 通道） |
| `src/app/main/main-entry.ts` | 渲染进程的**本地直连装配 / 开关段**（数据源选择 + 本地 runtime / 本地落库 / 本地探测各 guard） |
| `src/stratix-gateway/mcp/context.ts` | **已过时的跨进程拓扑说明段**（现在是同进程真态） |

每处标记都写了迁移指引（指向新路径）。退役顺序（不在本期）：本地直连停用 → Electron main 的 spawn 段与
`chat-transport-bridge` 删除 → 渲染侧本地装配删除 → 只留 remote store 一条路。删除动作必须在本地直连
确认无人使用之后单独开单，不在本期范围。
