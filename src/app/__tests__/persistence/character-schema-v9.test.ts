/**
 * 集成测试：schema v9 迁移（task_053，characters.context_enabled 列）。
 * 驱动：真实 sql.js 适配器 + 临时文件库（与 task-schema-v8 同口径 —— 迁移逻辑的价值
 * 恰在"真 SQL 兼容性"，mock 连接等于把被测对象一起 mock 掉）。
 * 覆盖：
 *   1. 全新库：createTables 建表即带 context_enabled（DEFAULT 1），版本落 9；
 *   2. v8 老库（characters 无该列）→ ALTER ADD 补列，存量行归 1（缺省即开），版本升 9；
 *   3. game-save-dao：ensure 幂等兜底 + upsert/load 往返（含 0=关 的回读）；
 *   4. game-save-coordinator：记录 ↔ 视图双向映射（false 持久 / 缺省归一 true）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';
import { StratixDatabase } from '@/stratix-database/StratixDatabase';

import {
  ensureGameSaveTables,
  loadCharacters,
  upsertCharacters,
  type PersistedCharacterRecord,
} from '../../services/persistence/game-save-dao';
import {
  characterViewToRecord,
  recordToCharacterView,
} from '../../services/persistence/game-save-coordinator';
import type { CharacterView } from '../../../core/types';

/** v8 形状的 characters 表（无 context_enabled）—— 模拟 task_051 时代的老库。 */
const V8_CHARACTERS_DDL = `
  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT,
    persona TEXT NOT NULL DEFAULT '',
    level INTEGER NOT NULL DEFAULT 1,
    exp INTEGER NOT NULL DEFAULT 0,
    appearance TEXT,
    body_type TEXT,
    skin_id TEXT,
    external_session_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

function characterView(patch: Partial<CharacterView> = {}): CharacterView {
  return {
    id: 'character_1',
    name: '阿锻',
    persona: '# 角色\n沉着冷静',
    level: 3,
    experience: 120,
    agentKind: 'codex',
    ...patch,
  };
}

function contextRecord(patch: Partial<PersistedCharacterRecord> = {}): PersistedCharacterRecord {
  return {
    id: 'character_1',
    name: '阿锻',
    agentKind: 'codex',
    persona: 'p',
    level: 1,
    exp: 0,
    appearanceJson: null,
    bodyType: null,
    skinId: null,
    externalSessionId: null,
    contextEnabled: true,
    createdAt: 1,
    ...patch,
  };
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-context-v9-'));
}

async function openAndInitialize(dir: string): Promise<StratixDatabase> {
  const db = new StratixDatabase({ dataDir: dir, filename: 'game' });
  await db.init();
  db.initialize();
  return db;
}

function versionOf(db: StratixDatabase): number {
  const row = db
    .getDatabase()
    .prepare('SELECT MAX(version) AS v FROM schema_version')
    .get() as { v?: number };
  return row.v ?? 0;
}

function columns(db: StratixDatabase, table: string): string[] {
  const rows = db.getDatabase().prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => String(row.name));
}

afterAll(() => {
  void StratixDatabase;
});

describe('StratixDatabase schema v9（characters.context_enabled，task_053）', () => {
  test('全新库：建表即带 context_enabled（DEFAULT 1），版本落 9', async () => {
    const dir = tempDir();
    try {
      const db = await openAndInitialize(dir);
      expect(versionOf(db)).toBe(10); // v9 断言 +1：task_054 落 v10（agent_health_events）后新库即 10
      const cols = columns(db, 'characters');
      expect(cols).toContain('context_enabled');
      // 缺省即开：直接塞一行（走原生 SQL 绕过 DAO 证明 DDL 默认值本身）
      db.getDatabase()
        .prepare(
          `INSERT INTO characters (id, name, persona, created_at, updated_at)
           VALUES ('c1', '老七', '', 1, 1)`
        )
        .run();
      const row = db.getDatabase()
        .prepare('SELECT context_enabled FROM characters WHERE id = ?')
        .get('c1') as { context_enabled: number };
      expect(row.context_enabled).toBe(1);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('v8 老库（无 context_enabled）→ ALTER ADD 补列，存量行归 1，版本升 9', async () => {
    const dir = tempDir();
    try {
      // 先用 v8 形状的 DDL 手工造老库 + 老版本号，再走 StratixDatabase.initialize 触发迁移
      const raw = new Database(path.join(dir, 'game.sqlite'));
      await raw.initialize();
      raw.exec(V8_CHARACTERS_DDL);
      raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at INTEGER NOT NULL)');
      raw.exec('INSERT INTO schema_version (version, applied_at) VALUES (8, 1)');
      raw.exec(
        `INSERT INTO characters (id, name, persona, created_at, updated_at)
         VALUES ('c_old', '老档案', '旧设定', 100, 100)`
      );
      raw.close();

      const db = await openAndInitialize(dir);
      expect(versionOf(db)).toBe(10); // v9 断言 +1：task_054 落 v10（agent_health_events）后新库即 10
      expect(columns(db, 'characters')).toContain('context_enabled');
      const row = db.getDatabase()
        .prepare('SELECT context_enabled FROM characters WHERE id = ?')
        .get('c_old') as { context_enabled: number };
      // 存量行归「开」—— 迁移不猜旧档案偏好
      expect(row.context_enabled).toBe(1);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('game-save-dao：ensure 幂等兜底（裸表也能补列）+ upsert/load 往返（含 0=关）', async () => {
    const dir = tempDir();
    try {
      const db = new Database(path.join(dir, 'save.sqlite'));
      await db.initialize();
      // 裸 v8 形状表（不走 StratixDatabase —— 模拟老库只过 gameSave IPC 通道的场景）
      db.exec(V8_CHARACTERS_DDL);
      expect(() => ensureGameSaveTables(db)).not.toThrow();
      expect(() => ensureGameSaveTables(db)).not.toThrow(); // 幂等

      upsertCharacters(db, [
        contextRecord({ id: 'c_on', contextEnabled: true }),
        contextRecord({ id: 'c_off', contextEnabled: false }),
      ]);
      const rows = loadCharacters(db);
      const on = rows.find((r) => r.id === 'c_on');
      const off = rows.find((r: PersistedCharacterRecord) => r.id === 'c_off');
      expect(on?.contextEnabled).toBe(true);
      expect(off?.contextEnabled).toBe(false);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('coordinator 映射：false 持久往返；undefined/null（缺省）≡ true', () => {
    // 记录(false) → 视图(false) → 记录(false)：关掉的开关不许被归一抹掉
    const offView = recordToCharacterView(contextRecord({ contextEnabled: false }));
    expect(offView?.contextEnabled).toBe(false);
    expect(characterViewToRecord(offView as CharacterView, 1).contextEnabled).toBe(false);

    // 记录(true) → 视图不带字段（缺省即开）→ 记录归一 true
    const onView = recordToCharacterView(contextRecord({ contextEnabled: true }));
    expect(onView?.contextEnabled).toBeUndefined();
    expect(characterViewToRecord(onView as CharacterView, 1).contextEnabled).toBe(true);

    // 视图缺省 / null → 记录 true
    expect(characterViewToRecord(characterView(), 1).contextEnabled).toBe(true);
    expect(characterViewToRecord(characterView({ contextEnabled: null }), 1).contextEnabled).toBe(true);
  });
});
