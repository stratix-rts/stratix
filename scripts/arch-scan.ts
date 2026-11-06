/**
 * 脚本职责：**架构铁律静态扫描的 CLI 入口**（@since v3.3，task_222 / QA-02）。
 *
 *   用法：
 *     npm run arch:scan          # 棘轮模式：有**未豁免**违规 ⇒ 退出码 1
 *     npm run arch:scan:strict   # 严格模式：有任何违规（含已豁免）⇒ 退出码 1
 *
 *   为什么有两种模式：
 *     棘轮模式是 CI 的默认口径 —— 已知的历史债记在豁免账本里（src/architecture/law-waivers.ts），
 *     账本之外的新违规一律红。严格模式给「想看全貌 / 豁免清零后转正」用。
 *   禁止事项：在这里改产品代码 —— 本脚本只报告。
 */

import * as path from 'path';

import { allFindings, scanArchitecture, type LawFinding, type ScanReport } from '../src/architecture/law-scanner';
import { LAW_WAIVERS, type LawWaiver } from '../src/architecture/law-waivers';

const REPO_ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');

/** 豁免键：铁律 + 文件 + 符号。 */
function waiverKey(lawId: string, file: string, symbol: string): string {
  return `${lawId}|${file}|${symbol}`;
}

/** 豁免账本索引。 */
const waiverIndex = new Map<string, LawWaiver>(LAW_WAIVERS.map((w) => [waiverKey(w.lawId, w.file, w.symbol), w]));

/** 找一条违规对应的豁免。 */
function findWaiver(finding: LawFinding): LawWaiver | undefined {
  return waiverIndex.get(waiverKey(finding.lawId, finding.file, finding.symbol));
}

/** 打印一份报告。 */
function printReport(report: ScanReport): { unwaived: LawFinding[]; waived: LawFinding[] } {
  const unwaived: LawFinding[] = [];
  const waived: LawFinding[] = [];
  console.log('═'.repeat(78));
  console.log('架构铁律静态扫描（task_222 / QA-02）');
  console.log('═'.repeat(78));
  for (const result of report.results) {
    const findings = result.findings;
    console.log('');
    console.log(`【${result.lawId}】${result.title} —— ${findings.length === 0 ? '通过' : `${findings.length} 条违规`}`);
    console.log(`  规则：${result.rule}`);
    for (const finding of findings) {
      const waiver = findWaiver(finding);
      if (waiver) {
        waived.push(finding);
        console.log(`  ~ [已豁免 ${waiver.id}] ${finding.file}:${finding.line}  ${finding.symbol}`);
        console.log(`      ${finding.message}`);
        console.log(`      豁免理由：${waiver.reason}`);
      } else {
        unwaived.push(finding);
        console.log(`  ✗ [违规] ${finding.file}:${finding.line}  ${finding.symbol}`);
        console.log(`      ${finding.message}`);
      }
    }
  }

  // 过期豁免（账本里记了、但实际已经没有对应违规）—— 只提示，不阻断。
  const liveKeys = new Set(report.results.flatMap((r) => r.findings).map((f) => waiverKey(f.lawId, f.file, f.symbol)));
  const stale = LAW_WAIVERS.filter((w) => !liveKeys.has(waiverKey(w.lawId, w.file, w.symbol)));
  if (stale.length > 0) {
    console.log('');
    console.log('过期豁免（对应违规已消失，可清理账本）：');
    for (const w of stale) console.log(`  - ${w.id}  ${w.lawId} ${w.file} ${w.symbol}`);
  }

  console.log('');
  console.log('─'.repeat(78));
  console.log(`合计：${allFindings(report).length} 条违规（未豁免 ${unwaived.length} / 已豁免 ${waived.length}）`);
  return { unwaived, waived };
}

const report = scanArchitecture(REPO_ROOT);
const { unwaived } = printReport(report);

if (STRICT && unwaived.length === 0 && allFindings(report).length > 0) {
  console.log('');
  console.log('严格模式：存在已豁免的历史债 ⇒ 退出码 1');
  process.exit(1);
}
if (unwaived.length > 0) {
  console.log('');
  console.log('存在未豁免的架构违规 ⇒ 退出码 1');
  process.exit(1);
}
console.log('');
console.log('架构铁律全部通过（未豁免违规 0 条）⇒ 退出码 0');
