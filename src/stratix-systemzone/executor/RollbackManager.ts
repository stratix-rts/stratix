// ============================================
// RollbackManager.ts - 回滚管理器
// Phase 2: 快照与回滚管理
// ============================================

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { RollbackConfig, DEFAULT_ROLLBACK_CONFIG } from './types';

const execAsync = promisify(exec);

export interface Snapshot {
  id: string;
  proposalId: string;
  commitHash: string;
  timestamp: Date;
  description: string;
  workDir: string;
}

export interface RollbackError extends Error {
  code: 'SNAPSHOT_NOT_FOUND' | 'SNAPSHOT_EXISTS' | 'GIT_ERROR' | 'MAX_SNAPSHOTS' | 'DB_ERROR' | 'INVALID_WORKDIR';
}

/**
 * 快照记录（数据库存储格式）
 */
interface SnapshotRecord {
  id: string;
  proposal_id: string;
  commit_hash: string;
  timestamp: number;
  description: string;
  work_dir: string;
}

export class RollbackManager {
  private config: RollbackConfig;
  private db: Database.Database | null = null;

  constructor(config?: Partial<RollbackConfig>, db?: Database.Database) {
    this.config = {
      maxSnapshots: config?.maxSnapshots ?? DEFAULT_ROLLBACK_CONFIG.maxSnapshots,
      autoRollbackOnTestFail: config?.autoRollbackOnTestFail ?? DEFAULT_ROLLBACK_CONFIG.autoRollbackOnTestFail,
      requireManualRollback: config?.requireManualRollback ?? DEFAULT_ROLLBACK_CONFIG.requireManualRollback,
    };
    if (db) {
      this.db = db;
      this.ensureSnapshotsTable();
    }
  }

  /**
   * 设置数据库实例（用于测试或外部注入）
   */
  setDatabase(db: Database.Database): void {
    this.db = db;
    this.ensureSnapshotsTable();
  }

  /**
   * 初始化数据库连接
   */
  private getDb(): Database.Database {
    if (!this.db) {
      throw new Error('Database not set. Call setDatabase() or pass database in constructor.');
    }
    return this.db;
  }

  /**
   * 确保快照表存在
   */
  private ensureSnapshotsTable(): void {
    const db = this.db!;
    db.exec(`
      CREATE TABLE IF NOT EXISTS rollback_snapshots (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        commit_hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        description TEXT,
        work_dir TEXT NOT NULL
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_snapshots_proposal ON rollback_snapshots(proposal_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON rollback_snapshots(timestamp DESC)');
  }

  /**
   * 创建快照
   * 使用 git stash 保存当前状态，并记录 commit hash 用于回滚
   * @param proposalId - 提案 ID
   * @param workDir - 工作目录
   * @param description - 快照描述
   * @returns 创建的快照
   */
  async createSnapshot(proposalId: string, workDir: string, description?: string): Promise<Snapshot> {
    // 验证工作目录存在
    try {
      await fs.access(workDir);
    } catch {
      const error = new Error(`Work directory does not exist: ${workDir}`) as RollbackError;
      error.code = 'INVALID_WORKDIR';
      throw error;
    }

    // 获取当前 commit hash
    let commitHash: string;
    try {
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workDir });
      commitHash = stdout.trim();
    } catch (err) {
      const error = new Error(`Failed to get commit hash: ${(err as Error).message}`) as RollbackError;
      error.code = 'GIT_ERROR';
      throw error;
    }

    // 执行 git stash
    try {
      await execAsync('git stash push -m "snapshot-' + proposalId + '-' + Date.now() + '"', { cwd: workDir });
    } catch (err) {
      // stash 可能失败（没有更改），这不是错误
      const errMsg = (err as Error).message;
      if (!errMsg.includes('No local changes') && !errMsg.includes('nothing to stash')) {
        const error = new Error(`Failed to stash changes: ${errMsg}`) as RollbackError;
        error.code = 'GIT_ERROR';
        throw error;
      }
    }

    // 创建快照记录
    const snapshot: Snapshot = {
      id: `snap-${randomUUID().slice(0, 12)}`,
      proposalId,
      commitHash,
      timestamp: new Date(),
      description: description ?? `Snapshot for proposal ${proposalId}`,
      workDir,
    };

    // 保存到数据库
    this.saveSnapshotToDb(snapshot);

    return snapshot;
  }

  /**
   * 保存快照到数据库
   */
  private saveSnapshotToDb(snapshot: Snapshot): void {
    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO rollback_snapshots (id, proposal_id, commit_hash, timestamp, description, work_dir)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      snapshot.id,
      snapshot.proposalId,
      snapshot.commitHash,
      snapshot.timestamp.getTime(),
      snapshot.description,
      snapshot.workDir
    );
  }

  /**
   * 恢复快照
   * @param snapshotId - 快照 ID
   */
  async restoreSnapshot(snapshotId: string): Promise<void> {
    const snapshot = this.getSnapshotById(snapshotId);
    if (!snapshot) {
      const error = new Error(`Snapshot not found: ${snapshotId}`) as RollbackError;
      error.code = 'SNAPSHOT_NOT_FOUND';
      throw error;
    }

    const workDir = snapshot.workDir;

    // 验证工作目录
    try {
      await fs.access(workDir);
    } catch {
      const error = new Error(`Work directory does not exist: ${workDir}`) as RollbackError;
      error.code = 'INVALID_WORKDIR';
      throw error;
    }

    // 尝试恢复 git stash
    try {
      // 先尝试 pop stash（会恢复并删除 stash）
      await execAsync(`git stash pop`, { cwd: workDir });
    } catch {
      // 如果没有 stash，尝试 reset 到指定 commit
      try {
        await execAsync(`git reset --hard ${snapshot.commitHash}`, { cwd: workDir });
      } catch (resetErr) {
        const error = new Error(`Failed to restore snapshot: ${(resetErr as Error).message}`) as RollbackError;
        error.code = 'GIT_ERROR';
        throw error;
      }
    }
  }

  /**
   * 根据 ID 获取快照
   */
  private getSnapshotById(snapshotId: string): Snapshot | null {
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM rollback_snapshots WHERE id = ?');
    const row = stmt.get(snapshotId) as SnapshotRecord | undefined;
    return row ? this.recordToSnapshot(row) : null;
  }

  /**
   * 列出所有快照
   * @returns 快照列表（按时间倒序）
   */
  listSnapshots(): Snapshot[] {
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM rollback_snapshots ORDER BY timestamp DESC');
    const rows = stmt.all() as SnapshotRecord[];
    return rows.map((row) => this.recordToSnapshot(row));
  }

  /**
   * 清理过期快照
   * 保留最近 N 个快照（由 maxSnapshots 配置决定）
   * @returns 清理的快照数量
   */
  async cleanupOldSnapshots(): Promise<number> {
    const db = this.getDb();

    // 获取所有快照（按时间倒序）
    const stmt = db.prepare('SELECT * FROM rollback_snapshots ORDER BY timestamp DESC');
    const rows = stmt.all() as SnapshotRecord[];

    if (rows.length <= this.config.maxSnapshots) {
      return 0;
    }

    // 删除超出限制的旧快照
    const toDelete = rows.slice(this.config.maxSnapshots);
    const deleteStmt = db.prepare('DELETE FROM rollback_snapshots WHERE id = ?');

    let deletedCount = 0;
    for (const record of toDelete) {
      try {
        // 清理对应的 git stash（如果存在）
        await this.cleanupGitStash(record.proposal_id, record.work_dir);
        deleteStmt.run(record.id);
        deletedCount++;
      } catch {
        // 即使 stash 清理失败，也删除数据库记录
        deleteStmt.run(record.id);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * 清理与提案关联的 git stash
   */
  private async cleanupGitStash(proposalId: string, workDir: string): Promise<void> {
    try {
      // 列出所有 stash
      const { stdout } = await execAsync('git stash list', { cwd: workDir });
      const stashEntries = stdout.split('\n').filter((line) => line.includes(`snapshot-${proposalId}`));

      for (const entry of stashEntries) {
        // 解析 stash@{n} 格式
        const match = entry.match(/stash@\{(\d+)\}/);
        if (match) {
          try {
            await execAsync(`git stash drop stash@{${match[1]}}`, { cwd: workDir });
          } catch {
            // 忽略单个 stash 删除失败
          }
        }
      }
    } catch {
      // git stash list 可能失败，忽略
    }
  }

  /**
   * 获取提案关联的最新快照
   * @param proposalId - 提案 ID
   * @returns 最新快照，如果不存在返回 null
   */
  getSnapshotForProposal(proposalId: string): Snapshot | null {
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM rollback_snapshots WHERE proposal_id = ? ORDER BY timestamp DESC LIMIT 1');
    const row = stmt.get(proposalId) as SnapshotRecord | undefined;
    return row ? this.recordToSnapshot(row) : null;
  }

  /**
   * 将数据库记录转换为 Snapshot 对象
   */
  private recordToSnapshot(row: SnapshotRecord): Snapshot {
    return {
      id: row.id,
      proposalId: row.proposal_id,
      commitHash: row.commit_hash,
      timestamp: new Date(row.timestamp),
      description: row.description ?? '',
      workDir: row.work_dir,
    };
  }

  /**
   * 删除指定快照
   * @param snapshotId - 快照 ID
   */
  async deleteSnapshot(snapshotId: string): Promise<void> {
    const snapshot = this.getSnapshotById(snapshotId);
    if (!snapshot) {
      const error = new Error(`Snapshot not found: ${snapshotId}`) as RollbackError;
      error.code = 'SNAPSHOT_NOT_FOUND';
      throw error;
    }

    const db = this.getDb();
    const stmt = db.prepare('DELETE FROM rollback_snapshots WHERE id = ?');
    stmt.run(snapshotId);

    // 尝试清理对应的 git stash
    await this.cleanupGitStash(snapshot.proposalId, snapshot.workDir);
  }

  /**
   * 获取快照数量
   */
  getSnapshotCount(): number {
    const db = this.getDb();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM rollback_snapshots');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * 获取配置
   */
  getConfig(): RollbackConfig {
    return { ...this.config };
  }

  /**
   * 清除所有快照（用于测试）
   */
  clearAllSnapshots(): void {
    const db = this.getDb();
    db.exec('DELETE FROM rollback_snapshots');
  }
}
