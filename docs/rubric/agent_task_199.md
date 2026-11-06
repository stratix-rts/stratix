# task_199 工作文档 —— M2-02（N4a + N4c）

> 分支 `demo/v3.3`；权威依据：`docs/DESIGN-project-map.md` §1.3.2 **步 N4a / N4c**
> （步号纪律：160 的 N 步 ≠ 159 的 M 步）；前置 M2-01（`25eef04` 六表加 `instance_id` 列）。

## 1. 本单范围

| 步 | 动作 | 本单是否做 |
|---|---|---|
| **N4a** | `characters` 加 `role_id` 列（= roster 角色 id）+ **复合唯一索引** `(role_id, instance_id)` | ✅ 做 |
| **N4b** | 一次性 character id 重写（高风险：整批单事务 + 校验脚本 + 停机窗口） | ❌ 不做（独立交付物，本单只把它的**回滚凭据**备好） |
| **N4c** | 建 `character_id_map(old_id, new_id, instance_id, created_at)` 表（与数据同库、同事务） | ✅ 做 |
| **N6** | roster → characters 按 instance 物化（写侧回填 `role_id`） | ❌ 不做（写侧另议） |

**写侧边界**：本单只落 **DDL**。`characters.role_id` 的**写入口**（roster 物化）与
`upsertCharacters` 的 role_id 写入**没有做** —— 写侧属 N6/后续任务。
现状：`role_id` 由 N4a 的加列语义保证「旧行 = NULL = **未回填**」，可延后填。

## 2. DDL 清单

### 2.1 N4a —— `characters` 加列 + 复合唯一索引

```sql
-- 加列（可空、无 DEFAULT ⇒ 存量行落 NULL = 未回填；零数据改写）
ALTER TABLE characters ADD COLUMN role_id TEXT;

-- 复合唯一索引（一个副本内一个 roster 角色只能有一行角色档案）
CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_role_instance
  ON characters(role_id, instance_id);
```

### 2.2 N4c —— `character_id_map` 表（N4b 唯一的回滚凭据）

```sql
CREATE TABLE IF NOT EXISTS character_id_map (
  old_id      TEXT    NOT NULL,
  new_id      TEXT    NOT NULL,
  instance_id TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (old_id, instance_id)      -- N4b 之后角色 id 是 instance 内唯一 ⇒ 映射天然带副本维度
);
CREATE INDEX IF NOT EXISTS idx_character_id_map_new ON character_id_map(new_id);  -- 前滚回滚（new → old）反查
```

### 2.3 落地位置（DDL 两层同构 —— 既有铁律）

| 层 | 文件 | 内容 |
|---|---|---|
| 驱动层 | `src/stratix-database/StratixDatabase.ts` | `TARGET_SCHEMA_VERSION` 14 → **15**；`createTables()` 建表 DDL + `migrateRoleIdAndIdMap()` 迁移（加列 / 建索引 / 建表） |
| app 层 | `src/app/services/persistence/game-save-dao.ts` | `ensureGameSaveTables()` → `ensureRoleIdColumn()`（加列 + 建索引） |
| app 层 | `src/app/services/persistence/character-id-map-dao.ts`（**新文件**） | `ensureCharacterIdMapTable()` + 映射读写（`recordCharacterIdMapping` / `findCharacterIdMappingByOldId` / `findCharacterIdMappingByNewId` / `listCharacterIdMappings`） |

## 3. 四条关键裁决

1. **唯一索引建在原始列上，不用 `COALESCE(...)` 表达式索引** —— SQLite 唯一索引把 NULL 视为彼此不同
   ⇒ 旧行（`role_id IS NULL`）之间**不冲突** ⇒ 索引能在存量库上直接建成，也让「role_id 延后回填」成立
   （回填时才受约束）。表达式索引会把旧行归一成同一个值 ⇒ **建不出来**。
2. **索引建在「两列都在」时才建** —— 老库可能是 v13 形状（无 `instance_id`）或 v14 形状（无 `role_id`）；
   在 `createTables()` 里无条件建索引会报 `no such column` 并炸掉启动。
   ⇒ 驱动层 `createTables()` 用列存在性守卫，缺列的老库交给迁移链（`ALTER ADD` 补列后再建索引）。
3. **`character_id_map` 与数据同库** —— 不落 `.stratix/state/`（那是 gitignore 的本地态 ⇒ 机器坏了映射就没了）；
   与数据同库 ⇒ 同备份、同事务、同寿命（R1-38 / R1-39）。
4. **映射写「凭据」不写「流水」** —— 同一 `(old_id, instance_id)` 重复写是**覆盖**不是追加
   （重跑一次迁移不该堆出两条互相矛盾的凭据）。

## 4. 验证

```
npx tsc --noEmit                 → 无输出（绿）
npx jest --maxWorkers=2 --silent → Test Suites: 338 passed, 338 total
                                   Tests: 6 skipped, 5826 passed, 5832 total
新增用例（src/app/__tests__/persistence/character-role-id-and-id-map.test.ts，12/12 通过）：
  ① role_id 列可空无 DEFAULT + 复合唯一索引在位（unique、列序 role_id→instance_id）
  ② character_id_map 四列 + 复合主键 + new_id 索引；映射正/反向可查、重复写幂等
  ③ 迁移幂等：v14 老库补列补索引建表 / initialize 重跑 / ensure* 重跑 / 重开库 ⇒ 列索引不重复、行数不变
  ④ 零数据改写：旧行 role_id 仍 NULL（= 未回填）
唯一约束实证：同 (role_id, instance_id) 拒收 / 异副本放行 / NULL role_id 多行共存
既有测试不破：schema 版本断言 14 → 15（9 个测试文件，23 处断言）
```

## 5. dsh 双面向（各一句）

- **用**（Stratix 用 dsh）：借 dsh 的 **session 归属靠 `header.cwd` 的确定性** —— 一个 dsh session 落一个
  workspace 目录 = 一个 Stratix instance；本单的 `role_id + instance_id` 复合唯一与之**同构**：
  「一个副本内一个 roster 角色只能有一行角色档案」，把「哪条线缆的哪个角色」在**存储层**钉死，不靠解析 id 字符串。
- **暴露**（Stratix 被 dsh 嵌入）：**不可见（存储层）** —— `role_id` / `character_id_map` 只落库，
  不进 IPC 面、不进 `.stratix` 契约面 ⇒ 宿主看不到也改不了角色归属与回滚凭据（要暴露也是 N4b 之后另议）。

## 6. 遗留（不阻塞本单收口）

- **写侧未接**：`role_id` 目前没有写入路径（`upsertCharacters` 的列清单不含它 ⇒ 插入落 NULL、
  冲突更新也**不会**抹掉已有 `role_id`）。回填属 N6（roster 按 instance 物化）。
- **N4b 未做**：id 重写、停机窗口、四条校验脚本、前滚回滚流程都还没做 —— 本单只是把
  `character_id_map` 这张**凭据表**备好，等 N4b 消费。
