# task_133

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_133.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

missions 持久化落盘（重启可恢复）-模块

## requirements

- missions（含 brief / checkpoints / 相位）与 characters 名册落盘，网关重启后能完整读回。
- 写侧必须防抖（≥500ms 合并），不许每事件同步写盘；落盘必须原子（临时文件 + rename）。
- 启动时加载快照；快照损坏时降级成空态 + console.warn，**不许崩**。
- 不引新依赖（fs JSON 快照或既有 sqlite 任选）；MCP 工具层语义与错误信封不动；
  `tasks` 表的既有持久化不动；core 零改动。
- 性能：快照体量天然有界（missions ≤ 100、characters ≤ 64、checkpoints ≤ 64/条）。

## acceptance

- [x] create mission（带 brief）+ checkpoint ×2 → 重启网关 → mission_status 读回完整（title/brief/checkpoints 全在）
- [x] character_create → 重启 → snapshot 名册还在
- [x] 正常生命周期（confirm/cancel/delete）跨重启状态一致（done 的重启后还是 done；被 cancel / 删掉的不会复活）
- [x] 快照文件损坏场景：手工写坏 JSON → 网关起得来、降级空态不崩
- [x] npx tsc --noEmit + npx jest src/stratix-gateway 绿
- [x] 结束时网关在跑

## 交付物

| 文件 | 作用 |
|------|------|
| `src/stratix-gateway/service/world-snapshot.ts`（新） | 世界态快照的**纯翻译**层：状态 → 快照、快照原文 → 快照（宽容解析）、快照 → store（角色 + 单位 + 编组任务） |
| `src/stratix-gateway/service/world-persist.ts`（新） | 落盘件：订阅 store → 脏检查（missions/characters 引用）→ 500ms 防抖 → **原子写**（临时文件 + rename）；读档坏档降级成空态 + 警告 |
| `src/stratix-gateway/service/boot.ts`（改） | 新增 `snapshotPath` 选项：启动读回快照 → 恢复进 store；起落盘件；`stop()` 时落最后一次盘 |
| `src/stratix-gateway/index.ts`（改） | 快照路径 = `dataDir/world-snapshot.json`；启动日志打印恢复结果 |
| `src/stratix-gateway/service/__tests__/world-persist.test.ts`（新） | 6 条单测：往返 / 防抖 / 相位一致 / 坏 JSON 降级 / 版本不认识降级 / 单条脏数据 |

**路线选择（诊断结论）**：
- 诊断现状：`missions` 纯内存（core/store 的 `WorldState.missions`），gateway 进程**没有任何**写入路径；
  `characters` 表在 gateway 的 SQLite 里存在但**永远是空的** —— 写它的只有 Electron 主进程
  （`src/electron/main.ts`），而 Electron 用的是 `userData/data` 下**另一个**库文件；
  `world-restore.ts` 的 SQLite 恢复路径在 gateway 里恒为 0 条（129 worker 的现象由此解释）。
- 选 **fs JSON 快照**而非 SQLite：sql.js 是内存库 + 100ms 延迟落盘（进程被杀可能丢最后一笔），
  整库损坏会让 gateway 连启动都做不到（不止世界态没了）；快照文件是纯文本、可人工检查、
  可手工写坏做降级演练，且原子写（临时文件 + rename）保证目标档不会变成半截 JSON。
- 不引新依赖（只用 node 内置 `fs` / `path`）；`tasks` 表的持久化**没动**。

## 验证证据（完成前必填）

- [x] **实现证明**: 见上表；写侧防抖 500ms + 原子写，读侧坏档降级空态不崩
- [x] **测试验证**: 单测 6 条全绿；网关真起真重启两轮实测（见下）
- [x] **影响范围**: 只动 gateway 的 service 侧（world-snapshot / world-persist / boot / index）
      与新增单测；MCP 工具层语义与错误信封**未动**；core 零改动

### 测试步骤
1. `npx jest src/stratix-gateway --silent --maxWorkers=1` → 27 套 / 306 条全绿
2. `npx tsc --noEmit` → exit 0
3. 起网关：`PORT=7524 npm run start:dev`
4. MCP 建角色 + 建任务（带 brief）+ 记 2 条 checkpoint + confirm + cancel + 删角色
5. 等防抖落盘 → `kill` 7524 上的 PID → 重起 → 读回断言
6. 手工写坏 JSON → 重起 → 断言起得来、降级空态、MCP 仍可用

### 验证结果

**单测**：
```
PASS src/stratix-gateway/service/__tests__/world-persist.test.ts
  ✓ 往返：任务（正文 + 检查点）与角色名册都能读回来
  ✓ 防抖：一串快速变化只落一次盘
  ✓ 相位一致：done / cancelled 的任务重启后仍是终态
  ✓ 坏档降级：坏 JSON 读档降级成空态 + 警告，不抛
  ✓ 坏档降级：结构不对的档（版本不认识）也降级成空态
  ✓ 单条脏数据只丢那一条（整档仍可用）
Test Suites: 27 passed, 27 total
Tests:       306 passed, 306 total
```

**重启往返（真网关，端口 7524）**：
- 建角色 `工头-133` → `character_1793750123353_1` / `unit_character_1793750123353_1`
- 建任务 `加固城墙-133`（带 brief）→ `mission_1793750127590_1`，phase=running
- checkpoint ×2 → `checkpoint_count: 2`
- 重启后启动日志：
  ```
  [service] 世界态快照：missions=1 characters=1 units=1 skipped=0 path=stratix-data/world-snapshot.json
  ```
- 重启后 `stratix_mission_status` 读回：
  ```json
  { "title": "加固城墙-133", "phase": "running",
    "brief": { "requirements": "把墙修到 3 格高", "acceptance": "截图里墙高 >= 3" },
    "checkpoints": [ { "note": "第一步：脚手架搭好" }, { "note": "第二步：砖砌到 2 格" } ],
    "checkpoint_count": 2 }
  ```
- 重启后 `stratix_world_snapshot`：`{"units":1,"missions":1,"tasks":0,"characters":1}`，
  名册 `工头-133` 还在；**已删角色 `临时工-133` 没有复活**，**已 cancel 的任务没有复活**
  （cancel = 从战场移除，跨重启一致）

**坏档降级（实测）**：
```
$ printf '{ this is not json at all ' > stratix-data/world-snapshot.json
[service] 世界态快照损坏（JSON 解析失败），降级为空世界：Expected property name or '}' in JSON at position 2
[service] boot ok（characters=0 units=0 records=0 runtime=running）
[service] 世界态快照：missions=0 characters=0 units=0 skipped=0 path=stratix-data/world-snapshot.json
$ curl /health → {"status":"ok", ... "sqlite":"initialized"}
$ stratix_world_snapshot → {"units":0,"missions":0,"tasks":0,"characters":0}
```
网关起得来、降级空态、**不崩**；随后任何一次状态变化都会把坏档自愈成合法 JSON。

**未尽事项**（见最终输出）：
- `unit_positions`（战场站位）**未**进快照 —— 恢复后角色单位走网格落位（与既有语义一致）；
- 快照只覆盖 gateway 进程的世界态；Electron 壳有自己那份 SQLite / store，两者仍各写各的。
