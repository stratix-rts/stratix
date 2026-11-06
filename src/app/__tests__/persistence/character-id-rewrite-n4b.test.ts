/**
 * 集成测试：**N4b 一次性 character id 重写**（@since v3.3，task_201 / M2-04）——
 *   权威依据 docs/DESIGN-project-map.md §1.3.2「N4b 的可判定规则」（R1-39）
 *   + 「N4b 的迁移验收清单」（R1-41，六步 + 四条校验）+「回滚矩阵」（R1-38）。
 *
 * 覆盖的验收点：
 *   ① 默认沙盒行 id **一律不改**（两种 id 格式并存）；
 *   ② 其它副本行 id = `<roleId>_<instanceId>`（派生自 `role_id` 列，**不解析 id 字符串**）；
 *   ③ 引用方同事务改写（unit_positions / character_tasks / exp_events / chat_messages）；
 *   ④ `sessions.participants` 是 JSON blob ⇒ 逐行读 → 解析 → 改写 → 回写（任一行失败即整批回滚）；
 *   ⑤ 同事务写 `character_id_map`（N4b 唯一的回滚凭据）；
 *   ⑥ 四条校验（全过 / 不过即整批回滚）；
 *   ⑦ 失败恢复：事务已回滚 ⇒ 库处于 N4b 前状态（**磁盘文件逐字节未变**）⇒ 可重试；
 *   ⑧ 前滚回滚（靠 character_id_map 反向 UPDATE）。
 *
 * 驱动：真实 sql.js 适配器 + 临时文件库（夹具真跑，不 mock 连接 —— mock 掉连接等于把被测对象 mock 掉）。
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import {
  CharacterIdRewriteBlockedError,
  CharacterIdRewriteParticipantsError,
  CharacterIdRewriteValidationError,
  deriveCharacterId,
  executeCharacterIdRewrite,
  planCharacterIdRewrite,
  rollbackCharacterIdRewrite,
} from '@/app/services/persistence/character-id-rewrite';
import {
  runN4bMigration,
  runN4bVerification,
} from '@/app/services/persistence/n4b-migration';

import {
  BETA_CHARACTER_ID,
  BETA_DERIVED_ID,
  BETA_DERIVED_ID_2,
  GAMMA_CHARACTER_ID,
  GAMMA_DERIVED_ID,
  SANDBOX_CHARACTER_ID,
  SANDBOX_CHARACTER_ID_2,
  createN4bFixtureDb,
  makeFixtureDir,
} from './helpers/n4b-fixture';

/** 打开夹具库（真库）。 */
async function openFixture(dbPath: string): Promise<Database> {
  const db = new Database(dbPath);
  await db.initialize();
  return db;
}

/** 读一列（真库读，不走任何 mock）。 */
async function readColumn(dbPath: string, sql: string): Promise<string[]> {
  const db = await openFixture(dbPath);
  const rows = db.prepare(sql).all() as Array<Record<string, unknown>>;
  db.close();
  return rows.map((row) => Object.values(row)[0] as string);
}

/** 库文件的 sha256（用来证明「回滚后磁盘文件逐字节未变」）。 */
function fileDigest(dbPath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
}

describe('N4b 一次性 character id 重写（M2-04）', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeFixtureDir('stratix-n4b-test-');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('计划：默认沙盒行不进计划，其它副本行按 role_id 派生新 id', async () => {
    const fixture = await createN4bFixtureDb(dir);
    const db = await openFixture(fixture.dbPath);

    const plan = planCharacterIdRewrite(db);
    expect(plan.blockers).toEqual([]);
    // 默认沙盒两行（instance_id = NULL 与显式沙盒值）都不在计划里。
    expect(plan.sandboxIds).toEqual(
      expect.arrayContaining([SANDBOX_CHARACTER_ID, SANDBOX_CHARACTER_ID_2])
    );
    expect(plan.rows.map((row) => row.oldId)).toEqual(
      expect.arrayContaining([BETA_CHARACTER_ID, GAMMA_CHARACTER_ID])
    );
    expect(plan.rows.map((row) => row.newId)).toEqual(
      expect.arrayContaining([BETA_DERIVED_ID, GAMMA_DERIVED_ID])
    );
    // 派生口径：<roleId>_<instanceId>（来自 role_id 列，不是解析旧 id 字符串）。
    expect(deriveCharacterId('alpha', 'wsp_beta')).toBe(BETA_DERIVED_ID);
    db.close();
  });

  it('前置阻断：副本行缺 role_id ⇒ 不动任何数据', async () => {
    const fixture = await createN4bFixtureDb(dir, { missingRoleId: true });
    const before = fileDigest(fixture.dbPath);
    const db = await openFixture(fixture.dbPath);

    const plan = planCharacterIdRewrite(db);
    expect(plan.blockers.length).toBeGreaterThan(0);
    expect(plan.blockers[0]).toContain('role_id');
    expect(() => executeCharacterIdRewrite(db, plan)).toThrow(CharacterIdRewriteBlockedError);
    db.close();

    // 磁盘文件逐字节未变。
    expect(fileDigest(fixture.dbPath)).toBe(before);
  });

  it('成功路径：ids / 引用列 / participants / 映射表全部改写，四条校验全过', async () => {
    const fixture = await createN4bFixtureDb(dir);
    const db = await openFixture(fixture.dbPath);

    const plan = planCharacterIdRewrite(db);
    const outcome = executeCharacterIdRewrite(db, plan);

    expect(outcome.applied).toBe(3);
    expect(outcome.report.ok).toBe(true);

    // ① 沙盒行 id 一律不改。
    const ids = await readColumn(fixture.dbPath, 'SELECT id FROM characters ORDER BY id');
    expect(ids).toContain(SANDBOX_CHARACTER_ID);
    expect(ids).toContain(SANDBOX_CHARACTER_ID_2);
    // ② 副本行 id 已派生，旧 id 已不存在。
    expect(ids).toContain(BETA_DERIVED_ID);
    expect(ids).toContain(BETA_DERIVED_ID_2);
    expect(ids).toContain(GAMMA_DERIVED_ID);
    expect(ids).not.toContain(BETA_CHARACTER_ID);
    expect(ids).not.toContain(GAMMA_CHARACTER_ID);

    // ③ 引用列（普通列）同事务改写。
    expect(await readColumn(fixture.dbPath, 'SELECT character_id FROM unit_positions')).toEqual(
      expect.arrayContaining([BETA_DERIVED_ID, GAMMA_DERIVED_ID])
    );
    expect(await readColumn(fixture.dbPath, 'SELECT character_id FROM character_tasks')).toEqual(
      expect.arrayContaining([BETA_DERIVED_ID, GAMMA_DERIVED_ID])
    );
    expect(await readColumn(fixture.dbPath, 'SELECT character_id FROM exp_events')).toEqual(
      expect.arrayContaining([BETA_DERIVED_ID])
    );
    expect(
      await readColumn(fixture.dbPath, 'SELECT character_id FROM character_chat_messages')
    ).toEqual(expect.arrayContaining([BETA_DERIVED_ID]));

    // ④ participants（JSON blob）逐行改写；非角色参与者保留不动。
    const participants = await readColumn(fixture.dbPath, 'SELECT participants FROM sessions');
    expect(participants).toContain(JSON.stringify([BETA_DERIVED_ID, SANDBOX_CHARACTER_ID]));
    expect(participants).toContain(JSON.stringify(['link_abc']));

    // ⑤ 同事务写映射表（N4b 唯一的回滚凭据）。
    const mappings = await readColumn(
      fixture.dbPath,
      'SELECT new_id FROM character_id_map ORDER BY new_id'
    );
    expect(mappings).toEqual([BETA_DERIVED_ID, GAMMA_DERIVED_ID, BETA_DERIVED_ID_2]);

    db.close();
  });

  it('participants 坏行 ⇒ 整批回滚（磁盘文件逐字节未变）', async () => {
    const fixture = await createN4bFixtureDb(dir, { brokenParticipants: true });
    const before = fileDigest(fixture.dbPath);
    const db = await openFixture(fixture.dbPath);

    const plan = planCharacterIdRewrite(db);
    expect(() => executeCharacterIdRewrite(db, plan)).toThrow(
      CharacterIdRewriteParticipantsError
    );
    db.close();

    expect(fileDigest(fixture.dbPath)).toBe(before);
    const ids = await readColumn(fixture.dbPath, 'SELECT id FROM characters');
    expect(ids).toContain(BETA_CHARACTER_ID);
    expect(ids).not.toContain(BETA_DERIVED_ID);
    expect(await readColumn(fixture.dbPath, 'SELECT old_id FROM character_id_map')).toEqual([]);
  });

  it('校验不过 ⇒ 整批回滚（磁盘文件逐字节未变）', async () => {
    const fixture = await createN4bFixtureDb(dir, { danglingTask: true });
    const before = fileDigest(fixture.dbPath);
    const db = await openFixture(fixture.dbPath);

    const plan = planCharacterIdRewrite(db);
    expect(() => executeCharacterIdRewrite(db, plan)).toThrow(CharacterIdRewriteValidationError);
    db.close();

    expect(fileDigest(fixture.dbPath)).toBe(before);
    const ids = await readColumn(fixture.dbPath, 'SELECT id FROM characters');
    expect(ids).toContain(BETA_CHARACTER_ID);
    expect(ids).not.toContain(BETA_DERIVED_ID);
  });

  it('中途崩溃（事务进行到一半抛错）⇒ 整批回滚，库处于 N4b 前状态（可重试）', async () => {
    const fixture = await createN4bFixtureDb(dir);
    const before = fileDigest(fixture.dbPath);
    const db = await openFixture(fixture.dbPath);

    const plan = planCharacterIdRewrite(db);
    expect(() =>
      executeCharacterIdRewrite(db, plan, {
        onStep: (step) => {
          if (step === 'participants') throw new Error('模拟崩溃');
        },
      })
    ).toThrow('模拟崩溃');
    db.close();

    expect(fileDigest(fixture.dbPath)).toBe(before);
    const ids = await readColumn(fixture.dbPath, 'SELECT id FROM characters');
    expect(ids).toContain(BETA_CHARACTER_ID);

    // 恢复路径：修掉问题后重跑 ⇒ 能跑成（同一份夹具库）。
    const retry = await runN4bMigration({ dataDir: dir, confirmServiceStopped: true });
    expect(retry.status).toBe('succeeded');
  });

  it('重跑幂等：第二次执行没有待重写的行', async () => {
    const fixture = await createN4bFixtureDb(dir);
    const db = await openFixture(fixture.dbPath);

    const first = planCharacterIdRewrite(db);
    executeCharacterIdRewrite(db, first);
    const second = planCharacterIdRewrite(db);
    expect(second.rows).toHaveLength(0);
    expect(second.alreadyDerivedIds).toEqual(
      expect.arrayContaining([BETA_DERIVED_ID, GAMMA_DERIVED_ID])
    );
    db.close();
  });

  it('前滚回滚：靠 character_id_map 反向 UPDATE 把 id 改回去（映射行被消费）', async () => {
    const fixture = await createN4bFixtureDb(dir);
    const db = await openFixture(fixture.dbPath);

    const plan = planCharacterIdRewrite(db);
    executeCharacterIdRewrite(db, plan);
    const reverted = rollbackCharacterIdRewrite(db);
    expect(reverted.reverted).toBe(3);
    db.close();

    const ids = await readColumn(fixture.dbPath, 'SELECT id FROM characters');
    expect(ids).toContain(BETA_CHARACTER_ID);
    expect(ids).not.toContain(BETA_DERIVED_ID);
    expect(await readColumn(fixture.dbPath, 'SELECT old_id FROM character_id_map')).toEqual([]);
    const participants = await readColumn(fixture.dbPath, 'SELECT participants FROM sessions');
    expect(participants).toContain(JSON.stringify([BETA_CHARACTER_ID, SANDBOX_CHARACTER_ID]));
  });

  it('独立校验脚本：迁移后通过，库被改坏后不通过', async () => {
    const fixture = await createN4bFixtureDb(dir);
    const migration = await runN4bMigration({ dataDir: dir, confirmServiceStopped: true });
    expect(migration.status).toBe('succeeded');

    const verified = await runN4bVerification({
      dataDir: dir,
      reportPath: migration.reportPath ?? undefined,
    });
    expect(verified.ok).toBe(true);

    // 人为打断：把一条站位指向不存在的角色 ⇒ 校验②不过。
    const db = await openFixture(fixture.dbPath);
    db.prepare('UPDATE unit_positions SET character_id = ? WHERE character_id = ?').run(
      'character_ghost',
      BETA_DERIVED_ID
    );
    db.save();
    db.close();

    const broken = await runN4bVerification({ dataDir: dir });
    expect(broken.ok).toBe(false);
    expect(broken.report.checks.find((check) => check.id === 'unit-positions-refs')?.status).toBe(
      'fail'
    );
  });
});
