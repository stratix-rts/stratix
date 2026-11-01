# task_033: 角色档案持久化

## 描述
角色档案（name/appearance/persona/level/exp）+ 单位站位落 SQLite，启动时恢复。消除「刷新即失」。

## 需求
1. Electron 层已有 SQLite 基础（`stratix.db.sqlite`，StratixDataStore）。扩展表：characters（含 appearance JSON、persona、level、exp、bodyType）+ unit_positions（characterId→world x/y）
2. 存储 DAO 放 app 层（存储属 app/Electron 职责，core 零渲染零 IO 不动——只定义事件：新增 `characters.changed` 之类总线事件或经组合根直接订阅，以现有架构惯例为准，文件头注明选择）
3. 启动恢复：组合根启动时读档 → 注入 core store（WorldState.characters）→ BattlefieldScene 按 unit_positions 恢复站位（无记录的随机落位）
4. 变更落盘：create/level/exp/位置变化写库（位置变化可防抖 2-5s，避免拖拽刷库）
5. 单测：DAO 读写/启动恢复注入/站位恢复（内存 SQLite 或打桩）

## 验收标准
- [ ] tsc 零错误；npx jest --silent 全绿
- [ ] 刷新后角色与站位恢复（dev 手测或 electron 集成测试至少其一，注明方式）
- [ ] core 无 IO import（分层铁律）

## 验证方式
npm run typecheck && npx jest --silent

---

## 验证结果（2026-10-24，task_033 执行完毕）

### 落地形态

存储走「渲染层协调器 → IPC → 主进程 DAO → sql.js 适配器」链路（渲染层无 Node 能力，
SQLite 只在主进程；core 零 IO 未动，契约只增了 `unit.position` 事件类型）。

**表结构**（`stratix.db.sqlite`，schema_version 1→2，新旧库均自动建表）：

- `characters`：id(PK) / name / kind / persona / level / exp / appearance(JSON) / body_type
  （appearance.bodyType 冗余列）/ skin_id / external_session_id / created_at / updated_at
- `unit_positions`：character_id(PK) / x(REAL) / y(REAL) / updated_at

**改动文件**：

| 层 | 文件 | 变更 |
|----|------|------|
| core | `src/core/types.ts` | WorldEvent 增 `unit.position`（纯类型，零 IO） |
| core | `src/core/runtime.ts` | `unit.position` 显式接地（消费方是 app 层持久化订阅者，不进 onUnhandled） |
| world | `src/world/bridge/bus-adapter.ts` | WorldEventSink 增 `unitPosition`（只发事件不做 IO） |
| world | `src/world/objects/unit-registry.ts` | `restoredPositions` 注入（构造器选项 + `applyRestoredPositions`），有记录用记录、无记录沿用网格落位；新增 `UNIT_POSITION_SEED_KEY` |
| world | `src/world/scenes/BattlefieldScene.ts` | create 时从 game.registry 取站位种子注入注册表；syncUnits 对新增单位上报 `unit.position` |
| world | `src/world/dev/main.ts` | dev 观测面板补 `unit.position` 显示（穷尽 switch） |
| app | `src/app/services/persistence/game-save-dao.ts`（新） | DAO：建表/upsert/load，只依赖 prepare/exec 结构类型（生产 sql.js 适配器可直插） |
| app | `src/app/services/persistence/game-save-coordinator.ts`（新） | 渲染侧：记录↔CharacterView 翻译、恢复注入纯函数、档案 diff 落库、站位防抖 3s 批量落库 |
| app | `src/app/main/main-entry.ts` | boot 改异步：读档→注入 store→站位种子入 game.registry→runtime 启动后 coordinator.start()；pagehide 冲刷 |
| db | `src/stratix-database/StratixDatabase.ts` | 建表 DDL + TARGET_SCHEMA_VERSION 1→2 + 旧库迁移 |
| electron | `src/electron/main.ts` / `preload.ts` | `game:loadSnapshot` / `game:saveCharacters` / `game:saveUnitPositions` 三条 IPC + `gameSave` API |

### 自动化验证

```
npm run typecheck          → 通过（含 typecheck:app）
npx jest --silent          → 112 suites passed，2567 passed / 6 skipped（基线 2534+6 不回归，新增 33 条）
```

新增测试（33 条，全绿）：

- `src/app/__tests__/persistence/game-save-dao.test.ts`（8）：**真实 sql.js 适配器 + 临时文件**——
  全字段往返、null 字段、upsert 保留 created_at、坐标覆盖、快照合并、**close 后重开文件数据仍在（真落盘）**
- `src/app/__tests__/persistence/game-save-coordinator.test.ts`（17）：真总线+真 runtime 广播链——
  翻译纯函数、恢复注入（脏行跳过/孤儿站位剔除/MAX_CHARACTERS 截断）、档案按引用 diff 只回写变化项、
  防抖窗口合并/同角色留最新坐标、非角色单位不入库、stop 冲刷、读档失败降级为空世界不阻塞启动
- `src/world/__tests__/unit-registry.test.ts`（+5）：恢复位优先/无记录网格落位/undefined 不清种子/destroy 清种子
- `src/world/__tests__/bus-adapter.test.ts`（+2）：unitPosition 事件出口/destroy 后丢弃
- `src/core/__tests__/runtime.test.ts`（+1）：unit.position 不进 onUnhandled

### 刷新恢复说明

- **链路每一段有集成级单测**：落盘持久化（DAO 测试重开文件）→ 读档注入（coordinator 真 bus 链）→
  站位恢复（registry 恢复位优先于网格落位）。
- **实机手测路径**（electron:dev）：启动 → 首启向导建角色 → 等待 ≥3.5s（防抖 3s + 刷盘 100ms）→
  重启应用 → 角色档案（含等级/经验/外观/人设）与战场站位应原样恢复；无站位记录的新角色按网格落位。
  未尽事项：本次为无 GUI 环境执行，未实机跑通该手测，下次 electron:dev 启动时按此步骤确认即可。

### 分层铁律自查

- core 无任何 fs/db/ipc import（`unit.position` 只是类型；runtime 显式接地不消费坐标）
- world 只发事件不做 IO（落位经桥接层 emitWorldEvent）
- 未引入新依赖（驱动用既有 sql.js；better-sqlite3 本机未安装，未使用）
- `git add` 逐文件选择性添加，无 `git add .`
