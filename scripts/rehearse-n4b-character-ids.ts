#!/usr/bin/env tsx
/**
 * 脚本职责：**N4b 六步纪律的夹具演练**（@since v3.3，task_201 / M2-04）——
 *   在**临时库**上真跑六步，输出可贴的演练记录（成功路径 + 校验失败回滚路径 + 中途崩溃恢复 + 重跑幂等 + 前滚回滚）。
 *
 * why 是独立脚本而不是只跑单测：验收要求「夹具演练输出原样贴出」⇒ 需要一份**人能读**的演练记录；
 *   单测的断言是人读的（pass/fail），演练的**过程**才是要贴的东西。
 *
 * 用法：npx tsx scripts/rehearse-n4b-character-ids.ts
 *
 * ⚠️ 只碰临时目录（`os.tmpdir()`）里的夹具库，**不碰任何用户库**。
 */

import * as fs from 'fs';

import {
  createN4bFixtureDb,
  makeFixtureDir,
  BETA_CHARACTER_ID,
  BETA_DERIVED_ID,
  GAMMA_CHARACTER_ID,
  GAMMA_DERIVED_ID,
  SANDBOX_CHARACTER_ID,
} from '../src/app/__tests__/persistence/helpers/n4b-fixture';
import {
  runN4bMigration,
  runN4bRollback,
  runN4bVerification,
} from '../src/app/services/persistence/n4b-migration';

function section(title: string): void {
  console.log('');
  console.log('='.repeat(78));
  console.log(title);
  console.log('='.repeat(78));
}

/** 读库里的 characters.id（断言用）。 */
async function readIds(dbPath: string): Promise<string[]> {
  const { Database } = await import('../src/stratix-database/sqlite-adapter');
  const db = new Database(dbPath);
  await db.initialize();
  const rows = db.prepare('SELECT id FROM characters ORDER BY id').all() as Array<{ id: string }>;
  const ids = rows.map((row) => String(row.id));
  db.close();
  return ids;
}

/** 读库里的 sessions.participants（断言用）。 */
async function readParticipants(dbPath: string): Promise<Record<string, string>> {
  const { Database } = await import('../src/stratix-database/sqlite-adapter');
  const db = new Database(dbPath);
  await db.initialize();
  const rows = db.prepare('SELECT id, participants FROM sessions ORDER BY id').all() as Array<{
    id: string;
    participants: string;
  }>;
  const map: Record<string, string> = {};
  for (const row of rows) map[String(row.id)] = String(row.participants);
  db.close();
  return map;
}

async function main(): Promise<number> {
  let failed = 0;
  const check = (label: string, ok: boolean): void => {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) failed += 1;
  };

  // ── 场景 1：成功路径 ────────────────────────────────────────────────
  section('场景 1 · 成功路径（六步全过）');
  const dirA = makeFixtureDir('stratix-n4b-ok-');
  const fixtureA = await createN4bFixtureDb(dirA);
  console.log(`夹具库：${fixtureA.dbPath}`);
  const resultA = await runN4bMigration({
    dataDir: dirA,
    confirmServiceStopped: true,
  });
  console.log('');
  console.log(`迁移结果：${resultA.status}（重写 ${resultA.applied} 行）`);
  const idsA = await readIds(fixtureA.dbPath);
  const participantsA = await readParticipants(fixtureA.dbPath);
  console.log('');
  console.log('迁移后的 characters.id：');
  for (const id of idsA) console.log(`  · ${id}`);
  console.log('迁移后的 sessions.participants：');
  for (const [sessionId, participants] of Object.entries(participantsA)) {
    console.log(`  · ${sessionId} ⇒ ${participants}`);
  }
  check('默认沙盒行 id 一律不改', idsA.includes(SANDBOX_CHARACTER_ID));
  check('副本行 id 已派生', idsA.includes(BETA_DERIVED_ID) && idsA.includes(GAMMA_DERIVED_ID));
  check('旧 id 已不存在', !idsA.includes(BETA_CHARACTER_ID) && !idsA.includes(GAMMA_CHARACTER_ID));
  check(
    'participants 里的角色 id 已改写',
    participantsA['session_beta_1'] === JSON.stringify([BETA_DERIVED_ID, SANDBOX_CHARACTER_ID])
  );
  check('非角色参与者保留不动', participantsA['session_link_1'] === JSON.stringify(['link_abc']));

  console.log('');
  console.log('独立校验脚本（复核四条）：');
  const verifyA = await runN4bVerification({
    dataDir: dirA,
    reportPath: resultA.reportPath ?? undefined,
  });
  check('独立校验通过', verifyA.ok);

  console.log('');
  console.log('重跑（幂等）：');
  const rerun = await runN4bMigration({ dataDir: dirA, confirmServiceStopped: true });
  console.log(`  重跑结果：${rerun.status}（重写 ${rerun.applied} 行）`);
  check('重跑是幂等 no-op', rerun.status === 'no-op' && rerun.applied === 0);

  console.log('');
  console.log('前滚回滚（靠 character_id_map 反向 UPDATE）：');
  const rollback = await runN4bRollback({ dataDir: dirA, confirmServiceStopped: true });
  const idsAfterRollback = await readIds(fixtureA.dbPath);
  console.log(`  回滚结果：${rollback.status}（回滚 ${rollback.applied} 行）`);
  check(
    '回滚后 id 回到旧值',
    idsAfterRollback.includes(BETA_CHARACTER_ID) && !idsAfterRollback.includes(BETA_DERIVED_ID)
  );

  // ── 场景 2：participants 坏行 ⇒ 整批回滚 ─────────────────────────────
  section('场景 2 · participants 坏行（JSON 解析失败）⇒ 整批回滚');
  const dirB = makeFixtureDir('stratix-n4b-badjson-');
  const fixtureB = await createN4bFixtureDb(dirB, { brokenParticipants: true });
  console.log(`夹具库：${fixtureB.dbPath}`);
  const beforeB = await readIds(fixtureB.dbPath);
  const resultB = await runN4bMigration({ dataDir: dirB, confirmServiceStopped: true });
  console.log('');
  console.log(`迁移结果：${resultB.status}`);
  const afterB = await readIds(fixtureB.dbPath);
  check('整批回滚：旧 id 全部还在', beforeB.every((id) => afterB.includes(id)));
  check('整批回滚：新 id 一个都没留下', !afterB.includes(BETA_DERIVED_ID));

  // ── 场景 3：校验不过 ⇒ 整批回滚 ─────────────────────────────────────
  section('场景 3 · 校验不过（character_tasks 指向不存在的角色）⇒ 整批回滚');
  const dirC = makeFixtureDir('stratix-n4b-dangling-');
  const fixtureC = await createN4bFixtureDb(dirC, { danglingTask: true });
  console.log(`夹具库：${fixtureC.dbPath}`);
  const beforeC = await readIds(fixtureC.dbPath);
  const resultC = await runN4bMigration({ dataDir: dirC, confirmServiceStopped: true });
  console.log('');
  console.log(`迁移结果：${resultC.status}`);
  const afterC = await readIds(fixtureC.dbPath);
  check('整批回滚：旧 id 全部还在', beforeC.every((id) => afterC.includes(id)));
  check('整批回滚：新 id 一个都没留下', !afterC.includes(BETA_DERIVED_ID));

  // ── 场景 4：中途崩溃（事务中断）⇒ 整批回滚 ─────────────────────────
  section('场景 4 · 中途崩溃（事务进行到一半抛错）⇒ 整批回滚');
  const dirD = makeFixtureDir('stratix-n4b-crash-');
  const fixtureD = await createN4bFixtureDb(dirD);
  console.log(`夹具库：${fixtureD.dbPath}`);
  const beforeD = await readIds(fixtureD.dbPath);
  const resultD = await runN4bMigration({
    dataDir: dirD,
    confirmServiceStopped: true,
    onStep: (step) => {
      if (step === 'participants') throw new Error('模拟崩溃：进程在改写 participants 时被杀');
    },
  });
  console.log('');
  console.log(`迁移结果：${resultD.status}`);
  const afterD = await readIds(fixtureD.dbPath);
  check('整批回滚：旧 id 全部还在', beforeD.every((id) => afterD.includes(id)));
  check('整批回滚：新 id 一个都没留下', !afterD.includes(BETA_DERIVED_ID));

  // ── 场景 5：前置阻断（缺 role_id）⇒ 不动数据 ───────────────────────
  section('场景 5 · 前置阻断（副本行缺 role_id）⇒ 不动任何数据');
  const dirE = makeFixtureDir('stratix-n4b-blocked-');
  const fixtureE = await createN4bFixtureDb(dirE, { missingRoleId: true });
  console.log(`夹具库：${fixtureE.dbPath}`);
  const resultE = await runN4bMigration({ dataDir: dirE, confirmServiceStopped: true });
  console.log('');
  console.log(`迁移结果：${resultE.status}`);
  const afterE = await readIds(fixtureE.dbPath);
  check('没动任何数据', !afterE.includes(BETA_DERIVED_ID) && afterE.includes(BETA_CHARACTER_ID));

  // ── 收尾 ────────────────────────────────────────────────────────────
  section('演练小结');
  console.log(failed === 0 ? '全部断言通过 ✓' : `${failed} 条断言失败 ✗`);
  for (const dir of [dirA, dirB, dirC, dirD, dirE]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return failed === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
