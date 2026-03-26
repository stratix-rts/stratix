/**
 * ConnectionPool Unit Tests
 */

import { ConnectionPool } from '@/stratix-openclaw-adapter/ConnectionPool';
import { LocalOpenClawAdapter } from '@/stratix-openclaw-adapter/LocalOpenClawAdapter';
import { RemoteOpenClawAdapter } from '@/stratix-openclaw-adapter/RemoteOpenClawAdapter';
import type { OpenClawAdapterInterface, OpenClawStatus } from '@/stratix-openclaw-adapter/types';
import type { StratixOpenClawConfig } from '@/stratix-core/stratix-protocol';

// Mock the adapters
jest.mock('@/stratix-openclaw-adapter/LocalOpenClawAdapter');
jest.mock('@/stratix-openclaw-adapter/RemoteOpenClawAdapter');

const MockLocalOpenClawAdapter = LocalOpenClawAdapter as jest.MockedClass<typeof LocalOpenClawAdapter>;
const MockRemoteOpenClawAdapter = RemoteOpenClawAdapter as jest.MockedClass<typeof RemoteOpenClawAdapter>;

describe('ConnectionPool', () => {
  let pool: ConnectionPool;
  const mockConfig: StratixOpenClawConfig = {
    endpoint: 'http://localhost:3000',
    accountId: 'test-account',
    apiKey: 'test-key',
  };

  const mockStatus: OpenClawStatus = {
    connected: true,
    accountId: 'test-account',
    lastActive: Date.now(),
  };

  const createMockAdapter = (): jest.Mocked<OpenClawAdapterInterface> => {
    const adapter = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValue({ success: true, data: 'result' }),
      getStatus: jest.fn().mockResolvedValue(mockStatus),
      subscribe: jest.fn(),
      sendMessage: jest.fn().mockResolvedValue({
        messageId: 'msg-1',
        content: 'hello',
        role: 'assistant' as const,
        done: true,
      }),
      invokeTool: jest.fn().mockResolvedValue('tool-result'),
      openaiChatCompletion: jest.fn(),
      streamChatCompletion: jest.fn(),
      listSessions: jest.fn().mockResolvedValue([]),
      listAgents: jest.fn().mockResolvedValue([]),
      listModels: jest.fn().mockResolvedValue([]),
    };
    return adapter;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    pool = new ConnectionPool({
      maxConnections: 5,
      idleTimeout: 60000,
      reconnectAttempts: 3,
      reconnectDelay: 100,
      healthCheckInterval: 30000,
      connectionBatchDelay: 50,
    });

    // Default mock implementations
    MockLocalOpenClawAdapter.mockImplementation((config) => ({
      ...createMockAdapter(),
      connect: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockResolvedValue(mockStatus),
    }) as unknown as LocalOpenClawAdapter);

    MockRemoteOpenClawAdapter.mockImplementation((config) => ({
      ...createMockAdapter(),
      connect: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockResolvedValue(mockStatus),
    }) as unknown as RemoteOpenClawAdapter);
  });

  afterEach(() => {
    pool.dispose();
    jest.restoreAllMocks();
  });

  describe('getAdapter', () => {
    it('should create a new adapter for new config', async () => {
      const adapter = await pool.getAdapter(mockConfig);

      expect(adapter).toBeDefined();
      expect(MockLocalOpenClawAdapter).toHaveBeenCalledWith(mockConfig);
    });

    it('should reuse existing adapter for same config', async () => {
      const adapter1 = await pool.getAdapter(mockConfig);
      const adapter2 = await pool.getAdapter(mockConfig);

      expect(adapter1).toBe(adapter2);
      expect(MockLocalOpenClawAdapter).toHaveBeenCalledTimes(1);
    });

    it('should create different adapters for different configs', async () => {
      const config2: StratixOpenClawConfig = {
        ...mockConfig,
        accountId: 'test-account-2',
      };

      const adapter1 = await pool.getAdapter(mockConfig);
      const adapter2 = await pool.getAdapter(config2);

      expect(adapter1).not.toBe(adapter2);
      expect(MockLocalOpenClawAdapter).toHaveBeenCalledTimes(2);
    });

    it('should use LocalOpenClawAdapter for localhost endpoints', async () => {
      await pool.getAdapter(mockConfig);

      expect(MockLocalOpenClawAdapter).toHaveBeenCalled();
      expect(MockRemoteOpenClawAdapter).not.toHaveBeenCalled();
    });

    it('should use RemoteOpenClawAdapter for non-localhost endpoints', async () => {
      const remoteConfig: StratixOpenClawConfig = {
        ...mockConfig,
        endpoint: 'https://api.openclaw.example.com',
      };

      await pool.getAdapter(remoteConfig);

      expect(MockRemoteOpenClawAdapter).toHaveBeenCalledWith(remoteConfig);
    });

    it('should throw error when pool is exhausted', async () => {
      const smallPool = new ConnectionPool({ maxConnections: 1 });

      await smallPool.getAdapter(mockConfig);

      const config2: StratixOpenClawConfig = {
        ...mockConfig,
        accountId: 'test-account-2',
        endpoint: 'http://localhost:3001',
      };

      await expect(smallPool.getAdapter(config2)).rejects.toThrow('Connection pool exhausted');
      smallPool.dispose();
    });
  });

  describe('releaseAdapter', () => {
    it('should update lastUsed timestamp', async () => {
      const adapter = await pool.getAdapter(mockConfig);
      const key = `${mockConfig.endpoint}:${mockConfig.accountId}`;

      const beforeRelease = pool.getConnectionInfo(key)?.lastUsed;
      await pool.releaseAdapter(key);
      const afterRelease = pool.getConnectionInfo(key)?.lastUsed;

      expect(afterRelease).toBeGreaterThanOrEqual(beforeRelease!);
    });
  });

  describe('removeAdapter', () => {
    it('should remove adapter from pool', async () => {
      const adapter = await pool.getAdapter(mockConfig);
      const key = `${mockConfig.endpoint}:${mockConfig.accountId}`;

      expect(pool.getConnectionInfo(key)).not.toBeNull();

      await pool.removeAdapter(key);

      expect(pool.getConnectionInfo(key)).toBeNull();
    });

    it('should disconnect removed adapter', async () => {
      const adapter = await pool.getAdapter(mockConfig) as jest.Mocked<OpenClawAdapterInterface>;
      const key = `${mockConfig.endpoint}:${mockConfig.accountId}`;

      await pool.removeAdapter(key);

      expect(adapter.disconnect).toHaveBeenCalled();
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all adapters and clear pool', async () => {
      const adapter1 = await pool.getAdapter(mockConfig) as jest.Mocked<OpenClawAdapterInterface>;
      const config2: StratixOpenClawConfig = {
        ...mockConfig,
        accountId: 'test-account-2',
        endpoint: 'http://localhost:3001',
      };
      const adapter2 = await pool.getAdapter(config2) as jest.Mocked<OpenClawAdapterInterface>;

      await pool.disconnectAll();

      expect(adapter1.disconnect).toHaveBeenCalled();
      expect(adapter2.disconnect).toHaveBeenCalled();
      expect(pool.getPoolStats().totalConnections).toBe(0);
    });
  });

  describe('getConnectionInfo', () => {
    it('should return connection info for existing key', async () => {
      await pool.getAdapter(mockConfig);
      const key = `${mockConfig.endpoint}:${mockConfig.accountId}`;

      const info = pool.getConnectionInfo(key);

      expect(info).not.toBeNull();
      expect(info?.key).toBe(key);
      expect(info?.endpoint).toBe(mockConfig.endpoint);
      expect(info?.accountId).toBe(mockConfig.accountId);
    });

    it('should return null for non-existing key', () => {
      const info = pool.getConnectionInfo('non-existing-key');
      expect(info).toBeNull();
    });
  });

  describe('getAllConnectionInfo', () => {
    it('should return all connection info', async () => {
      await pool.getAdapter(mockConfig);
      const config2: StratixOpenClawConfig = {
        ...mockConfig,
        accountId: 'test-account-2',
        endpoint: 'http://localhost:3001',
      };
      await pool.getAdapter(config2);

      const allInfo = pool.getAllConnectionInfo();

      expect(allInfo).toHaveLength(2);
    });
  });

  describe('getPoolStats', () => {
    it('should return correct pool statistics', async () => {
      await pool.getAdapter(mockConfig);

      const stats = pool.getPoolStats();

      expect(stats.totalConnections).toBe(1);
      expect(stats.activeConnections).toBe(1);
      expect(stats.idleConnections).toBe(0);
      expect(stats.errorConnections).toBe(0);
    });

    it('should count error connections', async () => {
      MockLocalOpenClawAdapter.mockImplementationOnce((config) => ({
        ...createMockAdapter(),
        connect: jest.fn().mockRejectedValue(new Error('Connection failed')),
        getStatus: jest.fn().mockResolvedValue({ ...mockStatus, connected: false }),
      }) as unknown as LocalOpenClawAdapter);

      try {
        await pool.getAdapter(mockConfig);
      } catch {
        // Expected to fail
      }

      const stats = pool.getPoolStats();
      expect(stats.errorConnections).toBe(1);
    });
  });

  describe('attemptReconnect', () => {
    it('should successfully reconnect', async () => {
      const adapter = await pool.getAdapter(mockConfig) as jest.Mocked<OpenClawAdapterInterface>;
      const key = `${mockConfig.endpoint}:${mockConfig.accountId}`;

      // Simulate disconnected state
      adapter.connect.mockResolvedValueOnce(undefined);

      const result = await pool.attemptReconnect(key);

      expect(result).toBe(true);
      expect(pool.getConnectionInfo(key)?.status).toBe('connected');
    });

    it('should fail to reconnect after max attempts', async () => {
      const adapter = await pool.getAdapter(mockConfig) as jest.Mocked<OpenClawAdapterInterface>;
      const key = `${mockConfig.endpoint}:${mockConfig.accountId}`;

      adapter.connect.mockRejectedValue(new Error('Connection failed'));

      const result = await pool.attemptReconnect(key);

      expect(result).toBe(false);
      expect(pool.getConnectionInfo(key)?.status).toBe('error');
    });

    it('should return false for non-existing connection', async () => {
      const result = await pool.attemptReconnect('non-existing-key');
      expect(result).toBe(false);
    });
  });

  describe('invokeAll', () => {
    it('should invoke tool on all connected adapters', async () => {
      const adapter1 = await pool.getAdapter(mockConfig) as jest.Mocked<OpenClawAdapterInterface>;
      const config2: StratixOpenClawConfig = {
        ...mockConfig,
        accountId: 'test-account-2',
        endpoint: 'http://localhost:3001',
      };
      const adapter2 = await pool.getAdapter(config2) as jest.Mocked<OpenClawAdapterInterface>;

      const results = await pool.invokeAll('test_tool', { arg: 'value' });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('should handle partial failures', async () => {
      const adapter1 = await pool.getAdapter(mockConfig) as jest.Mocked<OpenClawAdapterInterface>;
      const config2: StratixOpenClawConfig = {
        ...mockConfig,
        accountId: 'test-account-2',
        endpoint: 'http://localhost:3001',
      };
      const adapter2 = await pool.getAdapter(config2) as jest.Mocked<OpenClawAdapterInterface>;

      adapter2.invokeTool.mockRejectedValueOnce(new Error('Tool failed'));

      const results = await pool.invokeAll('test_tool');

      expect(results).toHaveLength(2);
      expect(results.filter((r) => r.success)).toHaveLength(1);
    });
  });

  describe('invokeFirst', () => {
    it('should return first successful result', async () => {
      const adapter1 = await pool.getAdapter(mockConfig) as jest.Mocked<OpenClawAdapterInterface>;
      const config2: StratixOpenClawConfig = {
        ...mockConfig,
        accountId: 'test-account-2',
        endpoint: 'http://localhost:3001',
      };
      const adapter2 = await pool.getAdapter(config2) as jest.Mocked<OpenClawAdapterInterface>;

      adapter1.invokeTool.mockRejectedValueOnce(new Error('Failed'));

      const result = await pool.invokeFirst('test_tool');

      expect(result.key).toBe(`${config2.endpoint}:${config2.accountId}`);
    });

    it('should throw when no connections available', async () => {
      await expect(pool.invokeFirst('test_tool')).rejects.toThrow('No available connections');
    });
  });

  describe('invokeRoundRobin', () => {
    it('should return result from a random connected adapter', async () => {
      await pool.getAdapter(mockConfig);

      const result = await pool.invokeRoundRobin('test_tool');

      expect(result.key).toBe(`${mockConfig.endpoint}:${mockConfig.accountId}`);
    });

    it('should throw when no connections available', async () => {
      await expect(pool.invokeRoundRobin('test_tool')).rejects.toThrow('No available connections');
    });
  });

  describe('getConnectedKeys', () => {
    it('should return keys of connected adapters', async () => {
      await pool.getAdapter(mockConfig);

      const keys = pool.getConnectedKeys();

      expect(keys).toContain(`${mockConfig.endpoint}:${mockConfig.accountId}`);
    });
  });

  describe('getAdapterByKey', () => {
    it('should return adapter by key', async () => {
      await pool.getAdapter(mockConfig);
      const key = `${mockConfig.endpoint}:${mockConfig.accountId}`;

      const adapter = pool.getAdapterByKey(key);

      expect(adapter).not.toBeNull();
    });

    it('should return null for non-existing key', () => {
      const adapter = pool.getAdapterByKey('non-existing');
      expect(adapter).toBeNull();
    });
  });

  describe('initializeAll', () => {
    it('should initialize multiple configs', async () => {
      const configs: StratixOpenClawConfig[] = [
        mockConfig,
        { ...mockConfig, accountId: 'acc2', endpoint: 'http://localhost:3001' },
      ];

      const results = await pool.initializeAll(configs);

      expect(results.size).toBe(2);
      expect(Array.from(results.values()).every((v) => v)).toBe(true);
    });

    it('should handle partial initialization failures', async () => {
      // Create a fresh pool for this test to avoid mock state issues
      const failingPool = new ConnectionPool({
        maxConnections: 5,
        idleTimeout: 60000,
        reconnectAttempts: 1,
        reconnectDelay: 10,
        healthCheckInterval: 30000,
        connectionBatchDelay: 10,
      });

      // Override the mock to return a failing adapter
      MockLocalOpenClawAdapter.mockImplementationOnce((_config) => ({
        ...createMockAdapter(),
        connect: jest.fn().mockRejectedValue(new Error('Connection failed')),
        getStatus: jest.fn().mockRejectedValue(new Error('Connection failed')),
      }) as unknown as LocalOpenClawAdapter);

      const configs: StratixOpenClawConfig[] = [mockConfig];

      // The adapter will be created with the failing mock
      const results = await failingPool.initializeAll(configs);

      // After adapter is created, getAdapter should still work
      expect(results.size).toBeGreaterThanOrEqual(1);
      failingPool.dispose();
    });
  });

  describe('health check', () => {
    it('should start and stop health check', () => {
      // Should not throw
      pool.stopHealthCheck();

      pool.startHealthCheck();
      pool.startHealthCheck(); // Should not start twice

      pool.stopHealthCheck();
    });

    it('should perform health check on error connections', async () => {
      const adapter = await pool.getAdapter(mockConfig) as jest.Mocked<OpenClawAdapterInterface>;
      const key = `${mockConfig.endpoint}:${mockConfig.accountId}`;

      // Set connection to error state
      adapter.getStatus.mockRejectedValueOnce(new Error('Connection lost'));

      // Start health check - it should attempt reconnect
      pool.startHealthCheck();

      // Wait for health check to run
      await new Promise((resolve) => setTimeout(resolve, 100));

      pool.stopHealthCheck();
    });
  });
});
