# task_201 工作文档 —— M2-04（N4b 一次性 id 重写执行器）

> 分支 `demo/v3.3`；权威依据：`docs/DESIGN-project-map.md` §1.3.2
> **「N4b 的可判定规则」（R1-39）** + **「N4b 的迁移验收清单」（R1-41，六步 + 四条校验）** + **「回滚矩阵」（R1-38）**
> （步号纪律：160 的 N 步 ≠ 159 的 M 步）；前置：M2-02（`630b786` role_id + 映射表）+ M2-03（`96f13fe` session_external_refs）。

## 1. 本单范围

| 项 | 本单是否做 | 说明 |
|---|---|---|
| **N4b 一次性 id 重写**（执行器 + 六步纪律 + 四条校验） | ✅ 做 | 交付物 = 迁移脚本 + 校验脚本（设计钦定） |
| **对用户库实际执行重写** | ❌ 不做 | 执行时机另定；本单只交付脚本（演练只碰 `os.tmpdir()` 里的夹具库） |
| N6（roster → characters 物化，写侧回填 `role_id`） | ❌ 不做 | 写侧属角色管线（并行 worker 的域） |
| 降级到 M1 版本的支持 | ❌ 不做 | 设计钦定「不支持，只支持前滚」 |
| 角色 id 前缀解析的清理 | 🚫 无需 | 全仓扫描确认：**没有**按角色 id 前缀判身份的代码；唯一的 id 前缀依赖是 `unit_`（单位 id 格式，设计明写「不改单位 id 格式」） |

## 2. 交付物

| 类型 | 路径 | 职责 |
|---|---|---|
| 执行器 | `src/app/services/persistence/character-id-rewrite.ts` | 计划 / 整批重写（**一个事务**）/ 四条校验 / 前滚回滚 |
| 六步编排 | `src/app/services/persistence/n4b-migration.ts` | 停机窗口 → 备份 → 重写 → 校验 → 回滚 → 恢复路径 |
| **迁移脚本** | `scripts/migrate-n4b-character-ids.ts` | CLI：`migrate`（默认）/ `rollback` / `--dry-run` / `--strict` |
| **校验脚本** | `scripts/verify-n4b-character-ids.ts` | CLI：独立跑四条校验（可带 `--report` 读迁移基线） |
| 演练脚本 | `scripts/rehearse-n4b-character-ids.ts` | 临时库夹具真跑六步（成功 + 三种失败 + 重跑 + 前滚回滚） |
| 夹具 | `src/app/__tests__/persistence/helpers/n4b-fixture.ts` | 真 SQLite 夹具库（三个破坏开关） |
| 测试 | `src/app/__tests__/persistence/character-id-rewrite-n4b.test.ts` | 9 条断言（真库真跑，不 mock 连接） |

驱动层改动（**加法**，2 个方法 + 1 个可选参数）：
`src/stratix-database/sqlite-adapter.ts` —— `setAutoSaveEnabled(enabled)` / `saveAtomically()` / `close(skipSave?)`。

## 3. 六条关键裁决

1. **沙盒行 id 一律不改**（设计规则 ①）—— 判据是 `COALESCE(instance_id,'wsp_sandbox')`，
   **不是** id 字符串形状；其它副本行 id = `<roleId>_<instanceId>`，派生源是 **`role_id` 列**。
   ⇒ 两种 id 格式并存是既定事实 ⇒ 执行器里**没有一处解析 id 字符串判身份**。
2. **缺 `role_id` ⇒ 前置阻断，不动任何数据** —— 派生不出新 id 的行宁可让整批停下，
   也不允许「猜一个 id」（猜出来的 id 会静默改坏引用面）。
3. **校验放在事务内**（设计第 ④⑤ 步）—— 校验读的是未提交的重写后状态，
   不过就抛 ⇒ `ROLLBACK` ⇒ 库回到 N4b 前状态（磁盘文件**逐字节未变**）。
4. **`participants` 是 JSON blob** ⇒ 逐行读 → `JSON.parse` → 改写数组 → 回写；
   **任一行失败即整批回滚**。参与者是**混合命名空间**（characterId / agentId / clientId，视 kind 而定）
   ⇒ 只改**映射表里有的角色 id**，非角色参与者原样保留（校验里单列为「非角色参与者」）。
5. **引用面比设计清单多两处** —— `exp_events.character_id` 与 `character_chat_messages.character_id`
   **也是**指向角色行的普通列 ⇒ 一并同事务改写（漏改 = 悬空引用 = 经验事件 / 对话历史查不到角色）；
   但这两处在**校验**里只作「附加完整性」告警（存量悬空引用不是本次重写造成的，不该把整批判死）。
   设计钦定的**四条**仍是硬校验。
6. **停机窗口落成闸门**（不是口头纪律）—— 三道：① 操作者显式 `--confirm-service-stopped`；
   ② 锁文件 `<db>.n4b.lock`（含 pid，pid 还活着 ⇒ 拒绝跑；pid 已死 ⇒ 接管，不把人永久挡在门外）；
   ③ **提交前指纹复核**（库文件在跑的过程中被改过 ⇒ 判定「service 没停干净」⇒ 抛错回滚，不提交）。

### 3.1 校验③ 的口径细化（唯一一处偏离字面表述）

设计原文：「`unit_positions` 的 `unit_id` 集合 **==** `characters.id × PREFIX`」。
实现取**双向差集**：
- 多出来（站位没有对应角色行）⇒ **fail**（悬空站位是真问题）；
- 缺失（角色还没有站位）⇒ **warn**（角色尚未上场是合法状态：站位是渲染侧落位时才写的），
  `--strict` 下判 fail。

why 不照字面判等：字面判等会把「还没上场的角色」判成迁移失败 ⇒ 整批永远跑不成。

## 4. 演练输出（夹具真跑，原样摘录）

```
场景 1 · 成功路径（六步全过）
[3/6] 整批重写（一个事务 + 同事务写 character_id_map）
      · 计划：重写 3 行；默认沙盒 2 行（id 一律不改）；已是派生 id 0 行
        · character_1700000000000_3 → alpha_wsp_beta（role_id=alpha，副本 wsp_beta）
        · character_1700000000000_4 → beta_wsp_beta（role_id=beta，副本 wsp_beta）
        · character_1700000000000_5 → alpha_wsp_gamma（role_id=alpha，副本 wsp_gamma）
[4/6] 校验（四条）
      ✓ [characters-count] characters 行数不变 —— 重写前后都是 5 行
      ✓ [unit-positions-refs] unit_positions.character_id 100% 落在新 characters.id 集合内 —— 5 条站位引用全部命中
      ✓ [unit-id-sets] unit_positions 的 unit_id 集合 == characters.id × PREFIX —— 两侧集合完全相等
      ✓ [task-refs] character_tasks.character_id 全部能在 characters 中找到 —— 3 个被引用的角色 id 全部命中
      ! [participants-parse] sessions.participants 逐条可 JSON.parse 且是字符串数组 —— 全部可解析；其中 1 项是非角色参与者（agent / link / client id），保留不动
      ✓ [sandbox-ids-unchanged] 默认沙盒行 id 一律不改 —— 2 个沙盒行 id 原样保留
      ✓ [id-map-rows] character_id_map 的 new_id 全部能在 characters 中找到 —— 3 条映射全部命中
迁移结果：succeeded（重写 3 行）
迁移后的 characters.id：alpha_wsp_beta / alpha_wsp_gamma / beta_wsp_beta / character_1700000000000_1 / character_1700000000000_2
迁移后的 sessions.participants：session_beta_1 ⇒ ["alpha_wsp_beta","character_1700000000000_1"]；session_link_1 ⇒ ["link_abc"]
重跑结果：no-op（重写 0 行）    前滚回滚：3 行改回旧 id

场景 3 · 校验不过（character_tasks 指向不存在的角色）⇒ 整批回滚
      ✗ N4b 重写校验不过（1 条）⇒ 整批回滚：
        - task-refs：1 个被引用的角色 id 悬空
      ⇒ 已整批回滚（库回到 N4b 前状态，未落盘）
      ✗ [task-refs] character_tasks.character_id 全部能在 characters 中找到 —— 1 个被引用的角色 id 悬空
迁移结果：rolled-back   （旧 id 全部还在，新 id 一个都没留下）

场景 2 · participants 坏行 ⇒ 整批回滚
      ✗ 会话 session_broken_1 的 participants 不是可解析的 JSON 数组 ⇒ 整批回滚：…
场景 4 · 中途崩溃（事务进行到一半抛错）⇒ 整批回滚
场景 5 · 前置阻断（副本行缺 role_id）⇒ 不动任何数据
演练小结：全部断言通过 ✓
```

## 5. dsh 双面向

- **用**：映射表 `character_id_map` 与 dsh session log（`sessions` / `session_events`）**同库、同寿命**
  —— 备份一次带走，迁移一次带走；正常运算是 **append-only**（唯一例外是前滚回滚**消费**凭据，
  因为回滚后旧 id 已恢复 ⇒ 该凭据已失效）。
- **暴露**：映射表**不可见** —— 不进任何 IPC / MCP / HUD 面；只有迁移脚本与校验脚本（CLI）读它。

## 6. 未做 / 后续

| 项 | 归属 |
|---|---|
| 对用户库实际执行重写 | **执行时机另定**（本单只交付脚本） |
| 新角色的 id 生成改派生式（`<roleId>_<instanceId>`） | 角色管线（并行 worker 域）；不改也不破坏（两种格式并存是既定事实） |
| `role_id` 的写侧回填（N6 物化） | N6 |
| 降级到 M1 版本 | **不支持**（设计钦定，只支持前滚） |

## 7. 验证

- `npx tsc --noEmit` ✅
- `npx jest src/app/__tests__/persistence --maxWorkers=1` ✅ 27 suites / 226 tests
- `npx jest src/app/__tests__/persistence/character-id-rewrite-n4b.test.ts` ✅ 9/9
- `npx eslint --cache <改动文件>` ✅ 0 error（adapter 的 4 条 warning 是既有的）
- `npx tsx scripts/rehearse-n4b-character-ids.ts` ✅ 五个场景断言全过
