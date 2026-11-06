# task_202 工作文档 —— M2-05（步 N6：新实例的 roster 物化）

> 分支 `demo/v3.3`；权威依据：`docs/DESIGN-project-map.md` §1.3.2 **步 N6**
> （步号纪律：160 的 N 步 ≠ 159 的 M 步）
> ＋ §1.3.3（定义归 project / 运行态归 instance）；前置 M2-01（`25eef04` 六表加 `instance_id` 列）
> ＋ M2-02（`630b786` `role_id` 列 + 复合唯一索引 `(role_id, instance_id)`）。

## 1. 本单范围

| 步 | 动作 | 本单是否做 |
|---|---|---|
| **N6** | 新实例创建时，其 roster 的角色**物化**进该实例的 `characters` 行（契约 → 运行层的单向 reconcile） | ✅ 做 |
| **N7** | 把默认沙盒的存量归入某项目（带预览的一次性迁移动作） | ❌ 不做（独立一步，且要求 N6 先落地） |
| — | `upsertCharacters` 的**通用写侧**补 `instance_id` / `role_id`（M2 系列的另一处欠账：任何 DAO 都没写这两列） | ❌ 不做（范围外；本单的物化行自己带这两列，且普通保存路径**不覆盖**它们 ⇒ 物化行不会被冲掉） |

## 2. 物化点：进入副本链上的**读口**

选点三选一（本单选第二个）：

| 候选 | 判定 |
|---|---|
| 注册表创建处（`registry.upsert`） | ❌ 当前 M1 的注册表是**内存态**、且**没有「创建副本」的对外入口** ⇒ 挂上去等于挂在一个还不存在的动作上 |
| **实例数据源的读口**（`createSqliteInstanceDataSource.read`） | ✅ **选中**：它是 `InstanceLoaderPort.load` 路径上**唯一**的 IO 出口；且「物化出来的行」与「这次要读的行」是**同一批行** ⇒ 物化与读放一处 ⇒ 不会出现「行建了、这次进副本却看不到」的错位 |
| 端口实现（`instance-loader.ts` 的 `load`） | ❌ 该模块**零 IO**（分层铁律：路径判定与读库都归 node 侧适配）⇒ 放进去要么破铁律，要么把 IO 从外面注进来（多一层间接） |

## 3. 字段归属（谁说了算）—— 本单最关键的一条

| 字段 | 真相源 | reconcile 行为 |
|---|---|---|
| `name` / `persona` / `kind`（agent 绑定） | **契约**（`.stratix/roster/<role-id>.json`） | 每次 reconcile 按契约刷新 |
| `level` / `exp` / `context_enabled` | **运行层**（`characters` 表） | 契约里的 `state.*` 只在**建行那一刻**当初值；之后**永不被契约覆盖** |
| `appearance` / `skin_id` / `external_session_id` | **运行层** | 物化**不碰**（建行时留空 —— 不编造外观 / 外部会话） |
| 站位（`unit_positions`） | **运行层** | 物化**不碰**（单位由角色投影，站位落网格） |

**why 这条要写死**：副本独立养成是产品愿景（DESIGN-project-map §1.3.3 理由 2）——
若契约的 `state.level = 1` 每次 reconcile 都刷一遍，用户在副本里升的级会被打回 1 级。
⇒ 契约给**初值**，运行层留**事实**。

## 4. 幂等

- **主路径**：按 `(role_id, instance_id)` 查本副本已有行 ⇒ 有 ⇒ 只刷契约字段；没有 ⇒ 才建行；
- **兜底**（数据库层）：复合唯一索引 `idx_characters_role_instance (role_id, instance_id)`
  （M2-02 建的那条）⇒ 竞态下重复插入被数据库直接拒收（`INSERT OR IGNORE`）⇒ 行数不会涨；
- 行 id = `deriveCharacterId(roleId, instanceId)` = `<roleId>_<instanceId>`
  （复用 N4b 的派生规则，**不是**本单另发明一套）。

## 5. 沙盒不误伤（验收③）

- **默认沙盒一律不物化**：`DEFAULT_INSTANCE_ID` 直接返回 `skipped`（原因 `sandbox`），一个字节都不写。
  - 沙盒是历史数据的 catch-all（旧行 `instance_id IS NULL`）⇒ 把契约投影进去会与存量行撞车；
  - N4b 的规则也写死「默认沙盒的行 id 一律不改（保持历史 id）」⇒ 沙盒**不参与**派生 id 那套；
  - 把沙盒存量归入某个项目是**步 N7** 的显式迁移动作（带预览），**不在这里悄悄做**。
- 物化到别的副本时，写操作的 WHERE 一律带 `instance_id = ?`（**等值**，不是 COALESCE 口径）
  ⇒ 沙盒的存量行（`instance_id IS NULL`）永远不在被改的行集里。

## 6. 单向（task_159 D3）

- 写方向只有两个：**建行**（缺 → 建）与**刷新契约拥有的三项**；
- 本模块**只读**契约文件，**从不写** `.stratix/` 下的任何文件 ⇒ 运行层改动**绝不回写契约**（验收④）；
- 契约 → 运行层是**唯一**方向（没有反向 reconcile 通道）。

## 7. 读盘半复用 M0 链（两套白名单）

`project-context-loader.ts` 里新增 `readRosterRoleDefinitions`（**物化视图**），与既有的
`readProjectContextInput`（**上下文块**）**共用同一批读盘零件**（`readContractJson` /
`parseRosterIndex` / `listRosterFiles`）⇒ roster 的**枚举口径只有一份**（索引优先、目录兜底）。

**两套白名单故意不同**（文件头已写明）：

| 出口 | 读什么 | 去向 | 风险模型 |
|---|---|---|---|
| 上下文块 | 角色显示层四项（id / name / agentKind / systemPrompt 建议） | **进 agent 的 prompt** | 仓库文本 ⇒ 提示注入面 ⇒ 窄白名单 + 降级 |
| **物化视图** | 契约自有字段（id / name / persona / agentKind）+ 运行态初值（level / experience / contextEnabled） | **进本地 SQLite 行** | 契约**本来就该**是那几项的真相源（§1.3.3）⇒ 少读反而物化出空壳角色 |

`capabilities.*`（tools / commands / skills / systemPrompt）**两个出口都不读**
⇒ 能力组合不进角色行（那是 session header 的事，DESIGN-workspace §4.3）。

## 8. 改动文件清单

| 文件 | 性质 | 改了什么 |
|---|---|---|
| `src/app/services/persistence/roster-materializer.ts` | **新增** | 物化器：`materializeRosterCharacters`（DB 半）+ `materializeInstanceRoster`（读盘 + DB 一步）；沙盒守卫、字段归属、容量护栏、幂等 |
| `src/app/services/project-context-loader.ts` | 改 | 新增 `readRosterRoleDefinitions` + `RosterRoleDefinition`（物化视图）；文件头补「两套白名单」说明 |
| `src/app/services/persistence/instance-loader-node.ts` | 改 | ① **物化点**：读之前先物化（`resolveInstanceRoot` 给副本根）；② 读口**按副本过滤**（`loadCharacters` / `listSessionRecords` / `loadRecentTasks` 都带 `instanceId`）；③ 去掉「非沙盒一律空快照」的**零 DDL 期**旧口径（M2 加了列 ⇒ 别的副本**可以**有行） |
| `src/stratix-gateway/service/boot.ts` | 改 | 组合根接线：把 `createInstanceRootResolver(instanceRegistry)` 喂给数据源（副本 id → 项目根） |
| `src/app/__tests__/persistence/roster-materialize.test.ts` | **新增** | 四条验收的集成测试（真实 sql.js + 临时磁盘契约） |
| `src/app/__tests__/project-context-loader.test.ts` | 改 | 物化视图读盘口的 5 条用例 |

## 9. dsh 双面向

- **用**：契约面（`.stratix/roster/`）= dsh 侧 **workspace 内 git 跟踪的文件**
  ⇒ 物化 = **挂载时投影**（dsh 的 workspace 挂载校验是 `realpath(header.cwd) === workspace.path`，
  Stratix 这一侧与之**同构**：副本 id → 副本根 → `.stratix/roster`）。
- **暴露**：**宿主可见控制面** —— 新 instance **首次进入即有角色**
  （不必先手工建档再派单）；宿主侧看到的是 `characters` 行（运行层），
  契约面（roster）**不**进 dsh 的部署面（D1/D7：profile/bundle 是部署概念，项目元数据不进）。

## 10. 验证

```
npx tsc --noEmit                                   → 通过（无输出）
npx jest src/app/__tests__/persistence/roster-materialize.test.ts --maxWorkers=1
  → 14 passed / 14
npx jest --maxWorkers=2                             → 342 suites, 5880 passed, 0 failed
npx eslint --cache <改动的 3 个源文件>              → 0 problems
```

**已知遗留（不属本单，如实记录）**：
`node e2e-tests/m1-instance-switch.e2e.mjs` 的断言③（源码侧零 DDL）**失败** ——
但那是 **M2-01/02/03 已提交的 DDL 改动**（`25eef04` / `630b786` / `96f13fe` 改了
`game-save-dao.ts` / `exp-event-dao.ts`）撞上 **M1 时期**写死的断言，与本单无关
（本单**未改**那两个文件，`git diff` 为空）。该 e2e 的其它断言与本单无交集。
