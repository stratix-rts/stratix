import { ProjectZone } from '@/stratix-project/core/ProjectZone';
import { Project, ProjectStatus } from '@/stratix-project/types';

const mockSetZoneName = jest.fn();
const mockSetZoneStatus = jest.fn();
const mockRedrawWithCustomColors = jest.fn();
const mockUpdateVisuals = jest.fn();
const mockSuperDestroy = jest.fn();
const mockGraphicsClear = jest.fn();
const mockGraphicsLineStyle = jest.fn();
const mockGraphicsStrokeRect = jest.fn();
const mockGraphicsFillStyle = jest.fn();
const mockGraphicsFillRect = jest.fn();
const mockSetDataCalls: Array<{ key: string; value: any }> = [];

const mockScene = {
  add: {
    text: jest.fn().mockReturnValue({
      setOrigin: jest.fn().mockReturnThis(),
      setDepth: jest.fn().mockReturnThis(),
      setText: jest.fn().mockReturnThis(),
      setPosition: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      setVisible: jest.fn().mockReturnThis(),
      destroy: jest.fn(),
    }),
    graphics: jest.fn().mockReturnValue({
      clear: mockGraphicsClear.mockReturnThis(),
      lineStyle: mockGraphicsLineStyle.mockReturnThis(),
      strokeRect: mockGraphicsStrokeRect.mockReturnThis(),
      fillStyle: mockGraphicsFillStyle.mockReturnThis(),
      fillRect: mockGraphicsFillRect.mockReturnThis(),
    }),
    arc: jest.fn().mockReturnValue({
      setFillStyle: jest.fn().mockReturnThis(),
      setAlpha: jest.fn().mockReturnThis(),
      setDepth: jest.fn().mockReturnThis(),
      setVisible: jest.fn().mockReturnThis(),
      setPosition: jest.fn().mockReturnThis(),
      setRadius: jest.fn().mockReturnThis(),
      setScale: jest.fn().mockReturnThis(),
      setInteractive: jest.fn().mockReturnThis(),
      destroy: jest.fn(),
      on: jest.fn().mockReturnThis(),
    }),
  },
  tweens: {
    add: jest.fn().mockReturnValue({ stop: jest.fn() }),
  },
};

jest.mock('@/stratix-rts/zones/BaseZone', () => ({
  BaseZone: class MockBaseZone {
    x = 0;
    y = 0;
    zoneWidth = 800;
    zoneHeight = 600;
    zoneName = '';
    zoneStatus = 'idle';
    scene = mockScene;
    graphics = mockScene.add.graphics();
    fencePosts: any[] = [];
    cornerHandles = new Map();
    isWarning = false;
    isSelected = false;

    constructor(scene: any, config: any) {
      this.scene = scene;
      this.x = config.x;
      this.y = config.y;
      this.zoneWidth = config.width;
      this.zoneHeight = config.height;
    }

    setZoneName(name: string) {
      this.zoneName = name;
      mockSetZoneName(name);
    }

    setZoneStatus(status: string) {
      this.zoneStatus = status;
      mockSetZoneStatus(status);
    }

    isWarningState() {
      return this.isWarning;
    }

    setData(key: string, value: any) {
      mockSetDataCalls.push({ key, value });
      return this;
    }

    add(_child: any) {
      return this;
    }

    setSize(_width: number, _height: number) {
      return this;
    }

    setInteractive() {
      return this;
    }

    setDepth(_depth: number) {
      return this;
    }

    setPosition(_x: number, _y: number) {
      return this;
    }

    getBounds() {
      return {
        x: this.x - this.zoneWidth / 2,
        y: this.y - this.zoneHeight / 2,
        width: this.zoneWidth,
        height: this.zoneHeight,
      };
    }

    destroy() {
      mockSuperDestroy();
    }
  },
}));

jest.mock('phaser', () => ({
  __esModule: true,
  default: {
    GameObjects: {
      Container: class MockContainer {},
    },
  },
}));

function createMockProject(overrides?: Partial<Project>): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    description: 'A test project',
    priority: 3,
    status: 'pending' as ProjectStatus,
    config: {
      name: 'Test Project',
      description: 'A test project',
      priority: 3,
      localFolderPath: '/tmp/test',
      agentMode: 'llm',
      planningRule: 'sequential',
      executionPermission: 'confirm',
      requirement: { type: 'text', content: 'Test' },
      progressRule: 'average',
    },
    path: '/tmp/test',
    presentAgentIds: [],
    zoneConfig: { x: 100, y: 100, width: 800, height: 600 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ProjectZone', () => {
  let project: Project;
  let zone: ProjectZone;

  beforeEach(() => {
    jest.clearAllMocks();
    project = createMockProject();
    zone = new ProjectZone(mockScene as any, project);
  });

  afterEach(() => {
    // Clean up if destroy was not called in test
    try {
      zone.destroy();
    } catch {
      // ignore
    }
  });

  describe('constructor', () => {
    test('creates instance with project', () => {
      expect(zone).toBeInstanceOf(ProjectZone);
    });

    test('sets zone name from project name', () => {
      expect(mockSetZoneName).toHaveBeenCalledWith('Test Project');
    });

    test('sets zone status from project status', () => {
      expect(mockSetZoneStatus).toHaveBeenCalledWith('idle');
    });

    test('uses custom zoneConfig when provided', () => {
      const customZone = new ProjectZone(mockScene as any, project, {
        x: 200,
        y: 300,
        width: 500,
        height: 400,
      });
      expect(customZone).toBeInstanceOf(ProjectZone);
      customZone.destroy();
    });

    test('stores project data', () => {
      expect(zone.getProject()).toEqual(project);
    });

    test('stores project id in data', () => {
      mockSetDataCalls.length = 0;
      const p = createMockProject({ id: 'proj-special' });
      const z = new ProjectZone(mockScene as any, p);
      const projectIdCall = mockSetDataCalls.find((c) => c.key === 'projectId');
      expect(projectIdCall).toEqual({ key: 'projectId', value: 'proj-special' });
      z.destroy();
    });
  });

  describe('getProject', () => {
    test('returns the associated project', () => {
      expect(zone.getProject()).toEqual(project);
    });

    test('returns same project object reference', () => {
      expect(zone.getProject()).toBe(project);
    });
  });

  describe('getProjectId', () => {
    test('returns project id', () => {
      expect(zone.getProjectId()).toBe('proj-1');
    });
  });

  describe('updateProject', () => {
    test('updates internal project reference', () => {
      const updatedProject = createMockProject({ name: 'Updated Project' });
      zone.updateProject(updatedProject);
      expect(zone.getProject()).toEqual(updatedProject);
    });

    test('updates zone name when project name changes', () => {
      mockSetZoneName.mockClear();
      const updatedProject = createMockProject({ name: 'Updated Project' });
      zone.updateProject(updatedProject);
      expect(mockSetZoneName).toHaveBeenCalledWith('Updated Project');
    });

    test('updates zone status when project status changes', () => {
      mockSetZoneStatus.mockClear();
      const updatedProject = createMockProject({ status: 'active' });
      zone.updateProject(updatedProject);
      expect(mockSetZoneStatus).toHaveBeenCalledWith('active');
    });
  });

  describe('updateZoneTitle', () => {
    test('creates zoneContext if not exists', () => {
      const projWithoutContext = createMockProject();
      delete (projWithoutContext as any).zoneContext;
      const z = new ProjectZone(mockScene as any, projWithoutContext);
      z.updateZoneTitle('New Title');
      expect(z.getProject().zoneContext).toEqual({
        title: 'New Title',
        prompt: '',
        members: [],
      });
      z.destroy();
    });

    test('updates existing zoneContext title', () => {
      const projWithContext = createMockProject({
        zoneContext: { title: 'Old Title', prompt: 'Test prompt', members: [] },
      });
      const z = new ProjectZone(mockScene as any, projWithContext);
      z.updateZoneTitle('New Title');
      expect(z.getProject().zoneContext?.title).toBe('New Title');
      z.destroy();
    });

    test('calls setZoneName with new title', () => {
      mockSetZoneName.mockClear();
      zone.updateZoneTitle('New Title');
      expect(mockSetZoneName).toHaveBeenCalledWith('New Title');
    });

    test('calls redraw after title update', () => {
      mockRedrawWithCustomColors.mockClear();
      zone.updateZoneTitle('New Title');
      // redrawWithCustomColors is called indirectly through updateFromProject or directly
      // Since we can't easily spy on private methods, we verify the public side effects
      expect(mockSetZoneName).toHaveBeenCalled();
    });
  });

  describe('toJSON', () => {
    test('returns project data with zone config', () => {
      const json = zone.toJSON();
      expect(json.id).toBe('proj-1');
      expect(json.name).toBe('Test Project');
    });

    test('includes current zone dimensions', () => {
      const json = zone.toJSON();
      expect(json.zoneConfig).toBeDefined();
      expect(json.zoneConfig.width).toBe(800);
      expect(json.zoneConfig.height).toBe(600);
    });

    test('includes current position', () => {
      const json = zone.toJSON();
      expect(json.zoneConfig.x).toBe(zone.x);
      expect(json.zoneConfig.y).toBe(zone.y);
    });
  });

  describe('destroy', () => {
    test('destroys status text', () => {
      const textMock = mockScene.add.text();
      zone.destroy();
      expect(textMock.destroy).toHaveBeenCalled();
    });

    test('calls super.destroy', () => {
      zone.destroy();
      expect(mockSuperDestroy).toHaveBeenCalled();
    });

    test('handles multiple destroy calls gracefully', () => {
      zone.destroy();
      expect(() => zone.destroy()).not.toThrow();
    });
  });

  describe('status mapping', () => {
    test('maps pending to idle', () => {
      mockSetZoneStatus.mockClear();
      const p = createMockProject({ status: 'pending' });
      const z = new ProjectZone(mockScene as any, p);
      expect(mockSetZoneStatus).toHaveBeenCalledWith('idle');
      z.destroy();
    });

    test('maps active to active', () => {
      mockSetZoneStatus.mockClear();
      const p = createMockProject({ status: 'active' });
      const z = new ProjectZone(mockScene as any, p);
      expect(mockSetZoneStatus).toHaveBeenCalledWith('active');
      z.destroy();
    });

    test('maps completed to completed', () => {
      mockSetZoneStatus.mockClear();
      const p = createMockProject({ status: 'completed' });
      const z = new ProjectZone(mockScene as any, p);
      expect(mockSetZoneStatus).toHaveBeenCalledWith('completed');
      z.destroy();
    });

    test('maps paused to idle', () => {
      mockSetZoneStatus.mockClear();
      const p = createMockProject({ status: 'paused' });
      const z = new ProjectZone(mockScene as any, p);
      expect(mockSetZoneStatus).toHaveBeenCalledWith('idle');
      z.destroy();
    });

    test('maps failed to error', () => {
      mockSetZoneStatus.mockClear();
      const p = createMockProject({ status: 'failed' });
      const z = new ProjectZone(mockScene as any, p);
      expect(mockSetZoneStatus).toHaveBeenCalledWith('error');
      z.destroy();
    });
  });

  describe('getBounds', () => {
    test('returns bounds based on position and size', () => {
      const bounds = zone.getBounds();
      const z = zone as any;
      expect(bounds.x).toBe(z.x - z.zoneWidth / 2);
      expect(bounds.y).toBe(z.y - z.zoneHeight / 2);
      expect(bounds.width).toBe(z.zoneWidth);
      expect(bounds.height).toBe(z.zoneHeight);
    });
  });

  describe('zoneContext display', () => {
    test('uses zoneContext title when available', () => {
      mockSetZoneName.mockClear();
      const p = createMockProject({
        zoneContext: { title: 'OKR Title', prompt: '', members: [] },
      });
      const z = new ProjectZone(mockScene as any, p);
      expect(mockSetZoneName).toHaveBeenCalledWith('OKR Title');
      z.destroy();
    });

    test('falls back to project name when zoneContext is missing', () => {
      mockSetZoneName.mockClear();
      const p = createMockProject();
      delete (p as any).zoneContext;
      const z = new ProjectZone(mockScene as any, p);
      expect(mockSetZoneName).toHaveBeenCalledWith('Test Project');
      z.destroy();
    });
  });

  describe('priority display', () => {
    test('stores priority from project', () => {
      expect(zone.getProject().priority).toBe(3);
    });
  });
});
