/**
 * 集成测试：agent 健康监测持久化（task_054，@since v3.30）。
 * 驱动：真实 sql.js 适配器 + 临时文件库（与 character-schema-v9 同口径 —— 迁移逻辑的价值
 * 恰在"真 SQL 兼容性"，mock 连接等于把被测对象一起 mock 掉）。
 * 覆盖规格④⑤的落库面：
 *   1. schema v10：全新库直接建 agent_health_events（版本落 10）；
 *   2. v9 老库 → 迁移补建表（版本升 10，表结构 / 索引齐）；
 *   3. DAO：ensure 幂等兜底（裸库直接用 DAO 也能就位）+ insert / count 往返；
 *   4. CHECK 约束：表外 event 词拒绝（脏词别进审计流）；
 *   5. 重开库数据还在（审计流是长期真相，不是内存计数）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';
import { StratixDatabase } from '@/stratix-database/StratixDatabase';

import {
  AGENT_HEALTH_EVENTS_TABLE,
  countUnhealthyEvents,
  ensureAgentHealthEventsTable,
  insertAgentHealthEvent,
} from '../../services/persistence/agent-health-dao';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-health-v10-'));
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

describe('StratixDatabase schema v10（agent_health_events，task_054）', () => {
  test('全新库：直接建表（含索引），版本落 10，DAO 可直接写入', async () => {
    const dir = tempDir();
    try {
      const db = await openAndInitialize(dir);
      expect(versionOf(db)).toBe(15); // v15（task_199）起目标 schema 是 15（role_id + 复合唯一索引 + character_id_map）
      const tables = (
        db.getDatabase().prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{
          name: string;
        }>
      ).map((row) => row.name);
      expect(tables).toContain(AGENT_HEALTH_EVENTS_TABLE);
      // (kind, created_at) 索引：审计流的统计查询面。
      const indexes = (
        db.getDatabase().prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as Array<{
          name: string;
        }>
      ).map((row) => row.name);
      expect(indexes).toContain('idx_agent_health_events_kind_time');

      insertAgentHealthEvent(db.getDatabase(), { kind: 'claude-code', event: 'unhealthy', createdAt: 1 });
      expect(countUnhealthyEvents(db.getDatabase(), 'claude-code')).toBe(1);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('v9 老库 → 迁移补建 agent_health_events，版本升 10，老数据不受扰', async () => {
    const dir = tempDir();
    try {
      // 手工造 v9 老库（老版本号 + 一张老表占位即可，迁移只补新表不动老表）。
      const raw = new Database(path.join(dir, 'game.sqlite'));
      await raw.initialize();
      raw.exec(
        'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at INTEGER NOT NULL)'
      );
      raw.exec('INSERT INTO schema_version (version, applied_at) VALUES (9, 1)');
      raw.exec(
        'CREATE TABLE IF NOT EXISTS characters (id TEXT PRIMARY KEY, kind TEXT)'
      );
      raw.exec("INSERT INTO characters (id) VALUES ('c_old')");
      raw.close();

      const db = await openAndInitialize(dir);
      expect(versionOf(db)).toBe(15); // v15（task_199）起目标 schema 是 15（role_id + 复合唯一索引 + character_id_map）
      const row = db.getDatabase().prepare(`SELECT id FROM characters WHERE id = 'c_old'`).get() as { id: string };
      expect(row.id).toBe('c_old'); // 老表老行原样
      insertAgentHealthEvent(db.getDatabase(), { kind: 'kimi', event: 'offline', createdAt: 42 });
      expect(countUnhealthyEvents(db.getDatabase(), 'kimi')).toBe(0); // offline 不是 unhealthy
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('agent-health-dao：就位兜底 + 插入 + 计数', () => {
  test('裸库直接用 DAO：ensure 幂等，insert/count 往返；重开库数据还在', async () => {
    const dir = tempDir();
    try {
      const db = new Database(path.join(dir, 'health.sqlite'));
      await db.initialize();
      expect(() => ensureAgentHealthEventsTable(db)).not.toThrow();
      expect(() => ensureAgentHealthEventsTable(db)).not.toThrow(); // 幂等

      insertAgentHealthEvent(db, { kind: 'claude-code', event: 'unhealthy', createdAt: 10 });
      insertAgentHealthEvent(db, { kind: 'claude-code', event: 'unhealthy', createdAt: 20 });
      insertAgentHealthEvent(db, { kind: 'claude-code', event: 'offline', createdAt: 30 });
      insertAgentHealthEvent(db, { kind: 'kimi', event: 'unhealthy', createdAt: 40 });

      expect(countUnhealthyEvents(db, 'claude-code')).toBe(2); // 只数 unhealthy，翻转不计
      expect(countUnhealthyEvents(db, 'kimi')).toBe(1);
      expect(countUnhealthyEvents(db)).toBe(3); // 全 kind 合计
      expect(countUnhealthyEvents(db, 'opencode')).toBe(0);
      db.close();

      // 重开同一文件库：审计流是长期真相（进程内计数会归零，库不会）。
      const reopen = new Database(path.join(dir, 'health.sqlite'));
      await reopen.initialize();
      expect(countUnhealthyEvents(reopen)).toBe(3);
      reopen.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('CHECK 约束：表外 event 词拒绝（别让脏词进审计流）', async () => {
    const dir = tempDir();
    try {
      const db = new Database(path.join(dir, 'bad.sqlite'));
      await db.initialize();
      expect(() => insertAgentHealthEvent(db, { kind: 'kimi', event: 'exploded' as never, createdAt: 1 })).toThrow();
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
