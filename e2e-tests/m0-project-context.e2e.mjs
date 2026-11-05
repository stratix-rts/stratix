#!/usr/bin/env node
/**
 * 文件职责：**M0 端到端验收**驱动脚本（@since v3.3，task_172 / docs/DESIGN-workspace.md §8「M0-08」行）。
 *
 * ============ 验收什么（§8「M0-08」行的三点，全断言）============
 *   在**含 `.stratix` 的目录**里真派一单 ⇒
 *     ① prompt 含 `<stratix-project>` 项目块（含来源声明行，内容与契约一致）；
 *     ② 子进程 cwd == 项目根；
 *     ③ 数据库零变化：**库结构与 M0 前逐字节一致**（零 DDL）。
 *
 * ============ 「完整往返」而不是单点（§8 M0-08 行的 dsh 双面向）============
 *   走的是生产组合根（`createStratixService` + service 侧执行环）：
 *   core 总线派单 → task-service 拼 prompt → cli-transport 真拉子进程 →
 *   子进程回报 → 事件流 → 任务收尾 → **真落库**。
 *   脚本从**库里**把子进程的回报捞出来再断言 ⇒ 验的是「派出去的那一趟」，不是某个函数。
 *
 * ============ 「M0 前」怎么定义（不靠嘴说）============
 *   M0 的第一个提交（M0-01）的**父提交** = M0 前。脚本用 `git archive` 把那棵代码树展开到临时目录，
 *   用**那棵树里的代码**建一次库、抄一次 `sqlite_master`（基线），
 *   再与本轮真实开出来的库结构**逐字节比较** ⇒ 「与 M0 前一致」是可复算的事实，不是断言文案。
 *
 * ============ 夹具（入库）============
 *   `e2e-tests/fixtures/m0-project/` —— 一个最小 `.stratix` 契约面
 *   （project.json / roster/_index.json / roster/<role>.json / config/stratix.json）+ 项目根 AGENTS.md。
 *   跑的时候整份拷进临时目录（不写仓库）。
 *
 * 跑法：node e2e-tests/m0-project-context.e2e.mjs [--keep]
 * 退出码：0 = 三点断言全过；1 = 有断言失败或脚本报错。
 *
 * 禁止事项：
 *   1. 引入 npm 依赖 —— 本脚本只用 node 内建模块（断言/摘要复用 lib/service-harness.mjs）；
 *   2. 碰用户的开发端口 / 进程 —— 本脚本不监听端口、不 spawn 常驻服务（子进程由替身跑完即退）；
 *   3. 在脚本里断言「看起来对」 —— 三点断言全部落在**子进程回报**与**库结构快照**上。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { log, must, printSummary } from './lib/service-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
/** 夹具（入库）：一个最小 `.stratix` 契约面。 */
const FIXTURE = path.join(HERE, 'fixtures', 'm0-project');
/** 仓库内的 tsx（不经 npx —— 少一层进程与解析开销）。 */
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx');
/** 替身标记（与 fake-cli.ts 一致）。 */
const FAKE_CLI_MARKER = 'e2e-m0-fake-cli';

const keepTmp = process.argv.includes('--keep');

/** 跑一条命令并把 stdout/stderr 收下（失败时把尾巴打出来）。 */
function run(label, command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    const tail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.split('\n').slice(-25).join('\n');
    throw new Error(`${label} 失败（exit=${result.status}）：\n${tail}`);
  }
  return result;
}

/**
 * 找「M0 的第一个提交」（标题里带 M0-01 的那个），它的父提交 = **M0 前**。
 * why 不写死 commit hash：分支会 rebase，写死的 hash 会悄悄指向别的提交 ⇒ 基线说谎。
 */
function resolvePreM0Commit() {
  const lines = execFileSync('git', ['log', '--format=%H%x09%s'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes('\t'));
  const m0Line = lines.find((line) => /M0-01/.test(line.split('\t')[1] ?? ''));
  if (!m0Line) throw new Error('找不到 M0-01 提交（M0 前基线无从谈起）');
  const m0Commit = m0Line.split('\t')[0];
  const preM0 = execFileSync('git', ['rev-parse', `${m0Commit}^`], { cwd: REPO, encoding: 'utf8' }).trim();
  log(`M0 起点 ${m0Commit.slice(0, 7)}（${m0Line.split('\t')[1]}）→ M0 前基线 ${preM0.slice(0, 7)}`);
  return { m0Commit, preM0 };
}

async function main() {
  must('仓库里能拿到 git 历史（M0 前基线的前提）', fs.existsSync(path.join(REPO, '.git')), REPO);
  must('夹具已入库（含 .stratix 契约面）', fs.existsSync(path.join(FIXTURE, '.stratix', 'project.json')), FIXTURE);

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-m0-e2e-'));
  const projectRoot = path.join(workdir, 'project');
  log(`临时工作目录 ${workdir}`);

  try {
    // ===== ① 把夹具拷进临时目录（项目根 = 含 .stratix 的目录）=====
    fs.cpSync(FIXTURE, projectRoot, { recursive: true });
    must(
      '项目根含 .stratix 契约面（project.json / roster / config 齐备）',
      ['project.json', 'roster/_index.json', 'config/stratix.json'].every((rel) =>
        fs.existsSync(path.join(projectRoot, '.stratix', rel))
      ),
      projectRoot
    );

    // ===== ② M0 前的代码树（基线用）=====
    const { preM0 } = resolvePreM0Commit();
    const preM0Dir = path.join(workdir, 'pre-m0');
    fs.mkdirSync(preM0Dir, { recursive: true });
    const tar = execFileSync(
      'git',
      ['archive', '--format=tar', preM0, 'src', 'package.json', 'tsconfig.json'],
      { cwd: REPO, maxBuffer: 256 * 1024 * 1024 }
    );
    const tarFile = path.join(workdir, 'pre-m0.tar');
    fs.writeFileSync(tarFile, tar);
    run('展开 M0 前代码树', 'tar', ['-xf', tarFile, '-C', preM0Dir]);
    // node_modules 借用仓库的（那棵树是 M0 前的**代码**，依赖不随提交变）。
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(preM0Dir, 'node_modules'), 'dir');

    const baselineOut = path.join(workdir, 'pre-m0-schema.json');
    run('M0 前库结构基线', TSX, [path.join(HERE, 'm0-project-context', 'schema-baseline.ts')], {
      cwd: preM0Dir,
      env: {
        ...process.env,
        SX_M0_BASELINE_ROOT: preM0Dir,
        SX_M0_BASELINE_DATA_DIR: path.join(workdir, 'pre-m0-db'),
        SX_M0_BASELINE_OUT: baselineOut,
      },
    });
    must('M0 前基线快照已产出', fs.existsSync(baselineOut), baselineOut);
    const baseline = JSON.parse(fs.readFileSync(baselineOut, 'utf8'));

    // ===== ③ 在含 .stratix 的目录里真派一单 =====
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: REPO,
      encoding: 'utf8',
    }).trim();
    const resultFile = path.join(workdir, 'result.json');
    run('service 侧派单', TSX, [path.join(HERE, 'm0-project-context', 'service-process.ts')], {
      cwd: REPO,
      env: {
        ...process.env,
        SX_M0_WORKDIR: workdir,
        SX_M0_PROJECT_ROOT: projectRoot,
        SX_M0_BRANCH: branch,
        SX_M0_RESULT_FILE: resultFile,
      },
      timeout: 180_000,
    });
    must('派单结果已回报', fs.existsSync(resultFile), resultFile);
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));

    // ===== ④ 断言 =====
    must('派单真跑完（task → completed）', result.taskStatus === 'completed', `status=${result.taskStatus}`);
    must(
      '任务真的落了库（character_tasks 有这一行 ⇒ 「库零变化」不是空话）',
      result.taskRows >= 1,
      `character_tasks 行数=${result.taskRows}，sessions 行数=${result.sessionRows}`
    );

    // 子进程回报（从库里捞出来的 —— 完整往返）
    let report = null;
    try {
      report = JSON.parse(result.output);
    } catch {
      report = null;
    }
    must('子进程回报可解析（替身确实跑过这一轮）', report?.marker === FAKE_CLI_MARKER, result.output?.slice(0, 120));
    const prompt = report?.prompt ?? '';

    // —— ① prompt 含项目块（含来源声明行）——
    const openTag = prompt.indexOf('<stratix-project>');
    const closeTag = prompt.indexOf('</stratix-project>');
    must('① prompt 含 <stratix-project> 项目块（开闭标签成对）', openTag !== -1 && closeTag > openTag);
    const block = prompt.slice(openTag, closeTag);
    must(
      '① 项目块含来源声明行（数据不是指令）',
      block.includes(result.sourceDeclaration),
      result.sourceDeclaration
    );
    must(
      '① 项目块内容与契约一致（项目名 / id / 角色 / 约定 / 指令文件）',
      ['雨林哨站', 'spx_9f3c2a1b7d4e5f60qz81m', '斥候', 'scout', '默认角色 scout', '并发上限 2', 'AGENTS.md'].every(
        (token) => block.includes(token)
      ),
      '项目名/id/角色/默认角色/并发上限/指令文件'
    );
    must(
      '① 项目块位置正确（角色设定之后、任务指令之前）',
      prompt.indexOf('【角色设定】') < openTag && openTag < prompt.indexOf('【任务指令】')
    );
    must('① 项目块是独立标签（不在 <stratix-context> 内）', !block.includes('<stratix-context>'));

    // —— ② 子进程 cwd == 项目根 ——
    const childCwd = fs.realpathSync(report.cwd);
    const expectedCwd = fs.realpathSync(projectRoot);
    must('② 子进程 cwd == 项目根', childCwd === expectedCwd, `child=${childCwd}`);

    // —— ③ 数据库零变化 ——
    const schemaBefore = JSON.stringify(result.schemaBefore);
    const schemaAfter = JSON.stringify(result.schemaAfter);
    must(
      '③ 派发全程零 DDL（sqlite_master 逐字节一致）',
      schemaBefore === schemaAfter,
      `前 ${result.schemaBefore.length} 行 / 后 ${result.schemaAfter.length} 行`
    );
    must(
      '③ 派发全程零 DDL（PRAGMA schema_version 未变）',
      JSON.stringify(result.pragmaBefore) === JSON.stringify(result.pragmaAfter),
      `${JSON.stringify(result.pragmaBefore)} → ${JSON.stringify(result.pragmaAfter)}`
    );
    must(
      '③ 库结构与 M0 前逐字节一致',
      schemaBefore === JSON.stringify(baseline),
      `本轮 ${result.schemaBefore.length} 行 / M0 前 ${baseline.length} 行`
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
    printSummary('PASS（M0 端到端验收：项目块 + cwd + 库零变化）');
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error('[e2e] 剧本失败：', error?.stack ?? error);
    printSummary('FAIL（M0 端到端验收）');
    process.exitCode = 1;
  });
