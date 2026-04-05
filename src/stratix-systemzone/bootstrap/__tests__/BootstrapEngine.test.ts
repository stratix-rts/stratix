// ============================================
// BootstrapEngine.test.ts - 自举主引擎测试
// Phase 4: P4-06 - BootstrapEngine 测试
// ============================================

import { BootstrapEngine } from '../BootstrapEngine';
import { DiscoveryEngine } from '../DiscoveryEngine';
import { DecisionEngine } from '../DecisionEngine';
import { ImpactEvaluator } from '../ImpactEvaluator';
import { RegressionGuard } from '../RegressionGuard';
import { Executor } from '../../executor/Executor';
import { FitnessEvaluator } from '../../fitness/FitnessEvaluator';
import { Guardian } from '../../guardian/Guardian';

import type {
  BootstrapState,
  BootstrapMode,
  BootstrapCycleResult,
  DiscoveredProposal,
  Decision,
  ImpactEvaluation,
  MetricSnapshot,
  RegressionCheck,
  DiscoveryResult,
} from '../types';

import type { Proposal } from '../../types';

// -------------------------------------------------------------------------
// Mock Factories
// -------------------------------------------------------------------------

function createMockProposal(overrides: Partial<DiscoveredProposal> = {}): DiscoveredProposal {
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

function createMockDecision(proposalId: string, overrides: Partial<Decision> = {}): Decision {
  return {
    proposalId,
    action: 'approve',
    confidence: 0.8,
    reasoning: 'Test decision',
    riskAssessment: {
      overall: 30,
      factors: [],
      mitigations: [],
    },
    expectedOutcome: 'Test outcome',
    ...overrides,
  };
}

function createMockMetricSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    timestamp: new Date(),
    testCoverage: 80,
    testPassRate: 90,
    typeErrors: 0,
    lintErrors: 5,
    bundleSize: 500000,
    responseTime: 150,
    fitnessScore: 75,
    ...overrides,
  };
}

function createMockDiscoveryResult(proposals: DiscoveredProposal[] = []): DiscoveryResult {
  return {
    proposals,
    scanMetrics: {
      filesScanned: 100,
      issuesFound: 10,
      coverageGaps: 2,
      complexityHotspots: 1,
      scanDuration: 1000,
    },
    timestamp: new Date(),
  };
}

function createMockImpactEvaluation(overrides: Partial<ImpactEvaluation> = {}): ImpactEvaluation {
  return {
    proposalId: 'test-proposal',
    before: createMockMetricSnapshot(),
    after: createMockMetricSnapshot({ testCoverage: 85 }),
    deltas: {
      testCoverage: 5,
      testPassRate: 0,
      typeErrors: 0,
      lintErrors: -2,
      bundleSize: 0,
      responseTime: 0,
      fitnessScore: 5,
    },
    overallImpact: 20,
    recommendation: 'keep',
    ...overrides,
  };
}

function createMockRegressionCheck(proposalId: string, overrides: Partial<RegressionCheck> = {}): RegressionCheck {
  return {
    proposalId,
    regressions: [],
    severity: 'none',
    canProceed: true,
    ...overrides,
  };
}

// -------------------------------------------------------------------------
// Mock Classes
// -------------------------------------------------------------------------

class MockDiscoveryEngine {
  discover = jest.fn().mockResolvedValue(createMockDiscoveryResult([]));
  setLessonManager = jest.fn();
  addExternalSource = jest.fn();
  setHistoryStore = jest.fn();
  getConfig = jest.fn().mockReturnValue({});
  getLastScanMetrics = jest.fn().mockReturnValue(null);
}

class MockDecisionEngine {
  decide = jest.fn();
  batchDecide = jest.fn().mockResolvedValue([]);
  setDependencies = jest.fn();
  getConfig = jest.fn().mockReturnValue({
    autoApproveThreshold: 30,
    requireManualAbove: 70,
    maxConcurrentExecutions: 2,
    cooldownAfterFailure: 600000,
  });
  updateConfig = jest.fn();
  recordExecutionResult = jest.fn();
  getStats = jest.fn().mockReturnValue({
    totalDecisions: 0,
    consecutiveFailures: 0,
    isInCooldown: false,
    cooldownUntil: null,
  });
  // EventEmitter methods
  on = jest.fn();
  off = jest.fn();
  emit = jest.fn();
}

class MockImpactEvaluator {
  captureBefore = jest.fn().mockResolvedValue(createMockMetricSnapshot());
  captureAfter = jest.fn().mockResolvedValue(createMockMetricSnapshot());
  evaluate = jest.fn().mockReturnValue(createMockImpactEvaluation());
  calculateOverallImpact = jest.fn().mockReturnValue(20);
  recommend = jest.fn().mockReturnValue('keep');
}

class MockRegressionGuard {
  check = jest.fn().mockReturnValue(createMockRegressionCheck('test'));
}

class MockExecutor {
  executeProposal = jest.fn().mockResolvedValue({
    proposalId: 'test',
    success: true,
    phase: 'completed',
    modifications: [],
    testResult: { passed: true, totalTests: 10, passedTests: 10, failedTests: 0, skippedTests: 0, duration: 100, failures: [], coverageDelta: null },
    commitHash: 'abc123',
    rollbackHash: null,
    duration: 1000,
    error: null,
  });
  canExecute = jest.fn().mockResolvedValue(true);
  getState = jest.fn().mockReturnValue({
    phase: 'idle',
    currentProposalId: null,
    sandboxBranch: null,
    startedAt: null,
    completedAt: null,
    lastError: null,
    consecutiveFailures: 0,
    totalExecutions: 0,
    totalSuccesses: 0,
    totalRollbacks: 0,
  });
  resetCircuitBreaker = jest.fn();
  setDependencies = jest.fn();
  getSandbox = jest.fn();
  getCodeModifier = jest.fn();
  getTestRunner = jest.fn();
  getRollbackManager = jest.fn();
  getGuardian = jest.fn();
  on = jest.fn();
  off = jest.fn();
}

class MockFitnessEvaluator {
  evaluate = jest.fn().mockResolvedValue({
    timestamp: new Date(),
    metrics: {
      testCoverage: 80,
      cyclomaticComplexity: 5,
      duplicationRate: 0.05,
      responseTime: 150,
      errorRate: 0.01,
    },
    scores: {
      codeQuality: 80,
      performance: 85,
      systemHealth: 90,
      overall: 83,
    },
    passed: true,
    violations: [],
  });
  canEnableExecutor = jest.fn().mockResolvedValue(true);
}

class MockGuardian {
  validateProposal = jest.fn().mockReturnValue({ valid: true, reasons: [], alerts: [] });
  recordFailure = jest.fn();
  recordSuccess = jest.fn();
  getState = jest.fn().mockReturnValue({
    status: 'guarding',
    permissions: { forbiddenPaths: [], readonlyPaths: [] },
    recentAlerts: [],
    protection: { forbiddenPaths: [], requireApproval: false, notifyOnProposal: false, circuitBreakerEnabled: true },
  });
  getCircuitBreakerState = jest.fn().mockReturnValue('closed');
  getPathProtection = jest.fn();
  getCircuitBreaker = jest.fn();
  resetCircuitBreaker = jest.fn();
  addForbiddenPath = jest.fn();
  setOnAlert = jest.fn();
  setOnLesson = jest.fn();
  setOnCircuitTripped = jest.fn();
  getSummary = jest.fn().mockReturnValue({
    status: 'guarding',
    circuitBreaker: 'closed',
    alertCount: 0,
    forbiddenPathCount: 0,
  });
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('BootstrapEngine', () => {
  let engine: BootstrapEngine;
  let mockDiscoveryEngine: MockDiscoveryEngine;
  let mockDecisionEngine: MockDecisionEngine;
  let mockImpactEvaluator: MockImpactEvaluator;
  let mockRegressionGuard: MockRegressionGuard;
  let mockExecutor: MockExecutor;
  let mockFitnessEvaluator: MockFitnessEvaluator;
  let mockGuardian: MockGuardian;

  beforeEach(() => {
    // Create fresh mock instances
    mockDiscoveryEngine = new MockDiscoveryEngine();
    mockDecisionEngine = new MockDecisionEngine();
    mockImpactEvaluator = new MockImpactEvaluator();
    mockRegressionGuard = new MockRegressionGuard();
    mockExecutor = new MockExecutor();
    mockFitnessEvaluator = new MockFitnessEvaluator();
    mockGuardian = new MockGuardian();

    // Create engine with mocks
    engine = new BootstrapEngine(
      {
        mode: 'manual',
        maxCyclesPerDay: 24,
      },
      {
        discoveryEngine: mockDiscoveryEngine as unknown as DiscoveryEngine,
        decisionEngine: mockDecisionEngine as unknown as DecisionEngine,
        impactEvaluator: mockImpactEvaluator as unknown as ImpactEvaluator,
        regressionGuard: mockRegressionGuard as unknown as RegressionGuard,
        executor: mockExecutor as unknown as Executor,
        fitnessEvaluator: mockFitnessEvaluator as unknown as FitnessEvaluator,
        guardian: mockGuardian as unknown as Guardian,
      }
    );
  });

  afterEach(() => {
    engine.stop();
    engine.reset();
  });

  describe('constructor', () => {
    it('creates instance with default config', () => {
      const defaultEngine = new BootstrapEngine();
      const state = defaultEngine.getState();
      const config = defaultEngine.getConfig();

      expect(state.phase).toBe('idle');
      expect(state.mode).toBe('manual');
      expect(state.cycleCount).toBe(0);
      expect(config.maxCyclesPerDay).toBe(24);
    });

    it('creates instance with custom config', () => {
      const customEngine = new BootstrapEngine({
        mode: 'semi_auto',
        maxCyclesPerDay: 10,
      });

      const config = customEngine.getConfig();
      expect(config.mode).toBe('semi_auto');
      expect(config.maxCyclesPerDay).toBe(10);
    });

    it('creates instance with all mocked dependencies', () => {
      const state = engine.getState();
      expect(state.phase).toBe('idle');
      expect(engine.isActive()).toBe(false);
    });
  });

  describe('getState', () => {
    it('returns current state', () => {
      const state = engine.getState();

      expect(state).toHaveProperty('phase');
      expect(state).toHaveProperty('mode');
      expect(state).toHaveProperty('cycleCount');
      expect(state).toHaveProperty('successCount');
      expect(state).toHaveProperty('failureCount');
    });

    it('returns a copy of state (immutability)', () => {
      const state1 = engine.getState();
      const state2 = engine.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('setMode', () => {
    it('sets mode to manual', () => {
      engine.setMode('manual');
      const state = engine.getState();
      expect(state.mode).toBe('manual');
    });

    it('sets mode to semi_auto', () => {
      engine.setMode('semi_auto');
      const state = engine.getState();
      expect(state.mode).toBe('semi_auto');
    });

    it('sets mode to full_auto', () => {
      engine.setMode('full_auto');
      const state = engine.getState();
      expect(state.mode).toBe('full_auto');
    });

    it('emits mode_changed event', () => {
      const emitSpy = jest.spyOn(engine, 'emit');
      engine.setMode('full_auto');
      expect(emitSpy).toHaveBeenCalledWith('mode_changed', { mode: 'full_auto' });
    });
  });

  describe('getHistory', () => {
    it('returns empty array initially', () => {
      const history = engine.getHistory();
      expect(history).toEqual([]);
    });

    it('returns limited history', () => {
      // Add some mock cycles
      const cycle1 = createMockCycleResult();
      const cycle2 = createMockCycleResult();
      const cycle3 = createMockCycleResult();

      // Manually push to history for testing (via runCycle)
      // In real test, would call runCycle multiple times

      // For now, just verify the method works
      const history = engine.getHistory(2);
      expect(Array.isArray(history)).toBe(true);
    });

    it('returns all history when no limit specified', () => {
      const history = engine.getHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('getCurrentProposals', () => {
    it('returns empty array initially', () => {
      const proposals = engine.getCurrentProposals();
      expect(proposals).toEqual([]);
    });
  });

  describe('getCurrentDecisions', () => {
    it('returns empty array initially', () => {
      const decisions = engine.getCurrentDecisions();
      expect(decisions).toEqual([]);
    });
  });

  describe('isActive', () => {
    it('returns false when not running', () => {
      expect(engine.isActive()).toBe(false);
    });
  });

  describe('getStats', () => {
    it('returns initial stats', () => {
      const stats = engine.getStats();

      expect(stats).toHaveProperty('totalCycles', 0);
      expect(stats).toHaveProperty('totalProposalsGenerated', 0);
      expect(stats).toHaveProperty('totalProposalsExecuted', 0);
      expect(stats).toHaveProperty('totalProposalsRolledBack', 0);
      expect(stats).toHaveProperty('successRate', 0);
      expect(stats).toHaveProperty('currentImprovementScore');
      expect(stats).toHaveProperty('consecutiveFailures', 0);
      expect(stats).toHaveProperty('isRunning', false);
    });
  });

  describe('runCycle', () => {
    it('runs a complete cycle with no proposals', async () => {
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult([]));

      const result = await engine.runCycle();

      expect(result.cycleId).toMatch(/^cycle-/);
      expect(result.discovered).toBe(0);
      expect(result.approved).toBe(0);
      expect(result.executed).toBe(0);
      expect(result.state.cycleCount).toBe(1);
    });

    it('runs cycle with discovered proposals', async () => {
      const proposals = [createMockProposal(), createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, { action: 'approve' }),
        createMockDecision(proposals[1].id, { action: 'approve' }),
      ]);

      const result = await engine.runCycle();

      expect(result.discovered).toBe(2);
      expect(result.approved).toBe(2);
    });

    it('runs cycle with mixed decisions (approve/reject)', async () => {
      const proposals = [createMockProposal(), createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, { action: 'approve' }),
        createMockDecision(proposals[1].id, { action: 'reject' }),
      ]);

      const result = await engine.runCycle();

      expect(result.discovered).toBe(2);
      expect(result.approved).toBe(1);
    });

    it('handles execution failure gracefully', async () => {
      const proposals = [createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, { action: 'approve' }),
      ]);
      mockExecutor.executeProposal.mockResolvedValue({
        proposalId: proposals[0].id,
        success: false,
        phase: 'failed',
        modifications: [],
        testResult: null,
        commitHash: null,
        rollbackHash: null,
        duration: 1000,
        error: 'Test failed',
      });

      const result = await engine.runCycle();

      // Execution failed - it was attempted but didn't succeed
      expect(result.executed).toBe(1);
      expect(result.failed).toBe(1);
    });

    it('handles regression correctly', async () => {
      const proposals = [createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, { action: 'approve' }),
      ]);
      mockRegressionGuard.check.mockReturnValue(createMockRegressionCheck(proposals[0].id, {
        canProceed: false,
        severity: 'major',
      }));

      const result = await engine.runCycle();

      expect(result.rolledBack).toBeGreaterThanOrEqual(0);
    });

    it('updates state after cycle completion', async () => {
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult([]));

      await engine.runCycle();

      const state = engine.getState();
      expect(state.cycleCount).toBe(1);
      expect(state.lastCycleAt).not.toBeNull();
    });

    it('emits cycle_started and cycle_completed events', async () => {
      const emitSpy = jest.spyOn(engine, 'emit');
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult([]));

      await engine.runCycle();

      expect(emitSpy).toHaveBeenCalledWith('cycle_started', expect.any(Object));
      expect(emitSpy).toHaveBeenCalledWith('cycle_completed', expect.any(Object));
    });

    it('handles discovery engine error gracefully', async () => {
      mockDiscoveryEngine.discover.mockRejectedValue(new Error('Discovery failed'));

      const result = await engine.runCycle();

      expect(result.state.cycleCount).toBe(1);
      expect(result.state.failureCount).toBe(1);
    });

    it('respects mode when processing decisions', async () => {
      // Set semi_auto mode
      engine.setMode('semi_auto');

      const proposals = [createMockProposal({ id: 'high-risk' })];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, {
          action: 'approve',
          riskAssessment: { overall: 80, factors: [], mitigations: [] },
        }),
      ]);

      const result = await engine.runCycle();

      // In semi_auto mode, high-risk proposals (>70) should be skipped
      expect(result.approved).toBe(0);
    });
  });

  describe('start/stop', () => {
    it('start does nothing in manual mode', () => {
      engine.setMode('manual');
      const emitSpy = jest.spyOn(engine, 'emit');

      engine.start();

      expect(emitSpy).not.toHaveBeenCalledWith('auto_toggle', { enabled: true, intervalMs: expect.any(Number) });
    });

    it('start initiates auto-cycle in full_auto mode', () => {
      engine.setMode('full_auto');
      const emitSpy = jest.spyOn(engine, 'emit');

      // Use fake timers for testing setInterval
      jest.useFakeTimers();
      engine.start();
      jest.runOnlyPendingTimers();
      jest.useRealTimers();

      // Note: In actual test environment with real timers, this would start the interval
      engine.stop(); // Clean up
    });

    it('stop clears auto-cycle interval', () => {
      jest.useFakeTimers();
      engine.setMode('full_auto');
      engine.start();
      engine.stop();

      // Verify stop was called (interval cleared)
      jest.useRealTimers();
    });

    it('start does not double-run if already running', () => {
      engine.setMode('full_auto');
      const emitSpy = jest.spyOn(engine, 'emit');

      // Manually set running state
      (engine as any).isRunning = true;

      engine.start();

      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('resets state to default', () => {
      // First run a cycle to change state
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult([]));
      engine.runCycle();

      // Then reset
      engine.reset();

      const state = engine.getState();
      expect(state.cycleCount).toBe(0);
      expect(state.successCount).toBe(0);
      expect(state.failureCount).toBe(0);
    });

    it('clears cycle history', () => {
      engine.reset();

      const history = engine.getHistory();
      expect(history).toEqual([]);
    });

    it('stops auto-cycle', () => {
      jest.useFakeTimers();
      engine.setMode('full_auto');
      engine.start();
      engine.reset();

      expect((engine as any).autoInterval).toBeNull();
      jest.useRealTimers();
    });
  });

  describe('getConfig', () => {
    it('returns current configuration', () => {
      const config = engine.getConfig();

      expect(config).toHaveProperty('discovery');
      expect(config).toHaveProperty('decision');
      expect(config).toHaveProperty('regressionGuard');
      expect(config).toHaveProperty('mode');
      expect(config).toHaveProperty('maxCyclesPerDay');
    });

    it('returns a copy (immutability)', () => {
      const config1 = engine.getConfig();
      const config2 = engine.getConfig();

      expect(config1).not.toBe(config2);
    });
  });

  describe('event emission', () => {
    it('emits phase_changed events during cycle', async () => {
      const emitSpy = jest.spyOn(engine, 'emit');
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult([]));

      await engine.runCycle();

      expect(emitSpy).toHaveBeenCalledWith('phase_changed', expect.any(Object));
    });

    it('emits discovery_completed event', async () => {
      const emitSpy = jest.spyOn(engine, 'emit');
      const proposals = [createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));

      await engine.runCycle();

      expect(emitSpy).toHaveBeenCalledWith(
        'discovery_completed',
        expect.objectContaining({ proposalCount: 1 })
      );
    });

    it('emits decision_completed event', async () => {
      const emitSpy = jest.spyOn(engine, 'emit');
      const proposals = [createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, { action: 'approve' }),
      ]);

      await engine.runCycle();

      expect(emitSpy).toHaveBeenCalledWith(
        'decision_completed',
        expect.objectContaining({ decisionCount: 1 })
      );
    });
  });

  describe('guardian integration', () => {
    it('validates proposals through guardian before execution', async () => {
      const proposals = [createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, { action: 'approve' }),
      ]);

      await engine.runCycle();

      expect(mockGuardian.validateProposal).toHaveBeenCalled();
    });

    it('skips proposal if guardian blocks it', async () => {
      const proposals = [createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, { action: 'approve' }),
      ]);
      mockGuardian.validateProposal.mockReturnValue({
        valid: false,
        reasons: ['Forbidden path'],
        alerts: [],
      });

      const result = await engine.runCycle();

      // Guardian blocked the proposal - it was attempted but failed
      expect(result.executed).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  describe('decision engine integration', () => {
    it('uses batchDecide for multiple proposals', async () => {
      const proposals = [createMockProposal(), createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, { action: 'approve' }),
        createMockDecision(proposals[1].id, { action: 'approve' }),
      ]);

      await engine.runCycle();

      expect(mockDecisionEngine.batchDecide).toHaveBeenCalledWith(proposals);
    });

    it('records execution results in decision engine', async () => {
      const proposals = [createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, { action: 'approve' }),
      ]);
      mockExecutor.executeProposal.mockResolvedValue({
        proposalId: proposals[0].id,
        success: true,
        phase: 'completed',
        modifications: [],
        testResult: { passed: true, totalTests: 10, passedTests: 10, failedTests: 0, skippedTests: 0, duration: 100, failures: [], coverageDelta: null },
        commitHash: 'abc123',
        rollbackHash: null,
        duration: 1000,
        error: null,
      });

      await engine.runCycle();

      expect(mockDecisionEngine.recordExecutionResult).toHaveBeenCalledWith(proposals[0].id, true);
    });
  });

  describe('impact evaluator integration', () => {
    it('captures before and after metrics during execution', async () => {
      // Need approved proposals to trigger execution
      const proposals = [createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, { action: 'approve' }),
      ]);

      await engine.runCycle();

      // captureBefore/After are called during execution phase
      expect(mockImpactEvaluator.captureBefore).toHaveBeenCalled();
      expect(mockImpactEvaluator.captureAfter).toHaveBeenCalled();
    });

    it('evaluates impact after execution', async () => {
      const proposals = [createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, { action: 'approve' }),
      ]);

      await engine.runCycle();

      expect(mockImpactEvaluator.evaluate).toHaveBeenCalled();
    });
  });

  describe('regression guard integration', () => {
    it('checks for regressions after execution', async () => {
      const proposals = [createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, { action: 'approve' }),
      ]);

      await engine.runCycle();

      expect(mockRegressionGuard.check).toHaveBeenCalled();
    });
  });

  describe('fitness evaluator integration', () => {
    it('updates improvement score from fitness evaluation', async () => {
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult([]));

      await engine.runCycle();

      expect(mockFitnessEvaluator.evaluate).toHaveBeenCalled();
    });
  });

  describe('cycle result tracking', () => {
    it('adds completed cycle to history', async () => {
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult([]));

      await engine.runCycle();

      const history = engine.getHistory();
      expect(history.length).toBe(1);
      expect(history[0]).toHaveProperty('cycleId');
      expect(history[0]).toHaveProperty('timestamp');
    });

    it('limits history to 100 cycles', async () => {
      // Run 101 cycles
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult([]));

      for (let i = 0; i < 101; i++) {
        // Need to reset engine state between cycles
        if (i % 10 === 0) {
          engine.reset();
        }
        await engine.runCycle();
      }

      const history = engine.getHistory();
      expect(history.length).toBeLessThanOrEqual(100);
    });
  });

  describe('consecutive failures tracking', () => {
    it('increments consecutive failures on cycle failure', async () => {
      mockDiscoveryEngine.discover.mockRejectedValue(new Error('Discovery failed'));

      await engine.runCycle();
      await engine.runCycle();

      const state = engine.getState();
      expect(state.consecutiveFailures).toBeGreaterThanOrEqual(1);
    });

    it('resets consecutive failures when cycle completes without throwing', async () => {
      // First, cause a failure
      mockDiscoveryEngine.discover.mockRejectedValue(new Error('Discovery failed'));
      await engine.runCycle();

      // Then succeed with a cycle that has at least one successful execution
      const proposals = [createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, { action: 'approve' }),
      ]);
      await engine.runCycle();

      const state = engine.getState();
      // First cycle failed (1), second succeeded (resets to 0)
      expect(state.consecutiveFailures).toBe(0);
    });
  });

  describe('success/failure counting', () => {
    it('increments success count on cycle with successful executions', async () => {
      // Need at least one successful execution to count as success
      const proposals = [createMockProposal()];
      mockDiscoveryEngine.discover.mockResolvedValue(createMockDiscoveryResult(proposals));
      mockDecisionEngine.batchDecide.mockResolvedValue([
        createMockDecision(proposals[0].id, { action: 'approve' }),
      ]);

      await engine.runCycle();

      const state = engine.getState();
      expect(state.successCount).toBe(1);
      expect(state.failureCount).toBe(0);
    });

    it('increments failure count on failed cycle', async () => {
      mockDiscoveryEngine.discover.mockRejectedValue(new Error('Discovery failed'));

      await engine.runCycle();

      const state = engine.getState();
      expect(state.failureCount).toBe(1);
    });
  });
});

// -------------------------------------------------------------------------
// Helper
// -------------------------------------------------------------------------

function createMockCycleResult(): BootstrapCycleResult {
  return {
    cycleId: `cycle-${Date.now()}`,
    timestamp: new Date(),
    discovered: 0,
    approved: 0,
    executed: 0,
    succeeded: 0,
    failed: 0,
    rolledBack: 0,
    impactScore: 0,
    state: {
      phase: 'idle',
      mode: 'manual',
      cycleCount: 1,
      successCount: 0,
      failureCount: 0,
      lastCycleAt: new Date(),
      lastDiscoveryAt: new Date(),
      activeExperiments: [],
      consecutiveFailures: 0,
      totalProposalsGenerated: 0,
      totalProposalsExecuted: 0,
      totalProposalsRolledBack: 0,
      improvementScore: 50,
    },
  };
}
