/**
 * 集成测试：M2-02 的 **N4a + N4c**（@since v3.3，task_199）——
 *   权威依据 docs/DESIGN-project-map.md §1.3.2 步 **N4a**（characters 加 `role_id` 列
 *   = roster 角色 id + **复合唯一索引** `(role_id, instance_id)`）与步 **N4c**
 *   （`character_id_map(old_id, new_id, instance_id, created_at)` 表，与数据**同库、同事务** ——
 *   N4b 唯一的回滚凭据）。
 *
 * 四条验收逐条落到可执行的断言：
 *   ① role_id 列 + 复合唯一索引就位（列可空、无 DEFAULT；索引 unique 且列序 = role_id → instance_id）；
 *   ② character_id_map 表就位（四列 + 复合主键 + new_id 反查索引）；
 *   ③ 迁移幂等可重跑（ensure* 重跑 / initialize 重跑 / 重开库：列不重复、索引不重复、行数不变）；
 *   ④ 零数据改写：旧行的 role_id 仍是 NULL（= 未回填，可延后填）。
 *
 * 驱动：真实 sql.js 适配器 + 临时文件库（与其它 schema 测试同口径 —— 迁移逻辑的价值恰在
 *   「真 SQL 兼容性」，mock 掉连接等于把被测对象一起 mock 掉）。
 *
 * why 「老库」不手写 DDL 而是从当前 DDL 反推：v15 相对 v14 **只**多了 role_id 一列
 *   ⇒ 「v14 形状」= 当前建表 DDL 去掉该列（抄 DDL 会随上游演进悄悄漂移）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';
import { StratixDatabase } from '@/stratix-database/StratixDatabase';

import {
  ensureCharacterIdMapTable,
  findCharacterIdMappingByNewId,
  findCharacterIdMappingByOldId,
  listCharacterIdMappings,
  recordCharacterIdMapping,
} from '@/app/services/persistence/character-id-map-dao';
import { ensureGameSaveTables } from '@/app/services/persistence/game-save-dao';

/** 另一个副本的 id（用来验证「同一 roster 角色在不同副本各有一行」）。 */
const OTHER_INSTANCE = 'wsp_other';

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function openAndInitialize(dir: string): Promise<StratixDatabase> {
  const db = new StratixDatabase({ dataDir: dir, filename: 'game' });
  await db.init();
  db.initialize();
  return db;
}

function versionOf(raw: Database): number {
  const row = raw.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v?: number };
  return Number(row.v ?? 0);
}

/** 表的列信息（PRAGMA 不支持参数绑定，表名是测试内常量）。 */
function columnInfo(raw: Database, table: string): Array<Record<string, unknown>> {
  return raw.prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>;
}

/** 表的索引清单（PRAGMA index_list）。 */
function indexList(raw: Database, table: string): Array<Record<string, unknown>> {
  return raw.prepare(`PRAGMA index_list(${table})`).all() as Array<Record<string, unknown>>;
}

/** 某个索引的列序（PRAGMA index_info）。 */
function indexColumns(raw: Database, indexName: string): string[] {
  const rows = raw.prepare(`PRAGMA index_info(${indexName})`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => String(row.name));
}

/** 插一行 characters（绕过 DAO 写入口：写侧还没有 role_id / instance_id 概念）。 */
function insertCharacter(
  raw: Database,
  id: string,
  patch: { roleId?: string | null; instanceId?: string | null } = {}
): void {
  raw
    .prepare(
      `INSERT INTO characters (id, name, kind, persona, level, exp, appearance, body_type, skin_id,
         external_session_id, context_enabled, created_at, updated_at, instance_id, role_id)
       VALUES (?, '测试角色', 'codex', '', 1, 0, NULL, NULL, NULL, NULL, 1, 1000, 1000, ?, ?)`
    )
    .run(id, patch.instanceId ?? null, patch.roleId ?? null);
}

/**
 * 把 characters 重建成「v14 形状」（DDL 去掉 role_id 列，其余一模一样；行数据原样搬过去）。
 *
 * why 用重建（而不是手写 DDL）：v15 相对 v14 只多了 role_id 一列 ⇒ 「v14 形状」
 *   = 当前 DDL 去掉该列。抄 DDL 会随上游演进漂移；反推永远等于真实的 v14 形状。
 */
function rebuildWithoutRoleId(raw: Database): void {
  const row = raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get('characters') as
    | { sql?: string }
    | undefined;
  const ddl = String(row?.sql ?? '');
  const legacyDdl = ddl.replace(/role_id TEXT\s*,/g, '').replace(/,\s*role_id TEXT/g, '');
  expect(legacyDdl.length).toBeGreaterThan(0);
  expect(legacyDdl).not.toMatch(/role_id\s+TEXT/);
  raw.exec('CREATE TABLE characters_legacy_v14 AS SELECT * FROM characters');
  raw.exec('DROP TABLE characters');
  raw.exec(legacyDdl);
  const columns = (raw.prepare('PRAGMA table_info(characters_legacy_v14)').all() as Array<Record<string, unknown>>)
    .map((column) => String(column.name))
    .filter((name) => name !== 'role_id');
  const columnList = columns.join(', ');
  raw.exec(`INSERT INTO characters (${columnList}) SELECT ${columnList} FROM characters_legacy_v14`);
  raw.exec('DROP TABLE characters_legacy_v14');
}

/** 把库降级成「v14 老库」：characters 无 role_id 列、无映射表、版本号退回 14。 */
function downgradeToV14(raw: Database): void {
  rebuildWithoutRoleId(raw);
  raw.exec('DROP TABLE IF EXISTS character_id_map');
  raw.exec('DELETE FROM schema_version');
  raw.exec('INSERT INTO schema_version (version, applied_at) VALUES (14, 0)');
}

describe('M2-02：N4a role_id 列 + 复合唯一索引 / N4c character_id_map 表（task_199）', () => {
  describe('① role_id 列 + 复合唯一索引就位', () => {
    let dir: string;
    let raw: Database;

    beforeEach(async () => {
      dir = tempDir('stratix-role-id-');
      raw = new Database(path.join(dir, 'save.sqlite'));
      await raw.initialize();
    });

    afterEach(() => {
      raw.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('DAO 的 ensure* 之后：role_id 列可空、无 DEFAULT', () => {
      ensureGameSaveTables(raw);
      const column = columnInfo(raw, 'characters').find((c) => String(c.name) === 'role_id');
      expect(column).toBeDefined(); // 列存在
      expect(Number(column?.notnull)).toBe(0); // 可空
      expect(column?.dflt_value ?? null).toBeNull(); // 无 DEFAULT ⇒ 旧行落 NULL（未回填）
    });

    it('DAO 的 ensure* 之后：复合唯一索引 (role_id, instance_id) 在位', () => {
      ensureGameSaveTables(raw);
      const index = indexList(raw, 'characters').find((i) => String(i.name) === 'idx_characters_role_instance');
      expect(index).toBeDefined();
      expect(Number(index?.unique)).toBe(1); // 唯一索引
      expect(indexColumns(raw, 'idx_characters_role_instance')).toEqual(['role_id', 'instance_id']);
    });

    it('StratixDatabase 全新库：role_id 列 + 复合唯一索引在位、版本落 16', async () => {
      const db = await openAndInitialize(dir);
      const raw2 = db.getDatabase();
      expect(versionOf(raw2)).toBe(16);

      const column = columnInfo(raw2, 'characters').find((c) => String(c.name) === 'role_id');
      expect(column).toBeDefined();
      expect(Number(column?.notnull)).toBe(0);
      expect(column?.dflt_value ?? null).toBeNull();

      const index = indexList(raw2, 'characters').find((i) => String(i.name) === 'idx_characters_role_instance');
      expect(Number(index?.unique)).toBe(1);
      expect(indexColumns(raw2, 'idx_characters_role_instance')).toEqual(['role_id', 'instance_id']);
      db.close();
    });

    it('唯一约束真的生效：同 (role_id, instance_id) 拒收、异副本放行、NULL role_id 不互斥', () => {
      ensureGameSaveTables(raw);
      insertCharacter(raw, 'ch-a', { roleId: 'archivist', instanceId: 'wsp_sandbox' });

      // 同一个副本里同一个 roster 角色再来一行 ⇒ 违反复合唯一索引
      expect(() => insertCharacter(raw, 'ch-a2', { roleId: 'archivist', instanceId: 'wsp_sandbox' })).toThrow();
      // 另一个副本里同一个 roster 角色 ⇒ 合法（各副本独立养成）
      expect(() =>
        insertCharacter(raw, 'ch-b', { roleId: 'archivist', instanceId: OTHER_INSTANCE })
      ).not.toThrow();
      // 旧行 role_id 未回填（NULL）⇒ 多行共存（延后回填的语义）
      expect(() => insertCharacter(raw, 'ch-c', { roleId: null, instanceId: 'wsp_sandbox' })).not.toThrow();
      expect(() => insertCharacter(raw, 'ch-d', { roleId: null, instanceId: 'wsp_sandbox' })).not.toThrow();

      expect(raw.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 4 });
    });
  });

  describe('② character_id_map 表就位（四列 + 主键）', () => {
    let dir: string;
    let raw: Database;

    beforeEach(async () => {
      dir = tempDir('stratix-id-map-');
      raw = new Database(path.join(dir, 'save.sqlite'));
      await raw.initialize();
    });

    afterEach(() => {
      raw.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('表在位：四列 old_id/new_id/instance_id/created_at + 复合主键 (old_id, instance_id)', () => {
      ensureCharacterIdMapTable(raw);

      const columns = columnInfo(raw, 'character_id_map');
      expect(columns.map((c) => String(c.name))).toEqual([
        'old_id',
        'new_id',
        'instance_id',
        'created_at',
      ]);
      // 主键：old_id 与 instance_id 组成复合键（pk 序号 1 / 2）
      const pk = columns.filter((c) => Number(c.pk) > 0).map((c) => String(c.name));
      expect(pk).toEqual(['old_id', 'instance_id']);
      expect(indexColumns(raw, 'idx_character_id_map_new')).toEqual(['new_id']);
    });

    it('StratixDatabase 全新库：映射表同库就位（与数据同库 ⇒ 同寿命、同备份）', async () => {
      const db = await openAndInitialize(dir);
      const raw2 = db.getDatabase();
      const columns = columnInfo(raw2, 'character_id_map');
      expect(columns.map((c) => String(c.name))).toEqual([
        'old_id',
        'new_id',
        'instance_id',
        'created_at',
      ]);
      db.close();
    });

    it('映射可写可读：正向（old → new）与反向（new → old）都查得到', () => {
      ensureCharacterIdMapTable(raw);

      recordCharacterIdMapping(raw, {
        oldId: 'chr_legacy_1',
        newId: 'archivist_wsp_other',
        instanceId: OTHER_INSTANCE,
        createdAt: 1700000000000,
      });

      expect(findCharacterIdMappingByOldId(raw, 'chr_legacy_1', OTHER_INSTANCE)).toEqual({
        oldId: 'chr_legacy_1',
        newId: 'archivist_wsp_other',
        instanceId: OTHER_INSTANCE,
        createdAt: 1700000000000,
      });
      expect(findCharacterIdMappingByNewId(raw, 'archivist_wsp_other')).toMatchObject({
        oldId: 'chr_legacy_1',
        instanceId: OTHER_INSTANCE,
      });
      expect(listCharacterIdMappings(raw, OTHER_INSTANCE)).toHaveLength(1);
      expect(listCharacterIdMappings(raw)).toHaveLength(1);
    });

    it('重复写同 (old_id, instance_id) 幂等：覆盖而不是堆行（凭据不是流水）', () => {
      ensureCharacterIdMapTable(raw);

      recordCharacterIdMapping(raw, {
        oldId: 'chr_legacy_1',
        newId: 'archivist_wsp_other',
        instanceId: OTHER_INSTANCE,
        createdAt: 1700000000000,
      });
      recordCharacterIdMapping(raw, {
        oldId: 'chr_legacy_1',
        newId: 'archivist_wsp_other_v2',
        instanceId: OTHER_INSTANCE,
        createdAt: 1700000000001,
      });

      expect(raw.prepare('SELECT COUNT(*) AS n FROM character_id_map').get()).toMatchObject({ n: 1 });
      expect(findCharacterIdMappingByOldId(raw, 'chr_legacy_1', OTHER_INSTANCE)).toMatchObject({
        newId: 'archivist_wsp_other_v2',
        createdAt: 1700000000001,
      });
    });
  });

  describe('③ 迁移幂等可重跑 + ④ 零数据改写', () => {
    let dir: string;
    let opened: StratixDatabase | null = null;

    beforeEach(() => {
      dir = tempDir('stratix-role-id-migrate-');
    });

    afterEach(() => {
      try {
        opened?.close();
      } catch {
        // 已关闭：忽略。
      }
      opened = null;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('v14 老库：补列 + 补索引 + 建映射表，旧行 role_id 仍 NULL（零数据改写）', async () => {
      const db = await openAndInitialize(dir);
      opened = db;
      const raw = db.getDatabase();

      insertCharacter(raw, 'ch-old');
      raw.prepare(
        `INSERT INTO characters (id, name, kind, persona, level, exp, appearance, body_type, skin_id,
           external_session_id, context_enabled, created_at, updated_at, instance_id)
         VALUES ('ch-other', '别家角色', 'codex', '', 1, 0, NULL, NULL, NULL, NULL, 1, 2000, 2000, ?)`
      ).run(OTHER_INSTANCE);

      // 降级成 v14 老库：无 role_id 列、无映射表、版本号退回 14。
      downgradeToV14(raw);
      expect(versionOf(raw)).toBe(14);

      db.initialize(); // 版本号低于目标 → 重跑迁移链
      expect(versionOf(raw)).toBe(16);

      // ① role_id 列 + 复合唯一索引就位
      const column = columnInfo(raw, 'characters').find((c) => String(c.name) === 'role_id');
      expect(column).toBeDefined();
      expect(Number(column?.notnull)).toBe(0);
      expect(column?.dflt_value ?? null).toBeNull();
      const index = indexList(raw, 'characters').find((i) => String(i.name) === 'idx_characters_role_instance');
      expect(Number(index?.unique)).toBe(1);
      expect(indexColumns(raw, 'idx_characters_role_instance')).toEqual(['role_id', 'instance_id']);

      // ② 映射表就位
      expect(columnInfo(raw, 'character_id_map').map((c) => String(c.name))).toEqual([
        'old_id',
        'new_id',
        'instance_id',
        'created_at',
      ]);

      // ④ 零数据改写：旧行 role_id 仍 NULL（= 未回填），其它列原样、行数不变
      const row = raw.prepare('SELECT name, level, exp, role_id FROM characters WHERE id = ?').get('ch-old');
      expect(row).toMatchObject({ name: '测试角色', level: 1, exp: 0, role_id: null });
      expect(raw.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 2 });
    });

    it('迁移可重跑：initialize 再跑一次不炸、列/索引不重复、行数不变', async () => {
      const db = await openAndInitialize(dir);
      opened = db;
      const raw = db.getDatabase();
      insertCharacter(raw, 'ch-old');

      expect(() => {
        db.initialize();
        db.initialize();
      }).not.toThrow();

      expect(versionOf(raw)).toBe(16);
      expect(columnInfo(raw, 'characters').filter((c) => String(c.name) === 'role_id')).toHaveLength(1);
      expect(
        indexList(raw, 'characters').filter((i) => String(i.name) === 'idx_characters_role_instance')
      ).toHaveLength(1);
      expect(indexList(raw, 'character_id_map').filter((i) => String(i.name) === 'idx_character_id_map_new'))
        .toHaveLength(1);
      expect(raw.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 1 });
    });

    it('DAO 的 ensure* 重跑：不炸、列不重复、索引不重复、行数不变', async () => {
      const raw = new Database(path.join(dir, 'save.sqlite'));
      await raw.initialize();
      try {
        ensureGameSaveTables(raw);
        insertCharacter(raw, 'ch-old');

        expect(() => {
          ensureGameSaveTables(raw);
          ensureCharacterIdMapTable(raw);
        }).not.toThrow();

        expect(columnInfo(raw, 'characters').filter((c) => String(c.name) === 'role_id')).toHaveLength(1);
        expect(
          indexList(raw, 'characters').filter((i) => String(i.name) === 'idx_characters_role_instance')
        ).toHaveLength(1);
        expect(raw.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 1 });
        expect(
          raw.prepare('SELECT role_id FROM characters WHERE id = ?').get('ch-old')
        ).toMatchObject({ role_id: null });
      } finally {
        raw.close();
      }
    });

    it('重开已 15 版的库：不再重建、列/索引不重复', async () => {
      const first = await openAndInitialize(dir);
      first.close();

      const reopened = await openAndInitialize(dir);
      opened = reopened;
      const raw = reopened.getDatabase();
      expect(versionOf(raw)).toBe(16);
      expect(columnInfo(raw, 'characters').filter((c) => String(c.name) === 'role_id')).toHaveLength(1);
      expect(
        indexList(raw, 'characters').filter((i) => String(i.name) === 'idx_characters_role_instance')
      ).toHaveLength(1);
      reopened.close();
    });
  });
});
