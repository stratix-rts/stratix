#!/usr/bin/env node
/**
 * §4 功能对照表「实施状态」列一致性断言（@since v3.4，task_095）。
 *
 * 断言口径：
 *   ① proposal §4 表恰好 40 行，每行 7 个单元格，最后一列是「实施状态」且非空；
 *   ② 「实施状态」列里出现的每个 commit 号，在**本分支历史**里真实存在（是 HEAD 的祖先）——
 *      文档里写了一个不存在的号 = 状态列与实际 commit 不一致，当场红；
 *   ③ §4 的 40 个功能项（A1–G8）每一项，在三个断言文件里都有对应的 test 名 ——
 *      「逐项验证脚本化」不能只写进文档，得真的有断言；
 *   ④ 标 🟡（部分落地）的行，必须在 DEMO-PLAN §13.3「未尽事项」里登记 ——
 *      承诺了没做的事不许悄悄从表里消失。
 *
 * why 是脚本而不是 jest 用例：这条断言要跑 git（看 commit 是否在本分支历史里），
 *   放进 jest 会让「没有 .git 的拷贝目录」整体红掉 —— 脚本可以只在有 git 的工作区里跑。
 *
 * 用法：
 *   node scripts/check-hud-feature-matrix-status.mjs
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROPOSAL = path.join(ROOT, 'docs', 'hud-redesign-proposal.html');
const DEMO_PLAN = path.join(ROOT, 'docs', 'DEMO-PLAN.md');

/** §4 的 40 个功能项（顺序即表里的顺序）。 */
const EXPECTED_IDS = [
  ...Array.from({ length: 13 }, (_, i) => `A${i + 1}`),
  ...Array.from({ length: 3 }, (_, i) => `B${i + 1}`),
  ...Array.from({ length: 2 }, (_, i) => `C${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `D${i + 1}`),
  ...Array.from({ length: 5 }, (_, i) => `E${i + 1}`),
  ...Array.from({ length: 3 }, (_, i) => `F${i + 1}`),
  ...Array.from({ length: 8 }, (_, i) => `G${i + 1}`),
];

/** 三个断言文件（HUD 32 项 / 世界 7 项 / 组合根 1 项 = 40 项）。 */
const ASSERTION_FILES = [
  'src/hud/__tests__/v34-feature-matrix.test.ts',
  'src/world/__tests__/v34-feature-matrix.test.ts',
  'src/app/__tests__/v34-main-entry-buttons.test.ts',
];

const failures = [];
const check = (ok, msg) => {
  if (!ok) failures.push(msg);
  return ok;
};

/** commit 号是不是本分支历史里的祖先（不存在 / 不在链上都算否）。 */
function isAncestorOfHead(sha) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

const proposal = fs.readFileSync(PROPOSAL, 'utf-8');
const demoPlan = fs.readFileSync(DEMO_PLAN, 'utf-8');

// ── 取 §4 那一节的表 ──────────────────────────────────────────────────────────
const sectionStart = proposal.indexOf('<h2 class="sec"><span class="num">§4</span>');
if (!check(sectionStart >= 0, 'proposal 里找不到 §4 章节')) {
  console.error('✗ §4 章节不存在');
  process.exit(1);
}
const tableStart = proposal.indexOf('<table>', sectionStart);
const tableEnd = proposal.indexOf('</table>', tableStart);
const table = proposal.slice(tableStart, tableEnd);

const rows = table.match(/<tr><td class="num">([A-G]\d+)<\/td>[\s\S]*?<\/tr>/g) ?? [];
check(rows.length === 40, `§4 表有 ${rows.length} 行，应为 40 行`);

// ── ① 逐行：7 格 + 实施状态非空 ─────────────────────────────────────────────
const statusById = new Map();
for (const row of rows) {
  const id = /<td class="num">([A-G]\d+)<\/td>/.exec(row)?.[1];
  if (!id) continue;
  const cells = row.match(/<td[ >]/g) ?? [];
  check(cells.length === 7, `${id} 行有 ${cells.length} 个单元格，应为 7（含实施状态列）`);
  const status = /<td>(✅|🟡)[\s\S]*?<\/td>(?=<\/tr>)/.exec(row)?.[0] ?? '';
  check(status.length > 0, `${id} 行的「实施状态」列是空的`);
  statusById.set(id, status);
}
for (const id of EXPECTED_IDS) {
  check(statusById.has(id), `§4 表里缺 ${id} 行`);
}

// ── ② 状态列里的 commit 号必须在本分支历史里 ─────────────────────────────────
const shaRe = /<code>([0-9a-f]{7})<\/code>/g;
const shas = [...new Set([...table.slice(table.indexOf('<tbody>')).matchAll(shaRe)].map((m) => m[1]))];
for (const sha of shas) {
  check(isAncestorOfHead(sha), `§4 状态列里的 commit ${sha} 不在本分支历史里（HEAD 的祖先）`);
}

// DEMO-PLAN §13 的 commit 号同理（markdown 里是反引号，不是 <code>）
const planSection = demoPlan.slice(demoPlan.indexOf('## 13. v3.4'));
const planShas = [
  ...new Set(
    [...planSection.matchAll(/`([0-9a-f]{7})`/g)].map((m) => m[1]),
  ),
];
for (const sha of planShas) {
  if (isAncestorOfHead(sha)) continue;
  // 例外只有一个，且必须**显式声明**：文档里提一个不在本分支的号，是为了说明
  //   「任务书记的号 ≠ 本分支实际的号」。这种号必须当场写明「未落进本分支」——
  //   没写明 = 一个查无此commit的悬空引用，当场红。
  const line = planSection
    .split('\n')
    .find((l) => l.includes(`\`${sha}\``) && /(未|没有)落进本分支/.test(l));
  check(
    Boolean(line),
    `DEMO-PLAN §13 里的 commit ${sha} 不在本分支历史里（若是「任务书记的号 ≠ 实际号」的说明，须在该行写明「未落进本分支」）`,
  );
}

// ── ③ 40 项每一项都有对应的 test 名 ─────────────────────────────────────────
const sources = ASSERTION_FILES.map((rel) => ({
  rel,
  text: fs.readFileSync(path.join(ROOT, rel), 'utf-8'),
}));
const testedIds = new Set();
for (const { text } of sources) {
  for (const m of text.matchAll(/^\s*(?:test|it)\('([A-G]\d+)/gm)) testedIds.add(m[1]);
}
for (const id of EXPECTED_IDS) {
  check(testedIds.has(id), `${id} 没有对应的断言用例（三个断言文件里都找不到以 "${id} " 开头的用例名）`);
}

// ── ④ 🟡 的行必须在未尽事项里登记 ───────────────────────────────────────────
const leftovers = demoPlan.slice(demoPlan.indexOf('### 13.3'));
for (const [id, status] of statusById) {
  if (!status.startsWith('<td>🟡')) continue;
  check(leftovers.includes(id), `${id} 标了「部分落地」，但 DEMO-PLAN §13.3 未尽事项里没登记`);
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
const rowsOut = rows.map((row) => {
  const id = /<td class="num">([A-G]\d+)<\/td>/.exec(row)?.[1] ?? '?';
  const status = statusById.get(id) ?? '';
  const mark = status.startsWith('<td>🟡') ? '🟡' : '✅';
  const commits = [...status.matchAll(/<code>([0-9a-f]{7})<\/code>/g)].map((m) => m[1]);
  return `${id.padEnd(3)} ${mark} ${commits.join(' + ') || '（无 commit 号）'}`;
});

console.log('§4 功能对照表 · 实施状态列一致性');
console.log(`proposal: ${path.relative(ROOT, PROPOSAL)}（§4 表 ${rows.length} 行 / 状态列 ${statusById.size} 行）`);
console.log(`断言文件: ${ASSERTION_FILES.join(' · ')}（覆盖 ${testedIds.size} 个功能项）`);
const planAncestors = planShas.filter((s) => isAncestorOfHead(s)).length;
console.log(
  `commit 校验: §4 表 ${shas.length} 个（全部为 HEAD 祖先）+ DEMO-PLAN §13 ${planShas.length} 个` +
    `（${planAncestors} 个为 HEAD 祖先，${planShas.length - planAncestors} 个显式声明「未落进本分支」）`,
);
console.log('');
for (const line of rowsOut) console.log(line);
console.log('');

if (failures.length > 0) {
  console.error(`✗ 状态列一致性断言失败（${failures.length} 条）：`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('✓ 状态列一致性全过：40 行各有实施状态、commit 号真实存在、40 项都有断言用例、部分落地项均已登记未尽事项');
