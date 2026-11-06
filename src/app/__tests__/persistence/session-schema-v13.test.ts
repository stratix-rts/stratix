/**
 * 集成测试：StratixDatabase 的 schema v13 迁移（sessions + session_events 两张表，task_092）。
 * 三个起点各验一遍：
 *   1. 全新库 → 迁移链建出两张新表、版本落 13；
 *   2. v12 老库（有角色 / 任务 / 对话数据、无会话表、版本 12）→ 新表就位、老数据零丢失、版本升 13；
 *   3. 重开已 13 版的文件库 → 不再重建、索引幂等（迁移可重复执行）。
 * 迁移后还要能落「会话摘要 + 会话事件」并被 DAO 读回 —— 迁移产物必须与
 * session-dao / session-event-dao 期望的形状一致（同 task-schema-v8 的互锁口径）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';
import { StratixDatabase } from '@/stratix-database/StratixDatabase';
import {
  getSessionRecord,
  listSessionRecords,
  upsertSessionRecord,
} from '@/app/services/persistence/session-dao';
import {
  appendSessionEvent,
  listSessionEvents,
} from '@/app/services/persistence/session-event-dao';

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

describe('schema v13 迁移：sessions + session_events 表（真实 sql.js 文件库）', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-session-v13-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('全新库：两张表就位、版本落 13、DAO 直写直读', async () => {
    const db = await openAndInitialize(dir);
    const raw = db.getDatabase();

    expect(
      raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").all()
    ).toHaveLength(1);
    expect(
      raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_events'").all()
    ).toHaveLength(1);
    expect(versionOf(raw)).toBe(17);

    upsertSessionRecord(raw, {
      id: 'session_peer_chat_1',
      kind: 'peer_chat',
      title: '互聊：侦察北门',
      participants: ['agent-a', 'agent-b'],
      status: 'active',
      refId: null,
      createdAt: 1,
      lastEventAt: 1,
      closedAt: null,
      eventCount: 1,
    });
    appendSessionEvent(raw, {
      sessionId: 'session_peer_chat_1',
      seq: 1,
      type: 'created',
      payload: { title: '互聊：侦察北门' },
      createdAt: 1,
    });

    expect(getSessionRecord(raw, 'session_peer_chat_1')?.title).toBe('互聊：侦察北门');
    expect(listSessionRecords(raw, { kind: 'peer_chat' })).toHaveLength(1);
    expect(listSessionEvents(raw, 'session_peer_chat_1')).toHaveLength(1);
    db.close();
  });

  it('v12 老库（角色/任务/对话健在、无会话表）：新表补建、老数据零丢失、版本升 13', async () => {
    const db = await openAndInitialize(dir);
    const raw = db.getDatabase();
    raw.exec(`
      DROP TABLE sessions;
      DROP TABLE session_events;
      DELETE FROM schema_version;
      INSERT INTO schema_version (version, applied_at) VALUES (12, 0);
    `);
    // 铺老数据：角色 / 任务 / 对话各一行（跨表共存是既有能力，这里锚定"零丢失"）。
    raw.exec(`
      INSERT INTO characters (id, name, kind, persona, level, exp, context_enabled, created_at, updated_at)
        VALUES ('ch-old', '老鸦', 'codex', '老兵', 3, 77, 1, 1600000000000, 1600000000000);
      INSERT INTO character_tasks (id, character_id, prompt, status, output, created_at, artifacts, plan, pipeline_id)
        VALUES ('task_old', 'ch-old', '老任务', 'completed', '老输出', 1700000000000, '', '', '');
      INSERT INTO character_chat_messages (character_id, role, content, session_ref, created_at)
        VALUES ('ch-old', 'user', '老对话', NULL, 1700000000001);
    `);
    expect(versionOf(raw)).toBe(12);

    db.initialize(); // 版本号低于目标 → 重跑迁移链
    expect(versionOf(raw)).toBe(17);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 1 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM character_tasks').get()).toMatchObject({ n: 1 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM character_chat_messages').get()).toMatchObject({ n: 1 });

    // 迁移产物可写可读（与 DAO 互锁）。
    appendSessionEvent(raw, {
      sessionId: 'session_old',
      seq: 1,
      type: 'created',
      payload: { title: '老会话' },
      createdAt: 3,
    });
    expect(listSessionEvents(raw, 'session_old')).toHaveLength(1);
    db.close();
  });

  it('重开老文件库（已 13 版）：不再重建、索引幂等（迁移可重复执行）', async () => {
    const db = await openAndInitialize(dir);
    db.close();

    const reopened = await openAndInitialize(dir);
    const raw = reopened.getDatabase();
    expect(versionOf(raw)).toBe(17);
    expect(
      raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sessions_kind_status'").all()
    ).toHaveLength(1);
    expect(
      raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_session_events_created_at'").all()
    ).toHaveLength(1);
    reopened.close();
  });
});
