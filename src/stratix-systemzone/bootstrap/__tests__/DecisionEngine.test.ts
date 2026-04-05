// ============================================
// DecisionEngine.test.ts - 决策引擎测试
// Phase 4: P4-03 - DecisionEngine 测试
// ============================================

import { DecisionEngine } from '../DecisionEngine';
import type { DiscoveredProposal, Decision, RiskAssessment } from '../types';

// -------------------------------------------------------------------------
// Helper Functions
// -------------------------------------------------------------------------

function createProposal(overrides: Partial<DiscoveredProposal> = {}): DiscoveredProposal {
  return {
    id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    category: 'code',
    target: 'src/test.ts',
    description: 'Test proposal',
    estimatedImpact: 50,
    estimatedRisk: 30,
    estimatedEffort: 'medium',
    source: 'scanner',
    data: {},
    ...overrides,
  };
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('DecisionEngine', () => {
  let engine: DecisionEngine;

  beforeEach(() => {
    engine = new DecisionEngine();
  });

  describe('constructor', () => {
    it('creates instance with default config', () => {
      const engine = new DecisionEngine();
      const config = engine.getConfig();

      expect(config.autoApproveThreshold).toBe(30);
      expect(config.requireManualAbove).toBe(70);
      expect(config.maxConcurrentExecutions).toBe(2);
      expect(config.cooldownAfterFailure).toBe(600_000);
    });

    it('creates instance with custom config', () => {
      const engine = new DecisionEngine({
        autoApproveThreshold: 20,
        requireManualAbove: 60,
        maxConcurrentExecutions: 5,
        cooldownAfterFailure: 300_000,
      });
      const config = engine.getConfig();

      expect(config.autoApproveThreshold).toBe(20);
      expect(config.requireManualAbove).toBe(60);
      expect(config.maxConcurrentExecutions).toBe(5);
      expect(config.cooldownAfterFailure).toBe(300_000);
    });
  });

  describe('decide', () => {
    it('auto-approves low-risk proposals', async () => {
      const proposal = createProposal({
        estimatedRisk: 20,
        estimatedImpact: 50,
        data: { coverage: 90, successRate: 0.9, affectedFiles: ['src/utils.ts'] },
      });

      const decision = await engine.decide(proposal);

      expect(decision.action).toBe('approve');
      expect(decision.confidence).toBeGreaterThan(0.5);
      expect(decision.riskAssessment.overall).toBeLessThan(30);
    });

    it('approves medium-risk proposals with confidence', async () => {
      const proposal = createProposal({
        estimatedRisk: 50,
        estimatedImpact: 50,
        data: { coverage: 80, successRate: 0.8, affectedFiles: ['src/utils.ts'] },
      });

      const decision = await engine.decide(proposal);

      expect(decision.action).toBe('approve');
      expect(decision.confidence).toBeGreaterThan(0);
    });

    it('escalates high-risk proposals', async () => {
      // High risk requires: low coverage, poor history, core module, high effort, many files
      const proposal = createProposal({
        target: 'src/stratix-gateway/core.ts',
        estimatedRisk: 80,
        estimatedImpact: 50,
        estimatedEffort: 'high',
        data: {
          coverage: 20,
          successRate: 0.2,
          affectedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
        },
      });

      const decision = await engine.decide(proposal);

      expect(decision.action).toBe('escalate');
      expect(decision.riskAssessment.overall).toBeGreaterThanOrEqual(70);
    });

    it('rejects proposals with low estimated impact', async () => {
      const proposal = createProposal({
        estimatedImpact: 5, // Below minImprovementScore of 10
        estimatedRisk: 20,
      });

      const decision = await engine.decide(proposal);

      expect(decision.action).toBe('reject');
      expect(decision.reasoning).toContain('impact');
    });

    it('defers decisions during cooldown', async () => {
      // Manually enter cooldown
      (engine as unknown as { consecutiveFailures: number; cooldownUntil: number }).consecutiveFailures = 3;
      (engine as unknown as { cooldownUntil: number }).cooldownUntil = Date.now() + 600_000;

      const proposal = createProposal({ estimatedRisk: 20, estimatedImpact: 50 });

      const decision = await engine.decide(proposal);

      expect(decision.action).toBe('defer');
      expect(decision.reasoning).toContain('cooldown');
    });

    it('records decision in history', async () => {
      const proposal = createProposal({ estimatedRisk: 20, estimatedImpact: 50 });

      await engine.decide(proposal);

      const history = engine.getDecisionHistory();
      expect(history.length).toBe(1);
      expect(history[0].proposalId).toBe(proposal.id);
    });

    it('emits decision_made event', async () => {
      const proposal = createProposal({ estimatedRisk: 20, estimatedImpact: 50 });
      const eventHandler = jest.fn();
      engine.on('decision_made', eventHandler);

      await engine.decide(proposal);

      expect(eventHandler).toHaveBeenCalledWith(expect.objectContaining({
        proposal,
        decision: expect.objectContaining({ proposalId: proposal.id }),
      }));
    });

    it('includes expected outcome in decision', async () => {
      const proposal = createProposal({ category: 'test', estimatedRisk: 20, estimatedImpact: 60 });

      const decision = await engine.decide(proposal);

      expect(decision.expectedOutcome).toContain('test');
      expect(decision.expectedOutcome).toContain('60');
    });
  });

  describe('assessRisk', () => {
    it('returns risk assessment with factors', () => {
      const proposal = createProposal({
        estimatedEffort: 'high',
        data: { affectedFiles: ['a.ts', 'b.ts', 'c.ts'] },
      });

      const assessment = engine.assessRisk(proposal);

      expect(assessment.overall).toBeGreaterThan(0);
      expect(assessment.factors).toBeInstanceOf(Array);
      expect(assessment.factors.length).toBeGreaterThan(0);
    });

    it('increases risk for core module modifications', () => {
      const coreProposal = createProposal({
        target: 'src/stratix-gateway/core.ts',
        data: { affectedFiles: ['src/stratix-gateway/core.ts'] },
      });

      const assessment = engine.assessRisk(coreProposal);

      const coreFactor = assessment.factors.find(f => f.name === 'coreModule');
      expect(coreFactor).toBeDefined();
      expect(coreFactor?.severity).toBe('high');
    });

    it('increases risk for low coverage', () => {
      const proposal = createProposal({
        data: { coverage: 30, affectedFiles: ['src/utils.ts'] },
      });

      const assessment = engine.assessRisk(proposal);

      const coverageFactor = assessment.factors.find(f => f.name === 'lowCoverage');
      expect(coverageFactor).toBeDefined();
      expect(coverageFactor?.severity).toBe('high');
    });

    it('increases risk for poor historical success rate', () => {
      const proposal = createProposal({
        data: { successRate: 0.3, affectedFiles: ['src/utils.ts'] },
      });

      const assessment = engine.assessRisk(proposal);

      const historyFactor = assessment.factors.find(f => f.name === 'poorHistory');
      expect(historyFactor).toBeDefined();
      expect(historyFactor?.severity).toBe('high');
    });

    it('includes mitigations when risk factors are low', () => {
      const proposal = createProposal({
        estimatedEffort: 'low',
        data: { coverage: 95, successRate: 0.95, affectedFiles: ['src/utils.ts'] },
      });

      const assessment = engine.assessRisk(proposal);

      expect(assessment.mitigations.length).toBeGreaterThan(0);
    });

    it('handles multiple affected files', () => {
      const proposal = createProposal({
        data: { affectedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'] },
      });

      const assessment = engine.assessRisk(proposal);

      const fileCountFactor = assessment.factors.find(f => f.name === 'fileCount');
      expect(fileCountFactor?.severity).toBe('high');
    });
  });

  describe('autoApprove', () => {
    it('returns true for low-risk proposals', () => {
      const proposal = createProposal({
        estimatedRisk: 20,
        data: { coverage: 90, successRate: 0.9, affectedFiles: ['src/utils.ts'] },
      });

      expect(engine.autoApprove(proposal)).toBe(true);
    });

    it('returns false for high-risk proposals', () => {
      const proposal = createProposal({
        estimatedRisk: 50,
        data: { coverage: 50, successRate: 0.5, affectedFiles: ['src/core.ts'] },
      });

      expect(engine.autoApprove(proposal)).toBe(false);
    });

    it('returns false for core module proposals even with low risk score', () => {
      const proposal = createProposal({
        target: 'src/stratix-gateway/core.ts',
        estimatedRisk: 20,
        data: { coverage: 90, successRate: 0.9, affectedFiles: ['src/stratix-gateway/core.ts'] },
      });

      // Even though estimatedRisk is low, core module involvement adds risk
      expect(engine.autoApprove(proposal)).toBe(false);
    });
  });

  describe('batchDecide', () => {
    it('processes multiple proposals', async () => {
      const proposals = [
        createProposal({ id: 'p1', estimatedRisk: 20, estimatedImpact: 50 }),
        createProposal({ id: 'p2', estimatedRisk: 20, estimatedImpact: 50 }),
        createProposal({ id: 'p3', estimatedRisk: 20, estimatedImpact: 50 }),
      ];

      const decisions = await engine.batchDecide(proposals);

      expect(decisions.length).toBe(3);
    });

    it('defers proposals when max concurrent executions reached', async () => {
      const proposals = [
        createProposal({ id: 'p1', estimatedRisk: 20, estimatedImpact: 50 }),
        createProposal({ id: 'p2', estimatedRisk: 20, estimatedImpact: 50 }),
        createProposal({ id: 'p3', estimatedRisk: 20, estimatedImpact: 50 }),
      ];

      const decisions = await engine.batchDecide(proposals);

      // First 2 should be approved, 3rd should be deferred
      const approvedCount = decisions.filter(d => d.action === 'approve').length;
      const deferredCount = decisions.filter(d => d.action === 'defer').length;
      expect(approvedCount).toBe(2);
      expect(deferredCount).toBe(1);
    });

    it('handles empty proposal array', async () => {
      const decisions = await engine.batchDecide([]);

      expect(decisions).toEqual([]);
    });
  });

  describe('getDecisionHistory', () => {
    it('returns all decisions when no limit specified', async () => {
      await engine.decide(createProposal({ estimatedRisk: 20, estimatedImpact: 50 }));
      await engine.decide(createProposal({ estimatedRisk: 20, estimatedImpact: 50 }));

      const history = engine.getDecisionHistory();

      expect(history.length).toBe(2);
    });

    it('returns limited number of decisions', async () => {
      await engine.decide(createProposal({ estimatedRisk: 20, estimatedImpact: 50 }));
      await engine.decide(createProposal({ estimatedRisk: 20, estimatedImpact: 50 }));
      await engine.decide(createProposal({ estimatedRisk: 20, estimatedImpact: 50 }));

      const history = engine.getDecisionHistory(2);

      expect(history.length).toBe(2);
    });

    it('returns empty array when no decisions made', () => {
      const history = engine.getDecisionHistory();

      expect(history).toEqual([]);
    });

    it('returns copy of history array', () => {
      engine.getDecisionHistory();
      const history1 = engine.getDecisionHistory();
      const history2 = engine.getDecisionHistory();

      expect(history1).not.toBe(history2);
    });
  });

  describe('recordExecutionResult', () => {
    it('resets cooldown on success', async () => {
      // Enter cooldown first
      (engine as unknown as { consecutiveFailures: number; cooldownUntil: number })
        .consecutiveFailures = 3;
      (engine as unknown as { cooldownUntil: number })
        .cooldownUntil = Date.now() + 600_000;

      const proposal = createProposal({ estimatedRisk: 20, estimatedImpact: 50 });
      await engine.decide(proposal);

      engine.recordExecutionResult(proposal.id, true);

      const stats = engine.getStats();
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.isInCooldown).toBe(false);
    });

    it('increments consecutive failures on failure', async () => {
      const proposal = createProposal({ estimatedRisk: 20, estimatedImpact: 50 });
      await engine.decide(proposal);

      engine.recordExecutionResult(proposal.id, false);

      const stats = engine.getStats();
      expect(stats.consecutiveFailures).toBe(1);
      expect(stats.isInCooldown).toBe(true);
    });

    it('emits execution_success event', async () => {
      const proposal = createProposal({ estimatedRisk: 20, estimatedImpact: 50 });
      await engine.decide(proposal);

      const handler = jest.fn();
      engine.on('execution_success', handler);

      engine.recordExecutionResult(proposal.id, true);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        proposalId: proposal.id,
      }));
    });

    it('emits execution_failure event', async () => {
      const proposal = createProposal({ estimatedRisk: 20, estimatedImpact: 50 });
      await engine.decide(proposal);

      const handler = jest.fn();
      engine.on('execution_failure', handler);

      engine.recordExecutionResult(proposal.id, false);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        proposalId: proposal.id,
      }));
    });
  });

  describe('getStats', () => {
    it('returns correct stats', async () => {
      await engine.decide(createProposal({ estimatedRisk: 20, estimatedImpact: 50 }));
      await engine.decide(createProposal({ estimatedRisk: 20, estimatedImpact: 50 }));

      const stats = engine.getStats();

      expect(stats.totalDecisions).toBe(2);
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.isInCooldown).toBe(false);
    });
  });

  describe('updateConfig', () => {
    it('updates config values', () => {
      engine.updateConfig({ autoApproveThreshold: 15 });

      const config = engine.getConfig();
      expect(config.autoApproveThreshold).toBe(15);
    });

    it('preserves unchanged config values', () => {
      engine.updateConfig({ autoApproveThreshold: 15 });

      const config = engine.getConfig();
      expect(config.requireManualAbove).toBe(70);
    });
  });

  describe('setDependencies', () => {
    it('allows setting custom dependency functions', () => {
      const mockIsCoreModule = jest.fn((target: string) => target.includes('special'));
      const mockGetCoverage = jest.fn(async (target: string) => 95);
      const mockGetSuccessRate = jest.fn(async (category: string, target: string) => 0.9);

      engine.setDependencies({
        isCoreModule: mockIsCoreModule,
        getTestCoverage: mockGetCoverage,
        getHistoricalSuccessRate: mockGetSuccessRate,
      });

      const proposal = createProposal({
        target: 'src/special/core.ts',
        data: { affectedFiles: ['src/special/core.ts'] },
      });

      const assessment = engine.assessRisk(proposal);

      // Should use custom isCoreModule
      expect(mockIsCoreModule).toHaveBeenCalledWith('src/special/core.ts');
    });
  });

  describe('edge cases', () => {
    it('handles proposal with missing data fields', () => {
      const proposal = createProposal({
        data: undefined,
      });

      const assessment = engine.assessRisk(proposal);

      expect(assessment.overall).toBeDefined();
      expect(assessment.factors.length).toBeGreaterThan(0);
    });

    it('handles proposal with empty affected files', () => {
      const proposal = createProposal({
        data: { affectedFiles: [] },
      });

      const assessment = engine.assessRisk(proposal);

      expect(assessment.overall).toBeDefined();
    });

    it('handles very high estimated risk', async () => {
      const proposal = createProposal({
        estimatedRisk: 100,
        estimatedImpact: 80,
        data: { coverage: 90, successRate: 0.9 },
      });

      const decision = await engine.decide(proposal);

      expect(decision.action).toBe('escalate');
    });

    it('handles zero estimated risk', async () => {
      const proposal = createProposal({
        estimatedRisk: 0,
        estimatedImpact: 80,
        data: { coverage: 100, successRate: 1.0 },
      });

      const decision = await engine.decide(proposal);

      expect(decision.action).toBe('approve');
    });
  });
});

// -------------------------------------------------------------------------
// Integration-style Tests
// -------------------------------------------------------------------------

describe('DecisionEngine - Integration Scenarios', () => {
  let engine: DecisionEngine;

  beforeEach(() => {
    engine = new DecisionEngine({
      autoApproveThreshold: 30,
      requireManualAbove: 70,
    });
  });

  it('full workflow: approve, execute, record success', async () => {
    const proposal = createProposal({
      estimatedRisk: 20,
      estimatedImpact: 60,
      data: { coverage: 90, successRate: 0.9 },
    });

    // Make decision
    const decision = await engine.decide(proposal);
    expect(decision.action).toBe('approve');

    // Record success
    engine.recordExecutionResult(proposal.id, true);

    const stats = engine.getStats();
    expect(stats.consecutiveFailures).toBe(0);
    expect(stats.isInCooldown).toBe(false);
  });

  it('full workflow: approve, execute, record failure, subsequent decisions deferred', async () => {
    const proposal1 = createProposal({ id: 'p1', estimatedRisk: 20, estimatedImpact: 60 });
    const proposal2 = createProposal({ id: 'p2', estimatedRisk: 20, estimatedImpact: 60 });

    // First decision succeeds
    await engine.decide(proposal1);
    engine.recordExecutionResult(proposal1.id, true);

    // Second decision fails
    await engine.decide(proposal2);
    engine.recordExecutionResult(proposal2.id, false);

    // Third decision should be deferred
    const proposal3 = createProposal({ id: 'p3', estimatedRisk: 20, estimatedImpact: 60 });
    const decision3 = await engine.decide(proposal3);

    expect(decision3.action).toBe('defer');
  });

  it('proposal with all risk factors maximized gets escalated', async () => {
    const proposal = createProposal({
      target: 'src/stratix-gateway/core.ts',
      estimatedRisk: 90,
      estimatedEffort: 'high',
      data: {
        coverage: 20,
        successRate: 0.2,
        affectedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      },
    });

    const decision = await engine.decide(proposal);

    expect(decision.action).toBe('escalate');
    expect(decision.confidence).toBeLessThan(0.5);
  });

  it('proposal with minimal risk factors gets auto-approved', async () => {
    const proposal = createProposal({
      target: 'src/utils.ts',
      estimatedRisk: 10,
      estimatedEffort: 'low',
      data: {
        coverage: 95,
        successRate: 0.95,
        affectedFiles: ['src/utils.ts'],
      },
    });

    const decision = await engine.decide(proposal);

    expect(decision.action).toBe('approve');
    expect(decision.confidence).toBeGreaterThan(0.8);
  });
});
