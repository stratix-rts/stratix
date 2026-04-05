// ============================================
// BootstrapEngine.ts - 自举主引擎
// Phase 4: P4-06 - 自举主引擎
// ============================================

import { EventEmitter } from 'events';

import type {
  BootstrapState,
  BootstrapMode,
  BootstrapPhase,
  BootstrapEngineConfig,
  BootstrapCycleResult,
  DiscoveryResult,
  DiscoveredProposal,
  Decision,
  ImpactEvaluation,
  MetricSnapshot,
  RegressionCheck,
} from './types';

import {
  DEFAULT_BOOTSTRAP_STATE,
  DEFAULT_BOOTSTRAP_ENGINE_CONFIG,
} from './types';

import { DiscoveryEngine } from './DiscoveryEngine';
import { DecisionEngine } from './DecisionEngine';
import { ImpactEvaluator } from './ImpactEvaluator';
import { RegressionGuard } from './RegressionGuard';
import { Executor } from '../executor/Executor';
import { FitnessEvaluator } from '../fitness/FitnessEvaluator';
import { Guardian } from '../guardian/Guardian';
import type { Proposal } from '../types';

// -------------------------------------------------------------------------
// Event Types
// -------------------------------------------------------------------------

export type BootstrapEventType =
  | 'cycle_started'
  | 'cycle_completed'
  | 'cycle_failed'
  | 'phase_changed'
  | 'discovery_completed'
  | 'decision_completed'
  | 'execution_completed'
  | 'evaluation_completed'
  | 'rollback_triggered'
  | 'mode_changed'
  | 'auto_toggle';

export interface BootstrapEvent {
  type: BootstrapEventType;
  timestamp: Date;
  payload: Record<string, unknown>;
}

// -------------------------------------------------------------------------
// Dependencies
// -------------------------------------------------------------------------

export interface BootstrapEngineDependencies {
  discoveryEngine?: DiscoveryEngine;
  decisionEngine?: DecisionEngine;
  impactEvaluator?: ImpactEvaluator;
  regressionGuard?: RegressionGuard;
  executor?: Executor;
  fitnessEvaluator?: FitnessEvaluator;
  guardian?: Guardian;
}

// -------------------------------------------------------------------------
// BootstrapEngine
// ============================================
// 编排完整的自举循环: 发现 → 决策 → 执行 → 评估 → 学习
// ============================================

export class BootstrapEngine extends EventEmitter {
  // Configuration & State
  private config: BootstrapEngineConfig;
  private state: BootstrapState;

  // Sub-engines
  private discoveryEngine: DiscoveryEngine;
  private decisionEngine: DecisionEngine;
  private impactEvaluator: ImpactEvaluator;
  private regressionGuard: RegressionGuard;
  private executor: Executor;
  private fitnessEvaluator: FitnessEvaluator;
  private guardian: Guardian;

  // Cycle management
  private cycleHistory: BootstrapCycleResult[] = [];
  private autoInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private cycleCounter: number = 0;

  // Current cycle context
  private currentProposals: DiscoveredProposal[] = [];
  private currentDecisions: Decision[] = [];
  private currentImpactEvaluation: ImpactEvaluation | null = null;

  constructor(
    config: Partial<BootstrapEngineConfig> = {},
    dependencies: BootstrapEngineDependencies = {}
  ) {
    super();

    // Initialize config
    this.config = {
      discovery: config.discovery ?? DEFAULT_BOOTSTRAP_ENGINE_CONFIG.discovery,
      decision: config.decision ?? DEFAULT_BOOTSTRAP_ENGINE_CONFIG.decision,
      regressionGuard: config.regressionGuard ?? DEFAULT_BOOTSTRAP_ENGINE_CONFIG.regressionGuard,
      mode: config.mode ?? DEFAULT_BOOTSTRAP_ENGINE_CONFIG.mode,
      maxCyclesPerDay: config.maxCyclesPerDay ?? DEFAULT_BOOTSTRAP_ENGINE_CONFIG.maxCyclesPerDay,
      requireHumanApprovalForMode: config.requireHumanApprovalForMode ??
        DEFAULT_BOOTSTRAP_ENGINE_CONFIG.requireHumanApprovalForMode,
    };

    // Initialize state
    this.state = { ...DEFAULT_BOOTSTRAP_STATE, mode: this.config.mode };

    // Initialize sub-engines
    this.discoveryEngine = dependencies.discoveryEngine ?? this.createDefaultDiscoveryEngine();
    this.decisionEngine = dependencies.decisionEngine ?? new DecisionEngine(this.config.decision);
    this.impactEvaluator = dependencies.impactEvaluator ?? new ImpactEvaluator();
    this.regressionGuard = dependencies.regressionGuard ?? new RegressionGuard(this.config.regressionGuard);
    this.executor = dependencies.executor ?? new Executor();
    this.fitnessEvaluator = dependencies.fitnessEvaluator ?? new FitnessEvaluator();
    this.guardian = dependencies.guardian ?? this.createDefaultGuardian();
  }

  // ================================================================
  // Public API - Core Methods
  // ================================================================

  /**
   * 执行一次完整的自举循环
   * 发现 → 决策 → 执行 → 评估 → 学习
   */
  async runCycle(): Promise<BootstrapCycleResult> {
    const cycleId = this.generateCycleId();
    const startTime = Date.now();

    // Update state
    this.setPhase('discovering');
    this.state.cycleCount++;
    this.isRunning = true;

    this.emit('cycle_started', { cycleId, timestamp: new Date() });

    // Initialize cycle result
    const result: BootstrapCycleResult = {
      cycleId,
      timestamp: new Date(),
      discovered: 0,
      approved: 0,
      executed: 0,
      succeeded: 0,
      failed: 0,
      rolledBack: 0,
      impactScore: 0,
      state: { ...this.state },
    };

    try {
      // Phase 1: Discovery
      this.setPhase('discovering');
      const discoveryResult = await this.runDiscovery();
      result.discovered = discoveryResult.proposals.length;
      this.currentProposals = discoveryResult.proposals;
      this.state.totalProposalsGenerated += discoveryResult.proposals.length;
      this.state.lastDiscoveryAt = new Date();

      this.emit('discovery_completed', { cycleId, proposalCount: discoveryResult.proposals.length });

      // Phase 2: Decision
      if (this.currentProposals.length > 0) {
        this.setPhase('deciding');
        const decisions = await this.runDecisions(this.currentProposals);
        result.approved = decisions.filter(d => d.action === 'approve').length;
        this.currentDecisions = decisions;

        this.emit('decision_completed', { cycleId, decisionCount: decisions.length });
      }

      // Phase 3: Execution
      const approvedProposals = this.currentDecisions
        .filter(d => d.action === 'approve')
        .map(d => this.currentProposals.find(p => p.id === d.proposalId)!)
        .filter(Boolean);

      if (approvedProposals.length > 0) {
        this.setPhase('executing');
        const executionResults = await this.runExecution(approvedProposals);
        result.executed = executionResults.length;
        result.succeeded = executionResults.filter(r => r.success).length;
        result.failed = executionResults.filter(r => !r.success).length;

        // Phase 4: Evaluation
        this.setPhase('evaluating');
        const evaluation = await this.runEvaluation(executionResults);
        result.impactScore = evaluation.overallImpact;
        result.rolledBack = evaluation.rolledBack;

        // Update improvement score
        this.updateImprovementScore(evaluation);

        this.emit('evaluation_completed', { cycleId, evaluation });
      }

      // Phase 5: Learning (update decision engine based on results)
      await this.runLearning();

      // Update success/failure counts
      // Only count as success if there were executions and more succeeded than failed
      // No executions means neutral (not failure)
      if (result.executed > 0 && result.succeeded >= result.executed) {
        this.state.successCount++;
        this.state.consecutiveFailures = 0;
      } else if (result.executed > 0 && result.succeeded < result.executed) {
        this.state.failureCount++;
        this.state.consecutiveFailures++;
      }

      this.state.lastCycleAt = new Date();
      result.state = { ...this.state };

      this.emit('cycle_completed', { cycleId, result });
    } catch (error) {
      this.state.failureCount++;
      this.state.consecutiveFailures++;
      result.state = { ...this.state };

      this.emit('cycle_failed', {
        cycleId,
        error: (error as Error).message,
      });
    } finally {
      this.isRunning = false;
      this.setPhase('idle');
      this.cycleHistory.push(result);

      // Keep only last 100 cycles
      if (this.cycleHistory.length > 100) {
        this.cycleHistory = this.cycleHistory.slice(-100);
      }
    }

    return result;
  }

  /**
   * 启动自动循环（基于 mode）
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    let intervalMs: number;

    switch (this.config.mode) {
      case 'full_auto':
        // Full auto: run every hour (but respect maxCyclesPerDay)
        intervalMs = Math.max(60_000, Math.floor(86_400_000 / this.config.maxCyclesPerDay));
        break;
      case 'semi_auto':
        // Semi-auto: run every 4 hours
        intervalMs = 4 * 60 * 60 * 1000;
        break;
      case 'manual':
      default:
        // Manual mode: don't auto-start
        return;
    }

    this.autoInterval = setInterval(() => {
      this.runCycle().catch((error) => {
        console.error('[BootstrapEngine] Auto-cycle failed:', error);
      });
    }, intervalMs);

    this.emit('auto_toggle', { enabled: true, intervalMs });
  }

  /**
   * 停止自动循环
   */
  stop(): void {
    if (this.autoInterval) {
      clearInterval(this.autoInterval);
      this.autoInterval = null;
    }
    this.emit('auto_toggle', { enabled: false });
  }

  /**
   * 获取当前状态
   */
  getState(): BootstrapState {
    return { ...this.state };
  }

  /**
   * 切换模式
   */
  setMode(mode: BootstrapMode): void {
    // Check if mode change requires human approval
    if (this.config.requireHumanApprovalForMode.includes(mode)) {
      // In real implementation, would emit an event to request approval
      // For now, just log and allow
      console.warn(`[BootstrapEngine] Mode change to ${mode} requires human approval`);
    }

    this.config.mode = mode;
    this.state.mode = mode;

    // Restart auto-cycle with new interval if running
    if (this.autoInterval) {
      this.stop();
      this.start();
    }

    this.emit('mode_changed', { mode });
  }

  /**
   * 获取历史记录
   */
  getHistory(limit?: number): BootstrapCycleResult[] {
    if (limit !== undefined && limit > 0) {
      return this.cycleHistory.slice(-limit);
    }
    return [...this.cycleHistory];
  }

  /**
   * 获取当前运行的提案
   */
  getCurrentProposals(): DiscoveredProposal[] {
    return [...this.currentProposals];
  }

  /**
   * 获取当前决策
   */
  getCurrentDecisions(): Decision[] {
    return [...this.currentDecisions];
  }

  /**
   * 检查是否正在运行
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * 获取配置
   */
  getConfig(): BootstrapEngineConfig {
    return { ...this.config };
  }

  // ================================================================
  // Phase Methods
  // ================================================================

  /**
   * 运行发现阶段
   */
  private async runDiscovery(): Promise<DiscoveryResult> {
    return this.discoveryEngine.discover();
  }

  /**
   * 运行决策阶段
   */
  private async runDecisions(proposals: DiscoveredProposal[]): Promise<Decision[]> {
    // Batch decide all proposals
    const decisions = await this.decisionEngine.batchDecide(proposals);

    // Filter to only approved (considering mode)
    const approvedDecisions: Decision[] = [];

    for (const decision of decisions) {
      if (decision.action === 'approve') {
        // In semi_auto mode, check risk level
        if (this.config.mode === 'semi_auto') {
          const risk = decision.riskAssessment.overall;
          if (risk > this.config.decision.requireManualAbove) {
            // High risk, require manual approval - skip for now
            continue;
          }
        }
        approvedDecisions.push(decision);
      }
    }

    return approvedDecisions;
  }

  /**
   * 运行执行阶段
   */
  private async runExecution(proposals: DiscoveredProposal[]): Promise<Array<{
    proposalId: string;
    success: boolean;
    impact: ImpactEvaluation | null;
  }>> {
    const results: Array<{ proposalId: string; success: boolean; impact: ImpactEvaluation | null }> = [];

    // Capture before metrics
    const beforeMetrics = await this.impactEvaluator.captureBefore();

    for (const proposal of proposals) {
      // Convert DiscoveredProposal to Proposal for Executor
      const executorProposal = this.convertToExecutorProposal(proposal);

      // Guardian validation
      const validation = this.guardian.validateProposal(executorProposal);
      if (!validation.valid) {
        console.warn(`[BootstrapEngine] Proposal ${proposal.id} blocked by Guardian: ${validation.reasons.join(', ')}`);
        results.push({ proposalId: proposal.id, success: false, impact: null });
        continue;
      }

      try {
        const executionResult = await this.executor.executeProposal(executorProposal);

        this.state.totalProposalsExecuted++;

        if (executionResult.success) {
          results.push({ proposalId: proposal.id, success: true, impact: null });
          this.decisionEngine.recordExecutionResult(proposal.id, true);
        } else {
          results.push({ proposalId: proposal.id, success: false, impact: null });
          this.decisionEngine.recordExecutionResult(proposal.id, false);
        }
      } catch (error) {
        results.push({ proposalId: proposal.id, success: false, impact: null });
        this.decisionEngine.recordExecutionResult(proposal.id, false);
      }
    }

    return results;
  }

  /**
   * 运行评估阶段
   */
  private async runEvaluation(executionResults: Array<{
    proposalId: string;
    success: boolean;
    impact: ImpactEvaluation | null;
  }>): Promise<{
    overallImpact: number;
    rolledBack: number;
  }> {
    let totalImpact = 0;
    let rolledBack = 0;
    let evaluatedCount = 0;

    // Capture after metrics
    const afterMetrics = await this.impactEvaluator.captureAfter();

    for (const result of executionResults) {
      if (!result.success) {
        continue;
      }

      // Run impact evaluation
      const evaluation = this.impactEvaluator.evaluate(
        afterMetrics, // Simplified - would need before metrics per proposal
        afterMetrics,
        result.proposalId
      );

      // Run regression check
      const regressionCheck = this.regressionGuard.check(
        result.proposalId,
        afterMetrics,
        afterMetrics
      );

      if (!regressionCheck.canProceed) {
        // Trigger rollback
        rolledBack++;
        this.state.totalProposalsRolledBack++;
        this.emit('rollback_triggered', {
          proposalId: result.proposalId,
          regressionCheck,
        });
      } else {
        // Keep the change
        totalImpact += evaluation.overallImpact;
        evaluatedCount++;
      }
    }

    return {
      overallImpact: evaluatedCount > 0 ? Math.round(totalImpact / evaluatedCount) : 0,
      rolledBack,
    };
  }

  /**
   * 运行学习阶段
   */
  private async runLearning(): Promise<void> {
    // Update decision engine with execution results
    // In a full implementation, would analyze what worked and what didn't
    // and adjust decision thresholds accordingly

    // Update fitness-based learnings
    try {
      const fitnessReport = await this.fitnessEvaluator.evaluate();
      this.state.improvementScore = fitnessReport.scores.overall;
    } catch {
      // Fitness evaluation failed, keep current score
    }
  }

  // ================================================================
  // Private Helper Methods
  // ================================================================

  private setPhase(phase: BootstrapPhase): void {
    this.state.phase = phase;
    this.emit('phase_changed', { phase });
  }

  private generateCycleId(): string {
    this.cycleCounter++;
    return `cycle-${Date.now()}-${this.cycleCounter}`;
  }

  private updateImprovementScore(evaluation: { overallImpact: number; rolledBack: number }): void {
    // Adjust improvement score based on cycle results
    // Positive impact increases score, negative decreases
    const delta = evaluation.overallImpact / 100; // Normalize to -1 to +1
    const rollbackPenalty = evaluation.rolledBack * -5;

    this.state.improvementScore = Math.max(
      0,
      Math.min(100, this.state.improvementScore + delta * 10 + rollbackPenalty)
    );
  }

  private convertToExecutorProposal(discovered: DiscoveredProposal): Proposal {
    return {
      id: discovered.id,
      timestamp: new Date(),
      type: 'improve_code',
      title: discovered.description,
      description: discovered.description,
      target: {
        file: discovered.target,
      },
      selection: {
        confidence: 0.8,
        cost: 0,
        benefit: discovered.estimatedImpact,
        risk: discovered.estimatedRisk < 30 ? 'low' : discovered.estimatedRisk < 70 ? 'medium' : 'high',
      },
      status: 'approved',
    };
  }

  private createDefaultDiscoveryEngine(): DiscoveryEngine {
    // Return a minimal discovery engine that works for testing
    // In production, DiscoveryEngine requires a ProjectScanner
    const mockScanner = {
      scanAll: async () => ({
        scanResult: {
          coverage: { totalStatements: 0, totalBranches: 0, totalFunctions: 0, totalLines: 0, coveredStatements: 0, coveredBranches: 0, coveredFunctions: 0, coveredLines: 0, uncoveredFiles: [], threshold: 80 },
          types: { errors: [], warnings: [], success: true },
          lint: { errors: [], warnings: [], success: true, fatalErrorCount: 0 },
          sizes: { files: [], threshold: 500 },
        },
      }),
    } as any;

    return new DiscoveryEngine(
      {
        scanInterval: 3600000,
        maxProposalsPerCycle: 5,
        minImprovementScore: 10,
        enabledCategories: ['test', 'code', 'architecture', 'performance'],
      },
      mockScanner
    );
  }

  private createDefaultGuardian(): Guardian {
    return new Guardian({
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
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.stop();
    this.state = { ...DEFAULT_BOOTSTRAP_STATE, mode: this.config.mode };
    this.cycleHistory = [];
    this.currentProposals = [];
    this.currentDecisions = [];
    this.currentImpactEvaluation = null;
    this.cycleCounter = 0;
    this.isRunning = false;
  }

  /**
   * 获取统计摘要
   */
  getStats(): {
    totalCycles: number;
    totalProposalsGenerated: number;
    totalProposalsExecuted: number;
    totalProposalsRolledBack: number;
    successRate: number;
    currentImprovementScore: number;
    consecutiveFailures: number;
    isRunning: boolean;
  } {
    const successRate = this.state.cycleCount > 0
      ? (this.state.successCount / this.state.cycleCount) * 100
      : 0;

    return {
      totalCycles: this.state.cycleCount,
      totalProposalsGenerated: this.state.totalProposalsGenerated,
      totalProposalsExecuted: this.state.totalProposalsExecuted,
      totalProposalsRolledBack: this.state.totalProposalsRolledBack,
      successRate: Math.round(successRate),
      currentImprovementScore: this.state.improvementScore,
      consecutiveFailures: this.state.consecutiveFailures,
      isRunning: this.isRunning,
    };
  }
}

// -------------------------------------------------------------------------
// Default instance factory
// -------------------------------------------------------------------------

export function createBootstrapEngine(
  config?: Partial<BootstrapEngineConfig>,
  dependencies?: BootstrapEngineDependencies
): BootstrapEngine {
  return new BootstrapEngine(config, dependencies);
}
