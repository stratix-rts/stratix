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
 *
 * 输入：库目录 --data-dir（默认 stratix-data）+ 库文件名 --filename（默认 stratix.db，不含 .sqlite 后缀）
 *   + 操作选项 --confirm-service-stopped（**必须给**：服务仍写盘时锁文件与提交前指纹守门会拒绝执行）、
 *   --dry-run（只出计划与校验口径，不改数据）、--strict（告警项也判失败）、
 *   --instance（只处理指定副本，缺省 = 全部非默认沙盒副本）；
 *   前置 = 默认沙盒之外的副本行已带 role_id（N6 物化完成），否则整批被阻断。
 * 输出：stdout 的结果行（状态 + 实际重写行数 + 失败原因 + 失败恢复指引）
 *   + 备份目录 <dataDir>/backups/n4b-<时间戳>/（库文件与 WAL / SHM 边车，逐个 sha256 校验）
 *   + 迁移报告 <备份目录>/n4b-report.json；
 *   退出码 0 = succeeded / no-op / dry-run，1 = rolled-back / blocked 或抛错，2 = 用法错误。
 *
 * 禁止事项：
 *   1. 不带 --confirm-service-stopped 就改用户库 —— 运行中的 service 随时把内存里的旧状态
 *      整库写回磁盘，重写成果会被覆盖（角色 id 又变回旧的）；
 *   2. 跳过备份直接改库 —— 备份由编排层在改库前自动完成并校验指纹，本脚本没有「无备份」的路径；
 *   3. 借迁移顺手改业务语义 —— 只重写 id 并同事务写 character_id_map，行内容 / 状态 / 归属一律不动；
 *   4. 把 N4b 当成可降级操作 —— 迁完只支持 rollback 子命令的前滚回滚，不支持回到 M1 版本。
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
