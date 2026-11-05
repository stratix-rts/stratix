#!/usr/bin/env node
/**
 * 文件职责：**M1 端到端验收**驱动脚本（@since v3.3，task_190 / docs/DESIGN-project-map.md §7.1「M1-16」行）。
 *
 * ============ 验收什么（§7.1「M1-16」行的剧本，逐字照跑）============
 *   进默认沙盒 → 造单位 / 任务 → 切到第二个副本 → 断言**无残留**
 *   （单位表空、地图槽归零、种子键分家）→ 切回 → 断言数据**还在**（不是被清空）。
 *
 * ============ 三条断言 =============
 *   ① **切副本不串数据**：切到第二个副本后，单位表空 / 地图槽归零 / 站位种子键分家
 *      （B 副本那份种子里**不含** A 副本的单位 id）。
 *   ② **切回后旧数据完整**：切回默认沙盒，单位 / 角色 / 任务 / 站位 / 库里那几行**都还在**
 *      （是被换回来，不是被清空）。
 *   ③ **零 DDL**：M1 不加 `instance_id` 列 ⇒ 库结构与 **M1 前**（提交 `dbaa85b`）**逐字节一致**。
 *      「M1 前」不靠嘴说：脚本把那个提交 `git archive` 展开成临时代码树，
 *      用**那棵树里的代码**建一次库、抄一次 `sqlite_master`（基线），
 *      再与本轮真实开出来的库结构**逐字节比较** ⇒ 可复算的事实。
 *
 * ============ 为什么是两个进程 =============
 *   站位种子是**启动读档**时写进键仓的（组合根 preBoot）——
 *   同一个进程里造完数据再切副本，读档那一步根本没发生过，种子分区无从验。
 *   分进程 = 真的重启一次，读档走的是**生产代码**（game-save-coordinator + 一次性迁移）。
 *
 * ============ 夹具（入库）============
 *   `e2e-tests/fixtures/m1-instance-b/` —— 第二个副本的最小 `.stratix` 契约面
 *   （project.json / roster/_index.json / roster/<role>.json / config/stratix.json）+ AGENTS.md。
 *   跑的时候整份拷进临时目录（不写仓库）。
 *
 * 跑法：node e2e-tests/m1-instance-switch.e2e.mjs [--keep]
 * 退出码：0 = 三条断言全过；1 = 有断言失败或脚本报错。
 *
 * 禁止事项：
 *   1. 引入 npm 依赖 —— 本脚本只用 node 内建模块（断言/摘要复用 lib/service-harness.mjs）；
 *   2. 碰用户的开发端口 / 进程 —— 本脚本不监听端口、不扫杀进程；
 *   3. 把断言写软 —— 三条断言全部落在**观测值**与**库结构快照**上，不落在文案上。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { log, must, printSummary } from './lib/service-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
/** 夹具（入库）：第二个副本的最小 `.stratix` 契约面。 */
const FIXTURE = path.join(HERE, 'fixtures', 'm1-instance-b');
/** 战场侧进程脚本（seed / switch 两阶段）。 */
const PROCESS = path.join(HERE, 'm1-instance-switch', 'instance-switch-process.ts');
/** 该目录的 tsconfig —— 把 `phaser` 映射到桩模块（node 里跑不了真 Phaser）。 */
const TSCONFIG = path.join(HERE, 'm1-instance-switch', 'tsconfig.json');
/** 仓库内的 tsx（不经 npx —— 少一层进程与解析开销）。 */
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx');
/** 替身标记（与 fake-cli.ts 一致）。 */
const FAKE_CLI_MARKER = 'e2e-m1-fake-cli';
/** 第二个副本的实例 id（与 instance-switch-process.ts 一致）。 */
const INSTANCE_B_ID = 'wsp_instance_b';
/** 默认沙盒的实例 id。 */
const SANDBOX_ID = 'wsp_sandbox';
/** M1 前 = M1-01 的父提交；任务书钉死的值（脚本会断言两者一致）。 */
const PRE_M1_COMMIT_PINNED = 'dbaa85b';

const keepTmp = process.argv.includes('--keep');

/** 跑一条命令并把 stdout/stderr 收下（失败时把尾巴打出来）。 */
function run(label, command, args, options) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const tail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.split('\n').slice(-25).join('\n');
    throw new Error(`${label} 失败（exit=${result.status}）：\n${tail}`);
  }
  return result;
}

/**
 * 「M1 前」= 任务书钉死的那个提交（设计冻结点，M0/M1 实施波次之前）。
 * why 不动态解析「M1-01 的父提交」：那是**实施波次**的起点，而任务书钉的是**冻结点**
 *   （`dbaa85b` = 「设计冻结+M1拆分建议」）—— 后者才是「M1 前」的权威所指。
 *   钉死的 hash 若在历史里不存在 ⇒ 基线无从谈起 ⇒ 直接报错（不静默换提交）。
 */
function resolvePreM1Commit() {
  const preM1 = execFileSync('git', ['rev-parse', `${PRE_M1_COMMIT_PINNED}^{commit}`], {
    cwd: REPO,
    encoding: 'utf8',
  }).trim();
  const subject = execFileSync('git', ['log', '-1', '--format=%s', preM1], {
    cwd: REPO,
    encoding: 'utf8',
  }).trim();
  log(`M1 前基线提交 ${preM1.slice(0, 7)}（${subject}）`);
  return { preM1, subject };
}

/**
 * DDL 源码清单（**唯一**能改变库结构的那批文件：建表 / 加列 / 建索引都在这里）。
 * why 要这份清单：库结构逐字节相同既可能是「DDL 没动」，也可能是「两棵树恰好建出一样的库」——
 *   源码侧零改动 + 产物侧逐字节一致，两头都对上，「零 DDL」才是事实。
 */
const DDL_SOURCES = [
  'src/stratix-database/StratixDatabase.ts',
  'src/app/services/persistence/agent-health-dao.ts',
  'src/app/services/persistence/chat-history-dao.ts',
  'src/app/services/persistence/custom-agent-dao.ts',
  'src/app/services/persistence/exp-event-dao.ts',
  'src/app/services/persistence/game-save-dao.ts',
  'src/app/services/persistence/pipeline-record-dao.ts',
  'src/app/services/persistence/session-dao.ts',
  'src/app/services/persistence/session-event-dao.ts',
  'src/app/services/persistence/task-record-dao.ts',
];

/** 两个坐标是否相等（纯值比较，不看对象同一性）。 */
function samePoint(a, b) {
  return Boolean(a) && Boolean(b) && a.x === b.x && a.y === b.y;
}

/** 深比较两个 JSON 值（序列化后逐字节比）。 */
function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  must('仓库里能拿到 git 历史（M1 前基线的前提）', fs.existsSync(path.join(REPO, '.git')), REPO);
  must(
    '夹具已入库（第二个副本的 .stratix 契约面）',
    fs.existsSync(path.join(FIXTURE, '.stratix', 'project.json')),
    FIXTURE
  );

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-m1-e2e-'));
  const instanceBRoot = path.join(workdir, 'instance-b');
  log(`临时工作目录 ${workdir}`);

  try {
    // ===== ① 把第二个副本的夹具拷进临时目录 =====
    fs.cpSync(FIXTURE, instanceBRoot, { recursive: true });
    must(
      '第二个副本含 .stratix 契约面（project.json / roster / config 齐备）',
      ['project.json', 'roster/_index.json', 'config/stratix.json'].every((rel) =>
        fs.existsSync(path.join(instanceBRoot, '.stratix', rel))
      ),
      instanceBRoot
    );

    // ===== ② M1 前的代码树（零 DDL 基线用）=====
    const { preM1 } = resolvePreM1Commit();
    // 源码侧：建表 / 加列的那批文件从「M1 前」到现在**一字未改** ⇒ 结构不可能变。
    const ddlDiff = execFileSync(
      'git',
      ['diff', '--stat', preM1, 'HEAD', '--', ...DDL_SOURCES],
      { cwd: REPO, encoding: 'utf8' }
    ).trim();
    must(
      '③ 源码侧零 DDL：建表 / 加列的文件从 M1 前到现在一字未改',
      ddlDiff === '',
      ddlDiff.slice(0, 120) || 'git diff 为空'
    );
    const preM1Dir = path.join(workdir, 'pre-m1');
    fs.mkdirSync(preM1Dir, { recursive: true });
    const tar = execFileSync(
      'git',
      ['archive', '--format=tar', preM1, 'src', 'package.json', 'tsconfig.json'],
      { cwd: REPO, maxBuffer: 256 * 1024 * 1024 }
    );
    const tarFile = path.join(workdir, 'pre-m1.tar');
    fs.writeFileSync(tarFile, tar);
    run('展开 M1 前代码树', 'tar', ['-xf', tarFile, '-C', preM1Dir]);
    // node_modules 借用仓库的（那棵树是 M1 前的**代码**，依赖不随提交变）。
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(preM1Dir, 'node_modules'), 'dir');

    const baselineOut = path.join(workdir, 'pre-m1-schema.json');
    run('M1 前库结构基线', TSX, [path.join(HERE, 'm1-instance-switch', 'schema-baseline.ts')], {
      cwd: preM1Dir,
      env: {
        ...process.env,
        SX_M1_BASELINE_ROOT: preM1Dir,
        SX_M1_BASELINE_DATA_DIR: path.join(workdir, 'pre-m1-db'),
        SX_M1_BASELINE_OUT: baselineOut,
      },
    });
    must('M1 前基线快照已产出', fs.existsSync(baselineOut), baselineOut);
    const baseline = JSON.parse(fs.readFileSync(baselineOut, 'utf8'));
    const baselineRows = baseline.rows ?? baseline;

    // ===== ③ 造数据（第一进程：进默认沙盒 → 造单位 / 任务 / 站位 → 真落库）=====
    // why cwd = workdir：默认沙盒 = **进程 cwd 快照**（M1-07 的口径）⇒ 沙盒路径就是它。
    const seedFile = path.join(workdir, 'seed.json');
    run('造数据（seed 阶段）', TSX, ['--tsconfig', TSCONFIG, PROCESS], {
      cwd: workdir,
      env: {
        ...process.env,
        SX_M1_WORKDIR: workdir,
        SX_M1_INSTANCE_B_ROOT: instanceBRoot,
        SX_M1_PHASE: 'seed',
        SX_M1_RESULT_FILE: seedFile,
      },
      timeout: 180_000,
    });
    must('造数据结果已回报', fs.existsSync(seedFile), seedFile);
    const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));

    must('造的单位真跑完了一单（task → completed）', seed.taskStatus === 'completed', `status=${seed.taskStatus}`);
    must('那单真落了库（character_tasks 有这一行）', seed.persistedTaskStatus === 'completed', `落库=${seed.persistedTaskStatus}`);
    must(
      '造的数据都真落库了（characters / unit_positions / character_tasks 各 ≥1 行）',
      seed.dbCounts.characters >= 1 &&
        seed.dbCounts.unitPositions >= 1 &&
        seed.dbCounts.characterTasks >= 1,
      JSON.stringify(seed.dbCounts)
    );
    must(
      '子进程回报可解析（真派过这一单，完整往返）',
      seed.cliMarker === FAKE_CLI_MARKER,
      `marker=${seed.cliMarker}`
    );
    must(
      '子进程 cwd == 默认沙盒（进程 cwd 快照）',
      fs.realpathSync(seed.cliCwd) === fs.realpathSync(workdir),
      `child=${seed.cliCwd}`
    );
    must('造完数据后进了默认沙盒', (seed.projectChangedSeen ?? []).includes(SANDBOX_ID), JSON.stringify(seed.projectChangedSeen));

    // ===== ④ 切副本往返（第二进程：重启读档 → 进沙盒 → 切 B → 退出 → 切回）=====
    const switchFile = path.join(workdir, 'switch.json');
    run('切副本往返（switch 阶段）', TSX, ['--tsconfig', TSCONFIG, PROCESS], {
      cwd: workdir,
      env: {
        ...process.env,
        SX_M1_WORKDIR: workdir,
        SX_M1_INSTANCE_B_ROOT: instanceBRoot,
        SX_M1_PHASE: 'switch',
        SX_M1_RESULT_FILE: switchFile,
      },
      timeout: 180_000,
    });
    must('切副本结果已回报', fs.existsSync(switchFile), switchFile);
    const sw = JSON.parse(fs.readFileSync(switchFile, 'utf8'));

    const inSandbox = sw.inSandbox ?? {};
    const inB = sw.inInstanceB ?? {};
    const back = sw.backToSandbox ?? {};
    const sandboxScene = inSandbox.scene ?? {};
    const bScene = inB.scene ?? {};
    const backScene = back.scene ?? {};

    // ---------------------------------------------------------------
    // ① 切副本不串数据
    // ---------------------------------------------------------------
    must('① 切到副本前：沙盒里确有单位（无残留断言不是空断言）', (sandboxScene.units ?? 0) >= 1, `units=${sandboxScene.units}`);
    must(
      '① 切到副本前：沙盒里地图槽非零（有任务占格 ⇒ 后面「归零」可判）',
      (sandboxScene.nextSlot ?? 0) >= 1,
      `nextSlot=${sandboxScene.nextSlot}`
    );
    must('① 切到第二个副本：活跃副本确实是它', inB.activeInstanceId === INSTANCE_B_ID, `active=${inB.activeInstanceId}`);
    must('① 切到第二个副本：战场场景重建在它名下', bScene.instanceId === INSTANCE_B_ID, `scene.instanceId=${bScene.instanceId}`);
    must('① 切到第二个副本：单位表空（不串 A 的单位）', (bScene.units ?? -1) === 0, `units=${bScene.units}`);
    must('① 切到第二个副本：地图槽归零', (bScene.nextSlot ?? -1) === 0, `nextSlot=${bScene.nextSlot}`);
    must(
      '① 切到第二个副本：站位种子键分家（B 那份不含 A 的单位 id）',
      !(bScene.seedUnitIds ?? []).includes(seed.unitId),
      `B 种子单位=${JSON.stringify(bScene.seedUnitIds ?? [])}`
    );
    must(
      '① 切到第二个副本：键仓里 A 的那份种子仍在原地（分家 ≠ 丢失）',
      (inB.sandboxSeedUnitIds ?? []).includes(seed.unitId),
      `沙盒种子单位=${JSON.stringify(inB.sandboxSeedUnitIds ?? [])}`
    );
    must(
      '① 切到第二个副本：store 里没有 A 的角色 / 任务（零残留）',
      (inB.store?.characters ?? -1) === 0 &&
        (inB.store?.tasks ?? -1) === 0 &&
        (inB.store?.units ?? -1) === 0,
      JSON.stringify(inB.store)
    );
    must(
      '① 旧全局种子键已删（不留回落口 ⇒ 旧数据不会漏进别的副本）',
      inB.legacySeedPresent === false,
      `legacyPresent=${inB.legacySeedPresent}`
    );

    // ---------------------------------------------------------------
    // ② 切回后旧数据完整（不是被清空）
    // ---------------------------------------------------------------
    must('② 切回默认沙盒：活跃副本回来了', back.activeInstanceId === SANDBOX_ID, `active=${back.activeInstanceId}`);
    must(
      '② 切回默认沙盒：store 里角色 / 单位 / 任务都还在',
      (back.store?.characters ?? 0) >= 1 &&
        (back.store?.units ?? 0) >= 1 &&
        (back.store?.tasks ?? 0) >= 1,
      JSON.stringify(back.store)
    );
    must('② 切回默认沙盒：战场上单位回来了', (backScene.units ?? 0) >= 1, `units=${backScene.units}`);
    must(
      '② 切回默认沙盒：站位还在（还是移动落库的那个点）',
      samePoint(backScene.unitPositions?.[seed.unitId], seed.position),
      `位置=${JSON.stringify(backScene.unitPositions?.[seed.unitId] ?? null)} 期望=${JSON.stringify(seed.position)}`
    );
    must(
      '② 切回默认沙盒：库里那几行没被清空（与造完数据时逐项相同）',
      sameJson(sw.dbCounts, seed.dbCounts),
      `${JSON.stringify(sw.dbCounts)} vs ${JSON.stringify(seed.dbCounts)}`
    );

    // ---------------------------------------------------------------
    // ③ 零 DDL
    // ---------------------------------------------------------------
    must(
      '③ 库结构与 M1 前逐字节一致（sqlite_master 全量行相同）',
      sameJson(sw.schema, baselineRows),
      `本轮 ${(sw.schema ?? []).length} 行 / M1 前 ${baselineRows.length} 行`
    );
    must(
      '③ 库结构里没有 instance_id 列（M1 不加列）',
      !(sw.schema ?? []).some((row) => String(row.sql ?? '').includes('instance_id')),
      '全表定义中无 instance_id'
    );
    must(
      '③ PRAGMA schema_version 与 M1 前一致',
      sameJson(sw.pragma, baseline.pragma),
      `${JSON.stringify(sw.pragma)} vs ${JSON.stringify(baseline.pragma)}`
    );

    // ---------------------------------------------------------------
    // 附：宿主可见控制面（dsh「暴露」面向的基线）
    // ---------------------------------------------------------------
    const instances = sw.instances ?? [];
    must(
      '控制面：实例清单对宿主可见（默认沙盒 + 第二个副本）',
      instances.some((view) => view.instanceId === SANDBOX_ID) &&
        instances.some((view) => view.instanceId === INSTANCE_B_ID),
      instances.map((view) => view.instanceId).join(',')
    );
    must(
      '控制面：第二个副本没落下归档文件（无未终结 mission ⇒ 不该有）',
      (sw.archiveFiles ?? []).length === 0,
      JSON.stringify(sw.archiveFiles ?? [])
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
    printSummary('PASS（M1 端到端验收：切副本零残留 + 切回数据完整 + 零 DDL）');
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error('[e2e] 剧本失败：', error?.stack ?? error);
    printSummary('FAIL（M1 端到端验收）');
    process.exitCode = 1;
  });
