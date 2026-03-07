export interface ZoneConfig {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  defaultWidth: number;
  defaultHeight: number;
  gridSize: number;
  snapToGrid: boolean;
}

export interface ZoneColors {
  fence: number;
  fill: number;
  corner: number;
  selected: number;
  warning: number;
  handle: number;
  status: {
    idle: number;
    active: number;
    busy: number;
    error: number;
  };
}

export interface ZoneRenderConfig {
  fenceLineWidth: number;
  fillAlpha: number;
  cornerRadius: number;
  cornerSize: number;
  selectedLineWidth: number;
  selectedAlpha: number;
}

export interface ZoneInteractionConfig {
  dragThreshold: number;
  resizeHandleSize: number;
  doubleClickDelay: number;
  longPressDelay: number;
  hoverDelay: number;
}

export interface ZonePerformanceConfig {
  maxHistorySize: number;
  spatialGridCellSize: number;
  maxZonesPerScene: number;
  enableObjectPooling: boolean;
  objectPoolInitialSize: number;
  incrementalRenderThreshold: number;
}

export const DEFAULT_ZONE_CONFIG: ZoneConfig = {
  minWidth: 50,
  minHeight: 50,
  maxWidth: 2000,
  maxHeight: 2000,
  defaultWidth: 200,
  defaultHeight: 200,
  gridSize: 20,
  snapToGrid: true
};

export const DEFAULT_ZONE_COLORS: ZoneColors = {
  fence: 0xff6600,
  fill: 0xff6600,
  corner: 0xffaa00,
  selected: 0x00ff00,
  warning: 0xff0000,
  handle: 0xffff00,
  status: {
    idle: 0x888888,
    active: 0x00ff88,
    busy: 0xffff00,
    error: 0xff4444
  }
};

export const DEFAULT_ZONE_RENDER_CONFIG: ZoneRenderConfig = {
  fenceLineWidth: 2,
  fillAlpha: 0.1,
  cornerRadius: 4,
  cornerSize: 12,
  selectedLineWidth: 3,
  selectedAlpha: 0.15
};

export const DEFAULT_ZONE_INTERACTION_CONFIG: ZoneInteractionConfig = {
  dragThreshold: 5,
  resizeHandleSize: 16,
  doubleClickDelay: 300,
  longPressDelay: 500,
  hoverDelay: 200
};

export const DEFAULT_ZONE_PERFORMANCE_CONFIG: ZonePerformanceConfig = {
  maxHistorySize: 50,
  spatialGridCellSize: 100,
  maxZonesPerScene: 500,
  enableObjectPooling: true,
  objectPoolInitialSize: 20,
  incrementalRenderThreshold: 100
};

export class ZoneConfigManager {
  private static instance: ZoneConfigManager;
  
  private config: ZoneConfig;
  private colors: ZoneColors;
  private renderConfig: ZoneRenderConfig;
  private interactionConfig: ZoneInteractionConfig;
  private performanceConfig: ZonePerformanceConfig;

  private constructor() {
    this.config = { ...DEFAULT_ZONE_CONFIG };
    this.colors = { ...DEFAULT_ZONE_COLORS };
    this.renderConfig = { ...DEFAULT_ZONE_RENDER_CONFIG };
    this.interactionConfig = { ...DEFAULT_ZONE_INTERACTION_CONFIG };
    this.performanceConfig = { ...DEFAULT_ZONE_PERFORMANCE_CONFIG };
  }

  static getInstance(): ZoneConfigManager {
    if (!ZoneConfigManager.instance) {
      ZoneConfigManager.instance = new ZoneConfigManager();
    }
    return ZoneConfigManager.instance;
  }

  getConfig(): ZoneConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<ZoneConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getColors(): ZoneColors {
    return { ...this.colors };
  }

  setColors(colors: Partial<ZoneColors>): void {
    this.colors = { ...this.colors, ...colors };
  }

  getRenderConfig(): ZoneRenderConfig {
    return { ...this.renderConfig };
  }

  setRenderConfig(config: Partial<ZoneRenderConfig>): void {
    this.renderConfig = { ...this.renderConfig, ...config };
  }

  getInteractionConfig(): ZoneInteractionConfig {
    return { ...this.interactionConfig };
  }

  setInteractionConfig(config: Partial<ZoneInteractionConfig>): void {
    this.interactionConfig = { ...this.interactionConfig, ...config };
  }

  getPerformanceConfig(): ZonePerformanceConfig {
    return { ...this.performanceConfig };
  }

  setPerformanceConfig(config: Partial<ZonePerformanceConfig>): void {
    this.performanceConfig = { ...this.performanceConfig, ...config };
  }

  resetToDefaults(): void {
    this.config = { ...DEFAULT_ZONE_CONFIG };
    this.colors = { ...DEFAULT_ZONE_COLORS };
    this.renderConfig = { ...DEFAULT_ZONE_RENDER_CONFIG };
    this.interactionConfig = { ...DEFAULT_ZONE_INTERACTION_CONFIG };
    this.performanceConfig = { ...DEFAULT_ZONE_PERFORMANCE_CONFIG };
  }

  snapToGrid(value: number): number {
    if (!this.config.snapToGrid) return value;
    return Math.round(value / this.config.gridSize) * this.config.gridSize;
  }

  clampZoneSize(width: number, height: number): { width: number; height: number } {
    return {
      width: Math.max(this.config.minWidth, Math.min(this.config.maxWidth, width)),
      height: Math.max(this.config.minHeight, Math.min(this.config.maxHeight, height))
    };
  }
}

export const zoneConfigManager = ZoneConfigManager.getInstance();