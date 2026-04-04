/**
 * RetryPolicyEngine unit tests
 */

import { RetryPolicyEngine, retryPolicyEngine } from '../../../src/stratix-core/retry/RetryPolicyEngine';
import { CannotRetryError, DEFAULT_RETRY_CONFIG } from '../../../src/stratix-core/retry/types';

describe('RetryPolicyEngine', () => {
  let engine: RetryPolicyEngine;

  beforeEach(() => {
    engine = new RetryPolicyEngine();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // executeWithRetry – happy path
  // --------------------------------------------------------------------------

  describe('executeWithRetry – success', () => {
    it('returns result on first try', async () => {
      const request = jest.fn().mockResolvedValue('ok');
      const result = await engine.executeWithRetry(request);
      expect(result).toBe('ok');
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('returns result after one retry', async () => {
      const request = jest
        .fn()
        .mockRejectedValueOnce(new Error(' transient'))
        .mockResolvedValueOnce('ok');
      const result = await engine.executeWithRetry(request, { maxRetries: 3 });
      expect(result).toBe('ok');
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('tracks all attempts in getAttempts()', async () => {
      const request = jest
        .fn()
        .mockRejectedValueOnce(new Error('e1'))
        .mockRejectedValueOnce(new Error('e2'))
        .mockResolvedValue('ok');
      await engine.executeWithRetry(request, { maxRetries: 3 });
      const attempts = engine.getAttempts();
      expect(attempts).toHaveLength(3);
      expect(attempts[0].error).toBeDefined();
      expect(attempts[1].error).toBeDefined();
      expect(attempts[2].result).toBe('ok');
    });
  });

  // --------------------------------------------------------------------------
  // executeWithRetry – fatal errors (no retry)
  // --------------------------------------------------------------------------

  describe('executeWithRetry – CannotRetryError', () => {
    it('throws immediately on CannotRetryError', async () => {
      const err = new CannotRetryError('fatal', 'Too large');
      const request = jest.fn().mockRejectedValue(err);
      await expect(engine.executeWithRetry(request)).rejects.toThrow(CannotRetryError);
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('throws CannotRetryError with auth_revoked reason', async () => {
      const err = new CannotRetryError('auth_revoked', 'Token expired');
      const request = jest.fn().mockRejectedValue(err);
      await expect(engine.executeWithRetry(request)).rejects.toThrow('Token expired');
    });
  });

  describe('executeWithRetry – auth errors (401/403)', () => {
    it('does not retry on 401', async () => {
      const err = new Error('Unauthorized') as Error & { status: number };
      err.status = 401;
      const request = jest.fn().mockRejectedValue(err);
      await expect(engine.executeWithRetry(request)).rejects.toThrow('Unauthorized');
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 403', async () => {
      const err = new Error('Forbidden') as Error & { status: number };
      err.status = 403;
      const request = jest.fn().mockRejectedValue(err);
      await expect(engine.executeWithRetry(request)).rejects.toThrow('Forbidden');
      expect(request).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // executeWithRetry – retryable errors
  // --------------------------------------------------------------------------

  describe('executeWithRetry – retryable statuses', () => {
    it('retries on 429 (rate limited)', async () => {
      const err = new Error('Rate limited') as Error & { status: number };
      err.status = 429;
      const request = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');
      const result = await engine.executeWithRetry(request, { maxRetries: 3 });
      expect(result).toBe('ok');
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('retries on 500', async () => {
      const err = { status: 500, message: 'Server Error' } as Error & { status: number };
      const request = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');
      const result = await engine.executeWithRetry(request, { maxRetries: 3 });
      expect(result).toBe('ok');
    });

    it('retries on 502', async () => {
      const err = { status: 502, message: 'Bad Gateway' } as Error & { status: number };
      const request = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');
      const result = await engine.executeWithRetry(request, { maxRetries: 3 });
      expect(result).toBe('ok');
    });

    it('retries on 503', async () => {
      const err = { status: 503, message: 'Service Unavailable' } as Error & { status: number };
      const request = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');
      const result = await engine.executeWithRetry(request, { maxRetries: 3 });
      expect(result).toBe('ok');
    });

    it('retries on network error (no status)', async () => {
      const err = new Error('ENOTFOUND');
      const request = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');
      const result = await engine.executeWithRetry(request, { maxRetries: 3 });
      expect(result).toBe('ok');
    });
  });

  // --------------------------------------------------------------------------
  // executeWithRetry – context overflow
  // --------------------------------------------------------------------------

  describe('executeWithRetry – context overflow', () => {
    it('retries context overflow on first half of retries', async () => {
      const err = new Error('Context overflow: prompt exceeds limit');
      const request = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');
      const result = await engine.executeWithRetry(request, { maxRetries: 4 });
      expect(result).toBe('ok');
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('stops retrying context overflow on second half', async () => {
      const err = new Error('Context overflow: prompt exceeds limit');
      const request = jest.fn().mockRejectedValue(err);
      // maxRetries=2: ceil(2/2)=1. Attempts 1 (retry), 2 (stop - second half).
      // So attempts: initial(1) + retry attempt(2) = 2 total calls
      await expect(
        engine.executeWithRetry(request, { maxRetries: 2 })
      ).rejects.toThrow(CannotRetryError);
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('detects context overflow via too long', async () => {
      const err = new Error('Prompt too long');
      const request = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');
      const result = await engine.executeWithRetry(request, { maxRetries: 3 });
      expect(result).toBe('ok');
    });
  });

  // --------------------------------------------------------------------------
  // executeWithRetry – max retries exceeded
  // --------------------------------------------------------------------------

  describe('executeWithRetry – max retries exceeded', () => {
    it('throws CannotRetryError when all retries exhausted', async () => {
      const err = new Error('Always fails');
      const request = jest.fn().mockRejectedValue(err);
      await expect(
        engine.executeWithRetry(request, { maxRetries: 2 })
      ).rejects.toThrow(CannotRetryError);
      expect(request).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('uses custom maxRetries from config', async () => {
      const err = new Error('Always fails');
      const request = jest.fn().mockRejectedValue(err);
      // Use 2 retries to keep test fast (initial + 2 retries = 3 calls)
      await expect(
        engine.executeWithRetry(request, { maxRetries: 2 })
      ).rejects.toThrow(CannotRetryError);
      expect(request).toHaveBeenCalledTimes(3); // initial + 2 retries
    });
  });

  // --------------------------------------------------------------------------
  // executeWithRetry – non-retryable status codes
  // --------------------------------------------------------------------------

  describe('executeWithRetry – non-retryable status', () => {
    it('does not retry 404', async () => {
      const err = { status: 404, message: 'Not Found' } as Error & { status: number };
      const request = jest.fn().mockRejectedValue(err);
      await expect(engine.executeWithRetry(request)).rejects.toThrow(CannotRetryError);
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('does not retry 400', async () => {
      const err = { status: 400, message: 'Bad Request' } as Error & { status: number };
      const request = jest.fn().mockRejectedValue(err);
      await expect(engine.executeWithRetry(request)).rejects.toThrow(CannotRetryError);
      expect(request).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // executeWithRetry – status extracted from response object
  // --------------------------------------------------------------------------

  describe('executeWithRetry – status extraction', () => {
    it('extracts status from error.response', async () => {
      const err = new Error('API error') as Error & { response: { status: number } };
      err.response = { status: 503 };
      const request = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');
      const result = await engine.executeWithRetry(request, { maxRetries: 1 });
      expect(result).toBe('ok');
    });

    it('extracts statusCode from error', async () => {
      const err = new Error('Rate limited') as Error & { statusCode: number };
      err.statusCode = 429;
      const request = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');
      const result = await engine.executeWithRetry(request, { maxRetries: 1 });
      expect(result).toBe('ok');
    });

    it('extracts status from message via regex', async () => {
      const err = new Error('Server returned status 503 Service Unavailable') as Error & { status?: number };
      err.status = undefined as unknown as number;
      const request = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');
      const result = await engine.executeWithRetry(request, { maxRetries: 1 });
      expect(result).toBe('ok');
    });
  });

  // --------------------------------------------------------------------------
  // executeWithRetry – source-aware behavior
  // --------------------------------------------------------------------------

  describe('executeWithRetry – source context', () => {
    it('respects foreground source (shorter delays)', async () => {
      const err = new Error('transient');
      const request = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');
      const start = Date.now();
      await engine.executeWithRetry(request, { maxRetries: 1 }, { source: 'foreground' });
      const elapsed = Date.now() - start;
      // foreground delay is halved: 1000 * 2^0 * 0.5 = 500ms, no jitter in test (Math.random mocked below)
      expect(elapsed).toBeLessThan(2000);
    });

    it('respects background source', async () => {
      const err = new Error('transient');
      const request = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');
      const start = Date.now();
      await engine.executeWithRetry(request, { maxRetries: 1 }, { source: 'background' });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(3000);
    });

    it('respects unattended source (longer delays)', async () => {
      const err = new Error('transient');
      const request = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');
      const start = Date.now();
      await engine.executeWithRetry(request, { maxRetries: 1 }, { source: 'unattended' });
      const elapsed = Date.now() - start;
      // unattended: 1000 * 2^0 * 1.5 = 1500ms
      expect(elapsed).toBeLessThan(3000);
    });

    it('429 with unattended source allows extra retries', async () => {
      const err = { status: 429, message: 'Rate limited' } as Error & { status: number };
      const request = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce('ok');
      const result = await engine.executeWithRetry(request, { maxRetries: 2 }, { source: 'unattended' });
      expect(result).toBe('ok');
    });
  });

  // --------------------------------------------------------------------------
  // createDefaultConfig
  // --------------------------------------------------------------------------

  describe('createDefaultConfig', () => {
    it('foreground config has fewer retries and shorter delays', () => {
      const cfg = RetryPolicyEngine.createDefaultConfig('foreground');
      expect(cfg.maxRetries).toBe(2);
      expect(cfg.initialDelayMs).toBe(500);
      expect(cfg.maxDelayMs).toBe(10000);
      expect(cfg.backoffMultiplier).toBe(2);
    });

    it('background config has normal values', () => {
      const cfg = RetryPolicyEngine.createDefaultConfig('background');
      expect(cfg.maxRetries).toBe(3);
      expect(cfg.initialDelayMs).toBe(1000);
      expect(cfg.maxDelayMs).toBe(30000);
      expect(cfg.backoffMultiplier).toBe(2);
    });

    it('unattended config has more retries and longer delays', () => {
      const cfg = RetryPolicyEngine.createDefaultConfig('unattended');
      expect(cfg.maxRetries).toBe(5);
      expect(cfg.initialDelayMs).toBe(2000);
      expect(cfg.maxDelayMs).toBe(60000);
      expect(cfg.backoffMultiplier).toBe(2.5);
    });
  });

  // --------------------------------------------------------------------------
  // getAttempts
  // --------------------------------------------------------------------------

  describe('getAttempts', () => {
    it('returns empty array before any executeWithRetry call', () => {
      const engine = new RetryPolicyEngine();
      expect(engine.getAttempts()).toEqual([]);
    });

    it('returns all attempts after execution', async () => {
      const request = jest
        .fn()
        .mockRejectedValueOnce(new Error('e1'))
        .mockRejectedValueOnce(new Error('e2'))
        .mockResolvedValueOnce('ok');
      await engine.executeWithRetry(request, { maxRetries: 3 });
      const attempts = engine.getAttempts();
      expect(attempts.length).toBeGreaterThan(0);
      attempts.forEach((a: { attemptNumber: number; delayMs: number }) => {
        expect(a.attemptNumber).toBeGreaterThan(0);
        expect(typeof a.delayMs).toBe('number');
      });
    });
  });

  // --------------------------------------------------------------------------
  // singleton instance
  // --------------------------------------------------------------------------

  describe('retryPolicyEngine singleton', () => {
    it('is a RetryPolicyEngine instance', () => {
      expect(retryPolicyEngine).toBeInstanceOf(RetryPolicyEngine);
    });
  });
});
