// ============================================
// SystemZone.test.ts - System Zone 集成测试
// Phase 1: Step 7 - 手动触发循环集成测试
// ============================================

import { EventEmitter } from 'events';
import { SystemZone } from '../SystemZone';
import type { Proposal, Insight, UserInput } from '../types';

// -------------------------------------------------------------------------
// Mock LLMConnector for Observer and Strategist
// -------------------------------------------------------------------------
const mockLLMGenerate = jest.fn();

jest.mock('../../stratix-agent/core/LLMConnector', () => ({
  LLMConnector: jest.fn().mockImplementation(() => ({
    generate: mockLLMGenerate,
  })),
}));

// -------------------------------------------------------------------------
// Mock child_process for ProjectScanner
// -------------------------------------------------------------------------
class MockChildProcess extends EventEmitter {
  stdout = new MockReadable();
  stderr = new MockReadable();
  kill = jest.fn();
  on = jest.fn((event: string, handler: (...args: any[]) => void) => {
    super.on(event, handler);
    return this;
  });
  off = jest.fn((event: string, handler: (...args: any[]) => void) => {
    super.off(event, handler);
    return this;
  });
}

class MockReadable extends EventEmitter {
  on = jest.fn((event: string, handler: (...args: any[]) => void) => {
    super.on(event, handler);
    return this;
  });
  off = jest.fn((event: string, handler: (...args: any[]) => void) => {
    super.off(event, handler);
    return this;
  });
  pipe = jest.fn(() => this);
}

const mockProc = new MockChildProcess();

jest.mock('child_process', () => ({
  spawn: jest.fn(() => mockProc),
}));

// -------------------------------------------------------------------------
// Helper functions
// -------------------------------------------------------------------------
const simulateSpawnOutput = (stdout: string, stderr: string, exitCode: number | null = 0) => {
  if (stdout) mockProc.stdout.emit('data', stdout);
  if (stderr) mockProc.stderr.emit('data', stderr);
  mockProc.emit('close', exitCode);
};

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------
describe('SystemZone', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProc.stdout.removeAllListeners();
    mockProc.stderr.removeAllListeners();
    mockProc.removeAllListeners();
  });

  describe('constructor', () => {
    it('creates instance with default config', () => {
      const systemZone = new SystemZone();
      expect(systemZone).toBeInstanceOf(SystemZone);
    });

    it('creates instance with custom config', () => {
      const systemZone = new SystemZone({
        ownerId: 'test-user',
        scanner: { timeoutMs: 5000 },
        guardian: {
          protection: {
            forbiddenPaths: ['**/test/**'],
            requireApproval: true,
            notifyOnProposal: true,
            circuitBreakerEnabled: true,
          },
        },
      });
      expect(systemZone).toBeInstanceOf(SystemZone);
    });

    it('initial state is active', () => {
      const systemZone = new SystemZone();
      const state = systemZone.getState();
      expect(state.status).toBe('active');
    });
  });

  describe('getState', () => {
    it('returns complete state with all subsystems', () => {
      const systemZone = new SystemZone();
      const state = systemZone.getState();

      expect(state).toHaveProperty('zoneId');
      expect(state).toHaveProperty('ownerId');
      expect(state).toHaveProperty('name');
      expect(state).toHaveProperty('status');
      expect(state).toHaveProperty('observer');
      expect(state).toHaveProperty('strategist');
      expect(state).toHaveProperty('guardian');

      // Observer state
      expect(state.observer).toHaveProperty('status');
      expect(state.observer).toHaveProperty('pendingInputs');
      expect(state.observer).toHaveProperty('processedInputs');
      expect(state.observer).toHaveProperty('insightsGenerated');

      // Strategist state
      expect(state.strategist).toHaveProperty('status');
      expect(state.strategist).toHaveProperty('lastScan');
      expect(state.strategist).toHaveProperty('lastAnalysis');
      expect(state.strategist).toHaveProperty('proposalCount');

      // Guardian state
      expect(state.guardian).toHaveProperty('status');
      expect(state.guardian).toHaveProperty('alertCount');
      expect(state.guardian).toHaveProperty('circuitBreakerState');
    });
  });

  describe('getSummary', () => {
    it('returns summary for all subsystems', () => {
      const systemZone = new SystemZone();
      const summary = systemZone.getSummary();

      expect(summary).toHaveProperty('status');
      expect(summary).toHaveProperty('observer');
      expect(summary).toHaveProperty('strategist');
      expect(summary).toHaveProperty('guardian');
    });
  });

  describe('getObserver / getStrategist / getGuardian', () => {
    it('returns the correct subsystem instances', () => {
      const systemZone = new SystemZone();

      expect(systemZone.getObserver()).toBeDefined();
      expect(systemZone.getStrategist()).toBeDefined();
      expect(systemZone.getGuardian()).toBeDefined();
    });
  });

  describe('addInput', () => {
    it('adds user input successfully', async () => {
      const systemZone = new SystemZone();

      const input = await systemZone.addInput('Test input content', 'idea');

      expect(input).toBeDefined();
      expect(input.content).toBe('Test input content');
      expect(input.type).toBe('idea');
    });

    it('accepts optional metadata', async () => {
      const systemZone = new SystemZone();

      const input = await systemZone.addInput('Test content', 'news', {
        url: 'https://example.com',
        tags: ['test', 'example'],
      });

      expect(input.metadata?.url).toBe('https://example.com');
      expect(input.metadata?.tags).toEqual(['test', 'example']);
    });
  });

  describe('observe', () => {
    it('returns empty array when no pending inputs', async () => {
      const systemZone = new SystemZone();
      const insights = await systemZone.observe();
      expect(insights).toEqual([]);
    });
  });

  describe('analyze', () => {
    it('runs strategist analysis without error', async () => {
      const systemZone = new SystemZone({
        scanner: { cacheEnabled: false },
      });

      // Mock scanner to return empty results quickly
      jest.spyOn(systemZone.getStrategist().getScanner(), 'scanAll').mockResolvedValue({
        success: true,
        scanResult: {
          timestamp: new Date(),
          coverage: {
            totalStatements: 0, totalBranches: 0, totalFunctions: 0, totalLines: 0,
            coveredStatements: 0, coveredBranches: 0, coveredFunctions: 0, coveredLines: 0,
            uncoveredFiles: [], threshold: 50,
          },
          types: { errors: [], warnings: [], success: true },
          lint: { errors: [], warnings: [], success: true, fatalErrorCount: 0 },
          sizes: { files: [], threshold: 500 },
        },
        errors: [],
        duration: { coverage: 0, typecheck: 0, lint: 0, fileSizes: 0, total: 0 },
      });

      // Should not throw even without LLM
      const proposals = await systemZone.analyze();
      expect(Array.isArray(proposals)).toBe(true);
    }, 10000);
  });

  describe('approveProposal', () => {
    it('returns error for non-existent proposal', async () => {
      const systemZone = new SystemZone();

      const result = await systemZone.approveProposal('non-existent-id', 'approve');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('setDependencies', () => {
    it('allows setting dependency functions', () => {
      const systemZone = new SystemZone();

      const saveInsight = jest.fn();
      const saveInput = jest.fn();
      const saveProposal = jest.fn();
      const getInsights = jest.fn().mockResolvedValue([]);
      const getProposals = jest.fn().mockResolvedValue([]);

      systemZone.setDependencies({
        saveInsight,
        saveInput,
        saveProposal,
        getInsights,
        getProposals,
      });

      // No error means success
      expect(true).toBe(true);
    });
  });

  describe('resetCircuitBreaker', () => {
    it('resets the Guardian circuit breaker', () => {
      const systemZone = new SystemZone();
      expect(() => systemZone.resetCircuitBreaker()).not.toThrow();
    });
  });

  describe('event system', () => {
    it('subscribes to events without throwing', () => {
      const systemZone = new SystemZone();

      // These should not throw
      expect(() => {
        systemZone.on('input_received', () => {});
        systemZone.on('status_changed', () => {});
        systemZone.on('insight_generated', () => {});
        systemZone.on('analysis_started', () => {});
        systemZone.on('analysis_completed', () => {});
        systemZone.on('proposal_generated', () => {});
      }).not.toThrow();
    });

    it('allows unsubscribing from events', () => {
      const systemZone = new SystemZone();

      const handler = jest.fn();
      systemZone.on('status_changed', handler);
      systemZone.off('status_changed', handler);

      expect(typeof systemZone.off).toBe('function');
    });
  });
});

describe('SystemZone - Manual Trigger Cycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProc.stdout.removeAllListeners();
    mockProc.stderr.removeAllListeners();
    mockProc.removeAllListeners();
  });

  describe('runCycle - Full Flow', () => {
    it('runs complete observe -> analyze cycle with mocked scanner', async () => {
      const systemZone = new SystemZone({
        scanner: { cacheEnabled: false },
      });

      // Mock scanner to return empty results
      jest.spyOn(systemZone.getStrategist().getScanner(), 'scanAll').mockResolvedValue({
        success: true,
        scanResult: {
          timestamp: new Date(),
          coverage: {
            totalStatements: 0, totalBranches: 0, totalFunctions: 0, totalLines: 0,
            coveredStatements: 0, coveredBranches: 0, coveredFunctions: 0, coveredLines: 0,
            uncoveredFiles: [], threshold: 50,
          },
          types: { errors: [], warnings: [], success: true },
          lint: { errors: [], warnings: [], success: true, fatalErrorCount: 0 },
          sizes: { files: [], threshold: 500 },
        },
        errors: [],
        duration: { coverage: 0, typecheck: 0, lint: 0, fileSizes: 0, total: 0 },
      });

      // Add initial input
      await systemZone.addInput('Test input for observation');

      // Run the full cycle
      const result = await systemZone.runCycle();

      expect(result).toHaveProperty('insights');
      expect(result).toHaveProperty('proposals');
      expect(result).toHaveProperty('errors');
      expect(Array.isArray(result.insights)).toBe(true);
      expect(Array.isArray(result.proposals)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
    }, 10000);
  });

  describe('Guardian Integration', () => {
    it('Guardian blocks proposals for protected paths', async () => {
      const systemZone = new SystemZone({
        scanner: { cacheEnabled: false },
        guardian: {
          protection: {
            forbiddenPaths: ['**/payment/**', '**/permission/**'],
            requireApproval: true,
            notifyOnProposal: true,
            circuitBreakerEnabled: true,
          },
        },
      });

      const guardian = systemZone.getGuardian();

      // Create a proposal targeting a protected path
      const protectedProposal: Proposal = {
        id: 'test-proposal-1',
        timestamp: new Date(),
        type: 'improve_code',
        title: 'Fix payment bug',
        description: 'Fix the payment processing bug',
        target: { file: 'src/payment/PaymentProcessor.ts' },
        selection: { confidence: 0.8, cost: 5, benefit: 7, risk: 'medium' },
        status: 'pending',
      };

      const validation = guardian.validateProposal(protectedProposal);

      expect(validation.valid).toBe(false);
      expect(validation.reasons.length).toBeGreaterThan(0);
    });

    it('Guardian allows proposals for normal paths', async () => {
      const systemZone = new SystemZone();

      const guardian = systemZone.getGuardian();

      // Create a proposal targeting a normal path
      const normalProposal: Proposal = {
        id: 'test-proposal-2',
        timestamp: new Date(),
        type: 'improve_code',
        title: 'Fix utility bug',
        description: 'Fix a utility function bug',
        target: { file: 'src/utils/helper.ts' },
        selection: { confidence: 0.8, cost: 3, benefit: 6, risk: 'low' },
        status: 'pending',
      };

      const validation = guardian.validateProposal(normalProposal);

      expect(validation.valid).toBe(true);
    });

    it('Guardian blocks .env file proposals', async () => {
      const systemZone = new SystemZone();

      const guardian = systemZone.getGuardian();

      const envProposal: Proposal = {
        id: 'test-proposal-3',
        timestamp: new Date(),
        type: 'improve_code',
        title: 'Update env config',
        description: 'Update environment configuration',
        target: { file: '.env.production' },
        selection: { confidence: 0.5, cost: 2, benefit: 4, risk: 'high' },
        status: 'pending',
      };

      const validation = guardian.validateProposal(envProposal);

      expect(validation.valid).toBe(false);
    });
  });

  describe('Observer + Strategist Integration', () => {
    it('Observer and Strategist are properly connected', () => {
      const systemZone = new SystemZone();

      const observer = systemZone.getObserver();
      const strategist = systemZone.getStrategist();

      expect(observer).toBeDefined();
      expect(strategist).toBeDefined();

      // Both should be operational
      expect(observer.getSummary()).toBeDefined();
      expect(strategist.getSummary()).toBeDefined();
    });
  });
});

describe('SystemZone - Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProc.stdout.removeAllListeners();
    mockProc.stderr.removeAllListeners();
    mockProc.removeAllListeners();
  });

  it('runCycle handles errors gracefully', async () => {
    const systemZone = new SystemZone({
      scanner: { timeoutMs: 1, cacheEnabled: false },
    });

    // Mock scanner to fail
    jest.spyOn(systemZone.getStrategist().getScanner(), 'scanAll').mockRejectedValue(new Error('Scan failed'));

    // This should not throw even if scanning fails
    try {
      const result = await systemZone.runCycle();
      expect(result).toBeDefined();
      expect(result.errors).toBeDefined();
    } catch {
      // Should not reach here - errors should be caught
      expect(true).toBe(false);
    }
  }, 10000);

  it('approveProposal handles errors for invalid proposals', async () => {
    const systemZone = new SystemZone();

    // Non-existent proposal
    const result = await systemZone.approveProposal('invalid-id', 'approve');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('SystemZone - State Management', () => {
  it('getState returns current state', () => {
    const systemZone = new SystemZone();
    const state = systemZone.getState();

    expect(state.status).toBe('active');
    expect(state.zoneId).toBeDefined();
    expect(state.ownerId).toBeDefined();
  });

  it('getSummary returns formatted summary', () => {
    const systemZone = new SystemZone();
    const summary = systemZone.getSummary();

    expect(summary.status).toBe('active');
    expect(summary.observer).toBeDefined();
    expect(summary.strategist).toBeDefined();
    expect(summary.guardian).toBeDefined();
  });

  it('ownerId is correctly set from config', () => {
    const systemZone = new SystemZone({ ownerId: 'custom-user' });
    const state = systemZone.getState();

    expect(state.ownerId).toBe('custom-user');
  });
});
