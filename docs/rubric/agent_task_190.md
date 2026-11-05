# agent_task_190 —— M1 端到端验收（M1-16）：切副本零残留 + 切回数据完整 + 零 DDL 工作文档

> 任务：task_190 —— docs/DESIGN-project-map.md §7.1 表格「**M1-16**」行（唯一权威）。
> 前置：M1-01…M1-15 全完成（验收前 HEAD `f64559b`）；设计冻结点 `dbaa85b`。
> 分支：demo/v3.3（commit 前缀 v3.3）。日期：2026-11-06。

## 1. §7.1「M1-16」行 → 落地

| §7.1 要求 | 落地方式 |
|---|---|
| **测试脚本**：进默认沙盒 → 造单位/任务 → 切到第二个副本 → 断言**无残留**（单位表空、地图槽归零、种子键分家）→ 切回 → 断言数据**还在** | `e2e-tests/m1-instance-switch.e2e.mjs`（驱动 + 断言）+ `e2e-tests/m1-instance-switch/instance-switch-process.ts`（战场侧进程，只如实回报所见） |
| **① 切副本不串数据**（三条断言全过） | 单位表空 / 地图槽归零 / 站位种子键分家 —— 逐条独立断言，且**先证沙盒侧非空**（`units=1`、`nextSlot=1`）⇒「B 侧是空」不是空断言 |
| **② 切回后旧数据完整**（不是被清空） | 角色 / 单位 / 任务**在 store 里还在** + 战场上单位回来了 + 站位坐标与移动终点逐值相同 + **库里那几行与造完数据时逐项相同** |
| **③ 零 DDL**（库结构与 M1 前**逐字节一致**） | 两侧对照，缺一不可：<br>**源码侧**：`git diff dbaa85b..HEAD` 对建表/加列的那 10 个文件**必须为空**；<br>**产物侧**：把 `dbaa85b` 用 `git archive` 展开成临时代码树，**用那棵树的代码**建一次库抄 `sqlite_master`（基线），与本轮真实开出来的库**逐字节比较**（130 行全等）+ `PRAGMA schema_version` 相同 + 全表定义无 `instance_id` |
| **第二个副本用测试夹具目录 + 最小 `.stratix`** | `e2e-tests/fixtures/m1-instance-b/`（入库）—— 形状照 M0-08 夹具 `m0-project`（同 `links.dsh` 字段、同 `.stratix/{project.json,config,roster}` 契约面 + `AGENTS.md`） |
| **通过 `project.enter`/`project.exit` 走真实 core runtime 链路** | 两条命令都经 `emitCommand` → core runtime 裁决 → app 侧装载端口读库 → store 全量替换 → state 广播 → world 桥接层按副本过滤 → 战场场景重建 |

## 2. 验收**发现的真实缺陷**（本单的主要产出）

**M1-11 的「种子键按副本分区」在场景侧有一处漏口**，被本验收脚本抓出来：

- **现象**：切到第二个副本时，场景 `create()` 里读站位种子用的是 `this.bridge.scope()` —— 桥接层的 scope 初值**恒是默认沙盒**（场景刚 new 出来，要等下一次 state 广播才拿到本次的 `activeInstanceId`）⇒ **A 副本的单位 id 漏进 B 副本的种子**。
- **为什么这是个真漏口**：它**不报错**、不崩溃 —— B 副本本来就没有单位，所以 A 的站位 id 只是静静躺在 B 的种子键里，等 B 有了自己的单位才会显形。设计 §7.1 M1-11 行③ 点名禁止的正是这种「只是不报错」的漏法。
- **修法**（`src/world/scenes/BattlefieldScene.ts`，8 行）：种子 scope 改用 **`this.instanceId` 优先**（`init()` 从 scene data 冻结下来的**本次真正进入的副本 id**），没有 `instanceId`（开机直接进战场）才回落 `bridge.scope()`（= 默认沙盒，老行为不变）。
- **证据**：把该修复回退到 HEAD 状态后重跑验收脚本 ⇒ **红**，且红在正地方：

  ```
  [e2e] 剧本失败： Error: 断言失败：① 切到第二个副本：站位种子键分家（B 那份不含 A 的单位 id）
  （B 种子单位=["unit_character_1793907708449_1"]）   ← A 的单位 id 漏进了 B
  ```

  修复后 ⇒ 绿（`B 种子单位=[]`）。**这条断言就是为这个缺陷写的**，且它抓到了。

## 3. 交付物

| 文件 | 职责 |
|---|---|
| `e2e-tests/m1-instance-switch.e2e.mjs`（新） | 驱动脚本：铺夹具 → 建 M1 前基线 → 两阶段跑 → **33 条断言**（断言全在这一层，进程层只回报所见） |
| `e2e-tests/m1-instance-switch/instance-switch-process.ts`（新） | 战场侧进程：`seed` / `switch` 两阶段；装配照抄 `src/stratix-gateway/service/boot.ts` 的生产组合根顺序 |
| `e2e-tests/m1-instance-switch/schema-baseline.ts`（新） | 「M1 前」库结构基线快照程序（动态 import + 环境变量给根 ⇒ 同一文件能跑在展开出来的旧代码树里） |
| `e2e-tests/m1-instance-switch/fake-cli.ts`（新） | CLI 替身（只回报所见：cwd + prompt）；替掉的**只有最后一跳**，派发链其余全是真链路 |
| `e2e-tests/m1-instance-switch/phaser-stub.ts`（新） | Phaser 最小桩（node 里跑不了真 Phaser）；场景的**业务逻辑一行没改**（跑的是真类） |
| `e2e-tests/m1-instance-switch/scene-manager-stub.ts`（新） | 场景管理器桩，按 **Phaser 3.90 真实语义**复刻（`start` ⇒ 已在跑则先 shutdown 再 init→create；**场景实例被复用** —— 残留的根因） |
| `e2e-tests/m1-instance-switch/tsconfig.json`（新） | `phaser` 模块 → 本地桩；**同时**把真实 phaser 的 `.d.ts` 拉进来（`files`）⇒ src/world 里几百处 `Phaser.Scene` 的全局命名空间认得出类型 |
| `e2e-tests/fixtures/m1-instance-b/`（新，入库） | 第二个副本的最小 `.stratix` 契约面 + `AGENTS.md` |
| `src/world/scenes/BattlefieldScene.ts`（改） | §2 的种子 scope 修复 |

## 4. 三个设计决定（为什么这么搭）

| 决定 | 为什么 |
|---|---|
| **分两个进程**（`seed` → `switch`） | 站位种子是**启动读档**时写进键仓的（组合根 preBoot）。同一个进程里造完数据再切副本，读档那一步根本没发生过，**种子分区无从验**。分进程 = 真的重启一次，读档走**生产代码**（`game-save-coordinator` + 一次性迁移）。 |
| **只替三处，且都是生产里本来就有的接缝** | ① Phaser 本体（node 跑不了；替掉的只有渲染/输入/动画，场景业务逻辑是**真类**）；② CLI 二进制（真 claude 不在本机、也不该在验收里真花钱；替掉的**只有最后一跳**）；③ 渲染侧存档 IPC（换成直连 DAO，与 `src/electron/main.ts` 的 handler **同一个函数**；被换掉的只是**传输**，落库口径一字未改）。 |
| **零 DDL 用「源码 + 产物」两头对照** | 只比对库结构，可能「两棵树恰好建出一样的库」却掩盖了 DDL 源码已改；只比对源码，又可能「源码没改但迁移路径变了」。两头都对上，零 DDL 才是**可复算的事实**。 |

## 5. 负向对照（脚本不是「永远绿」）

验收脚本必须**能变红**，否则它不证明任何事。做了两次负向对照，两次都红在正地方：

| 注入的缺陷 | 结果 |
|---|---|
| 把 `unitPositionSeedKey` 退回**全局单键**（假装没做分区） | **红**（exit 1）：`① 切到第二个副本：键仓里 A 的那份种子仍在原地（分家 ≠ 丢失）—— 沙盒种子单位=[]` |
| 回退 `BattlefieldScene` 的种子 scope 修复（= HEAD 状态） | **红**（exit 1）：`① 切到第二个副本：站位种子键分家（B 那份不含 A 的单位 id）—— B 种子单位=["unit_character_..."]` |

## 6. 验证（实测输出）

**验收脚本**（`node e2e-tests/m1-instance-switch.e2e.mjs`，连跑 3 次均 exit 0）：

```
[e2e] M1 前基线提交 dbaa85b（v3.3(164): 设计冻结+M1拆分建议）
[e2e] ✓ ③ 源码侧零 DDL：建表 / 加列的文件从 M1 前到现在一字未改 — git diff 为空
[e2e] ✓ M1 前基线快照已产出 — .../pre-m1-schema.json
[e2e] ✓ 造的单位真跑完了一单（task → completed） — status=completed
[e2e] ✓ 那单真落了库（character_tasks 有这一行） — 落库=completed
[e2e] ✓ 造的数据都真落库了（characters / unit_positions / character_tasks 各 ≥1 行） — {"characters":1,"unitPositions":1,"characterTasks":1}
[e2e] ✓ 子进程回报可解析（真派过这一单，完整往返） — marker=e2e-m1-fake-cli
[e2e] ✓ 子进程 cwd == 默认沙盒（进程 cwd 快照） — child=/private/var/folders/.../stratix-m1-e2e-rRsJwl
[e2e] ✓ 造完数据后进了默认沙盒 — ["wsp_sandbox"]
[e2e] ✓ ① 切到副本前：沙盒里确有单位（无残留断言不是空断言） — units=1
[e2e] ✓ ① 切到副本前：沙盒里地图槽非零（有任务占格 ⇒ 后面「归零」可判） — nextSlot=1
[e2e] ✓ ① 切到第二个副本：活跃副本确实是它 — active=wsp_instance_b
[e2e] ✓ ① 切到第二个副本：战场场景重建在它名下 — scene.instanceId=wsp_instance_b
[e2e] ✓ ① 切到第二个副本：单位表空（不串 A 的单位） — units=0
[e2e] ✓ ① 切到第二个副本：地图槽归零 — nextSlot=0
[e2e] ✓ ① 切到第二个副本：站位种子键分家（B 那份不含 A 的单位 id） — B 种子单位=[]
[e2e] ✓ ① 切到第二个副本：键仓里 A 的那份种子仍在原地（分家 ≠ 丢失） — 沙盒种子单位=["unit_character_1793907807589_1"]
[e2e] ✓ ① 切到第二个副本：store 里没有 A 的角色 / 任务（零残留） — {"units":0,"characters":0,"tasks":0,"missions":0}
[e2e] ✓ ① 旧全局种子键已删（不留回落口 ⇒ 旧数据不会漏进别的副本） — legacyPresent=false
[e2e] ✓ ② 切回默认沙盒：活跃副本回来了 — active=wsp_sandbox
[e2e] ✓ ② 切回默认沙盒：store 里角色 / 单位 / 任务都还在 — {"units":1,"characters":1,"tasks":1,"missions":0}
[e2e] ✓ ② 切回默认沙盒：战场上单位回来了 — units=1
[e2e] ✓ ② 切回默认沙盒：站位还在（还是移动落库的那个点） — 位置={"x":640,"y":360} 期望={"x":640,"y":360}
[e2e] ✓ ② 切回默认沙盒：库里那几行没被清空（与造完数据时逐项相同） — {"characters":1,"unitPositions":1,"characterTasks":1} vs {"characters":1,"unitPositions":1,"characterTasks":1}
[e2e] ✓ ③ 库结构与 M1 前逐字节一致（sqlite_master 全量行相同） — 本轮 130 行 / M1 前 130 行
[e2e] ✓ ③ 库结构里没有 instance_id 列（M1 不加列） — 全表定义中无 instance_id
[e2e] ✓ ③ PRAGMA schema_version 与 M1 前一致 — [{"schema_version":99}] vs [{"schema_version":99}]
[e2e] ✓ 控制面：实例清单对宿主可见（默认沙盒 + 第二个副本） — wsp_sandbox,wsp_instance_b
[e2e] ✓ 控制面：第二个副本没落下归档文件（无未终结 mission ⇒ 不该有） — []
──────────────── 验收摘要 ────────────────
断言：33/33 通过
结论：PASS（M1 端到端验收：切副本零残留 + 切回数据完整 + 零 DDL）
────────────────────────────────────────────
```

**类型检查**：`npx tsc --noEmit` → **无输出（绿）**；`npx tsc -p e2e-tests/m1-instance-switch/tsconfig.json --noEmit` → **CLEAN**。

**单元测试**：`npx jest src --silent --maxWorkers=2` → `Test Suites: 262 passed, 262 total / Tests: 4186 passed, 4186 total`。

**Lint**：`npx eslint --cache --max-warnings 200 src/world/scenes/BattlefieldScene.ts` → **exit 0**（仓库 lint 门只覆盖 `src`；`e2e-tests/` 与仓库既有 `m0-project-context` / `session-domain` / `service-resident` 同处门外，不是本单引入的偏差）。

## 7. dsh 双面向（§7.1 行要求各一句）

- **用**（Stratix 用 dsh）：借 dsh 的 **`session/query` ——「一条线缆入口跑完整会话」的形状**：验收脚本不拆成几段单测，而是 `seed` → `switch` **两个进程跑完整往返**（派单真起子进程 → stdout 回传 → 落库 → 重启读档 → 切副本 → 切回），一次跑完一条线缆。
- **暴露**（Stratix 被 dsh 嵌入）：**宿主可见控制面** —— 脚本里已断言**实例清单对宿主摊开可见**（`wsp_sandbox` + `wsp_instance_b` 都在 `worldState.projectInstances` 里，宿主能列举、能 `project.enter` 切进去）；这条脚本将来就是 `ctx.remote.stratix` 的**集成测试基线**（插件化后必须在**同一 scope** 内跑通）。

## 8. M1 是否收口

**判定：M1 可收口。** §7.1 的 M1-16 三条断言全过（33/33），且验收过程中**发现并修掉了 M1-11 的一处真漏口**（场景侧种子 scope 读错副本 ⇒ A 的单位 id 漏进 B）—— 也就是说，这张收口单不只是「把已有实现测一遍」，它**真的把 M1 的最后一个洞补上了**。

**遗留（不阻塞 M1 收口）**：零 DDL 期的诚实边界 —— 库里没有 `instance_id` 列 ⇒ **除默认沙盒外的副本在库里没有自己的行**（`instance-loader-node.ts:130` 的诚实答案），本单断言的是「B 侧是空的」，不是「B 侧有自己的一份」。这与 M2 加列的分工一致。
