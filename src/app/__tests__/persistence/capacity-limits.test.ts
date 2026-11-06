/**
 * 集成测试：**容量上限三池 + 滚动归档**（@since v3.3，task_205 / M2-08）。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.4 **M2 行**
 *   ① `characters`：全局上限 `MAX_CHARACTERS_TOTAL=512` + 每 instance 上限 64
 *      ⇒ **超限拒新**（绝不静默挤掉已有角色 —— 角色是用户亲手建的，丢掉即数据丢失）；
 *   ② `session_events`：每 instance 每会话 512 条 + 每 instance 总 4096 条
 *      ⇒ **超出滚动归档到 `history/`**（R1-20：落库层没有行数上限）；
 *   ③ `exp_events` / `unit_positions`：**随 `characters` 同步清理**（无独立池）。
 *
 * 三条验收逐条落到可执行的断言：
 *   ① 三个池各自的上限都有测试，且**含边界**（超限拒新 / 超限归档最老）；
 *   ② `exp_events` / `unit_positions` 随角色一起清（不留孤儿行）；
 *   ③ 常量集中在 `core/capacity.ts`，一处可调（守门的上限可被覆盖 ⇒ 调一处即全链路生效）。
 *
 * 驱动：真实 sql.js 适配器 + 临时文件库 + 临时项目根（归档文件是真的写进磁盘再读回来）——
 *   mock 掉库或磁盘等于把被测对象一起 mock 掉（与其它持久化单测同口径）。
 *   故障路径（写盘失败）用**注入的 appender**制造 —— 真实 fs 造不出这种错。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import {
  CAPACITY_LIMITS,
  MAX_CHARACTERS_PER_INSTANCE,
  MAX_CHARACTERS_TOTAL,
  MAX_SESSION_EVENTS_PER_INSTANCE,
  MAX_SESSION_EVENTS_PER_SESSION,
} from '../../../core/capacity';
import { DEFAULT_INSTANCE_ID, type ProjectInstanceId } from '../../../core/types';
import {
  countCharacters,
  countInstanceCharacters,
  countInstanceSessionEvents,
  countSessionEventsForSession,
  deleteCharacterCascade,
  filterCharactersWithinCapacity,
  readCharacterCapacity,
  selectOldestSessionEvents,
} from '../../services/persistence/capacity-limits';
import { ensureExpEventsTable } from '../../services/persistence/exp-event-dao';
import {
  ensureGameSaveTables,
  upsertCharacters,
  type PersistedCharacterRecord,
} from '../../services/persistence/game-save-dao';
import { createNodeArchiveAppender } from '../../services/persistence/project-archive-node';
import { ensureSessionEventsTable, appendSessionEvent } from '../../services/persistence/session-event-dao';
import { upsertSessionRecord } from '../../services/persistence/session-dao';
import { createSessionEventArchiver } from '../../services/persistence/session-event-archive';

// ============================================================================
// 夹具
// ============================================================================

/** 副本 A（测试主体）。 */
const INSTANCE_A = 'wsp_a' as ProjectInstanceId;
/** 副本 B（用来证明「不串副本」）。 */
const INSTANCE_B = 'wsp_b' as ProjectInstanceId;

/** 固定时刻（本地 2026-11-15 12:00 ⇒ 归档分片 = session-events-202611.jsonl，与时区无关）。 */
const FIXED_NOW = new Date(2026, 10, 15, 12, 0, 0).getTime();

let tmpDir = '';
let projectRoot = '';
let dbPath = '';
let db: Database;

/** 造一行角色记录（写入路径的真实形状）。 */
function characterRecord(
  id: string,
  instanceId: ProjectInstanceId | null,
  patch: Partial<PersistedCharacterRecord> = {}
): PersistedCharacterRecord {
  return {
    id,
    name: `角色 ${id}`,
    agentKind: 'claude-code',
    persona: '一句话人设',
    level: 1,
    exp: 0,
    appearanceJson: null,
    bodyType: null,
    skinId: null,
    externalSessionId: null,
    contextEnabled: true,
    createdAt: 1000,
    instanceId,
    ...patch,
  };
}

/** 批量写角色（真实写口）。 */
function writeCharacters(
  records: readonly PersistedCharacterRecord[]
): void {
  upsertCharacters(db, records);
}

/** 批量造一个副本的角色行（id 前缀带副本 ⇒ 不同副本不撞主键）。 */
function fillInstance(
  instanceId: ProjectInstanceId,
  count: number,
  prefix = 'ch'
): void {
  const records: PersistedCharacterRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    records.push(characterRecord(`${prefix}_${instanceId}_${i}`, instanceId));
  }
  writeCharacters(records);
}

/** 写一行会话事件（真实表；instance_id 显式给）。 */
function writeEvent(
  sessionId: string,
  seq: number,
  instanceId: ProjectInstanceId | null,
  createdAt: number
): void {
  db.prepare(
    `INSERT INTO session_events (session_id, seq, type, payload, created_at, instance_id)
     VALUES (?, ?, 'message', ?, ?, ?)`
  ).run(sessionId, seq, JSON.stringify({ text: `第 ${seq} 条` }), createdAt, instanceId);
}

/** 写一行经验事件（从属行）。 */
function writeExpEvent(characterId: string, instanceId: ProjectInstanceId | null): void {
  db.prepare(
    `INSERT INTO exp_events (character_id, delta, reason, level, created_at, instance_id)
     VALUES (?, 10, 'chat_round', 1, 2000, ?)`
  ).run(characterId, instanceId);
}

/** 写一行站位（从属行）。 */
function writeUnitPosition(characterId: string, instanceId: ProjectInstanceId | null): void {
  db.prepare(
    `INSERT INTO unit_positions (character_id, x, y, updated_at, instance_id)
     VALUES (?, 1, 2, 2000, ?)`
  ).run(characterId, instanceId);
}

/** 读归档目录里的全部文件名。 */
function archiveFiles(): string[] {
  const dir = path.join(projectRoot, '.stratix', 'history');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort();
}

/** 读某个归档文件的内容行。 */
function archiveLines(fileName: string): Array<Record<string, unknown>> {
  const filePath = path.join(projectRoot, '.stratix', 'history', fileName);
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-capacity-'));
  projectRoot = path.join(tmpDir, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });

  dbPath = path.join(tmpDir, 'game.sqlite');
  db = new Database(dbPath);
  await db.initialize();
  ensureGameSaveTables(db);
  ensureSessionEventsTable(db);
  ensureExpEventsTable(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// ① 池一：characters —— 超限拒新
// ============================================================================

describe('池一：characters 容量上限（超限拒新）', () => {
  test('每副本 64：满位后新建被拒（instance-limit），已有行一个不动', () => {
    fillInstance(INSTANCE_A, MAX_CHARACTERS_PER_INSTANCE);

    const status = readCharacterCapacity(db, INSTANCE_A);
    expect(status.instanceCount).toBe(MAX_CHARACTERS_PER_INSTANCE);
    expect(status.ok).toBe(false);
    expect(status.reason).toBe('instance-limit');

    // 第 65 个角色 ⇒ 拒新。
    const { accepted, rejected } = filterCharactersWithinCapacity(db, [
      characterRecord('ch_over', INSTANCE_A),
    ]);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual(['ch_over']);

    // 拒新**不挤掉**已有行（角色是用户亲手建的 ⇒ 绝不静默删）。
    expect(countInstanceCharacters(db, INSTANCE_A)).toBe(MAX_CHARACTERS_PER_INSTANCE);
    expect(countCharacters(db)).toBe(MAX_CHARACTERS_PER_INSTANCE);
  });

  test('全局 512：跨副本满位后新建被拒（total-limit）', () => {
    // 8 个副本 × 64 = 512 ⇒ 全局线到顶。
    const instances: ProjectInstanceId[] = [];
    for (let i = 0; i < MAX_CHARACTERS_TOTAL / MAX_CHARACTERS_PER_INSTANCE; i += 1) {
      const instanceId = `wsp_${i}` as ProjectInstanceId;
      instances.push(instanceId);
      fillInstance(instanceId, MAX_CHARACTERS_PER_INSTANCE);
    }
    expect(countCharacters(db)).toBe(MAX_CHARACTERS_TOTAL);

    // 新副本里的新角色 ⇒ 全局超限 ⇒ 拒新。
    const fresh = instances[0].replace('wsp_', 'wsp_new_') as ProjectInstanceId;
    const status = readCharacterCapacity(db, fresh);
    expect(status.total).toBe(MAX_CHARACTERS_TOTAL);
    expect(status.ok).toBe(false);
    expect(status.reason).toBe('total-limit');

    const { accepted, rejected } = filterCharactersWithinCapacity(db, [
      characterRecord('ch_global_over', fresh),
    ]);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual(['ch_global_over']);
    expect(countCharacters(db)).toBe(MAX_CHARACTERS_TOTAL);
  });

  test('改档不受容量限制：已有行照写（满了也能改名）', () => {
    fillInstance(INSTANCE_A, MAX_CHARACTERS_PER_INSTANCE);
    const existingId = `ch_${INSTANCE_A}_0`;

    const { accepted, rejected } = filterCharactersWithinCapacity(db, [
      characterRecord(existingId, INSTANCE_A, { name: '改了名字' }),
    ]);
    expect(rejected).toEqual([]);
    expect(accepted.map((r) => r.id)).toEqual([existingId]);

    writeCharacters(accepted);
    const row = db.prepare('SELECT name FROM characters WHERE id = ?').get(existingId) as
      | { name?: string }
      | undefined;
    expect(String(row?.name)).toBe('改了名字');
    expect(countInstanceCharacters(db, INSTANCE_A)).toBe(MAX_CHARACTERS_PER_INSTANCE);
  });

  test('一批新行里，超额的那些被拒、额度内的那些照收', () => {
    fillInstance(INSTANCE_A, MAX_CHARACTERS_PER_INSTANCE - 2);

    const { accepted, rejected } = filterCharactersWithinCapacity(db, [
      characterRecord('ch_a_ok_1', INSTANCE_A),
      characterRecord('ch_a_ok_2', INSTANCE_A),
      characterRecord('ch_a_over', INSTANCE_A),
    ]);
    expect(accepted.map((r) => r.id)).toEqual(['ch_a_ok_1', 'ch_a_ok_2']);
    expect(rejected).toEqual(['ch_a_over']);
  });

  test('副本隔离：副本 B 满位不影响副本 A（容量按副本各算各的）', () => {
    fillInstance(INSTANCE_A, MAX_CHARACTERS_PER_INSTANCE);
    fillInstance(INSTANCE_B, 1);

    expect(countInstanceCharacters(db, INSTANCE_A)).toBe(MAX_CHARACTERS_PER_INSTANCE);
    expect(countInstanceCharacters(db, INSTANCE_B)).toBe(1);

    const { rejected } = filterCharactersWithinCapacity(db, [
      characterRecord('ch_b_new', INSTANCE_B),
    ]);
    expect(rejected).toEqual([]);
  });
});

// ============================================================================
// ② 池二：session_events —— 超限滚动归档最老
// ============================================================================

describe('池二：session_events 滚动归档（超限归档最老）', () => {
  test('每会话 512：第 513 条落库后，最老的一条被搬进 history/（热表留 512 条）', () => {
    // 真实上限（不覆盖）⇒ 513 条触发。
    for (let seq = 1; seq <= MAX_SESSION_EVENTS_PER_SESSION + 1; seq += 1) {
      writeEvent('sess_a', seq, INSTANCE_A, FIXED_NOW + seq);
    }
    expect(countSessionEventsForSession(db, 'sess_a', INSTANCE_A)).toBe(
      MAX_SESSION_EVENTS_PER_SESSION + 1
    );

    const guard = createSessionEventArchiver({
      db,
      resolveInstanceRoot: () => projectRoot,
      appender: createNodeArchiveAppender(),
      now: () => FIXED_NOW,
    });
    const outcome = guard.enforce({ sessionId: 'sess_a', instanceId: INSTANCE_A });

    expect(outcome.archived).toBe(1);
    expect(outcome.archivePath).toBe('.stratix/history/session-events-202611.jsonl');
    // 热表里最老的那条（seq=1）走了 ⇒ 留 512 条。
    expect(countSessionEventsForSession(db, 'sess_a', INSTANCE_A)).toBe(
      MAX_SESSION_EVENTS_PER_SESSION
    );
    const left = db
      .prepare('SELECT seq FROM session_events WHERE session_id = ? ORDER BY seq ASC')
      .all('sess_a') as Array<{ seq?: number }>;
    expect(left[0]?.seq).toBe(2);

    // 归档文件：按月分片 + 一行一条 JSON（M1-06 的 archive 范式）。
    expect(archiveFiles()).toEqual(['session-events-202611.jsonl']);
    const lines = archiveLines('session-events-202611.jsonl');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe('session-event/archived');
    expect(lines[0]?.ignorable).toBe(false);
    const payload = lines[0]?.payload as Record<string, unknown>;
    expect(payload?.seq).toBe(1);
    expect(payload?.sessionId).toBe('sess_a');
    expect(payload?.instanceId).toBe(INSTANCE_A);
  });

  test('每副本 4096：跨会话总量超限 ⇒ 归档最老的那条（会话级不触发时）', () => {
    // 41 个会话 × 100 条 = 4100 条 ⇒ 每会话 100（不超 512）、每副本 4100（超 4096）。
    const sessionCount = 41;
    const perSession = 100;
    let createdAt = FIXED_NOW;
    for (let s = 0; s < sessionCount; s += 1) {
      for (let seq = 1; seq <= perSession; seq += 1) {
        createdAt += 1;
        writeEvent(`sess_${s}`, seq, INSTANCE_A, createdAt);
      }
    }
    expect(countInstanceSessionEvents(db, INSTANCE_A)).toBe(sessionCount * perSession);

    const guard = createSessionEventArchiver({
      db,
      resolveInstanceRoot: () => projectRoot,
      appender: createNodeArchiveAppender(),
      now: () => FIXED_NOW,
    });
    const outcome = guard.enforce({ sessionId: 'sess_0', instanceId: INSTANCE_A });

    // 超出 4096 的那几条（4100 − 4096 = 4）全搬走。
    expect(outcome.archived).toBe(4);
    expect(countInstanceSessionEvents(db, INSTANCE_A)).toBe(
      MAX_SESSION_EVENTS_PER_INSTANCE
    );
    // 搬走的是**最老**的那几条（第一个会话的开头几条）。
    const lines = archiveLines('session-events-202611.jsonl');
    expect(lines).toHaveLength(4);
    const seqs = lines.map((line) => (line.payload as Record<string, unknown>).seq);
    expect(seqs).toEqual([1, 2, 3, 4]);
    expect(
      lines.every((line) => (line.payload as Record<string, unknown>).sessionId === 'sess_0')
    ).toBe(true);
  });

  test('副本隔离：副本 B 的事件不算进副本 A 的账', () => {
    for (let seq = 1; seq <= 10; seq += 1) {
      writeEvent('sess_b', seq, INSTANCE_B, FIXED_NOW + seq);
    }
    expect(countInstanceSessionEvents(db, INSTANCE_A)).toBe(0);
    expect(countInstanceSessionEvents(db, INSTANCE_B)).toBe(10);
  });

  test('事件的归属随会话走：守门记**同一个池**（不记到默认沙盒头上）', () => {
    // 会话行归副本 B（事件不带归属 ⇒ 继承会话的归属）。
    upsertSessionRecord(db, {
      id: 'sess_x',
      kind: 'peer_chat',
      title: '会话',
      participants: [],
      status: 'active',
      refId: null,
      createdAt: FIXED_NOW,
      lastEventAt: FIXED_NOW,
      closedAt: null,
      eventCount: 0,
      instanceId: INSTANCE_B,
    });
    appendSessionEvent(db, {
      sessionId: 'sess_x',
      seq: 1,
      type: 'message',
      payload: { text: 'hi' },
      createdAt: FIXED_NOW,
    });

    const row = db
      .prepare('SELECT instance_id FROM session_events WHERE session_id = ?')
      .get('sess_x') as { instance_id?: string } | undefined;
    expect(String(row?.instance_id)).toBe(INSTANCE_B);
    expect(countInstanceSessionEvents(db, INSTANCE_B)).toBe(1);
    expect(countInstanceSessionEvents(db, DEFAULT_INSTANCE_ID)).toBe(0);
  });

  test('先落盘、后删行：落盘失败 ⇒ 一行都不删（热表原样）', () => {
    for (let seq = 1; seq <= 5; seq += 1) {
      writeEvent('sess_a', seq, INSTANCE_A, FIXED_NOW + seq);
    }
    const guard = createSessionEventArchiver({
      db,
      resolveInstanceRoot: () => projectRoot,
      // 注入一个必失败的落盘口（真实 fs 造不出这种错）。
      appender: {
        append: () => {
          throw new Error('disk on fire');
        },
      },
      now: () => FIXED_NOW,
      limits: { perSession: 3, perInstance: 100 },
    });
    const outcome = guard.enforce({ sessionId: 'sess_a', instanceId: INSTANCE_A });

    expect(outcome.archived).toBe(0);
    expect(outcome.reason).toBe('archive-failed');
    // 一行都没删（先搬走后删 ⇒ 搬失败就什么都不做）。
    expect(countSessionEventsForSession(db, 'sess_a', INSTANCE_A)).toBe(5);
    expect(archiveFiles()).toEqual([]);
  });

  test('副本根查不到 ⇒ 不删行（写错地方比不写更糟）', () => {
    for (let seq = 1; seq <= 5; seq += 1) {
      writeEvent('sess_a', seq, INSTANCE_A, FIXED_NOW + seq);
    }
    const guard = createSessionEventArchiver({
      db,
      resolveInstanceRoot: () => undefined,
      appender: createNodeArchiveAppender(),
      now: () => FIXED_NOW,
      limits: { perSession: 3, perInstance: 100 },
    });
    const outcome = guard.enforce({ sessionId: 'sess_a', instanceId: INSTANCE_A });

    expect(outcome.archived).toBe(0);
    expect(outcome.reason).toBe('no-instance-root');
    expect(countSessionEventsForSession(db, 'sess_a', INSTANCE_A)).toBe(5);
  });

  test('只搬走**刚好超限**的那几行（不多搬）', () => {
    for (let seq = 1; seq <= 7; seq += 1) {
      writeEvent('sess_a', seq, INSTANCE_A, FIXED_NOW + seq);
    }
    const guard = createSessionEventArchiver({
      db,
      resolveInstanceRoot: () => projectRoot,
      appender: createNodeArchiveAppender(),
      now: () => FIXED_NOW,
      limits: { perSession: 5, perInstance: 100 },
    });
    const outcome = guard.enforce({ sessionId: 'sess_a', instanceId: INSTANCE_A });

    expect(outcome.archived).toBe(2);
    expect(countSessionEventsForSession(db, 'sess_a', INSTANCE_A)).toBe(5);
    const lines = archiveLines('session-events-202611.jsonl');
    expect(lines).toHaveLength(2);
    const seqs = lines.map((line) => (line.payload as Record<string, unknown>).seq);
    expect(seqs).toEqual([1, 2]);
  });

  test('归档是**追加**：两次归档写进同一个分片文件（不覆盖）', () => {
    for (let seq = 1; seq <= 6; seq += 1) {
      writeEvent('sess_a', seq, INSTANCE_A, FIXED_NOW + seq);
    }
    const guard = createSessionEventArchiver({
      db,
      resolveInstanceRoot: () => projectRoot,
      appender: createNodeArchiveAppender(),
      now: () => FIXED_NOW,
      limits: { perSession: 5, perInstance: 100 },
    });
    guard.enforce({ sessionId: 'sess_a', instanceId: INSTANCE_A });
    writeEvent('sess_a', 7, INSTANCE_A, FIXED_NOW + 7);
    guard.enforce({ sessionId: 'sess_a', instanceId: INSTANCE_A });

    const lines = archiveLines('session-events-202611.jsonl');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(archiveFiles()).toEqual(['session-events-202611.jsonl']);
  });
});

// ============================================================================
// ③ 池三：exp_events / unit_positions —— 随 characters 同步清理
// ============================================================================

describe('池三：exp_events / unit_positions 随角色清理（无独立池）', () => {
  test('删角色 ⇒ 它的经验事件与站位一起没了（不留孤儿行）', () => {
    fillInstance(INSTANCE_A, 2);
    writeExpEvent(`ch_${INSTANCE_A}_0`, INSTANCE_A);
    writeExpEvent(`ch_${INSTANCE_A}_0`, INSTANCE_A);
    writeExpEvent(`ch_${INSTANCE_A}_1`, INSTANCE_A);
    writeUnitPosition(`ch_${INSTANCE_A}_0`, INSTANCE_A);
    writeUnitPosition(`ch_${INSTANCE_A}_1`, INSTANCE_A);

    const result = deleteCharacterCascade(db, [`ch_${INSTANCE_A}_0`]);

    expect(result.characters).toBe(1);
    expect(result.expEvents).toBe(2);
    expect(result.unitPositions).toBe(1);
    // 角色的从属行没了 ⇒ 表不会随角色删除而无界增长。
    expect(
      Number(
        (db.prepare('SELECT COUNT(*) AS n FROM exp_events').get() as { n?: number }).n ?? 0
      )
    ).toBe(1);
    expect(
      Number(
        (db.prepare('SELECT COUNT(*) AS n FROM unit_positions').get() as { n?: number }).n ?? 0
      )
    ).toBe(1);
    // 别的角色不受影响。
    expect(countInstanceCharacters(db, INSTANCE_A)).toBe(1);
  });

  test('删不存在的角色 ⇒ 什么都不删（不误伤）', () => {
    fillInstance(INSTANCE_A, 1);
    const result = deleteCharacterCascade(db, ['ch_not_exist']);
    expect(result).toEqual({ characters: 0, expEvents: 0, unitPositions: 0 });
    expect(countCharacters(db)).toBe(1);
  });
});

// ============================================================================
// ④ 常量集中可调
// ============================================================================

describe('常量集中可调', () => {
  test('四个上限常量集中在 core/capacity.ts，值与设计一致', () => {
    expect(MAX_CHARACTERS_PER_INSTANCE).toBe(64);
    expect(MAX_CHARACTERS_TOTAL).toBe(512);
    expect(MAX_SESSION_EVENTS_PER_SESSION).toBe(512);
    expect(MAX_SESSION_EVENTS_PER_INSTANCE).toBe(4096);
    expect(CAPACITY_LIMITS).toEqual({
      charactersPerInstance: 64,
      charactersTotal: 512,
      sessionEventsPerSession: 512,
      sessionEventsPerInstance: 4096,
    });
  });

  test('守门的上限可被覆盖 ⇒ 调一处即生效（上限不是写死在流程里的）', () => {
    for (let seq = 1; seq <= 4; seq += 1) {
      writeEvent('sess_a', seq, INSTANCE_A, FIXED_NOW + seq);
    }
    const guard = createSessionEventArchiver({
      db,
      resolveInstanceRoot: () => projectRoot,
      appender: createNodeArchiveAppender(),
      now: () => FIXED_NOW,
      limits: { perSession: 2, perInstance: 100 },
    });
    const outcome = guard.enforce({ sessionId: 'sess_a', instanceId: INSTANCE_A });

    expect(outcome.archived).toBe(2);
    expect(countSessionEventsForSession(db, 'sess_a', INSTANCE_A)).toBe(2);
  });
});

// ============================================================================
// ⑤ 待归档行的选取口径（归档「最老」的判据）
// ============================================================================

describe('待归档行的选取', () => {
  test('指定会话 ⇒ 按 seq 升序（会话内的时间序）', () => {
    for (let seq = 1; seq <= 5; seq += 1) {
      writeEvent('sess_a', seq, INSTANCE_A, FIXED_NOW + seq);
    }
    writeEvent('sess_b', 1, INSTANCE_A, FIXED_NOW);

    const rows = selectOldestSessionEvents(db, {
      instanceId: INSTANCE_A,
      sessionId: 'sess_a',
      limit: 2,
    });
    expect(rows.map((row) => row.seq)).toEqual([1, 2]);
    expect(rows.every((row) => row.sessionId === 'sess_a')).toBe(true);
  });

  test('不指定会话 ⇒ 按 created_at 升序（跨会话的时间序）', () => {
    writeEvent('sess_b', 1, INSTANCE_A, FIXED_NOW);
    writeEvent('sess_a', 1, INSTANCE_A, FIXED_NOW + 10);

    const rows = selectOldestSessionEvents(db, {
      instanceId: INSTANCE_A,
      limit: 1,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sessionId).toBe('sess_b');
  });

  test('只取本副本的行（不串副本）', () => {
    writeEvent('sess_a', 1, INSTANCE_A, FIXED_NOW);
    writeEvent('sess_b', 1, INSTANCE_B, FIXED_NOW);

    const rows = selectOldestSessionEvents(db, {
      instanceId: INSTANCE_A,
      limit: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sessionId).toBe('sess_a');
  });
});
