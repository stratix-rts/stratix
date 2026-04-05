// ============================================
// ExperimentZone - 隔离实验区管理
// Phase 4: P4-07 - 实验区 Zone 管理
// ============================================

import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

import { v4 as uuidv4 } from 'uuid';

import type {
  DiscoveredProposal,
  ExperimentStatus,
  ExperimentZone,
  ImpactEvaluation,
} from './types';

// ------------------------------------------------
// Worktree 接口
// ------------------------------------------------

export interface IWorktreeManager {
  create(worktreePath: string, branchName: string, baseBranch?: string): Promise<void>;
  remove(worktreePath: string): Promise<void>;
  exists(worktreePath: string): boolean;
  list(): Array<{ path: string; branch: string }>;
}

// ------------------------------------------------
// 实验存储接口
// ------------------------------------------------

export interface IExperimentStore {
  save(experiment: ExperimentZone): Promise<void>;
  findById(id: string): Promise<ExperimentZone | null>;
  findByProposalId(proposalId: string): Promise<ExperimentZone | null>;
  findByStatus(status: ExperimentStatus): Promise<ExperimentZone[]>;
  findAll(): Promise<ExperimentZone[]>;
  delete(id: string): Promise<void>;
  updateStatus(id: string, status: ExperimentStatus): Promise<void>;
  updateResult(id: string, result: ImpactEvaluation): Promise<void>;
}

// ------------------------------------------------
// Git Worktree Manager 实现
// ------------------------------------------------

export class GitWorktreeManager implements IWorktreeManager {
  private repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  async create(worktreePath: string, branchName: string, baseBranch: string = 'master'): Promise<void> {
    // 确保目录存在
    const parentDir = worktreePath.substring(0, worktreePath.lastIndexOf('/'));
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // 创建 worktree
    try {
      execSync(
        `git -C "${this.repoRoot}" worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );
    } catch (error) {
      throw new Error(`Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async remove(worktreePath: string): Promise<void> {
    if (!this.exists(worktreePath)) {
      return;
    }

    try {
      // 先移除 worktree
      execSync(`git -C "${this.repoRoot}" worktree remove "${worktreePath}" --force`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      // 清理 worktree 目录
      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
      }
    } catch (error) {
      // 尝试手动清理
      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
      }
    }
  }

  exists(worktreePath: string): boolean {
    try {
      const result = execSync(
        `git -C "${this.repoRoot}" worktree list --porcelain`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );
      return result.includes(worktreePath);
    } catch {
      return false;
    }
  }

  list(): Array<{ path: string; branch: string }> {
    try {
      const result = execSync(`git -C "${this.repoRoot}" worktree list --porcelain`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      const worktrees: Array<{ path: string; branch: string }> = [];
      const entries = result.split('\n\n').filter(Boolean);

      for (const entry of entries) {
        const lines = entry.split('\n');
        let path = '';
        let branch = '';

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            path = line.substring('worktree '.length);
          } else if (line.startsWith('branch ')) {
            branch = line.substring('branch '.length);
          }
        }

        if (path) {
          worktrees.push({ path, branch });
        }
      }

      return worktrees;
    } catch {
      return [];
    }
  }
}

// ------------------------------------------------
// 内存实验存储实现
// ------------------------------------------------

export class InMemoryExperimentStore implements IExperimentStore {
  private experiments: Map<string, ExperimentZone> = new Map();

  async save(experiment: ExperimentZone): Promise<void> {
    this.experiments.set(experiment.id, { ...experiment });
  }

  async findById(id: string): Promise<ExperimentZone | null> {
    return this.experiments.get(id) ?? null;
  }

  async findByProposalId(proposalId: string): Promise<ExperimentZone | null> {
    const entries = Array.from(this.experiments.values());
    for (const exp of entries) {
      if (exp.proposalId === proposalId) {
        return { ...exp };
      }
    }
    return null;
  }

  async findByStatus(status: ExperimentStatus): Promise<ExperimentZone[]> {
    const results: ExperimentZone[] = [];
    const entries = Array.from(this.experiments.values());
    for (const exp of entries) {
      if (exp.status === status) {
        results.push({ ...exp });
      }
    }
    return results;
  }

  async findAll(): Promise<ExperimentZone[]> {
    return Array.from(this.experiments.values()).map((e) => ({ ...e }));
  }

  async delete(id: string): Promise<void> {
    this.experiments.delete(id);
  }

  async updateStatus(id: string, status: ExperimentStatus): Promise<void> {
    const exp = this.experiments.get(id);
    if (exp) {
      exp.status = status;
      if (status === 'running' && !exp.startedAt) {
        exp.startedAt = new Date();
      } else if ((status === 'completed' || status === 'failed' || status === 'cancelled') && !exp.completedAt) {
        exp.completedAt = new Date();
      }
    }
  }

  async updateResult(id: string, result: ImpactEvaluation): Promise<void> {
    const exp = this.experiments.get(id);
    if (exp) {
      exp.result = result;
    }
  }
}

// ------------------------------------------------
// ExperimentZone 主类
// ------------------------------------------------

export interface ExperimentZoneConfig {
  worktreeBasePath: string;
  repoRoot: string;
  maxConcurrentExperiments: number;
  defaultMaxAgeMs: number; // 清理超过此时间的已完成实验
}

const DEFAULT_EXPERIMENT_ZONE_CONFIG: ExperimentZoneConfig = {
  worktreeBasePath: '.worktrees',
  repoRoot: process.cwd(),
  maxConcurrentExperiments: 5,
  defaultMaxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export class ExperimentZoneManager {
  private config: ExperimentZoneConfig;
  private worktreeManager: IWorktreeManager;
  private store: IExperimentStore;
  private parentZoneId: string;

  constructor(
    parentZoneId: string,
    options?: {
      config?: Partial<ExperimentZoneConfig>;
      worktreeManager?: IWorktreeManager;
      store?: IExperimentStore;
    }
  ) {
    this.parentZoneId = parentZoneId;
    this.config = { ...DEFAULT_EXPERIMENT_ZONE_CONFIG, ...options?.config };
    this.worktreeManager = options?.worktreeManager ?? new GitWorktreeManager(this.config.repoRoot);
    this.store = options?.store ?? new InMemoryExperimentStore();
  }

  /**
   * 创建实验区
   * 将 proposal 转化为实验区，在独立 git worktree 中运行
   */
  async createExperiment(proposal: DiscoveredProposal): Promise<ExperimentZone> {
    const experimentId = uuidv4();
    const timestamp = Date.now();
    const branchName = `experiment/${proposal.id.slice(0, 8)}-${timestamp}`;
    const worktreePath = join(this.config.worktreeBasePath, `exp-${experimentId.slice(0, 8)}`);

    // 检查是否已有该 proposal 的实验
    const existing = await this.store.findByProposalId(proposal.id);
    if (existing) {
      throw new Error(`Experiment for proposal ${proposal.id} already exists: ${existing.id}`);
    }

    // 检查并发数量限制
    const runningCount = (await this.store.findByStatus('running')).length;
    if (runningCount >= this.config.maxConcurrentExperiments) {
      throw new Error(`Maximum concurrent experiments (${this.config.maxConcurrentExperiments}) reached`);
    }

    // 创建 git worktree
    try {
      await this.worktreeManager.create(worktreePath, branchName);
    } catch (error) {
      throw new Error(`Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`);
    }

    const experiment: ExperimentZone = {
      id: experimentId,
      name: `Experiment: ${proposal.description.slice(0, 50)}`,
      description: proposal.description,
      status: 'proposed',
      proposalId: proposal.id,
      branchName,
      worktreePath,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      result: null,
      parentZoneId: this.parentZoneId,
    };

    await this.store.save(experiment);
    return { ...experiment };
  }

  /**
   * 启动实验
   */
  async startExperiment(experimentId: string): Promise<void> {
    const experiment = await this.store.findById(experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    if (experiment.status !== 'proposed') {
      throw new Error(`Cannot start experiment in status: ${experiment.status}`);
    }

    // 验证 worktree 存在
    if (!this.worktreeManager.exists(experiment.worktreePath)) {
      // 尝试重新创建
      await this.worktreeManager.create(
        experiment.worktreePath,
        experiment.branchName
      );
    }

    await this.store.updateStatus(experimentId, 'running');
  }

  /**
   * 完成实验
   */
  async completeExperiment(experimentId: string, result: ImpactEvaluation): Promise<void> {
    const experiment = await this.store.findById(experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    if (experiment.status !== 'running') {
      throw new Error(`Cannot complete experiment in status: ${experiment.status}`);
    }

    await this.store.updateStatus(experimentId, 'completed');
    await this.store.updateResult(experimentId, result);
  }

  /**
   * 取消实验
   */
  async cancelExperiment(experimentId: string): Promise<void> {
    const experiment = await this.store.findById(experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    if (experiment.status === 'completed' || experiment.status === 'cancelled') {
      throw new Error(`Cannot cancel experiment in status: ${experiment.status}`);
    }

    // 清理 worktree
    await this.worktreeManager.remove(experiment.worktreePath);

    await this.store.updateStatus(experimentId, 'cancelled');
  }

  /**
   * 列出实验
   */
  async listExperiments(status?: ExperimentStatus): Promise<ExperimentZone[]> {
    if (status) {
      return this.store.findByStatus(status);
    }
    return this.store.findAll();
  }

  /**
   * 获取实验详情
   */
  async getExperiment(experimentId: string): Promise<ExperimentZone | null> {
    return this.store.findById(experimentId);
  }

  /**
   * 清理旧实验
   * 删除超过 maxAge 的已完成实验及其 worktree
   */
  async cleanupCompleted(maxAge?: number): Promise<number> {
    const maxAgeMs = maxAge ?? this.config.defaultMaxAgeMs;
    const now = Date.now();
    const completed = await this.store.findByStatus('completed');

    let cleanedCount = 0;

    for (const experiment of completed) {
      const age = now - (experiment.completedAt?.getTime() ?? experiment.createdAt.getTime());
      if (age > maxAgeMs) {
        // 清理 worktree
        await this.worktreeManager.remove(experiment.worktreePath);
        // 删除记录
        await this.store.delete(experiment.id);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * 合并实验到主分支
   */
  async mergeExperiment(experimentId: string, deleteWorktree: boolean = true): Promise<void> {
    const experiment = await this.store.findById(experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    if (experiment.status !== 'completed') {
      throw new Error(`Cannot merge experiment in status: ${experiment.status}`);
    }

    try {
      // 合并到主分支
      execSync(`git -C "${this.config.repoRoot}" merge ${experiment.branchName} --no-ff -m "Merge experiment ${experimentId}"`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // 清理 worktree
      if (deleteWorktree) {
        await this.worktreeManager.remove(experiment.worktreePath);
      }
    } catch (error) {
      throw new Error(`Failed to merge experiment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 丢弃实验
   */
  async discardExperiment(experimentId: string): Promise<void> {
    const experiment = await this.store.findById(experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    // 清理 worktree
    await this.worktreeManager.remove(experiment.worktreePath);

    // 删除记录
    await this.store.delete(experimentId);
  }

  /**
   * 获取当前运行的实验数量
   */
  async getRunningCount(): Promise<number> {
    return (await this.store.findByStatus('running')).length;
  }

  /**
   * 获取实验统计
   */
  async getStats(): Promise<{
    total: number;
    proposed: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
  }> {
    const all = await this.store.findAll();
    return {
      total: all.length,
      proposed: all.filter((e) => e.status === 'proposed').length,
      running: all.filter((e) => e.status === 'running').length,
      completed: all.filter((e) => e.status === 'completed').length,
      failed: all.filter((e) => e.status === 'failed').length,
      cancelled: all.filter((e) => e.status === 'cancelled').length,
    };
  }
}
