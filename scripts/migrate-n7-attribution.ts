#!/usr/bin/env tsx
/**
 * 脚本职责：**N7 一次性归属迁移**的命令行入口（@since v3.3，task_203 / M2-06）——
 *   「把默认沙盒的 N 条任务 / M 个角色 / K 个会话归入某项目」：**带预览**、**显式可撤销**。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.3.2 步 **N7**
 *   （带预览 + 必须先完成目标 instance 的 N6 物化 + 显式可撤销）。
 *
 * 用法：
 *   npx tsx scripts/migrate-n7-attribution.ts preview  --data-dir stratix-data --target wsp_x
 *   npx tsx scripts/migrate-n7-attribution.ts migrate  --data-dir stratix-data --target wsp_x --confirm
 *   npx tsx scripts/migrate-n7-attribution.ts rollback --data-dir stratix-data --target wsp_x --confirm
 *
 * ============ 为什么「带预览」是硬要求 ============
 *   N7 是一次性、**不可忽略**的归属变更（把一整批行改到另一个副本）⇒
 *   **先列出将迁移什么，再由人确认**：
 *   - `preview` 子命令（或 `migrate` 不带 `--confirm`）只出清单，**一个字节都不改**；
 *   - `migrate --confirm` 才真的出手（出手前自动备份库文件）。
 *
 * ⚠️ 前置：目标副本**必须先完成 N6 物化**（否则迁过去的是无 `role_id` 的孤儿行）——
 *   未物化时本脚本直接拒绝执行（不是警告）。
 */

import * as fs from 'fs';
import * as path from 'path';

import { Database } from '../src/stratix-database/sqlite-adapter';

import {
  AttributionBlockedError,
  executeInstanceAttribution,
  previewInstanceAttribution,
  previewInstanceAttributionRollback,
  rollbackInstanceAttribution,
  type AttributionPreview,
} from '../src/app/services/persistence/instance-attribution-migration';

/** 子命令。 */
type Command = 'preview' | 'migrate' | 'rollback';

/** 解析后的参数。 */
interface ParsedArgs {
  readonly command: Command;
  readonly dataDir: string;
  readonly filename: string | undefined;
  readonly targetInstanceId: string | undefined;
  readonly sourceInstanceId: string | undefined;
  readonly confirm: boolean;
}

/** 打印用法。 */
function usage(): void {
  console.error(
    '用法：npx tsx scripts/migrate-n7-attribution.ts <preview|migrate|rollback> --data-dir <dir> --target <instanceId> [--source <instanceId>] [--confirm]'
  );
}

/** 解析命令行参数（用法错误 ⇒ 退出码 2）。 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const args = [...argv];
  const first = args.shift();
  const command = (first === 'migrate' || first === 'rollback' || first === 'preview'
    ? first
    : undefined) as Command | undefined;
  if (command === undefined) {
    console.error(`未知子命令：${first ?? '(空)'}`);
    usage();
    process.exit(2);
  }

  let dataDir = 'stratix-data';
  let filename: string | undefined;
  let targetInstanceId: string | undefined;
  let sourceInstanceId: string | undefined;
  let confirm = false;

  while (args.length > 0) {
    const arg = args.shift() as string;
    switch (arg) {
      case '--data-dir':
        dataDir = args.shift() as string;
        break;
      case '--filename':
        filename = args.shift();
        break;
      case '--target':
        targetInstanceId = args.shift();
        break;
      case '--source':
        sourceInstanceId = args.shift();
        break;
      case '--confirm':
        confirm = true;
        break;
      default:
        console.error(`未知参数：${arg}`);
        usage();
        process.exit(2);
    }
  }

  if (!targetInstanceId) {
    console.error('缺 --target <instanceId>（要迁进哪个副本）');
    usage();
    process.exit(2);
  }

  return { command, dataDir, filename, targetInstanceId, sourceInstanceId, confirm };
}

/** 库文件路径（与 StratixDatabase 的口径一致：`<dataDir>/<filename>.sqlite`）。 */
function resolveDatabasePath(options: { dataDir: string; filename?: string }): string {
  return path.join(options.dataDir, `${options.filename ?? 'stratix.db'}.sqlite`);
}

/** 备份库文件（+ WAL / SHM 边车）到 `<dataDir>/backups/n7-<时间戳>/`。 */
function backupDatabase(dbPath: string, dataDir: string): string | null {
  if (!fs.existsSync(dbPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dataDir, 'backups', `n7-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${dbPath}${suffix}`;
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(backupDir, path.basename(source)));
    }
  }
  return backupDir;
}

/** 打印预览清单（人读）。 */
export function printPreview(preview: AttributionPreview): void {
  console.log(`源副本：${preview.sourceInstanceId}　→　目标副本：${preview.targetInstanceId}`);
  console.log(
    `目标副本已物化：${preview.targetMaterialized ? '是' : '否'}（角色行 ${preview.targetCharacterCount} 行）`
  );
  console.log('');
  console.log('将迁移的三类对象：');
  console.log(
    `  · 角色 ${preview.counts.characters} 行 · 任务 ${preview.counts.tasks} 行 · 会话 ${preview.counts.sessions} 行`
  );
  console.log(
    `  · 外部凭据 ${preview.counts.externalRefs} 行 · 跟随行 ${preview.counts.unitPositions + preview.counts.expEvents + preview.counts.sessionEvents} 行（站位 ${preview.counts.unitPositions} / 经验 ${preview.counts.expEvents} / 会话事件 ${preview.counts.sessionEvents}）`
  );
  console.log(`  · 合计 ${preview.counts.total} 行`);

  if (preview.characters.length > 0) {
    console.log('');
    console.log('角色明细：');
    for (const row of preview.characters) {
      console.log(
        `  · ${row.id}　${row.name}　role_id=${row.roleId ?? '（无）'}　等级 ${row.level}　原归属 ${row.originalInstanceId ?? 'NULL'}`
      );
    }
  }
  if (preview.tasks.length > 0) {
    console.log('');
    console.log('任务明细：');
    for (const row of preview.tasks) {
      console.log(`  · ${row.id}　角色 ${row.characterId}　状态 ${row.status}`);
    }
  }
  if (preview.sessions.length > 0) {
    console.log('');
    console.log('会话明细：');
    for (const row of preview.sessions) {
      console.log(`  · ${row.id}　${row.kind}　${row.title}　状态 ${row.status}`);
    }
  }
  if (preview.externalRefs.length > 0) {
    console.log('');
    console.log('外部会话凭据明细：');
    for (const row of preview.externalRefs) {
      console.log(`  · ${row.externalSessionId}　角色 ${row.characterId ?? '（无）'}　会话 ${row.sessionId ?? '（无）'}`);
    }
  }
  if (preview.truncated) {
    console.log('');
    console.log('（明细超过上限已截断；计数是全量）');
  }
  if (preview.warnings.length > 0) {
    console.log('');
    console.log('告警：');
    for (const warning of preview.warnings) console.log(`  · ${warning}`);
  }
  if (preview.blockers.length > 0) {
    console.log('');
    console.log('阻断项（不解决就不许执行）：');
    for (const blocker of preview.blockers) console.log(`  · ${blocker}`);
  }
}

/** 脚本主体（导出以便测试复用同一入口）。 */
export async function main(argv: readonly string[]): Promise<number> {
  const { command, dataDir, filename, targetInstanceId, sourceInstanceId, confirm } = parseArgs(argv);
  const dbPath = resolveDatabasePath({ dataDir, filename });

  if (!fs.existsSync(dbPath)) {
    console.error(`找不到库文件：${dbPath}`);
    return 1;
  }

  const db = new Database(dbPath);
  await db.initialize();
  // 只读路径（预览 / 被阻断）⇒ 关库时**跳过落盘**（「预览一个字节都不落库」在 CLI 层也成立）。
  let mutated = false;

  try {
    const options = {
      targetInstanceId: targetInstanceId as string,
      ...(sourceInstanceId !== undefined ? { sourceInstanceId } : {}),
    };

    if (command === 'rollback') {
      if (!confirm) {
        console.log('=== N7 撤销（预览）===');
        const preview = previewInstanceAttributionRollback(db, options);
        console.log(
          `撤销会把该目标副本下 N7 迁进来的行**反向 UPDATE** 回源副本：共 ${preview.total} 行`
        );
        console.log(
          `  · 角色 ${preview.counts.characters} · 任务 ${preview.counts.tasks} · 会话 ${preview.counts.sessions} · 外部凭据 ${preview.counts.externalRefs} · 跟随行 ${preview.counts.unitPositions + preview.counts.expEvents + preview.counts.sessionEvents}`
        );
        console.log('（不加 --confirm 不出手）');
        return 0;
      }
      const result = rollbackInstanceAttribution(db, options);
      mutated = true;
      console.log(`已撤销 ${result.total} 行（回到迁移前）`);
      return 0;
    }

    console.log('=== N7 一次性归属迁移（预览）===');
    const preview = previewInstanceAttribution(db, options);
    printPreview(preview);

    if (preview.blockers.length > 0) {
      console.log('');
      console.log('⇒ 有阻断项，**不执行**（一个字节都没改）');
      return 1;
    }
    if (command === 'preview') {
      console.log('');
      console.log('（预览模式：没有改动任何数据）');
      return 0;
    }
    if (!confirm) {
      console.log('');
      console.log('⇒ 要真的执行，请加 --confirm（这是带预览的一次性迁移动作）');
      return 1;
    }

    const backupDir = backupDatabase(dbPath, dataDir);
    if (backupDir) console.log(`\n已备份到 ${backupDir}`);

    try {
      const result = executeInstanceAttribution(db, options);
      mutated = true;
      console.log('');
      console.log(
        `迁移完成：角色 ${result.applied.characters} · 任务 ${result.applied.tasks} · 会话 ${result.applied.sessions} · 外部凭据 ${result.applied.externalRefs} · 跟随行 ${result.applied.unitPositions + result.applied.expEvents + result.applied.sessionEvents}（合计 ${result.applied.total} 行）`
      );
      console.log('撤销：npx tsx scripts/migrate-n7-attribution.ts rollback --confirm …');
      return 0;
    } catch (error) {
      if (error instanceof AttributionBlockedError) {
        console.log('');
        console.log(`⇒ 被阻断（没动任何数据）：${error.message}`);
        return 1;
      }
      throw error;
    }
  } finally {
    db.close(!mutated);
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
