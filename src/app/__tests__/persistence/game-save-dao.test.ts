/**
 * 单测：游戏存档 DAO（app/services/persistence/game-save-dao.ts）。
 *
 * 驱动说明：用**真实的 sql.js 适配器**（生产同款，src/stratix-database/sqlite-adapter.ts）
 * 开临时文件库 —— DAO 的全部职责就是"SQL 参数绑定 + 行映射"，mock 掉连接等于把它一起 mock 掉了。
 * 不用 better-sqlite3：本机 node_modules 未安装该原生模块（package.json 有声明但 electron rebuild 才装）。
 * 重开一次文件验证**落盘持久化**：适配器的写是 100ms 防抖刷盘，close() 前显式 save() 保证确定性。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import {
  ensureGameSaveTables,
  loadCharacters,
  loadGameSnapshot,
  loadUnitPositions,
  upsertCharacters,
  upsertUnitPositions,
  type PersistedCharacterRecord,
} from '../../services/persistence/game-save-dao';

function record(patch: Partial<PersistedCharacterRecord> = {}): PersistedCharacterRecord {
  return {
    id: 'character_1',
    name: '阿锻',
    agentKind: 'claude-code',
    persona: '沉着冷静',
    level: 3,
    exp: 250,
    appearanceJson: '{"bodyType":"male","parts":{"hair":{"variant":"black","itemId":"hair_male_spiky"}}}',
    bodyType: 'male',
    skinId: 'skin_forge',
    externalSessionId: null,
    contextEnabled: true,
    createdAt: 1700000000000,
    ...patch,
  };
}

describe('game-save-dao（真实 sql.js 适配器）', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(async () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-game-save-')), 'save.sqlite');
    db = new Database(dbPath);
    await db.initialize();
    ensureGameSaveTables(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  describe('characters 表', () => {
    it('upsert → load 全字段往返一致', () => {
      const input = record();
      upsertCharacters(db, [input]);

      expect(loadCharacters(db)).toEqual([input]);
    });

    it('可空字段以 null 往返（无外观 / 未绑定 agent）', () => {
      const bare = record({
        id: 'character_2',
        agentKind: null,
        appearanceJson: null,
        bodyType: null,
        skinId: null,
        externalSessionId: null,
      });
      upsertCharacters(db, [bare]);

      expect(loadCharacters(db)).toEqual([bare]);
    });

    it('同 id 重复 upsert 覆盖业务字段、保留最初 created_at', () => {
      upsertCharacters(db, [record({ level: 1, exp: 0, createdAt: 111 })]);
      upsertCharacters(db, [record({ level: 5, exp: 900, persona: '升级后', createdAt: 999 })]);

      const rows = loadCharacters(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.level).toBe(5);
      expect(rows[0]?.exp).toBe(900);
      expect(rows[0]?.persona).toBe('升级后');
      // created_at 不在 ON CONFLICT 的更新集里：首插时间就是建档时间，不被后续存档搅浑
      expect(rows[0]?.createdAt).toBe(111);
    });

    it('load 按创建时间升序（恢复后 HUD 列表顺序稳定）', () => {
      upsertCharacters(db, [record({ id: 'c_late', createdAt: 200 }), record({ id: 'c_early', createdAt: 100 })]);

      expect(loadCharacters(db).map((r) => r.id)).toEqual(['c_early', 'c_late']);
    });
  });

  describe('unit_positions 表', () => {
    it('upsert → load 往返一致', () => {
      upsertUnitPositions(db, [
        { characterId: 'character_1', x: 100.5, y: -32.25 },
        { characterId: 'character_2', x: 0, y: 0 },
      ]);

      expect(loadUnitPositions(db)).toEqual([
        { characterId: 'character_1', x: 100.5, y: -32.25 },
        { characterId: 'character_2', x: 0, y: 0 },
      ]);
    });

    it('同角色重复 upsert 覆盖坐标（不留旧行）', () => {
      upsertUnitPositions(db, [{ characterId: 'character_1', x: 1, y: 1 }]);
      upsertUnitPositions(db, [{ characterId: 'character_1', x: 77, y: -4 }]);

      expect(loadUnitPositions(db)).toEqual([{ characterId: 'character_1', x: 77, y: -4 }]);
    });
  });

  describe('快照与持久化', () => {
    it('loadGameSnapshot 一次取齐两份', () => {
      upsertCharacters(db, [record()]);
      upsertUnitPositions(db, [{ characterId: 'character_1', x: 9, y: 8 }]);

      expect(loadGameSnapshot(db)).toEqual({
        characters: [record()],
        unitPositions: [{ characterId: 'character_1', x: 9, y: 8 }],
      });
    });

    it('close 后重开同一文件，数据还在（真落盘，不是内存态）', async () => {
      upsertCharacters(db, [record({ id: 'c_keep' })]);
      upsertUnitPositions(db, [{ characterId: 'c_keep', x: 12, y: 34 }]);
      db.save();
      db.close();

      const reopened = new Database(dbPath);
      await reopened.initialize();
      try {
        expect(loadCharacters(reopened).map((r) => r.id)).toEqual(['c_keep']);
        expect(loadUnitPositions(reopened)).toEqual([{ characterId: 'c_keep', x: 12, y: 34 }]);
      } finally {
        reopened.close();
      }
    });
  });
});
