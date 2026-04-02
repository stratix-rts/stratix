/**
 * AgentRadarChart Tests
 */

import { AgentRadarChart, DIMENSIONS, AgentScores } from '@/stratix-rts/ui/AgentRadarChart';

function createMockGraphics() {
  return {
    clear: jest.fn(),
    setDepth: jest.fn(),
    lineStyle: jest.fn(),
    fillStyle: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fillPath: jest.fn(),
    strokePath: jest.fn(),
    lineBetween: jest.fn(),
    fillCircle: jest.fn(),
    destroy: jest.fn(),
  };
}

function createMockText() {
  return {
    setOrigin: jest.fn(),
    setDepth: jest.fn(),
    setText: jest.fn(),
    destroy: jest.fn(),
  };
}

function createMockScene() {
  const mockGraphics = createMockGraphics();
  const mockText = createMockText();
  let currentTime = 0;

  const scene = {
    add: {
      graphics: jest.fn().mockReturnValue(mockGraphics),
      text: jest.fn().mockReturnValue(mockText),
    },
    time: {
      now: 0,
    },
    tweens: {
      add: jest.fn(),
      isTweening: jest.fn().mockReturnValue(false),
    },
  };

  // Proxy to update time.now dynamically
  return {
    scene,
    mockGraphics,
    mockText,
    advanceTime: (ms: number) => {
      currentTime += ms;
      (scene.time as any).now = currentTime;
    },
    getCurrentTime: () => currentTime,
  };
}

describe('AgentRadarChart', () => {
  let radarChart: AgentRadarChart;
  let mock: ReturnType<typeof createMockScene>;

  beforeEach(() => {
    mock = createMockScene();
    radarChart = new AgentRadarChart(mock.scene as any, 100, 100, 80);
  });

  afterEach(() => {
    radarChart.destroy();
  });

  describe('constructor', () => {
    it('should create grid graphics with correct depth', () => {
      expect(mock.mockGraphics.setDepth).toHaveBeenCalledWith(1);
    });

    it('should create score graphics with correct depth', () => {
      // Second call to add.graphics() for score graphics
      const graphicsCalls = (mock.scene.add.graphics as jest.Mock).mock.calls;
      expect(graphicsCalls).toHaveLength(2);
    });

    it('should create 6 dimension labels', () => {
      const textCalls = (mock.scene.add.text as jest.Mock).mock.calls;
      expect(textCalls).toHaveLength(6);
    });

    it('should draw hexagonal grid lines', () => {
      // Grid should have 3 concentric hexagons + 6 axis lines = 9 lineStyle calls
      expect(mock.mockGraphics.lineStyle).toHaveBeenCalled();
    });
  });

  describe('setScores', () => {
    it('should accept partial scores and fill missing with 0', () => {
      const scores: AgentScores = {
        Speed: 80,
        Accuracy: 60,
      };
      // @ts-ignore - testing with partial scores
      radarChart.setScores(scores);
      // Complete animation
      mock.advanceTime(600);
      radarChart.update(mock.getCurrentTime());
      const result = radarChart.getScores();
      expect(result.Speed).toBe(80);
      expect(result.Accuracy).toBe(60);
      expect(result.Creativity).toBe(0);
      expect(result.Reliability).toBe(0);
      expect(result.Complexity).toBe(0);
      expect(result.Collaboration).toBe(0);
    });

    it('should clamp scores above 100 to 100', () => {
      radarChart.setScores({ Speed: 150 } as AgentScores);
      mock.advanceTime(600);
      radarChart.update(mock.getCurrentTime());
      const result = radarChart.getScores();
      expect(result.Speed).toBe(100);
    });

    it('should clamp scores below 0 to 0', () => {
      radarChart.setScores({ Speed: -20 } as AgentScores);
      mock.advanceTime(600);
      radarChart.update(mock.getCurrentTime());
      const result = radarChart.getScores();
      expect(result.Speed).toBe(0);
    });

    it('should set all six dimensions correctly', () => {
      const scores: AgentScores = {
        Speed: 90,
        Accuracy: 85,
        Creativity: 70,
        Reliability: 95,
        Complexity: 60,
        Collaboration: 75,
      };
      radarChart.setScores(scores);
      mock.advanceTime(600);
      radarChart.update(mock.getCurrentTime());
      const result = radarChart.getScores();
      expect(result.Speed).toBe(90);
      expect(result.Accuracy).toBe(85);
      expect(result.Creativity).toBe(70);
      expect(result.Reliability).toBe(95);
      expect(result.Complexity).toBe(60);
      expect(result.Collaboration).toBe(75);
    });

    it('should trigger animation', () => {
      radarChart.setScores({ Speed: 50 } as AgentScores);
      expect(radarChart.isAnimatingScores()).toBe(true);
    });

    it('should draw score polygon immediately', () => {
      radarChart.setScores({ Speed: 100 } as AgentScores);
      expect(mock.mockGraphics.fillStyle).toHaveBeenCalled();
      expect(mock.mockGraphics.beginPath).toHaveBeenCalled();
    });
  });

  describe('setAgentName', () => {
    it('should create text for agent name', () => {
      radarChart.setAgentName('TestAgent');
      expect(mock.scene.add.text).toHaveBeenCalled();
    });

    it('should update existing name', () => {
      radarChart.setAgentName('Agent1');
      radarChart.setAgentName('Agent2');
      // Should have been called 8 times: 6 labels + 2 for name updates
      expect(mock.scene.add.text).toHaveBeenCalledTimes(8);
    });

    it('should return the set agent name', () => {
      radarChart.setAgentName('MyAgent');
      expect(radarChart.getAgentName()).toBe('MyAgent');
    });

    it('should handle empty string name', () => {
      radarChart.setAgentName('');
      expect(radarChart.getAgentName()).toBe('');
    });
  });

  describe('update (animation)', () => {
    it('should interpolate scores over time', () => {
      radarChart.setScores({ Speed: 100 } as AgentScores);

      // Advance time partially
      mock.advanceTime(250); // Half the animation duration
      radarChart.update(mock.getCurrentTime());

      // Score should be partially interpolated
      const result = radarChart.getScores();
      expect(result.Speed).toBeGreaterThan(0);
      expect(result.Speed).toBeLessThan(100);
    });

    it('should complete animation and set exact scores', () => {
      radarChart.setScores({ Speed: 100 } as AgentScores);

      // Advance past animation duration
      mock.advanceTime(600);
      radarChart.update(mock.getCurrentTime());

      const result = radarChart.getScores();
      expect(result.Speed).toBe(100);
      expect(radarChart.isAnimatingScores()).toBe(false);
    });

    it('should handle multiple dimension animation', () => {
      const scores: AgentScores = {
        Speed: 80,
        Accuracy: 60,
        Creativity: 100,
        Reliability: 40,
        Complexity: 90,
        Collaboration: 70,
      };
      radarChart.setScores(scores);

      mock.advanceTime(300);
      radarChart.update(mock.getCurrentTime());

      // All scores should be > 0 but < final value
      const result = radarChart.getScores();
      DIMENSIONS.forEach((dim) => {
        expect(result[dim]).toBeGreaterThan(0);
        expect(result[dim]).toBeLessThanOrEqual(scores[dim] ?? 100);
      });
    });
  });

  describe('destroy', () => {
    it('should destroy grid graphics', () => {
      radarChart.destroy();
      expect(mock.mockGraphics.destroy).toHaveBeenCalled();
    });

    it('should destroy score graphics', () => {
      radarChart.destroy();
      // Both graphics objects should be destroyed
      expect(mock.mockGraphics.destroy).toHaveBeenCalledTimes(2);
    });

    it('should destroy all label texts', () => {
      radarChart.destroy();
      expect(mock.mockText.destroy).toHaveBeenCalledTimes(6);
    });

    it('should prevent setScores after destroy', () => {
      radarChart.destroy();
      expect(() => {
        radarChart.setScores({ Speed: 50 } as AgentScores);
      }).not.toThrow();
    });

    it('should prevent setAgentName after destroy', () => {
      radarChart.destroy();
      expect(() => {
        radarChart.setAgentName('Test');
      }).not.toThrow();
    });

    it('should not crash multiple destroy calls', () => {
      expect(() => {
        radarChart.destroy();
        radarChart.destroy();
      }).not.toThrow();
    });
  });

  describe('getScores', () => {
    it('should return initial zero scores', () => {
      const scores = radarChart.getScores();
      DIMENSIONS.forEach((dim) => {
        expect(scores[dim]).toBe(0);
      });
    });

    it('should return rounded integer scores', () => {
      radarChart.setScores({ Speed: 83.7 } as AgentScores);
      mock.advanceTime(600);
      radarChart.update(mock.getCurrentTime());

      const scores = radarChart.getScores();
      expect(scores.Speed).toBe(84);
    });
  });

  describe('getAgentName', () => {
    it('should return empty string initially', () => {
      expect(radarChart.getAgentName()).toBe('');
    });
  });

  describe('isAnimatingScores', () => {
    it('should return false initially', () => {
      expect(radarChart.isAnimatingScores()).toBe(false);
    });

    it('should return true during animation', () => {
      radarChart.setScores({ Speed: 100 } as AgentScores);
      expect(radarChart.isAnimatingScores()).toBe(true);
    });
  });
});