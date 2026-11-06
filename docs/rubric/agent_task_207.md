# task_207 工作文档 —— M2-10（M2 端到端验收 / M2 收口单）

> 分支 `demo/v3.3`；权威依据：`docs/DESIGN-project-map.md` §1.3.2 **全节**（N1–N7 七步 +
> N4b 的可判定规则 + `externalSessionId` 的处置 + 回滚矩阵 + N4b 迁移验收清单 R1-41）
> + §1.4 **M2 行**（容量三池）。
> 前置：M2-01…M2-09 全部完成（`202e031` orchestration 统一 instance 维度）。
> 步号纪律：**M1–M6 = task_159 的存储迁移；N1–N7 = task_160 的 instance 维度附加**（两套编号语义不同）。

## 1. 本单是什么

M2 的**收口验收单**：不新增能力，只用**两个真实副本**（各自一份 `.stratix` 契约 + roster）
把 M2 的五组能力在**真实库**上真跑一遍，逐条断言。脚本形态照 M1-16 的验收范式
（`docs/rubric/agent_task_190.md`）：

| 角色 | 文件 | 职责 |
|---|---|---|
| **驱动层**（断言全在这里） | `e2e-tests/m2-end-to-end.e2e.mjs` | 铺夹具 → 跑场景进程 → 跑三个 CLI → **逐条断言** → 打印验收摘要 |
| **场景进程**（只回报所见） | `e2e-tests/m2-end-to-end/m2-scenario.ts` | 在临时库里造数据、观测，把观测值写成 `report.json` |
| **夹具**（入库） | `e2e-tests/fixtures/m2-instance-a/`、`m2-instance-b/` | 两个副本的最小契约面（`project.json` / `config/stratix.json` / `roster/*` / `AGENTS.md`） |
| **tsconfig** | `e2e-tests/m2-end-to-end/tsconfig.json` | 场景进程的 `@/*` 路径别名（`noEmit` 类型检查用） |

**why 断言不放场景进程里**：进程层一旦自己判「通过」，失败就会被吞掉。
驱动层拿的是**观测值**（行数 / id 集合 / 库里的原始 `instance_id` / CLI 的退出码与 stdout 原文），
不是「我说成功了」。

**跑法**（可重跑：每次都新建临时目录，跑完即删；`--keep` 保留现场）：

```
node e2e-tests/m2-end-to-end.e2e.mjs          # 断言全过 ⇒ 退出码 0
```

## 2. 五组断言与权威落点

| 组 | 断言（44 条中的核心） | 权威位置 |
|---|---|---|
| ① **副本间数据隔离** | 两个副本各自的 roster **物化**出自己的一行集；characters / tasks / sessions / events **互不可见**；旧行（`instance_id IS NULL`）与显式沙盒行**只归沙盒**（COALESCE 命中口径）；同名角色在两个副本里是**两行两 id**、各自养成互不干扰（A 的斥候 7 级 / B 的还是 1 级） | §1.3.2 步 **N1/N2/N6** |
| ② **容量上限生效** | 每 instance **64** 角色：满位后新建被拒（`instance-limit`）、老行改档照写；全局 **512**：满池后新副本建档被拒（`total-limit`）；`session_events` 每会话 **512** ⇒ 第 513 条把最老的一条搬进 `history/`；每 instance **4096** ⇒ 4608 条里搬走最老的 512 条、热表剩 4096；归档落在 `<副本根>/.stratix/history/session-events-YYYYMM.jsonl` | §1.4 M2 行 ①②（R1-20） |
| ③ **N4b 校验脚本可重跑** | 夹具库上迁移 `status=succeeded`（重写 3 行）；**校验脚本跑两次都退出 0 且 stdout 逐字一致**（幂等）；模块级两次报告一致；四条校验（行数不变 / `unit_positions` 落位 / `unit_id` 集合 / 引用可解析）全过 | §1.3.2 **N4b 的迁移验收清单（R1-41）第 ④ 步** |
| ④ **回滚矩阵演练** | 校验失败路径（任务指向不存在的角色）⇒ **整批回滚**、`characters.id` 一个没动；独立校验脚本对回滚后的库**判不通过**（退出码 1）；`participants` 坏 JSON ⇒ 整批回滚；**前滚回滚**（靠 `character_id_map` 反向 UPDATE）⇒ id 回到旧值；六步演练脚本整场跑通 | §1.3.2 **回滚矩阵（R1-38）** + 验收清单第 ⑤⑥ 步 |
| ⑤ **N7 归属迁移闭环** | 预览（列出将迁角色 / 任务、**无阻断项**、**一个字节都没改**）→ 执行（行迁进目标副本、源副本再预览 = 0 行）→ 撤销预览（列出可撤销行）→ 撤销（归属还原成迁移前的 NULL）；三个 CLI 入口（`preview` / `migrate --confirm` / `rollback --confirm`）逐个退出 0 | §1.3.2 步 **N7**（带预览 + 可撤销 + 必须先完成目标副本 N6 物化） |

**纪律**：全部在**临时库**上跑（`os.tmpdir()` 下的 `stratix-m2-e2e-*`），**不碰任何用户库**；
③/④ 用的 N4b 夹具是 `src/app/__tests__/persistence/helpers/n4b-fixture.ts` 造的**夹具库**，不是用户库。

## 3. 验收发现并修掉的缺陷（真缺陷，不是顺手改）

### `character_tasks` 的 `instance_id` **写侧**欠账（M2-01 只加了列与读口过滤）

- **症状**：副本里派的任务**在本副本读不回来**，反倒算进**默认沙盒**的池子。
- **根因**：`character_tasks.instance_id` 列（M2-01 加）与读口过滤（M2-01 补）都在，
  但 `upsertTask` **从不写这一列** ⇒ 任务行永远落 `NULL` ⇒ 按 COALESCE 口径（步 N2）
  全部归默认沙盒。characters / sessions / session_events 的同一族欠账在 M2-05…M2-08 已补，
  `character_tasks` 是**漏掉的那一个**。
- **修法**（三处最小改动，与 sessions / session_events 的写侧同款口径）：
  | 文件 | 改动 |
  |---|---|
  | `src/app/services/task-service.ts` | `TaskPersistRecord` 加 `instanceId?: ProjectInstanceId \| null`；`taskEventToRecord` 把 **core 盖的** `task.instanceId` 带进落库记录（core `task/manager.ts` 建任务时已盖 `instanceId: scope` ⇒ 真相源在 core 快照） |
  | `src/app/services/persistence/task-record-dao.ts` | `PersistedTaskRecord` 加 `instanceId?`；`upsertTask` 的 INSERT 带 `instance_id`，冲突时 `COALESCE(excluded.instance_id, <原值>)`（**来件没带归属就不清原值**）；`loadRecentTasks` 读出该列（NULL ⇒ 不带这个键，往返保真） |
  | `src/app/__tests__/persistence/task-instance-id.test.ts` | **新增**回归单测 5 条：带归属写 / 不带归属落 NULL / 更新时不清原值 / 读口按副本过滤 / app 层 `taskEventToRecord` 带归属 |

- **验收证据**：①组断言「任务行的 instance_id 真的落了库（写侧补齐后）—— A=wsp_m2_a B=wsp_m2_b 旧=null」。

## 4. 如实记录的遗留（**未**在本单修）

1. **`unit_positions` 的写侧同样不写 `instance_id`**（`game-save-dao.ts` 的 `upsertUnitPositions`
   的 INSERT 只有 `character_id, x, y, updated_at`）⇒ 站位行永远落 NULL ⇒ 按 COALESCE 归沙盒 ⇒
   **非沙盒副本读站位读不到**（读口 `loadUnitPositions` 是按副本过滤的）。
   **why 本单不修**：写口在 electron IPC `game:saveUnitPositions`，**那一层拿不到副本归属**
   （渲染层回写没带 instanceId）⇒ 修它要动契约 + preload + 渲染侧调用点，超出「验收单」的最小改动边界；
   且 §1.3.2 的 ① 断言清单（characters / tasks / sessions / events）本就不含站位。
   ⇒ 记为**待办**，与「渲染侧回写带上归属」一并处理。
2. **③ 的校验里 `participants-parse` 是 `warn` 不是 `pass`**：夹具里有一条非角色参与者
   （`link_abc`，link 会话 id）⇒ 非 `--strict` 下按设计只告警（保留不动）。不是缺陷。
3. **④ 失败路径的独立校验里 `characters-count` 也报 fail**：那是**没带迁移报告基线**时的正常表现
   （独立校验模式无基线可比 ⇒ 该项在「有基线」时是 pass，「无基线」时被 CLI 判成 fail）。
   真正检出问题的是 `task-refs`（悬空任务）—— 断言里点名了它。

## 5. dsh 双面向

- **用**：dsh 的会话 log 有**体量纪律**（`ignorable` + 归档）⇒ Stratix 侧的对应物在②组：
  **默认沙盒同样是一个实例**（COALESCE 口径 ⇒ 旧行归它名下），它的 `session_events`
  也吃**每会话 512 / 每副本 4096** 两条线，超出的**最老**事件搬进
  `<副本根>/.stratix/history/session-events-YYYYMM.jsonl`（append-only，历史不丢）——
  **dsh 不是例外，只是另一个实例**。
  副本维度也复刻了 dsh 的**同 session / 同 query 形状**：同一套 `session_id` / `seq` 协议，
  两个副本各跑一遍完整往返（建会话 → 追加事件 → 按副本读回）。
- **暴露**：**宿主可见控制面**的集成测试基线 —— 本单已经能证明：两个副本 id 与沙盒 id **三分**
  （`wsp_m2_a` / `wsp_m2_b` / `wsp_sandbox`），宿主能**分别列举、分别进入、分别读**（①组全部断言），
  且「读不到别的副本的行」这件事是**可断言**的（不是靠 UI 看不见来保证）。
  ⇒ 这是将来 `ctx.remote.stratix` 全套（控制面集成测试）的**地基**：
  副本的列举 / 进入 / 隔离三条语义现在就有可执行的验收口径。
  本单**未**新建订阅面 / 控制面接口（属将来增量）—— 只把地基的验收口径定下来。

## 6. 改动文件清单

| 文件 | 性质 | 改了什么 |
|---|---|---|
| `e2e-tests/m2-end-to-end.e2e.mjs` | **新增** | 驱动层：铺夹具 → 跑场景 → 跑三个 CLI → **44 条断言** → 验收摘要 |
| `e2e-tests/m2-end-to-end/m2-scenario.ts` | **新增** | 场景进程：五组观测（造数据 + 读回 + 写 `report.json`） |
| `e2e-tests/m2-end-to-end/tsconfig.json` | **新增** | 场景进程的 `@/*` 别名（`noEmit`） |
| `e2e-tests/fixtures/m2-instance-a/**` | **新增** | 副本 A 契约面（`project.json` / `config/stratix.json` / `roster/_index.json` + `scout` + `medic` / `AGENTS.md`） |
| `e2e-tests/fixtures/m2-instance-b/**` | **新增** | 副本 B 契约面（同上；`scout` + `engineer`） |
| `src/app/services/task-service.ts` | 改 | 任务落库记录带上 core 盖的副本归属（§3） |
| `src/app/services/persistence/task-record-dao.ts` | 改 | `character_tasks` 写 `instance_id` + 读出（§3） |
| `src/app/__tests__/persistence/task-instance-id.test.ts` | **新增** | 写侧回归单测 5 条（§3） |
| `docs/rubric/agent_task_207.md` | **新增** | 本文件 |

**未动**：`.long-run-agent/**`（任务台账由 `lra` 维护）、`HEARTBEAT.md`、`lra.md`、用户库、npm 依赖。

## 7. 验证

```
node e2e-tests/m2-end-to-end.e2e.mjs            → 断言：44/44 通过；结论：PASS（退出码 0）
                                                   （连跑三次均 44/44 PASS；断言行逐条相同，
                                                     仅临时目录路径 / 备份时间戳随运行变化）
npx tsc --noEmit                                  → 通过（无输出）
npx tsc -p e2e-tests/m2-end-to-end/tsconfig.json --noEmit → 通过（无输出）
npx jest src/app/__tests__/persistence src/app/__tests__/task-service.test.ts --maxWorkers=2
  → 33 suites, 358 passed, 0 failed（含新增 5 条写侧回归）
npx jest --silent                                 → 348 suites, 5939 passed, 6 skipped, 0 failed
npx eslint --no-cache src/app/services/task-service.ts src/app/services/persistence/task-record-dao.ts
  → 4 errors，与 HEAD 基线**逐条相同**（4 条 import/order 是改动前既有，已用 HEAD 版本对照确认）
```

**断言输出**（原样，见 §8「验收摘要」段）：44 条全过 —— ① 12 条、② 7 条、③ 5 条、④ 6 条、⑤ 9 条，
另 4 条脚手架（夹具在位 / tsx 在位 / 契约面齐备 / 报告已产出）+ 1 条控制面（三分）。

## 8. 验收摘要（脚本输出原文）

**③ 的九条校验原文**（场景进程 stdout 的片段，驱动层原样透出）：

```
[4/6] 校验（四条）
      ✓ [characters-count] characters 行数不变 —— 重写前后都是 5 行
      ✓ [unit-positions-refs] unit_positions.character_id 100% 落在新 characters.id 集合内 —— 5 条站位引用全部命中
      ✓ [unit-id-sets] unit_positions 的 unit_id 集合 == characters.id × PREFIX —— 两侧集合完全相等
      ✓ [task-refs] character_tasks.character_id 全部能在 characters 中找到 —— 3 个被引用的角色 id 全部命中
      ! [participants-parse] sessions.participants 逐条可 JSON.parse 且是字符串数组 —— 全部可解析；其中 1 项是非角色参与者（agent / link / client id），保留不动
          · link_abc
      ✓ [sandbox-ids-unchanged] 默认沙盒行 id 一律不改 —— 2 个沙盒行 id 原样保留
      ✓ [id-map-rows] character_id_map 的 new_id 全部能在 characters 中找到 —— 3 条映射全部命中
      ✓ [exp_events-refs] exp_events.character_id 引用面（附加完整性） —— 2 个被引用的角色 id 全部命中
      ✓ [character_chat_messages-refs] character_chat_messages.character_id 引用面（附加完整性） —— 2 个被引用的角色 id 全部命中
```

**④ 的失败路径原文**（片段）：

```
      ✗ N4b 重写校验不过（1 条）⇒ 整批回滚：
- task-refs：1 个被引用的角色 id 悬空
      ⇒ 已整批回滚（库回到 N4b 前状态，未落盘）
…
      ✗ 会话 session_broken_1 的 participants 不是可解析的 JSON 数组 ⇒ 整批回滚：Expected property name or '}' in JSON at position 1
      ⇒ 已整批回滚（库回到 N4b 前状态，未落盘）
```

```
──────────────── 验收摘要 ────────────────
✅ ① 步 N6：两个副本各自的 roster 物化出自己的一行集（契约 → 运行层） —— A=["scout_wsp_m2_a","medic_wsp_m2_a"] B=["scout_wsp_m2_b","engineer_wsp_m2_b"]
✅ ① 角色隔离：副本 A 只看得见自己的两行 —— ["medic_wsp_m2_a","scout_wsp_m2_a"]
✅ ① 角色隔离：副本 B 只看得见自己的两行 —— ["engineer_wsp_m2_b","scout_wsp_m2_b"]
✅ ① 角色隔离：两个副本的角色 id 零重叠（同名角色是两行、两 id） —— A=["medic_wsp_m2_a","scout_wsp_m2_a"] B=["engineer_wsp_m2_b","scout_wsp_m2_b"]
✅ ① COALESCE 命中：旧行（instance_id IS NULL）归默认沙盒，对两个副本都不可见 —— 沙盒=["character_legacy_1","character_sandbox_1"]
✅ ① COALESCE 命中：显式标了沙盒 id 的旧行同样只归沙盒 —— 沙盒=["character_legacy_1","character_sandbox_1"]
✅ ① 任务隔离：A 只看得见 A 的那单，B 只看得见 B 的那单 —— A=["task_a_1"] B=["task_b_1"]
✅ ① 任务隔离：旧任务归沙盒（两个副本都看不见） —— 沙盒=["task_legacy_1"]
✅ ① 任务行的 instance_id 真的落了库（写侧补齐后） —— A=wsp_m2_a B=wsp_m2_b 旧=null
✅ ① 会话隔离：A 只看得见 A 的会话，B 只看得见 B 的会话 —— A=["sess_a_1"] B=["sess_b_1"]
✅ ① 事件隔离：A 的事件 2 条、B 的事件 2 条、沙盒 0 条（互不可见） —— A=2 B=2 沙盒=0
✅ ① 各自养成：副本 A 的斥候升到 7 级，副本 B 的同名斥候还是 1 级 —— A=7 B=1
✅ ② 每 instance 64 角色：副本灌满 64 行后新建被拒 —— 已收=64 拒=0 判定=instance-limit
✅ ② 每 instance 64 角色：满位后那一行被护栏拒掉 —— ["cap_a_overflow"]
✅ ② 全局 512 角色：全库灌到 512 行后新副本建档被拒（总池也到顶） —— 总数=512 判定=total-limit 拒=["cap_fresh_1"]
✅ ② 容量只拒新不拒改：已存在的角色改档照写 —— ["cap_a_0"]
✅ ② session_events 每会话 512：第 513 条落库后最老的一条被搬走 —— 热表=512 归档行数=1 最老 seq=1
✅ ② 滚动归档落在 <副本根>/.stratix/history/（按月分片 jsonl） —— ["session-events-202611.jsonl"]
✅ ② session_events 每 instance 4096：4608 条 ⇒ 搬走最老的 512 条，热表剩 4096 —— 热表=4096 归档行数=512
✅ ③ N4b 迁移在夹具库上成功（status=succeeded） —— status=succeeded 重写=3 行
✅ ③ 校验脚本可重跑：两次都退出 0 —— 第1次=0 第2次=0
✅ ③ 校验脚本可重跑：两次输出逐字一致（幂等） —— 992 字符 vs 992 字符
✅ ③ 四条校验全过（行数不变 / unit_positions 落位 / unit_id 集合 / 引用可解析） —— ["characters-count:pass","unit-positions-refs:pass","unit-id-sets:pass","task-refs:pass","participants-parse:warn","sandbox-ids-unchanged:pass","id-map-rows:pas
（原始输出此处被驱动的 detail 宽度截断；完整九项见 §8 开头的 N4b 校验原文）
✅ ③ 校验脚本可重跑：模块级两次报告一致 —— ok=true/true 一致=true
✅ ④ 校验失败路径（任务指向不存在的角色）⇒ 整批回滚，id 一个没动 —— status=rolled-back id未变=true
✅ ④ 校验失败路径：独立校验脚本对回滚后的库判不通过（悬空任务被检出） —— verifyOk=false 失败项=["characters-count","task-refs"]
✅ ④ 校验失败路径：校验脚本退出码非 0（=1） —— exit=1
✅ ④ participants 坏 JSON ⇒ 整批回滚 —— status=rolled-back id未变=true
✅ ④ 前滚回滚（靠 character_id_map 反向 UPDATE）⇒ id 回到旧值 —— status=succeeded
✅ ④ 六步演练脚本整场跑通（成功 / 坏行 / 校验不过 / 中途崩溃 / 前置阻断） —— 全部断言通过 ✓
✅ ⑤ 预览：列出将迁走的角色 / 任务，且无阻断项 —— 角色=1 任务=1 阻断=[]
✅ ⑤ 预览：一个字节都没改（源副本的行归属仍是 NULL） —— instance_id=null
✅ ⑤ 执行：行迁进目标副本（归属变成目标实例） —— 角色=wsp_m2_b 任务=wsp_m2_b
✅ ⑤ 执行：迁走的行不再留在源副本（源副本再预览 = 0 行） —— {"characters":0,"tasks":0,"sessions":0,"externalRefs":0,"unitPositions":0,"expEvents":0,"sessionEvents":0,"total":0}
✅ ⑤ 撤销预览：列出了本次可撤销的行 —— 可撤销=2
✅ ⑤ 撤销：行回到源副本（归属还原成迁移前的 NULL） —— 角色=null 任务=null
✅ ⑤ N7 CLI：preview 退出 0 且打出了预览清单 —— · 合计 2 行
✅ ⑤ N7 CLI：migrate --confirm 退出 0 且报了迁移行数 —— 迁移完成：角色 1 · 任务 1 · 会话 0 · 外部凭据 0 · 跟随行 0（合计 2 行）
✅ ⑤ N7 CLI：rollback --confirm 退出 0 且撤销了行 —— 已撤销 2 行（回到迁移前）
✅ 控制面：两个副本的 id 与沙盒 id 三分（宿主能列举、能分别进入） —— wsp_m2_a / wsp_m2_b / wsp_sandbox
断言：44/44 通过
结论：PASS（M2 端到端验收：双副本隔离 + 容量上限 + N4b 校验/回滚演练 + N7 闭环）
────────────────────────────────────────────
```

## 9. 与验收标准的对应

| 验收 | 落点 |
|---|---|
| ① 五组断言全过 | §2（44 条断言，逐组对应 N1/N2/N6、§1.4 容量、R1-41 清单、R1-38 回滚矩阵、N7） |
| ② 脚本可重跑 | §1（每次新建临时目录、跑完即删）；实测连跑三次均 44/44 PASS、输出逐字一致；③ 的「校验脚本跑两次 stdout 逐字一致」是**脚本级**幂等断言 |
| ③ 夹具入库 | `e2e-tests/fixtures/m2-instance-a/**`、`m2-instance-b/**`（两个副本各自的 `.stratix` 契约面 + `AGENTS.md`） |
| ④ 全仓 jest + tsc 全绿 | §7（`npx tsc --noEmit` 无输出；`npx jest --silent` 348 suites / 5939 passed / 0 failed） |
| 不实际重写用户库 | 全部在 `os.tmpdir()` 下的临时库；③/④ 用的是仓内 N4b 夹具库 |
| 不引入 npm 依赖 | 只用 node 内建模块 + 仓内已有的 `tsx` |
| 不 mock 数据 | 真 sql.js 适配器（生产同款）+ 真 DAO + 真 CLI 子进程 |
| 最小改动 | 缺陷修复只有 3 处 + 1 个回归测试文件；其余全是**新增的验收资产** |
