/**
 * MCPConnectionManager Tests - Unit tests (no real network)
 */

jest.mock('@/stratix-core/state/StratixStateStore', () => ({
  stratixStateStore: {
    select: jest.fn().mockReturnValue({ connections: [], tools: [] }),
    set: jest.fn(),
    get: jest.fn(),
  },
}));

jest.mock('@/stratix-core/retry/RetryPolicyEngine', () => ({
  retryPolicyEngine: {
    executeWithRetry: jest.fn((fn) => fn()),
  },
}));

import { MCPConnectionManager } from '@/stratix-core/mcp/MCPConnectionManager';
import type { MCPServerRef } from '@/stratix-core/mcp/types';

describe('MCPConnectionManager', () => {
  let manager: MCPConnectionManager;
  const serverRef: MCPServerRef = {
    id: 'server-1',
    name: 'Test Server',
    endpoint: 'wss://test.example.com/ws',
    transport: 'websocket',
    capabilities: ['tools'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new MCPConnectionManager();
  });

  describe('disconnect', () => {
    it('should handle disconnect of non-existent connection', () => {
      expect(() => manager.disconnect('non-existent')).not.toThrow();
    });
  });

  describe('getConnection', () => {
    it('should return null for non-existent connection', () => {
      expect(manager.getConnection('non-existent')).toBeNull();
    });
  });

  describe('healthCheck', () => {
    it('should return unhealthy for non-existent connection', async () => {
      const health = await manager.healthCheck('non-existent');
      expect(health.level).toBe('unhealthy');
    });
  });

  describe('listConnections', () => {
    it('should return null for unknown connection', () => {
      expect(manager.getConnection('any')).toBeNull();
    });
  });
});
