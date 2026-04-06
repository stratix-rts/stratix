// ============================================
// Executor.ts - 执行编排器
// Phase 2: Step 6 - Executor 主类（编排器）
// ============================================

import { Sandbox } from './Sandbox';
import { CodeModifier } from './CodeModifier';
import { TestRunner } from './TestRunner';
import { RollbackManager } from './RollbackManager';
import { Guardian } from '../guardian/Guardian';
import { DiffApplier } from './DiffApplier';

import type { Proposal } from '../types';

import type {
  ExecutorConfig,
  ExecutorState,
  ExecutorPhase,
  ExecutionResult,
  FileModification,
  ModificationPlan,
  SandboxConfig,
  RollbackConfig,
  TestVerificationResult,
} from './types';

import {
  DEFAULT_EXECUTOR_CONFIG,
  DEFAULT_EXECUTOR_STATE,
} from './types';

// ------------------------------------------------
// Event Types
// ------------------------------------------------

export type ExecutorEventType =
  | 'execution_started'
  | 'execution_completed'
  | 'execution_failed'
  | 'phase_changed'
  | 'test_failed'
  | 'rollback_started'
  | 'rollback_completed'
  | 'commit_completed'
  | 'canceled'
  | 'circuit_tripped';

export interface ExecutorEvent {
  type: ExecutorEventType;
  timestamp: Date;
  payload: Record<string, unknown>;
}

// ------------------------------------------------
// Executor Dependencies
// ------------------------------------------------

export interface ExecutorDependencies {
  /** 提交代码到主分支的函数 */
  commitChanges?: (workDir: string, message: string) => Promise<string>;
  /** 通知执行结果的函数 */
  notify?: (message: string) => Promise<void>;
  /** 保存执行结果的函数 */
  saveExecutionResult?: (result: ExecutionResult) => Promise<void>;
}

// ------------------------------------------------
// Executor 类
// ============================================
// 执行流程:
// idle → preparing (创建沙箱 + 快照)
//      → modifying (应用代码修改)
//      → testing (运行测试验证)
//      → 如果测试通过 → committing (提交到 worktree)
//      → 如果测试失败 → rolling_back (恢复快照) → failed
//      → completed (成功)
// ============================================

export class Executor {
  // Config & State
  private config: ExecutorConfig;
  private state: ExecutorState;

  // Sub-modules
  private sandbox: Sandbox;
  private codeModifier: CodeModifier;
  private testRunner: TestRunner;
  private rollbackManager: RollbackManager;
  private guardian: Guardian;
  private diffApplier: DiffApplier | null = null;

  // Dependencies
  private deps: ExecutorDependencies;

  // Cancellation
  private canceledProposals: Set<string> = new Set();

  // 事件监听器
  private eventListeners: Map<ExecutorEventType, Array<(event: ExecutorEvent) => void>> = new Map();

  constructor(
    config?: Partial<ExecutorConfig>,
    dependencies?: ExecutorDependencies
  ) {
    this.config = {
      sandbox: config?.sandbox ?? DEFAULT_EXECUTOR_CONFIG.sandbox,
      rollback: config?.rollback ?? DEFAULT_EXECUTOR_CONFIG.rollback,
      fitness: config?.fitness ?? DEFAULT_EXECUTOR_CONFIG.fitness,
      maxRetries: config?.maxRetries ?? DEFAULT_EXECUTOR_CONFIG.maxRetries,
      requireApproval: config?.requireApproval ?? DEFAULT_EXECUTOR_CONFIG.requireApproval,
      allowedProposalTypes: config?.allowedProposalTypes ?? DEFAULT_EXECUTOR_CONFIG.allowedProposalTypes,
    };

    this.state = { ...DEFAULT_EXECUTOR_STATE };

    // 初始化子模块
    this.sandbox = new Sandbox(this.config.sandbox);
    this.codeModifier = new CodeModifier();
    this.testRunner = new TestRunner();
    this.rollbackManager = new RollbackManager(this.config.rollback);
    this.guardian = new Guardian({
      protection: {
        forbiddenPaths: [],
        requireApproval: false,
        notifyOnProposal: false,
        circuitBreakerEnabled: true,
      },
      circuitBreakerConfig: {
        maxConsecutiveFailures: 3,
        resetAfterMs: 60000,
      },
    });

    this.deps = dependencies ?? {};
  }

  // ------------------------------------------------
  // 公共方法
  // ------------------------------------------------

  /**
   * 执行单个提案的完整流程
   * @param proposal - 待执行的提案
   * @returns 执行结果
   */
  async executeProposal(proposal: Proposal): Promise<ExecutionResult> {
    const startTime = Date.now();

    // 检查是否可执行
    if (!(await this.canExecute(proposal))) {
      return this.createFailedResult(proposal.id, 'idle', startTime, 'Proposal is not executable');
    }

    // 检查是否已取消
    if (this.canceledProposals.has(proposal.id)) {
      this.canceledProposals.delete(proposal.id);
      return this.createFailedResult(proposal.id, 'idle', startTime, 'Proposal execution was canceled');
    }

    // 更新状态
    this.state.currentProposalId = proposal.id;
    this.state.startedAt = new Date();
    this.state.totalExecutions++;

    this.emit('execution_started', { proposal });

    // Phase 1: Preparing (创建沙箱 + 快照)
    this.setPhase('preparing');
    let sandboxPath: string | null = null;
    let snapshotId: string | null = null;

    try {
      sandboxPath = await this.sandbox.createSandbox(proposal.id);

      // 创建快照用于回滚
      snapshotId = (await this.rollbackManager.createSnapshot(proposal.id, sandboxPath)).id;
      this.state.sandboxBranch = `sandbox/${proposal.id}`;
    } catch (error) {
      return this.handleError(proposal.id, 'preparing', startTime, error as Error);
    }

    // Phase 2: Modifying (应用代码修改)
    this.setPhase('modifying');
    let modifications: FileModification[] = [];

    try {
      // 构建修改计划（从提案中提取）
      const modificationPlan = this.buildModificationPlan(proposal);

      // Guardian 路径安全检查
      const validation = this.codeModifier.validateModifications(modificationPlan);
      if (!validation.valid) {
        throw new Error(`Modification blocked by Guardian: ${validation.errors.join(', ')}`);
      }

      // 应用修改（按 modification 路由：diff → DiffApplier，否则 → CodeModifier）
      const planModifications = modificationPlan.modifications;

      // 确保 diffApplier 可用
      if (!this.diffApplier) {
        this.diffApplier = new DiffApplier();
      }

      for (const mod of planModifications) {
        if (mod.diff) {
          // 有 diff 字符串，走 DiffApplier
          const result = await this.diffApplier.applyDiff(sandboxPath, mod.diff);
          if (!result.success) {
            throw new Error(`DiffApplier failed: ${result.errors.join(', ')}`);
          }
          modifications.push({ ...mod });
        } else {
          // 无 diff，走 CodeModifier 原逻辑
          const result = await this.codeModifier.applyModifications(sandboxPath, {
            ...modificationPlan,
            modifications: [mod],
          });
          modifications.push(...result);
        }
      }
    } catch (error) {
      // 回滚并清理沙箱
      await this.cleanupAfterFailure(proposal.id, sandboxPath);
      return this.handleError(proposal.id, 'modifying', startTime, error as Error);
    }

    // Phase 3: Testing (运行测试验证)
    this.setPhase('testing');
    let testResult: TestVerificationResult | null = null;

    try {
      testResult = await this.testRunner.runTests(sandboxPath);

      if (!testResult.passed) {
        // 测试失败，触发回滚
        this.emit('test_failed', { proposal, testResult });

        this.setPhase('rolling_back');
        this.emit('rollback_started', { proposal });

        await this.performRollback(proposal.id, sandboxPath, modifications, snapshotId);

        this.emit('rollback_completed', { proposal });
        this.state.totalRollbacks++;
        this.guardian.recordFailure();

        // 连续失败计数
        this.state.consecutiveFailures++;
        if (this.state.consecutiveFailures >= 3) {
          this.emit('circuit_tripped', { consecutiveFailures: this.state.consecutiveFailures });
        }

        return this.createFailedResult(
          proposal.id,
          'failed',
          startTime,
          `Tests failed: ${testResult.failedTests} of ${testResult.totalTests} failed`
        );
      }
    } catch (error) {
      await this.cleanupAfterFailure(proposal.id, sandboxPath);
      return this.handleError(proposal.id, 'testing', startTime, error as Error);
    }

    // Phase 4: Committing (提交到 worktree)
    this.setPhase('committing');
    let commitHash: string | null = null;

    try {
      commitHash = await this.performCommit(sandboxPath, proposal);

      this.emit('commit_completed', { proposal, commitHash });
    } catch (error) {
      await this.cleanupAfterFailure(proposal.id, sandboxPath);
      return this.handleError(proposal.id, 'committing', startTime, error as Error);
    }

    // 清理沙箱（自动清理）
    await this.sandbox.destroySandbox(proposal.id);

    // 更新状态
    this.state.consecutiveFailures = 0;
    this.state.totalSuccesses++;
    this.setPhase('completed');

    const result: ExecutionResult = {
      proposalId: proposal.id,
      success: true,
      phase: 'completed',
      modifications,
      testResult,
      commitHash,
      rollbackHash: null,
      duration: Date.now() - startTime,
      error: null,
    };

    this.emit('execution_completed', { result });

    // 保存结果
    if (this.deps.saveExecutionResult) {
      await this.deps.saveExecutionResult(result);
    }

    // 通知
    if (this.deps.notify) {
      await this.deps.notify(`Proposal ${proposal.id} executed successfully`);
    }

    this.resetState();
    return result;
  }

  /**
   * 取消正在执行的提案
   * @param proposalId - 提案 ID
   */
  async cancelExecution(proposalId: string): Promise<void> {
    if (this.state.currentProposalId === proposalId) {
      this.canceledProposals.add(proposalId);
      this.emit('canceled', { proposalId });
    }
  }

  /**
   * 获取当前状态
   */
  getState(): ExecutorState {
    return {
      ...this.state,
    };
  }

  /**
   * 检查提案是否可执行
   * @param proposal - 待检查的提案
   */
  async canExecute(proposal: Proposal): Promise<boolean> {
    // 检查提案类型是否允许
    if (!this.config.allowedProposalTypes.includes(proposal.type)) {
      return false;
    }

    // 检查是否需要审批且尚未审批
    if (this.config.requireApproval && proposal.status !== 'approved') {
      return false;
    }

    // 检查熔断器状态
    if (!this.guardian.getCircuitBreaker().isAllowed()) {
      return false;
    }

    // 检查是否有正在执行的提案
    if (this.state.phase !== 'idle' && this.state.phase !== 'completed' && this.state.phase !== 'failed') {
      return false;
    }

    return true;
  }

  /**
   * 获取 Sandbox 实例（用于测试）
   */
  getSandbox(): Sandbox {
    return this.sandbox;
  }

  /**
   * 获取 CodeModifier 实例（用于测试）
   */
  getCodeModifier(): CodeModifier {
    return this.codeModifier;
  }

  /**
   * 获取 TestRunner 实例（用于测试）
   */
  getTestRunner(): TestRunner {
    return this.testRunner;
  }

  /**
   * 获取 RollbackManager 实例（用于测试）
   */
  getRollbackManager(): RollbackManager {
    return this.rollbackManager;
  }

  /**
   * 获取 Guardian 实例（用于测试）
   */
  getGuardian(): Guardian {
    return this.guardian;
  }

  /**
   * 设置依赖函数
   */
  setDependencies(dependencies: ExecutorDependencies): void {
    this.deps = { ...this.deps, ...dependencies };
  }

  /**
   * 设置 DiffApplier
   */
  setDiffApplier(applier: DiffApplier): void {
    this.diffApplier = applier;
  }

  /**
   * 重置熔断器
   */
  resetCircuitBreaker(): void {
    this.guardian.resetCircuitBreaker();
    this.state.consecutiveFailures = 0;
  }

  /**
   * 订阅事件
   */
  on(eventType: ExecutorEventType, listener: (event: ExecutorEvent) => void): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)!.push(listener);
  }

  /**
   * 取消订阅
   */
  off(eventType: ExecutorEventType, listener: (event: ExecutorEvent) => void): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  // ------------------------------------------------
  // 私有方法
  // ------------------------------------------------

  /**
   * 设置执行阶段
   */
  private setPhase(phase: ExecutorPhase): void {
    this.state.phase = phase;
    this.emit('phase_changed', { phase });
  }

  /**
   * 触发事件
   */
  private emit(eventType: ExecutorEventType, payload: Record<string, unknown>): void {
    const event: ExecutorEvent = {
      type: eventType,
      timestamp: new Date(),
      payload,
    };

    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error('[Executor] Event listener error:', error);
        }
      }
    }
  }

  /**
   * 构建修改计划
   */
  private buildModificationPlan(proposal: Proposal): ModificationPlan {
    // 从 Proposal.modifications（A1 新增的 SystemZoneFileModification[]）映射到 executor 的 FileModification
    const modifications: FileModification[] = (proposal.modifications ?? []).map(m => ({
      type: m.type,
      path: m.path,
      content: m.content,
      description: m.description,
      ...(m.newPath ? { newPath: m.newPath } : {}),
      ...(m.diff ? { diff: m.diff } : {}),
    }));

    return {
      proposalId: proposal.id,
      modifications,
      estimatedRisk: proposal.selection?.risk ?? 'low',
      affectedFiles: modifications.map((m) => m.path),
      description: proposal.description,
    };
  }

  /**
   * 执行回滚
   */
  private async performRollback(
    proposalId: string,
    sandboxPath: string,
    modifications: FileModification[],
    snapshotId: string | null
  ): Promise<void> {
    try {
      // 恢复快照
      if (snapshotId) {
        await this.rollbackManager.restoreSnapshot(snapshotId);
      }

      // 回滚代码修改
      await this.codeModifier.revertModifications(sandboxPath, modifications);
    } catch (error) {
      console.error('[Executor] Rollback error:', error);
      // 回滚失败也继续，不阻塞清理
    }
  }

  /**
   * 执行提交
   */
  private async performCommit(workDir: string, proposal: Proposal): Promise<string> {
    if (this.deps.commitChanges) {
      return this.deps.commitChanges(
        workDir,
        `feat: execute proposal ${proposal.id}\n\n${proposal.title}\n\n${proposal.description}`
      );
    }

    // 默认提交逻辑（如果未提供依赖）
    const { execSync } = require('child_process');

    try {
      execSync('git add .', { cwd: workDir });
      const { stdout } = require('child_process').execSync(
        `git commit -m "feat: execute proposal ${proposal.id}"`,
        { cwd: workDir }
      );
      return stdout.trim();
    } catch (error) {
      // 如果没有更改，commit 会失败，这是正常的
      const errorMessage = (error as Error).message;
      if (errorMessage.includes('nothing to commit')) {
        return 'no-change-commit';
      }
      throw error;
    }
  }

  /**
   * 失败后清理
   */
  private async cleanupAfterFailure(proposalId: string, sandboxPath: string): Promise<void> {
    try {
      await this.sandbox.destroySandbox(proposalId);
    } catch {
      // 沙箱可能已自动清理，忽略错误
    }
  }

  /**
   * 处理错误
   */
  private handleError(proposalId: string, phase: ExecutorPhase, startTime: number, error: Error): ExecutionResult {
    this.setPhase('failed');
    this.state.lastError = error.message;
    this.state.consecutiveFailures++;
    this.guardian.recordFailure();

    if (this.state.consecutiveFailures >= 3) {
      this.emit('circuit_tripped', { consecutiveFailures: this.state.consecutiveFailures });
    }

    const result: ExecutionResult = {
      proposalId,
      success: false,
      phase: 'failed',
      modifications: [],
      testResult: null,
      commitHash: null,
      rollbackHash: null,
      duration: Date.now() - startTime,
      error: error.message,
    };

    this.emit('execution_failed', { proposalId, error: error.message, phase });

    // 清理
    this.sandbox.destroySandbox(proposalId).catch(() => {});
    this.resetState();

    return result;
  }

  /**
   * 创建失败结果
   */
  private createFailedResult(
    proposalId: string,
    phase: ExecutorPhase,
    startTime: number,
    errorMessage: string
  ): ExecutionResult {
    return {
      proposalId,
      success: false,
      phase,
      modifications: [],
      testResult: null,
      commitHash: null,
      rollbackHash: null,
      duration: Date.now() - startTime,
      error: errorMessage,
    };
  }

  /**
   * 重置状态
   */
  private resetState(): void {
    this.state.phase = 'idle';
    this.state.currentProposalId = null;
    this.state.sandboxBranch = null;
    this.state.completedAt = new Date();
  }
}
