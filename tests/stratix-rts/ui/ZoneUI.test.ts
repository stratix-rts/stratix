import { ZoneDrawingUI } from '@/stratix-rts/ui/ZoneDrawingUI';
import { ZoneBatchOperations } from '@/stratix-rts/ui/ZoneBatchOperations';
import { ZoneHistory, ZoneMoveAction } from '@/stratix-rts/history/ZoneHistory';

describe('ZoneDrawingUI', () => {
  let mockScene: any;
  let drawingUI: ZoneDrawingUI;

  beforeEach(() => {
    mockScene = {
      add: {
        graphics: jest.fn().mockReturnValue({
          setDepth: jest.fn(),
          setVisible: jest.fn(),
          clear: jest.fn(),
          lineStyle: jest.fn(),
          lineBetween: jest.fn(),
          strokeCircle: jest.fn(),
          fillCircle: jest.fn(),
          fillStyle: jest.fn(),
          destroy: jest.fn(),
        }),
        text: jest.fn().mockReturnValue({
          setDepth: jest.fn(),
          setOrigin: jest.fn(),
          destroy: jest.fn(),
        }),
      },
      input: {
        on: jest.fn(),
        off: jest.fn(),
      },
    };

    drawingUI = new ZoneDrawingUI(mockScene);
  });

  afterEach(() => {
    drawingUI.destroy();
  });

  it('should create drawing UI', () => {
    expect(drawingUI).toBeDefined();
  });

  it('should enable drawing mode', () => {
    drawingUI.enable();
  });

  it('should disable drawing mode', () => {
    drawingUI.disable();
  });

  it('should show tooltip', () => {
    drawingUI.showTooltip(100, 100, 'Test message');
  });

  it('should hide tooltip', () => {
    drawingUI.showTooltip(100, 100, 'Test message');
    drawingUI.hideTooltip();
  });
});

describe('ZoneBatchOperations', () => {
  let mockZones: any[];
  let mockHistory: ZoneHistory;

  beforeEach(() => {
    mockZones = [
      {
        getZoneId: () => 'zone-1',
        x: 100,
        y: 100,
        getBounds: () => ({ x: 50, y: 50, width: 100, height: 100 }),
        destroy: jest.fn(),
      },
      {
        getZoneId: () => 'zone-2',
        x: 200,
        y: 200,
        getBounds: () => ({ x: 150, y: 150, width: 100, height: 100 }),
        destroy: jest.fn(),
      },
    ];

    mockHistory = new ZoneHistory();
  });

  afterEach(() => {
    mockHistory.destroy();
  });

  it('should move zones', () => {
    ZoneBatchOperations.moveZones(mockZones, 50, 50, mockHistory);
  });

  it('should delete zones', () => {
    ZoneBatchOperations.deleteZones(mockZones, {}, false);
    
    expect(mockZones[0].destroy).toHaveBeenCalled();
    expect(mockZones[1].destroy).toHaveBeenCalled();
  });

  it('should not delete empty zones array', () => {
    ZoneBatchOperations.deleteZones([], {}, false);
  });

  it('should select zones in rect', () => {
    const rect = { x: 0, y: 0, width: 300, height: 300 };
    const selected = ZoneBatchOperations.selectZonesInRect(mockZones, rect as any);
    
    expect(selected.length).toBe(2);
  });

  it('should align zones', () => {
    ZoneBatchOperations.alignZones(mockZones, 'left', mockHistory);
  });
});