# task_204 工作文档 —— M2-07（managers 按 instance 过滤）

> 分支 `demo/v3.3`；权威依据：`docs/DESIGN-project-map.md` §1.4（B4a 行：**裁剪入参改为已按 instance
> 过滤的数组** ＋ **依赖判定隔离**）＋ §4.2 表第 3 行（依赖判定会跨 project 误判）
> ＋ §6.2「M2 的改动面」core 行。
> 前置：M2-01（`25eef04` 六表加 `instance_id` 列 + COALESCE 命中口径）。

## 1. 本单范围

| 改动点 | 权威位置 | 本单是否做 |
|---|---|---|
| `mission/manager.ts:239` 裁剪入参 | §1.4 M2 行 | ✅ 做 |
| `task/manager.ts:220` 裁剪入参 | §1.4 M2 行 | ✅ 做 |
| `session/manager.ts:345` 裁剪入参 | §1.4 M2 行 | ✅ 做（并**同源**修 `session/manager.ts` 的 fork 分叉入口 —— 同一处裁剪口径的第二个调用点，留着就是漏口） |
| `mission/machine.ts:346-365` 依赖判定隔离 | §1.4 M2 行 / §4.2 表第 3 行 | ✅ 做 |
| 落库表跨 instance 总量上限（`MAX_CHARACTERS_TOTAL` / `session_events` 滚动归档） | §1.4 M2 行右列 / B4b | ❌ 不做（= **M2-08**，独立排期） |
| DAO **写侧**补 `instance_id`（tasks / sessions 落库时写副本列） | — | ❌ 不做（**M2-01 只做了列 + 读口过滤**，写侧仍是欠账；见 §8 已知遗留） |

## 2. 归属口径的**唯一**出处（新建文件）

新增 `src/core/project/entity-scope.ts`：

| 导出 | 作用 |
|---|---|
| `scopeOf(instanceId)` | COALESCE 口径：缺省 / null ⇒ **默认沙盒**（`DEFAULT_INSTANCE_ID`） |
| `inInstanceScope(entity, instanceId)` | 实体是否属于目标副本（两边都归一再比） |
| `filterInstanceScope(items, instanceId)` | 按副本过滤数组（保持原序） |
| `mergeScopedTrim(original, scoped, kept)` | 裁剪后**拼回**原数组（见 §3） |

**why 单独成文件**：这条口径已经被**三层**消费 ——
① 落库层（`app/services/persistence/instance-scope.ts` 的 SQL 谓词，task_198）；
② 表现层（`world/bridge` 的转发过滤，task_184 / M1-10）；
③ 数据 / 编排层（本单：managers 的裁剪 + machine 的依赖判定）。
各写一份必然漂移 —— 同一批旧行在不同层落进不同副本 ⇒ 老数据「部分消失」
（落库层 `instance-scope.ts` 文件头已就这条口径写过同款纪律）。
本单把桥接层那份**本地副本**（`bus-adapter.ts` 的 `scopeOf`）也改成 import core 的，
并让 `core/project/instance-display.ts` 的 `tasksOfInstance` 改委托 `filterInstanceScope`
⇒ 归属口径全仓**只有一份**。

## 3. 三处裁剪：喂已过滤的数组 + **拼回**别副本的条目

```ts
const scope = scopeOf(state.activeInstanceId);              // 缺省 ⇒ 默认沙盒
const scoped = filterInstanceScope(state.missions, scope);   // 裁剪只吃本副本
const kept = dropSettledMissions(scoped, this.maxMissions - 1);
if (kept.length >= this.maxMissions) { /* 拒绝新建 */ }
const missions = [...mergeScopedTrim(state.missions, scoped, kept), mission];
```

**why 裁剪后要拼回**（而不是直接用 `kept` 当整份数组）：
上限是**每副本**的（design §1.4 B4a「副本配额不互相挤」）⇒ 别的副本的条目
既不占本副本的位子，也不该被本副本的裁剪**顺手丢掉** —— `missions` 是**纯内存态**
（不落库），丢了**不可恢复**。`mergeScopedTrim` 保留原数组里不属于本副本的条目，
并保持存活条目的原有相对顺序（裁剪只决定「丢不丢」，不决定「谁在前」）。

## 4. 依赖判定隔离（`mission/machine.ts`）

`resolveMissionDependencies` 原来用 `new Map(allMissions.map(...))` 建**全量索引**
⇒ A 副本的任务可以依赖到 B 副本的任务 id，并被 B 的相位判「未满足」（跨副本误判，会把 A 永久锁住）。

改法：**先按副本过滤再建 Map**（过滤基准 = **被判定任务自己的归属**）：

```ts
const byId = new Map(
  filterInstanceScope(allMissions, scopeOf(mission.instanceId)).map((m) => [m.id, m])
);
```

隔离后跨副本的依赖 id **查不到** ⇒ 沿用本文件既有口径「查不到即已满足」⇒ 不阻塞本副本的任务。
放在 `machine.ts`（而不是各调用点）⇒ **判定口径只有一份**：core 的 confirm 守门、
HUD 的依赖行（`hud/panels/mission-confirm.ts`）、MCP 工具（`stratix-gateway/mcp/tools/mission.ts`）
三处调用点自动继承隔离，不用各改一遍。

## 5. 新建实体要**盖上副本归属**（否则过滤形同虚设）

归属过滤的前提是实体**带着** `instanceId`。加载侧已经这么做了
（`instance-loader-node.ts` 的 `read()` 给 missions / tasks / sessions / characters / units
统一盖 `instanceId`）；**写入侧此前是缺的** —— core manager 建出来的新实体没有归属字段，
在 COALESCE 口径下会落进「默认沙盒」名下 ⇒ 在别的副本里既不进本副本的配额统计，
也会被桥接层（M1-10）过滤掉（在场景里看不见）。

本单在三个 manager 的建实体处补盖（`createMission` / `createQueuedTask` / `createSession`，
外加会话 fork 的新记录），口径与加载侧**同款**：盖当前活跃副本 id（缺省 ⇒ 默认沙盒）。
纯工厂（`createMission` / `createQueuedTask`）的入参加**可选** `instanceId`，
不传时**不落该键** ⇒ 形状与 M2-07 之前一致（沙盒路径行为不变，验收③）。

## 6. 改动文件清单

| 文件 | 性质 | 改了什么 |
|---|---|---|
| `src/core/project/entity-scope.ts` | **新增** | 归属口径唯一出处：`scopeOf` / `inInstanceScope` / `filterInstanceScope` / `mergeScopedTrim` |
| `src/core/mission/manager.ts` | 改 | 裁剪入参改「已按 instance 过滤的数组」+ 拼回别副本条目 + 新建任务盖归属 |
| `src/core/task/manager.ts` | 改 | 同上（tasks） |
| `src/core/session/manager.ts` | 改 | 同上（sessions，含 fork 入口的第二处裁剪） |
| `src/core/mission/machine.ts` | 改 | ① 依赖索引**先按副本过滤再建 Map**；② `createMission` 入参加可选 `instanceId` |
| `src/core/task/machine.ts` | 改 | `createQueuedTask` 入参加可选 `instanceId` |
| `src/core/project/instance-display.ts` | 改 | `tasksOfInstance` 改委托 `filterInstanceScope`（口径合一） |
| `src/world/bridge/bus-adapter.ts` | 改 | 本地 `scopeOf` 副本删除，改 import core 的（口径合一，行为不变） |
| `src/core/__tests__/instance-scope-filter.test.ts` | **新增** | 13 条用例：三个 manager 的配额隔离 / 裁剪隔离 / 归属盖印 / 沙盒路径不变 ＋ machine 的依赖隔离 |

## 7. dsh 双面向

- **用**：dsh 的 `ScopedLayers` 注册表本身是 **scope 感知的** ⇒ Stratix 侧的对应物是
  **数据 / 编排层的 scope 感知**：过滤落在 **manager 入口**（写面：裁剪、配额、依赖判定），
  而不是只落在表现层 ⇒ 宿主看到的 mission / task / session 列表**自动限当前 instance**
  （配额不互相挤、依赖不跨副本）。
- **暴露**：**事件订阅面** —— 事件载荷里的实体带着自己的 `instanceId`（新建即盖），
  订阅者按 `scopeOf(entity.instanceId)` 判定归属即可；桥接层（M1-10）已按同一条口径过滤转发。

## 8. 验证

```
npx tsc --noEmit                                   → 通过（无输出）
npx jest src/core/__tests__/instance-scope-filter.test.ts --maxWorkers=1
  → 13 passed / 13
npx jest src/core --maxWorkers=2 --silent           → 43 suites, 881 passed, 0 failed
npx jest --maxWorkers=2 --silent                   → 344 suites, 5908 passed, 6 skipped, 0 failed
npx eslint --cache <改动的 8 个源文件>              → 0 problems
```

**已知遗留（不属本单，如实记录）**：
落库侧**写** `instance_id` 仍是欠账 —— M2-01 只加了列与读口过滤（`COALESCE` 命中），
`task-record-dao.upsertTask` / `session-dao` 的写路径**不写** `instance_id` ⇒
非沙盒副本里新建的任务/会话落库后仍是 `NULL`（读时归默认沙盒）。
本单只改 core 的内存态归属（盖 `instanceId`），**未碰 DAO**；该写侧欠账归 M2-09（orchestration 统一 instance 维度）。

## 9. 与 rubric 验收标准的对应

| 验收 | 落点 |
|---|---|
| ① 三 manager 切副本后只见当前 instance 数据 | §3 的三处裁剪（配额按副本计、裁剪只吃本副本）+ §5 的归属盖印；用例「A 副本满位时拒绝新派，别副本的条目一条都不动」（三个 manager 各一条） |
| ② 依赖判定（machine）不跨 instance 建依赖 | §4；用例「跨副本的依赖 id 查不到 ⇒ 不阻塞本副本的任务」 |
| ③ 既有单实例测试全绿（沙盒路径行为不变） | 全量 jest 344 suites / 5908 passed；另有用例「沙盒路径行为不变」显式锁住未标注归属的沙盒口径 |
