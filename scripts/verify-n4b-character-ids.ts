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
