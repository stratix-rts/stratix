import { ParticleEffects } from '@/stratix-rts/effects/ParticleEffects';

const createMockGraphics = () => ({
  setDepth: jest.fn(),
  setPosition: jest.fn(),
  setAlpha: jest.fn(),
  clear: jest.fn(),
  fillStyle: jest.fn(),
  fillCircle: jest.fn(),
  destroy: jest.fn(),
});

const mockScene = {
  add: {
    graphics: jest.fn().mockReturnValue(createMockGraphics()),
  },
  make: {
    graphics: jest.fn().mockReturnValue({
      fillStyle: jest.fn(),
      fillCircle: jest.fn(),
      generateTexture: jest.fn(),
      destroy: jest.fn(),
    }),
  },
  tweens: {
    add: jest.fn().mockReturnValue({
      stop: jest.fn(),
    }),
  },
  time: {
    delayedCall: jest.fn().mockImplementation((_delay: number, callback: () => void) => {
      callback();
    }),
  },
} as any;

describe('ParticleEffects', () => {
  let effects: ParticleEffects;

  beforeEach(() => {
    effects = ParticleEffects.getInstance();
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Reset singleton state
    (effects as any).scene = null;
    (effects as any).particleGraphics = null;
    (effects as any).particleTextureGenerated = false;
  });

  describe('getInstance', () => {
    it('should return the same instance', () => {
      const instance1 = ParticleEffects.getInstance();
      const instance2 = ParticleEffects.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('spawnBurst', () => {
    it('should create particle tweens', () => {
      const tweens = effects.spawnBurst(mockScene, 100, 100);
      expect(mockScene.tweens.add).toHaveBeenCalled();
      expect(tweens.length).toBeGreaterThan(0);
    });

    it('should use custom color when provided', () => {
      effects.spawnBurst(mockScene, 100, 100, '#ff0000');
      expect(mockScene.add.graphics).toHaveBeenCalled();
    });
  });

  describe('levelUp', () => {
    it('should create golden sparkle tweens', () => {
      const tweens = effects.levelUp(mockScene, 100, 100);
      expect(mockScene.tweens.add).toHaveBeenCalled();
      expect(tweens.length).toBe(16);
    });
  });

  describe('errorFlash', () => {
    it('should create red particle tweens', () => {
      const tweens = effects.errorFlash(mockScene, 100, 100);
      expect(mockScene.tweens.add).toHaveBeenCalled();
      expect(tweens.length).toBe(8);
    });
  });

  describe('idlePulse', () => {
    it('should create floating particle tweens', () => {
      const tweens = effects.idlePulse(mockScene, 100, 100);
      expect(mockScene.tweens.add).toHaveBeenCalled();
      expect(tweens.length).toBe(5);
    });

    it('should use custom color when provided', () => {
      effects.idlePulse(mockScene, 100, 100, '#00ff00');
      expect(mockScene.add.graphics).toHaveBeenCalled();
    });
  });

  describe('taskExecution', () => {
    it('should create energy particle tweens', () => {
      const tweens = effects.taskExecution(mockScene, 100, 100);
      expect(mockScene.tweens.add).toHaveBeenCalled();
      expect(tweens.length).toBe(8);
    });

    it('should use custom color when provided', () => {
      effects.taskExecution(mockScene, 100, 100, '#ff00ff');
      expect(mockScene.add.graphics).toHaveBeenCalled();
    });

    it('should store circles for cleanup', () => {
      const tweens = effects.taskExecution(mockScene, 100, 100);
      expect((tweens as any).__circles).toBeDefined();
      expect((tweens as any).__circles.length).toBe(8);
    });
  });

  describe('statusChange', () => {
    it('should create status change tweens for online status', () => {
      const tweens = effects.statusChange(mockScene, 100, 100, 'online');
      expect(mockScene.tweens.add).toHaveBeenCalled();
      expect(tweens.length).toBe(12);
    });

    it('should create status change tweens for busy status', () => {
      const tweens = effects.statusChange(mockScene, 100, 100, 'busy');
      expect(mockScene.tweens.add).toHaveBeenCalled();
      expect(tweens.length).toBe(12);
    });

    it('should create status change tweens for offline status', () => {
      const tweens = effects.statusChange(mockScene, 100, 100, 'offline');
      expect(mockScene.tweens.add).toHaveBeenCalled();
      expect(tweens.length).toBe(12);
    });

    it('should create status change tweens for error status', () => {
      const tweens = effects.statusChange(mockScene, 100, 100, 'error');
      expect(mockScene.tweens.add).toHaveBeenCalled();
      expect(tweens.length).toBe(12);
    });

    it('should use default color for unknown status', () => {
      const tweens = effects.statusChange(mockScene, 100, 100, 'unknown' as any);
      expect(mockScene.tweens.add).toHaveBeenCalled();
    });
  });

  describe('stopEmitters', () => {
    it('should stop all tweens', () => {
      const mockTween = { stop: jest.fn() };
      const tweens = [mockTween] as any;
      effects.stopEmitters(tweens);
      expect(mockTween.stop).toHaveBeenCalled();
    });

    it('should destroy circles for idlePulse', () => {
      const mockCircle = { destroy: jest.fn() };
      const tweens = [{ stop: jest.fn() }] as any;
      (tweens as any).__circles = [mockCircle];
      effects.stopEmitters(tweens);
      expect(mockCircle.destroy).toHaveBeenCalled();
    });

    it('should destroy circles for taskExecution', () => {
      const mockCircle = { destroy: jest.fn() };
      const tweens = [{ stop: jest.fn() }] as any;
      (tweens as any).__circles = [mockCircle];
      effects.stopEmitters(tweens);
      expect(mockCircle.destroy).toHaveBeenCalled();
    });
  });
});