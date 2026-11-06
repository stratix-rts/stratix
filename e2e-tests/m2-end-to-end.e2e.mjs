#!/usr/bin/env node
/**
 * 文件职责：**M2 端到端验收**驱动脚本（@since v3.3，task_207 / M2-10）。
 *
 * ============ 验收什么（docs/DESIGN-project-map.md §1.3.2 全节 + §1.4 容量）============
 *   两个**真实副本**（各自 `.stratix` 契约 + roster）各自养成 / 任务 / 会话，逐条断言：
 *   ① **副本间数据隔离**：characters / tasks / sessions / events 互不可见；COALESCE 命中口径正确；
 *   ② **容量上限生效**：每 instance 64 角色、全局 512、session_events 512/4096 滚动归档；
 *   ③ **N4b 校验脚本可重跑**（夹具库演练，非用户库）；
 *   ④ **回滚矩阵演练**（N4b 校验失败路径自动回滚 + 前滚回滚）；
 *   ⑤ **N7 归属迁移**：预览 → 执行 → 撤销 闭环。
 *
 * ============ 分工（照 M1-16 的纪律）============
 *   断言**全在本文件**；场景进程（`m2-end-to-end/m2-scenario.ts`）只如实回报所见。
 *   ③/④/⑤ 的 **CLI 入口**（`scripts/verify-n4b-character-ids.ts` /
 *   `scripts/rehearse-n4b-character-ids.ts` / `scripts/migrate-n7-attribution.ts`）
 *   由本文件当子进程跑 —— 「脚本可重跑」验的是**命令本身**，不是模块函数。
 *
 * 输入：命令行开关 `--keep`（保留临时目录不删；用法见下方『跑法』段）+ 仓内依赖 ——
 *   夹具 `e2e-tests/fixtures/m2-instance-a` 与 `e2e-tests/fixtures/m2-instance-b`
 *   （两个副本的 .stratix 契约面）、`node_modules/.bin/tsx`（跑场景进程与 ③④⑤ 的 CLI）、
 *   `scripts/verify-n4b-character-ids.ts` / `scripts/rehearse-n4b-character-ids.ts` /
 *   `scripts/migrate-n7-attribution.ts`（③④⑤ 的 CLI 入口）；
 *   所有库与工作目录都落在 `os.tmpdir()` 下的临时目录（`stratix-m2-e2e-*`），**不碰用户的库**。
 * 输出：stdout 的断言摘要（`printSummary` 的 PASS/FAIL 行 + 每条断言的观测值）
 *   + 场景进程写出的 `$SX_M2_WORKDIR/report.json`（五组观测值 = 驱动层的断言对象）；
 *   失败时 stderr 打剧本堆栈；退出码口径见下方『退出码』段。
 *
 * 跑法：node e2e-tests/m2-end-to-end.e2e.mjs [--keep]
 * 退出码：0 = 五组断言全过；1 = 有断言失败或脚本报错。
 *
 * 禁止事项：
 *   1. 引入 npm 依赖 —— 只用 node 内建模块（断言/摘要复用 lib/service-harness.mjs）；
 *   2. 碰用户的库 / 端口 / 进程 —— 只在 `os.tmpdir()` 下的临时目录里造库；
 *   3. 把断言写软 —— 全部落在**观测值**与**库内容**上，不落在文案上。
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { log, must, printSummary } from './lib/service-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
/** 夹具（入库）：两个副本的最小 `.stratix` 契约面。 */
const FIXTURE_A = path.join(HERE, 'fixtures', 'm2-instance-a');
const FIXTURE_B = path.join(HERE, 'fixtures', 'm2-instance-b');
/** 场景进程（铺夹具 + 造数据 + 观测）。 */
const SCENARIO = path.join(HERE, 'm2-end-to-end', 'm2-scenario.ts');
/** 场景进程用的 tsconfig（`@/*` 路径别名）。 */
const TSCONFIG = path.join(HERE, 'm2-end-to-end', 'tsconfig.json');
/** 仓库内的 tsx（不经 npx —— 少一层进程与解析开销）。 */
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx');

const keepTmp = process.argv.includes('--keep');

/** 跑一条命令并把 stdout/stderr 收下（不抛 —— 由调用方判退出码）。 */
function run(label, command, args, options) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw new Error(`${label} 起不来：${result.error.message}`);
  return result;
}

/** 跑一条命令；退出码非 0 即抛（用于「必须成功」的那几条）。 */
function runOk(label, command, args, options) {
  const result = run(label, command, args, options);
  if (result.status !== 0) {
    const tail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.split('\n').slice(-30).join('\n');
    throw new Error(`${label} 失败（exit=${result.status}）：\n${tail}`);
  }
  return result;
}

/** 集合相等（顺序无关）。 */
function sameSet(a, b) {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return JSON.stringify(left) === JSON.stringify(right);
}

async function main() {
  must(
    '夹具已入库（两个副本的 .stratix 契约面）',
    fs.existsSync(path.join(FIXTURE_A, '.stratix', 'project.json')) &&
      fs.existsSync(path.join(FIXTURE_B, '.stratix', 'project.json')),
    `${FIXTURE_A} / ${FIXTURE_B}`
  );
  must('仓库内的 tsx 在位', fs.existsSync(TSX), TSX);

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-m2-e2e-'));
  log(`临时工作目录 ${workdir}`);

  try {
    // ===== 铺夹具：两个副本各自的契约面 =====
    fs.cpSync(FIXTURE_A, path.join(workdir, 'instance-a'), { recursive: true });
    fs.cpSync(FIXTURE_B, path.join(workdir, 'instance-b'), { recursive: true });
    must(
      '两个副本的契约面齐备（project.json / roster 索引 / config）',
      ['project.json', 'roster/_index.json', 'config/stratix.json'].every((rel) =>
        fs.existsSync(path.join(workdir, 'instance-a', '.stratix', rel))
      ) &&
        ['project.json', 'roster/_index.json', 'config/stratix.json'].every((rel) =>
          fs.existsSync(path.join(workdir, 'instance-b', '.stratix', rel))
        ),
      workdir
    );

    // ===== 跑场景进程（造数据 + 观测）=====
    const scenario = runOk(
      '场景进程',
      TSX,
      ['--tsconfig', TSCONFIG, SCENARIO],
      { cwd: REPO, env: { ...process.env, SX_M2_WORKDIR: workdir }, timeout: 600_000 }
    );
    log(scenario.stdout.trim());
    const reportPath = path.join(workdir, 'report.json');
    must('场景进程已产出报告', fs.existsSync(reportPath), reportPath);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const { g1, g2, g3, g4, g5 } = report;
    const A = report.instances.a;
    const B = report.instances.b;
    const SANDBOX = report.instances.sandbox;

    // ================================================================
    // ① 副本间数据隔离
    // ================================================================
    must(
      '① 步 N6：两个副本各自的 roster 物化出自己的一行集（契约 → 运行层）',
      sameSet(g1.materializedA.created, ['scout_wsp_m2_a', 'medic_wsp_m2_a']) &&
        sameSet(g1.materializedB.created, ['scout_wsp_m2_b', 'engineer_wsp_m2_b']),
      `A=${JSON.stringify(g1.materializedA.created)} B=${JSON.stringify(g1.materializedB.created)}`
    );
    must(
      '① 角色隔离：副本 A 只看得见自己的两行',
      sameSet(g1.aCharacters, ['scout_wsp_m2_a', 'medic_wsp_m2_a']),
      JSON.stringify(g1.aCharacters)
    );
    must(
      '① 角色隔离：副本 B 只看得见自己的两行',
      sameSet(g1.bCharacters, ['scout_wsp_m2_b', 'engineer_wsp_m2_b']),
      JSON.stringify(g1.bCharacters)
    );
    must(
      '① 角色隔离：两个副本的角色 id 零重叠（同名角色是两行、两 id）',
      g1.aCharacters.every((id) => !g1.bCharacters.includes(id)),
      `A=${JSON.stringify(g1.aCharacters)} B=${JSON.stringify(g1.bCharacters)}`
    );
    must(
      '① COALESCE 命中：旧行（instance_id IS NULL）归默认沙盒，对两个副本都不可见',
      !g1.aCharacters.includes('character_legacy_1') &&
        !g1.bCharacters.includes('character_legacy_1') &&
        g1.sandboxCharacters.includes('character_legacy_1'),
      `沙盒=${JSON.stringify(g1.sandboxCharacters)}`
    );
    must(
      '① COALESCE 命中：显式标了沙盒 id 的旧行同样只归沙盒',
      !g1.aCharacters.includes('character_sandbox_1') &&
        !g1.bCharacters.includes('character_sandbox_1') &&
        g1.sandboxCharacters.includes('character_sandbox_1'),
      `沙盒=${JSON.stringify(g1.sandboxCharacters)}`
    );
    must(
      '① 任务隔离：A 只看得见 A 的那单，B 只看得见 B 的那单',
      sameSet(g1.aTasks, ['task_a_1']) && sameSet(g1.bTasks, ['task_b_1']),
      `A=${JSON.stringify(g1.aTasks)} B=${JSON.stringify(g1.bTasks)}`
    );
    must(
      '① 任务隔离：旧任务归沙盒（两个副本都看不见）',
      sameSet(g1.sandboxTasks, ['task_legacy_1']) &&
        !g1.aTasks.includes('task_legacy_1') &&
        !g1.bTasks.includes('task_legacy_1'),
      `沙盒=${JSON.stringify(g1.sandboxTasks)}`
    );
    must(
      '① 任务行的 instance_id 真的落了库（写侧补齐后）',
      g1.aTaskInstanceId === A && g1.bTaskInstanceId === B && g1.legacyTaskInstanceId === null,
      `A=${g1.aTaskInstanceId} B=${g1.bTaskInstanceId} 旧=${g1.legacyTaskInstanceId}`
    );
    must(
      '① 会话隔离：A 只看得见 A 的会话，B 只看得见 B 的会话',
      sameSet(g1.aSessions, ['sess_a_1']) && sameSet(g1.bSessions, ['sess_b_1']),
      `A=${JSON.stringify(g1.aSessions)} B=${JSON.stringify(g1.bSessions)}`
    );
    must(
      '① 事件隔离：A 的事件 2 条、B 的事件 2 条、沙盒 0 条（互不可见）',
      g1.aEventCount === 2 && g1.bEventCount === 2 && g1.sandboxEventCount === 0,
      `A=${g1.aEventCount} B=${g1.bEventCount} 沙盒=${g1.sandboxEventCount}`
    );
    must(
      '① 各自养成：副本 A 的斥候升到 7 级，副本 B 的同名斥候还是 1 级',
      g1.aScoutLevel === 7 && g1.bScoutLevel === 1,
      `A=${g1.aScoutLevel} B=${g1.bScoutLevel}`
    );

    // ================================================================
    // ② 容量上限
    // ================================================================
    must(
      '② 每 instance 64 角色：副本灌满 64 行后新建被拒',
      g2.perInstanceFillAccepted === g2.limits.charactersPerInstance &&
        g2.perInstanceRejected === 0 &&
        g2.capacityA.reason === 'instance-limit' &&
        g2.capacityA.instanceCount === g2.limits.charactersPerInstance,
      `已收=${g2.perInstanceFillAccepted} 拒=${g2.perInstanceRejected} 判定=${g2.capacityA.reason}`
    );
    must(
      '② 每 instance 64 角色：满位后那一行被护栏拒掉',
      g2.rejectedByInstance.includes('cap_a_overflow'),
      JSON.stringify(g2.rejectedByInstance)
    );
    must(
      '② 全局 512 角色：全库灌到 512 行后新副本建档被拒（总池也到顶）',
      g2.totalAfterFill === g2.limits.charactersTotal &&
        g2.capacityFresh.reason === 'total-limit' &&
        g2.rejectedByTotal.includes('cap_fresh_1'),
      `总数=${g2.totalAfterFill} 判定=${g2.capacityFresh.reason} 拒=${JSON.stringify(g2.rejectedByTotal)}`
    );
    must(
      '② 容量只拒新不拒改：已存在的角色改档照写',
      g2.existingStillWritable.includes('cap_a_0'),
      JSON.stringify(g2.existingStillWritable)
    );
    must(
      '② session_events 每会话 512：第 513 条落库后最老的一条被搬走',
      g2.cap1Hot === g2.limits.sessionEventsPerSession &&
        g2.cap1ArchiveLineCount === 1 &&
        g2.cap1FirstArchivedSeq === 1,
      `热表=${g2.cap1Hot} 归档行数=${g2.cap1ArchiveLineCount} 最老 seq=${g2.cap1FirstArchivedSeq}`
    );
    must(
      '② 滚动归档落在 <副本根>/.stratix/history/（按月分片 jsonl）',
      g2.cap1ArchiveFiles.length === 1 &&
        /^session-events-\d{6}\.jsonl$/.test(g2.cap1ArchiveFiles[0]),
      JSON.stringify(g2.cap1ArchiveFiles)
    );
    must(
      '② session_events 每 instance 4096：4608 条 ⇒ 搬走最老的 512 条，热表剩 4096',
      g2.cap2Hot === g2.limits.sessionEventsPerInstance &&
        g2.cap2ArchiveLineCount ===
          9 * g2.limits.sessionEventsPerSession - g2.limits.sessionEventsPerInstance,
      `热表=${g2.cap2Hot} 归档行数=${g2.cap2ArchiveLineCount}`
    );

    // ================================================================
    // ③ N4b 校验脚本可重跑（夹具库；CLI 当子进程跑）
    // ================================================================
    must(
      '③ N4b 迁移在夹具库上成功（status=succeeded）',
      g3.migrationStatus === 'succeeded',
      `status=${g3.migrationStatus} 重写=${g3.migrationApplied} 行`
    );
    const verifyArgs = [
      path.join(REPO, 'scripts', 'verify-n4b-character-ids.ts'),
      '--data-dir',
      g3.dataDir,
      ...(g3.reportPath ? ['--report', g3.reportPath] : []),
    ];
    const verify1 = runOk('N4b 校验脚本（第 1 次）', TSX, verifyArgs, {
      cwd: REPO,
      timeout: 300_000,
    });
    const verify2 = runOk('N4b 校验脚本（第 2 次）', TSX, verifyArgs, {
      cwd: REPO,
      timeout: 300_000,
    });
    must(
      '③ 校验脚本可重跑：两次都退出 0',
      verify1.status === 0 && verify2.status === 0,
      `第1次=${verify1.status} 第2次=${verify2.status}`
    );
    must(
      '③ 校验脚本可重跑：两次输出逐字一致（幂等）',
      verify1.stdout === verify2.stdout,
      `${verify1.stdout.length} 字符 vs ${verify2.stdout.length} 字符`
    );
    must(
      '③ 四条校验全过（行数不变 / unit_positions 落位 / unit_id 集合 / 引用可解析）',
      g3.verify1Ok &&
        g3.verify1Checks.length >= 4 &&
        g3.verify1Checks.every((check) => check.status === 'pass' || check.status === 'warn') &&
        g3.verify1Checks.filter((check) => check.status === 'pass').length >= 4,
      JSON.stringify(g3.verify1Checks.map((check) => `${check.id}:${check.status}`))
    );
    must(
      '③ 校验脚本可重跑：模块级两次报告一致',
      g3.verify2Ok && g3.verify1IdenticalToVerify2 === true,
      `ok=${g3.verify1Ok}/${g3.verify2Ok} 一致=${g3.verify1IdenticalToVerify2}`
    );

    // ================================================================
    // ④ 回滚矩阵演练（校验失败 ⇒ 自动回滚）
    // ================================================================
    must(
      '④ 校验失败路径（任务指向不存在的角色）⇒ 整批回滚，id 一个没动',
      g4.dangling.status === 'rolled-back' &&
        g4.dangling.idsUnchanged === true &&
        g4.dangling.derivedIdAbsent === true,
      `status=${g4.dangling.status} id未变=${g4.dangling.idsUnchanged}`
    );
    must(
      '④ 校验失败路径：独立校验脚本对回滚后的库判不通过（悬空任务被检出）',
      g4.dangling.verifyOk === false && g4.dangling.verifyFailedChecks.includes('task-refs'),
      `verifyOk=${g4.dangling.verifyOk} 失败项=${JSON.stringify(g4.dangling.verifyFailedChecks)}`
    );
    const verifyFail = run(
      'N4b 校验脚本（失败路径）',
      TSX,
      [path.join(REPO, 'scripts', 'verify-n4b-character-ids.ts'), '--data-dir', g4.dangling.dataDir],
      { cwd: REPO, timeout: 300_000 }
    );
    must(
      '④ 校验失败路径：校验脚本退出码非 0（=1）',
      verifyFail.status === 1,
      `exit=${verifyFail.status}`
    );
    must(
      '④ participants 坏 JSON ⇒ 整批回滚',
      g4.brokenJson.status === 'rolled-back' &&
        g4.brokenJson.idsUnchanged === true &&
        g4.brokenJson.derivedIdAbsent === true,
      `status=${g4.brokenJson.status} id未变=${g4.brokenJson.idsUnchanged}`
    );
    must(
      '④ 前滚回滚（靠 character_id_map 反向 UPDATE）⇒ id 回到旧值',
      g4.forwardRollback.rollbackStatus === 'succeeded' &&
        g4.forwardRollback.derivedIdGone === true &&
        g4.forwardRollback.oldIdBack === true,
      `status=${g4.forwardRollback.rollbackStatus}`
    );
    const rehearse = runOk(
      'N4b 六步演练脚本',
      TSX,
      [path.join(REPO, 'scripts', 'rehearse-n4b-character-ids.ts')],
      { cwd: REPO, timeout: 600_000 }
    );
    must(
      '④ 六步演练脚本整场跑通（成功 / 坏行 / 校验不过 / 中途崩溃 / 前置阻断）',
      rehearse.status === 0 && rehearse.stdout.includes('全部断言通过'),
      rehearse.stdout.split('\n').filter((line) => line.includes('断言')).join(' | ')
    );

    // ================================================================
    // ⑤ N7 归属迁移：预览 → 执行 → 撤销
    // ================================================================
    must(
      '⑤ 预览：列出将迁走的角色 / 任务，且无阻断项',
      g5.previewCounts.characters >= 1 &&
        g5.previewCounts.tasks >= 1 &&
        g5.previewBlockers.length === 0 &&
        g5.previewTargetMaterialized === true,
      `角色=${g5.previewCounts.characters} 任务=${g5.previewCounts.tasks} 阻断=${JSON.stringify(g5.previewBlockers)}`
    );
    must(
      '⑤ 预览：一个字节都没改（源副本的行归属仍是 NULL）',
      g5.instanceIdAfterPreview === null,
      `instance_id=${g5.instanceIdAfterPreview}`
    );
    must(
      '⑤ 执行：行迁进目标副本（归属变成目标实例）',
      g5.instanceIdAfterExecute === B &&
        g5.taskInstanceIdAfterExecute === B &&
        g5.committed === true,
      `角色=${g5.instanceIdAfterExecute} 任务=${g5.taskInstanceIdAfterExecute}`
    );
    must(
      '⑤ 执行：迁走的行不再留在源副本（源副本再预览 = 0 行）',
      g5.previewAfterExecuteCounts.total === 0,
      JSON.stringify(g5.previewAfterExecuteCounts)
    );
    must(
      '⑤ 撤销预览：列出了本次可撤销的行',
      g5.rollbackPreviewTotal > 0,
      `可撤销=${g5.rollbackPreviewTotal}`
    );
    must(
      '⑤ 撤销：行回到源副本（归属还原成迁移前的 NULL）',
      g5.instanceIdAfterRollback === null && g5.taskInstanceIdAfterRollback === null,
      `角色=${g5.instanceIdAfterRollback} 任务=${g5.taskInstanceIdAfterRollback}`
    );

    // ── ⑤ 的 CLI 入口（脚本本身可用、可重跑）──
    const n7Dir = path.join(workdir, 'n7');
    const n7Script = path.join(REPO, 'scripts', 'migrate-n7-attribution.ts');
    const previewCli = runOk(
      'N7 预览 CLI',
      TSX,
      [n7Script, 'preview', '--data-dir', n7Dir, '--target', B],
      { cwd: REPO, timeout: 300_000 }
    );
    must(
      '⑤ N7 CLI：preview 退出 0 且打出了预览清单',
      previewCli.stdout.includes('N7 一次性归属迁移（预览）') &&
        previewCli.stdout.includes('预览模式：没有改动任何数据'),
      previewCli.stdout.split('\n').filter((line) => line.includes('合计')).join(' | ')
    );
    const migrateCli = runOk(
      'N7 执行 CLI',
      TSX,
      [n7Script, 'migrate', '--data-dir', n7Dir, '--target', B, '--confirm'],
      { cwd: REPO, timeout: 300_000 }
    );
    must(
      '⑤ N7 CLI：migrate --confirm 退出 0 且报了迁移行数',
      migrateCli.stdout.includes('迁移完成：'),
      migrateCli.stdout.split('\n').filter((line) => line.includes('迁移完成')).join(' | ')
    );
    const rollbackCli = runOk(
      'N7 撤销 CLI',
      TSX,
      [n7Script, 'rollback', '--data-dir', n7Dir, '--target', B, '--confirm'],
      { cwd: REPO, timeout: 300_000 }
    );
    must(
      '⑤ N7 CLI：rollback --confirm 退出 0 且撤销了行',
      rollbackCli.stdout.includes('已撤销'),
      rollbackCli.stdout.split('\n').filter((line) => line.includes('已撤销')).join(' | ')
    );

    // ── 附：控制面（dsh「暴露」面向的基线）──
    must(
      '控制面：两个副本的 id 与沙盒 id 三分（宿主能列举、能分别进入）',
      new Set([A, B, SANDBOX]).size === 3,
      `${A} / ${B} / ${SANDBOX}`
    );
  } finally {
    if (keepTmp) {
      log(`--keep：临时目录保留在 ${workdir}`);
    } else {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }
}

main()
  .then(() => {
    printSummary('PASS（M2 端到端验收：双副本隔离 + 容量上限 + N4b 校验/回滚演练 + N7 闭环）');
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error('[e2e] 剧本失败：', error?.stack ?? error);
    printSummary('FAIL（M2 端到端验收）');
    process.exitCode = 1;
  });
