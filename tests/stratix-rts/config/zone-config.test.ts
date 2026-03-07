import {
  zoneConfigManager,
  DEFAULT_ZONE_CONFIG,
  DEFAULT_ZONE_COLORS,
  DEFAULT_ZONE_RENDER_CONFIG,
  DEFAULT_ZONE_INTERACTION_CONFIG,
  DEFAULT_ZONE_PERFORMANCE_CONFIG
} from '@/stratix-rts/config/zone-config';

describe('ZoneConfigManager', () => {
  beforeEach(() => {
    zoneConfigManager.resetToDefaults();
  });

  describe('singleton', () => {
    it('should return the same instance', () => {
      const instance1 = zoneConfigManager;
      const instance2 = zoneConfigManager;
      expect(instance1).toBe(instance2);
    });
  });

  describe('config management', () => {
    it('should get default config', () => {
      const config = zoneConfigManager.getConfig();
      expect(config).toEqual(DEFAULT_ZONE_CONFIG);
    });

    it('should update config partially', () => {
      zoneConfigManager.setConfig({ minWidth: 100, snapToGrid: false });
      const config = zoneConfigManager.getConfig();
      
      expect(config.minWidth).toBe(100);
      expect(config.snapToGrid).toBe(false);
      expect(config.minHeight).toBe(DEFAULT_ZONE_CONFIG.minHeight);
    });

    it('should not modify original config when returned', () => {
      const config1 = zoneConfigManager.getConfig();
      config1.minWidth = 999;
      
      const config2 = zoneConfigManager.getConfig();
      expect(config2.minWidth).toBe(DEFAULT_ZONE_CONFIG.minWidth);
    });
  });

  describe('colors management', () => {
    it('should get default colors', () => {
      const colors = zoneConfigManager.getColors();
      expect(colors).toEqual(DEFAULT_ZONE_COLORS);
    });

    it('should update colors partially', () => {
      zoneConfigManager.setColors({ fence: 0xff0000 });
      const colors = zoneConfigManager.getColors();
      
      expect(colors.fence).toBe(0xff0000);
      expect(colors.fill).toBe(DEFAULT_ZONE_COLORS.fill);
    });
  });

  describe('render config management', () => {
    it('should get default render config', () => {
      const renderConfig = zoneConfigManager.getRenderConfig();
      expect(renderConfig).toEqual(DEFAULT_ZONE_RENDER_CONFIG);
    });

    it('should update render config', () => {
      zoneConfigManager.setRenderConfig({ fenceLineWidth: 5 });
      const renderConfig = zoneConfigManager.getRenderConfig();
      
      expect(renderConfig.fenceLineWidth).toBe(5);
    });
  });

  describe('interaction config management', () => {
    it('should get default interaction config', () => {
      const interactionConfig = zoneConfigManager.getInteractionConfig();
      expect(interactionConfig).toEqual(DEFAULT_ZONE_INTERACTION_CONFIG);
    });

    it('should update interaction config', () => {
      zoneConfigManager.setInteractionConfig({ dragThreshold: 10 });
      const interactionConfig = zoneConfigManager.getInteractionConfig();
      
      expect(interactionConfig.dragThreshold).toBe(10);
    });
  });

  describe('performance config management', () => {
    it('should get default performance config', () => {
      const performanceConfig = zoneConfigManager.getPerformanceConfig();
      expect(performanceConfig).toEqual(DEFAULT_ZONE_PERFORMANCE_CONFIG);
    });

    it('should update performance config', () => {
      zoneConfigManager.setPerformanceConfig({ maxHistorySize: 100 });
      const performanceConfig = zoneConfigManager.getPerformanceConfig();
      
      expect(performanceConfig.maxHistorySize).toBe(100);
    });
  });

  describe('utility methods', () => {
    it('should snap to grid when enabled', () => {
      zoneConfigManager.setConfig({ gridSize: 20, snapToGrid: true });
      
      expect(zoneConfigManager.snapToGrid(25)).toBe(20);
      expect(zoneConfigManager.snapToGrid(30)).toBe(40);
      expect(zoneConfigManager.snapToGrid(15)).toBe(20);
    });

    it('should not snap to grid when disabled', () => {
      zoneConfigManager.setConfig({ snapToGrid: false });
      
      expect(zoneConfigManager.snapToGrid(25)).toBe(25);
      expect(zoneConfigManager.snapToGrid(30)).toBe(30);
    });

    it('should clamp zone size to min/max', () => {
      const config = {
        minWidth: 50,
        minHeight: 50,
        maxWidth: 500,
        maxHeight: 500
      };
      zoneConfigManager.setConfig(config);

      const result1 = zoneConfigManager.clampZoneSize(30, 30);
      expect(result1).toEqual({ width: 50, height: 50 });

      const result2 = zoneConfigManager.clampZoneSize(600, 600);
      expect(result2).toEqual({ width: 500, height: 500 });

      const result3 = zoneConfigManager.clampZoneSize(200, 200);
      expect(result3).toEqual({ width: 200, height: 200 });
    });
  });

  describe('reset', () => {
    it('should reset all configs to defaults', () => {
      zoneConfigManager.setConfig({ minWidth: 999 });
      zoneConfigManager.setColors({ fence: 0xffffff });
      zoneConfigManager.setRenderConfig({ fenceLineWidth: 999 });
      zoneConfigManager.setInteractionConfig({ dragThreshold: 999 });
      zoneConfigManager.setPerformanceConfig({ maxHistorySize: 999 });

      zoneConfigManager.resetToDefaults();

      expect(zoneConfigManager.getConfig()).toEqual(DEFAULT_ZONE_CONFIG);
      expect(zoneConfigManager.getColors()).toEqual(DEFAULT_ZONE_COLORS);
      expect(zoneConfigManager.getRenderConfig()).toEqual(DEFAULT_ZONE_RENDER_CONFIG);
      expect(zoneConfigManager.getInteractionConfig()).toEqual(DEFAULT_ZONE_INTERACTION_CONFIG);
      expect(zoneConfigManager.getPerformanceConfig()).toEqual(DEFAULT_ZONE_PERFORMANCE_CONFIG);
    });
  });
});