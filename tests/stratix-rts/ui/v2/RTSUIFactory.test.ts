/**
 * RTSUIFactory Unit Tests
 *
 * Tests factory methods for creating and managing UI components
 * Mocks Phaser dependencies
 */

// Mock components before importing
jest.mock('@/stratix-rts/ui/v2/TopBarV2', () => ({
  TopBarV2: jest.fn().mockImplementation(() => ({
    create: jest.fn().mockReturnThis(),
    mount: jest.fn(),
    resize: jest.fn(),
    destroy: jest.fn(),
  })),
}));

jest.mock('@/stratix-rts/ui/v2/MinimapV2', () => ({
  MinimapV2: jest.fn().mockImplementation(() => ({
    create: jest.fn().mockReturnThis(),
    mount: jest.fn(),
    resize: jest.fn(),
    destroy: jest.fn(),
  })),
}));

jest.mock('@/stratix-rts/ui/v2/CommandPanelV2', () => ({
  CommandPanelV2: jest.fn().mockImplementation(() => ({
    create: jest.fn().mockReturnThis(),
    mount: jest.fn(),
    getConfig: jest.fn().mockReturnValue({ x: 0, y: 0, width: 500, height: 180 }),
    destroy: jest.fn(),
  })),
}));

import { RTSUIFactory } from '@/stratix-rts/ui/v2/RTSUIFactory';
import { TopBarV2 } from '@/stratix-rts/ui/v2/TopBarV2';
import { MinimapV2 } from '@/stratix-rts/ui/v2/MinimapV2';
import { CommandPanelV2 } from '@/stratix-rts/ui/v2/CommandPanelV2';

describe('RTSUIFactory', () => {
  let factory: RTSUIFactory;
  let mockScene: any;
  let mockConfig: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockScene = {};

    mockConfig = {
      screenWidth: 1920,
      screenHeight: 1080,
      camera: {
        scrollX: 0,
        scrollY: 0,
        width: 1920,
        height: 1080,
        zoom: 1,
        centerOn: jest.fn(),
      },
      getStats: jest.fn().mockReturnValue({
        totalAgents: 10,
        onlineAgents: 5,
        busyAgents: 3,
        totalZones: 2,
        overallProgress: 75,
      }),
      getAgentSprites: jest.fn().mockReturnValue(new Map()),
      getTaskZones: jest.fn().mockReturnValue(new Map()),
      getSelectedZoneIds: jest.fn().mockReturnValue(new Set()),
      getSelectedAgent: jest.fn().mockReturnValue(null),
      getSelectedZone: jest.fn().mockReturnValue(null),
      onSkillSelect: jest.fn(),
      onCommandExecute: jest.fn(),
      onChatClick: jest.fn(),
      onConfigClick: jest.fn(),
      onTaskClick: jest.fn(),
      onStopClick: jest.fn(),
    };

    factory = new RTSUIFactory(mockScene as any, mockConfig);
  });

  describe('constructor', () => {
    it('should store scene and config', () => {
      expect((factory as any).scene).toBe(mockScene);
      expect((factory as any).config).toBe(mockConfig);
    });

    it('should initialize with null components', () => {
      expect((factory as any).components).toBeNull();
    });
  });

  describe('createAll', () => {
    it('should create all three UI components', () => {
      const components = factory.createAll();

      expect(TopBarV2).toHaveBeenCalled();
      expect(MinimapV2).toHaveBeenCalled();
      expect(CommandPanelV2).toHaveBeenCalled();
    });

    it('should return RTSUIComponents object', () => {
      const components = factory.createAll();

      expect(components).toHaveProperty('topBar');
      expect(components).toHaveProperty('minimap');
      expect(components).toHaveProperty('commandPanel');
    });

    it('should mount all components', () => {
      factory.createAll();

      // Verify mount was called on each component via the factory
      expect((factory as any).components).not.toBeNull();
    });

    it('should call create on each component', () => {
      const components = factory.createAll();

      expect(components.topBar.create).toHaveBeenCalled();
      expect(components.minimap.create).toHaveBeenCalled();
      expect(components.commandPanel.create).toHaveBeenCalled();
    });

    it('should call mount on each component', () => {
      const components = factory.createAll();

      expect(components.topBar.mount).toHaveBeenCalled();
      expect(components.minimap.mount).toHaveBeenCalled();
      expect(components.commandPanel.mount).toHaveBeenCalled();
    });
  });

  describe('getComponents', () => {
    it('should return null before createAll', () => {
      expect(factory.getComponents()).toBeNull();
    });

    it('should return components after createAll', () => {
      factory.createAll();
      expect(factory.getComponents()).not.toBeNull();
    });
  });

  describe('resize', () => {
    it('should call resize on all components', () => {
      factory.createAll();

      factory.resize(1280, 720);

      const components = factory.getComponents();
      expect(components!.topBar.resize).toHaveBeenCalledWith(1280);
      expect(components!.minimap.resize).toHaveBeenCalledWith(200, 120);
    });

    it('should not throw if components not created', () => {
      expect(() => factory.resize(1280, 720)).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('should destroy all components', () => {
      factory.createAll();

      // Get references before destroy since they become null after
      const componentsBeforeDestroy = factory.getComponents();
      const topBarDestroy = jest.spyOn(componentsBeforeDestroy!.topBar, 'destroy');
      const minimapDestroy = jest.spyOn(componentsBeforeDestroy!.minimap, 'destroy');
      const commandPanelDestroy = jest.spyOn(componentsBeforeDestroy!.commandPanel, 'destroy');

      factory.destroy();

      expect(topBarDestroy).toHaveBeenCalled();
      expect(minimapDestroy).toHaveBeenCalled();
      expect(commandPanelDestroy).toHaveBeenCalled();
    });

    it('should set components to null', () => {
      factory.createAll();
      factory.destroy();

      expect(factory.getComponents()).toBeNull();
    });

    it('should not throw if components not created', () => {
      expect(() => factory.destroy()).not.toThrow();
    });
  });

  describe('component creation parameters', () => {
    it('should pass correct parameters to TopBarV2', () => {
      factory.createAll();

      const topBarCall = (TopBarV2 as jest.Mock).mock.calls[0];
      expect(topBarCall[1]).toBe(0); // x
      expect(topBarCall[2]).toBe(0); // y
      expect(topBarCall[3]).toBe(mockConfig.screenWidth); // width
      expect(topBarCall[4]).toBe(mockConfig.getStats); // getStats callback
    });

    it('should pass correct parameters to MinimapV2', () => {
      factory.createAll();

      const minimapCall = (MinimapV2 as jest.Mock).mock.calls[0];
      expect(minimapCall[1]).toBe(mockConfig.screenWidth - 220); // x
      expect(minimapCall[2]).toBe(mockConfig.screenHeight - 140); // y
      expect(minimapCall[3]).toBe(mockConfig.camera); // camera
      expect(minimapCall[4]).toBe(mockConfig.getAgentSprites); // getAgentSprites
      expect(minimapCall[5]).toBe(mockConfig.getTaskZones); // getTaskZones
      expect(minimapCall[6]).toBe(mockConfig.getSelectedZoneIds); // getSelectedZoneIds
    });

    it('should pass correct parameters to CommandPanelV2', () => {
      factory.createAll();

      const commandPanelCall = (CommandPanelV2 as jest.Mock).mock.calls[0];
      expect(commandPanelCall[1]).toBe(0); // x
      expect(commandPanelCall[2]).toBe(mockConfig.screenHeight - 200); // y
      expect(commandPanelCall[3]).toBe(mockConfig.screenWidth - 220); // width
      expect(commandPanelCall[4]).toBe(180); // height
      expect(commandPanelCall[5]).toBe(mockConfig.onSkillSelect); // onSkillSelect
      expect(commandPanelCall[6]).toBe(mockConfig.onCommandExecute); // onCommandExecute
    });
  });

  describe('callbacks configuration', () => {
    it('should create default callbacks if not provided', () => {
      const configWithoutCallbacks = { ...mockConfig };
      delete configWithoutCallbacks.onChatClick;
      delete configWithoutCallbacks.onConfigClick;
      delete configWithoutCallbacks.onTaskClick;
      delete configWithoutCallbacks.onStopClick;

      const factory2 = new RTSUIFactory(mockScene as any, configWithoutCallbacks);
      factory2.createAll();

      // Should not throw when callbacks are undefined
      expect(factory2.getComponents()).not.toBeNull();
    });
  });
});
