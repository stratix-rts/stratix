#!/usr/bin/env tsx
/**
 * 文件职责：**M2 端到端验收的场景进程**（@since v3.3，task_207 / M2-10）——
 *   在**临时库**上真跑 M2 的五组能力，把观测值写成一份 JSON 报告（断言在驱动层）。
 *
 * ============ 五组观测（与 docs/DESIGN-project-map.md §1.3.2 / §1.4 对齐）============
 *   ① **副本间数据隔离**：两个真实副本（各自 `.stratix` 契约 + roster）各自养成 / 任务 / 会话；
 *      characters / tasks / sessions / events 互不可见；COALESCE 命中口径正确
 *      （`instance_id IS NULL` 的旧行归默认沙盒，对其它副本**不可见**）。
 *   ② **容量上限生效**：每 instance 64 角色 / 全局 512 角色 / session_events 每会话 512 +
 *      每 instance 4096 ⇒ 滚动归档到 `history/`。
 *   ③ **N4b 校验脚本可重跑**（夹具库；驱动层跑 CLI，本进程只铺夹具）。
 *   ④ **回滚矩阵演练**（校验失败 ⇒ 自动回滚；驱动层跑 CLI，本进程跑模块）。
 *   ⑤ **N7 归属迁移**：预览 → 执行 → 撤销 闭环。
 *
 * ============ 为什么断言不在本文件里 ============
 *   照 M1-16 的纪律：**断言全在驱动层**（`m2-end-to-end.e2e.mjs`），本进程只如实回报所见
 *   —— 进程层一旦自己判「通过」，失败就会被吞掉。
 *
 * 用法：SX_M2_WORKDIR=<临时目录> npx tsx e2e-tests/m2-end-to-end/m2-scenario.ts
 * 输出：把 JSON 报告写到 `$SX_M2_WORKDIR/report.json`。
 *
 * ⚠️ 只碰临时目录里的库，**不碰任何用户库**。
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  createN4bFixtureDb,
} from '../../src/app/__tests__/persistence/helpers/n4b-fixture';
import {
  countCharacters,
  countInstanceSessionEvents,
  countSessionEventsForSession,
  filterCharactersWithinCapacity,
  readCharacterCapacity,
} from '../../src/app/services/persistence/capacity-limits';
import { ensureExpEventsTable } from '../../src/app/services/persistence/exp-event-dao';
import {
  ensureGameSaveTables,
  loadCharacters,
  upsertCharacters,
  type PersistedCharacterRecord,
  type SqliteDatabaseLike,
} from '../../src/app/services/persistence/game-save-dao';
import {
  executeInstanceAttribution,
  previewInstanceAttribution,
  previewInstanceAttributionRollback,
  rollbackInstanceAttribution,
} from '../../src/app/services/persistence/instance-attribution-migration';
import { createSqliteInstanceDataSource } from '../../src/app/services/persistence/instance-loader-node';
import {
  runN4bMigration,
  runN4bRollback,
  runN4bVerification,
} from '../../src/app/services/persistence/n4b-migration';
import { createNodeArchiveAppender } from '../../src/app/services/persistence/project-archive-node';
import { materializeInstanceRoster } from '../../src/app/services/persistence/roster-materializer';
import { ensureSessionsTable, upsertSessionRecord } from '../../src/app/services/persistence/session-dao';
import { createSessionEventArchiver } from '../../src/app/services/persistence/session-event-archive';
import {
  appendSessionEvent,
  ensureSessionEventsTable,
} from '../../src/app/services/persistence/session-event-dao';
import { ensureSessionExternalRefsTable } from '../../src/app/services/persistence/session-external-ref-dao';
import { ensureCharacterTasksTable, upsertTask } from '../../src/app/services/persistence/task-record-dao';
import { CAPACITY_LIMITS } from '../../src/core/capacity';
import { DEFAULT_INSTANCE_ID } from '../../src/core/types';
import { Database } from '../../src/stratix-database/sqlite-adapter';

/** 副本 A 的实例 id。 */
const INSTANCE_A = 'wsp_m2_a';
/** 副本 B 的实例 id。 */
const INSTANCE_B = 'wsp_m2_b';
/** 固定时刻（epoch ms）—— 报告可逐字复算。 */
const T0 = 1760000000000;

/** 报告的形状（分组对应五组断言）。 */
interface M2Report {
  readonly instances: { readonly a: string; readonly b: string; readonly sandbox: string };
  readonly g1: Record<string, unknown>;
  readonly g2: Record<string, unknown>;
  readonly g3: Record<string, unknown>;
  readonly g4: Record<string, unknown>;
  readonly g5: Record<string, unknown>;
}

/** 造一条角色记录（字段齐整，缺省值写死 ⇒ 报告可复算）。 */
function characterRecord(
  id: string,
  name: string,
  instanceId: string | null,
  overrides: Partial<PersistedCharacterRecord> = {}
): PersistedCharacterRecord {
  return {
    id,
    name,
    agentKind: 'claude-code',
    persona: `${name}的人设`,
    level: 1,
    exp: 0,
    appearanceJson: null,
    bodyType: null,
    skinId: null,
    externalSessionId: null,
    contextEnabled: true,
    createdAt: T0,
    ...overrides,
    ...(instanceId === null ? {} : { instanceId }),
  };
}

/** 读角色的等级（按 id 精确取）。 */
function levelOf(db: SqliteDatabaseLike, id: string): number | null {
  const row = db
    .prepare(`SELECT level FROM characters WHERE id = ?`)
    .get(id) as { level?: number } | undefined;
  return row?.level === undefined ? null : Number(row.level);
}

// ============================================================================
// ① 副本间数据隔离
// ============================================================================

async function runGroup1(workdir: string): Promise<Record<string, unknown>> {
  const dbDir = path.join(workdir, 'main');
  const dbPath = path.join(dbDir, 'stratix.db.sqlite');
  const db = new Database(dbPath);
  await db.initialize();
  ensureGameSaveTables(db);
  ensureCharacterTasksTable(db);
  ensureSessionsTable(db);
  ensureSessionEventsTable(db);

  // ── 铺两条「旧行」：一条 instance_id = NULL（真旧行），一条显式写沙盒 id ──
  const insertCharacter = db.prepare(
    `INSERT INTO characters (id, name, kind, persona, level, exp, external_session_id, context_enabled, created_at, updated_at, instance_id, role_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertCharacter.run(
    'character_legacy_1',
    '旧档甲',
    'claude',
    'M2 之前建的散兵',
    2,
    40,
    null,
    1,
    T0,
    T0,
    null,
    null
  );
  insertCharacter.run(
    'character_sandbox_1',
    '旧档乙',
    'claude',
    'M2 之前建的散兵（显式归属沙盒）',
    1,
    0,
    null,
    1,
    T0 + 1,
    T0 + 1,
    DEFAULT_INSTANCE_ID,
    null
  );

  // ── 步 N6：两个副本各自的 roster 物化（契约 → 运行层）──
  const rootA = path.join(workdir, 'instance-a');
  const rootB = path.join(workdir, 'instance-b');
  const materializedA = materializeInstanceRoster(db, { instanceId: INSTANCE_A, projectRoot: rootA });
  const materializedB = materializeInstanceRoster(db, { instanceId: INSTANCE_B, projectRoot: rootB });

  // ── 各自养成：副本 A 的斥候升到 7 级（副本 B 的同名角色纹丝不动）──
  const rowsA = loadCharacters(db, { instanceId: INSTANCE_A });
  const scoutA = rowsA.find((row) => row.id === 'scout_wsp_m2_a');
  if (!scoutA) throw new Error('副本 A 的 scout 未被物化出来');
  upsertCharacters(db, [{ ...scoutA, level: 7, exp: 300 }]);

  // ── 各自的任务 / 会话 / 事件（走真实 DAO 写侧）──
  upsertTask(db, {
    id: 'task_a_1',
    characterId: 'scout_wsp_m2_a',
    prompt: '副本 A 的活儿',
    status: 'completed',
    output: 'A 完成',
    createdAt: T0 + 10,
    startedAt: T0 + 11,
    endedAt: T0 + 12,
    instanceId: INSTANCE_A,
  });
  upsertTask(db, {
    id: 'task_b_1',
    characterId: 'scout_wsp_m2_b',
    prompt: '副本 B 的活儿',
    status: 'completed',
    output: 'B 完成',
    createdAt: T0 + 10,
    startedAt: T0 + 11,
    endedAt: T0 + 12,
    instanceId: INSTANCE_B,
  });
  // 旧任务：没有归属 ⇒ 落 NULL ⇒ 按 COALESCE 归默认沙盒。
  upsertTask(db, {
    id: 'task_legacy_1',
    characterId: 'character_legacy_1',
    prompt: 'M2 之前派的活儿',
    status: 'completed',
    output: '旧活儿完成',
    createdAt: T0 + 10,
    startedAt: T0 + 11,
    endedAt: T0 + 12,
  });

  upsertSessionRecord(db, {
    id: 'sess_a_1',
    kind: 'task_run',
    title: '副本 A 的会话',
    participants: ['scout_wsp_m2_a'],
    status: 'closed',
    refId: null,
    createdAt: T0 + 20,
    lastEventAt: T0 + 21,
    closedAt: T0 + 21,
    eventCount: 2,
    instanceId: INSTANCE_A,
  });
  upsertSessionRecord(db, {
    id: 'sess_b_1',
    kind: 'task_run',
    title: '副本 B 的会话',
    participants: ['scout_wsp_m2_b'],
    status: 'closed',
    refId: null,
    createdAt: T0 + 20,
    lastEventAt: T0 + 21,
    closedAt: T0 + 21,
    eventCount: 2,
    instanceId: INSTANCE_B,
  });

  for (const seq of [1, 2]) {
    appendSessionEvent(db, {
      sessionId: 'sess_a_1',
      seq,
      type: 'message',
      payload: { text: `A 的第 ${seq} 条` },
      createdAt: T0 + 20 + seq,
      instanceId: INSTANCE_A,
    });
    appendSessionEvent(db, {
      sessionId: 'sess_b_1',
      seq,
      type: 'message',
      payload: { text: `B 的第 ${seq} 条` },
      createdAt: T0 + 20 + seq,
      instanceId: INSTANCE_B,
    });
  }

  // ── 读回（走真实读口：N6 物化 + 按副本过滤）──
  const roots: Record<string, string> = { [INSTANCE_A]: rootA, [INSTANCE_B]: rootB };
  const source = createSqliteInstanceDataSource(db, {
    resolveInstanceRoot: (instanceId) => roots[instanceId],
  });
  const viewA = await source.read(INSTANCE_A);
  const viewB = await source.read(INSTANCE_B);
  const viewSandbox = await source.read(DEFAULT_INSTANCE_ID);

  const report = {
    materializedA: { created: materializedA.created, skipped: materializedA.skipped },
    materializedB: { created: materializedB.created, skipped: materializedB.skipped },
    aCharacters: viewA.characters.map((c) => c.id),
    bCharacters: viewB.characters.map((c) => c.id),
    sandboxCharacters: viewSandbox.characters.map((c) => c.id),
    aTasks: viewA.tasks.map((t) => t.id),
    bTasks: viewB.tasks.map((t) => t.id),
    sandboxTasks: viewSandbox.tasks.map((t) => t.id),
    aSessions: viewA.sessions.map((s) => s.id),
    bSessions: viewB.sessions.map((s) => s.id),
    sandboxSessions: viewSandbox.sessions.map((s) => s.id),
    aEventCount: countInstanceSessionEvents(db, INSTANCE_A),
    bEventCount: countInstanceSessionEvents(db, INSTANCE_B),
    sandboxEventCount: countInstanceSessionEvents(db, DEFAULT_INSTANCE_ID),
    aSessionEventCount: countSessionEventsForSession(db, 'sess_a_1', INSTANCE_A),
    bSessionEventCount: countSessionEventsForSession(db, 'sess_b_1', INSTANCE_B),
    aScoutLevel: levelOf(db, 'scout_wsp_m2_a'),
    bScoutLevel: levelOf(db, 'scout_wsp_m2_b'),
    aTaskInstanceId: (
      db.prepare(`SELECT instance_id FROM character_tasks WHERE id = ?`).get('task_a_1') as
        | { instance_id?: string }
        | undefined
    )?.instance_id ?? null,
    bTaskInstanceId: (
      db.prepare(`SELECT instance_id FROM character_tasks WHERE id = ?`).get('task_b_1') as
        | { instance_id?: string }
        | undefined
    )?.instance_id ?? null,
    legacyTaskInstanceId: (
      db.prepare(`SELECT instance_id FROM character_tasks WHERE id = ?`).get('task_legacy_1') as
        | { instance_id?: string }
        | undefined
    )?.instance_id ?? null,
  };
  // 关库放在观测全部取完之后（sql.js 是内存库 ⇒ 落盘一次即可）。
  db.close();
  return report;
}

// ============================================================================
// ② 容量上限
// ============================================================================

async function runGroup2(workdir: string): Promise<Record<string, unknown>> {
  const dbDir = path.join(workdir, 'capacity');
  const dbPath = path.join(dbDir, 'stratix.db.sqlite');
  const db = new Database(dbPath);
  await db.initialize();
  ensureGameSaveTables(db);
  ensureCharacterTasksTable(db);
  ensureSessionsTable(db);
  ensureSessionEventsTable(db);

  // ── 池一：characters（每 instance 64 / 全局 512）──
  // 副本 A 灌满 64 条（走真实写入护栏）。
  const recordsA: PersistedCharacterRecord[] = [];
  for (let i = 0; i < CAPACITY_LIMITS.charactersPerInstance; i += 1) {
    recordsA.push(characterRecord(`cap_a_${i}`, `A${i}`, 'cap_a'));
  }
  const filterA = filterCharactersWithinCapacity(db, recordsA, 'cap_a');
  upsertCharacters(db, filterA.accepted);

  // 其余副本把全库灌到 512 条（bulk INSERT：只是把池子填满，不是护栏路径）。
  const bulk = db.prepare(
    `INSERT INTO characters (id, name, kind, persona, level, exp, external_session_id, context_enabled, created_at, updated_at, instance_id, role_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const perOther = 56;
  let filled = 0;
  for (let k = 0; k < 8 && filled < CAPACITY_LIMITS.charactersTotal - recordsA.length; k += 1) {
    const instanceId = `cap_b${k}`;
    for (let i = 0; i < perOther; i += 1) {
      bulk.run(
        `cap_b${k}_${i}`,
        `B${k}-${i}`,
        'claude-code',
        '',
        1,
        0,
        null,
        1,
        T0,
        T0,
        instanceId,
        null
      );
      filled += 1;
    }
  }
  const totalAfterFill = countCharacters(db);
  const capacityA = readCharacterCapacity(db, 'cap_a');
  const capacityFresh = readCharacterCapacity(db, 'cap_fresh');
  const rejectedByInstance = filterCharactersWithinCapacity(
    db,
    [characterRecord('cap_a_overflow', 'A 超编', 'cap_a')],
    'cap_a'
  );
  const rejectedByTotal = filterCharactersWithinCapacity(
    db,
    [characterRecord('cap_fresh_1', '新副本第一行', 'cap_fresh')],
    'cap_fresh'
  );
  const existingStillWritable = filterCharactersWithinCapacity(
    db,
    [characterRecord('cap_a_0', 'A0 改名', 'cap_a')],
    'cap_a'
  );

  // ── 池二：session_events（每会话 512 / 每 instance 4096 ⇒ 滚动归档）──
  const roots: Record<string, string> = {
    cap1: path.join(workdir, 'cap1'),
    cap2: path.join(workdir, 'cap2'),
  };
  const archiver = createSessionEventArchiver({
    db,
    resolveInstanceRoot: (instanceId) => roots[instanceId],
    appender: createNodeArchiveAppender(),
  });

  // 每会话上限：cap1 的一个会话塞 513 条 ⇒ 最老的一条被搬进 history/。
  upsertSessionRecord(db, {
    id: 'cap1_sess',
    kind: 'task_run',
    title: 'cap1 会话',
    participants: [],
    status: 'active',
    refId: null,
    createdAt: T0,
    lastEventAt: T0,
    closedAt: null,
    eventCount: 0,
    instanceId: 'cap1',
  });
  let cap1Archived = 0;
  for (let seq = 1; seq <= CAPACITY_LIMITS.sessionEventsPerSession + 1; seq += 1) {
    appendSessionEvent(db, {
      sessionId: 'cap1_sess',
      seq,
      type: 'message',
      payload: { seq },
      createdAt: T0 + seq,
      instanceId: 'cap1',
    });
    const outcome = archiver.enforce({ sessionId: 'cap1_sess', instanceId: 'cap1' });
    cap1Archived += outcome.archived;
  }
  const cap1Hot = countSessionEventsForSession(db, 'cap1_sess', 'cap1');
  const cap1ArchiveFile = path.join(roots.cap1, '.stratix', 'history');
  const cap1ArchiveFiles = fs.existsSync(cap1ArchiveFile)
    ? fs.readdirSync(cap1ArchiveFile).sort()
    : [];
  const cap1ArchiveLines = cap1ArchiveFiles.length
    ? fs
        .readFileSync(path.join(cap1ArchiveFile, cap1ArchiveFiles[0]), 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
    : [];
  const cap1FirstArchivedSeq = cap1ArchiveLines.length
    ? (JSON.parse(cap1ArchiveLines[0]) as { payload?: { seq?: number } }).payload?.seq ?? null
    : null;

  // 每 instance 总量上限：cap2 的 9 个会话 × 512 条 = 4608 条 ⇒ 超 4096 ⇒ 搬走最老的 512 条。
  for (let s = 0; s < 9; s += 1) {
    const sessionId = `cap2_sess_${s}`;
    upsertSessionRecord(db, {
      id: sessionId,
      kind: 'task_run',
      title: `cap2 会话 ${s}`,
      participants: [],
      status: 'active',
      refId: null,
      createdAt: T0,
      lastEventAt: T0,
      closedAt: null,
      eventCount: 0,
      instanceId: 'cap2',
    });
    for (let seq = 1; seq <= CAPACITY_LIMITS.sessionEventsPerSession; seq += 1) {
      appendSessionEvent(db, {
        sessionId,
        seq,
        type: 'message',
        payload: { s, seq },
        createdAt: T0 + s * 1000 + seq,
        instanceId: 'cap2',
      });
      archiver.enforce({ sessionId, instanceId: 'cap2' });
    }
  }
  const cap2Hot = countInstanceSessionEvents(db, 'cap2');
  const cap2ArchiveDir = path.join(roots.cap2, '.stratix', 'history');
  const cap2ArchiveFiles = fs.existsSync(cap2ArchiveDir)
    ? fs.readdirSync(cap2ArchiveDir).sort()
    : [];
  const cap2ArchiveLines = cap2ArchiveFiles.length
    ? fs
        .readFileSync(path.join(cap2ArchiveDir, cap2ArchiveFiles[0]), 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
    : [];

  const cap1InstanceTotal = countInstanceSessionEvents(db, 'cap1');
  db.close();
  return {
    limits: CAPACITY_LIMITS,
    perInstanceFillAccepted: filterA.accepted.length,
    perInstanceRejected: filterA.rejected.length,
    totalAfterFill,
    capacityA: { ok: capacityA.ok, reason: capacityA.reason, instanceCount: capacityA.instanceCount },
    capacityFresh: {
      ok: capacityFresh.ok,
      reason: capacityFresh.reason,
      total: capacityFresh.total,
    },
    rejectedByInstance: rejectedByInstance.rejected,
    rejectedByTotal: rejectedByTotal.rejected,
    existingStillWritable: existingStillWritable.accepted.map((row) => row.id),
    cap1ArchivedTotal: cap1Archived,
    cap1Hot,
    cap1ArchiveFiles,
    cap1ArchiveLineCount: cap1ArchiveLines.length,
    cap1FirstArchivedSeq,
    cap1InstanceTotal,
    cap2Hot,
    cap2ArchiveFiles,
    cap2ArchiveLineCount: cap2ArchiveLines.length,
  };
}

// ============================================================================
// ③ N4b 校验脚本可重跑（铺夹具；CLI 由驱动层跑）
// ============================================================================

async function runGroup3(workdir: string): Promise<Record<string, unknown>> {
  const dir = path.join(workdir, 'n4b-ok');
  fs.mkdirSync(dir, { recursive: true });
  const fixture = await createN4bFixtureDb(dir);
  const migration = await runN4bMigration({ dataDir: dir, confirmServiceStopped: true });
  // 带上迁移报告（基线）⇒ 校验①「行数不变」才有得比（否则只能 skip）。
  const reportPath = migration.reportPath ?? undefined;
  const verify1 = await runN4bVerification({ dataDir: dir, ...(reportPath ? { reportPath } : {}) });
  const verify2 = await runN4bVerification({ dataDir: dir, ...(reportPath ? { reportPath } : {}) });
  return {
    dataDir: dir,
    dbPath: fixture.dbPath,
    reportPath: migration.reportPath,
    migrationStatus: migration.status,
    migrationApplied: migration.applied,
    verify1Ok: verify1.ok,
    verify2Ok: verify2.ok,
    verify1Checks: verify1.report.checks.map((check) => ({
      id: check.id,
      title: check.title,
      status: check.status,
    })),
    verify2Checks: verify2.report.checks.map((check) => ({
      id: check.id,
      title: check.title,
      status: check.status,
    })),
    verify1IdenticalToVerify2: JSON.stringify(verify1.report) === JSON.stringify(verify2.report),
  };
}

// ============================================================================
// ④ 回滚矩阵演练（校验失败 ⇒ 自动回滚）
// ============================================================================

async function runGroup4(workdir: string): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  // 场景 A：tasks 指向不存在的角色 ⇒ 校验④不过 ⇒ 整批回滚。
  const dirA = path.join(workdir, 'n4b-dangling');
  fs.mkdirSync(dirA, { recursive: true });
  const fixtureA = await createN4bFixtureDb(dirA, { danglingTask: true });
  const beforeA = await readIds(fixtureA.dbPath);
  const migrationA = await runN4bMigration({ dataDir: dirA, confirmServiceStopped: true });
  const afterA = await readIds(fixtureA.dbPath);
  const verifyA = await runN4bVerification({ dataDir: dirA });
  results.dangling = {
    dataDir: dirA,
    status: migrationA.status,
    idsUnchanged: JSON.stringify(beforeA) === JSON.stringify(afterA),
    derivedIdAbsent: !afterA.includes('alpha_wsp_beta'),
    verifyOk: verifyA.ok,
    verifyFailedChecks: verifyA.report.checks
      .filter((check) => check.status === 'fail')
      .map((check) => check.id),
  };

  // 场景 B：participants 是坏 JSON ⇒ 整批回滚。
  const dirB = path.join(workdir, 'n4b-badjson');
  fs.mkdirSync(dirB, { recursive: true });
  const fixtureB = await createN4bFixtureDb(dirB, { brokenParticipants: true });
  const beforeB = await readIds(fixtureB.dbPath);
  const migrationB = await runN4bMigration({ dataDir: dirB, confirmServiceStopped: true });
  const afterB = await readIds(fixtureB.dbPath);
  results.brokenJson = {
    dataDir: dirB,
    status: migrationB.status,
    idsUnchanged: JSON.stringify(beforeB) === JSON.stringify(afterB),
    derivedIdAbsent: !afterB.includes('alpha_wsp_beta'),
  };

  // 场景 C：前滚回滚（靠 character_id_map 反向 UPDATE）—— 回滚矩阵的另一半。
  const dirC = path.join(workdir, 'n4b-rollback');
  fs.mkdirSync(dirC, { recursive: true });
  const fixtureC = await createN4bFixtureDb(dirC);
  const migrationC = await runN4bMigration({ dataDir: dirC, confirmServiceStopped: true });
  const rollbackC = await runN4bRollback({ dataDir: dirC, confirmServiceStopped: true });
  const afterC = await readIds(fixtureC.dbPath);
  results.forwardRollback = {
    dataDir: dirC,
    migrationStatus: migrationC.status,
    rollbackStatus: rollbackC.status,
    derivedIdGone: !afterC.includes('alpha_wsp_beta'),
    oldIdBack: afterC.includes('character_1700000000000_3'),
  };
  return results;
}

/** 读库里的 characters.id（断言用；只读 ⇒ 关库时跳过落盘）。 */
async function readIds(dbPath: string): Promise<string[]> {
  const db = new Database(dbPath);
  await db.initialize();
  const rows = db.prepare('SELECT id FROM characters ORDER BY id').all() as Array<{ id: string }>;
  const ids = rows.map((row) => String(row.id));
  db.close(true);
  return ids;
}

// ============================================================================
// ⑤ N7 归属迁移（预览 → 执行 → 撤销）
// ============================================================================

async function runGroup5(workdir: string): Promise<Record<string, unknown>> {
  const dir = path.join(workdir, 'n7');
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'stratix.db.sqlite');
  const db = new Database(dbPath);
  await db.initialize();
  ensureGameSaveTables(db);
  ensureCharacterTasksTable(db);
  ensureSessionsTable(db);
  ensureSessionEventsTable(db);
  // N7 要迁的表一共七张（characters / tasks / sessions / 外部凭据 + 三张跟随行）。
  ensureSessionExternalRefsTable(db);
  ensureExpEventsTable(db);

  const insertCharacter = db.prepare(
    `INSERT INTO characters (id, name, kind, persona, level, exp, external_session_id, context_enabled, created_at, updated_at, instance_id, role_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertCharacter.run(
    'character_legacy_1',
    '旧档甲',
    'claude',
    'M2 之前建的散兵',
    2,
    40,
    null,
    1,
    T0,
    T0,
    null,
    null
  );
  upsertTask(db, {
    id: 'task_legacy_1',
    characterId: 'character_legacy_1',
    prompt: 'M2 之前派的活儿',
    status: 'completed',
    output: '旧活儿完成',
    createdAt: T0 + 10,
    startedAt: T0 + 11,
    endedAt: T0 + 12,
  });

  // 目标副本必须先完成 N6 物化（否则迁过去的是无 role_id 的孤儿行）。
  // 根目录 = 驱动层铺好的副本 B 契约面（.stratix/roster 在里面）。
  const rootB = path.join(workdir, 'instance-b');
  const materialized = materializeInstanceRoster(db, {
    instanceId: INSTANCE_B,
    projectRoot: rootB,
  });

  const options = { targetInstanceId: INSTANCE_B };
  const preview = previewInstanceAttribution(db, options);
  const instanceIdAfterPreview = readInstanceId(db, 'character_legacy_1');

  const executed = executeInstanceAttribution(db, options);
  const instanceIdAfterExecute = readInstanceId(db, 'character_legacy_1');
  const taskInstanceIdAfterExecute = readTaskInstanceId(db, 'task_legacy_1');
  const previewAfterExecute = previewInstanceAttribution(db, options);

  const rollbackPreview = previewInstanceAttributionRollback(db, options);
  const rolled = rollbackInstanceAttribution(db, options);
  const instanceIdAfterRollback = readInstanceId(db, 'character_legacy_1');
  const taskInstanceIdAfterRollback = readTaskInstanceId(db, 'task_legacy_1');

  db.close();
  return {
    materializedCreated: materialized.created,
    previewCounts: preview.counts,
    previewBlockers: preview.blockers,
    previewTargetMaterialized: preview.targetMaterialized,
    instanceIdAfterPreview,
    executedApplied: executed.applied,
    committed: executed.committed,
    instanceIdAfterExecute,
    taskInstanceIdAfterExecute,
    previewAfterExecuteCounts: previewAfterExecute.counts,
    rollbackPreviewTotal: rollbackPreview.total,
    rolledReverted: rolled.reverted,
    rolledTotal: rolled.total,
    instanceIdAfterRollback,
    taskInstanceIdAfterRollback,
  };
}

/** 读某角色行的原始 instance_id（null = 未归属）。 */
function readInstanceId(db: SqliteDatabaseLike, id: string): string | null {
  const row = db.prepare(`SELECT instance_id FROM characters WHERE id = ?`).get(id) as
    | { instance_id?: string }
    | undefined;
  const value = row?.instance_id;
  return value === null || value === undefined ? null : String(value);
}

/** 读某任务行的原始 instance_id（null = 未归属）。 */
function readTaskInstanceId(db: SqliteDatabaseLike, id: string): string | null {
  const row = db.prepare(`SELECT instance_id FROM character_tasks WHERE id = ?`).get(id) as
    | { instance_id?: string }
    | undefined;
  const value = row?.instance_id;
  return value === null || value === undefined ? null : String(value);
}

// ============================================================================
// 主体
// ============================================================================

async function main(): Promise<number> {
  const workdir = process.env.SX_M2_WORKDIR;
  if (!workdir) {
    console.error('缺环境变量 SX_M2_WORKDIR（临时工作目录）');
    return 2;
  }
  const report: M2Report = {
    instances: { a: INSTANCE_A, b: INSTANCE_B, sandbox: DEFAULT_INSTANCE_ID },
    g1: await runGroup1(workdir),
    g2: await runGroup2(workdir),
    g3: await runGroup3(workdir),
    g4: await runGroup4(workdir),
    g5: await runGroup5(workdir),
  };
  const out = path.join(workdir, 'report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`[scenario] 报告已写出：${out}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
