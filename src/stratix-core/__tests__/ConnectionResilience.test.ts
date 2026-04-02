/**
 * ConnectionResilience Tests
 */

import { ConnectionResilience, IConnection, createConnectionResilience } from '../openclaw/ConnectionResilience';

describe('ConnectionResilience', () => {
  // Mock connection helper
  const createMockConnection = () => {
    const connectMock: any = jest.fn();
    const disconnectMock: any = jest.fn();
    const sendMock: any = jest.fn();
    const isConnectedMock: any = jest.fn();

    const mock: IConnection<string> = {
      connect: connectMock,
      disconnect: disconnectMock,
      send: sendMock,
      isConnected: isConnectedMock,
    };

    return { mock, connectMock, disconnectMock, sendMock, isConnectedMock };
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('basic connect/disconnect', () => {
    it('should connect successfully', async () => {
      const { mock, connectMock } = createMockConnection();
      (connectMock.mockResolvedValue as any)('connection-result');

      const resilience = new ConnectionResilience<string>();
      resilience.wrap(mock);

      const resultPromise = resilience.connect();
      jest.runAllTimers();
      const result = await resultPromise;

      expect(result).toBe('connection-result');
      expect(resilience.isConnected()).toBe(true);
      expect(resilience.getState()).toBe('connected');
    });

    it('should emit connected event on success', async () => {
      const { mock, connectMock } = createMockConnection();
      (connectMock.mockResolvedValue as any)('ok');

      const resilience = new ConnectionResilience<string>();
      resilience.wrap(mock);

      const connectedHandler = jest.fn();
      resilience.on('connected', connectedHandler);

      const resultPromise = resilience.connect();
      jest.runAllTimers();
      await resultPromise;

      expect(connectedHandler).toHaveBeenCalledTimes(1);
    });

    it('should disconnect gracefully', async () => {
      const { mock, connectMock, disconnectMock } = createMockConnection();
      (connectMock.mockResolvedValue as any)('ok');
      (disconnectMock.mockResolvedValue as any)(undefined);

      const resilience = new ConnectionResilience<string>();
      resilience.wrap(mock);

      await resilience.connect();
      jest.runAllTimers();

      const disconnectPromise = resilience.disconnect();
      jest.runAllTimers();
      await disconnectPromise;

      expect(disconnectMock).toHaveBeenCalled();
      expect(resilience.isConnected()).toBe(false);
      expect(resilience.getState()).toBe('disconnected');
    });
  });

  describe('reconnect with backoff', () => {
    it('should retry connection on failure with exponential backoff', async () => {
      const { mock, connectMock } = createMockConnection();
      connectMock
        .mockRejectedValueOnce(new Error('connection failed'))
        .mockRejectedValueOnce(new Error('connection failed'))
        .mockResolvedValueOnce('ok');

      const resilience = new ConnectionResilience<string>({
        reconnect: true,
        maxRetries: 5,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        jitterFactor: 0,
      });
      resilience.wrap(mock);

      const reconnectingHandler = jest.fn();
      resilience.on('reconnecting', reconnectingHandler);

      const connectPromise = resilience.connect();
      jest.runAllTimers();
      await connectPromise;

      // Should have attempted 3 connects (2 failures + 1 success)
      expect(connectMock).toHaveBeenCalledTimes(3);

      // Should have emitted reconnecting twice (before 2nd and 3rd attempts)
      expect(reconnectingHandler).toHaveBeenCalledTimes(2);
      expect(reconnectingHandler).toHaveBeenNthCalledWith(1, 1, 100); // first retry
      expect(reconnectingHandler).toHaveBeenNthCalledWith(2, 2, 200); // second retry (exponential)
    });

    it('should stop retrying after maxRetries', async () => {
      const { mock, connectMock } = createMockConnection();
      (connectMock.mockRejectedValue as any)(new Error('always fails'));

      const resilience = new ConnectionResilience<string>({
        reconnect: true,
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        jitterFactor: 0,
      });
      resilience.wrap(mock);

      const connectPromise = resilience.connect();
      jest.runAllTimers();

      await expect(connectPromise).rejects.toThrow('always fails');
      expect(connectMock).toHaveBeenCalledTimes(4); // initial + 3 retries
    });

    it('should apply jitter to backoff delay', async () => {
      const { mock, connectMock } = createMockConnection();
      connectMock
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('ok');

      const reconnectingDelays: number[] = [];
      const resilience = new ConnectionResilience<string>({
        reconnect: true,
        maxRetries: 5,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        jitterFactor: 0.2,
      });
      resilience.wrap(mock);

      resilience.on('reconnecting', (_attempt, delayMs) => {
        reconnectingDelays.push(delayMs);
      });

      const connectPromise = resilience.connect();
      jest.runAllTimers();
      await connectPromise;

      // First retry delay should be around 1000 with possible jitter
      // With jitterFactor 0.2, range is [800, 1200]
      expect(reconnectingDelays[0]).toBeGreaterThanOrEqual(800);
      expect(reconnectingDelays[0]).toBeLessThanOrEqual(1200);
    });

    it('should not reconnect if reconnect config is false', async () => {
      const { mock, connectMock } = createMockConnection();
      (connectMock.mockRejectedValue as any)(new Error('fail'));

      const resilience = new ConnectionResilience<string>({
        reconnect: false,
      });
      resilience.wrap(mock);

      await expect(resilience.connect()).rejects.toThrow('fail');
      expect(connectMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('circuit breaker', () => {
    it('should open circuit after threshold consecutive failures', async () => {
      const { mock, connectMock } = createMockConnection();
      (connectMock.mockRejectedValue as any)(new Error('fail'));

      const resilience = new ConnectionResilience<string>({
        circuitThreshold: 3,
        circuitResetMs: 60000,
        reconnect: true,
        maxRetries: 10,
        initialDelayMs: 10,
        maxDelayMs: 100,
        jitterFactor: 0,
      });
      resilience.wrap(mock);

      const circuitOpenHandler = jest.fn();
      resilience.on('circuit_open', circuitOpenHandler);

      const connectPromise = resilience.connect();
      jest.runAllTimers();

      await expect(connectPromise).rejects.toThrow('fail');

      // After 3 failures, circuit should open
      expect(circuitOpenHandler).toHaveBeenCalledTimes(1);
      expect(circuitOpenHandler).toHaveBeenCalledWith(3);
      expect(resilience.getState()).toBe('circuit_open');
    });

    it('should reject requests immediately when circuit is open', async () => {
      const { mock, connectMock } = createMockConnection();
      (connectMock.mockRejectedValue as any)(new Error('fail'));

      const resilience = new ConnectionResilience<string>({
        circuitThreshold: 2,
        circuitResetMs: 60000,
        reconnect: true,
        maxRetries: 10,
        initialDelayMs: 10,
        maxDelayMs: 100,
        jitterFactor: 0,
      });
      resilience.wrap(mock);

      const connectPromise = resilience.connect();
      jest.runAllTimers();
      await expect(connectPromise).rejects.toThrow('fail');

      // Circuit is now open, trying to send should fail
      await expect(resilience.send('test')).rejects.toThrow('Circuit breaker is open');
    });

    it('should transition to half-open after circuitResetMs', async () => {
      const { mock, connectMock } = createMockConnection();
      let callCount = 0;
      connectMock.mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          return Promise.reject(new Error('fail'));
        }
        return Promise.resolve('ok');
      });

      const resilience = new ConnectionResilience<string>({
        circuitThreshold: 3,
        circuitResetMs: 5000,
        reconnect: true,
        maxRetries: 10,
        initialDelayMs: 10,
        maxDelayMs: 100,
        jitterFactor: 0,
      });
      resilience.wrap(mock);

      const circuitOpenHandler = jest.fn();
      const circuitHalfOpenHandler = jest.fn();
      resilience.on('circuit_open', circuitOpenHandler);
      resilience.on('circuit_half_open', circuitHalfOpenHandler);

      // Initial connection attempts
      const connectPromise = resilience.connect();
      jest.runAllTimers();
      await expect(connectPromise).rejects.toThrow('fail');

      expect(circuitOpenHandler).toHaveBeenCalledTimes(1);
      expect(resilience.getState()).toBe('circuit_open');

      // Fast-forward past the circuit reset timeout
      jest.advanceTimersByTime(5000);
      jest.runAllTimers();

      expect(circuitHalfOpenHandler).toHaveBeenCalledTimes(1);
      expect(resilience.getState()).toBe('circuit_half_open');
    });

    it('should close circuit after 3 successes in half-open state', async () => {
      const { mock, connectMock, isConnectedMock } = createMockConnection();
      let failureCount = 0;
      connectMock.mockImplementation(() => {
        failureCount++;
        if (failureCount <= 3) {
          return Promise.reject(new Error('fail'));
        }
        return Promise.resolve('ok');
      });
      isConnectedMock.mockReturnValue(true);

      const resilience = new ConnectionResilience<string>({
        circuitThreshold: 3,
        circuitResetMs: 1000,
        reconnect: true,
        maxRetries: 10,
        initialDelayMs: 10,
        maxDelayMs: 100,
        jitterFactor: 0,
      });
      resilience.wrap(mock);

      const circuitOpenHandler = jest.fn();
      const circuitClosedHandler = jest.fn();
      resilience.on('circuit_open', circuitOpenHandler);
      resilience.on('circuit_closed', circuitClosedHandler);

      // Initial connection attempts
      const connectPromise = resilience.connect();
      jest.runAllTimers();
      await expect(connectPromise).rejects.toThrow('fail');

      expect(resilience.getState()).toBe('circuit_open');

      // Advance past circuit reset timeout
      jest.advanceTimersByTime(1000);
      jest.runAllTimers();

      // Now in half-open state, test connection should succeed
      jest.runAllTimers();
      await Promise.resolve(); // let the test connection complete

      expect(circuitClosedHandler).toHaveBeenCalledTimes(1);
      expect(resilience.getState()).toBe('connected');
    });

    it('should allow manual circuit reset', () => {
      const { mock } = createMockConnection();

      const resilience = new ConnectionResilience<string>({
        circuitThreshold: 2,
      });
      resilience.wrap(mock);

      // Simulate being in circuit open state by directly manipulating for testing
      (resilience as unknown as { consecutiveFailures: number }).consecutiveFailures = 5;
      (resilience as unknown as { state: string }).state = 'circuit_open';

      resilience.resetCircuit();

      expect(resilience.getState()).toBe('disconnected');
    });
  });

  describe('auth refresh', () => {
    it('should call authRefreshFn before reconnect', async () => {
      const { mock, connectMock } = createMockConnection();
      connectMock
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('ok');

      const authRefreshFn = jest.fn().mockResolvedValue({ Authorization: 'Bearer new-token' });

      const resilience = new ConnectionResilience<string>({
        reconnect: true,
        maxRetries: 5,
        initialDelayMs: 10,
        maxDelayMs: 100,
        jitterFactor: 0,
        authRefreshFn,
      });
      resilience.wrap(mock);

      const authRefreshHandler = jest.fn();
      resilience.on('auth_refresh', authRefreshHandler);

      const connectPromise = resilience.connect();
      jest.runAllTimers();
      await connectPromise;

      // authRefreshFn should be called once before the retry
      expect(authRefreshFn).toHaveBeenCalledTimes(1);
      expect(authRefreshHandler).toHaveBeenCalledTimes(1);
    });

    it('should continue even if authRefreshFn fails', async () => {
      const { mock, connectMock } = createMockConnection();
      connectMock
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('ok');

      const authRefreshFn = jest.fn().mockRejectedValue(new Error('auth failed'));

      const resilience = new ConnectionResilience<string>({
        reconnect: true,
        maxRetries: 5,
        initialDelayMs: 10,
        maxDelayMs: 100,
        jitterFactor: 0,
        authRefreshFn,
      });
      resilience.wrap(mock);

      const connectPromise = resilience.connect();
      jest.runAllTimers();
      await connectPromise;

      // Should still reconnect even though auth refresh failed
      expect(connectMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('health check', () => {
    it('should perform periodic health checks', async () => {
      const { mock, connectMock, sendMock, isConnectedMock } = createMockConnection();
      (connectMock.mockResolvedValue as any)('ok');
      sendMock.mockResolvedValue(undefined);
      isConnectedMock.mockReturnValue(true);

      const resilience = new ConnectionResilience<string>({
        healthCheckMs: 5000,
      });
      resilience.wrap(mock);

      await resilience.connect();
      jest.runAllTimers();

      // Fast-forward by 10 seconds (should be 2 health checks)
      jest.advanceTimersByTime(10000);
      jest.runAllTimers();

      expect(sendMock).toHaveBeenCalled();
    });

    it('should emit health_check_failed when health check fails', async () => {
      const { mock, connectMock, sendMock, isConnectedMock } = createMockConnection();
      (connectMock.mockResolvedValue as any)('ok');
      sendMock.mockRejectedValue(new Error('stale connection'));
      isConnectedMock.mockReturnValue(true);

      const resilience = new ConnectionResilience<string>({
        healthCheckMs: 5000,
      });
      resilience.wrap(mock);

      await resilience.connect();
      jest.runAllTimers();

      const healthCheckFailedHandler = jest.fn();
      resilience.on('health_check_failed', healthCheckFailedHandler);

      // Fast-forward past first health check
      jest.advanceTimersByTime(5000);
      jest.runAllTimers();

      expect(healthCheckFailedHandler).toHaveBeenCalled();
    });

    it('should stop health check on disconnect', async () => {
      const { mock, connectMock, sendMock, isConnectedMock, disconnectMock } = createMockConnection();
      (connectMock.mockResolvedValue as any)('ok');
      sendMock.mockResolvedValue(undefined);
      isConnectedMock.mockReturnValue(true);
      (disconnectMock.mockResolvedValue as any)(undefined);

      const resilience = new ConnectionResilience<string>({
        healthCheckMs: 5000,
      });
      resilience.wrap(mock);

      await resilience.connect();
      jest.runAllTimers();

      // Do a health check
      jest.advanceTimersByTime(5000);
      jest.runAllTimers();
      const sendCallCountAfterCheck = sendMock.mock.calls.length;

      // Disconnect
      await resilience.disconnect();
      jest.runAllTimers();

      // Advance time - no more health checks should happen
      jest.advanceTimersByTime(10000);
      jest.runAllTimers();

      expect(sendMock).toHaveBeenCalledTimes(sendCallCountAfterCheck);
    });

    it('should report unhealthy when connection is not connected', async () => {
      const { mock, connectMock, isConnectedMock } = createMockConnection();
      (connectMock.mockResolvedValue as any)('ok');
      isConnectedMock.mockReturnValue(false);

      const resilience = new ConnectionResilience<string>({
        healthCheckMs: 5000,
      });
      resilience.wrap(mock);

      await resilience.connect();
      jest.runAllTimers();

      const healthCheckFailedHandler = jest.fn();
      resilience.on('health_check_failed', healthCheckFailedHandler);

      jest.advanceTimersByTime(5000);
      jest.runAllTimers();

      expect(healthCheckFailedHandler).toHaveBeenCalledWith(-1);
    });

    it('should return last health check result', async () => {
      const { mock, connectMock, isConnectedMock } = createMockConnection();
      (connectMock.mockResolvedValue as any)('ok');
      isConnectedMock.mockReturnValue(true);

      const resilience = new ConnectionResilience<string>({
        healthCheckMs: 5000,
      });
      resilience.wrap(mock);

      await resilience.connect();
      jest.runAllTimers();

      // Initially null
      expect(resilience.getLastHealthCheck()).toBeNull();

      // After advancing time, health check should have run
      jest.advanceTimersByTime(5000);
      jest.runAllTimers();

      const lastCheck = resilience.getLastHealthCheck();
      expect(lastCheck).not.toBeNull();
      expect(lastCheck?.timestamp).toBeGreaterThan(0);
    });
  });

  describe('event emission', () => {
    it('should emit connecting event', async () => {
      const { mock, connectMock } = createMockConnection();
      (connectMock.mockResolvedValue as any)('ok');

      const resilience = new ConnectionResilience<string>();
      resilience.wrap(mock);

      const connectingHandler = jest.fn();
      resilience.on('connecting', connectingHandler);

      const connectPromise = resilience.connect();
      jest.runAllTimers();
      await connectPromise;

      expect(connectingHandler).toHaveBeenCalled();
    });

    it('should emit disconnected event on manual disconnect', async () => {
      const { mock, connectMock, disconnectMock } = createMockConnection();
      (connectMock.mockResolvedValue as any)('ok');
      (disconnectMock.mockResolvedValue as any)(undefined);

      const resilience = new ConnectionResilience<string>();
      resilience.wrap(mock);

      await resilience.connect();
      jest.runAllTimers();

      const disconnectedHandler = jest.fn();
      resilience.on('disconnected', disconnectedHandler);

      await resilience.disconnect('test reason');
      jest.runAllTimers();

      expect(disconnectedHandler).toHaveBeenCalledWith('test reason');
    });

    it('should emit error event on connection failure', async () => {
      const { mock, connectMock } = createMockConnection();
      (connectMock.mockRejectedValue as any)(new Error('test error'));

      const resilience = new ConnectionResilience<string>({
        reconnect: false,
      });
      resilience.wrap(mock);

      const errorHandler = jest.fn();
      resilience.on('error', errorHandler);

      await expect(resilience.connect()).rejects.toThrow('test error');

      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('factory function', () => {
    it('should create resilience with wrapped connection', async () => {
      const { mock, connectMock } = createMockConnection();
      (connectMock.mockResolvedValue as any)('result');

      const resilience = createConnectionResilience(mock, {
        reconnect: false,
      });

      const resultPromise = resilience.connect();
      jest.runAllTimers();
      const result = await resultPromise;

      expect(result).toBe('result');
      expect(resilience.isConnected()).toBe(true);
    });
  });

  describe('getConnectionResult', () => {
    it('should return the result from last successful connect', async () => {
      const { mock, connectMock } = createMockConnection();
      (connectMock.mockResolvedValue as any)('my-result');

      const resilience = new ConnectionResilience<string>();
      resilience.wrap(mock);

      expect(resilience.getConnectionResult()).toBeNull();

      await resilience.connect();
      jest.runAllTimers();

      expect(resilience.getConnectionResult()).toBe('my-result');
    });
  });
});
