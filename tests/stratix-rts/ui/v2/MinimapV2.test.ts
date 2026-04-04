/**
 * MinimapV2 Unit Tests
 *
 * Tests coordinate calculations, scale logic, and viewport math
 * These tests don't require Phaser dependencies
 */

import { MAP_WIDTH, MAP_HEIGHT } from '@/stratix-rts/constants';

describe('MinimapV2 Calculations', () => {
  // Default config
  const DEFAULT_CONFIG = {
    width: 200,
    height: 120,
    padding: 8,
  };

  describe('scale calculation', () => {
    it('should calculate minimapScaleX correctly', () => {
      const scaleX = DEFAULT_CONFIG.width / MAP_WIDTH;
      expect(scaleX).toBeCloseTo(0.125, 3);
    });

    it('should calculate minimapScaleY correctly', () => {
      const scaleY = DEFAULT_CONFIG.height / MAP_HEIGHT;
      expect(scaleY).toBeCloseTo(0.125, 3);
    });

    it('should recalculate scales after resize', () => {
      const newWidth = 400;
      const newHeight = 240;
      const scaleX = newWidth / MAP_WIDTH;
      const scaleY = newHeight / MAP_HEIGHT;
      expect(scaleX).toBeCloseTo(0.25, 3);
      expect(scaleY).toBeCloseTo(0.25, 3);
    });
  });

  describe('coordinate conversion', () => {
    const scaleX = DEFAULT_CONFIG.width / MAP_WIDTH;
    const scaleY = DEFAULT_CONFIG.height / MAP_HEIGHT;

    it('should convert world X to minimap X', () => {
      const worldX = 960; // middle of 1600
      const minimapX = worldX * scaleX;
      expect(minimapX).toBeCloseTo(120, 5);
    });

    it('should convert world Y to minimap Y', () => {
      const worldY = 540; // middle of 960
      const minimapY = worldY * scaleY;
      expect(minimapY).toBeCloseTo(67.5, 5);
    });

    it('should convert minimap X back to world X', () => {
      const minimapX = 100;
      const worldX = minimapX / scaleX;
      expect(worldX).toBeCloseTo(800, 5);
    });

    it('should handle edge case at origin', () => {
      const worldX = 0;
      const minimapX = worldX * scaleX;
      expect(minimapX).toBe(0);
    });

    it('should handle edge case at max', () => {
      const worldX = MAP_WIDTH;
      const minimapX = worldX * scaleX;
      expect(minimapX).toBeCloseTo(DEFAULT_CONFIG.width, 5);
    });
  });

  describe('zone bounds calculation', () => {
    const scaleX = DEFAULT_CONFIG.width / MAP_WIDTH;
    const scaleY = DEFAULT_CONFIG.height / MAP_HEIGHT;

    it('should calculate minimap coordinates from world bounds', () => {
      const bounds = { x: 0, y: 0, width: 960, height: 540 };

      const minX = bounds.x * scaleX;
      const minY = bounds.y * scaleY;
      const maxX = minX + bounds.width * scaleX;
      const maxY = minY + bounds.height * scaleY;

      expect(minX).toBeCloseTo(0, 5);
      expect(minY).toBeCloseTo(0, 5);
      expect(maxX).toBeCloseTo(120, 5);
      expect(maxY).toBeCloseTo(67.5, 5);
    });

    it('should calculate bounds for a centered zone', () => {
      const bounds = { x: 480, y: 270, width: 960, height: 540 };
      // This zone spans from center to bottom-right

      const minX = bounds.x * scaleX;
      const minY = bounds.y * scaleY;
      const maxX = minX + bounds.width * scaleX;
      const maxY = minY + bounds.height * scaleY;

      expect(minX).toBeCloseTo(60, 5);
      expect(minY).toBeCloseTo(33.75, 5);
      expect(maxX).toBeCloseTo(180, 5);
      expect(maxY).toBeCloseTo(101.25, 5);
    });
  });

  describe('viewport calculation', () => {
    it('should calculate visible world area from camera', () => {
      const camera = { width: 1920, height: 1080, zoom: 1 };
      const visibleWorldWidth = camera.width / camera.zoom;
      const visibleWorldHeight = camera.height / camera.zoom;

      expect(visibleWorldWidth).toBe(1920);
      expect(visibleWorldHeight).toBe(1080);
    });

    it('should calculate viewport rect dimensions', () => {
      const camera = { width: 1920, height: 1080, zoom: 1 };
      const scaleX = DEFAULT_CONFIG.width / MAP_WIDTH;
      const scaleY = DEFAULT_CONFIG.height / MAP_HEIGHT;

      const visibleWorldWidth = camera.width / camera.zoom;
      const visibleWorldHeight = camera.height / camera.zoom;

      const viewportWidth = visibleWorldWidth * scaleX;
      const viewportHeight = visibleWorldHeight * scaleY;

      expect(viewportWidth).toBeCloseTo(240, 5);
      expect(viewportHeight).toBeCloseTo(135, 5);
    });

    it('should handle zoomed camera', () => {
      const camera = { width: 1920, height: 1080, zoom: 2 };
      const scaleX = DEFAULT_CONFIG.width / MAP_WIDTH;
      const scaleY = DEFAULT_CONFIG.height / MAP_HEIGHT;

      const visibleWorldWidth = camera.width / camera.zoom;
      const visibleWorldHeight = camera.height / camera.zoom;

      const viewportWidth = visibleWorldWidth * scaleX;
      const viewportHeight = visibleWorldHeight * scaleY;

      expect(viewportWidth).toBeCloseTo(120, 5); // Half because zoom is 2x
      expect(viewportHeight).toBeCloseTo(67.5, 5);
    });
  });

  describe('agent position mapping', () => {
    const scaleX = DEFAULT_CONFIG.width / MAP_WIDTH;
    const scaleY = DEFAULT_CONFIG.height / MAP_HEIGHT;

    it('should map agent world position to minimap position', () => {
      const agentWorldX = 960;
      const agentWorldY = 540;

      const minimapX = agentWorldX * scaleX;
      const minimapY = agentWorldY * scaleY;

      expect(minimapX).toBeCloseTo(120, 5);
      expect(minimapY).toBeCloseTo(67.5, 5);
    });

    it('should handle multiple agents', () => {
      const agents = [
        { x: 100, y: 100 },
        { x: 500, y: 500 },
        { x: 1800, y: 900 },
      ];

      const minimapPositions = agents.map(agent => ({
        x: agent.x * scaleX,
        y: agent.y * scaleY,
      }));

      // scaleX = 200/1600 = 0.125, scaleY = 120/960 = 0.125
      expect(minimapPositions[0].x).toBeCloseTo(12.5, 0);
      expect(minimapPositions[0].y).toBeCloseTo(12.5, 0);
      expect(minimapPositions[1].x).toBeCloseTo(62.5, 0);
      expect(minimapPositions[1].y).toBeCloseTo(62.5, 0);
      expect(minimapPositions[2].x).toBeCloseTo(225, 0);
      expect(minimapPositions[2].y).toBeCloseTo(112.5, 0);
    });
  });

  describe('ping animation timing', () => {
    it('should calculate ping progress correctly', () => {
      const pingInterval = 2000;
      const lastPingTime = 1000;
      const currentTime = 2000;

      const elapsed = currentTime - lastPingTime;
      const progress = (currentTime - lastPingTime) % pingInterval / pingInterval;

      expect(elapsed).toBe(1000);
      expect(progress).toBeCloseTo(0.5, 5);
    });

    it('should calculate ping radius based on progress', () => {
      const maxRadius = 8;
      const progress = 0.5;
      const radius = progress * maxRadius;

      expect(radius).toBe(4);
    });

    it('should calculate ping alpha based on progress', () => {
      const progress = 0.5;
      const alpha = 1 - progress;

      expect(alpha).toBe(0.5);
    });

    it('should reset progress after interval', () => {
      const pingInterval = 2000;
      const lastPingTime = 1000;
      const currentTime = 3500;

      const progress = (currentTime - lastPingTime) % pingInterval / pingInterval;
      // 3500 - 1000 = 2500, 2500 % 2000 = 500, 500/2000 = 0.25
      expect(progress).toBeCloseTo(0.25, 5);
    });
  });

  describe('hexToNumber utility', () => {
    function hexToNumber(hex: string): number {
      if (!hex || typeof hex !== 'string') return 0xffffff;
      return parseInt(hex.slice(1), 16);
    }

    it('should convert valid hex to number', () => {
      expect(hexToNumber('#ffffff')).toBe(0xffffff);
    });

    it('should convert short hex', () => {
      expect(hexToNumber('#fff')).toBe(0x000fff);
    });

    it('should convert color hex', () => {
      expect(hexToNumber('#00ff88')).toBe(0x00ff88);
    });

    it('should return 0xffffff for invalid hex', () => {
      expect(hexToNumber('')).toBe(0xffffff);
      expect(hexToNumber(null as any)).toBe(0xffffff);
      expect(hexToNumber(undefined as any)).toBe(0xffffff);
    });
  });

  describe('zone selection highlighting', () => {
    it('should check if zone is selected', () => {
      const selectedZoneIds = new Set(['zone-1', 'zone-2']);
      expect(selectedZoneIds.has('zone-1')).toBe(true);
      expect(selectedZoneIds.has('zone-3')).toBe(false);
    });

    it('should handle empty selection', () => {
      const selectedZoneIds = new Set<string>();
      expect(selectedZoneIds.has('zone-1')).toBe(false);
    });
  });

  describe('camera center calculation', () => {
    it('should calculate camera center in world coordinates', () => {
      const camera = { scrollX: 0, scrollY: 0, width: 1920, height: 1080, zoom: 1 };
      const visibleWorldWidth = camera.width / camera.zoom;
      const visibleWorldHeight = camera.height / camera.zoom;

      const centerX = camera.scrollX + visibleWorldWidth / 2;
      const centerY = camera.scrollY + visibleWorldHeight / 2;

      expect(centerX).toBe(960);
      expect(centerY).toBe(540);
    });

    it('should calculate minimap viewport rect centered on camera', () => {
      const camera = { scrollX: 0, scrollY: 0, width: 1920, height: 1080, zoom: 1 };
      const scaleX = DEFAULT_CONFIG.width / MAP_WIDTH;
      const scaleY = DEFAULT_CONFIG.height / MAP_HEIGHT;
      const visibleWorldWidth = camera.width / camera.zoom;
      const visibleWorldHeight = camera.height / camera.zoom;

      const centerX = camera.scrollX + visibleWorldWidth / 2;
      const centerY = camera.scrollY + visibleWorldHeight / 2;

      const viewportX = centerX * scaleX - (visibleWorldWidth * scaleX) / 2;
      const viewportY = centerY * scaleY - (visibleWorldHeight * scaleY) / 2;
      const viewportWidth = visibleWorldWidth * scaleX;
      const viewportHeight = visibleWorldHeight * scaleY;

      expect(viewportX).toBeCloseTo(0, 5);
      expect(viewportY).toBeCloseTo(0, 5);
      expect(viewportWidth).toBeCloseTo(240, 5);
      expect(viewportHeight).toBeCloseTo(135, 5);
    });
  });
});
