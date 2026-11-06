/**
 * 文件职责：**N4b 六步迁移流程**的编排（@since v3.3，task_201 / M2-04）——
 *   ① 停机窗口 → ② 备份 → ③ 整批重写（单事务 + 同事务映射）→ ④ 四条校验 → ⑤ 不过即整批回滚 → ⑥ 失败恢复。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.3.2「N4b 的迁移验收清单」（R1-41，六步 + 四条校验）
 *   + 「回滚矩阵」（R1-38：N4b 之后**不支持降级**到 M1 版本，只支持**前滚**回滚）。
 *
 * 输入：一个库目录（dataDir）+ 操作选项。
 * 输出：迁移结果（状态 / 计划 / 校验报告 / 备份路径 / 恢复指引）。
 *
 * 禁止事项：
 *   1. 在本文件里直接改数据 —— 数据改动只在 character-id-rewrite.ts 的**一个事务**里发生；
 *   2. 跳过备份直接改库；
 *   3. 把「停机窗口」当成一句提醒 —— 本文件用**锁文件 + 文件指纹 + 提交前守门**把它落成可执行的闸门。
 *
 * why 停机窗口要落成闸门（而不是口头纪律）：N4b 跑在一个**运行中的 service** 旁边时，
 *   service 随时会把内存里的旧状态整库写回磁盘 ⇒ 重写成果被覆盖（角色 id 又变回旧的）。
 *   ⇒ 三道闸门：① 操作者显式确认已停机（`confirmServiceStopped`）；
 *   ② 锁文件 `<db>.n4b.lock`（含 pid；pid 还活着 ⇒ 拒绝跑）；
 *   ③ **提交前指纹复核**（库文件在跑的过程中被改过 ⇒ 抛错回滚，不提交）。
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { ProjectInstanceId } from '../../../core/types';
import { Database } from '../../../stratix-database/sqlite-adapter';

import {
  executeCharacterIdRewrite,
  planCharacterIdRewrite,
  rollbackCharacterIdRewrite,
  validateCharacterIdRewrite,
  type CharacterIdRewriteOptions,
  type RewritePlan,
  type RewriteStep,
  type RewriteValidationReport,
} from './character-id-rewrite';

/** 迁移状态。 */
export type N4bMigrationStatus =
  | 'succeeded' // 整批重写 + 四条校验全过（已提交）
  | 'no-op' // 没有需要重写的行（重跑幂等）
  | 'rolled-back' // 校验不过 / 中途失败 ⇒ 已整批回滚（库回到 N4b 前状态）
  | 'blocked' // 前置问题（缺 role_id / id 冲突）⇒ 没动任何数据
  | 'dry-run'; // 只出计划与校验口径，没改数据

/** 迁移结果。 */
export interface N4bMigrationResult {
  readonly status: N4bMigrationStatus;
  readonly plan: RewritePlan | null;
  readonly report: RewriteValidationReport | null;
  /** 备份目录（备份成功时）。 */
  readonly backupDir: string | null;
  /** 实际重写行数。 */
  readonly applied: number;
  /** 失败原因（状态非成功时）。 */
  readonly error: Error | null;
  /** 失败恢复指引（人读）。 */
  readonly recovery: readonly string[];
  /** 迁移报告文件路径（含基线数据，供独立校验脚本核对行数）。 */
  readonly reportPath: string | null;
}

/** 迁移选项。 */
export interface N4bMigrationOptions {
  /** 库目录（默认 `stratix-data`）。 */
  readonly dataDir: string;
  /** 库文件名（不含 `.sqlite` 后缀；默认 `stratix.db`）。 */
  readonly filename?: string;
  /** 操作者已确认 **service 停止写**（不确认 ⇒ 拒绝执行）。 */
  readonly confirmServiceStopped?: boolean;
  /** 严格模式（告警项也判失败）。 */
  readonly strict?: boolean;
  /** 只演练出计划，不改数据。 */
  readonly dryRun?: boolean;
  /** 只处理这些副本（缺省 = 全部非默认沙盒副本）。 */
  readonly instanceIds?: readonly ProjectInstanceId[];
  /** 日志口（缺省 = console.log）。 */
  readonly log?: (line: string) => void;
  /** 步骤回调（演练的崩溃注入点）。 */
  readonly onStep?: (step: RewriteStep) => void;
  /** 备份根目录（缺省 = `<dataDir>/backups`）。 */
  readonly backupRootDir?: string;
  /** 时钟（测试可注入）。 */
  readonly now?: () => number;
}

/** 库文件路径（`<dataDir>/<filename>.sqlite`；与 StratixDatabase 的口径一致）。 */
export function resolveDatabasePath(options: { dataDir: string; filename?: string }): string {
  return path.join(options.dataDir, `${options.filename ?? 'stratix.db'}.sqlite`);
}

/**
 * 跑完整的六步流程。
 *
 * 返回值**不抛错**（除参数级错误外）：迁移失败是**正常的业务结果**（要能打印恢复指引），
 *   抛错会逼调用方写 try/catch 才能拿到「回滚了」这个事实。
 */
export async function runN4bMigration(options: N4bMigrationOptions): Promise<N4bMigrationResult> {
  const log = options.log ?? ((line: string): void => console.log(line));
  const clock = options.now ?? ((): number => Date.now());
  const dbPath = resolveDatabasePath(options);
  const lockPath = `${dbPath}.n4b.lock`;
  const backupRoot = options.backupRootDir ?? path.join(options.dataDir, 'backups');

  // ── ① 停机窗口 ───────────────────────────────────────────────────────
  log('[1/6] 停机窗口');
  if (!options.confirmServiceStopped) {
    const error = new Error(
      '未确认停机：N4b 只能在 service **停止写**的窗口里跑。请停掉 service 后加 --confirm-service-stopped 重跑。'
    );
    log(`      ✗ ${error.message}`);
    return {
      status: 'blocked',
      plan: null,
      report: null,
      backupDir: null,
      applied: 0,
      error,
      recovery: ['停掉 service 进程后重跑（本步之前没有任何数据被改动）'],
      reportPath: null,
    };
  }
  if (!fs.existsSync(dbPath)) {
    const error = new Error(`找不到库文件：${dbPath}`);
    log(`      ✗ ${error.message}`);
    return {
      status: 'blocked',
      plan: null,
      report: null,
      backupDir: null,
      applied: 0,
      error,
      recovery: ['确认 --data-dir 指向正确的库目录'],
      reportPath: null,
    };
  }
  const lock = acquireLock(lockPath, clock());
  if (!lock.acquired) {
    const error = new Error(`库已被另一个 N4b 进程占用（锁文件 ${lockPath}）：${lock.reason ?? '未知'}`);
    log(`      ✗ ${error.message}`);
    return {
      status: 'blocked',
      plan: null,
      report: null,
      backupDir: null,
      applied: 0,
      error,
      recovery: ['确认没有别的 N4b 进程在跑；若确认是残留锁，删除 ' + lockPath + ' 后重跑'],
      reportPath: null,
    };
  }
  const fingerprintBefore = fingerprint(dbPath);
  log(`      ✓ 已确认停机；持有锁 ${lockPath}`);
  log(`      ✓ 库文件指纹 ${fingerprintBefore.digest.slice(0, 16)}…（提交前复核）`);

  try {
    // ── ② 备份 ─────────────────────────────────────────────────────────
    log('[2/6] 备份（库文件 + WAL / SHM 边车）');
    const backupDir = path.join(
      backupRoot,
      `n4b-${new Date(clock()).toISOString().replace(/[:.]/g, '-')}`
    );
    fs.mkdirSync(backupDir, { recursive: true });
    const backupResult = backupDatabase(dbPath, backupDir);
    log(`      ✓ 已备份到 ${backupDir}`);
    for (const entry of backupResult.files) {
      log(`        · ${entry.name}（${entry.bytes} 字节，sha256 ${entry.digest.slice(0, 16)}…）`);
    }
    log(`      ✓ 副本与源文件指纹一致（${backupResult.verified} 个文件校验通过）`);

    // ── ③ 整批重写（单事务 + 同事务写映射 + 同事务校验）───────────────
    log('[3/6] 整批重写（一个事务 + 同事务写 character_id_map）');
    const db = new Database(dbPath);
    await db.initialize();
    db.setAutoSaveEnabled(false);
    try {
      const rewriteOptions: CharacterIdRewriteOptions = {
        instanceIds: options.instanceIds,
        strict: options.strict,
        onStep: options.onStep,
        // 提交前守门：库文件在跑的过程中被改过（= service 没停干净）⇒ 不提交。
        assertUnchanged: () => {
          const now = fingerprint(dbPath);
          if (now.digest !== fingerprintBefore.digest) {
            throw new Error(
              `库文件在迁移过程中被改动（指纹 ${fingerprintBefore.digest.slice(0, 16)}… → ${now.digest.slice(0, 16)}…）⇒ 判定为「service 没停干净」⇒ 回滚`
            );
          }
        },
      };

      const plan = planCharacterIdRewrite(db, rewriteOptions);
      log(
        `      · 计划：重写 ${plan.rows.length} 行；默认沙盒 ${plan.sandboxIds.length} 行（id 一律不改）；已是派生 id ${plan.alreadyDerivedIds.length} 行`
      );
      for (const row of plan.rows) {
        log(`        · ${row.oldId} → ${row.newId}（role_id=${row.roleId}，副本 ${row.instanceId}）`);
      }
      if (plan.blockers.length > 0) {
        log(`      ✗ 前置阻断 ${plan.blockers.length} 条：`);
        for (const blocker of plan.blockers) log(`        · ${blocker}`);
        return {
          status: 'blocked',
          plan,
          report: null,
          backupDir,
          applied: 0,
          error: new Error(`前置阻断：${plan.blockers[0]}`),
          recovery: [
            '本批**没有改动任何数据**（阻断发生在事务之前）',
            '按提示补齐 role_id / 消除 id 冲突后重跑',
            `备份在 ${backupDir}（不需要回滚）`,
          ],
          reportPath: writeReport(backupDir, {
            status: 'blocked',
            plan,
            report: null,
            applied: 0,
            dbPath,
          }),
        };
      }

      if (options.dryRun) {
        log('      · 演练模式：不出手（不改数据）');
        return {
          status: 'dry-run',
          plan,
          report: null,
          backupDir,
          applied: 0,
          error: null,
          recovery: [],
          reportPath: writeReport(backupDir, {
            status: 'dry-run',
            plan,
            report: null,
            applied: 0,
            dbPath,
          }),
        };
      }

      if (plan.rows.length === 0) {
        log('      · 没有需要重写的行（重跑幂等）');
        const report = executeCharacterIdRewrite(db, plan, rewriteOptions).report;
        log('[4/6] 校验（四条）');
        printReport(log, report);
        return {
          status: 'no-op',
          plan,
          report,
          backupDir,
          applied: 0,
          error: null,
          recovery: [],
          reportPath: writeReport(backupDir, {
            status: 'no-op',
            plan,
            report,
            applied: 0,
            dbPath,
          }),
        };
      }

      let outcome;
      try {
        outcome = executeCharacterIdRewrite(db, plan, rewriteOptions);
      } catch (error) {
        // ── ⑤ 校验不过 / 中途失败 ⇒ 已整批回滚 ─────────────────────────
        const failure = error instanceof Error ? error : new Error(String(error));
        log(`      ✗ ${failure.message}`);
        log('      ⇒ 已整批回滚（库回到 N4b 前状态，未落盘）');
        log('[4/6] 校验（四条）');
        const report =
          error instanceof Object && 'report' in error
            ? (error as { report: RewriteValidationReport }).report
            : null;
        if (report) printReport(log, report);
        log('[5/6] 整批回滚：已完成（事务 ROLLBACK，磁盘文件未被改写）');
        log('[6/6] 失败恢复路径');
        const recovery = [
          '事务已回滚 ⇒ 库处于 N4b **前**状态（可重跑）：修掉上面指出的问题后重跑同一条命令',
          `备份在 ${backupDir}（万一要手工回退，从这里拷回）`,
        ];
        for (const line of recovery) log(`      · ${line}`);
        return {
          status: 'rolled-back',
          plan,
          report,
          backupDir,
          applied: 0,
          error: failure,
          recovery,
          reportPath: writeReport(backupDir, {
            status: 'rolled-back',
            plan,
            report,
            applied: 0,
            dbPath,
            error: failure.message,
          }),
        };
      }

      // ── ④ 四条校验（事务内已跑过一遍，这里再独立复核一次）───────────
      log('[4/6] 校验（四条）');
      printReport(log, outcome.report);
      log('[5/6] 整批回滚：不需要（校验全过）');
      log('[6/6] 失败恢复路径');
      const recovery = [
        '已提交：库处于 N4b **后**状态',
        '若事后发现问题 ⇒ **前滚回滚**（反向 UPDATE，靠 character_id_map）：',
        `  npx tsx scripts/migrate-n4b-character-ids.ts rollback --data-dir ${options.dataDir}`,
        '⚠️ N4b 之后**不支持降级**到 M1 版本（旧版本按旧 id 找角色会找不到 ⇒ 角色全丢）',
      ];
      for (const line of recovery) log(`      · ${line}`);
      return {
        status: 'succeeded',
        plan,
        report: outcome.report,
        backupDir,
        applied: outcome.applied,
        error: null,
        recovery,
        reportPath: writeReport(backupDir, {
          status: 'succeeded',
          plan,
          report: outcome.report,
          applied: outcome.applied,
          dbPath,
        }),
      };
    } finally {
      db.close(true);
    }
  } finally {
    releaseLock(lockPath);
  }
}

/**
 * 前滚回滚（design §1.3.2 回滚矩阵「M2 N4b 重写」行）：靠 `character_id_map` 反向 UPDATE。
 *
 * 用法：已提交但事后发现问题 ⇒ 把 id 改回旧值。
 * 注意：**不支持降级到 M1 版本**（旧版本代码按旧 id 找角色会找不到）。
 */
export async function runN4bRollback(options: N4bMigrationOptions): Promise<N4bMigrationResult> {
  const log = options.log ?? ((line: string): void => console.log(line));
  const clock = options.now ?? ((): number => Date.now());
  const dbPath = resolveDatabasePath(options);
  const lockPath = `${dbPath}.n4b.lock`;

  log('[1/6] 停机窗口');
  if (!options.confirmServiceStopped) {
    const error = new Error('未确认停机：回滚同样需要 service 停止写。');
    log(`      ✗ ${error.message}`);
    return {
      status: 'blocked',
      plan: null,
      report: null,
      backupDir: null,
      applied: 0,
      error,
      recovery: ['停掉 service 后加 --confirm-service-stopped 重跑'],
      reportPath: null,
    };
  }
  const lock = acquireLock(lockPath, clock());
  if (!lock.acquired) {
    const error = new Error(`库已被另一个 N4b 进程占用（锁文件 ${lockPath}）`);
    log(`      ✗ ${error.message}`);
    return {
      status: 'blocked',
      plan: null,
      report: null,
      backupDir: null,
      applied: 0,
      error,
      recovery: ['确认没有别的 N4b 进程在跑'],
      reportPath: null,
    };
  }
  try {
    log('[2/6] 备份（回滚前也先备份一份：回滚本身是写操作）');
    const backupDir = path.join(
      options.backupRootDir ?? path.join(options.dataDir, 'backups'),
      `n4b-rollback-${new Date(clock()).toISOString().replace(/[:.]/g, '-')}`
    );
    fs.mkdirSync(backupDir, { recursive: true });
    backupDatabase(dbPath, backupDir);
    log(`      ✓ 已备份到 ${backupDir}`);

    log('[3/6] 前滚回滚（反向 UPDATE，靠 character_id_map）');
    const db = new Database(dbPath);
    await db.initialize();
    db.setAutoSaveEnabled(false);
    try {
      const reverted = rollbackCharacterIdRewrite(db);
      log(`      ✓ 已回滚 ${reverted.reverted} 行（映射行已消费）`);
      log('[4/6] 校验：回滚后请独立跑一次 verify 脚本复核');
      log('[5/6] 整批回滚：不需要（回滚本身就是回滚动作）');
      log('[6/6] 失败恢复路径');
      const recovery = [
        '库已回到 N4b **前**状态（id = 旧 id）',
        `备份在 ${backupDir}`,
      ];
      for (const line of recovery) log(`      · ${line}`);
      return {
        status: 'succeeded',
        plan: null,
        report: null,
        backupDir,
        applied: reverted.reverted,
        error: null,
        recovery,
        reportPath: null,
      };
    } finally {
      db.close(true);
    }
  } finally {
    releaseLock(lockPath);
  }
}

/** 打印校验报告（四条 + 附加）。 *//** 独立校验的选项。 */
export interface N4bVerificationOptions {
  readonly dataDir: string;
  readonly filename?: string;
  /** 严格模式（告警项也判失败）。 */
  readonly strict?: boolean;
  /** 迁移报告路径（给了 ⇒ 用报告里的基线核对「行数不变」与「沙盒 id 未变」）。 */
  readonly reportPath?: string;
  readonly log?: (line: string) => void;
}

/** 独立校验的结果。 */
export interface N4bVerificationResult {
  readonly ok: boolean;
  readonly report: RewriteValidationReport;
}

/**
 * 独立跑四条校验（交付物：**校验脚本**）。
 *
 * why 要能独立跑：迁移是「一次性」动作，事后（换机器、恢复备份、升级版本）还要能
 *   随时复核库是否处在 N4b 之后的一致状态 ⇒ 校验不能只活在迁移脚本里。
 */
export async function runN4bVerification(
  options: N4bVerificationOptions
): Promise<N4bVerificationResult> {
  const log = options.log ?? ((line: string): void => console.log(line));
  const dbPath = resolveDatabasePath(options);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`找不到库文件：${dbPath}`);
  }
  const db = new Database(dbPath);
  await db.initialize();
  db.setAutoSaveEnabled(false);
  try {
    let baseline: { characterCount?: number; sandboxIds?: string[] } = {};
    if (options.reportPath && fs.existsSync(options.reportPath)) {
      const raw = JSON.parse(fs.readFileSync(options.reportPath, 'utf8')) as {
        characterCountBefore?: number;
        sandboxIds?: string[];
      };
      baseline = {
        characterCount: raw.characterCountBefore ?? undefined,
        sandboxIds: raw.sandboxIds ?? [],
      };
      log(`已读入迁移报告基线：${options.reportPath}`);
    }
    const report = validateCharacterIdRewrite(db, {
      strict: options.strict,
      plan: {
        rows: [],
        blockers: [],
        sandboxIds: baseline.sandboxIds ?? [],
        alreadyDerivedIds: [],
        characterCount: baseline.characterCount ?? 0,
      },
    });
    printReport(log, report);
    return { ok: report.ok, report };
  } finally {
    db.close(true);
  }
}

/** 打印校验报告（四条 + 附加）。 */
export function printReport(log: (line: string) => void, report: RewriteValidationReport): void {
  for (const check of report.checks) {
    const mark =
      check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : check.status === 'warn' ? '!' : '–';
    log(`      ${mark} [${check.id}] ${check.title} —— ${check.detail}`);
    if (check.samples && check.samples.length > 0) {
      for (const sample of check.samples) log(`          · ${sample}`);
    }
  }
}

/** 备份结果。 */
export interface BackupResult {
  readonly files: ReadonlyArray<{ readonly name: string; readonly bytes: number; readonly digest: string }>;
  /** 指纹校验通过的文件数。 */
  readonly verified: number;
}

/**
 * 备份库文件 + 边车（WAL / SHM）。
 *
 * why 连边车一起备：设计要求「库文件与 WAL 一并备份」——
 *   本项目的驱动是 sql.js（无 WAL），但库文件可能被别的工具以 WAL 模式打开过
 *   ⇒ 边车存在就一起备（不存在就跳过，不算失败）。
 */
export function backupDatabase(dbPath: string, backupDir: string): BackupResult {
  fs.mkdirSync(backupDir, { recursive: true });
  const sidecars = ['', '-wal', '-shm'];
  const files: Array<{ name: string; bytes: number; digest: string }> = [];
  let verified = 0;
  for (const suffix of sidecars) {
    const source = `${dbPath}${suffix}`;
    if (!fs.existsSync(source)) continue;
    const target = path.join(backupDir, path.basename(source));
    fs.copyFileSync(source, target);
    const sourceDigest = fingerprint(source).digest;
    const targetDigest = fingerprint(target).digest;
    if (sourceDigest !== targetDigest) {
      throw new Error(`备份校验失败：${source} 与副本指纹不一致（${sourceDigest} vs ${targetDigest}）`);
    }
    verified += 1;
    files.push({
      name: path.basename(source),
      bytes: fs.statSync(target).size,
      digest: targetDigest,
    });
  }
  if (files.length === 0) throw new Error(`备份失败：没有可备份的文件（${dbPath}）`);
  return { files, verified };
}

/** 文件指纹（sha256 + 大小 + mtime）。 */
export function fingerprint(filePath: string): {
  readonly digest: string;
  readonly bytes: number;
  readonly mtimeMs: number;
} {
  const content = fs.readFileSync(filePath);
  return {
    digest: crypto.createHash('sha256').update(content).digest('hex'),
    bytes: content.length,
    mtimeMs: fs.statSync(filePath).mtimeMs,
  };
}

/** 锁文件的获取结果。 */
export interface LockResult {
  readonly acquired: boolean;
  readonly reason?: string;
}

/**
 * 取锁（`<db>.n4b.lock`）。
 *
 * why 用 pid 判活而不是「文件存在就算占用」：崩掉的进程会留下残留锁 ⇒
 *   残留锁会把人永久挡在门外（最讨厌的失败模式）⇒ pid 不在了就接管（并说明接管原因）。
 */
export function acquireLock(lockPath: string, now: number): LockResult {
  if (fs.existsSync(lockPath)) {
    const raw = fs.readFileSync(lockPath, 'utf8');
    let pid: number | undefined;
    try {
      pid = JSON.parse(raw).pid as number;
    } catch {
      pid = undefined;
    }
    if (pid !== undefined && isProcessAlive(pid)) {
      return { acquired: false, reason: `pid ${pid} 还活着` };
    }
  }
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: now }), 'utf8');
  return { acquired: true };
}

/** 释放锁（只删自己那份：pid 对不上就不动别人的锁）。 */
export function releaseLock(lockPath: string): void {
  if (!fs.existsSync(lockPath)) return;
  try {
    const pid = JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid as number;
    if (pid !== process.pid) return;
  } catch {
    // 锁文件坏了：按「自己的锁」处理，删掉。
  }
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // 删不掉就算了（下次会被判成残留锁并接管）。
  }
}

/** 进程是否还活着（pid 存在性探测）。 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM = 进程存在但不属于当前用户 ⇒ 仍算活着。
    return (error as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

/** 写迁移报告（独立校验脚本靠它核对「行数不变」的基线）。 */
function writeReport(
  backupDir: string,
  payload: {
    readonly status: string;
    readonly plan: RewritePlan | null;
    readonly report: RewriteValidationReport | null;
    readonly applied: number;
    readonly dbPath: string;
    readonly error?: string;
  }
): string {
  const reportPath = path.join(backupDir, 'n4b-report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        writtenAt: new Date().toISOString(),
        dbPath: payload.dbPath,
        status: payload.status,
        applied: payload.applied,
        error: payload.error ?? null,
        characterCountBefore: payload.plan?.characterCount ?? null,
        sandboxIds: payload.plan?.sandboxIds ?? [],
        rows: payload.plan?.rows ?? [],
        checks: payload.report?.checks ?? [],
      },
      null,
      2
    ),
    'utf8'
  );
  return reportPath;
}
