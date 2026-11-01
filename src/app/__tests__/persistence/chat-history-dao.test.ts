/**
 * 单测：角色对话历史 DAO（app/services/persistence/chat-history-dao.ts，task_036）。
 *
 * 驱动说明：与 game-save-dao.test.ts 同一策略 —— 用**真实的 sql.js 适配器**（生产同款）
 * 开临时文件库；DAO 的全部职责就是"建表 + 参数绑定 + 行映射"，mock 掉连接等于把它一起 mock 掉了。
 * 重开一次文件验证**落盘持久化**：适配器的写是 100ms 防抖刷盘，close() 前显式 save() 保证确定性。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';
import { StratixDatabase } from '@/stratix-database/StratixDatabase';

import {
  ensureCharacterChatMessagesTable,
  insertChatMessage,
  loadChatMessages,
  loadEarlierChatMessages,
  type ChatMessageInsert,
} from '../../services/persistence/chat-history-dao';

function message(patch: Partial<ChatMessageInsert> = {}): ChatMessageInsert {
  return {
    characterId: 'character_1',
    role: 'user',
    content: '在吗',
    sessionRef: null,
    createdAt: 1700000000000,
    ...patch,
  };
}

describe('chat-history-dao（真实 sql.js 适配器）', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(async () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-chat-history-')), 'history.sqlite');
    db = new Database(dbPath);
    await db.initialize();
    ensureCharacterChatMessagesTable(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  describe('读写往返', () => {
    it('insert → load 全字段往返一致（user / assistant / system / 旧 error role + sessionRef 可空）', () => {
      insertChatMessage(db, message());
      insertChatMessage(db, message({ role: 'assistant', content: '在的', sessionRef: 'sess-abc', createdAt: 1700000000001 }));
      insertChatMessage(db, message({ role: 'system', content: '⚠ 调用超时', createdAt: 1700000000002 }));
      insertChatMessage(db, message({ role: 'error', content: '⚠ 旧错误行', createdAt: 1700000000003 }));

      const rows = loadChatMessages(db, 'character_1');
      expect(rows).toEqual([
        { id: expect.any(Number), characterId: 'character_1', role: 'user', content: '在吗', sessionRef: null, createdAt: 1700000000000 },
        { id: expect.any(Number), characterId: 'character_1', role: 'assistant', content: '在的', sessionRef: 'sess-abc', createdAt: 1700000000001 },
        { id: expect.any(Number), characterId: 'character_1', role: 'system', content: '⚠ 调用超时', sessionRef: null, createdAt: 1700000000002 },
        { id: expect.any(Number), characterId: 'character_1', role: 'error', content: '⚠ 旧错误行', sessionRef: null, createdAt: 1700000000003 },
      ]);
    });

    it('id 自增：后写的 id 更大；load 返回时间正序（最旧在前，直接可回填）', () => {
      insertChatMessage(db, message({ content: '第一条' }));
      insertChatMessage(db, message({ content: '第二条' }));

      const rows = loadChatMessages(db, 'character_1');
      expect(rows.map((r) => r.content)).toEqual(['第一条', '第二条']);
      expect(rows[1].id).toBeGreaterThan(rows[0].id);
    });

    it('按角色隔离：别的角色的消息不串进来；没记录的角色是空数组', () => {
      insertChatMessage(db, message({ characterId: 'a', content: '给 A' }));
      insertChatMessage(db, message({ characterId: 'b', content: '给 B' }));

      expect(loadChatMessages(db, 'a').map((r) => r.content)).toEqual(['给 A']);
      expect(loadChatMessages(db, 'b').map((r) => r.content)).toEqual(['给 B']);
      expect(loadChatMessages(db, 'ghost')).toEqual([]);
    });
  });

  describe('50 条窗口', () => {
    it('缺省窗口 50：只取最近 50 条（旧于窗口的丢掉），仍按正序返回', () => {
      for (let i = 1; i <= 120; i += 1) {
        insertChatMessage(db, message({ content: `m${i}`, createdAt: i }));
      }

      const rows = loadChatMessages(db, 'character_1');
      expect(rows).toHaveLength(50);
      expect(rows[0].content).toBe('m71'); // 120 - 50 + 1
      expect(rows[49].content).toBe('m120');
    });

    it('显式窗口收紧 / 放宽都成立（向后分页的窗口语义就位，UI 侧触发器后置）', () => {
      for (let i = 1; i <= 30; i += 1) {
        insertChatMessage(db, message({ content: `m${i}`, createdAt: i }));
      }

      expect(loadChatMessages(db, 'character_1', 10).map((r) => r.content)).toEqual(
        Array.from({ length: 10 }, (_, k) => `m${k + 21}`)
      );
      expect(loadChatMessages(db, 'character_1', 100)).toHaveLength(30);
    });
  });

  describe('beforeId 游标窗口', () => {
    beforeEach(() => {
      for (let i = 1; i <= 12; i += 1) {
        insertChatMessage(db, message({ content: `m${i}`, createdAt: i }));
      }
      insertChatMessage(db, message({ characterId: 'other', content: '别的角色' }));
    });

    it('游标前不足一页：返回全部更早消息且保持正序', () => {
      expect(loadEarlierChatMessages(db, 'character_1', 6, 10).map((row) => row.content)).toEqual([
        'm1', 'm2', 'm3', 'm4', 'm5',
      ]);
    });

    it('游标前恰好一页：不额外夹带游标或其他角色消息', () => {
      const rows = loadEarlierChatMessages(db, 'character_1', 11, 10);
      expect(rows.map((row) => row.content)).toEqual([
        'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10',
      ]);
      expect(rows.some((row) => row.id === 11 || row.characterId === 'other')).toBe(false);
    });

    it('跨页连续读取：最近页、上一整页和最后不足页边界不重不漏', () => {
      const latest = loadChatMessages(db, 'character_1', 5);
      expect(latest.map((row) => row.content)).toEqual(['m8', 'm9', 'm10', 'm11', 'm12']);

      const previous = loadEarlierChatMessages(db, 'character_1', latest[0].id, 5);
      expect(previous.map((row) => row.content)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7']);
      expect(loadEarlierChatMessages(db, 'character_1', previous[0].id, 5).map((row) => row.content)).toEqual([
        'm1', 'm2',
      ]);
    });
  });

  describe('建表幂等与落盘', () => {
    it('重复 ensure 不炸（IF NOT EXISTS 幂等）', () => {
      expect(() => ensureCharacterChatMessagesTable(db)).not.toThrow();
    });

    it('close 后重开同一文件，历史还在（真落盘，不是内存态）', async () => {
      insertChatMessage(db, message({ role: 'assistant', content: '重启后还在', sessionRef: 'sess-xyz' }));
      db.save();
      db.close();

      const reopened = new Database(dbPath);
      await reopened.initialize();
      try {
        ensureCharacterChatMessagesTable(reopened); // 新连接上的兜底建表（IF NOT EXISTS）不动既有数据
        const rows = loadChatMessages(reopened, 'character_1');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ role: 'assistant', content: '重启后还在', sessionRef: 'sess-xyz' });
      } finally {
        reopened.close();
      }
    });

    it('v12 老表 CHECK 不含 system：初始化时重建并保留旧行，随后可写 system', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-chat-system-'));
      const filename = path.join(dir, 'game.sqlite');
      const raw = new Database(filename);
      await raw.initialize();
      raw.exec(`
        CREATE TABLE character_chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'error')),
          content TEXT NOT NULL,
          session_ref TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
        INSERT INTO schema_version (version, applied_at) VALUES (12, 1);
        INSERT INTO character_chat_messages (character_id, role, content, created_at)
        VALUES ('character_1', 'error', '旧错误仍在', 1);
      `);
      raw.close();

      const migrated = new StratixDatabase({ dataDir: dir, filename: 'game' });
      await migrated.init();
      try {
        migrated.initialize();
        insertChatMessage(migrated.getDatabase(), message({ role: 'system', content: '新系统事件', createdAt: 2 }));
        expect(loadChatMessages(migrated.getDatabase(), 'character_1').map((row) => [row.role, row.content])).toEqual([
          ['error', '旧错误仍在'],
          ['system', '新系统事件'],
        ]);
      } finally {
        migrated.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
