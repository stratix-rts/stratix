// ============================================
// RollbackManager.test.ts - 回滚管理器测试
// Phase 2: 快照与回滚管理
// ============================================

import { RollbackManager } from '../RollbackManager';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import Database from 'better-sqlite3';

const execAsync = promisify(exec);

// 测试数据库路径
const TEST_DB_DIR = '/tmp/stratix-rollback-test';
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test-rollback.sqlite');

// 测试工作目录
const TEST_WORK_DIR = '/tmp/stratix-rollback-workdir-test';

describe('RollbackManager', () => {
  let manager: RollbackManager;
  let db: Database.Database;

  beforeAll(async () => {
    // 创建测试目录
    await fs.mkdir(TEST_DB_DIR, { recursive: true });
    await fs.mkdir(TEST_WORK_DIR, { recursive: true });

    // 初始化 git 仓库
    try {
      await execAsync('git init', { cwd: TEST_WORK_DIR });
      await execAsync('git config user.email "test@test.com"', { cwd: TEST_WORK_DIR });
      await execAsync('git config user.name "Test"', { cwd: TEST_WORK_DIR });
      // 创建初始提交
      await fs.writeFile(path.join(TEST_WORK_DIR, 'README.md'), '# Test\n');
      await execAsync('git add .', { cwd: TEST_WORK_DIR });
      await execAsync('git commit -m "Initial commit"', { cwd: TEST_WORK_DIR });
    } catch (err) {
      console.error('Failed to init git repo:', err);
    }
  });

  beforeEach(() => {
    // 清理并创建新数据库
    db = new Database(TEST_DB_PATH);
    db.exec('DROP TABLE IF EXISTS rollback_snapshots');
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
    db.exec('DELETE FROM rollback_snapshots');

    // 创建新的 RollbackManager 实例，传入数据库
    manager = new RollbackManager(
      {
        maxSnapshots: 5,
        autoRollbackOnTestFail: true,
        requireManualRollback: false,
      },
      db
    );
  });

  afterAll(async () => {
    // 关闭数据库连接
    try {
      db?.close();
    } catch {
      // ignore
    }
    // 清理测试目录
    try {
      await fs.rm(TEST_DB_DIR, { recursive: true, force: true });
      await fs.rm(TEST_WORK_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('constructor', () => {
    test('creates instance with default config', () => {
      const mgr = new RollbackManager();
      expect(mgr).toBeInstanceOf(RollbackManager);
      expect(mgr.getConfig().maxSnapshots).toBe(20); // DEFAULT_ROLLBACK_CONFIG.maxSnapshots
    });

    test('creates instance with custom config', () => {
      const mgr = new RollbackManager({ maxSnapshots: 10 });
      expect(mgr.getConfig().maxSnapshots).toBe(10);
    });

    test('config preserves all fields', () => {
      const mgr = new RollbackManager({
        maxSnapshots: 15,
        autoRollbackOnTestFail: false,
        requireManualRollback: true,
      });
      const config = mgr.getConfig();
      expect(config.maxSnapshots).toBe(15);
      expect(config.autoRollbackOnTestFail).toBe(false);
      expect(config.requireManualRollback).toBe(true);
    });
  });

  describe('createSnapshot', () => {
    test('creates snapshot successfully', async () => {
      const snapshot = await manager.createSnapshot('proposal-1', TEST_WORK_DIR);

      expect(snapshot.id).toMatch(/^snap-/);
      expect(snapshot.proposalId).toBe('proposal-1');
      expect(snapshot.commitHash).toBeTruthy();
      expect(snapshot.timestamp).toBeInstanceOf(Date);
      expect(snapshot.workDir).toBe(TEST_WORK_DIR);
    });

    test('creates snapshot with custom description', async () => {
      const snapshot = await manager.createSnapshot('proposal-2', TEST_WORK_DIR, 'Custom description');

      expect(snapshot.description).toBe('Custom description');
    });

    test('throws error for invalid workDir', async () => {
      await expect(
        manager.createSnapshot('proposal-3', '/nonexistent/path')
      ).rejects.toThrow('Work directory does not exist');
    });

    test('multiple snapshots for same proposal create separate records', async () => {
      await manager.createSnapshot('proposal-same', TEST_WORK_DIR, 'First');
      await manager.createSnapshot('proposal-same', TEST_WORK_DIR, 'Second');
      await manager.createSnapshot('proposal-same', TEST_WORK_DIR, 'Third');

      const snapshots = manager.listSnapshots().filter((s) => s.proposalId === 'proposal-same');
      expect(snapshots.length).toBe(3);
    });
  });

  describe('listSnapshots', () => {
    test('returns empty array when no snapshots exist', () => {
      const snapshots = manager.listSnapshots();
      expect(snapshots).toEqual([]);
    });

    test('returns all snapshots ordered by timestamp desc', async () => {
      await manager.createSnapshot('p1', TEST_WORK_DIR, 'First');
      await new Promise((r) => setTimeout(r, 10));
      await manager.createSnapshot('p2', TEST_WORK_DIR, 'Second');
      await new Promise((r) => setTimeout(r, 10));
      await manager.createSnapshot('p3', TEST_WORK_DIR, 'Third');

      const snapshots = manager.listSnapshots();
      expect(snapshots.length).toBe(3);
      expect(snapshots[0].description).toBe('Third'); // Most recent first
      expect(snapshots[2].description).toBe('First');
    });
  });

  describe('getSnapshotForProposal', () => {
    test('returns null when no snapshot exists for proposal', () => {
      const snapshot = manager.getSnapshotForProposal('nonexistent');
      expect(snapshot).toBeNull();
    });

    test('returns latest snapshot for proposal', async () => {
      await manager.createSnapshot('proposal-latest', TEST_WORK_DIR, 'Older');
      await new Promise((r) => setTimeout(r, 10));
      await manager.createSnapshot('proposal-latest', TEST_WORK_DIR, 'Newer');

      const snapshot = manager.getSnapshotForProposal('proposal-latest');
      expect(snapshot?.description).toBe('Newer');
    });
  });

  describe('cleanupOldSnapshots', () => {
    test('returns 0 when no snapshots exist', async () => {
      const cleaned = await manager.cleanupOldSnapshots();
      expect(cleaned).toBe(0);
    });

    test('returns 0 when snapshots are under limit', async () => {
      await manager.createSnapshot('p1', TEST_WORK_DIR);
      await manager.createSnapshot('p2', TEST_WORK_DIR);
      await manager.createSnapshot('p3', TEST_WORK_DIR);

      const cleaned = await manager.cleanupOldSnapshots();
      expect(cleaned).toBe(0);
      expect(manager.listSnapshots().length).toBe(3);
    });

    test('cleans up old snapshots when over limit', async () => {
      // maxSnapshots = 5 (set in beforeEach)
      for (let i = 0; i < 8; i++) {
        await manager.createSnapshot(`p${i}`, TEST_WORK_DIR);
        await new Promise((r) => setTimeout(r, 5));
      }

      const cleaned = await manager.cleanupOldSnapshots();
      expect(cleaned).toBe(3); // 8 - 5 = 3 removed
      expect(manager.listSnapshots().length).toBe(5);
    });

    test('keeps most recent snapshots after cleanup', async () => {
      for (let i = 0; i < 7; i++) {
        await manager.createSnapshot(`p${i}`, TEST_WORK_DIR, `Snapshot ${i}`);
        await new Promise((r) => setTimeout(r, 5));
      }

      await manager.cleanupOldSnapshots();

      const snapshots = manager.listSnapshots();
      expect(snapshots.length).toBe(5);
      // The 5 most recent should remain (descriptions: 6, 5, 4, 3, 2)
      expect(snapshots[0].description).toBe('Snapshot 6');
      expect(snapshots[4].description).toBe('Snapshot 2');
    });
  });

  describe('deleteSnapshot', () => {
    test('throws error when deleting nonexistent snapshot', async () => {
      await expect(manager.deleteSnapshot('nonexistent-id')).rejects.toThrow('Snapshot not found');
    });

    test('deletes existing snapshot', async () => {
      const snapshot = await manager.createSnapshot('proposal-del', TEST_WORK_DIR);
      await manager.deleteSnapshot(snapshot.id);

      const found = manager.getSnapshotForProposal('proposal-del');
      expect(found).toBeNull();
    });
  });

  describe('getSnapshotCount', () => {
    test('returns 0 when no snapshots', () => {
      expect(manager.getSnapshotCount()).toBe(0);
    });

    test('returns correct count after creating snapshots', async () => {
      await manager.createSnapshot('p1', TEST_WORK_DIR);
      await manager.createSnapshot('p2', TEST_WORK_DIR);
      await manager.createSnapshot('p3', TEST_WORK_DIR);

      expect(manager.getSnapshotCount()).toBe(3);
    });
  });

  describe('clearAllSnapshots', () => {
    test('clears all snapshots', async () => {
      await manager.createSnapshot('p1', TEST_WORK_DIR);
      await manager.createSnapshot('p2', TEST_WORK_DIR);

      manager.clearAllSnapshots();

      expect(manager.listSnapshots()).toEqual([]);
      expect(manager.getSnapshotCount()).toBe(0);
    });
  });
});
