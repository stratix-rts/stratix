# task_080 service: gateway 接线——启动时挂 service，MCP 进程内见真状态

## 描述

前后端分离 A4（A 轨收口单）。gateway 启动时 boot service（A1 组合根 + A2 执行环 + A3 存储），此后 `/mcp` 的 createCoreMcpHost 与 core runtime 同进程——最初的「units 0」痛点就此消解。方案：docs/SERVICE-SPLIT-PLAN.md A4 节。

## Requirements

1. src/stratix-gateway/index.ts 启动序列改造：**先** createStratixService() boot（含执行环+存储接线），**再**挂路由；boot 失败即进程退出（不裸奔半启动状态）。
2. `/mcp` 路由的 `createCoreMcpHost()` 保持现状调用——A4 后它自动见真 store（这正是 context.ts 拓扑注释预言的接线）。
3. stdio bin（bin/stratix-mcp / src/stratix-gateway/mcp/bin）**本单不动**（跨进程附着由 B 轨 world-sync 解决）。
4. dev 双进程模式兼容：`npm run dev:backend` 单跑 gateway 时 service 正常 boot（日志一行 `[service] boot ok` 确认）；`npm run electron:dev` 不受影响。
5. 实测验证：gateway 单进程起 → curl HTTP MCP world_snapshot → 返回真实 units 非空。

## Acceptance

- [x] gateway 启动日志含 service boot 确认行
- [x] tools/list 工具数回归不变（**实测 9 个，非任务书写的 8 个**——见下「工具数口径」）
- [x] world_snapshot 经 HTTP 实测返回真实 units 非空（对比：改造前 units total 0）
- [x] `npx tsc --noEmit` 0 错 + `npx jest` 全绿

## deliverables

- src/stratix-gateway/index.ts（启动序列）
- 实测输出贴进任务 md（curl 命令 + 响应摘录）

---

## 实现（本次落地）

### 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `src/stratix-gateway/index.ts` | 改 | 启动序列改为 **DB → 存储件 → boot service → 挂路由**；boot 失败即退出；`/mcp` 的 host 显式绑到 `service.store`；关机顺序加「Stop Stratix service」 |
| `src/stratix-gateway/service/boot.ts` | 新 | 启动接线：组合根(A1)+执行环(A2)+存储(A3) → 世界态恢复 → agent 探测；返回可停句柄 `{ service, restore, detection, stop }` |
| `src/stratix-gateway/service/world-restore.ts` | 新 | 从本进程 SQLite 的 `characters` 表恢复角色档案 → 经 core 的 `toCharacterUnit` 投影成战场单位，写进同一份 store（units 不再恒 0）；读档失败降级为空世界 + 警告，不抛 |
| `src/stratix-gateway/service/agent-detection.ts` | 新 | service 进程内的本地 CLI agent 探测（复用 app/services/agent-detector），逐条并入 `store.detectedAgents`（执行环出队守门依赖它）；可取消 |
| `src/stratix-gateway/service/index.ts` | 改 | 导出上述三个模块 |
| `src/app/services/persistence/character-record.ts` | 新 | 从 game-save-coordinator.ts 抽出的**纯**翻译层（记录 ↔ CharacterView、快照 → 恢复注入）：渲染侧协调器与 service 侧恢复共用同一份映射（service 不得依赖渲染层模块） |
| `src/app/services/persistence/game-save-coordinator.ts` | 改 | 纯翻译移出后仍按原路径再导出（既有调用方/测试零改动） |
| `src/stratix-gateway/service/__tests__/boot.test.ts` | 新 | 5 例：组合根接通 / 恢复出角色+单位 / 恢复幂等 / MCP 同 store 见真单位 / stop 后命令不再落地 |
| `src/stratix-gateway/service/__tests__/agent-detection.test.ts` | 新 | 2 例：探测结果并入 store / stop 可取消（单测不 spawn 真实命令） |

### 接线要点

- **顺序即语义**：路由挂上去的那一刻，`/mcp` 的数据面就已经指向本进程已醒的 core runtime——不是「事后补」，是「挂路由前就绪」。
- **boot 失败 = 进程退出**（standalone 模式 `process.exit(1)`；embedded 模式抛出让宿主决定）。半启动的 gateway（路由已挂但大脑没醒）比不启动更糟。
- **stdio bin 未动**（Requirement 3）：跨进程附着留给 B 轨 world-sync（task_082）。
- **无新依赖**。

---

## 实测证据

### 端口纪律

用户 dev 实例正占着 **7524/7523/9222**——全程未 kill、未改配置；实测一律用备用端口 **7797**（WS 7798），数据目录用 `/tmp/a4-data`（从用户 Electron 主库 `.backup` 出来的**副本**，不碰原库）：

```
$ sqlite3 "<用户 Electron 主库>/stratix.db.sqlite" ".backup '/tmp/a4-data/stratix.db.sqlite'"
$ ls -la /tmp/a4-data/stratix.db.sqlite
-rw-------  688128  ...  /tmp/a4-data/stratix.db.sqlite     # 4 个真实角色档案
```

实测期间用户的 dev 实例始终在位（`node 20243 ... 127.0.0.1:7524 (LISTEN)`），实测进程结束后 7797 监听数 = 0。

### 启动命令

```bash
PORT=7797 WS_PORT=7798 DATA_DIR=/tmp/a4-data npx tsx src/stratix-gateway/index.ts
```

### ① 启动日志含 service boot 确认行

```
Starting Gateway in standalone mode...
Initializing SQLite database...
[Database] Initialized at: /tmp/a4-data/stratix.db.sqlite
SQLite database initialized: /tmp/a4-data/stratix.db.sqlite
[service] boot start...
[service] boot ok（characters=4 units=4 records=4 runtime=running）      <-- 确认行
Initializing data store...
[StratixDataStore] Initialized with SQLite
...
Stratix Gateway running on 127.0.0.1:7797 (standalone mode)
WebSocket status sync running on port 7798
[Gateway] Abandoned task requeuer started (every 5 min)
[Gateway] OrchestrationSync initialized
[agent-detector] claude-code (T1) ✓ 已安装 · 2.1.270 · /Users/kingj/.local/bin/claude
[agent-detector] codex (T1) ✗ 未安装
[agent-detector] opencode (T1) ✓ 已安装 · 1.2.6
[agent-detector] kimi (T1) ✗ 未安装
[agent-detector] openclaw (T1) ✓ 已安装 · 2026.4.2
[agent-detector] gemini (T2) ✗ 未安装
...
```

`runtime=running` = core runtime 已在**本进程**跑起来（A1 组合根接线成功），这是「units 0」痛点的根因之一。

关机（SIGTERM）日志按序收干净：

```
[Gateway] Stop abandoned task requeuer completed
[Gateway] Stop Stratix service completed          <-- 新增：先停大脑
[Gateway] Stop agent runtimes completed
[Gateway] Close HTTP server completed
[Gateway] Shutdown completed successfully
```

### ② tools/list 回归

```bash
curl -s -X POST http://127.0.0.1:7797/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

改造后：

```
tools 数量 = 9
['stratix_world_snapshot', 'stratix_task_assign', 'stratix_task_status', 'stratix_task_cancel',
 'stratix_mission_create', 'stratix_mission_status', 'stratix_mission_checkpoint',
 'stratix_chat_send', 'stratix_registry']
```

改造前（`git stash` 回 HEAD 的 index.ts，同一 DB、同一端口重跑）：

```
tools 数量 = 9
['stratix_world_snapshot', 'stratix_task_assign', 'stratix_task_status', 'stratix_task_cancel',
 'stratix_mission_create', 'stratix_mission_status', 'stratix_mission_checkpoint',
 'stratix_chat_send', 'stratix_registry']
```

**工具数口径说明（诚实更正）**：任务书写「仍 8 工具」，实测注册表 `DEFAULT_MCP_TOOLS` 是 **9 个**（改造前也是 9 个）。A4 没动 MCP 工具注册表——**回归点是「数量与清单不变」，前后一致即通过**；任务书的「8」与代码现状对不上，此处按实测如实报 9。

### ③ world_snapshot 前后对比（核心验收）

```bash
curl -s -X POST http://127.0.0.1:7797/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"stratix_world_snapshot","arguments":{}}}'
```

**改造前（units total 0）**：

```json
{"ok":true,"data":{"taken_at":1793548873579,
 "units":{"returned":0,"total":0,"truncated":false,"items":[]},
 "missions":{"returned":0,"total":0,"truncated":false,"items":[]},
 "tasks":{"returned":0,"total":0,"truncated":false,"items":[]},
 "characters":{"returned":0,"total":0,"truncated":false,"items":[]},
 "totals":{"units":0,"missions":0,"tasks":0,"characters":0}}}
```

**改造后（真实 units 非空）**：

```json
{"ok":true,"data":{
 "taken_at":1793548839126,
 "units":{"returned":4,"total":4,"truncated":false,"items":[
   {"id":"unit_character_1792911220766_1","name":"Claude Code","status":"idle","online":true,"character_id":"character_1792911220766_1","mission_id":null},
   {"id":"unit_character_1792911220774_2","name":"OpenCode",  "status":"idle","online":true,"character_id":"character_1792911220774_2","mission_id":null},
   {"id":"unit_character_1792911220775_3","name":"Kimi",      "status":"idle","online":true,"character_id":"character_1792911220775_3","mission_id":null},
   {"id":"unit_character_1792911220777_4","name":"OpenClaw",  "status":"idle","online":true,"character_id":"character_1792911220777_4","mission_id":null}]},
 "missions":{"returned":0,"total":0,"truncated":false,"items":[]},
 "tasks":{"returned":0,"total":0,"truncated":false,"items":[]},
 "characters":{"returned":4,"total":4,"truncated":false,"items":[
   {"id":"character_1792911220766_1","name":"Claude Code","agent_kind":"claude-code","level":3,"online":true},
   {"id":"character_1792911220774_2","name":"OpenCode","agent_kind":"opencode","level":1,"online":true},
   {"id":"character_1792911220775_3","name":"Kimi","agent_kind":"kimi","level":1,"online":true},
   {"id":"character_1792911220777_4","name":"OpenClaw","agent_kind":"openclaw","level":1,"online":true}]},
 "totals":{"units":4,"missions":0,"tasks":0,"characters":4}}}
```

**units 0 → 4（真实角色，非 mock）**，characters 0 → 4 同源（units 由 characters 经 core 的 `toCharacterUnit` 投影而来）。

### ③-b 附带证据：命令现在真落地（改造前网关里没人接命令）

同一进程、同一 MCP 端点建一条编组任务：

```bash
curl -s -X POST http://127.0.0.1:7797/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"stratix_mission_create","arguments":{"title":"A4 接线验证","units":["unit_character_1792911220766_1"]}}}'
```

改造前：

```json
{"ok":false,"error":{"code":"internal_error",
 "message":"编组任务未落地：本进程没有 core 运行时接管这条命令",
 "retryable":true,"hint":"确认 Stratix 运行时在本进程已启动后再建任务"}}
```

改造后：

```json
{"ok":true,"data":{"mission_id":"mission_1793548848046_5","title":"A4 接线验证","phase":"running",
 "auto_confirm_applied":true,
 "units":[{"id":"unit_character_1792911220766_1","name":"Claude Code"}],
 "dropped_units":0,"created_at":1793548848046, ...}}
```

随后 `world_snapshot` 的 `totals` = `{"units":4,"missions":2,"tasks":0,"characters":4}`（含此前那条空名单草稿）。

即：改造前 MCP 发出的命令**掉在地上**（网关进程没有 core runtime），改造后**由本进程的 core 裁决**（phase=running）——这就是「同进程见真状态」的实质。

### ④ tsc / jest

```bash
$ npx tsc --noEmit
tsc exit=0        # 输出 0 行

$ npx jest --silent --maxWorkers=2
Test Suites: 184 passed, 184 total
Tests:       6 skipped, 3855 passed, 3861 total
Snapshots:   0 total
Time:        22.34 s
jest exit=0
```

（新增单测 7 例：boot 5 例 + agent 探测 2 例。）

---

## 未尽事项（不在本单范围）

1. **角色数据尚未迁进 service 库**：用户的角色档案现在仍写在 **Electron 主库**，而 service 进程独占的是 `stratix-data/stratix.db.sqlite`（其 `characters` 表为空）。因此**用户默认 dev 实例（用默认 DATA_DIR）目前仍会看到 units 0**；本单实测用的是从 Electron 主库拷出的副本（`/tmp/a4-data`）才拿到 4 个真实单位。要让默认实例也见真状态，需后续把 Electron 壳的写入改走 service（B/C 轨「壳只经 API 写」）。
2. **两个物理库并存**（SERVICE-SPLIT-PLAN §3.1 已记的过渡态）：Electron 主库 ↔ service 库的 characters 尚未合并。
3. **stdio bin 跨进程附着**未做（B 轨 world-sync / task_082）。
4. **WS 端点**未做（task_082）。
