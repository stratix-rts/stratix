#!/usr/bin/env tsx
/**
 * 脚本职责：**N4b 重写结果的独立校验脚本**（四条校验）——
 *   ① `characters` 行数不变；② `unit_positions.character_id` 100% 落在新 `characters.id` 集合内；
 *   ③ `unit_positions` 的 `unit_id` 集合 == `characters.id × PREFIX`；
 *   ④ `character_tasks.character_id` 与 `sessions.participants` 全部可解析可找到。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.3.2「N4b 的迁移验收清单」（R1-41）第 ④ 步。
 *
 * 用法：
 *   npx tsx scripts/verify-n4b-character-ids.ts --data-dir stratix-data
 *   npx tsx scripts/verify-n4b-character-ids.ts --data-dir stratix-data --report <n4b-report.json>
 *
 * why 独立于迁移脚本：迁移是「一次性」动作，事后（换机器 / 恢复备份 / 升级版本）
 *   还要能随时复核库的一致状态 ⇒ 校验不能只活在迁移脚本里。
 *
 * 输入：库目录 --data-dir（默认 stratix-data）+ 库文件名 --filename（默认 stratix.db，不含 .sqlite 后缀）
 *   + --strict（告警项也判失败）+ --report（**读入**迁移报告 n4b-report.json 作基线，
 *   取其中的 characterCountBefore 与 sandboxCharacterIds；不给基线时行数基线无从比对）。
 *   库文件口径 = <dataDir>/<filename>.sqlite。
 * 输出：stdout 的四条校验结果（每条带 ✓/✗/! 标记 + 明细 + 样本）与「校验结果：通过 / 不通过」结论；
 *   本脚本**只判定不改数据**（校验层关库时跳过落盘，不写库、不写文件，--report 只是读基线不是产物路径）。
 *
 * 禁止事项：
 *   1. 在校验里顺手修数据 —— 本脚本只判定（不改 id、不删行、不回滚）；要修走
 *      scripts/migrate-n4b-character-ids.ts；
 *   2. 把「四条全过」当迁移已成功的证明 —— 校验只覆盖四条不变量，角色内容 / 等级 / 会话历史
 *      是否正确不在校验面内；
 *   3. 不传 --report 就断言「行数不变」 —— 行数基线来自迁移报告里的 characterCountBefore，
 *      没有基线时该条只能判「无基线可比」；
 *   4. 对着仍在写盘的 service 校验 —— 库内容随时在变，校验结论不成立（先停服再验）。
 *
 * 退出码：0 = 四条全过；1 = 有 fail；2 = 用法错误。
 */

import { runN4bVerification } from '../src/app/services/persistence/n4b-migration';

interface VerifyArgs {
  readonly dataDir: string;
  readonly filename?: string;
  readonly strict: boolean;
  readonly reportPath?: string;
}

/** 解析命令行参数。 */
export function parseArgs(argv: readonly string[]): VerifyArgs {
  const args = [...argv];
  let dataDir = 'stratix-data';
  let filename: string | undefined;
  let strict = false;
  let reportPath: string | undefined;

  while (args.length > 0) {
    const arg = args.shift() as string;
    switch (arg) {
      case '--data-dir':
        dataDir = args.shift() as string;
        break;
      case '--filename':
        filename = args.shift();
        break;
      case '--report':
        reportPath = args.shift();
        break;
      case '--strict':
        strict = true;
        break;
      default:
        console.error(`未知参数：${arg}`);
        console.error(
          '用法：npx tsx scripts/verify-n4b-character-ids.ts [--data-dir <dir>] [--filename <name>] [--report <n4b-report.json>] [--strict]'
        );
        process.exit(2);
    }
  }
  return { dataDir, filename, strict, reportPath };
}

/** 脚本主体。 */
export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  console.log('=== N4b 重写结果校验（四条）===');
  const result = await runN4bVerification({
    dataDir: args.dataDir,
    filename: args.filename,
    strict: args.strict,
    reportPath: args.reportPath,
  });
  console.log('');
  console.log(result.ok ? '校验结果：通过' : '校验结果：不通过');
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
