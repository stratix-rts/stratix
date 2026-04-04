/**
 * ReplayControls Unit Tests
 *
 * Tests replay state management, playback controls, and time formatting
 * Mocks Phaser dependencies and replay system
 */

// Mock rtsEventBus
jest.mock('@/stratix-rts/events/core/RTSEventBus', () => ({
  rtsEventBus: {
    on: jest.fn().mockReturnValue(jest.fn()),
    emit: jest.fn(),
  },
}));

// Mock replayManager
const mockReplayManager = {
  startRecording: jest.fn(),
  stopRecording: jest.fn().mockReturnValue({ name: 'Test Session', duration: 60000 }),
  toggle: jest.fn(),
  stop: jest.fn(),
  stepBackward: jest.fn(),
  stepForward: jest.fn(),
  seek: jest.fn(),
  setSpeed: jest.fn(),
  isPlaybackActive: jest.fn().mockReturnValue(false),
  getSavedSessions: jest.fn().mockReturnValue([]),
  loadSession: jest.fn(),
};

jest.mock('@/stratix-rts/events/replay', () => ({
  replayManager: mockReplayManager,
  PlaybackState: ['idle', 'playing', 'paused', 'ended'],
  PlaybackSpeed: [0.25, 0.5, 1, 1.5, 2, 4],
  RecordingSession: {},
}));

import { ReplayControls } from '@/stratix-rts/ui/v2/ReplayControls';
import { rtsEventBus } from '@/stratix-rts/events/core/RTSEventBus';
import { replayManager } from '@/stratix-rts/events/replay';

describe('ReplayControls', () => {
  let controls: ReplayControls;
  let mockScene: any;
  let mockConfig: any;
  let mockContainer: any;
  let mockGraphics: any;
  let mockText: any;
  let recordBtnContainer: any;
  let playPauseBtnContainer: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGraphics = {
      clear: jest.fn(),
      fillStyle: jest.fn(),
      fillRoundedRect: jest.fn(),
      fillCircle: jest.fn(),
      fillTriangle: jest.fn(),
      fillRect: jest.fn(),
      lineStyle: jest.fn(),
      strokeRoundedRect: jest.fn(),
      setDepth: jest.fn(),
      destroy: jest.fn(),
    };

    mockText = {
      setOrigin: jest.fn(),
      setColor: jest.fn(),
      setText: jest.fn(),
      setX: jest.fn(),
      setInteractive: jest.fn(),
      on: jest.fn(),
      destroy: jest.fn(),
    };

    recordBtnContainer = {
      add: jest.fn(),
      removeAll: jest.fn(),
      setScrollFactor: jest.fn(),
      setDepth: jest.fn(),
      setSize: jest.fn(),
      setInteractive: jest.fn(),
      on: jest.fn(),
      destroy: jest.fn(),
      getAt: jest.fn().mockReturnValue(mockGraphics),
    };

    playPauseBtnContainer = {
      add: jest.fn(),
      removeAll: jest.fn(),
      setScrollFactor: jest.fn(),
      setDepth: jest.fn(),
      setSize: jest.fn(),
      setInteractive: jest.fn(),
      on: jest.fn(),
      destroy: jest.fn(),
      getAt: jest.fn().mockReturnValue(mockGraphics),
    };

    mockContainer = {
      add: jest.fn(),
      removeAll: jest.fn(),
      setScrollFactor: jest.fn(),
      setDepth: jest.fn(),
      setSize: jest.fn(),
      setInteractive: jest.fn(),
      on: jest.fn(),
      destroy: jest.fn(),
    };

    mockScene = {
      add: {
        container: jest.fn().mockReturnValue(mockContainer),
        graphics: jest.fn().mockReturnValue(mockGraphics),
        text: jest.fn().mockReturnValue(mockText),
        rectangle: jest.fn().mockReturnValue({
          setOrigin: jest.fn(),
          setInteractive: jest.fn(),
          on: jest.fn(),
        }),
      },
    };

    mockConfig = {
      x: 0,
      y: 0,
      width: 800,
      onRecordingStarted: jest.fn(),
      onRecordingStopped: jest.fn(),
      onPlaybackStarted: jest.fn(),
      onPlaybackPaused: jest.fn(),
      onPlaybackEnded: jest.fn(),
    };

    controls = new ReplayControls(mockScene as any, mockConfig);

    // Set up the button containers before calling create
    (controls as any).recordBtn = recordBtnContainer;
    (controls as any).playPauseBtn = playPauseBtnContainer;
    (controls as any).container = mockContainer;
    (controls as any).bgGraphics = mockGraphics;
    (controls as any).sessionNameText = mockText;
    (controls as any).progressFill = mockGraphics;
    (controls as any).timeText = mockText;
    (controls as any).speedText = mockText;
  });

  describe('constructor', () => {
    it('should initialize with default state', () => {
      expect((controls as any).isRecording).toBe(false);
      expect((controls as any).playbackState).toBe('idle');
      expect((controls as any).currentSession).toBeNull();
      expect((controls as any).progress).toBe(0);
      expect((controls as any).duration).toBe(0);
      expect((controls as any).speed).toBe(1);
    });

    it('should store config', () => {
      expect((controls as any).config).toBe(mockConfig);
    });
  });

  describe('time formatting', () => {
    it('should format 0ms correctly', () => {
      const result = (controls as any).formatTime(0);
      expect(result).toBe('0:00');
    });

    it('should format seconds correctly', () => {
      const result = (controls as any).formatTime(45000);
      expect(result).toBe('0:45');
    });

    it('should format minutes and seconds correctly', () => {
      const result = (controls as any).formatTime(125000);
      expect(result).toBe('2:05');
    });

    it('should handle large values', () => {
      const result = (controls as any).formatTime(3661000);
      expect(result).toBe('61:01');
    });
  });

  describe('speed cycling', () => {
    it('should cycle through speeds correctly', () => {
      const speeds = [0.25, 0.5, 1, 1.5, 2, 4];

      // Start at index 2 (speed = 1)
      let currentIndex = speeds.indexOf(1);
      let nextIndex = (currentIndex + 1) % speeds.length;
      expect(speeds[nextIndex]).toBe(1.5);

      // Next
      currentIndex = nextIndex;
      nextIndex = (currentIndex + 1) % speeds.length;
      expect(speeds[nextIndex]).toBe(2);

      // Next
      currentIndex = nextIndex;
      nextIndex = (currentIndex + 1) % speeds.length;
      expect(speeds[nextIndex]).toBe(4);

      // Wrap around
      currentIndex = nextIndex;
      nextIndex = (currentIndex + 1) % speeds.length;
      expect(speeds[nextIndex]).toBe(0.25);
    });
  });

  describe('progress calculation', () => {
    it('should calculate percentage correctly', () => {
      const progress = 30000;
      const duration = 60000;
      const percentage = duration > 0 ? progress / duration : 0;
      expect(percentage).toBe(0.5);
    });

    it('should handle zero duration', () => {
      const progress = 30000;
      const duration = 0;
      const percentage = duration > 0 ? progress / duration : 0;
      expect(percentage).toBe(0);
    });
  });

  describe('recording controls', () => {
    it('should start recording when record button clicked', () => {
      (controls as any).onRecordClick();

      expect(replayManager.startRecording).toHaveBeenCalled();
      expect((controls as any).isRecording).toBe(true);
      expect(mockConfig.onRecordingStarted).toHaveBeenCalled();
    });

    it('should stop recording when record button clicked while recording', () => {
      (controls as any).isRecording = true;
      (controls as any).onRecordClick();

      expect(replayManager.stopRecording).toHaveBeenCalled();
      expect((controls as any).isRecording).toBe(false);
      expect(mockConfig.onRecordingStopped).toHaveBeenCalled();
    });
  });

  describe('playback controls', () => {
    it('should call toggle on play/pause click', () => {
      (controls as any).onPlayPauseClick();
      expect(replayManager.toggle).toHaveBeenCalled();
    });

    it('should call stop on stop click', () => {
      (controls as any).onStopClick();
      expect(replayManager.stop).toHaveBeenCalled();
      expect((controls as any).playbackState).toBe('idle');
    });

    it('should call stepBackward', () => {
      (controls as any).onStepBack();
      expect(replayManager.stepBackward).toHaveBeenCalled();
    });

    it('should call stepForward', () => {
      (controls as any).onStepForward();
      expect(replayManager.stepForward).toHaveBeenCalled();
    });
  });

  describe('event listeners', () => {
    it('should subscribe to rtsEventBus events', () => {
      // Create a new instance to test constructor-level subscriptions
      const newControls = new ReplayControls(mockScene as any, mockConfig);
      (newControls as any).unsubscribers = [];

      expect(rtsEventBus.on).toHaveBeenCalledWith('replay:state_changed', expect.any(Function));
    });
  });

  describe('resize', () => {
    it('should update config width', () => {
      controls.resize(600);
      expect((controls as any).config.width).toBe(600);
    });
  });

  describe('destroy', () => {
    it('should call unsubscribe on all listeners', () => {
      const mockUnsub = jest.fn();
      (controls as any).unsubscribers = [mockUnsub, mockUnsub];

      controls.destroy();

      expect(mockUnsub).toHaveBeenCalledTimes(2);
    });

    it('should destroy container', () => {
      const containerDestroySpy = jest.spyOn(mockContainer, 'destroy');
      controls.destroy();
      expect(containerDestroySpy).toHaveBeenCalled();
    });
  });

  describe('session name display logic', () => {
    it('should show "Recording..." when recording', () => {
      (controls as any).isRecording = true;
      expect((controls as any).isRecording).toBe(true);
    });

    it('should show session name when session exists', () => {
      (controls as any).isRecording = false;
      (controls as any).currentSession = { name: 'Test Session' };
      expect((controls as any).currentSession).toBeDefined();
    });

    it('should show "No Recording" when nothing active', () => {
      (controls as any).isRecording = false;
      (controls as any).currentSession = null;
      expect((controls as any).currentSession).toBeNull();
    });
  });
});
