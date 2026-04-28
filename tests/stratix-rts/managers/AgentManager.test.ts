// Mock Phaser before any imports that use it
jest.mock('phaser', () => ({
  __esModule: true,
  default: {
    Math: {
      Between: jest.fn().mockReturnValue(500),
    },
    Geom: {
      Rectangle: class Rectangle {
        x: number;
        y: number;
        width: number;
        height: number;
        constructor(x: number, y: number, width: number, height: number) {
          this.x = x;
          this.y = y;
          this.width = width;
          this.height = height;
        }
        static Contains(rect: Rectangle, x: number, y: number): boolean {
          return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
        }
      },
    },
  },
  Math: {
    Between: jest.fn().mockReturnValue(500),
  },
  Geom: {
    Rectangle: class Rectangle {
      x: number;
      y: number;
      width: number;
      height: number;
      constructor(x: number, y: number, width: number, height: number) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
      }
      static Contains(rect: Rectangle, x: number, y: number): boolean {
        return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
      }
    },
  },
}));

// Mock AgentSprite to avoid Phaser.GameObjects.Container dependency
jest.mock('@/stratix-rts/sprites/AgentSprite', () => {
  return {
    AgentSprite: jest.fn().mockImplementation((_scene: any, x: number, y: number, config: any, _textureKey?: string, _isPlaceholder?: boolean) => {
      const sprite = {
        x,
        y,
        name: config.name,
        getAgentId: jest.fn().mockReturnValue(config.agentId),
        getAgentType: jest.fn().mockReturnValue(config.type || 'dev'),
        getCharacterId: jest.fn().mockReturnValue(config.profile?.characterId || null),
        replaceTexture: jest.fn(),
        setHighlight: jest.fn(),
        setData: jest.fn(),
        startDrag: jest.fn(),
        updateDrag: jest.fn(),
        endDrag: jest.fn(),
        destroy: jest.fn(),
      };
      return sprite;
    }),
  };
});

// Mock rtsEventBus
jest.mock('@/stratix-rts/events/core/RTSEventBus', () => ({
  rtsEventBus: {
    on: jest.fn().mockReturnValue(jest.fn()),
    off: jest.fn(),
    emit: jest.fn(),
  },
}));

import { AgentManager, AgentManagerDeps } from '@/stratix-rts/managers/AgentManager';
import { rtsEventBus } from '@/stratix-rts/events/core/RTSEventBus';
import type { MovementSystem } from '@/stratix-rts/systems/MovementSystem';
import type { RTSStateBridge } from '@/stratix-rts/state/RTSStateBridge';
import type RTSCharacterRenderer from '@/stratix-rts/services/RTSCharacterRenderer';
import type { ProjectManagerIntegration } from '@/stratix-project/ProjectManagerIntegrationHTTP';
import type { UnifiedZoneManager } from '@/stratix-rts/zones/UnifiedZoneManager';
import type { StratixAgentConfig } from '@/stratix-core/stratix-protocol';

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function createAgentConfig(partial: Partial<StratixAgentConfig> & { agentId: string; name: string }): StratixAgentConfig {
  return {
    type: 'dev',
    profile: {
      characterId: 'char-default',
      name: 'Default Character',
      bodyType: 'male',
      parts: {},
    },
    backendType: 'stratix',
    configStatus: 'ready',
    ...partial,
  } as StratixAgentConfig;
}

describe('AgentManager', () => {
  let manager: AgentManager;
  let mockScene: any;
  let mockMovementSystem: jest.Mocked<MovementSystem>;
  let mockStateBridge: jest.Mocked<RTSStateBridge>;
  let mockCharacterRenderer: jest.Mocked<RTSCharacterRenderer>;
  let mockProjectManagerIntegration: jest.Mocked<ProjectManagerIntegration>;
  let mockUnifiedZoneManager: jest.Mocked<UnifiedZoneManager>;
  let deps: AgentManagerDeps;

  beforeEach(() => {
    mockScene = {
      add: {
        existing: jest.fn(),
        sprite: jest.fn().mockReturnValue({
          setDepth: jest.fn(),
          setOrigin: jest.fn(),
          setScale: jest.fn(),
          setTint: jest.fn(),
          destroy: jest.fn(),
        }),
        graphics: jest.fn().mockReturnValue({
          setDepth: jest.fn(),
          clear: jest.fn(),
          lineStyle: jest.fn(),
          strokeRect: jest.fn(),
          fillStyle: jest.fn(),
          fillRect: jest.fn(),
          destroy: jest.fn(),
        }),
        text: jest.fn().mockReturnValue({
          setDepth: jest.fn(),
          setOrigin: jest.fn(),
          destroy: jest.fn(),
        }),
      },
      events: {
        emit: jest.fn(),
        on: jest.fn(),
        off: jest.fn(),
      },
      cameras: {
        main: {
          scrollX: 0,
          scrollY: 0,
          zoom: 1,
          width: 1920,
          height: 1080,
        },
      },
      tweens: {
        add: jest.fn(),
      },
    };

    mockMovementSystem = {
      setOnMovementComplete: jest.fn(),
      moveTo: jest.fn(),
      stop: jest.fn(),
      stopAll: jest.fn(),
      isMoving: jest.fn(),
      getTarget: jest.fn(),
      update: jest.fn(),
    } as any;

    mockStateBridge = {
      registerAgent: jest.fn(),
      unregisterAgent: jest.fn(),
      syncSelection: jest.fn(),
      updateAgentStatus: jest.fn(),
      agentEnterZone: jest.fn(),
      agentLeaveZone: jest.fn(),
    } as any;

    mockCharacterRenderer = {
      loadCharacterTexture: jest.fn().mockResolvedValue({ type: 'fallback', textureKey: 'stratix-agent' }),
    } as any;

    const mockProjectClient = {
      addZoneMember: jest.fn().mockResolvedValue(undefined),
      removeZoneMember: jest.fn().mockResolvedValue(undefined),
    };

    mockProjectManagerIntegration = {
      getProjectClient: jest.fn().mockReturnValue(mockProjectClient),
      getAllProjectZones: jest.fn().mockReturnValue(new Map()),
      createProjectWithBounds: jest.fn(),
    } as any;

    mockUnifiedZoneManager = {
      getZone: jest.fn(),
      getAllZones: jest.fn().mockReturnValue(new Map()),
      register: jest.fn(),
      unregister: jest.fn(),
      getTaskZones: jest.fn().mockReturnValue(new Map()),
      getProjectZones: jest.fn().mockReturnValue(new Map()),
    } as any;

    deps = {
      stateBridge: mockStateBridge,
      characterRenderer: mockCharacterRenderer,
      projectManagerIntegration: mockProjectManagerIntegration,
      agentZoneTracking: new Map<string, string>(),
      getSelectedZoneIds: jest.fn().mockReturnValue(new Set<string>()),
      getUnifiedZoneManager: jest.fn().mockReturnValue(mockUnifiedZoneManager),
      clearZoneSelection: jest.fn(),
    };

    manager = new AgentManager(mockScene, mockMovementSystem, deps);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== Agent Creation ====================

  describe('addAgentSprite', () => {
    it('should create and store a new agent sprite', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      const sprite = await manager.addAgentSprite(config);

      expect(sprite).toBeDefined();
      expect(manager.agentSprites.has('agent-1')).toBe(true);
      expect(mockScene.add.existing).toHaveBeenCalledWith(sprite);
      expect(mockStateBridge.registerAgent).toHaveBeenCalledWith('agent-1', 'Test Agent', {});
    });

    it('should generate random position when not provided', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
      });

      mockFetch.mockResolvedValueOnce({ ok: true });

      const sprite = await manager.addAgentSprite(config);

      expect(sprite.x).toBeDefined();
      expect(sprite.y).toBeDefined();
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should replace existing sprite with same agentId', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      const sprite1 = await manager.addAgentSprite(config);
      const sprite2 = await manager.addAgentSprite(config);

      expect(sprite1.destroy).toHaveBeenCalled();
      expect(manager.agentSprites.get('agent-1')).toBe(sprite2);
    });

    it('should use placeholder texture when profile is provided', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
        profile: {
          characterId: 'char-1',
          name: 'Custom Char',
          bodyType: 'female',
          parts: {},
        },
      });

      mockCharacterRenderer.loadCharacterTexture.mockResolvedValueOnce({
        type: 'ready',
        textureKey: 'custom-texture',
      } as any);

      await manager.addAgentSprite(config);

      expect(mockCharacterRenderer.loadCharacterTexture).toHaveBeenCalledWith(
        config,
        expect.any(Function)
      );
    });
  });

  // ==================== Agent Removal ====================

  describe('removeAgent', () => {
    it('should remove agent sprite and clean up selection', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      const sprite = await manager.addAgentSprite(config);
      manager.selectAgent('agent-1');
      jest.clearAllMocks();

      manager.removeAgent('agent-1');

      expect(mockStateBridge.unregisterAgent).toHaveBeenCalledWith('agent-1');
      expect(sprite.destroy).toHaveBeenCalled();
      expect(manager.agentSprites.has('agent-1')).toBe(false);
      expect(manager.selectedAgentIds.has('agent-1')).toBe(false);
    });

    it('should not throw when removing non-existent agent', () => {
      expect(() => manager.removeAgent('non-existent')).not.toThrow();
    });

    it('should emit selection changed after removal', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      await manager.addAgentSprite(config);
      manager.selectAgent('agent-1');
      jest.clearAllMocks();

      manager.removeAgent('agent-1');

      expect(mockStateBridge.syncSelection).toHaveBeenCalled();
    });
  });

  // ==================== Agent Queries ====================

  describe('getAgentSprites', () => {
    it('should return the agent sprites map', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      await manager.addAgentSprite(config);
      const sprites = manager.getAgentSprites();

      expect(sprites).toBeInstanceOf(Map);
      expect(sprites.has('agent-1')).toBe(true);
    });
  });

  describe('getSelectedAgentIds', () => {
    it('should return empty set when no agents selected', () => {
      const selected = manager.getSelectedAgentIds();
      expect(selected.size).toBe(0);
    });

    it('should return selected agent ids', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      await manager.addAgentSprite(config);
      manager.selectAgent('agent-1');
      const selected = manager.getSelectedAgentIds();

      expect(selected.has('agent-1')).toBe(true);
    });
  });

  describe('getSelectedAgent', () => {
    it('should return undefined when no agent selected', () => {
      expect(manager.getSelectedAgent()).toBeUndefined();
    });

    it('should return the first selected agent', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      const sprite = await manager.addAgentSprite(config);
      manager.selectAgent('agent-1');

      expect(manager.getSelectedAgent()).toBe(sprite);
    });
  });

  describe('updateAgentPosition', () => {
    it('should update agent sprite position', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      const sprite = await manager.addAgentSprite(config);
      manager.updateAgentPosition('agent-1', { x: 300, y: 400 });

      expect(sprite.x).toBe(300);
      expect(sprite.y).toBe(400);
    });

    it('should not throw when updating non-existent agent', () => {
      expect(() => manager.updateAgentPosition('non-existent', { x: 0, y: 0 })).not.toThrow();
    });
  });

  // ==================== Agent Selection ====================

  describe('selectAgent', () => {
    it('should select agent and highlight sprite', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      const sprite = await manager.addAgentSprite(config);
      manager.selectAgent('agent-1');

      expect(manager.selectedAgentIds.has('agent-1')).toBe(true);
      expect(sprite.setHighlight).toHaveBeenCalledWith(true);
      expect(sprite.setData).toHaveBeenCalledWith('isSelected', true);
    });

    it('should not select non-existent agent', () => {
      manager.selectAgent('non-existent');
      expect(manager.selectedAgentIds.size).toBe(0);
    });

    it('should emit selection changed event', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      await manager.addAgentSprite(config);
      jest.clearAllMocks();
      manager.selectAgent('agent-1');

      expect(mockStateBridge.syncSelection).toHaveBeenCalled();
      expect(rtsEventBus.emit).toHaveBeenCalledWith(
        'scene:ui:update_selection',
        expect.any(Object)
      );
    });
  });

  describe('deselectAgent', () => {
    it('should deselect agent and remove highlight', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      const sprite = await manager.addAgentSprite(config);
      manager.selectAgent('agent-1');
      jest.clearAllMocks();

      manager.deselectAgent('agent-1');

      expect(manager.selectedAgentIds.has('agent-1')).toBe(false);
      expect(sprite.setHighlight).toHaveBeenCalledWith(false);
      expect(sprite.setData).toHaveBeenCalledWith('isSelected', false);
    });

    it('should not deselect non-existent agent', () => {
      expect(() => manager.deselectAgent('non-existent')).not.toThrow();
    });
  });

  describe('clearSelection', () => {
    it('should clear all agent selections', async () => {
      const config1 = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent 1',
        type: 'dev',
        position: { x: 100, y: 200 },
      });
      const config2 = createAgentConfig({
        agentId: 'agent-2',
        name: 'Test Agent 2',
        type: 'writer',
        position: { x: 300, y: 400 },
      });

      await manager.addAgentSprite(config1);
      await manager.addAgentSprite(config2);
      manager.selectAgent('agent-1');
      manager.selectAgent('agent-2');

      manager.clearSelection();

      expect(manager.selectedAgentIds.size).toBe(0);
    });

    it('should emit selection changed after clearing', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      await manager.addAgentSprite(config);
      manager.selectAgent('agent-1');
      jest.clearAllMocks();

      manager.clearSelection();

      expect(mockStateBridge.syncSelection).toHaveBeenCalled();
    });
  });

  // ==================== Selection Handlers ====================

  describe('handleSelect', () => {
    it('should select agents without shift key', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      await manager.addAgentSprite(config);
      manager.handleSelect(['agent-1'], false);

      expect(manager.selectedAgentIds.has('agent-1')).toBe(true);
      expect(deps.clearZoneSelection).toHaveBeenCalled();
    });

    it('should add to selection with shift key', async () => {
      const config1 = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent 1',
        type: 'dev',
        position: { x: 100, y: 200 },
      });
      const config2 = createAgentConfig({
        agentId: 'agent-2',
        name: 'Test Agent 2',
        type: 'writer',
        position: { x: 300, y: 400 },
      });

      await manager.addAgentSprite(config1);
      await manager.addAgentSprite(config2);
      manager.handleSelect(['agent-1'], false);
      manager.handleSelect(['agent-2'], true);

      expect(manager.selectedAgentIds.has('agent-1')).toBe(true);
      expect(manager.selectedAgentIds.has('agent-2')).toBe(true);
    });

    it('should toggle selection with shift key on already selected agent', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      await manager.addAgentSprite(config);
      manager.selectAgent('agent-1');
      manager.handleSelect(['agent-1'], true);

      expect(manager.selectedAgentIds.has('agent-1')).toBe(false);
    });
  });

  describe('handleBoxSelect', () => {
    it('should select agents within bounds', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      await manager.addAgentSprite(config);
      const Phaser = require('phaser');
      const bounds = new Phaser.Geom.Rectangle(50, 150, 100, 100);
      manager.handleBoxSelect(bounds, false);

      expect(manager.selectedAgentIds.has('agent-1')).toBe(true);
    });

    it('should not select agents outside bounds', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      await manager.addAgentSprite(config);
      const Phaser = require('phaser');
      const bounds = new Phaser.Geom.Rectangle(500, 500, 100, 100);
      manager.handleBoxSelect(bounds, false);

      expect(manager.selectedAgentIds.has('agent-1')).toBe(false);
    });
  });

  describe('handleSelectAllSameType', () => {
    it('should select all agents of the same type', async () => {
      const config1 = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent 1',
        type: 'dev',
        position: { x: 100, y: 200 },
      });
      const config2 = createAgentConfig({
        agentId: 'agent-2',
        name: 'Test Agent 2',
        type: 'dev',
        position: { x: 300, y: 400 },
      });
      const config3 = createAgentConfig({
        agentId: 'agent-3',
        name: 'Test Agent 3',
        type: 'writer',
        position: { x: 500, y: 600 },
      });

      await manager.addAgentSprite(config1);
      await manager.addAgentSprite(config2);
      await manager.addAgentSprite(config3);

      manager.handleSelectAllSameType('agent-1');

      expect(manager.selectedAgentIds.has('agent-1')).toBe(true);
      expect(manager.selectedAgentIds.has('agent-2')).toBe(true);
      expect(manager.selectedAgentIds.has('agent-3')).toBe(false);
    });

    it('should do nothing for non-existent agent', () => {
      manager.handleSelectAllSameType('non-existent');
      expect(manager.selectedAgentIds.size).toBe(0);
    });
  });

  describe('handleSelectAllAgents', () => {
    it('should select all agents', async () => {
      const config1 = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent 1',
        type: 'dev',
        position: { x: 100, y: 200 },
      });
      const config2 = createAgentConfig({
        agentId: 'agent-2',
        name: 'Test Agent 2',
        type: 'writer',
        position: { x: 300, y: 400 },
      });

      await manager.addAgentSprite(config1);
      await manager.addAgentSprite(config2);
      manager.handleSelectAllAgents();

      expect(manager.selectedAgentIds.has('agent-1')).toBe(true);
      expect(manager.selectedAgentIds.has('agent-2')).toBe(true);
    });
  });

  // ==================== Agent Movement/Drag ====================

  describe('handleSpriteDragStart', () => {
    it('should start drag for all selected agents', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      const sprite = await manager.addAgentSprite(config);
      manager.selectAgent('agent-1');
      manager.handleSpriteDragStart('agent-1', 150, 250);

      expect(sprite.startDrag).toHaveBeenCalledWith(150, 250);
    });
  });

  describe('handleSpriteDragUpdate', () => {
    it('should update drag for all selected agents', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      const sprite = await manager.addAgentSprite(config);
      manager.selectAgent('agent-1');
      manager.handleSpriteDragUpdate(160, 260);

      expect(sprite.updateDrag).toHaveBeenCalledWith(160, 260);
    });
  });

  describe('handleSpriteDragEnd', () => {
    it('should end drag for all selected agents', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      const sprite = await manager.addAgentSprite(config);
      manager.selectAgent('agent-1');
      await manager.handleSpriteDragEnd();

      expect(sprite.endDrag).toHaveBeenCalled();
    });

    it('should register agent in zone when dropped over a zone', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      await manager.addAgentSprite(config);
      manager.selectAgent('agent-1');

      const mockZone = {
        getBounds: jest.fn().mockReturnValue({ x: 50, y: 150, width: 200, height: 200 }),
      };
      (mockProjectManagerIntegration.getAllProjectZones as jest.Mock).mockReturnValue(new Map([['zone-1', mockZone]]));

      await manager.handleSpriteDragEnd();

      const projectClient = mockProjectManagerIntegration.getProjectClient();
      expect(projectClient.addZoneMember).toHaveBeenCalledWith('zone-1', 'agent-1');
    });
  });

  // ==================== emitSelectionChanged ====================

  describe('emitSelectionChanged', () => {
    it('should emit agent info when agent is selected', async () => {
      const config = createAgentConfig({
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        position: { x: 100, y: 200 },
      });

      await manager.addAgentSprite(config);
      manager.selectAgent('agent-1');

      expect(rtsEventBus.emit).toHaveBeenCalledWith(
        'scene:ui:agent_info',
        expect.objectContaining({
          agentId: 'agent-1',
          name: 'Test Agent',
          type: 'dev',
        })
      );
    });

    it('should emit zone info when zone is selected', () => {
      const mockZone = {
        getZoneId: jest.fn().mockReturnValue('zone-1'),
        zoneName: 'Test Zone',
        getBounds: jest.fn().mockReturnValue({ x: 50, y: 150, width: 200, height: 200 }),
      };
      mockUnifiedZoneManager.getZone.mockReturnValue(mockZone as any);
      (deps.getSelectedZoneIds as jest.Mock).mockReturnValue(new Set(['zone-1']));

      manager.emitSelectionChanged();

      expect(rtsEventBus.emit).toHaveBeenCalledWith(
        'scene:ui:zone_info',
        expect.objectContaining({
          zoneId: 'zone-1',
          name: 'Test Zone',
        })
      );
    });
  });
});
