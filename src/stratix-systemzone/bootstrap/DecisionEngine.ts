// ============================================
// DecisionEngine.ts - 决策引擎
// Phase 4: P4-03 - 自主审批决策引擎
// ============================================

import { EventEmitter } from 'events';
import type {
  DecisionConfig,
  Decision,
  DiscoveredProposal,
  RiskAssessment,
  RiskFactor,
  DEFAULT_DECISION_CONFIG,
} from './types';

// -------------------------------------------------------------------------
// Core Module Detection
// -------------------------------------------------------------------------

const CORE_MODULES = [
  'stratix-gateway',
  'stratix-database',
  'stratix-project',
  'stratix-agent',
  'stratix-rts',
];

const CORE_PATTERNS = [
  /src\/stratix-gateway\/.*\.ts$/,
  /src\/stratix-database\/.*\.ts$/,
  /src\/stratix-project\/.*\.ts$/,
  /src\/stratix-agent\/.*\.ts$/,
  /src\/stratix-rts\/.*\.ts$/,
  /src\/stratix-systemzone\/.*\.ts$/,
];

// -------------------------------------------------------------------------
// DecisionEngine
// -------------------------------------------------------------------------

export interface DecisionEngineDeps {
  getHistoricalSuccessRate?: (category: string, target: string) => Promise<number>;
  getTestCoverage?: (target: string) => Promise<number>;
  isCoreModule?: (target: string) => boolean;
}

export class DecisionEngine extends EventEmitter {
  private config: DecisionConfig;
  private decisionHistory: Decision[] = [];
  private consecutiveFailures: number = 0;
  private cooldownUntil: number | null = null;
  private deps: DecisionEngineDeps;

  constructor(config: Partial<DecisionConfig> = {}) {
    super();
    this.config = {
      autoApproveThreshold: config.autoApproveThreshold ?? 30,
      requireManualAbove: config.requireManualAbove ?? 70,
      maxConcurrentExecutions: config.maxConcurrentExecutions ?? 2,
      cooldownAfterFailure: config.cooldownAfterFailure ?? 600_000,
    };
    this.deps = {};
  }

  setDependencies(deps: DecisionEngineDeps): void {
    this.deps = deps;
  }

  // -------------------------------------------------------------------------
  // Core Methods
  // -------------------------------------------------------------------------

  /**
   * 对提案做出决策
   */
  async decide(proposal: DiscoveredProposal): Promise<Decision> {
    // Check cooldown
    if (this.isInCooldown()) {
      const decision = this.createDecision(proposal, 'defer', 0,
        `System is in cooldown after ${this.consecutiveFailures} consecutive failures`);
      this.recordDecision(decision);
      return decision;
    }

    // Reject if impact is too low
    const minImprovement = 10; // minImprovementScore
    if (proposal.estimatedImpact < minImprovement) {
      const decision = this.createDecision(proposal, 'reject', 1,
        `Estimated impact ${proposal.estimatedImpact} is below minimum threshold ${minImprovement}`);
      this.recordDecision(decision);
      return decision;
    }

    // Assess risk
    const riskAssessment = this.assessRisk(proposal);
    const risk = riskAssessment.overall;

    // Decision logic based on risk thresholds
    let action: Decision['action'];
    let confidence: number;
    let reasoning: string;

    if (risk < this.config.autoApproveThreshold) {
      action = 'approve';
      confidence = this.calculateConfidence(riskAssessment, 'auto');
      reasoning = `Auto-approved: risk ${risk} is below auto-approve threshold ${this.config.autoApproveThreshold}`;
    } else if (risk < this.config.requireManualAbove) {
      action = 'approve';
      confidence = this.calculateConfidence(riskAssessment, 'manual');
      reasoning = `Approved with confidence: risk ${risk} requires manual review but is below escalation threshold ${this.config.requireManualAbove}`;
    } else {
      action = 'escalate';
      confidence = this.calculateConfidence(riskAssessment, 'escalate');
      reasoning = `Escalated: risk ${risk} exceeds require-manual-above threshold ${this.config.requireManualAbove}`;
    }

    const decision = this.createDecision(proposal, action, confidence, reasoning, riskAssessment);
    this.recordDecision(decision);

    this.emit('decision_made', { proposal, decision });

    return decision;
  }

  /**
   * 风险评估
   */
  assessRisk(proposal: DiscoveredProposal): RiskAssessment {
    const factors: RiskFactor[] = [];
    const mitigations: string[] = [];
    let totalRisk = 0;

    // Factor 1: Number of files affected
    const fileCount = this.extractFileCount(proposal);
    const fileCountRisk = Math.min(fileCount * 5, 30);
    factors.push({
      name: 'fileCount',
      severity: fileCount > 5 ? 'high' : fileCount > 2 ? 'medium' : 'low',
      description: `Affects ${fileCount} file(s)`,
    });
    totalRisk += fileCountRisk;

    // Factor 2: Core module involvement
    const isCore = this.isCoreModule(proposal.target);
    if (isCore) {
      factors.push({
        name: 'coreModule',
        severity: 'high',
        description: 'Modifies core system module',
      });
      totalRisk += 25;
      mitigations.push('Core module modification requires extra scrutiny');
    }

    // Factor 3: Test coverage
    const coverage = this.getCoverageScore(proposal);
    if (coverage < 50) {
      factors.push({
        name: 'lowCoverage',
        severity: 'high',
        description: `Low test coverage: ${coverage}%`,
      });
      totalRisk += 20;
      mitigations.push('Low coverage increases regression risk');
    } else if (coverage < 80) {
      factors.push({
        name: 'mediumCoverage',
        severity: 'medium',
        description: `Medium test coverage: ${coverage}%`,
      });
      totalRisk += 10;
    } else {
      mitigations.push('Good test coverage reduces risk');
    }

    // Factor 4: Historical success rate
    const successRate = this.getHistoricalSuccessRate(proposal);
    if (successRate < 0.5) {
      factors.push({
        name: 'poorHistory',
        severity: 'high',
        description: `Poor historical success rate: ${(successRate * 100).toFixed(0)}%`,
      });
      totalRisk += 20;
      mitigations.push('Similar operations have historically failed');
    } else if (successRate < 0.8) {
      factors.push({
        name: 'mixedHistory',
        severity: 'medium',
        description: `Mixed historical success rate: ${(successRate * 100).toFixed(0)}%`,
      });
      totalRisk += 10;
    } else {
      mitigations.push('Similar operations have historically succeeded');
    }

    // Factor 5: Effort level
    const effortRisk = proposal.estimatedEffort === 'high' ? 15 :
                       proposal.estimatedEffort === 'medium' ? 8 : 3;
    factors.push({
      name: 'effort',
      severity: proposal.estimatedEffort === 'high' ? 'high' :
                proposal.estimatedEffort === 'medium' ? 'medium' : 'low',
      description: `Estimated effort: ${proposal.estimatedEffort}`,
    });
    totalRisk += effortRisk;

    // Normalize total risk to 0-100
    const overall = Math.min(Math.max(totalRisk, 0), 100);

    return {
      overall,
      factors,
      mitigations,
    };
  }

  /**
   * 判断是否可自动审批
   */
  autoApprove(proposal: DiscoveredProposal): boolean {
    const risk = this.assessRisk(proposal);
    return risk.overall < this.config.autoApproveThreshold;
  }

  /**
   * 批量决策
   */
  async batchDecide(proposals: DiscoveredProposal[]): Promise<Decision[]> {
    const decisions: Decision[] = [];

    for (const proposal of proposals) {
      // Check if we've reached max concurrent executions
      const pendingCount = decisions.filter(
        d => d.action === 'approve' && !this.isExecuted(d.proposalId)
      ).length;

      if (pendingCount >= this.config.maxConcurrentExecutions) {
        const deferDecision = this.createDecision(
          proposal,
          'defer',
          0,
          `Max concurrent executions (${this.config.maxConcurrentExecutions}) reached`
        );
        decisions.push(deferDecision);
      } else {
        const decision = await this.decide(proposal);
        decisions.push(decision);
      }
    }

    return decisions;
  }

  /**
   * 获取历史决策
   */
  getDecisionHistory(limit?: number): Decision[] {
    if (limit !== undefined && limit > 0) {
      return this.decisionHistory.slice(-limit);
    }
    return [...this.decisionHistory];
  }

  // -------------------------------------------------------------------------
  // Cooldown Management
  // -------------------------------------------------------------------------

  private isInCooldown(): boolean {
    if (this.cooldownUntil === null) return false;
    return Date.now() < this.cooldownUntil;
  }

  private enterCooldown(): void {
    this.consecutiveFailures++;
    this.cooldownUntil = Date.now() + this.config.cooldownAfterFailure;
    this.emit('cooldown_entered', {
      consecutiveFailures: this.consecutiveFailures,
      cooldownUntil: this.cooldownUntil,
    });
  }

  private resetCooldown(): void {
    if (this.consecutiveFailures > 0) {
      this.consecutiveFailures = 0;
      this.cooldownUntil = null;
      this.emit('cooldown_cleared', {});
    }
  }

  recordExecutionResult(proposalId: string, success: boolean): void {
    const decision = this.decisionHistory.find(d => d.proposalId === proposalId);
    if (!decision) return;

    if (success) {
      this.resetCooldown();
      this.emit('execution_success', { proposalId, decision });
    } else {
      this.enterCooldown();
      this.emit('execution_failure', { proposalId, decision });
    }
  }

  // -------------------------------------------------------------------------
  // Helper Methods
  // -------------------------------------------------------------------------

  private createDecision(
    proposal: DiscoveredProposal,
    action: Decision['action'],
    confidence: number,
    reasoning: string,
    riskAssessment?: RiskAssessment
  ): Decision {
    return {
      proposalId: proposal.id,
      action,
      confidence,
      reasoning,
      riskAssessment: riskAssessment ?? this.assessRisk(proposal),
      expectedOutcome: this.generateExpectedOutcome(proposal, action),
    };
  }

  private recordDecision(decision: Decision): void {
    this.decisionHistory.push(decision);
  }

  private isExecuted(proposalId: string): boolean {
    // Check if a proposal was already executed in this batch
    // This is a simplified check - in real impl would track execution state
    return false;
  }

  private calculateConfidence(
    riskAssessment: RiskAssessment,
    mode: 'auto' | 'manual' | 'escalate'
  ): number {
    // Base confidence starts at 0.5
    let confidence = 0.5;

    // Adjust based on number of risk factors
    const highSeverityCount = riskAssessment.factors.filter(
      f => f.severity === 'high'
    ).length;
    const mediumSeverityCount = riskAssessment.factors.filter(
      f => f.severity === 'medium'
    ).length;

    if (mode === 'auto') {
      confidence = 0.9 - (highSeverityCount * 0.15) - (mediumSeverityCount * 0.05);
    } else if (mode === 'manual') {
      confidence = 0.7 - (highSeverityCount * 0.15) - (mediumSeverityCount * 0.08);
    } else {
      confidence = 0.5 - (highSeverityCount * 0.1) - (mediumSeverityCount * 0.05);
    }

    // Mitigations increase confidence
    confidence += riskAssessment.mitigations.length * 0.03;

    return Math.min(Math.max(confidence, 0), 1);
  }

  private generateExpectedOutcome(proposal: DiscoveredProposal, action: Decision['action']): string {
    switch (action) {
      case 'approve':
        return `Expected to improve ${proposal.category} by ${proposal.estimatedImpact} points`;
      case 'reject':
        return `Proposal rejected: impact too low (${proposal.estimatedImpact})`;
      case 'defer':
        return 'Proposal deferred due to system state';
      case 'escalate':
        return 'Requires human review before proceeding';
      default:
        return 'Unknown action';
    }
  }

  private extractFileCount(proposal: DiscoveredProposal): number {
    const data = proposal.data as Record<string, unknown>;
    if (data?.affectedFiles && Array.isArray(data.affectedFiles)) {
      return (data.affectedFiles as unknown[]).length;
    }
    if (data?.files && Array.isArray(data.files)) {
      return (data.files as unknown[]).length;
    }
    // Default to 1 if unknown
    return 1;
  }

  private isCoreModule(target: string): boolean {
    // Check using custom dependency if provided
    if (this.deps.isCoreModule) {
      return this.deps.isCoreModule(target);
    }

    // Default core module detection
    for (const pattern of CORE_PATTERNS) {
      if (pattern.test(target)) {
        return true;
      }
    }
    return false;
  }

  private getCoverageScore(proposal: DiscoveredProposal): number {
    const data = proposal.data as Record<string, unknown>;
    if (typeof data?.coverage === 'number') {
      return data.coverage as number;
    }
    // Default to 80 if unknown
    return 80;
  }

  private getHistoricalSuccessRate(proposal: DiscoveredProposal): number {
    // In real implementation, would query historical data
    // For now, use data from proposal if available
    const data = proposal.data as Record<string, unknown>;
    if (typeof data?.successRate === 'number') {
      return data.successRate as number;
    }
    // Default to 0.8 (80% success rate)
    return 0.8;
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  getConfig(): DecisionConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<DecisionConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    };
  }

  getStats(): {
    totalDecisions: number;
    consecutiveFailures: number;
    isInCooldown: boolean;
    cooldownUntil: number | null;
  } {
    return {
      totalDecisions: this.decisionHistory.length,
      consecutiveFailures: this.consecutiveFailures,
      isInCooldown: this.isInCooldown(),
      cooldownUntil: this.cooldownUntil,
    };
  }
}

// -------------------------------------------------------------------------
// Default instance factory
// -------------------------------------------------------------------------

export function createDecisionEngine(config?: Partial<DecisionConfig>): DecisionEngine {
  return new DecisionEngine(config);
}
