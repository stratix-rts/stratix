import { SoundEffects } from '@/stratix-rts/audio/SoundEffects';

describe('SoundEffects', () => {
  let mockAudioContext: jest.Mocked<AudioContext>;
  let mockOscillator: jest.Mocked<OscillatorNode>;
  let mockGainNode: jest.Mocked<GainNode>;

  beforeEach(() => {
    // Create mock oscillator
    mockOscillator = {
      type: 'sine',
      frequency: {
        setValueAtTime: jest.fn(),
        exponentialRampToValueAtTime: jest.fn(),
      } as unknown as jest.Mocked<AudioParam>,
      connect: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    } as unknown as jest.Mocked<OscillatorNode>;

    // Create mock gain node
    mockGainNode = {
      gain: {
        setValueAtTime: jest.fn(),
        exponentialRampToValueAtTime: jest.fn(),
        value: 1,
      } as unknown as jest.Mocked<AudioParam>,
      connect: jest.fn(),
    } as unknown as jest.Mocked<GainNode>;

    // Create mock AudioContext
    mockAudioContext = {
      currentTime: 0,
      state: 'running',
      createOscillator: jest.fn().mockReturnValue(mockOscillator),
      createGain: jest.fn().mockReturnValue(mockGainNode),
      destination: {} as AudioDestinationNode,
      close: jest.fn().mockResolvedValue(undefined),
      resume: jest.fn().mockResolvedValue(undefined),
      suspend: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AudioContext>;

    // Mock global AudioContext constructor
    const OriginalAudioContext = global.AudioContext;
    global.AudioContext = jest.fn(() => mockAudioContext) as unknown as typeof AudioContext;

    // Store original and reset singleton state by accessing prototype
    const instance = SoundEffects.getInstance();
    // Reset internal state by calling destroy
    if ((instance as any).audioContext) {
      (instance as any).audioContext = null;
      (instance as any).masterGain = null;
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    const instance = SoundEffects.getInstance();
    instance.destroy();
  });

  describe('Singleton', () => {
    it('should return the same instance', () => {
      const instance1 = SoundEffects.getInstance();
      const instance2 = SoundEffects.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('playSelect', () => {
    it('should play select sound without error', () => {
      const instance = SoundEffects.getInstance();
      expect(() => instance.playSelect()).not.toThrow();
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
      expect(mockOscillator.start).toHaveBeenCalled();
      expect(mockOscillator.stop).toHaveBeenCalled();
    });

    it('should use square wave for select sound', () => {
      const instance = SoundEffects.getInstance();
      instance.playSelect();
      expect(mockOscillator.type).toBe('square');
    });
  });

  describe('playCommand', () => {
    it('should play command sound without error', () => {
      const instance = SoundEffects.getInstance();
      expect(() => instance.playCommand()).not.toThrow();
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should have ascending frequency', () => {
      const instance = SoundEffects.getInstance();
      instance.playCommand();
      expect(mockOscillator.frequency.setValueAtTime).toHaveBeenCalledWith(300, 0);
      expect(mockOscillator.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(600, expect.any(Number));
    });
  });

  describe('playSuccess', () => {
    it('should play success sound without error', () => {
      const instance = SoundEffects.getInstance();
      expect(() => instance.playSuccess()).not.toThrow();
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should use sine wave for success sound', () => {
      const instance = SoundEffects.getInstance();
      instance.playSuccess();
      expect(mockOscillator.type).toBe('sine');
    });
  });

  describe('playError', () => {
    it('should play error sound without error', () => {
      const instance = SoundEffects.getInstance();
      expect(() => instance.playError()).not.toThrow();
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should use sawtooth wave for error sound', () => {
      const instance = SoundEffects.getInstance();
      instance.playError();
      expect(mockOscillator.type).toBe('sawtooth');
    });
  });

  describe('playAlert', () => {
    it('should play alert sound without error', () => {
      const instance = SoundEffects.getInstance();
      expect(() => instance.playAlert()).not.toThrow();
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should have descending frequency for alert', () => {
      const instance = SoundEffects.getInstance();
      instance.playAlert();
      expect(mockOscillator.frequency.setValueAtTime).toHaveBeenCalledWith(500, 0);
      expect(mockOscillator.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(400, expect.any(Number));
    });
  });

  describe('Volume Control', () => {
    it('should set volume correctly', () => {
      const instance = SoundEffects.getInstance();
      instance.setVolume(0.5);
      expect(instance.getVolume()).toBe(0.5);
    });

    it('should clamp volume to valid range', () => {
      const instance = SoundEffects.getInstance();
      instance.setVolume(1.5);
      expect(instance.getVolume()).toBe(1);

      instance.setVolume(-0.5);
      expect(instance.getVolume()).toBe(0);
    });

    it('should update master gain when volume changes', () => {
      const instance = SoundEffects.getInstance();
      // Trigger context creation first
      instance.playSelect();
      instance.setVolume(0.7);
      expect(mockGainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.7, expect.any(Number));
    });
  });

  describe('Mute Control', () => {
    it('should mute audio', () => {
      const instance = SoundEffects.getInstance();
      // Trigger context creation first
      instance.playSelect();
      instance.setVolume(0.5);
      instance.setMuted(true);
      expect(instance.isMuted()).toBe(true);
      expect(mockGainNode.gain.setValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    });

    it('should unmute audio', () => {
      const instance = SoundEffects.getInstance();
      // Trigger context creation first
      instance.playSelect();
      instance.setVolume(0.5);
      instance.setMuted(true);
      instance.setMuted(false);
      expect(instance.isMuted()).toBe(false);
      expect(mockGainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.5, expect.any(Number));
    });

    it('should return correct mute state', () => {
      const instance = SoundEffects.getInstance();
      expect(instance.isMuted()).toBe(false);
      instance.setMuted(true);
      expect(instance.isMuted()).toBe(true);
    });
  });

  describe('Destroy', () => {
    it('should close audio context on destroy', () => {
      const instance = SoundEffects.getInstance();
      // Trigger context creation first
      instance.playSelect();
      instance.destroy();
      expect(mockAudioContext.close).toHaveBeenCalled();
    });
  });
});
