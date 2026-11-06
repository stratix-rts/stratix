/**
 * 集成测试：M2-03 的 **N4b-1**（@since v3.3，task_200）——
 *   `session_external_refs` 表（externalSessionId 独立成表，联合键 `(external_session_id, instance_id)`）。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.3.2「`externalSessionId` 的处置（R1-40）」
 *   + §3.4 **R3**（chat / 互聊会话不得跨副本续发）。
 *
 * 五条验收逐条落到可执行的断言：
 *   ① 表按裁决 DDL 落地（五列 + 复合主键 + 联合键反查索引）；
 *   ② **联合匹配**：`(extId, instanceId)` 命中；换个 instanceId ⇒ **查不到**（R3 的判据）；
 *   ③ 镜像列保留：`characters.external_session_id` 列仍在（只读兼容镜像），新表与之互不干扰；
 *   ④ 迁移幂等可重跑（initialize 重跑 / 重开库：表在、行数不变）；
 *   ⑤ 零数据改写：老库（v15）升级后存量行原样。
 *
 * 驱动：真实 sql.js 适配器 + 临时文件库（与其它 schema 测试同口径 —— 迁移逻辑的价值恰在
 *   「真 SQL 兼容性」，mock 掉连接等于把被测对象一起 mock 掉）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';
import { StratixDatabase } from '@/stratix-database/StratixDatabase';

import { ensureGameSaveTables } from '@/app/services/persistence/game-save-dao';
import {
  ensureSessionExternalRefsTable,
  findSessionExternalRef,
  findSessionExternalRefByCharacter,
  listSessionExternalRefs,
  parseSessionExternalRefInsert,
  recordSessionExternalRef,
  SESSION_EXTERNAL_REFS_TABLE,
} from '@/app/services/persistence/session-external-ref-dao';

/** 副本 A / 副本 B（切副本的场景：同一个 extId 在 B 副本查不到）。 */
const INSTANCE_A = 'wsp_a';
const INSTANCE_B = 'wsp_b';

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
function insertCharacter(raw: Database, id: string, externalSessionId: string | null = null): void {
  raw
    .prepare(
      `INSERT INTO characters (id, name, kind, persona, level, exp, appearance, body_type, skin_id,
         external_session_id, context_enabled, created_at, updated_at, instance_id, role_id)
       VALUES (?, '测试角色', 'codex', '', 1, 0, NULL, NULL, NULL, ?, 1, 1000, 1000, NULL, NULL)`
    )
    .run(id, externalSessionId);
}

describe('M2-03：N4b-1 session_external_refs 表（task_200）', () => {
  describe('① 表按裁决 DDL 落地（五列 + 复合主键 + 索引）', () => {
    let dir: string;
    let raw: Database;

    beforeEach(async () => {
      dir = tempDir('stratix-session-ext-ref-');
      raw = new Database(path.join(dir, 'save.sqlite'));
      await raw.initialize();
    });

    afterEach(() => {
      raw.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('表在位：五列 + 复合主键 (external_session_id, instance_id)', () => {
      ensureSessionExternalRefsTable(raw);

      const columns = columnInfo(raw, SESSION_EXTERNAL_REFS_TABLE);
      expect(columns.map((c) => String(c.name))).toEqual([
        'external_session_id',
        'instance_id',
        'character_id',
        'session_id',
        'created_at',
      ]);
      // 联合键：external_session_id 与 instance_id 组成复合主键（pk 序号 1 / 2）
      const pk = columns.filter((c) => Number(c.pk) > 0).map((c) => String(c.name));
      expect(pk).toEqual(['external_session_id', 'instance_id']);
      // NOT NULL 的两列：联合键的两半（NOT NULL 才会让复合主键真的约束住唯一性）
      const notNull = columns.filter((c) => Number(c.notnull) === 1).map((c) => String(c.name));
      expect(notNull).toContain('external_session_id');
      expect(notNull).toContain('instance_id');
      expect(notNull).toContain('created_at');
      // 辅助列可空（角色被删 / 内部会话不存在时不该挡住凭据本身）
      const characterId = columns.find((c) => String(c.name) === 'character_id');
      const sessionId = columns.find((c) => String(c.name) === 'session_id');
      expect(Number(characterId?.notnull)).toBe(0);
      expect(Number(sessionId?.notnull)).toBe(0);
    });

    it('联合键反查索引在位：(character_id, instance_id)', () => {
      ensureSessionExternalRefsTable(raw);
      const index = indexList(raw, SESSION_EXTERNAL_REFS_TABLE).find(
        (i) => String(i.name) === 'idx_session_external_refs_character'
      );
      expect(index).toBeDefined();
      expect(indexColumns(raw, 'idx_session_external_refs_character')).toEqual([
        'character_id',
        'instance_id',
      ]);
    });

    it('StratixDatabase 全新库：表同库就位、版本落 16', async () => {
      const db = await openAndInitialize(dir);
      const raw2 = db.getDatabase();
      expect(versionOf(raw2)).toBe(16);
      expect(
        columnInfo(raw2, SESSION_EXTERNAL_REFS_TABLE).map((c) => String(c.name))
      ).toEqual([
        'external_session_id',
        'instance_id',
        'character_id',
        'session_id',
        'created_at',
      ]);
      db.close();
    });
  });

  describe('② 联合匹配（R3 的判据）', () => {
    let dir: string;
    let raw: Database;

    beforeEach(async () => {
      dir = tempDir('stratix-session-ext-ref-');
      raw = new Database(path.join(dir, 'save.sqlite'));
      await raw.initialize();
      ensureSessionExternalRefsTable(raw);
    });

    afterEach(() => {
      raw.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('(extId, instance) 命中；换个 instance ⇒ 查不到（切副本后 resume 不可能）', () => {
      recordSessionExternalRef(raw, {
        externalSessionId: 'sess-ext-a',
        instanceId: INSTANCE_A,
        characterId: 'ch-1',
        sessionId: 'session-local-1',
        createdAt: 1000,
      });

      const hit = findSessionExternalRef(raw, 'sess-ext-a', INSTANCE_A);
      expect(hit).toEqual({
        externalSessionId: 'sess-ext-a',
        instanceId: INSTANCE_A,
        characterId: 'ch-1',
        sessionId: 'session-local-1',
        createdAt: 1000,
      });
      // R3：B 副本查同一 extId ⇒ 查不到 ⇒ resume 不可能（不跨副本携带上下文）
      expect(findSessionExternalRef(raw, 'sess-ext-a', INSTANCE_B)).toBeNull();
      // 按角色查同理：带副本维度
      expect(findSessionExternalRefByCharacter(raw, 'ch-1', INSTANCE_A)).not.toBeNull();
      expect(findSessionExternalRefByCharacter(raw, 'ch-1', INSTANCE_B)).toBeNull();
    });

    it('联合键拒收同键两行（同 extId + 同副本只能有一条凭据）', () => {
      recordSessionExternalRef(raw, {
        externalSessionId: 'sess-ext-a',
        instanceId: INSTANCE_A,
        characterId: 'ch-1',
        sessionId: null,
        createdAt: 1000,
      });
      expect(() =>
        raw
          .prepare(
            `INSERT INTO ${SESSION_EXTERNAL_REFS_TABLE}
               (external_session_id, instance_id, character_id, session_id, created_at)
             VALUES ('sess-ext-a', ?, 'ch-2', NULL, 2000)`
          )
          .run(INSTANCE_A)
      ).toThrow();
      // 另一个副本里同一个 extId ⇒ 合法（联合键的两半都参与唯一性）
      expect(() =>
        raw
          .prepare(
            `INSERT INTO ${SESSION_EXTERNAL_REFS_TABLE}
               (external_session_id, instance_id, character_id, session_id, created_at)
             VALUES ('sess-ext-a', ?, 'ch-2', NULL, 2000)`
          )
          .run(INSTANCE_B)
      ).not.toThrow();
    });

    it('幂等：同键重复写 ⇒ 覆盖辅助列，不新增行', () => {
      recordSessionExternalRef(raw, {
        externalSessionId: 'sess-ext-a',
        instanceId: INSTANCE_A,
        characterId: 'ch-1',
        sessionId: null,
        createdAt: 1000,
      });
      recordSessionExternalRef(raw, {
        externalSessionId: 'sess-ext-a',
        instanceId: INSTANCE_A,
        characterId: 'ch-1',
        sessionId: 'session-local-1',
        createdAt: 2000,
      });
      expect(listSessionExternalRefs(raw)).toHaveLength(1);
      expect(findSessionExternalRef(raw, 'sess-ext-a', INSTANCE_A)?.sessionId).toBe('session-local-1');
    });

    it('剪枝：同角色同副本换新 extId ⇒ 旧凭据作废（表不无界增长）', () => {
      recordSessionExternalRef(raw, {
        externalSessionId: 'sess-ext-old',
        instanceId: INSTANCE_A,
        characterId: 'ch-1',
        sessionId: null,
        createdAt: 1000,
      });
      recordSessionExternalRef(raw, {
        externalSessionId: 'sess-ext-new',
        instanceId: INSTANCE_A,
        characterId: 'ch-1',
        sessionId: null,
        createdAt: 2000,
      });
      const rows = listSessionExternalRefs(raw, INSTANCE_A);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.externalSessionId).toBe('sess-ext-new');
      expect(findSessionExternalRef(raw, 'sess-ext-old', INSTANCE_A)).toBeNull();
    });

    it('列表可按副本过滤（沙盒与别的副本各归各）', () => {
      recordSessionExternalRef(raw, {
        externalSessionId: 'sess-a',
        instanceId: INSTANCE_A,
        characterId: 'ch-1',
        sessionId: null,
        createdAt: 1000,
      });
      recordSessionExternalRef(raw, {
        externalSessionId: 'sess-b',
        instanceId: INSTANCE_B,
        characterId: 'ch-2',
        sessionId: null,
        createdAt: 2000,
      });
      expect(listSessionExternalRefs(raw, INSTANCE_A).map((r) => r.externalSessionId)).toEqual(['sess-a']);
      expect(listSessionExternalRefs(raw)).toHaveLength(2);
    });

    it('IPC 形状校验：脏形状一律拒（拒绝即回 {ok:false}）', () => {
      expect(parseSessionExternalRefInsert(null)).toBeNull();
      expect(parseSessionExternalRefInsert({ instanceId: INSTANCE_A })).toBeNull();
      expect(parseSessionExternalRefInsert({ externalSessionId: 'x' })).toBeNull();
      expect(
        parseSessionExternalRefInsert({
          externalSessionId: 'x',
          instanceId: INSTANCE_A,
          characterId: '',
          sessionId: 42,
          createdAt: 'nope',
        })
      ).toEqual({
        externalSessionId: 'x',
        instanceId: INSTANCE_A,
        characterId: null,
        sessionId: null,
        createdAt: expect.any(Number),
      });
    });
  });

  describe('③ 镜像列保留（只读兼容镜像）', () => {
    let dir: string;
    let raw: Database;

    beforeEach(async () => {
      dir = tempDir('stratix-session-ext-ref-');
      raw = new Database(path.join(dir, 'save.sqlite'));
      await raw.initialize();
    });

    afterEach(() => {
      raw.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('characters.external_session_id 列仍在（新表不删旧列）', () => {
      ensureGameSaveTables(raw);
      ensureSessionExternalRefsTable(raw);
      const columns = columnInfo(raw, 'characters').map((c) => String(c.name));
      expect(columns).toContain('external_session_id');
      // 新表与角色表互不干扰（两张表各自独立）
      expect(columnInfo(raw, SESSION_EXTERNAL_REFS_TABLE)).not.toHaveLength(0);
    });

    it('镜像写入照旧（兼容期）：角色行的会话 id 与引用表各记各的', () => {
      ensureGameSaveTables(raw);
      ensureSessionExternalRefsTable(raw);
      insertCharacter(raw, 'ch-1', 'sess-mirror');
      recordSessionExternalRef(raw, {
        externalSessionId: 'sess-mirror',
        instanceId: INSTANCE_A,
        characterId: 'ch-1',
        sessionId: null,
        createdAt: 1000,
      });

      const row = raw
        .prepare('SELECT external_session_id FROM characters WHERE id = ?')
        .get('ch-1') as { external_session_id?: string };
      expect(row.external_session_id).toBe('sess-mirror'); // 镜像照写
      expect(findSessionExternalRefByCharacter(raw, 'ch-1', INSTANCE_A)).not.toBeNull(); // 真相在引用表
    });
  });

  describe('④⑤ 迁移幂等 + 零数据改写', () => {
    let dir: string;

    beforeEach(() => {
      dir = tempDir('stratix-session-ext-ref-');
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('迁移可重跑：initialize 两次 ⇒ 表在、行数不变、版本仍是 16', async () => {
      const first = await openAndInitialize(dir);
      const raw = first.getDatabase();
      recordSessionExternalRef(raw, {
        externalSessionId: 'sess-ext-a',
        instanceId: INSTANCE_A,
        characterId: 'ch-1',
        sessionId: null,
        createdAt: 1000,
      });
      first.close();

      const second = await openAndInitialize(dir);
      const raw2 = second.getDatabase();
      expect(versionOf(raw2)).toBe(16);
      expect(listSessionExternalRefs(raw2)).toHaveLength(1);
      second.close();
    });

    it('老库（v15）升级：存量 characters 行原样（零数据改写），新表就位', async () => {
      // 先建一个库，再**降级**成 v15 形状（有 characters 行、没有引用表、版本号 15）。
      // why 用降级而不是手写 DDL：迁移链是唯一事实源，手写的「v15 形状」会随上游演进漂移。
      const legacy = await openAndInitialize(dir);
      const rawLegacy = legacy.getDatabase();
      insertCharacter(rawLegacy, 'ch-old', 'sess-old');
      rawLegacy.exec('DROP TABLE IF EXISTS session_external_refs');
      rawLegacy.exec('DELETE FROM schema_version');
      rawLegacy.exec('INSERT INTO schema_version (version, applied_at) VALUES (15, 0)');
      legacy.close();

      const db = await openAndInitialize(dir);
      const raw = db.getDatabase();
      expect(versionOf(raw)).toBe(16);
      // 存量行一个字节都没动
      const row = raw
        .prepare('SELECT external_session_id FROM characters WHERE id = ?')
        .get('ch-old') as { external_session_id?: string };
      expect(row.external_session_id).toBe('sess-old');
      // 新表就位且是空的（纯新表 ⇒ 不装旧行）
      expect(listSessionExternalRefs(raw)).toHaveLength(0);
      db.close();
    });
  });
});
