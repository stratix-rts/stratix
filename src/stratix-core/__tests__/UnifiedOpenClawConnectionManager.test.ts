/**
 * UnifiedOpenClawConnectionManager 测试用例
 */

import { UnifiedOpenClawConnectionManager } from './UnifiedOpenClawConnectionManager';
import type { UnifiedOpenClawConfig } from '../stratix-protocol';

describe('UnifiedOpenClawConnectionManager', () => {
  let manager: UnifiedOpenClawConnectionManager;

  beforeEach(() => {
    manager = UnifiedOpenClawConnectionManager.getInstance();
  });

  afterEach(async () => {
    await manager.disconnect();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = UnifiedOpenClawConnectionManager.getInstance();
      const instance2 = UnifiedOpenClawConnectionManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('initialize', () => {
    it('should initialize with local mode', async () => {
      const config: UnifiedOpenClawConfig = {
        mode: 'local',
        localEndpoint: 'http://127.0.0.1:18789',
        credentials: {
          accountId: 'test',
        },
      };

      const result = await manager.initialize(config);
      expect(result).toBeDefined();
    });

    it('should initialize with auto mode', async () => {
      const config: UnifiedOpenClawConfig = {
        mode: 'auto',
        localEndpoint: 'http://127.0.0.1:18789',
        credentials: {
          accountId: 'test',
        },
      };

      const result = await manager.initialize(config);
      expect(result).toBeDefined();
    });

    it('should throw error for tailscale mode in non-electron', async () => {
      const config: UnifiedOpenClawConfig = {
        mode: 'tailscale',
        tailscaleNodeId: 'node-123',
        credentials: {
          accountId: 'test',
        },
      };

      await expect(manager.initialize(config)).rejects.toThrow('Tailscale mode only supported in Electron');
    });
  });

  describe('getStatus', () => {
    it('should return disconnected status when not initialized', async () => {
      const status = await manager.getStatus();
      expect(status.connected).toBe(false);
      expect(status.error).toBe('Not initialized');
    });
  });

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      expect(manager.isConnected()).toBe(false);
    });
  });

  describe('addStatusListener', () => {
    it('should add and remove listener', () => {
      const listener = jest.fn();
      const remove = manager.addStatusListener(listener);
      
      expect(typeof remove).toBe('function');
      
      remove();
    });
  });

  describe('discoverTailscaleNodes', () => {
    it('should return empty array in non-electron', async () => {
      const nodes = await manager.discoverTailscaleNodes();
      expect(nodes).toEqual([]);
    });
  });
});
