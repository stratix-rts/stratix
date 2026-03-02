/**
 * Minimap V2 - 响应式版本
 * 
 * 使用EnhancedUIComponent和响应式Token
 * 自动响应主题变化
 */

import Phaser from 'phaser';
import { EnhancedUIComponent } from '@/stratix-core/ui/components/base/EnhancedUIComponent';
import type { UIComponentConfig } from '@/stratix-core/ui/core/types/component.types';
import { ReactiveToken } from '@/stratix-core/ui/foundation/theme/ReactiveToken';
import { MAP_WIDTH, MAP_HEIGHT } from '../../constants';

interface MinimapConfig {
  width: number;
  height: number;
  padding: number;
}

const DEFAULT_CONFIG: MinimapConfig = {
  width: 200,
  height: 120,
  padding: 8,
};

export class MinimapV2 extends EnhancedUIComponent {
  private minimapConfig: MinimapConfig;
  private background: Phaser.GameObjects.Graphics | null = null;
  private mapGraphics: Phaser.GameObjects.Graphics | null = null;
  private viewportRect: Phaser.GameObjects.Graphics | null = null;
  private minimapScaleX: number;
  private minimapScaleY: number;
  
  private getAgentSprites: () => Map<string, any>;
  private getTaskZones: () => Map<string, any>;
  private getSelectedZoneIds: () => Set<string>;
  private camera: Phaser.Cameras.Scene2D.Camera;
  private isDragging: boolean = false;
  private updateTimer: Phaser.Time.TimerEvent | null = null;
  
  private backgroundColor: ReactiveToken<string>;
  private borderColor: ReactiveToken<string>;
  private textPrimaryColor: ReactiveToken<string>;
  private successColor: ReactiveToken<string>;
  private infoColor: ReactiveToken<string>;
  private warningColor: ReactiveToken<string>;
  private accentColor: ReactiveToken<string>;
  
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    camera: Phaser.Cameras.Scene2D.Camera,
    getAgentSprites: () => Map<string, any>,
    getTaskZones: () => Map<string, any>,
    getSelectedZoneIds: () => Set<string>,
    config?: Partial<MinimapConfig>
  ) {
    super(scene, {
      x,
      y,
      width: config?.width ?? DEFAULT_CONFIG.width,
      height: config?.height ?? DEFAULT_CONFIG.height,
      reactiveTheme: true,
    });
    
    this.minimapConfig = { ...DEFAULT_CONFIG, ...config };
    this.camera = camera;
    this.getAgentSprites = getAgentSprites;
    this.getTaskZones = getTaskZones;
    this.getSelectedZoneIds = getSelectedZoneIds;
    
    this.minimapScaleX = this.minimapConfig.width / MAP_WIDTH;
    this.minimapScaleY = this.minimapConfig.height / MAP_HEIGHT;
    
    this.backgroundColor = this.useToken('colors.background.primary');
    this.borderColor = this.useToken('colors.border.default');
    this.textPrimaryColor = this.useToken('colors.text.primary');
    this.successColor = this.useToken('colors.semantic.success');
    this.infoColor = this.useToken('colors.semantic.info');
    this.warningColor = this.useToken('colors.semantic.warning');
    this.accentColor = this.useToken('colors.accent');
    
    this.backgroundColor.subscribe(() => this.redraw());
    this.borderColor.subscribe(() => this.redraw());
  }
  
  create(): void {
    this.container = this.scene.add.container(this.config.x, this.config.y);
    this.container.setScrollFactor(0, 0);
    this.container.setDepth(1000);
    
    this.createBackground();
    this.createMapGraphics();
    this.setupInteraction();
    this.startAutoUpdate();
    
    this.onCreate();
  }
  
  private createBackground(): void {
    this.background = this.scene.add.graphics();
    this.drawBackground();
    (this.container as Phaser.GameObjects.Container).add(this.background);
  }
  
  private drawBackground(): void {
    if (!this.background) return;
    
    const bgColor = this.hexToNumber(this.backgroundColor.get());
    const borderClr = this.hexToNumber(this.borderColor.get());
    
    this.background.clear();
    this.background.fillStyle(bgColor, 0.9);
    this.background.fillRoundedRect(0, 0, this.minimapConfig.width, this.minimapConfig.height, 4);
    this.background.lineStyle(1, borderClr, 0.5);
    this.background.strokeRoundedRect(0, 0, this.minimapConfig.width, this.minimapConfig.height, 4);
  }
  
  private createMapGraphics(): void {
    this.mapGraphics = this.scene.add.graphics();
    (this.container as Phaser.GameObjects.Container).add(this.mapGraphics);
    
    this.viewportRect = this.scene.add.graphics();
    (this.container as Phaser.GameObjects.Container).add(this.viewportRect);
  }
  
  private setupInteraction(): void {
    const hitArea = new Phaser.Geom.Rectangle(0, 0, this.minimapConfig.width, this.minimapConfig.height);
    (this.container as Phaser.GameObjects.Container).setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);
    
    (this.container as Phaser.GameObjects.Container).on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.isDragging = true;
      this.moveCameraToPosition(pointer.x, pointer.y);
    });
    
    (this.container as Phaser.GameObjects.Container).on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isDragging) {
        this.moveCameraToPosition(pointer.x, pointer.y);
      }
    });
    
    (this.container as Phaser.GameObjects.Container).on('pointerup', () => {
      this.isDragging = false;
    });
    
    (this.container as Phaser.GameObjects.Container).on('pointerupoutside', () => {
      this.isDragging = false;
    });
  }
  
  private moveCameraToPosition(localX: number, localY: number): void {
    const worldX = (localX / this.minimapScaleX) + this.camera.width / 2;
    const worldY = (localY / this.minimapScaleY) + this.camera.height / 2;
    this.camera.centerOn(worldX, worldY);
  }
  
  private startAutoUpdate(): void {
    this.updateDisplay();
    this.updateTimer = this.scene.time.addEvent({
      delay: 100,
      callback: this.updateDisplay,
      callbackScope: this,
      loop: true,
    });
  }
  
  private updateDisplay(): void {
    this.mapGraphics?.clear();
    this.drawZones();
    this.drawAgents();
    this.drawViewport();
  }
  
  private drawZones(): void {
    const zones = this.getTaskZones();
    const selectedZoneIds = this.getSelectedZoneIds();
    
    zones.forEach((zone: any, zoneId: string) => {
      const bounds = zone.getBounds();
      const minX = bounds.x * this.minimapScaleX;
      const minY = bounds.y * this.minimapScaleY;
      const width = bounds.width * this.minimapScaleX;
      const height = bounds.height * this.minimapScaleY;
      
      const isSelected = selectedZoneIds.has(zoneId);
      const color = isSelected
        ? this.hexToNumber(this.successColor.get())
        : this.hexToNumber(this.infoColor.get());
      
      this.mapGraphics?.fillStyle(color, 0.3);
      this.mapGraphics?.fillRect(minX, minY, width, height);
      this.mapGraphics?.lineStyle(1, color, 0.8);
      this.mapGraphics?.strokeRect(minX, minY, width, height);
    });
  }
  
  private drawAgents(): void {
    const agents = this.getAgentSprites();
    
    const agentColors: Record<string, string> = {
      writer: this.infoColor.get(),
      dev: this.warningColor.get(),
      analyst: '#E67E22',
      custom: this.accentColor.get(),
    };
    
    agents.forEach((sprite: any) => {
      const agentType = sprite.getAgentType?.() || 'custom';
      const color = agentColors[agentType] || agentColors.custom;
      
      const minimapX = sprite.x * this.minimapScaleX;
      const minimapY = sprite.y * this.minimapScaleY;
      
      this.mapGraphics?.fillStyle(this.hexToNumber(color), 1);
      this.mapGraphics?.fillCircle(minimapX, minimapY, 2);
    });
  }
  
  private drawViewport(): void {
    const camera = this.camera;
    
    const viewportX = camera.scrollX * this.minimapScaleX;
    const viewportY = camera.scrollY * this.minimapScaleY;
    const viewportWidth = camera.width * this.minimapScaleX;
    const viewportHeight = camera.height * this.minimapScaleY;
    
    this.viewportRect?.clear();
    this.viewportRect?.lineStyle(1, this.hexToNumber(this.textPrimaryColor.get()), 0.8);
    this.viewportRect?.strokeRect(viewportX, viewportY, viewportWidth, viewportHeight);
  }
  
  public resize(width: number, height: number): void {
    this.minimapConfig.width = width;
    this.minimapConfig.height = height;
    this.minimapScaleX = width / MAP_WIDTH;
    this.minimapScaleY = height / MAP_HEIGHT;
    this.drawBackground();
    this.updateDisplay();
  }
  
  protected updateThemeStyles(): void {
    this.redraw();
  }
  
  private redraw(): void {
    this.drawBackground();
    this.updateDisplay();
  }
  
  private hexToNumber(hex: string): number {
    if (!hex || typeof hex !== 'string') return 0xffffff;
    return parseInt(hex.slice(1), 16);
  }
  
  destroy(): void {
    if (this.updateTimer) {
      this.updateTimer.remove();
      this.updateTimer = null;
    }
    this.background?.destroy();
    this.mapGraphics?.destroy();
    this.viewportRect?.destroy();
    super.destroy();
  }
}