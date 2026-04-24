// ============================================
// SystemZoneCycle 单元测试
// ============================================

import { SystemZoneCycle } from '../SystemZoneCycle';
import type { SystemZoneManager } from '../SystemZoneManager';
import type { SafetyAssessment } from '../types';
import type { FitnessReport } from '../fitness/types';

// ------------------------------------------------
// Mock FitnessEvaluator
// ------------------------------------------------
const mockEvaluate = jest.fn();
jest.mock('../fitness/FitnessEvaluator', () => ({
  FitnessEvaluator: jest.fn().mockImplementation(() => ({
    evaluate: mockEvaluate,
  })),
}));

// ------------------------------------------------
// Mock DiffApplier
// ------------------------------------------------
const mockRollbackDiff = jest.fn();
jest.mock('../executor/DiffApplier', () => ({
  DiffApplier: jest.fn().mockImplementation(() => ({
    rollbackDiff: mockRollbackDiff,
  })),
}));

// ------------------------------------------------
// Types
// ------------------------------------------------
interface MockAgent {
  executeSkill: jest.Mock;
}

interface MockAgents {
  observer?: MockAgent;
  strategist?: MockAgent;
  executor?: MockAgent;
  guardian?: MockAgent;
}

// ------------------------------------------------
// Helpers
// ------------------------------------------------

function makeFitnessReport(overall: number): FitnessReport {
  return {
    timestamp: new Date(),
    metrics: {
      testCoverage: overall,
      cyclomaticComplexity: 10,
      duplicationRate: 5,
      responseTime: 100,
      errorRate: 0,
    },
    scores: {
      codeQuality: overall,
      performance: overall,
      systemHealth: overall,
      overall,
    },
    passed: overall >= 60,
    violations: [],
  };
}

function makeSafetyAssessment(
  decision: SafetyAssessment['decision'],
  riskLevel: SafetyAssessment['riskLevel'],
  concerns: string[] = [],
): SafetyAssessment {
  return {
    decision,
    riskLevel,
    concerns,
    suggestions: [],
    confidence: 0.9,
  };
}

function makeModificationPlan(title = 'Test Plan', modifications: any[] = []) {
  return {
    title,
    modifications,
    riskLevel: 'low',
    effortEstimate: 'small',
    description: '',
    reasoning: '',
  };
}

// Create mock agents with executeSkill
function createMockAgents(overrides: Partial<MockAgents> = {}): MockAgents {
  const defaultAgent: MockAgent = { executeSkill: jest.fn() };
  return {
    observer: { ...defaultAgent, ...overrides.observer },
    strategist: { ...defaultAgent, ...overrides.strategist },
    executor: { ...defaultAgent, ...overrides.executor },
    guardian: { ...defaultAgent, ...overrides.guardian },
  };
}

// Create a mock SystemZoneManager
function createMockManager(agents: MockAgents): SystemZoneManager {
  const mockManager = {
    getAgents: jest.fn().mockReturnValue(agents),
  } as unknown as SystemZoneManager;
  return mockManager;
}

// Create cycle with mocked manager
function createCycle(agents: MockAgents): SystemZoneCycle {
  const manager = createMockManager(agents);
  return new SystemZoneCycle(manager);
}

// ------------------------------------------------
// Setup
// ------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  mockEvaluate.mockResolvedValue(makeFitnessReport(75));
  mockRollbackDiff.mockResolvedValue(undefined);
});

// ------------------------------------------------
// Tests
// ------------------------------------------------

describe('SystemZoneCycle', () => {
  // ---- Test 1: Full cycle (normal flow) ----
  describe('full cycle (normal flow)', () => {
    it('should complete full cycle successfully', async () => {
      const baselineReport = makeFitnessReport(75);
      const afterReport = makeFitnessReport(80);
      mockEvaluate
        .mockResolvedValueOnce(baselineReport) // baseline
        .mockResolvedValueOnce(afterReport);    // after execute

      const agents = createMockAgents({
        observer: {
          executeSkill: jest
            .fn()
            .mockResolvedValueOnce({
              success: true,
              result: [{ type: 'issue', content: 'test issue' }],
            })
            .mockResolvedValueOnce({
              success: true,
              result: { coverage: { files: 10, covered: 8 } },
            }),
        },
        strategist: {
          executeSkill: jest.fn().mockResolvedValue({
            success: true,
            result: {
              title: 'Test Plan',
              modifications: [
                {
                  type: 'edit',
                  path: 'test.ts',
                  diff: '--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new',
                  description: 'fix',
                },
              ],
              riskLevel: 'low',
              effortEstimate: 'small',
              description: '',
              reasoning: '',
            },
          }),
        },
        guardian: {
          executeSkill: jest.fn().mockResolvedValue({
            success: true,
            result: {
              decision: 'approved',
              riskLevel: 'low',
              concerns: [],
              suggestions: [],
              confidence: 0.9,
            },
          }),
        },
        executor: {
          executeSkill: jest
            .fn()
            .mockResolvedValueOnce({ success: true, result: { valid: true, errors: [] } })
            .mockResolvedValueOnce({
              success: true,
              result: { success: true, appliedFiles: ['test.ts'], errors: [] },
            }),
        },
      });

      const cycle = createCycle(agents);
      const state = await cycle.run();

      expect(state.phase).toBe('completed');
      expect(state.startedAt).toBeTruthy();
      expect(state.completedAt).toBeTruthy();
      expect(state.lastError).toBeNull();
      expect(state.insights).toBeDefined();
      expect(state.fitnessReport).toBeDefined();
    });
  });

  // ---- Test 2: Guardian rejected → cycle fails ----
  describe('Guardian rejected', () => {
    it('should transition to failed when Guardian rejects', async () => {
      const baselineReport = makeFitnessReport(75);
      mockEvaluate.mockResolvedValueOnce(baselineReport);

      const agents = createMockAgents({
        observer: {
          executeSkill: jest
            .fn()
            .mockResolvedValueOnce({
              success: true,
              result: [{ type: 'issue', content: 'test issue' }],
            })
            .mockResolvedValueOnce({
              success: true,
              result: { coverage: { files: 10, covered: 8 } },
            }),
        },
        strategist: {
          executeSkill: jest.fn().mockResolvedValue({
            success: true,
            result: {
              title: 'Test Plan',
              modifications: [
                {
                  type: 'edit',
                  path: 'test.ts',
                  diff: '--- a/test.ts\n+++ b/test.ts',
                  description: 'fix',
                },
              ],
              riskLevel: 'low',
              effortEstimate: 'small',
              description: '',
              reasoning: '',
            },
          }),
        },
        guardian: {
          executeSkill: jest.fn().mockResolvedValue({
            success: true,
            result: {
              decision: 'rejected',
              riskLevel: 'high',
              concerns: ['unsafe'],
              suggestions: [],
              confidence: 1.0,
            },
          }),
        },
        executor: {
          executeSkill: jest.fn(),
        },
      });

      const cycle = createCycle(agents);
      const state = await cycle.run();

      expect(state.phase).toBe('failed');
      expect(state.lastError).toContain('Guardian rejected');
    });
  });

  // ---- Test 3: Guardian high risk → blocked ----
  describe('Guardian high risk', () => {
    it('should transition to blocked when Guardian returns high risk', async () => {
      const baselineReport = makeFitnessReport(75);
      mockEvaluate.mockResolvedValueOnce(baselineReport);

      const agents = createMockAgents({
        observer: {
          executeSkill: jest
            .fn()
            .mockResolvedValueOnce({
              success: true,
              result: [{ type: 'issue', content: 'test issue' }],
            })
            .mockResolvedValueOnce({
              success: true,
              result: { coverage: { files: 10, covered: 8 } },
            }),
        },
        strategist: {
          executeSkill: jest.fn().mockResolvedValue({
            success: true,
            result: {
              title: 'Test Plan',
              modifications: [
                {
                  type: 'edit',
                  path: 'test.ts',
                  diff: '--- a/test.ts\n+++ b/test.ts',
                  description: 'fix',
                },
              ],
              riskLevel: 'low',
              effortEstimate: 'small',
              description: '',
              reasoning: '',
            },
          }),
        },
        guardian: {
          executeSkill: jest.fn().mockResolvedValue({
            success: true,
            result: {
              decision: 'conditional',
              riskLevel: 'high',
              concerns: ['review'],
              suggestions: [],
              confidence: 0.8,
            },
          }),
        },
        executor: {
          executeSkill: jest.fn(),
        },
      });

      const cycle = createCycle(agents);
      const state = await cycle.run();

      expect(state.phase).toBe('blocked');
    });

    it('should continue to completed after confirmAndContinue', async () => {
      const baselineReport = makeFitnessReport(75);
      const afterReport = makeFitnessReport(80);
      mockEvaluate
        .mockResolvedValueOnce(baselineReport)
        .mockResolvedValueOnce(afterReport);

      const agents = createMockAgents({
        observer: {
          executeSkill: jest
            .fn()
            .mockResolvedValueOnce({
              success: true,
              result: [{ type: 'issue', content: 'test issue' }],
            })
            .mockResolvedValueOnce({
              success: true,
              result: { coverage: { files: 10, covered: 8 } },
            }),
        },
        strategist: {
          executeSkill: jest.fn().mockResolvedValue({
            success: true,
            result: {
              title: 'Test Plan',
              modifications: [
                {
                  type: 'edit',
                  path: 'test.ts',
                  diff: '--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new',
                  description: 'fix',
                },
              ],
              riskLevel: 'low',
              effortEstimate: 'small',
              description: '',
              reasoning: '',
            },
          }),
        },
        guardian: {
          executeSkill: jest.fn().mockResolvedValue({
            success: true,
            result: {
              decision: 'conditional',
              riskLevel: 'high',
              concerns: ['review'],
              suggestions: [],
              confidence: 0.8,
            },
          }),
        },
        executor: {
          executeSkill: jest
            .fn()
            .mockResolvedValueOnce({ success: true, result: { valid: true, errors: [] } })
            .mockResolvedValueOnce({
              success: true,
              result: { success: true, appliedFiles: ['test.ts'], errors: [] },
            }),
        },
      });

      const cycle = createCycle(agents);
      const blockedState = await cycle.run();
      expect(blockedState.phase).toBe('blocked');

      // Now confirm and continue
      const finalState = await cycle.confirmAndContinue();
      expect(finalState.phase).toBe('completed');
      expect(finalState.completedAt).toBeTruthy();
    });
  });

  // ---- Test 4: blocked → cancel ----
  describe('blocked → cancel', () => {
    it('should transition to failed with Cancelled by user', async () => {
      const baselineReport = makeFitnessReport(75);
      mockEvaluate.mockResolvedValueOnce(baselineReport);

      const agents = createMockAgents({
        observer: {
          executeSkill: jest
            .fn()
            .mockResolvedValueOnce({
              success: true,
              result: [{ type: 'issue', content: 'test issue' }],
            })
            .mockResolvedValueOnce({
              success: true,
              result: { coverage: { files: 10, covered: 8 } },
            }),
        },
        strategist: {
          executeSkill: jest.fn().mockResolvedValue({
            success: true,
            result: {
              title: 'Test Plan',
              modifications: [
                {
                  type: 'edit',
                  path: 'test.ts',
                  diff: '--- a/test.ts\n+++ b/test.ts',
                  description: 'fix',
                },
              ],
              riskLevel: 'low',
              effortEstimate: 'small',
              description: '',
              reasoning: '',
            },
          }),
        },
        guardian: {
          executeSkill: jest.fn().mockResolvedValue({
            success: true,
            result: {
              decision: 'conditional',
              riskLevel: 'high',
              concerns: ['review'],
              suggestions: [],
              confidence: 0.8,
            },
          }),
        },
        executor: {
          executeSkill: jest.fn(),
        },
      });

      const cycle = createCycle(agents);
      const blockedState = await cycle.run();
      expect(blockedState.phase).toBe('blocked');

      cycle.cancel();
      const finalState = cycle.getState();

      expect(finalState.phase).toBe('failed');
      expect(finalState.lastError).toBe('Cancelled by user');
    });
  });
});