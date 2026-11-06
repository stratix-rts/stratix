/**
 * 集成测试：**步 N7 —— 一次性归属迁移（带预览 + 可撤销）**（@since v3.3，task_203 / M2-06）。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.3.2 步 **N7**
 *   （「把默认沙盒的 N 条任务 / M 个角色 / K 个会话归入某项目 —— 带预览，
 *     且**必须先完成目标 instance 的 N6 物化**」+「显式、可撤销」）。
 *
 * 四条验收逐条落到可执行的断言：
 *   ① **预览（dry-run）准确列出三类对象**：角色 / 任务 / 会话的计数 + 明细 + 外部凭据 + 跟随行，
 *      且**一个字节都不落库**；
 *   ② **执行单事务且 character_id_map 记录**：整批迁移 + 台账 + `character_id_map`，
 *      且**中途崩溃 ⇒ 整批回滚**（库回到迁移前）；
 *   ③ **撤销可回到迁移前**：反向 UPDATE 精确还原（连「原来是 NULL 还是显式沙盒值」都还原）；
 *   ④ **未物化目标实例时拒绝执行**：阻断项 ⇒ 不改任何数据。
 *
 * 驱动：真实 sql.js 适配器 + 临时文件库（真 SQL / 真唯一索引 / 真联合主键 / 真事务）——
 *   mock 掉库等于把被测对象一起 mock 掉（与其它持久化单测同口径）。
 */

import * as fs from 'fs';

import { Database } from '@/stratix-database/sqlite-adapter';

import {
  AttributionBlockedError,
  executeInstanceAttribution,
  previewInstanceAttribution,
  previewInstanceAttributionRollback,
  rollbackInstanceAttribution,
} from '../../services/persistence/instance-attribution-migration';

import {
  createN7FixtureDb,
  makeN7FixtureDir,
  OTHER_CHARACTER,
  OTHER_INSTANCE,
  readAttributionLedger,
  readCharacterIdMap,
  readInstanceIds,
  SANDBOX_CHARACTER_1,
  SANDBOX_CHARACTER_2,
  SANDBOX_INSTANCE,
  TARGET_CHARACTER,
  TARGET_INSTANCE,
  type N7FixtureOptions,
} from './helpers/n7-fixture';

// ============================================================================
// 夹具
// ============================================================================

let tmpDir = '';
let dbPath = '';
let db: Database;

/** 建一个夹具库并打开它。 */
async function openFixture(options: N7FixtureOptions = {}): Promise<Database> {
  tmpDir = makeN7FixtureDir();
  const fixture = await createN7FixtureDb(tmpDir, options);
  dbPath = fixture.dbPath;
  db = new Database(dbPath);
  await db.initialize();
  return db;
}

/** Map ⇒ 普通对象（便于整体比较）。 */
function toObject(map: Map<string, string | null>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of map) out[key] = value;
  return out;
}

/** 七张表的**归属快照**（原始 instance_id 原值；NULL 与 'wsp_sandbox' 区分得开）。 */
function snapshotAll(target: Database): Record<string, unknown> {
  return {
    characters: toObject(readInstanceIds(target, 'characters', 'id')),
    tasks: toObject(readInstanceIds(target, 'character_tasks', 'id')),
    sessions: toObject(readInstanceIds(target, 'sessions', 'id')),
    sessionEvents: toObject(
      readInstanceIds(target, 'session_events', "session_id || '#' || seq")
    ),
    expEvents: toObject(readInstanceIds(target, 'exp_events', 'id')),
    unitPositions: toObject(readInstanceIds(target, 'unit_positions', 'character_id')),
    externalRefs: toObject(
      readInstanceIds(target, 'session_external_refs', "external_session_id || '#' || instance_id")
    ),
  };
}

afterEach(() => {
  try {
    db?.close();
  } catch {
    // 关库失败不影响断言结论（夹具目录照样清）。
  }
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

// ============================================================================
// ① 预览（dry-run）：准确列出三类对象，且不落库
// ============================================================================

describe('N7 预览（dry-run）', () => {
  it('准确列出角色 / 任务 / 会话三类对象（计数 + 明细 + 外部凭据 + 跟随行）', async () => {
    await openFixture();

    const preview = previewInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE });

    // 三类对象的计数。
    expect(preview.counts.characters).toBe(2);
    expect(preview.counts.tasks).toBe(2);
    expect(preview.counts.sessions).toBe(2);
    // 外部凭据（联合键维度）与跟随行。
    expect(preview.counts.externalRefs).toBe(1);
    expect(preview.counts.unitPositions).toBe(2);
    expect(preview.counts.expEvents).toBe(2);
    expect(preview.counts.sessionEvents).toBe(2);
    expect(preview.counts.total).toBe(13);

    // 三类对象的明细（逐条列得出，不只是计数）。
    expect(preview.characters.map((row) => row.id).sort()).toEqual([
      SANDBOX_CHARACTER_1,
      SANDBOX_CHARACTER_2,
    ]);
    expect(preview.tasks.map((row) => row.id).sort()).toEqual([
      'task_sandbox_1',
      'task_sandbox_2',
    ]);
    expect(preview.sessions.map((row) => row.id).sort()).toEqual([
      'session_sandbox_1',
      'session_sandbox_2',
    ]);
    // 明细带得上「行是什么」与「原来属于谁」。
    const character = preview.characters.find((row) => row.id === SANDBOX_CHARACTER_1);
    expect(character?.name).toBe('沙盒甲');
    expect(character?.level).toBe(3);
    expect(character?.originalInstanceId).toBeNull();
    expect(
      preview.characters.find((row) => row.id === SANDBOX_CHARACTER_2)?.originalInstanceId
    ).toBe(SANDBOX_INSTANCE);

    // 外部凭据与跟随行也列得出来。
    expect(preview.externalRefs.map((row) => row.externalSessionId)).toEqual(['ext_sandbox_1']);
    expect(preview.followers.unitPositions.map((row) => row.characterId).sort()).toEqual([
      SANDBOX_CHARACTER_1,
      SANDBOX_CHARACTER_2,
    ]);
    expect(preview.followers.sessionEvents.map((row) => row.sessionId)).toEqual([
      'session_sandbox_1',
      'session_sandbox_1',
    ]);

    // 目标副本已物化 ⇒ 没有阻断项。
    expect(preview.targetMaterialized).toBe(true);
    expect(preview.blockers).toEqual([]);
  });

  it('预览不落库（一个字节都不改）', async () => {
    await openFixture();
    const before = snapshotAll(db);

    previewInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE });

    expect(snapshotAll(db)).toEqual(before);
    // 台账表压根没被建出来（预览只读）。
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .all('instance_attribution_map');
    expect(tables).toHaveLength(0);
  });

  it('目标副本未物化 ⇒ 预览列成阻断项', async () => {
    await openFixture({ unmaterializedTarget: true });
    const notMaterialized = previewInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE });
    expect(notMaterialized.targetMaterialized).toBe(false);
    expect(notMaterialized.blockers.join('\n')).toContain('尚未完成 N6 物化');
  });

  it('role_id 与目标副本撞车 ⇒ 预览列成阻断项', async () => {
    await openFixture({ roleConflict: true });
    const roleConflict = previewInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE });
    expect(roleConflict.blockers.join('\n')).toContain('role_id 冲突');
  });

  it('外部凭据与目标副本撞车 ⇒ 预览列成阻断项', async () => {
    await openFixture({ externalRefConflict: true });
    const refConflict = previewInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE });
    expect(refConflict.blockers.join('\n')).toContain('外部会话凭据冲突');
  });
});

// ============================================================================
// ② 执行：单事务 + character_id_map 记录
// ============================================================================

describe('N7 执行', () => {
  it('把三类对象 + 外部凭据 + 跟随行整体迁进目标副本，且不串别的副本', async () => {
    await openFixture();

    const result = executeInstanceAttribution(db, {
      targetInstanceId: TARGET_INSTANCE,
      now: 1700000000000,
    });

    expect(result.committed).toBe(true);
    expect(result.applied.characters).toBe(2);
    expect(result.applied.tasks).toBe(2);
    expect(result.applied.sessions).toBe(2);
    expect(result.applied.externalRefs).toBe(1);
    expect(result.applied.unitPositions).toBe(2);
    expect(result.applied.expEvents).toBe(2);
    expect(result.applied.sessionEvents).toBe(2);
    expect(result.applied.total).toBe(13);

    // 三类对象都换成了目标副本。
    expect(readInstanceIds(db, 'characters', 'id').get(SANDBOX_CHARACTER_1)).toBe(TARGET_INSTANCE);
    expect(readInstanceIds(db, 'characters', 'id').get(SANDBOX_CHARACTER_2)).toBe(TARGET_INSTANCE);
    expect(readInstanceIds(db, 'character_tasks', 'id').get('task_sandbox_1')).toBe(TARGET_INSTANCE);
    expect(readInstanceIds(db, 'sessions', 'id').get('session_sandbox_1')).toBe(TARGET_INSTANCE);

    // 外部凭据按**实例维度**同步迁（联合键的第二半变了）。
    const refs = readInstanceIds(
      db,
      'session_external_refs',
      "external_session_id || '#' || instance_id"
    );
    expect(refs.get('ext_sandbox_1#wsp_sandbox')).toBeUndefined();
    expect(refs.get(`ext_sandbox_1#${TARGET_INSTANCE}`)).toBe(TARGET_INSTANCE);

    // 跟随行跟着走。
    expect(
      readInstanceIds(db, 'unit_positions', 'character_id').get(SANDBOX_CHARACTER_1)
    ).toBe(TARGET_INSTANCE);
    expect(readInstanceIds(db, 'exp_events', 'id').get('1')).toBe(TARGET_INSTANCE);
    expect(
      readInstanceIds(db, 'session_events', "session_id || '#' || seq").get('session_sandbox_1#0')
    ).toBe(TARGET_INSTANCE);

    // **不串别的副本**：wsp_y 的行一个字节都没动，目标副本原有的物化行也没动。
    expect(readInstanceIds(db, 'characters', 'id').get(OTHER_CHARACTER)).toBe(OTHER_INSTANCE);
    expect(readInstanceIds(db, 'character_tasks', 'id').get('task_other_1')).toBe(OTHER_INSTANCE);
    expect(readInstanceIds(db, 'sessions', 'id').get('session_other_1')).toBe(OTHER_INSTANCE);
    expect(readInstanceIds(db, 'characters', 'id').get(TARGET_CHARACTER)).toBe(TARGET_INSTANCE);
  });

  it('同事务写 character_id_map（设计钦定的 N7 回滚凭据）与精确台账', async () => {
    await openFixture();

    executeInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE, now: 1700000000000 });

    // character_id_map：角色那一类（N7 不改 id ⇒ old_id = new_id）。
    expect(readCharacterIdMap(db)).toEqual([
      {
        old_id: SANDBOX_CHARACTER_1,
        new_id: SANDBOX_CHARACTER_1,
        instance_id: TARGET_INSTANCE,
        created_at: 1700000000000,
      },
      {
        old_id: SANDBOX_CHARACTER_2,
        new_id: SANDBOX_CHARACTER_2,
        instance_id: TARGET_INSTANCE,
        created_at: 1700000000000,
      },
    ]);

    // 精确台账：全部 13 行，带**迁移前的原值**。
    const ledger = readAttributionLedger(db);
    expect(ledger).toHaveLength(13);
    const characterRow = ledger.find((row) => row.row_kind === 'character' && row.row_id === SANDBOX_CHARACTER_1);
    expect(characterRow?.original_instance_id).toBeNull();
    expect(characterRow?.source_instance_id).toBe(SANDBOX_INSTANCE);
    expect(characterRow?.target_instance_id).toBe(TARGET_INSTANCE);
    const explicitSandboxRow = ledger.find(
      (row) => row.row_kind === 'character' && row.row_id === SANDBOX_CHARACTER_2
    );
    expect(explicitSandboxRow?.original_instance_id).toBe(SANDBOX_INSTANCE);
    // 任务 / 会话 / 外部凭据 / 跟随行也都在台账里。
    expect(ledger.filter((row) => row.row_kind === 'task')).toHaveLength(2);
    expect(ledger.filter((row) => row.row_kind === 'session')).toHaveLength(2);
    expect(ledger.filter((row) => row.row_kind === 'external_ref')).toHaveLength(1);
    expect(ledger.filter((row) => row.row_kind === 'unit_position')).toHaveLength(2);
    expect(ledger.filter((row) => row.row_kind === 'exp_event')).toHaveLength(2);
    expect(ledger.filter((row) => row.row_kind === 'session_event')).toHaveLength(2);
  });

  it('中途崩溃 ⇒ 整批回滚（库回到迁移前）', async () => {
    await openFixture();
    const before = snapshotAll(db);

    expect(() =>
      executeInstanceAttribution(db, {
        targetInstanceId: TARGET_INSTANCE,
        onStep: (step) => {
          if (step === 'sessions') throw new Error('模拟崩在会话这一步');
        },
      })
    ).toThrow('模拟崩在会话这一步');

    // 库回到迁移前（一个字节都没改）。
    expect(snapshotAll(db)).toEqual(before);
    // 台账与 character_id_map 也没留下半截。
    expect(readAttributionLedger(db)).toEqual([]);
    expect(readCharacterIdMap(db)).toEqual([]);
  });

  it('重跑是幂等的（第二次没有可迁的行）', async () => {
    await openFixture();

    executeInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE });
    const second = executeInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE });

    expect(second.applied.total).toBe(0);
    expect(second.committed).toBe(true);
  });
});

// ============================================================================
// ③ 撤销：回到迁移前
// ============================================================================

describe('N7 撤销', () => {
  it('反向 UPDATE 把行精确放回迁移前（NULL 与显式沙盒值都还原）', async () => {
    await openFixture();
    const before = snapshotAll(db);

    executeInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE });
    const result = rollbackInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE });

    expect(result.total).toBe(13);
    expect(result.reverted.characters).toBe(2);
    expect(result.reverted.tasks).toBe(2);
    expect(result.reverted.sessions).toBe(2);
    expect(result.reverted.externalRefs).toBe(1);

    // 回到迁移前：**逐字节**一样（NULL 还原成 NULL，显式沙盒值还原成沙盒值）。
    expect(snapshotAll(db)).toEqual(before);
  });

  it('撤销后清掉台账与 character_id_map（凭据用掉即失效）', async () => {
    await openFixture();

    executeInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE });
    rollbackInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE });

    expect(readAttributionLedger(db)).toEqual([]);
    expect(readCharacterIdMap(db)).toEqual([]);
  });

  it('没迁过就撤销 ⇒ 零行改动（不报错）', async () => {
    await openFixture();
    const before = snapshotAll(db);

    const result = rollbackInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE });

    expect(result.total).toBe(0);
    expect(snapshotAll(db)).toEqual(before);
  });

  it('撤销预览只读地列出将要撤销的行（不落库）', async () => {
    await openFixture();
    executeInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE });
    const before = snapshotAll(db);

    const preview = previewInstanceAttributionRollback(db, { targetInstanceId: TARGET_INSTANCE });

    expect(preview.total).toBe(13);
    expect(preview.counts.characters).toBe(2);
    expect(preview.counts.tasks).toBe(2);
    expect(preview.counts.sessions).toBe(2);
    expect(preview.counts.externalRefs).toBe(1);
    // 预览不改任何数据。
    expect(snapshotAll(db)).toEqual(before);
  });
});

// ============================================================================
// ④ 未物化目标实例 ⇒ 拒绝执行
// ============================================================================

describe('N7 前置闸门', () => {
  it('目标实例未物化 ⇒ 拒绝执行，且不改任何数据', async () => {
    await openFixture({ unmaterializedTarget: true });
    const before = snapshotAll(db);

    expect(() => executeInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE })).toThrow(
      AttributionBlockedError
    );

    expect(snapshotAll(db)).toEqual(before);
    expect(readCharacterIdMap(db)).toEqual([]);
  });

  it('role_id 与目标副本撞车 ⇒ 拒绝执行（不改任何数据）', async () => {
    await openFixture({ roleConflict: true });
    const before = snapshotAll(db);

    expect(() => executeInstanceAttribution(db, { targetInstanceId: TARGET_INSTANCE })).toThrow(
      AttributionBlockedError
    );

    expect(snapshotAll(db)).toEqual(before);
  });
});
