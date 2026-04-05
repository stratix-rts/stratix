// ============================================
// Sandbox.ts - 沙箱执行器
// Phase 2: Git Worktree 隔离执行
// ============================================

import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { SandboxConfig, DEFAULT_SANDBOX_CONFIG } from './types';

const execAsync = promisify(execCallback);

export interface SandboxInfo {
  proposalId: string;
  worktreePath: string;
  branchName: string;
  createdAt: Date;
  lastUsed: Date;
}

export interface SandboxError extends Error {
  code: 'SANDBOX_NOT_FOUND' | 'SANDBOX_EXISTS' | 'MAX_CONCURRENT' | 'TIMEOUT' | 'GIT_ERROR' | 'WORKTREE_CLEANUP_FAILED';
}

/**
 * 沙箱执行器
 * 使用 git worktree 实现提案的隔离执行环境
 */
export class Sandbox {
  private config: SandboxConfig;
  private sandboxes: Map<string, SandboxInfo> = new Map();
  private activeOperations: Map<string, AbortController> = new Map();

  constructor(config?: Partial<SandboxConfig>) {
    this.config = {
      worktreeBaseDir: config?.worktreeBaseDir ?? DEFAULT_SANDBOX_CONFIG.worktreeBaseDir,
      repoPath: config?.repoPath ?? DEFAULT_SANDBOX_CONFIG.repoPath,
      maxConcurrentSandboxes: config?.maxConcurrentSandboxes ?? DEFAULT_SANDBOX_CONFIG.maxConcurrentSandboxes,
      autoCleanup: config?.autoCleanup ?? DEFAULT_SANDBOX_CONFIG.autoCleanup,
      defaultTimeout: config?.defaultTimeout ?? DEFAULT_SANDBOX_CONFIG.defaultTimeout,
    };
  }

  /**
   * 创建沙箱 worktree
   * @param proposalId - 提案 ID
   * @returns 沙箱路径
   */
  async createSandbox(proposalId: string): Promise<string> {
    // 检查是否已存在
    if (this.sandboxes.has(proposalId)) {
      const error = new Error(`Sandbox already exists for proposal: ${proposalId}`) as SandboxError;
      error.code = 'SANDBOX_EXISTS';
      throw error;
    }

    // 检查并发限制
    if (this.sandboxes.size >= this.config.maxConcurrentSandboxes) {
      const error = new Error(`Maximum concurrent sandboxes (${this.config.maxConcurrentSandboxes}) reached`) as SandboxError;
      error.code = 'MAX_CONCURRENT';
      throw error;
    }

    // 确保基础目录存在
    await fs.mkdir(this.config.worktreeBaseDir, { recursive: true });

    // 生成 worktree 路径和分支名
    const worktreePath = path.join(this.config.worktreeBaseDir, `proposal-${proposalId}-${randomUUID().slice(0, 8)}`);
    const branchName = `sandbox/${proposalId}`;

    try {
      // 创建 worktree (基于当前 HEAD)
      await execAsync(
        `git worktree add -b ${branchName} "${worktreePath}" HEAD`,
        { cwd: this.config.repoPath }
      );

      const sandboxInfo: SandboxInfo = {
        proposalId,
        worktreePath,
        branchName,
        createdAt: new Date(),
        lastUsed: new Date(),
      };

      this.sandboxes.set(proposalId, sandboxInfo);

      return worktreePath;
    } catch (err) {
      // 清理失败的 worktree
      try {
        await fs.rm(worktreePath, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }

      const error = new Error(`Failed to create worktree: ${(err as Error).message}`) as SandboxError;
      error.code = 'GIT_ERROR';
      throw error;
    }
  }

  /**
   * 销毁沙箱 worktree
   * @param proposalId - 提案 ID
   */
  async destroySandbox(proposalId: string): Promise<void> {
    const sandbox = this.sandboxes.get(proposalId);
    if (!sandbox) {
      const error = new Error(`Sandbox not found for proposal: ${proposalId}`) as SandboxError;
      error.code = 'SANDBOX_NOT_FOUND';
      throw error;
    }

    // 取消正在进行的操作
    const controller = this.activeOperations.get(proposalId);
    if (controller) {
      controller.abort();
      this.activeOperations.delete(proposalId);
    }

    let lastError: Error | undefined;
    let worktreeRemoved = false;

    // First try to remove the worktree
    try {
      await execAsync(`git worktree remove "${sandbox.worktreePath}" --force`, {
        cwd: this.config.repoPath,
      });
      worktreeRemoved = true;
    } catch (err) {
      lastError = err as Error;
      // Worktree removal failed, will try to prune later
    }

    // Always try to delete the branch - even if worktree removal failed,
    // the branch might still exist and need deletion
    try {
      await execAsync(`git branch -D "${sandbox.branchName}"`, {
        cwd: this.config.repoPath,
      });
    } catch {
      // Branch may already be deleted or merged - ignore
    }

    // If worktree removal failed, try git worktree prune as fallback
    if (!worktreeRemoved) {
      try {
        await execAsync('git worktree prune', { cwd: this.config.repoPath });
      } catch {
        // ignore prune errors
      }
    }

    // Clean up local directory
    try {
      await fs.rm(sandbox.worktreePath, { recursive: true, force: true });
    } catch {
      // Directory may already be removed - ignore
    }

    // If worktree removal failed and we had an error, throw it
    if (!worktreeRemoved && lastError) {
      const error = new Error(`Failed to destroy worktree: ${lastError.message}`) as SandboxError;
      error.code = 'WORKTREE_CLEANUP_FAILED';
      throw error;
    }

    this.sandboxes.delete(proposalId);
  }

  /**
   * 获取沙箱路径
   * @param proposalId - 提案 ID
   * @returns 沙箱路径，如果不存在返回 null
   */
  getSandboxPath(proposalId: string): string | null {
    const sandbox = this.sandboxes.get(proposalId);
    return sandbox?.worktreePath ?? null;
  }

  /**
   * 列出活跃沙箱
   * @returns 活跃的提案 ID 列表
   */
  listActiveSandboxes(): string[] {
    return Array.from(this.sandboxes.keys());
  }

  /**
   * 在沙箱中执行操作
   * @param proposalId - 提案 ID
   * @param fn - 要执行的异步函数
   * @returns 函数执行结果
   */
  async executeInSandbox<T>(proposalId: string, fn: (path: string) => Promise<T>): Promise<T> {
    const sandbox = this.sandboxes.get(proposalId);
    if (!sandbox) {
      const error = new Error(`Sandbox not found for proposal: ${proposalId}`) as SandboxError;
      error.code = 'SANDBOX_NOT_FOUND';
      throw error;
    }

    // 检查是否已有正在进行的操作
    if (this.activeOperations.has(proposalId)) {
      throw new Error(`Operation already in progress for proposal: ${proposalId}`);
    }

    // 创建 abort controller
    const controller = new AbortController();
    this.activeOperations.set(proposalId, controller);

    // 更新最后使用时间
    sandbox.lastUsed = new Date();

    const timeoutMs = this.config.defaultTimeout;
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const result = await fn(sandbox.worktreePath);
      return result;
    } catch (err) {
      if (controller.signal.aborted) {
        const error = new Error(`Operation timed out after ${timeoutMs}ms`) as SandboxError;
        error.code = 'TIMEOUT';
        throw error;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      this.activeOperations.delete(proposalId);

      // 自动清理
      if (this.config.autoCleanup) {
        this.destroySandbox(proposalId).catch(() => {
          // ignore cleanup errors in background
        });
      }
    }
  }

  /**
   * 获取沙箱信息
   * @param proposalId - 提案 ID
   */
  getSandboxInfo(proposalId: string): SandboxInfo | null {
    return this.sandboxes.get(proposalId) ?? null;
  }

  /**
   * 获取当前 git 分支名
   */
  private async getCurrentBranch(): Promise<string> {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
      cwd: this.config.repoPath,
    });
    return stdout.trim();
  }

  /**
   * 获取配置
   */
  getConfig(): SandboxConfig {
    return { ...this.config };
  }

  /**
   * 获取当前沙箱数量
   */
  getActiveCount(): number {
    return this.sandboxes.size;
  }

  /**
   * 清理所有沙箱（用于测试或强制清理）
   */
  async destroyAllSandboxes(): Promise<void> {
    const proposalIds = Array.from(this.sandboxes.keys());
    await Promise.all(proposalIds.map((id) => this.destroySandbox(id).catch(() => {})));
  }
}
