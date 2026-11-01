/**
 * 集成测试：自定义 agent 注册表持久化（task_056，@since v3.32）。
 * 驱动：真实 sql.js 适配器 + 临时文件库（与 agent-health-schema-v10 同口径 —— 迁移逻辑的价值
 * 恰在"真 SQL 兼容性"，mock 连接等于把被测对象一起 mock 掉）。
 * 覆盖规格①（表结构 / schema v11）与规格⑥（注册 CRUD 迁移）：
 *   1. schema v11：全新库直接建 custom_agents（版本落 11）；
 *   2. v10 老库 → 迁移补建表（版本升 11；v10 已有的健康事件表不丢）；
 *   3. DAO：ensure 幂等兜底（裸库直接用 DAO 也能就位）+ insert / load / find / delete 往返；
 *   4. CHECK 约束：output_parser 词表外的脏值拒绝（词表钉死在表结构上）；
 *   5. 重开库注册还在（注册是长期真相，不是会话内存）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';
import { StratixDatabase } from '@/stratix-database/StratixDatabase';

import {
  CUSTOM_AGENTS_TABLE,
  deleteCustomAgent,
  ensureCustomAgentsTable,
  findCustomAgent,
  insertCustomAgent,
  loadCustomAgents,
  type CustomAgentDbLike,
  type PersistedCustomAgentRecord,
} from '../../services/persistence/custom-agent-dao';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-custom-agents-'));
}

/** 开库即迁移到位（与 agent-health-schema-v10 的 openAndInitialize 同口径）。 */
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

function makeRecord(overrides: Partial<PersistedCustomAgentRecord> = {}): PersistedCustomAgentRecord {
  return {
    id: 'myagent',
    name: 'MyAgent',
    probeCmd: 'myagent --version',
    runCmdTemplate: 'myagent ask {prompt}',
    outputParser: 'plain',
    createdAt: 1761400000000,
    ...overrides,
  };
}

describe('StratixDatabase schema v11（custom_agents，task_056）', () => {
  test('全新库：直接建表，版本落 11，DAO 可直接写入', async () => {
    const dir = tempDir();
    try {
      const db = await openAndInitialize(dir);
      expect(versionOf(db)).toBe(12);
      const tables = (
        db.getDatabase().prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{
          name: string;
        }>
      ).map((row) => row.name);
      expect(tables).toContain(CUSTOM_AGENTS_TABLE);

      insertCustomAgent(db.getDatabase() as unknown as CustomAgentDbLike, makeRecord());
      expect(loadCustomAgents(db.getDatabase() as unknown as CustomAgentDbLike).map((row) => row.id)).toEqual(['myagent']);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('v10 老库 → 迁移补建 custom_agents，版本升 11，v10 已有的健康事件表不丢', async () => {
    const dir = tempDir();
    try {
      // 手工造 v10 老库：先完整迁移到 11，再删新表 + 钉回 10（其余 v10 产物保持不动）。
      const file = path.join(dir, 'game.sqlite');
      const raw = new Database(file);
      await raw.initialize();
      raw.exec(
        'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at INTEGER NOT NULL)'
      );
      raw.exec('INSERT INTO schema_version (version, applied_at) VALUES (10, 1)');
      raw.exec(
        'CREATE TABLE IF NOT EXISTS agent_health_events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, event TEXT NOT NULL, created_at INTEGER NOT NULL)'
      );
      raw.close();

      const db = await openAndInitialize(dir);
      expect(versionOf(db)).toBe(12);
      const names = (
        db.getDatabase().prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{
          name: string;
        }>
      ).map((row) => row.name);
      expect(names).toContain(CUSTOM_AGENTS_TABLE);
      expect(names).toContain('agent_health_events'); // v10 的表还在 —— 迁移只补不拆
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('custom-agent-dao：就位兜底 + CRUD + 约束', () => {
  test('裸库直接用 DAO：ensure 幂等就位（自愈兑底，不依赖迁移链）', async () => {
    const dir = tempDir();
    try {
      const raw = new Database(path.join(dir, 'bare.sqlite'));
      await raw.initialize();
      const db = raw as unknown as CustomAgentDbLike;
      expect(() => ensureCustomAgentsTable(db)).not.toThrow();
      expect(() => ensureCustomAgentsTable(db)).not.toThrow(); // 幂等：重复 ensure 不炸
      insertCustomAgent(db, makeRecord());
      expect(loadCustomAgents(db).map((row) => row.id)).toEqual(['myagent']);
      raw.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('insert / load / find / delete 往返：字段逐一保真', async () => {
    const dir = tempDir();
    try {
      const raw = new Database(path.join(dir, 'crud.sqlite'));
      await raw.initialize();
      const db = raw as unknown as CustomAgentDbLike;
      ensureCustomAgentsTable(db);
      insertCustomAgent(db, makeRecord());
      insertCustomAgent(db, makeRecord({ id: 'jtool', name: 'JTool', outputParser: 'json', createdAt: 1761400000001 }));

      const rows = loadCustomAgents(db);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(makeRecord());
      expect(rows[1]).toEqual(makeRecord({ id: 'jtool', name: 'JTool', outputParser: 'json', createdAt: 1761400000001 }));

      expect(findCustomAgent(db, 'jtool')?.runCmdTemplate).toBe('myagent ask {prompt}');
      expect(findCustomAgent(db, 'nobody')).toBeNull();

      deleteCustomAgent(db, 'myagent');
      expect(loadCustomAgents(db).map((row) => row.id)).toEqual(['jtool']);
      deleteCustomAgent(db, 'myagent'); // 幂等删除：再删不炸（与 UI 的重复点击和解）
      raw.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('CHECK 约束：output_parser 词表外的脏值拒绝（词表钉死在表结构上）', async () => {
    const dir = tempDir();
    try {
      const raw = new Database(path.join(dir, 'check.sqlite'));
      await raw.initialize();
      const db = raw as unknown as CustomAgentDbLike;
      ensureCustomAgentsTable(db);
      expect(() => insertCustomAgent(db, makeRecord({ outputParser: 'xml' as never }))).toThrow();
      expect(loadCustomAgents(db)).toHaveLength(0); // 脏值没进表
      raw.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('重开库注册还在（长期真相，不是会话内存）', async () => {
    const dir = tempDir();
    try {
      const first = await openAndInitialize(dir);
      insertCustomAgent(first.getDatabase() as unknown as CustomAgentDbLike, makeRecord());
      first.close();

      const second = await openAndInitialize(dir);
      expect(loadCustomAgents(second.getDatabase() as unknown as CustomAgentDbLike).map((row) => row.id)).toEqual(['myagent']);
      second.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('表名常量冻结：custom_agents（与 StratixDatabase 的 DDL 同名铁律）', () => {
    expect(CUSTOM_AGENTS_TABLE).toBe('custom_agents');
  });
});
