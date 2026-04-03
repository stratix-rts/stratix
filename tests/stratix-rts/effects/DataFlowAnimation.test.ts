import { DataFlowAnimation, DataFlowStatus } from '@/stratix-rts/effects/DataFlowAnimation';

const mockScene = {
  add: {
    graphics: jest.fn().mockReturnValue({
      setDepth: jest.fn(),
      clear: jest.fn(),
      fillStyle: jest.fn(),
      fillCircle: jest.fn(),
      fillRect: jest.fn(),
      lineStyle: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      strokePath: jest.fn(),
      strokeCircle: jest.fn(),
      destroy: jest.fn(),
    }),
  },
} as any;

describe('DataFlowAnimation', () => {
  let animation: DataFlowAnimation;

  beforeEach(() => {
    animation = new DataFlowAnimation(mockScene);
  });

  afterEach(() => {
    animation.destroy();
  });

  describe('startFlow', () => {
    it('should create a flow between two zones', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);

      animation.startFlow('zone-1', 'zone-2');

      expect(animation.hasFlow('zone-1', 'zone-2')).toBe(true);
    });

    it('should not create flow if source zone position is missing', () => {
      animation.setZonePosition('zone-2', 200, 200);

      animation.startFlow('zone-1', 'zone-2');

      expect(animation.hasFlow('zone-1', 'zone-2')).toBe(false);
    });

    it('should not create flow if target zone position is missing', () => {
      animation.setZonePosition('zone-1', 100, 100);

      animation.startFlow('zone-1', 'zone-2');

      expect(animation.hasFlow('zone-1', 'zone-2')).toBe(false);
    });

    it('should replace existing flow when starting new flow', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);

      animation.startFlow('zone-1', 'zone-2', { speed: 0.001 });
      animation.startFlow('zone-1', 'zone-2', { speed: 0.005 });

      expect(animation.hasFlow('zone-1', 'zone-2')).toBe(true);
      expect(animation.getActiveFlows()).toHaveLength(1);
    });
  });

  describe('stopFlow', () => {
    it('should stop an active flow', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);

      animation.startFlow('zone-1', 'zone-2');
      animation.stopFlow('zone-1', 'zone-2');

      expect(animation.hasFlow('zone-1', 'zone-2')).toBe(false);
    });

    it('should handle stopping non-existent flow gracefully', () => {
      expect(() => animation.stopFlow('zone-1', 'zone-2')).not.toThrow();
    });
  });

  describe('update', () => {
    it('should update particle positions', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);

      animation.startFlow('zone-1', 'zone-2', { particleCount: 3 });

      expect(() => animation.update(16)).not.toThrow();
    });

    it('should handle multiple flows updating', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);
      animation.setZonePosition('zone-3', 300, 300);

      animation.startFlow('zone-1', 'zone-2');
      animation.startFlow('zone-2', 'zone-3');

      expect(() => animation.update(16)).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('should cleanup all flows', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);
      animation.setZonePosition('zone-3', 300, 300);

      animation.startFlow('zone-1', 'zone-2');
      animation.startFlow('zone-2', 'zone-3');

      animation.destroy();

      expect(animation.getActiveFlows()).toHaveLength(0);
    });

    it('should be idempotent', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);

      animation.startFlow('zone-1', 'zone-2');
      animation.destroy();
      expect(() => animation.destroy()).not.toThrow();
    });
  });

  describe('hasFlow', () => {
    it('should return true for active flow', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);

      animation.startFlow('zone-1', 'zone-2');

      expect(animation.hasFlow('zone-1', 'zone-2')).toBe(true);
    });

    it('should return false for inactive flow', () => {
      expect(animation.hasFlow('zone-1', 'zone-2')).toBe(false);
    });
  });

  describe('getActiveFlows', () => {
    it('should return empty array when no flows active', () => {
      expect(animation.getActiveFlows()).toEqual([]);
    });

    it('should return all active flows', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);
      animation.setZonePosition('zone-3', 300, 300);

      animation.startFlow('zone-1', 'zone-2');
      animation.startFlow('zone-2', 'zone-3');

      const flows = animation.getActiveFlows();
      expect(flows).toHaveLength(2);
      expect(flows).toContainEqual({ from: 'zone-1', to: 'zone-2' });
      expect(flows).toContainEqual({ from: 'zone-2', to: 'zone-3' });
    });
  });

  describe('status color coding', () => {
    it('should use green for normal volume', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);

      animation.startFlow('zone-1', 'zone-2', { volume: 0.8 });

      expect(animation.hasFlow('zone-1', 'zone-2')).toBe(true);
    });

    it('should use yellow for warning volume', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);

      animation.startFlow('zone-1', 'zone-2', { volume: 0.5 });

      expect(animation.hasFlow('zone-1', 'zone-2')).toBe(true);
    });

    it('should use red for error volume', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);

      animation.startFlow('zone-1', 'zone-2', { volume: 0.1 });

      expect(animation.hasFlow('zone-1', 'zone-2')).toBe(true);
    });
  });

  describe('custom options', () => {
    it('should apply custom color', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);

      animation.startFlow('zone-1', 'zone-2', { color: 0xff0000 });

      expect(animation.hasFlow('zone-1', 'zone-2')).toBe(true);
    });

    it('should apply custom speed', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);

      animation.startFlow('zone-1', 'zone-2', { speed: 0.01 });

      expect(animation.hasFlow('zone-1', 'zone-2')).toBe(true);
    });

    it('should apply custom particle count', () => {
      animation.setZonePosition('zone-1', 100, 100);
      animation.setZonePosition('zone-2', 200, 200);

      animation.startFlow('zone-1', 'zone-2', { particleCount: 10 });

      expect(animation.hasFlow('zone-1', 'zone-2')).toBe(true);
    });
  });
});
