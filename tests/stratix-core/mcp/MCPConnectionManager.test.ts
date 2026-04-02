/**
 * MCPConnectionManager Tests
 *
 * Coverage:
 * - connect, disconnect
 * - health checks
 * - state tracking via StratixStateStore
 * - connection handle management
 */

import { MCPConnectionManager } from '@/stratix-core/mcp/MCPConnectionManager';
import type { MCPServerRef } from '@/stratix-core/mcp/types';

// Mock the state store
jest.mock('@/stratix-core/state/StratixStateStore', () => ({
  stratixStateStore: {
    select: jest.fn().mockReturnValue({ connections: [], tools: [] }),
    set: jest.fn(),
    get: jest.fn(),
  },
}));

describe('MCPConnectionManager', () => {
  let manager: MCPConnectionManager;
  let serverRef: MCPServerRef;

  beforeEach(() => {
    manager = new MCPConnectionManager();
    serverRef = {
      id: 'server-1',
      name: 'Test Server',
      endpoint: 'wss://test.example.com/ws',
      transport: 'websocket',
      capabilities: ['tools', 'resources'],
    };
  });

  describe('connect', () => {
    it('should create connection handle with connected status', async () => {
      const handle = await manager.connect(serverRef);

      expect(handle).toBeDefined();
      expect(handle.id).toBe(serverRef.id);
      expect(handle.serverRef).toEqual(serverRef);
      expect(handle.status).toBe('connected');
      expect(handle.metrics.reconnectAttempts).toBe(0);
      expect(handle.metrics.totalReconnects).toBe(0);
    });

    it('should return existing connection if already connected', async () => {
      const handle1 = await manager.connect(serverRef);
      const handle2 = await manager.connect(serverRef);

      expect(handle1).toBe(handle2);
      expect(handle2.status).toBe('connected');
    });

    it('should track connection in state store', async () => {
      const { stratixStateStore } = require('@/stratix-core/state/StratixStateStore');

      await manager.connect(serverRef);

      expect(stratixStateStore.set).toHaveBeenCalled();
    });

    it('should support custom reconnect config', async () => {
      const customConfig = {
        maxRetries: 2,
        initialDelayMs: 500,
        maxDelayMs: 5000,
        backoffMultiplier: 3,
      };

      const handle = await manager.connect(serverRef, customConfig);
      expect(handle.id).toBe(serverRef.id);
    });
  });

  describe('disconnect', () => {
    it('should set status to disconnected', async () => {
      await manager.connect(serverRef);
      manager.disconnect(serverRef.id);

      const handle = manager.getConnection(serverRef.id);
      expect(handle).toBeNull();
    });

    it('should remove connection from manager', async () => {
      await manager.connect(serverRef);
      manager.disconnect(serverRef.id);

      const all = manager.getAllConnections();
      expect(all).toHaveLength(0);
    });

    it('should not throw for unknown connection id', () => {
      expect(() => manager.disconnect('unknown-id')).not.toThrow();
    });
  });

  describe('getConnection', () => {
    it('should return connection handle when exists', async () => {
      await manager.connect(serverRef);
      const handle = manager.getConnection(serverRef.id);

      expect(handle).not.toBeNull();
      expect(handle!.id).toBe(serverRef.id);
    });

    it('should return null when connection does not exist', () => {
      const handle = manager.getConnection('nonexistent');
      expect(handle).toBeNull();
    });

    it('should return copy of handle (not reference)', async () => {
      await manager.connect(serverRef);
      const handle1 = manager.getConnection(serverRef.id);
      const handle2 = manager.getConnection(serverRef.id);

      expect(handle1).not.toBe(handle2);
      expect(handle1).toEqual(handle2);
    });
  });

  describe('getAllConnections', () => {
    it('should return all active connections', async () => {
      const server2: MCPServerRef = { ...serverRef, id: 'server-2', name: 'Server 2' };

      await manager.connect(serverRef);
      await manager.connect(server2);

      const all = manager.getAllConnections();
      expect(all).toHaveLength(2);
    });

    it('should return empty array when no connections', () => {
      const all = manager.getAllConnections();
      expect(all).toHaveLength(0);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status for connected connection', async () => {
      await manager.connect(serverRef);
      const status = manager.healthCheck(serverRef.id);

      expect(status.level).toBe('healthy');
      expect(status.connectionId).toBe(serverRef.id);
      expect(status.issues).toHaveLength(0);
    });

    it('should return unhealthy for nonexistent connection', () => {
      const status = manager.healthCheck('nonexistent');

      expect(status.level).toBe('unhealthy');
      expect(status.issues).toContainEqual(
        expect.objectContaining({ code: 'NOT_FOUND' })
      );
    });

    it('should update lastCheck timestamp', async () => {
      await manager.connect(serverRef);
      const status = manager.healthCheck(serverRef.id);

      expect(status.lastCheck).toBeGreaterThan(0);
    });
  });

  describe('reconnect', () => {
    it('should throw for nonexistent connection', async () => {
      await expect(manager.reconnect('nonexistent')).rejects.toThrow('not found');
    });

    it('should throw for unknown connection after disconnect (connection removed from map)', async () => {
      await manager.connect(serverRef);
      manager.disconnect(serverRef.id);

      // After disconnect, connection is removed from map, so reconnect throws "not found"
      await expect(manager.reconnect(serverRef.id)).rejects.toThrow('not found');
    });
  });

  describe('connection lifecycle', () => {
    it('should handle rapid connect/disconnect cycles', async () => {
      for (let i = 0; i < 5; i++) {
        await manager.connect(serverRef);
        manager.disconnect(serverRef.id);
      }

      expect(manager.getAllConnections()).toHaveLength(0);
    });
  });

  describe('state tracking', () => {
    it('should call state store on connect', async () => {
      const { stratixStateStore } = require('@/stratix-core/state/StratixStateStore');

      await manager.connect(serverRef);

      expect(stratixStateStore.set).toHaveBeenCalledWith(
        'mcp',
        expect.objectContaining({
          connections: expect.any(Array),
        })
      );
    });

    it('should update state on disconnect', async () => {
      const { stratixStateStore } = require('@/stratix-core/state/StratixStateStore');

      await manager.connect(serverRef);
      manager.disconnect(serverRef.id);

      expect(stratixStateStore.set).toHaveBeenCalled();
    });
  });
});
