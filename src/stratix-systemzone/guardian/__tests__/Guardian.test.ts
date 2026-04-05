// ============================================
// Guardian.test.ts - 守护者测试
// Phase 1: Guardian 路径保护 + 熔断器
// ============================================

import { Guardian } from '../Guardian';
import type { Proposal, GuardianProtection } from '../../types';

describe('Guardian', () => {
  const createMockProposal = (overrides?: Partial<Proposal>): Proposal => ({
    id: 'proposal-1',
    timestamp: new Date(),
    type: 'improve_code',
    title: 'Test Proposal',
    description: 'Test description',
    target: { file: 'src/test.ts' },
    selection: { confidence: 0.8, cost: 5, benefit: 7, risk: 'medium' },
    status: 'pending',
    ...overrides,
  });

  const defaultProtection: GuardianProtection = {
    forbiddenPaths: ['**/payment/**', '**/permission/**', '**/.env*', '**/credentials/**'],
    requireApproval: true,
    notifyOnProposal: true,
    circuitBreakerEnabled: true,
  };

  const createGuardian = (config?: { protection?: GuardianProtection; maxConsecutiveFailures?: number; resetAfterMs?: number }) => {
    return new Guardian({
      protection: config?.protection ?? defaultProtection,
      circuitBreakerConfig: {
        maxConsecutiveFailures: config?.maxConsecutiveFailures ?? 3,
        resetAfterMs: config?.resetAfterMs ?? 60000,
      },
    });
  };

  describe('constructor', () => {
    test('creates instance with default config', () => {
      const guardian = createGuardian();
      expect(guardian).toBeInstanceOf(Guardian);
      expect(guardian.getState()).toBeDefined();
    });

    test('creates instance with custom circuit breaker config', () => {
      const guardian = createGuardian({ maxConsecutiveFailures: 5, resetAfterMs: 30000 });
      expect(guardian).toBeInstanceOf(Guardian);
    });
  });

  describe('validateProposal - path protection', () => {
    test('blocks proposal targeting forbidden path payment/**', () => {
      const guardian = createGuardian();
      const proposal = createMockProposal({ target: { file: 'src/payment/stripe.ts' } });

      const result = guardian.validateProposal(proposal);

      expect(result.valid).toBe(false);
      expect(result.alerts.length).toBeGreaterThan(0);
      expect(result.alerts[0].type).toBe('path_violation');
    });

    test('blocks proposal targeting forbidden path permission/**', () => {
      const guardian = createGuardian();
      const proposal = createMockProposal({ target: { file: 'src/permission/auth.ts' } });

      const result = guardian.validateProposal(proposal);

      expect(result.valid).toBe(false);
      expect(result.alerts.some((a) => a.type === 'path_violation')).toBe(true);
    });

    test('blocks proposal targeting .env file', () => {
      const guardian = createGuardian();
      const proposal = createMockProposal({ target: { file: '.env.production' } });

      const result = guardian.validateProposal(proposal);

      expect(result.valid).toBe(false);
    });

    test('blocks proposal targeting credentials/**', () => {
      const guardian = createGuardian();
      const proposal = createMockProposal({ target: { file: 'config/credentials/api.json' } });

      const result = guardian.validateProposal(proposal);

      expect(result.valid).toBe(false);
    });

    test('allows proposal targeting normal path', () => {
      const guardian = createGuardian();
      const proposal = createMockProposal({ target: { file: 'src/components/Button.ts' } });

      const result = guardian.validateProposal(proposal);

      expect(result.valid).toBe(true);
    });

    test('allows proposal without target file', () => {
      const guardian = createGuardian();
      const proposal = createMockProposal({ target: {} });

      const result = guardian.validateProposal(proposal);

      expect(result.valid).toBe(true);
    });

    test('allows proposal targeting node_modules (readonly path)', () => {
      const guardian = createGuardian();
      const proposal = createMockProposal({ target: { file: 'node_modules/lodash/index.js' } });

      const result = guardian.validateProposal(proposal);

      // readonly paths are allowed
      expect(result.valid).toBe(true);
      expect(result.pathValidation?.pathType).toBe('readonly');
    });

    test('allows proposal targeting dist/** (readonly path)', () => {
      const guardian = createGuardian();
      const proposal = createMockProposal({ target: { file: 'dist/bundle.js' } });

      const result = guardian.validateProposal(proposal);

      expect(result.valid).toBe(true);
      expect(result.pathValidation?.pathType).toBe('readonly');
    });
  });

  describe('validateProposal - circuit breaker integration', () => {
    test('blocks proposal when circuit breaker is open', () => {
      const guardian = createGuardian({ maxConsecutiveFailures: 3 });

      // Trip the circuit breaker by recording 3 failures
      guardian.recordFailure();
      guardian.recordFailure();
      guardian.recordFailure();

      const proposal = createMockProposal({ target: { file: 'src/normal/path.ts' } });
      const result = guardian.validateProposal(proposal);

      expect(result.valid).toBe(false);
      expect(result.circuitTripped).toBe(true);
    });

    test('allows proposal when circuit breaker is closed', () => {
      const guardian = createGuardian();

      // Ensure circuit breaker is reset
      guardian.resetCircuitBreaker();

      const proposal = createMockProposal({ target: { file: 'src/normal/path.ts' } });
      const result = guardian.validateProposal(proposal);

      expect(result.valid).toBe(true);
    });
  });

  describe('circuit breaker state transitions', () => {
    test('starts in closed state', () => {
      const guardian = createGuardian();
      expect(guardian.getCircuitBreaker().getState()).toBe('closed');
    });

    test('transitions to open after max consecutive failures', () => {
      const guardian = createGuardian({ maxConsecutiveFailures: 3 });

      guardian.recordFailure();
      expect(guardian.getCircuitBreaker().getState()).toBe('closed');

      guardian.recordFailure();
      expect(guardian.getCircuitBreaker().getState()).toBe('closed');

      guardian.recordFailure();
      expect(guardian.getCircuitBreaker().getState()).toBe('open');
    });

    test('resets failure count on success', () => {
      const guardian = createGuardian({ maxConsecutiveFailures: 3 });

      guardian.recordFailure();
      guardian.recordFailure();
      expect(guardian.getCircuitBreaker().getState()).toBe('closed');

      guardian.recordSuccess();

      // After success, failure count should be reset
      guardian.recordFailure();
      guardian.recordFailure();
      expect(guardian.getCircuitBreaker().getState()).toBe('closed');
    });

    test('transitions to closed after reset', () => {
      const guardian = createGuardian({ maxConsecutiveFailures: 3 });

      // Trip the circuit breaker
      guardian.recordFailure();
      guardian.recordFailure();
      guardian.recordFailure();
      expect(guardian.getCircuitBreaker().getState()).toBe('open');

      guardian.resetCircuitBreaker();
      expect(guardian.getCircuitBreaker().getState()).toBe('closed');
    });
  });

  describe('Guardian state', () => {
    test('returns correct state', () => {
      const guardian = createGuardian();
      const state = guardian.getState();

      expect(state).toHaveProperty('status');
      expect(state).toHaveProperty('permissions');
      expect(state).toHaveProperty('recentAlerts');
      expect(state).toHaveProperty('protection');
    });

    test('initial status is guarding', () => {
      const guardian = createGuardian();
      expect(guardian.getState().status).toBe('guarding');
    });

    test('status changes to alert when circuit trips', () => {
      const guardian = createGuardian({ maxConsecutiveFailures: 3 });
      // Trip via 3 failures
      guardian.recordFailure();
      guardian.recordFailure();
      guardian.recordFailure();
      expect(guardian.getState().status).toBe('alert');
    });

    test('status returns to guarding after reset', () => {
      const guardian = createGuardian({ maxConsecutiveFailures: 3 });
      // Trip via 3 failures
      guardian.recordFailure();
      guardian.recordFailure();
      guardian.recordFailure();
      guardian.resetCircuitBreaker();
      expect(guardian.getState().status).toBe('guarding');
    });
  });

  describe('alerts', () => {
    test('collects alerts from validation', () => {
      const guardian = createGuardian();
      const proposal = createMockProposal({ target: { file: 'src/payment/test.ts' } });

      guardian.validateProposal(proposal);

      const recentAlerts = guardian.getState().recentAlerts;
      expect(recentAlerts.length).toBeGreaterThan(0);
    });

    test('limits alerts to 100', () => {
      const guardian = createGuardian();

      // Create many blocked proposals
      for (let i = 0; i < 105; i++) {
        const proposal = createMockProposal({
          id: `proposal-${i}`,
          target: { file: 'src/payment/test.ts' },
        });
        guardian.validateProposal(proposal);
      }

      expect(guardian.getState().recentAlerts.length).toBeLessThanOrEqual(100);
    });
  });

  describe('getSummary', () => {
    test('returns correct summary', () => {
      const guardian = createGuardian();
      const summary = guardian.getSummary();

      expect(summary).toHaveProperty('status');
      expect(summary).toHaveProperty('circuitBreaker');
      expect(summary).toHaveProperty('alertCount');
      expect(summary).toHaveProperty('forbiddenPathCount');
    });
  });
});

describe('PathProtection (via Guardian)', () => {
  const createMockProposal = (overrides?: Partial<Proposal>): Proposal => ({
    id: 'proposal-1',
    timestamp: new Date(),
    type: 'improve_code',
    title: 'Test Proposal',
    description: 'Test description',
    target: { file: 'src/test.ts' },
    selection: { confidence: 0.8, cost: 5, benefit: 7, risk: 'medium' },
    status: 'pending',
    ...overrides,
  });

  describe('matchesGlob patterns', () => {
    const defaultProtection: GuardianProtection = {
      forbiddenPaths: ['**/payment/**', '**/permission/**', '**/.env*', '**/credentials/**'],
      requireApproval: true,
      notifyOnProposal: true,
      circuitBreakerEnabled: true,
    };

    const createGuardian = () => {
      return new Guardian({
        protection: defaultProtection,
        circuitBreakerConfig: { maxConsecutiveFailures: 3, resetAfterMs: 60000 },
      });
    };

    test('matches nested payment path', () => {
      const guardian = createGuardian();
      const proposal = createMockProposal({
        target: { file: 'src/modules/payment/stripe/checkout.ts' },
      });

      const result = guardian.validateProposal(proposal);
      expect(result.valid).toBe(false);
    });

    test('matches top-level payment path', () => {
      const guardian = createGuardian();
      const proposal = createMockProposal({
        target: { file: 'payment/routes.ts' },
      });

      const result = guardian.validateProposal(proposal);
      expect(result.valid).toBe(false);
    });

    test('allows paths not matching any pattern', () => {
      const guardian = createGuardian();
      const proposal = createMockProposal({
        target: { file: 'src/utils/helpers.ts' },
      });

      const result = guardian.validateProposal(proposal);
      expect(result.valid).toBe(true);
    });
  });
});

describe('CircuitBreaker (via Guardian)', () => {
  const createMockProposal = (overrides?: Partial<Proposal>): Proposal => ({
    id: 'proposal-1',
    timestamp: new Date(),
    type: 'improve_code',
    title: 'Test Proposal',
    description: 'Test description',
    target: { file: 'src/test.ts' },
    selection: { confidence: 0.8, cost: 5, benefit: 7, risk: 'medium' },
    status: 'pending',
    ...overrides,
  });

  describe('state transitions', () => {
    const defaultProtection: GuardianProtection = {
      forbiddenPaths: ['**/payment/**'],
      requireApproval: true,
      notifyOnProposal: true,
      circuitBreakerEnabled: true,
    };

    test('starts in closed state', () => {
      const guardian = new Guardian({
        protection: defaultProtection,
        circuitBreakerConfig: { maxConsecutiveFailures: 3, resetAfterMs: 1000 },
      });

      expect(guardian.getCircuitBreaker().getState()).toBe('closed');
    });

    test('transitions to open after 3 failures', () => {
      const guardian = new Guardian({
        protection: defaultProtection,
        circuitBreakerConfig: { maxConsecutiveFailures: 3, resetAfterMs: 1000 },
      });

      expect(guardian.getCircuitBreaker().getState()).toBe('closed');

      guardian.recordFailure();
      expect(guardian.getCircuitBreaker().getState()).toBe('closed');

      guardian.recordFailure();
      expect(guardian.getCircuitBreaker().getState()).toBe('closed');

      guardian.recordFailure();
      expect(guardian.getCircuitBreaker().getState()).toBe('open');
    });

    test('half-open after reset timeout', () => {
      jest.useFakeTimers();
      const guardian = new Guardian({
        protection: defaultProtection,
        circuitBreakerConfig: { maxConsecutiveFailures: 3, resetAfterMs: 1000 },
      });

      // Trip the circuit breaker
      guardian.recordFailure();
      guardian.recordFailure();
      guardian.recordFailure();
      expect(guardian.getCircuitBreaker().getState()).toBe('open');

      // Advance time past resetAfterMs
      jest.advanceTimersByTime(1000);

      // After timeout, should be half-open
      expect(guardian.getCircuitBreaker().getState()).toBe('half-open');

      jest.useRealTimers();
    });

    test('half-open -> closed on success', () => {
      jest.useFakeTimers();
      const guardian = new Guardian({
        protection: defaultProtection,
        circuitBreakerConfig: { maxConsecutiveFailures: 3, resetAfterMs: 1000 },
      });

      // Trip the circuit breaker
      guardian.recordFailure();
      guardian.recordFailure();
      guardian.recordFailure();
      expect(guardian.getCircuitBreaker().getState()).toBe('open');

      // Advance time past resetAfterMs
      jest.advanceTimersByTime(1000);
      expect(guardian.getCircuitBreaker().getState()).toBe('half-open');

      // Record success in half-open state
      guardian.recordSuccess();
      expect(guardian.getCircuitBreaker().getState()).toBe('closed');

      jest.useRealTimers();
    });

    test('half-open -> open on failure', () => {
      jest.useFakeTimers();
      const guardian = new Guardian({
        protection: defaultProtection,
        circuitBreakerConfig: { maxConsecutiveFailures: 3, resetAfterMs: 1000 },
      });

      // Trip the circuit breaker
      guardian.recordFailure();
      guardian.recordFailure();
      guardian.recordFailure();
      expect(guardian.getCircuitBreaker().getState()).toBe('open');

      // Advance time past resetAfterMs
      jest.advanceTimersByTime(1000);
      expect(guardian.getCircuitBreaker().getState()).toBe('half-open');

      // Record failure in half-open state
      guardian.recordFailure();
      expect(guardian.getCircuitBreaker().getState()).toBe('open');

      jest.useRealTimers();
    });
  });
});