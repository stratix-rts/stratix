// ============================================
// CircuitBreaker.test.ts - 熔断器单元测试
// Phase 1: Guardian 路径保护 + 熔断器
// ============================================

import { CircuitBreakerClass } from '../CircuitBreaker';

describe('CircuitBreakerClass', () => {
  describe('constructor', () => {
    test('creates instance with default config', () => {
      const cb = new CircuitBreakerClass();
      expect(cb).toBeInstanceOf(CircuitBreakerClass);
      expect(cb.getState()).toBe('closed');
    });

    test('creates instance with custom maxConsecutiveFailures', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 5 });
      expect(cb.getThresholds().maxConsecutiveFailures).toBe(5);
    });

    test('creates instance with custom resetAfterMs', () => {
      const cb = new CircuitBreakerClass({ resetAfterMs: 30000 });
      expect(cb.getThresholds().resetAfterMs).toBe(30000);
    });

    test('applies default values when config is partial', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 10 });
      expect(cb.getThresholds().maxConsecutiveFailures).toBe(10);
      expect(cb.getThresholds().resetAfterMs).toBe(60000); // default
    });

    test('registers onTrip callback', () => {
      const onTrip = jest.fn();
      const cb = new CircuitBreakerClass({}, { onTrip });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(onTrip).toHaveBeenCalledWith(3);
    });

    test('registers onReset callback', () => {
      const onReset = jest.fn();
      const cb = new CircuitBreakerClass({}, { onReset });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      cb.reset();
      expect(onReset).toHaveBeenCalled();
    });

    test('registers onHalfOpen callback', () => {
      jest.useFakeTimers();
      const onHalfOpen = jest.fn();
      const cb = new CircuitBreakerClass({ resetAfterMs: 1000 }, { onHalfOpen });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      jest.advanceTimersByTime(1000);
      expect(cb.getState()).toBe('half-open');
      expect(onHalfOpen).toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  describe('recordSuccess', () => {
    test('resets failure count in closed state', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 3 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getMetrics().consecutiveFailures).toBe(2);
      cb.recordSuccess();
      expect(cb.getMetrics().consecutiveFailures).toBe(0);
      expect(cb.getMetrics().lastFailureTimestamp).toBeNull();
    });

    test('resets breaker in half-open state', () => {
      jest.useFakeTimers();
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 2, resetAfterMs: 1000 });
      cb.recordFailure();
      cb.recordFailure(); // now open
      jest.advanceTimersByTime(1000); // now half-open
      expect(cb.getState()).toBe('half-open');
      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');
      expect(cb.getMetrics().consecutiveFailures).toBe(0);
      jest.useRealTimers();
    });

    test('clears lastFailureTimestamp', () => {
      const cb = new CircuitBreakerClass();
      cb.recordFailure();
      expect(cb.getMetrics().lastFailureTimestamp).toBeInstanceOf(Date);
      cb.recordSuccess();
      expect(cb.getMetrics().lastFailureTimestamp).toBeNull();
    });
  });

  describe('recordFailure', () => {
    test('increments consecutiveFailures counter', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 5 });
      cb.recordFailure();
      expect(cb.getMetrics().consecutiveFailures).toBe(1);
      cb.recordFailure();
      expect(cb.getMetrics().consecutiveFailures).toBe(2);
    });

    test('sets lastFailureTimestamp', () => {
      const cb = new CircuitBreakerClass();
      const before = new Date();
      cb.recordFailure();
      const after = new Date();
      const ts = cb.getMetrics().lastFailureTimestamp;
      expect(ts).toBeInstanceOf(Date);
      expect(ts!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(ts!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    test('opens circuit when threshold reached', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 3 });
      cb.recordFailure();
      expect(cb.getState()).toBe('closed');
      cb.recordFailure();
      expect(cb.getState()).toBe('closed');
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
    });

    test('failure in half-open transitions to open immediately', () => {
      jest.useFakeTimers();
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 2, resetAfterMs: 1000 });
      cb.recordFailure();
      cb.recordFailure(); // open
      jest.advanceTimersByTime(1000); // half-open
      expect(cb.getState()).toBe('half-open');
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      jest.useRealTimers();
    });

    test('multiple failures beyond threshold stay open', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 3 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure(); // open
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      expect(cb.getMetrics().consecutiveFailures).toBe(5);
    });
  });

  describe('isAllowed', () => {
    test('returns true when closed', () => {
      const cb = new CircuitBreakerClass();
      expect(cb.isAllowed()).toBe(true);
    });

    test('returns true when half-open', () => {
      jest.useFakeTimers();
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 1, resetAfterMs: 1000 });
      cb.recordFailure(); // open
      jest.advanceTimersByTime(1000);
      expect(cb.getState()).toBe('half-open');
      expect(cb.isAllowed()).toBe(true);
      jest.useRealTimers();
    });

    test('returns false when open', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 3 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.isAllowed()).toBe(false);
    });
  });

  describe('getState', () => {
    test('returns closed initially', () => {
      const cb = new CircuitBreakerClass();
      expect(cb.getState()).toBe('closed');
    });

    test('returns open after threshold failures', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 2 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
    });

    test('returns half-open after reset timeout', () => {
      jest.useFakeTimers();
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 2, resetAfterMs: 5000 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      jest.advanceTimersByTime(5000);
      expect(cb.getState()).toBe('half-open');
      jest.useRealTimers();
    });
  });

  describe('getMetrics', () => {
    test('returns current metrics', () => {
      const cb = new CircuitBreakerClass();
      const metrics = cb.getMetrics();
      expect(metrics).toHaveProperty('consecutiveFailures');
      expect(metrics).toHaveProperty('lastFailureTimestamp');
    });

    test('returns a copy, not the original', () => {
      const cb = new CircuitBreakerClass();
      const metrics1 = cb.getMetrics();
      const metrics2 = cb.getMetrics();
      expect(metrics1).not.toBe(metrics2);
    });
  });

  describe('getThresholds', () => {
    test('returns threshold config', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 7, resetAfterMs: 120000 });
      const thresholds = cb.getThresholds();
      expect(thresholds.maxConsecutiveFailures).toBe(7);
      expect(thresholds.resetAfterMs).toBe(120000);
    });

    test('returns a copy, not the original', () => {
      const cb = new CircuitBreakerClass();
      const t1 = cb.getThresholds();
      const t2 = cb.getThresholds();
      expect(t1).not.toBe(t2);
    });
  });

  describe('reset', () => {
    test('clears timer', () => {
      jest.useFakeTimers();
      const cb = new CircuitBreakerClass({ resetAfterMs: 5000 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      cb.reset();
      expect(cb.getState()).toBe('closed');
      jest.advanceTimersByTime(5000);
      expect(cb.getState()).toBe('closed'); // timer cleared, no half-open transition
      jest.useRealTimers();
    });

    test('resets metrics', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 2 });
      cb.recordFailure();
      cb.recordFailure();
      cb.reset();
      expect(cb.getMetrics().consecutiveFailures).toBe(0);
      expect(cb.getMetrics().lastFailureTimestamp).toBeNull();
    });

    test('transitions to closed state', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 2 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      cb.reset();
      expect(cb.getState()).toBe('closed');
    });

    test('allows failures again after reset', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 2 });
      cb.recordFailure();
      cb.recordFailure(); // open
      cb.reset();
      cb.recordFailure();
      expect(cb.getState()).toBe('closed');
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
    });
  });

  describe('scheduleHalfOpen', () => {
    test('clears previous timer before scheduling new one', () => {
      jest.useFakeTimers();
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 2, resetAfterMs: 3000 });
      cb.recordFailure();
      cb.recordFailure(); // open, schedules half-open at 3000

      // Trip again before timer fires
      cb.recordFailure();
      cb.recordFailure(); // open again
      expect(cb.getState()).toBe('open');

      // Original timer at 3000 should be cleared; new timer should also be at 3000
      jest.advanceTimersByTime(3000);
      expect(cb.getState()).toBe('half-open');
      jest.useRealTimers();
    });

    test('half-open fires after resetAfterMs', () => {
      jest.useFakeTimers();
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 2, resetAfterMs: 2000 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      jest.advanceTimersByTime(1999);
      expect(cb.getState()).toBe('open'); // not yet
      jest.advanceTimersByTime(1);
      expect(cb.getState()).toBe('half-open');
      jest.useRealTimers();
    });
  });

  describe('createLessonRecord', () => {
    test('creates lesson with correct category', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 3 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      const lesson = cb.createLessonRecord('test context');
      expect(lesson.category).toBe('circuit_breaker');
      expect(lesson.type).toBe('error');
      expect(lesson.context).toBe('test context');
    });

    test('includes avoidance rule', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 3, resetAfterMs: 60000 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      const lesson = cb.createLessonRecord('ctx');
      expect(lesson.avoidanceRule).toContain('60000ms');
    });

    test('lesson has unique id', () => {
      const cb = new CircuitBreakerClass();
      const l1 = cb.createLessonRecord('ctx');
      const l2 = cb.createLessonRecord('ctx');
      expect(l1.id).not.toBe(l2.id);
    });
  });

  describe('createAlert', () => {
    test('creates alert with circuit_tripped type', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 3 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      const alert = cb.createAlert('proposal-42');
      expect(alert.type).toBe('circuit_tripped');
      expect(alert.proposalId).toBe('proposal-42');
    });

    test('alert has unique id', () => {
      const cb = new CircuitBreakerClass();
      const a1 = cb.createAlert();
      const a2 = cb.createAlert();
      expect(a1.id).not.toBe(a2.id);
    });

    test('alert includes failure count', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 3 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      const alert = cb.createAlert();
      expect(alert.message).toContain('3');
    });
  });

  describe('getStatus', () => {
    test('returns closed status with failure count', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 3 });
      const status = cb.getStatus();
      expect(status).toContain('closed');
      expect(status).toContain('0/3');
    });

    test('returns open status with reset timeout', () => {
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 2, resetAfterMs: 5000 });
      cb.recordFailure();
      cb.recordFailure();
      const status = cb.getStatus();
      expect(status).toContain('open');
      expect(status).toContain('5000ms');
    });

    test('returns half-open status', () => {
      jest.useFakeTimers();
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 2, resetAfterMs: 1000 });
      cb.recordFailure();
      cb.recordFailure();
      jest.advanceTimersByTime(1000);
      const status = cb.getStatus();
      expect(status).toContain('half-open');
      expect(status).toContain('testing');
      jest.useRealTimers();
    });
  });

  describe('state transitions - full lifecycle', () => {
    test('closed -> open -> half-open -> closed (success)', () => {
      jest.useFakeTimers();
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 2, resetAfterMs: 1000 });

      expect(cb.getState()).toBe('closed');
      cb.recordFailure();
      expect(cb.getState()).toBe('closed');
      cb.recordFailure();
      expect(cb.getState()).toBe('open');

      jest.advanceTimersByTime(1000);
      expect(cb.getState()).toBe('half-open');

      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');
      expect(cb.getMetrics().consecutiveFailures).toBe(0);

      jest.useRealTimers();
    });

    test('closed -> open -> half-open -> open (failure)', () => {
      jest.useFakeTimers();
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 2, resetAfterMs: 1000 });

      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');

      jest.advanceTimersByTime(1000);
      expect(cb.getState()).toBe('half-open');

      cb.recordFailure();
      expect(cb.getState()).toBe('open');

      jest.useRealTimers();
    });

    test('multiple half-open cycles', () => {
      jest.useFakeTimers();
      const cb = new CircuitBreakerClass({ maxConsecutiveFailures: 1, resetAfterMs: 500 });

      // First cycle: open -> half-open -> open
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      jest.advanceTimersByTime(500);
      expect(cb.getState()).toBe('half-open');
      cb.recordFailure(); // fail in half-open -> back to open
      expect(cb.getState()).toBe('open');

      // Second cycle: open -> half-open -> closed
      jest.advanceTimersByTime(500);
      expect(cb.getState()).toBe('half-open');
      cb.recordSuccess(); // succeed -> closed
      expect(cb.getState()).toBe('closed');

      jest.useRealTimers();
    });
  });
});
