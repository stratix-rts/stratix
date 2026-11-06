# task_210 工作文档 —— M2-11（`unit_positions` 写侧补 `instance_id`）

> 本单是 M2 收口后剩的**最后一个写侧口**。M2-10（task_207）的验收如实记下它，M2-11 把它补掉。

## 1. 本单是什么

**欠账**：`unit_positions` 表的 `instance_id` 列（M2-01 加的）与读口过滤（M2-01 补的，`loadUnitPositions`
按 `COALESCE(instance_id, 'wsp_sandbox')` 命中）都在，但**写侧一直没写** ⇒ 站位行永远落 `NULL`
⇒ 按步 N2 的 COALESCE 口径全部算进**默认沙盒** ⇒ **非沙盒副本读站位读不到**
（反倒污染沙盒的池子）。与 `characters` / `character_tasks` / `sessions` / `session_events`
的写侧欠账同一族，前几族已在 M2-05…M2-10 补齐，本单是**最后一个**。

**写口的形状**（这是本单的难点）：

```
world 事件 unit.position
  → 渲染侧 game-save-coordinator（防抖 3s 批量）
    → IPC game:saveUnitPositions（electron 主进程）      ← 这一层拿不到副本归属
      → DAO upsertUnitPositions
```

主进程那一层**不知道当前是哪个副本**（副本归属是渲染侧的 store 状态）。所以修复必然要动
**契约 + preload + 渲染调用点**三处 —— 与 M2-10 记账时预判的一致。

## 2. 方案选择：载荷带归属 vs 主进程自己取活跃副本

**选定：归属随 IPC 载荷一起过去**（`PersistedUnitPosition.instanceId?` 可选字段）。

**why（理由）**：

| 方案 | 代价 | 为什么不选 |
|------|------|------------|
| **A. 载荷带归属**（选定） | 渲染侧多盖一个字段；契约加一个可选键 | — |
| B. 主进程自己取活跃副本 | 主进程要**另建一份**「当前是哪个副本」的状态：一条新的同步通道 + 一份生命周期（进副本 / 退副本 / 沙盒态三个来源） | 口径分裂到两个进程 ⇒ 两侧的「当前副本」可能不一致（写入时用旧值、读时用新值）⇒ 又是一笔难查的隔离 bug；且 B 解决不了「防抖窗口内切副本」的归属错配（归属得在**事件到达时**定，不是落库时） |

**关键的时序判断**：归属在**事件到达时**取（`unit.position` 到达那一刻），**不是落库时**取。
why：防抖窗口默认 3s，窗口内可能切副本 ⇒ 落库那一刻再取，会把**上一副本的坐标**盖上**下一副本的归属**
（归属错配比不写归属更隐蔽：行落在错误的副本下，沙盒与副本两边都读不对）。

**归属源 = `store.getState().activeInstanceId`**（`scopeOf` 归一 ⇒ 缺省/null 归默认沙盒）——
与 M1 bridge 的过滤同源（`world/bridge/bus-adapter.ts` 的 `currentScope = scopeOf(state.activeInstanceId)`），
与任务的「来源与 M1 bridge 过滤同源」要求一致。

**沙盒为什么「不带归属」而不是显式写 `'wsp_sandbox'`**：
统一写会把「未归属」的老行改写成「显式归属沙盒」（一次真实的数据改写），与步 N2「落库不改写」相悖；
而 COALESCE 口径下两者**读起来完全等价** ⇒ 没有收益，只有风险。⇒ 沙盒路径**逐字节不变**。

## 3. 改动文件清单（三处联动 + 一处口径 + 一处读口）

| 文件 | 改动 |
|------|------|
| `src/app/services/persistence/game-save-dao.ts` | **契约**：`PersistedUnitPosition` 加 `instanceId?: ProjectInstanceId \| null`；`upsertUnitPositions` 的 INSERT 带 `instance_id`，冲突时 `COALESCE(excluded.instance_id, <原值>)`（**来件没带归属就不清原值**）；入库前洗一遍（非空字符串才算归属）；`loadUnitPositions` 把该列读出来（NULL ⇒ 不带这个键，往返保真） |
| `src/electron/preload.ts` | **preload**：条目可带 `instanceId`（原样透传，主进程那层不做归属裁决） |
| `src/electron/main.ts` | **IPC**：`game:saveUnitPositions` 注释写明「归属随条目一起过来 + 为什么不在主进程取」 |
| `src/app/services/persistence/game-save-coordinator.ts` | **渲染调用点**：`unit.position` 事件到达时取 `writeSideInstanceId(scopeOf(store.activeInstanceId))`，盖进缓冲条目 |
| `src/app/services/persistence/instance-scope.ts` | **写侧口径的唯一出处**：`writeSideInstanceId(scope)`（默认沙盒 ⇒ `undefined`＝不带归属；其它副本 ⇒ 显式带上） |
| `src/app/__tests__/persistence/unit-position-instance-id.test.ts` | **新增回归测试**（7 条） |

**为什么口径要单独成函数**（`instance-scope.ts`）：读侧 COALESCE 谓词、写侧载荷口径是**同一件事的两面**
（缺省/null ⇒ 默认沙盒）。两份实现必然漂移 ⇒ 老数据「部分消失」。该文件是该口径的唯一出处。

## 4. dsh 双面向

- **用**：dsh 的会话 log 有体量纪律 ⇒ Stratix 侧的对应物是**站位行按副本归属**：站位是
  「按 instance 归属的事实」（与 M1-11 的站位种子分区同款语义）⇒ 落库要带归属，
  否则副本里的坐标会被算进沙盒名下。**暴露**：不可见 —— 沙盒读不到别的副本的站位（读口按副本过滤）。
- **沙盒不是例外**：默认沙盒也是一个实例（COALESCE 口径），它的站位行**仍然是 NULL**
  （与写侧补齐前逐字节一致）⇒ 沙盒路径零变化。

## 5. 验证

### 5.1 类型检查

```
$ npx tsc --noEmit
（无输出 = 干净）
```

### 5.2 新增回归测试（7 条，全过）

```
$ npx jest src/app/__tests__/persistence/unit-position-instance-id.test.ts --maxWorkers=1
PASS src/app/__tests__/persistence/unit-position-instance-id.test.ts
  unit_positions 的 instance_id 写侧（task_210 / M2-11）
    ✓ ① 带归属写 ⇒ 落库行的 instance_id 就是它 (35 ms)
    ✓ ② 不带归属写 ⇒ 落 NULL（COALESCE 口径 ⇒ 归默认沙盒） (4 ms)
    ✓ ③ 更新已有行时不带归属 ⇒ 原值不被清空（COALESCE 语义：来件没带就不清） (4 ms)
    ✓ ④ 读写闭环：非沙盒副本写站位 ⇒ 本副本读得到，沙盒读不到（沙盒只读得到自己的旧行） (4 ms)
    ✓ ⑤ 脏归属（空串 / 非串）⇒ 按「未归属」处理（落 NULL，不让垃圾值进库） (3 ms)
    ✓ ⑥ 写侧载荷口径：默认沙盒 ⇒ 不带归属（行保持 NULL）；其它副本 ⇒ 显式带上 (3 ms)
  渲染侧：站位落库带上副本归属（task_210 / M2-11）
    ✓ ⑦ 非沙盒副本里写的站位带归属；沙盒里写的不带归属（沙盒路径与补齐前一致） (3 ms)

Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
```

### 5.3 相关面（persistence + electron + gateway）

```
$ npx jest src/app/__tests__/persistence src/electron src/stratix-gateway --maxWorkers=1
Test Suites: 66 passed, 66 total
Tests:       636 passed, 636 total
Snapshots:   0 total
Time:        9.787 s
```

### 5.4 全量

```
$ npx jest --maxWorkers=2
Test Suites: 350 passed, 350 total
Tests:       6 skipped, 5951 passed, 5957 total
Snapshots:   0 total
Time:        32.307 s
```

### 5.5 lint（只 lint 改动文件）

```
$ npx eslint src/app/services/persistence/game-save-dao.ts \
             src/app/services/persistence/game-save-coordinator.ts \
             src/app/services/persistence/instance-scope.ts
（干净，0 error 0 warning）
```

> 注：`src/electron/main.ts` / `preload.ts` 的 `import/order` 报错是**分支上既有的**
> （本单只在这两个文件加了注释，import 块与 HEAD 逐行相同）⇒ 不在本单范围内，顺手改是越界。

## 6. 回归对应（验收标准逐条）

| 验收项 | 落点 |
|--------|------|
| ① 非沙盒副本站位读写闭环有测试 | 测试 ④（DAO 层：A 读得到自己的、沙盒读不到）+ 测试 ⑦（渲染层：非沙盒写出的条目带归属） |
| ② 沙盒行为不变 | 测试 ②（沙盒写 ⇒ 落 NULL，与补齐前逐字节一致）+ 测试 ⑦ 后半段（沙盒写出的条目**不带** `instanceId` 键） |
| ③ tsc + 相关 jest 全绿 | §5.1 / §5.3 / §5.4 |

## 7. 如实记录的遗留（**未**在本单修）

1. **`unit_positions` 的读口在生产链路上仍未按副本过滤**：`game:loadSnapshot`（`main.ts`）与
   `world-restore.ts` 调 `loadGameSnapshot(db)` 都**没传** `instanceId` ⇒ 生产读口是「全表」。
   本单补的是**写侧**（欠账本体），读口那侧是另一笔（要在主进程拿活跃副本 ⇒ 与 §2 方案 B 同款代价），
   不在本单最小改动边界内。**注**：M1-11 的站位种子归属走的是**角色档案的归属**
   （`positionSeedOwner`：character.instanceId），不依赖本列 ⇒ 不影响种子恢复的正确性。
2. `characters` 表的复合唯一索引 `(role_id, instance_id)` 对 `unit_positions` 没有同款约束
   （站位表按 `character_id` 主键，一角色一行）—— 不是缺陷，是两表形状不同。
