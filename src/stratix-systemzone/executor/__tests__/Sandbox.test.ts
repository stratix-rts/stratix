// ============================================
// Sandbox.test.ts - 沙箱执行器测试
// Phase 2: Git Worktree 隔离执行
// ============================================

import { Sandbox, SandboxError } from '../Sandbox';
import { SandboxConfig } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('Sandbox', () => {
  const testWorktreeDir = '/tmp/stratix-sandbox-test';
  const stratixRepoPath = '/Users/kingj/code/Stratix';
  const testConfig: Partial<SandboxConfig> = {
    worktreeBaseDir: testWorktreeDir,
    repoPath: stratixRepoPath,
    maxConcurrentSandboxes: 3,
    autoCleanup: false,
    defaultTimeout: 5000,
  };

  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = new Sandbox(testConfig);
    // Clean up test directory before each test
    try {
      await fs.rm(testWorktreeDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    await fs.mkdir(testWorktreeDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up all sandboxes
    await sandbox.destroyAllSandboxes();
    // Clean up test directory
    try {
      await fs.rm(testWorktreeDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('constructor', () => {
    test('creates instance with default config', () => {
      const s = new Sandbox();
      expect(s).toBeInstanceOf(Sandbox);
      expect(s.getConfig().worktreeBaseDir).toBe('/tmp/stratix-sandbox');
      expect(s.getConfig().maxConcurrentSandboxes).toBe(3);
      expect(s.getConfig().autoCleanup).toBe(true);
    });

    test('creates instance with custom config', () => {
      const s = new Sandbox({
        worktreeBaseDir: '/custom/path',
        maxConcurrentSandboxes: 5,
        autoCleanup: false,
        defaultTimeout: 10000,
      });
      const config = s.getConfig();
      expect(config.worktreeBaseDir).toBe('/custom/path');
      expect(config.maxConcurrentSandboxes).toBe(5);
      expect(config.autoCleanup).toBe(false);
      expect(config.defaultTimeout).toBe(10000);
    });
  });

  describe('createSandbox', () => {
    test('creates a new worktree for proposal', async () => {
      const proposalId = 'proposal-1';
      const worktreePath = await sandbox.createSandbox(proposalId);

      expect(worktreePath).toBeDefined();
      expect(worktreePath).toContain('proposal-1');
      expect(sandbox.getSandboxPath(proposalId)).toBe(worktreePath);
    });

    test('creates worktree directory', async () => {
      const proposalId = 'proposal-2';
      const worktreePath = await sandbox.createSandbox(proposalId);

      const exists = await fs.access(worktreePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    test('creates isolated git worktree', async () => {
      const proposalId = 'proposal-3';
      const worktreePath = await sandbox.createSandbox(proposalId);

      // Check it's a valid git worktree
      const { stdout } = await execAsync('git worktree list', { cwd: worktreePath });
      expect(stdout).toContain(worktreePath);
    });

    test('throws SANDBOX_EXISTS when sandbox already exists', async () => {
      const proposalId = 'proposal-dup';
      await sandbox.createSandbox(proposalId);

      await expect(sandbox.createSandbox(proposalId)).rejects.toMatchObject({
        code: 'SANDBOX_EXISTS',
      });
    });

    test('throws MAX_CONCURRENT when limit reached', async () => {
      // Create 3 sandboxes (max is 3)
      await sandbox.createSandbox('p-1');
      await sandbox.createSandbox('p-2');
      await sandbox.createSandbox('p-3');

      await expect(sandbox.createSandbox('p-4')).rejects.toMatchObject({
        code: 'MAX_CONCURRENT',
      });
    });

    test('increments active count after creation', async () => {
      expect(sandbox.getActiveCount()).toBe(0);

      await sandbox.createSandbox('p-count-1');
      expect(sandbox.getActiveCount()).toBe(1);

      await sandbox.createSandbox('p-count-2');
      expect(sandbox.getActiveCount()).toBe(2);
    });
  });

  describe('destroySandbox', () => {
    test('removes worktree and cleans up', async () => {
      const proposalId = 'proposal-destroy';
      const worktreePath = await sandbox.createSandbox(proposalId);

      await sandbox.destroySandbox(proposalId);

      expect(sandbox.getSandboxPath(proposalId)).toBeNull();
      expect(sandbox.listActiveSandboxes()).not.toContain(proposalId);

      const exists = await fs.access(worktreePath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    test('throws SANDBOX_NOT_FOUND for unknown proposal', async () => {
      await expect(sandbox.destroySandbox('unknown-proposal')).rejects.toMatchObject({
        code: 'SANDBOX_NOT_FOUND',
      });
    });

    test('decrements active count after destruction', async () => {
      await sandbox.createSandbox('p-destroy-count');
      expect(sandbox.getActiveCount()).toBe(1);

      await sandbox.destroySandbox('p-destroy-count');
      expect(sandbox.getActiveCount()).toBe(0);
    });

    test('can recreate sandbox after destroy', async () => {
      const proposalId = 'proposal-recreate';
      await sandbox.createSandbox(proposalId);
      await sandbox.destroySandbox(proposalId);

      const newPath = await sandbox.createSandbox(proposalId);
      expect(newPath).toBeDefined();
      expect(sandbox.getSandboxPath(proposalId)).toBe(newPath);
    });
  });

  describe('getSandboxPath', () => {
    test('returns path for existing sandbox', async () => {
      const proposalId = 'proposal-get-path';
      const path = await sandbox.createSandbox(proposalId);

      expect(sandbox.getSandboxPath(proposalId)).toBe(path);
    });

    test('returns null for non-existent sandbox', () => {
      expect(sandbox.getSandboxPath('non-existent')).toBeNull();
    });
  });

  describe('listActiveSandboxes', () => {
    test('lists all active sandbox IDs', async () => {
      await sandbox.createSandbox('list-1');
      await sandbox.createSandbox('list-2');
      await sandbox.createSandbox('list-3');

      const list = sandbox.listActiveSandboxes();
      expect(list).toContain('list-1');
      expect(list).toContain('list-2');
      expect(list).toContain('list-3');
      expect(list).toHaveLength(3);
    });

    test('returns empty array when no sandboxes', () => {
      expect(sandbox.listActiveSandboxes()).toEqual([]);
    });
  });

  describe('executeInSandbox', () => {
    test('executes function with worktree path', async () => {
      const proposalId = 'proposal-execute';
      await sandbox.createSandbox(proposalId);

      const result = await sandbox.executeInSandbox(proposalId, async (worktreePath) => {
        return `executed at ${worktreePath}`;
      });

      expect(result).toBe(`executed at ${sandbox.getSandboxPath(proposalId)}`);
    });

    test('updates lastUsed timestamp', async () => {
      const proposalId = 'proposal-lastused';
      await sandbox.createSandbox(proposalId);

      const before = sandbox.getSandboxInfo(proposalId)?.lastUsed;
      await new Promise((r) => setTimeout(r, 10)); // Small delay
      await sandbox.executeInSandbox(proposalId, async () => 'done');
      const after = sandbox.getSandboxInfo(proposalId)?.lastUsed;

      expect(after?.getTime()).toBeGreaterThan(before?.getTime() ?? 0);
    });

    test('throws SANDBOX_NOT_FOUND for unknown proposal', async () => {
      await expect(
        sandbox.executeInSandbox('unknown', async () => 'test')
      ).rejects.toMatchObject({
        code: 'SANDBOX_NOT_FOUND',
      });
    });

    test('throws error if operation already in progress', async () => {
      const proposalId = 'proposal-concurrent';
      await sandbox.createSandbox(proposalId);

      // Start a long operation
      const promise1 = sandbox.executeInSandbox(proposalId, async () => {
        await new Promise((r) => setTimeout(r, 100));
        return 'first';
      });

      // Try to start another operation on same sandbox
      await expect(
        sandbox.executeInSandbox(proposalId, async () => 'second')
      ).rejects.toThrow('Operation already in progress');
    });

    test('auto-cleanup removes sandbox after execution', async () => {
      const cleanSandbox = new Sandbox({ ...testConfig, autoCleanup: true });
      const proposalId = 'proposal-autoclean';

      await cleanSandbox.createSandbox(proposalId);
      expect(cleanSandbox.getSandboxPath(proposalId)).not.toBeNull();

      await cleanSandbox.executeInSandbox(proposalId, async () => 'done');

      // Give time for async cleanup
      await new Promise((r) => setTimeout(r, 500));

      expect(cleanSandbox.getSandboxPath(proposalId)).toBeNull();
      await cleanSandbox.destroyAllSandboxes();
    });
  });

  describe('getSandboxInfo', () => {
    test('returns sandbox info for existing proposal', async () => {
      const proposalId = 'proposal-info';
      await sandbox.createSandbox(proposalId);

      const info = sandbox.getSandboxInfo(proposalId);
      expect(info).not.toBeNull();
      expect(info?.proposalId).toBe(proposalId);
      expect(info?.branchName).toContain('sandbox/');
      expect(info?.createdAt).toBeInstanceOf(Date);
    });

    test('returns null for non-existent proposal', () => {
      expect(sandbox.getSandboxInfo('unknown')).toBeNull();
    });
  });

  describe('destroyAllSandboxes', () => {
    test('removes all sandboxes', async () => {
      await sandbox.createSandbox('multi-1');
      await sandbox.createSandbox('multi-2');
      await sandbox.createSandbox('multi-3');

      expect(sandbox.getActiveCount()).toBe(3);

      await sandbox.destroyAllSandboxes();

      expect(sandbox.getActiveCount()).toBe(0);
      expect(sandbox.listActiveSandboxes()).toEqual([]);
    });

    test('handles partial failures gracefully', async () => {
      await sandbox.createSandbox('partial-1');
      await sandbox.createSandbox('partial-2');

      // destroyAllSandboxes should not throw even if individual destroys fail
      await expect(sandbox.destroyAllSandboxes()).resolves.not.toThrow();
    });
  });

  describe('getActiveCount', () => {
    test('returns correct count', async () => {
      expect(sandbox.getActiveCount()).toBe(0);

      await sandbox.createSandbox('count-1');
      expect(sandbox.getActiveCount()).toBe(1);

      await sandbox.createSandbox('count-2');
      expect(sandbox.getActiveCount()).toBe(2);

      await sandbox.destroySandbox('count-1');
      expect(sandbox.getActiveCount()).toBe(1);
    });
  });

  describe('error codes', () => {
    test('SANDBOX_NOT_FOUND has correct code', async () => {
      try {
        await sandbox.destroySandbox('not-found');
        fail('Expected error');
      } catch (err) {
        expect((err as SandboxError).code).toBe('SANDBOX_NOT_FOUND');
      }
    });

    test('SANDBOX_EXISTS has correct code', async () => {
      await sandbox.createSandbox('exists-test');
      try {
        await sandbox.createSandbox('exists-test');
        fail('Expected error');
      } catch (err) {
        expect((err as SandboxError).code).toBe('SANDBOX_EXISTS');
      }
    });

    test('MAX_CONCURRENT has correct code', async () => {
      const limitedSandbox = new Sandbox({ ...testConfig, maxConcurrentSandboxes: 1 });
      await limitedSandbox.createSandbox('max-1');
      try {
        await limitedSandbox.createSandbox('max-2');
        fail('Expected error');
      } catch (err) {
        expect((err as SandboxError).code).toBe('MAX_CONCURRENT');
      }
      await limitedSandbox.destroyAllSandboxes();
    });
  });
});
