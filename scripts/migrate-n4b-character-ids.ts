#!/usr/bin/env tsx
/**
 * 脚本职责：**N4b 一次性 character id 重写**的迁移脚本（六步纪律的执行入口）——
 *   ① 停机窗口 → ② 备份 → ③ 整批重写（单事务 + 同事务写映射）→ ④ 四条校验
 *   → ⑤ 不过即整批回滚 → ⑥ 失败恢复路径。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.3.2「N4b 的迁移验收清单」（R1-41）。
 *
 * 用法：
 *   npx tsx scripts/migrate-n4b-character-ids.ts --data-dir stratix-data --confirm-service-stopped
 *   npx tsx scripts/migrate-n4b-character-ids.ts --data-dir stratix-data --dry-run
 *   npx tsx scripts/migrate-n4b-character-ids.ts rollback --data-dir stratix-data --confirm-service-stopped
 *
 * ⚠️ **本脚本只做「一次性重写」，不改任何业务语义**；执行时机由人决定（本单只交付脚本）。
 * ⚠️ N4b 之后**不支持降级**到 M1 版本（旧版本按旧 id 找角色会找不到 ⇒ 角色全丢），
 *    只支持**前滚回滚**（`rollback` 子命令，靠 character_id_map 反向 UPDATE）。
 */

import {
  runN4bMigration,
  runN4bRollback,
  type N4bMigrationOptions,
} from '../src/app/services/persistence/n4b-migration';

interface ParsedArgs {
  readonly command: 'migrate' | 'rollback';
  readonly options: N4bMigrationOptions;
}

/** 解析命令行参数（用法错误直接退出码 2）。 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const args = [...argv];
  let command: 'migrate' | 'rollback' = 'migrate';
  if (args[0] === 'rollback' || args[0] === 'migrate') {
    command = args.shift() as 'migrate' | 'rollback';
  }
  let dataDir = 'stratix-data';
  let filename: string | undefined;
  let strict = false;
  let dryRun = false;
  let confirmServiceStopped = false;
  const instanceIds: string[] = [];

  while (args.length > 0) {
    const arg = args.shift() as string;
    switch (arg) {
      case '--data-dir':
        dataDir = args.shift() as string;
        break;
      case '--filename':
        filename = args.shift();
        break;
      case '--instance':
        instanceIds.push(args.shift() as string);
        break;
      case '--strict':
        strict = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--confirm-service-stopped':
        confirmServiceStopped = true;
        break;
      default:
        console.error(`未知参数：${arg}`);
        console.error(
          '用法：npx tsx scripts/migrate-n4b-character-ids.ts [--data-dir <dir>] [--filename <name>] [--instance <id>] [--strict] [--dry-run] [--confirm-service-stopped]'
        );
        process.exit(2);
    }
  }

  return {
    command,
    options: {
      dataDir,
      filename,
      strict,
      dryRun,
      confirmServiceStopped,
      instanceIds: instanceIds.length > 0 ? instanceIds : undefined,
    },
  };
}

/** 脚本主体（导出以便演练脚本复用同一入口）。 */
export async function main(argv: readonly string[]): Promise<number> {
  const { command, options } = parseArgs(argv);
  console.log(
    command === 'rollback'
      ? '=== N4b 前滚回滚（反向 UPDATE，靠 character_id_map）==='
      : '=== N4b 一次性 character id 重写（六步纪律）==='
  );
  const result =
    command === 'rollback' ? await runN4bRollback(options) : await runN4bMigration(options);
  console.log('');
  console.log(`结果：${result.status}（重写 ${result.applied} 行）`);
  if (result.reportPath) console.log(`迁移报告：${result.reportPath}`);
  if (result.error) console.log(`原因：${result.error.message}`);
  if (result.recovery.length > 0) {
    console.log('恢复路径：');
    for (const line of result.recovery) console.log(`  · ${line}`);
  }
  const ok =
    result.status === 'succeeded' || result.status === 'no-op' || result.status === 'dry-run';
  return ok ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
