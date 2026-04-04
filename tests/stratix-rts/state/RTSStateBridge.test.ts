import { RTSStateBridge } from '@/stratix-rts/state/RTSStateBridge';
import { stratixStateStore } from '@/stratix-core/state';
import type { AgentStatus } from '@/stratix-rts/sprites/AgentSprite';

// Mock stratixStateStore
jest.mock('@/stratix-core/state', () => ({
  stratixStateStore: {
    getAgent: jest.fn(),
    setAgent: jest.fn(),
    updateAgent: jest.fn(),
    removeAgent: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
  },
}));

describe('RTSStateBridge', () => {
  let bridge: RTSStateBridge;

  beforeEach(() => {
    bridge = new RTSStateBridge();
    jest.clearAllMocks();
  });

  describe('registerAgent', () => {
    it('should register a new agent with default state', () => {
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue(undefined);

      bridge.registerAgent('agent-1', 'TestAgent', {});

      expect(stratixStateStore.setAgent).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        id: 'agent-1',
        name: 'TestAgent',
        status: expect.objectContaining({
          config: 'draft',
          connection: 'disconnected',
          activity: 'idle',
        }),
        config: {},
      }));
    });

    it('should update existing agent instead of creating new', () => {
      const existingAgent = {
        id: 'agent-1',
        name: 'OldName',
        status: { config: 'draft' as const, connection: 'disconnected' as const, activity: 'idle' as const },
        config: {},
      };
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue(existingAgent);

      bridge.registerAgent('agent-1', 'NewName', { someConfig: true });

      expect(stratixStateStore.setAgent).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        id: 'agent-1',
        name: 'OldName',
      }));
    });

    it('should preserve config from existing agent', () => {
      const existingAgent = {
        id: 'agent-1',
        name: 'TestAgent',
        status: { config: 'active' as const, connection: 'connected' as const, activity: 'busy' as const },
        config: { existingKey: 'existingValue' },
      };
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue(existingAgent);

      bridge.registerAgent('agent-1', 'TestAgent', { newKey: 'newValue' });

      expect(stratixStateStore.setAgent).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        config: { existingKey: 'existingValue' },
      }));
    });
  });

  describe('updateAgentStatus', () => {
    it('should map RTS online to StateStore busy', () => {
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue({
        id: 'agent-1',
        name: 'TestAgent',
        status: { config: 'active' as const, connection: 'connected' as const, activity: 'idle' as const },
        config: {},
      });

      bridge.updateAgentStatus('agent-1', 'online');

      expect(stratixStateStore.updateAgent).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        status: expect.objectContaining({ activity: 'busy' }),
        lastActiveAt: expect.any(Number),
      }));
    });

    it('should map RTS offline to StateStore idle', () => {
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue({
        id: 'agent-1',
        name: 'TestAgent',
        status: { config: 'active' as const, connection: 'connected' as const, activity: 'busy' as const },
        config: {},
      });

      bridge.updateAgentStatus('agent-1', 'offline');

      expect(stratixStateStore.updateAgent).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        status: expect.objectContaining({ activity: 'idle' }),
      }));
    });

    it('should map RTS busy to StateStore busy', () => {
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue({
        id: 'agent-1',
        name: 'TestAgent',
        status: { config: 'active' as const, connection: 'connected' as const, activity: 'idle' as const },
        config: {},
      });

      bridge.updateAgentStatus('agent-1', 'busy');

      expect(stratixStateStore.updateAgent).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        status: expect.objectContaining({ activity: 'busy' }),
      }));
    });

    it('should map RTS error to StateStore error', () => {
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue({
        id: 'agent-1',
        name: 'TestAgent',
        status: { config: 'active' as const, connection: 'connected' as const, activity: 'busy' as const },
        config: {},
      });

      bridge.updateAgentStatus('agent-1', 'error');

      expect(stratixStateStore.updateAgent).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        status: expect.objectContaining({ activity: 'error' }),
      }));
    });

    it('should deduplicate same status updates', () => {
      const agent = {
        id: 'agent-1',
        name: 'TestAgent',
        status: { config: 'active' as const, connection: 'connected' as const, activity: 'busy' as const },
        config: {},
      };
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue(agent);

      bridge.updateAgentStatus('agent-1', 'busy');

      expect(stratixStateStore.updateAgent).not.toHaveBeenCalled();
    });

    it('should handle non-existent agent by still calling updateAgent (store handles it)', () => {
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue(undefined);

      // The bridge still calls updateAgent, which handles the non-existent agent internally
      expect(() => bridge.updateAgentStatus('non-existent', 'online')).not.toThrow();
      expect(stratixStateStore.updateAgent).toHaveBeenCalled();
    });
  });

  describe('agentEnterZone', () => {
    it('should set currentZone on agent', () => {
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue({
        id: 'agent-1',
        name: 'TestAgent',
        status: { config: 'active' as const, connection: 'connected' as const, activity: 'busy' as const },
        config: {},
      });

      bridge.agentEnterZone('agent-1', 'zone-1');

      expect(stratixStateStore.updateAgent).toHaveBeenCalledWith('agent-1', {
        currentZone: 'zone-1',
      });
    });

    it('should deduplicate if already in zone', () => {
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue({
        id: 'agent-1',
        name: 'TestAgent',
        status: { config: 'active' as const, connection: 'connected' as const, activity: 'busy' as const },
        config: {},
        currentZone: 'zone-1',
      });

      bridge.agentEnterZone('agent-1', 'zone-1');

      expect(stratixStateStore.updateAgent).not.toHaveBeenCalled();
    });

    it('should handle non-existent agent gracefully', () => {
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue(undefined);

      expect(() => bridge.agentEnterZone('non-existent', 'zone-1')).not.toThrow();
    });
  });

  describe('agentLeaveZone', () => {
    it('should clear currentZone on agent', () => {
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue({
        id: 'agent-1',
        name: 'TestAgent',
        status: { config: 'active' as const, connection: 'connected' as const, activity: 'busy' as const },
        config: {},
        currentZone: 'zone-1',
      });

      bridge.agentLeaveZone('agent-1');

      expect(stratixStateStore.updateAgent).toHaveBeenCalledWith('agent-1', {
        currentZone: undefined,
      });
    });

    it('should deduplicate if not in any zone', () => {
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue({
        id: 'agent-1',
        name: 'TestAgent',
        status: { config: 'active' as const, connection: 'connected' as const, activity: 'busy' as const },
        config: {},
        currentZone: undefined,
      });

      bridge.agentLeaveZone('agent-1');

      expect(stratixStateStore.updateAgent).not.toHaveBeenCalled();
    });

    it('should handle non-existent agent gracefully', () => {
      (stratixStateStore.getAgent as jest.Mock).mockReturnValue(undefined);

      expect(() => bridge.agentLeaveZone('non-existent')).not.toThrow();
    });
  });

  describe('unregisterAgent', () => {
    it('should remove agent from store', () => {
      bridge.unregisterAgent('agent-1');

      expect(stratixStateStore.removeAgent).toHaveBeenCalledWith('agent-1');
    });
  });

  describe('syncSelection', () => {
    it('should update selectedAgents and selectedZone in store', () => {
      const uiState = {
        selectedAgents: [] as string[],
        selectedZone: null,
        sidebarOpen: true,
        theme: 'auto' as const,
      };
      (stratixStateStore.get as jest.Mock).mockReturnValue(uiState);

      bridge.syncSelection(['agent-1', 'agent-2'], 'zone-1');

      expect(stratixStateStore.set).toHaveBeenCalledWith('ui', expect.objectContaining({
        selectedAgents: ['agent-1', 'agent-2'],
        selectedZone: 'zone-1',
      }));
    });

    it('should keep existing selectedZone when deselecting zone', () => {
      const uiState = {
        selectedAgents: [] as string[],
        selectedZone: 'zone-1',
        sidebarOpen: true,
        theme: 'auto' as const,
      };
      (stratixStateStore.get as jest.Mock).mockReturnValue(uiState);

      bridge.syncSelection(['agent-1'], null);

      expect(stratixStateStore.set).toHaveBeenCalledWith('ui', expect.objectContaining({
        selectedAgents: ['agent-1'],
        selectedZone: 'zone-1',
      }));
    });

    it('should deduplicate same selection', () => {
      const uiState = {
        selectedAgents: ['agent-1', 'agent-2'],
        selectedZone: 'zone-1',
        sidebarOpen: true,
        theme: 'auto' as const,
      };
      (stratixStateStore.get as jest.Mock).mockReturnValue(uiState);

      bridge.syncSelection(['agent-1', 'agent-2'], 'zone-1');

      expect(stratixStateStore.set).not.toHaveBeenCalled();
    });

    it('should detect agents change by string comparison', () => {
      const uiState = {
        selectedAgents: ['agent-1'],
        selectedZone: null,
        sidebarOpen: true,
        theme: 'auto' as const,
      };
      (stratixStateStore.get as jest.Mock).mockReturnValue(uiState);

      bridge.syncSelection(['agent-2'], null);

      expect(stratixStateStore.set).toHaveBeenCalled();
    });

    it('should detect zone change', () => {
      const uiState = {
        selectedAgents: [] as string[],
        selectedZone: 'zone-1',
        sidebarOpen: true,
        theme: 'auto' as const,
      };
      (stratixStateStore.get as jest.Mock).mockReturnValue(uiState);

      bridge.syncSelection([], 'zone-2');

      expect(stratixStateStore.set).toHaveBeenCalledWith('ui', expect.objectContaining({
        selectedZone: 'zone-2',
      }));
    });
  });
});
