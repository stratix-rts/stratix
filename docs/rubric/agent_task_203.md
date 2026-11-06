# task_203 工作文档 —— M2-06（步 N7：一次性归属迁移，带预览 + 可撤销）

> 分支 `demo/v3.3`；权威依据：`docs/DESIGN-project-map.md` §1.3.2 **步 N7**
> （步号纪律：160 的 N 步 ≠ 159 的 M 步）
> ＋ §1.3.2 步 **N2**（`instance_id IS NULL` 语义 = 默认沙盒；查询按 `COALESCE` 命中，**落库不改写**）
> ＋ §1.3.2 步 **N4a/N4c**（`role_id` 复合唯一索引 / `character_id_map` 是 N7 的回滚凭据）
> ＋ §1.3.2「`externalSessionId` 的处置」（`session_external_refs` 联合键 = R3 的判据）
> ＋ §1.3.3（角色定义归 project / 运行态归 instance ⇒ 迁的是**运行态**，不是契约）
> ＋ 前置 M2-05（`6eeb2d9` 步 N6：新实例 roster 物化 —— **N7 的硬前置**）。

## 1. 本单范围

| 步 | 动作 | 本单是否做 |
|---|---|---|
| **N7** | 把默认沙盒的 N 条任务 / M 个角色 / K 个会话**归入某项目**（带预览；显式可撤销） | ✅ 做 |
| N7 的 **UI 触发** | HUD 面板上的「迁入本项目」按钮 | ❌ 不做（单据明写「UI 触发可后置」；本单交付 **CLI + 服务层能力 + 测试**） |
| N7 的 **宿主暴露面** | `ctx.remote.stratix` 的 admin 动作 | ❌ 不做（将来项；本单只把**能力**做出来，见 §8 双面向） |
| — | 迁移**契约**（`.stratix/roster/*.json`） | ❌ 不做（单向铁律：运行层改动绝不回写契约 ⇒ 契约不跟着副本走） |

## 2. 三条路径（预览 / 执行 / 撤销）

| 路径 | 入口 | 落库 | 承诺 |
|---|---|---|---|
| **预览** | `previewInstanceAttribution` | ❌ **一个字节都不落库** | 列出「将要迁什么」：三类对象的**计数 + 明细** + 外部凭据 + 跟随行 + 阻断项 + 告警 |
| **执行** | `executeInstanceAttribution` | ✅ **一个事务** | 整批改 `instance_id` + **同事务**写台账与 `character_id_map`；任一步失败 ⇒ 整批回滚 |
| **撤销** | `rollbackInstanceAttribution` | ✅ **一个事务** | 靠台账**反向 UPDATE**，**精确**回到迁移前 |

**预览的判定口径与执行完全同源**（`collectSnapshot` / `collectBlockers` 两处共用一份实现）
⇒ 预览说的就是执行要做的；不会「预览说没问题、执行才炸」。

## 3. 前置闸门：目标 instance 必须先完成 N6 物化（验收④）

design §1.3.2 N7 的明文前置：「**必须先完成目标 instance 的 N6 物化**（否则迁过去的是无 `role_id` 的孤儿行）」。

**判据**：目标副本存在**至少一行 `role_id` 非空**的角色行。
（`role_id` 非空 = N6 物化行的签名 —— 物化行才有 role_id，存量老行没有；
M2-02 建的复合唯一索引 `(role_id, instance_id)` 也正是按这一列卡的。）

未物化 ⇒ **拒绝执行**（不是警告）：预览里列为**阻断项**，执行抛 `AttributionBlockedError`，
**一个字节都不改**。

## 4. 阻断项（宁可不改，也不要改出坏数据）

| # | 阻断项 | 为什么会坏 |
|---|---|---|
| ① | 目标副本 = 源副本 | 迁移没有意义 |
| ② | 目标副本未物化 | 见 §3 |
| ③ | 沙盒行的 `role_id` 与目标副本既有行撞车 | 复合唯一索引 `(role_id, instance_id)` 会**拒绝**这次 UPDATE |
| ④ | 沙盒内部两个行 `role_id` 相同 | 迁过去后**自己撞自己**（同上索引） |
| ⑤ | 外部凭据与目标副本既有行撞车 | 联合主键 `(external_session_id, instance_id)` 会**拒绝** |

③⑤ 是**数据库会拒绝**的情形 ⇒ 不去撞它，而是在预览里说清楚。

## 5. 两张台账（各司其职）

| 台账 | 记什么 | why |
|---|---|---|
| **`character_id_map`**（M2-02 既有表） | **角色**那一类（N7 不改 id ⇒ `old_id = new_id`） | design §1.3.2 N7 钦定的回滚凭据（与 N4b 共用一张表 ⇒ 同库、同寿命） |
| **`instance_attribution_map`**（本单新增） | **全部**行（角色 / 任务 / 会话 / 外部凭据 / 跟随行）+ **迁移前的原始 `instance_id` 原值** | `character_id_map` 的主键 `(old_id, instance_id)` 装不下**异构行**；且只有它记着「原来是 NULL 还是显式 `'wsp_sandbox'`」 |

**why 原值要逐行记**：旧行的 `instance_id` 可能是 **NULL**（步 N2 的口径），也可能是显式的 `'wsp_sandbox'` ——
两者**语义同源、字节不同**。撤销要「回到迁移前」⇒ 必须还原到**原值**（NULL 还原成 NULL），
否则撤销后库不是迁移前的样子（只还原成 `'wsp_sandbox'` 在语义上等价、在字节上不等价）。
⇒ 撤销是**逐行精确反向 UPDATE**（台账里记什么就还原成什么）。

## 6. 三类对象 + 外部凭据 + 跟随行（范围取舍，明写理由）

design 点名的是三类（角色 / 任务 / 会话）。本单**另外**迁了三类**跟随行**：

| 类别 | 表 | 为什么跟着迁 |
|---|---|---|
| 角色 | `characters` | 设计点名的三类之一 |
| 任务 | `character_tasks` | 设计点名的三类之一 |
| 会话 | `sessions` | 设计点名的三类之一 |
| 外部凭据 | `session_external_refs` | 联合键 `(external_session_id, instance_id)` ⇒ 凭据是**副本级**的（R3）⇒ 不迁 = 目标副本里角色 resume 不到 |
| **跟随行** | `unit_positions` / `exp_events` / `session_events` | **父对象迁走了它们不跟** ⇒ 目标副本里「会话没有历史、角色没有站位与成长记录」（半迁移态） |

跟随行的作用域**只取父对象在迁移集合里的那些**（不是把源副本的跟随行全搬）⇒
「指向别的副本的角色的站位」不会被顺手拖走。

**`character_chat_messages` 不迁**：它**没有 `instance_id` 列**（不在 M2-01 的六表清单里）
⇒ 对话行靠 `character_id` 归属，而 N7 **不改 id** ⇒ 它自动跟着角色走。

## 7. 事务纪律（照 N4b 的六步口径）

- **一个事务**：整批 UPDATE + 同事务写两张台账 ⇒ 要么全成，要么全不成；
- `setAutoSaveEnabled(false)` 期间禁自动保存（sql.js 是内存库 ⇒ 防抖保存会把**中间态**刷进磁盘文件）；
- 提交后 `saveAtomically()`（export → 临时文件 → rename）落盘一次；
- 失败 ⇒ `ROLLBACK` ⇒ 磁盘上仍是迁移前状态（**可重跑**）；
- **崩溃注入点**（`onStep`）：测试里在任意一步抛错 ⇒ 断言「库回到迁移前」
  ⇒ 「单事务」这个承诺有**可执行的证据**，不是嘴上说说。

## 8. dsh 双面向

- **用**：dsh 侧把「把一份存档挂到某个 workspace」显式化成**挂载动作**；
  挂载前先跑一遍**同构的挂载前校验** = 本单的**预览**（同一套阻断项判定 + 同一份清单）。
  ⇒ 「先列清单再确认」在 dsh 侧是**同一个动作的两段**，不是两套逻辑。
- **暴露**：宿主可见的**控制面**动作（将来 `ctx.remote.stratix` 的 admin 动作）——
  本单只把**能力**做出来（CLI + 服务层函数 + 台账），不接 UI / IPC（单据允许后置）。

## 9. 改动文件清单

| 文件 | 性质 | 改了什么 |
|---|---|---|
| `src/app/services/persistence/instance-attribution-migration.ts` | **新增** | 预览 / 执行 / 撤销三个入口 + 阻断项与告警判定 + 单事务执行 + 逐行反向 UPDATE 撤销 |
| `src/app/services/persistence/instance-attribution-ledger-dao.ts` | **新增** | 台账表 `instance_attribution_map` 的建表 / 写 / 列 / 删（纯持久化形状） |
| `scripts/migrate-n7-attribution.ts` | **新增** | CLI：`preview` / `migrate --confirm` / `rollback --confirm`（出手前自动备份；只读路径关库**跳过落盘**） |
| `src/app/__tests__/persistence/instance-attribution-migration.test.ts` | **新增** | 四条验收 + 事务原子性 + 幂等 + 撤销预览（15 条） |
| `src/app/__tests__/persistence/helpers/n7-fixture.ts` | **新增** | 真库夹具（真 SQL / 真唯一索引 / 真联合主键）+ 三个破坏开关（未物化 / role_id 撞车 / 外部凭据撞车） |

**未改动任何既有文件**（`git diff` 对既有文件为空）⇒ 既有行为零影响。

## 10. 验证

```
npx tsc --noEmit                                   → 通过（无输出）
npx jest src/app/__tests__/persistence/instance-attribution-migration.test.ts --maxWorkers=1
  → 15 passed / 15
npx jest src/app/__tests__/persistence --maxWorkers=2 → 29 suites, 255 passed, 0 failed
npx jest --maxWorkers=2                             → 343 suites, 5895 passed, 6 skipped, 0 failed
npx eslint --cache <改动的源文件>                    → 0 problems（脚本与测试目录被 eslint 忽略 ⇒ 3 条 ignore warning）
```

**CLI 端到端（真库真跑，输出见提交说明）**：
`preview`（库文件 md5 前后一致 ⇒ 没落库）→ `migrate`（不带 `--confirm` ⇒ 拒绝，退出码 1）
→ `migrate --confirm`（备份 + 迁 13 行）→ `rollback --confirm`（还原 13 行，逐字节回到迁移前）
→ 未物化目标 ⇒ 拒绝执行，退出码 1，库未被改动。
