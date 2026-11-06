# task_205 工作文档 —— M2-08（容量上限 + 滚动归档）

> 分支 `demo/v3.3`；权威依据：`docs/DESIGN-project-map.md` §1.4 **M2 行右列**
> （落库表跨 instance 总量上限）+ §4.5 **B4b**（落库表跨 instance 总量上限缺失）
> + §4.5 风险表 **R1-20**（`session_events` 行数无界 ⇒ 行数上限 + 滚动归档到 `history/`）。
> 前置：M2-01（`25eef04` 六表加 `instance_id` + COALESCE 命中口径）、M2-07（`ef7d53b` managers 按 instance 过滤）。

## 1. 本单范围

| 改动点 | 权威位置 | 本单是否做 |
|---|---|---|
| `characters` 全局上限 `MAX_CHARACTERS_TOTAL=512` | §1.4 M2 行 ① | ✅ 做 |
| `characters` 每 instance 上限 64（现状值 `MAX_CHARACTERS`） | §1.4 M2 行 ① | ✅ 做（沿用 core 既有常量，不新增第二份） |
| `session_events` 每 instance 每会话 512 + 每 instance 总 4096 ⇒ 滚动归档到 `history/` | §1.4 M2 行 ② / R1-20 | ✅ 做 |
| `exp_events` / `unit_positions` 随 `characters` 同步清理（无独立池） | §1.4 M2 行 ③ | ✅ 做 |
| 上限常量进 core（visual-spec 同款常量模式） | 任务上下文 | ✅ 做（`src/core/capacity.ts`） |
| 滚动归档 append jsonl（M1-06 的 archive 范式） | 任务上下文 / DESIGN-workspace §5.2 | ✅ 做（`.stratix/history/session-events-YYYYMM.jsonl`） |
| 触发点 = 写入路径（创建角色 / 追加事件时检查） | 任务上下文 | ✅ 做（角色：electron IPC + roster 物化；事件：service 存储件） |
| 事件订阅面暴露容量状态（将来健康指标） | 任务上下文（dsh 双面向之「暴露」） | ⚠️ **半做**：outcome 已可观测（归档条数 / 原因）+ 落进 service 日志；**未**新建订阅面（属将来增量） |

## 2. 常量：一处可调（core 层）

新增 `src/core/capacity.ts`（**零 IO 的叶子模块**，只 import `./types` 的 `MAX_CHARACTERS`）：

| 常量 | 值 | 口径 |
|---|---|---|
| `MAX_CHARACTERS_PER_INSTANCE` | 64 | 每副本角色数（= `MAX_CHARACTERS` 现状值，不新增第二份口径） |
| `MAX_CHARACTERS_TOTAL` | 512 | **跨副本**角色行总数（B4b 那条无界线） |
| `MAX_SESSION_EVENTS_PER_SESSION` | 512 | 每副本每会话事件行数 |
| `MAX_SESSION_EVENTS_PER_INSTANCE` | 4096 | 每副本事件行总数 |
| `CAPACITY_LIMITS` | 冻结对象 | 四个值的唯一汇总面（一处可调 / 可断言） |

**why 不放 `core/types.ts`**：那是依赖图的叶子（禁止任何 import），塞常量进去会让整棵树的依赖面变形；
`core/capacity.ts` 是同款「常量叶子」的干净做法。

**why 角色池超限是「拒新」而不是「挤掉最老」**：`characters` 行是**用户亲手建的角色档案** ——
悄悄删掉最老的那条 = 数据丢失。事件流不一样：`session_events` 是 append-only 的**审计流**，
热表里没有、归档文件里还在 ⇒ 历史没丢（只是不在热表里）。

## 3. 落库层的容量口径（`app/services/persistence/capacity-limits.ts`，**零 IO**）

| 导出 | 作用 |
|---|---|
| `countCharacters` / `countInstanceCharacters` | 全库 / 单副本行数（副本口径走 `instance-scope.ts` 的 COALESCE 谓词，不另写一份） |
| `readCharacterCapacity` | 判定「还能不能再建一个」（`ok` + `reason: 'instance-limit' \| 'total-limit'`） |
| `filterCharactersWithinCapacity` | 写入护栏：**新行**按容量筛掉，**老行**照写（改档不是新建） |
| `countInstanceSessionEvents` / `countSessionEventsForSession` | 事件池计数（副本级 / 会话级） |
| `selectOldestSessionEvents` | 取**最老**的若干行（会话内按 `seq`，跨会话按 `created_at`） |
| `deleteSessionEventRows` | 删已归档的行（按 `(session_id, seq)` 复合主键精确删） |
| `deleteCharacterCascade` | 删角色 ⇒ 连同 `exp_events` / `unit_positions` 一起删（**一个事务**） |

**why 护栏放在调用点而不是 `upsertCharacters` 内部**：`upsertCharacters` 是「全量快照回写」语义，
把容量判定埋进去 ⇒ 副本满位时**改个名字都写不进去**（存量角色僵在旧值）；而且落库层引入对
容量模块的依赖会成环。护栏留在**写入路径**（触发点）⇒ 语义显式。

## 4. 滚动归档（`app/services/persistence/session-event-archive.ts`，**零 IO**）

- 格式沿用 M1-06 的 `history/*.jsonl` 纪律：每行 `{v, ts, kind, ignorable, payload}`，
  `kind = 'session-event/archived'`，**按月分片** `session-events-YYYYMM.jsonl`（单文件无限增长 = 另一种无界）。
- 判定顺序：① 每会话超限 ⇒ 先搬**这个会话自己**最老的；② 每副本总量还超 ⇒ 跨会话搬最老的
  （会话级是「更具体」的原因，搬它不伤别的会话；副本级是乘积效应的兜底）。
- **先落盘、后删行**：落盘失败 ⇒ **一行都不删**（热表里还留着，下次再搬）；反过来（先删后写）一旦落盘失败
  就是**数据丢失** —— 比「表大了一点」严重得多。副本根查不到 ⇒ 同样不删（写错地方比不写更糟）。
- 只搬**刚好超限**的那几行（归档文件也是有界的资源）。

## 5. 写入路径接线（触发点）

| 写路径 | 接线 | 触发的池 |
|---|---|---|
| `electron/main.ts` 的 `game:saveCharacters` | `filterCharactersWithinCapacity` ⇒ 拒新的不写、老的照写 | `characters` |
| `roster-materializer.ts` 的 `materializeRosterCharacters` | 全局预算（`MAX_CHARACTERS_TOTAL - countCharacters`）用尽 ⇒ 本轮不再物化 | `characters` |
| `service/storage.ts` 的 `persistSessionEvent` | 写完事件立刻 `guard.enforce(...)` ⇒ 超限滚动归档最老 | `session_events` |
| `service/stratix-service.ts` 的删角色 | 成功删 ⇒ `storage.deleteCharacter` ⇒ `deleteCharacterCascade` | `exp_events` / `unit_positions` |

组合根（`stratix-gateway/index.ts`）：造**一份**实例注册表 ⇒ 组合根用它装载副本、
容量守门用它定位副本根（`createInstanceRootResolver`）；守门件（`createSessionEventArchiver`）
注入给存储件。`boot.ts` 的 `ServiceBootOptions` 加了可选 `instanceRegistry`
（缺省自己造一份 ⇒ 单测与嵌入式用法零改动）。

**why 事件要补 `instance_id` 写侧**：容量按**副本**计账 ⇒ 事件行不带归属 ⇒ 计账落不到副本头上
（COALESCE 把它们全算进默认沙盒）。事件**继承会话的归属**（`sessions.instance_id`）——
不新增 core 契约，且与落库同一条口径（`appendSessionEvent` 与守门都用 `lookupSessionInstanceId`）。

## 6. 改动文件清单

| 文件 | 性质 | 改了什么 |
|---|---|---|
| `src/core/capacity.ts` | **新增** | 四个上限常量 + `CAPACITY_LIMITS`（常量唯一出处） |
| `src/app/services/persistence/capacity-limits.ts` | **新增** | 三池的计数 / 判定 / 护栏 / 随行清理 / 待归档行选取（零 IO） |
| `src/app/services/persistence/session-event-archive.ts` | **新增** | 滚动归档（jsonl 行格式 + 守门端口；先落盘后删行） |
| `src/app/__tests__/persistence/capacity-limits.test.ts` | **新增** | 20 条用例（三池 + 边界 + 常量可调 + 归属继承） |
| `src/app/services/persistence/game-save-dao.ts` | 改 | 角色行写 `instance_id`（冲突时 `COALESCE` 不清原值）+ 读口带出归属 |
| `src/app/services/persistence/character-record.ts` | 改 | 视图 ⇄ 记录带上 `instanceId`（缺省不带该键 ⇒ 往返保真） |
| `src/app/services/persistence/session-dao.ts` | 改 | 会话行写 / 读 `instance_id` |
| `src/app/services/persistence/session-event-dao.ts` | 改 | 事件行写 `instance_id`（继承会话归属）+ `lookupSessionInstanceId` 导出 + 索引顺序修正 |
| `src/app/services/persistence/session-persister.ts` | 改 | 会话记录带上归属 |
| `src/app/services/persistence/roster-materializer.ts` | 改 | 全局预算（512）用尽 ⇒ 拒新（不物化） |
| `src/electron/main.ts` | 改 | `game:saveCharacters` 加容量护栏（拒新 / 改档照写） |
| `src/stratix-gateway/service/storage.ts` | 改 | 事件写口接守门；新增 `deleteCharacter` 写口（随行清理） |
| `src/stratix-gateway/service/stratix-service.ts` | 改 | 删角色成功后联动落库侧随行清理 |
| `src/stratix-gateway/service/boot.ts` | 改 | `ServiceBootOptions` 加可选 `instanceRegistry`（注册表**一份**） |
| `src/stratix-gateway/index.ts` | 改 | 组合根：造注册表 + 守门件，注入存储件与 boot |

## 7. dsh 双面向

- **用**：dsh 的会话 log 有**体量纪律**（`ignorable` / 归档）⇒ Stratix 侧的对应物是
  **落库层的同款滚动思路**：默认沙盒同样是一个实例（COALESCE 口径 ⇒ 旧行归它名下），
  它的 `session_events` 也吃**每会话 512 / 每副本 4096** 两条线，超出的**最老**事件
  搬进 `<副本根>/.stratix/history/session-events-YYYYMM.jsonl`（append-only，历史不丢），
  `characters` 也吃 64 / 512 两条线 —— **dsh 不是例外，只是另一个实例**。
- **暴露**：**事件订阅面** —— 容量状态已经是**可观测的 outcome**（`{ archived, archivePath, reason }`，
  写口逐次落进 service 日志：搬了几条 / 为什么没搬），将来可作为**健康指标**接到事件订阅面
  （本单**未**新建订阅面：出口留好，口子不新开）。

## 8. 验证

```
npx tsc --noEmit                                   → 通过（无输出）
npx jest src/app/__tests__/persistence/capacity-limits.test.ts --maxWorkers=1
  → 20 passed / 20
npx jest src/app/__tests__/persistence --maxWorkers=2  → 30 suites, 274 passed, 0 failed
npx jest src/stratix-gateway src/electron --maxWorkers=2 → 31 suites, 338 passed, 0 failed
npx jest --maxWorkers=2 --silent                   → 345 suites, 5928 passed, 6 skipped, 0 failed
npx eslint --cache <改动的 15 个文件>               → 0 新增问题（10 个 import/order 是改动前既有，
                                                     已用 HEAD 版本逐文件对照确认基线同为 10 条）
```

**已知遗留（如实记录）**：
① **事件订阅面**上的容量状态**未**做成正式的健康指标（outcome 已可观测 + 已落日志，出口留好）；
② 角色删除走的是 service 组合根的显式删路径（`storage.deleteCharacter`）——
   electron 渲染侧直删角色的老路径**不**联动清理从属行（那条路径本就只回写档案，不删行）；
③ `MAX_CHARACTERS_TOTAL` 满了之后**没有**淘汰策略（设计如此：角色是用户资产，宁可拒新也不静默删）。

## 9. 与 rubric 验收标准的对应

| 验收 | 落点 |
|---|---|
| ① 三池上限各自有测试（含边界：超限拒新 / 归档最老） | §2–§5；用例「每副本 64：满位后新建被拒」「全局 512：跨副本满位后新建被拒」「每会话 512：第 513 条落库后最老的一条被搬进 history/」「每副本 4096：跨会话总量超限 ⇒ 归档最老的」 |
| ② `exp_events` / `unit_positions` 随行清理 | §5 删角色链路；用例「删角色 ⇒ 它的经验事件与站位一起没了（不留孤儿行）」 |
| ③ 常量集中可调 | §2（`core/capacity.ts` 唯一出处）；用例「四个上限常量集中在 core/capacity.ts，值与设计一致」「守门的上限可被覆盖 ⇒ 调一处即生效」 |
