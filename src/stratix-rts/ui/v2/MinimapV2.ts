/**
 * Minimap V2 - 响应式版本
 * 
 * 使用EnhancedUIComponent和响应式Token
 * 自动响应主题变化
 * V2升级: 主题色发光边框、Agent点呼吸光效、Zone框状态色填充、视口框动态边框
 */

import Phaser from 'phaser';


import { EnhancedUIComponent } from '@/stratix-core/ui/components/base/EnhancedUIComponent';
import type { UIComponentConfig } from '@/stratix-core/ui/core/types/component.types';
import { ReactiveToken } from '@/stratix-core/ui/foundation/theme/ReactiveToken';

import { MAP_WIDTH, MAP_HEIGHT } from '../../constants';
import { getDSColor, isReducedMotion } from '../../themes/ThemeColors';

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
  private isHovering: boolean = false;
  private updateTimer: Phaser.Time.TimerEvent | null = null;
  private hoverHighlight: Phaser.GameObjects.Graphics | null = null;
  private dragHighlight: Phaser.GameObjects.Graphics | null = null;
  private pingGraphics: Phaser.GameObjects.Graphics | null = null;
  private agentLastPingTime: Map<string, number> = new Map();
  private agentBreathingAlphas: Map<string, number> = new Map();
  
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
    this.accentColor.subscribe(() => this.hoverHighlight?.clear());
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
    const primaryColor = getDSColor('color-primary');
    
    this.background.clear();
    this.background.fillStyle(bgColor, 0.75);
    this.background.fillRoundedRect(0, 0, this.minimapConfig.width, this.minimapConfig.height, 4);
    
    // Theme-colored glow border
    this.background.lineStyle(1, primaryColor, 0.5);
    this.background.strokeRoundedRect(0, 0, this.minimapConfig.width, this.minimapConfig.height, 4);
    
    // Inner subtle border
    this.background.lineStyle(1, borderClr, 0.25);
    this.background.strokeRoundedRect(1, 1, this.minimapConfig.width - 2, this.minimapConfig.height - 2, 3);
  }
  
  private createMapGraphics(): void {
    this.mapGraphics = this.scene.add.graphics();
    (this.container as Phaser.GameObjects.Container).add(this.mapGraphics);

    this.viewportRect = this.scene.add.graphics();
    (this.container as Phaser.GameObjects.Container).add(this.viewportRect);

    this.hoverHighlight = this.scene.add.graphics();
    (this.container as Phaser.GameObjects.Container).add(this.hoverHighlight);

    this.dragHighlight = this.scene.add.graphics();
    (this.container as Phaser.GameObjects.Container).add(this.dragHighlight);

    this.pingGraphics = this.scene.add.graphics();
    (this.container as Phaser.GameObjects.Container).add(this.pingGraphics);
  }
  
  private setupInteraction(): void {
    const hitArea = new Phaser.Geom.Rectangle(0, 0, this.minimapConfig.width, this.minimapConfig.height);
    (this.container as Phaser.GameObjects.Container).setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);

    (this.container as Phaser.GameObjects.Container).on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.isDragging = true;
      this.updateDragHighlight(pointer.x, pointer.y);
      this.moveCameraToPosition(pointer.x, pointer.y);
    });

    (this.container as Phaser.GameObjects.Container).on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isDragging) {
        this.updateDragHighlight(pointer.x, pointer.y);
        this.moveCameraToPosition(pointer.x, pointer.y);
      } else {
        this.updateHoverHighlight(pointer.x, pointer.y);
      }
    });

    (this.container as Phaser.GameObjects.Container).on('pointerup', () => {
      this.isDragging = false;
      this.dragHighlight?.clear();
    });

    (this.container as Phaser.GameObjects.Container).on('pointerupoutside', () => {
      this.isDragging = false;
      this.dragHighlight?.clear();
    });

    (this.container as Phaser.GameObjects.Container).on('pointerover', () => {
      this.isHovering = true;
    });

    (this.container as Phaser.GameObjects.Container).on('pointerout', () => {
      this.isHovering = false;
      this.hoverHighlight?.clear();
    });
  }

  private updateDragHighlight(x: number, y: number): void {
    if (!this.dragHighlight) return;
    const color = this.hexToNumber(this.accentColor.get());
    this.dragHighlight.clear();
    this.dragHighlight.fillStyle(color, 0.3);
    this.dragHighlight.fillCircle(x, y, 8);
    // Glow
    this.dragHighlight.fillStyle(color, 0.15);
    this.dragHighlight.fillCircle(x, y, 12);
  }

  private updateHoverHighlight(localX: number, localY: number): void {
    if (!this.hoverHighlight) return;
    const zones = this.getTaskZones();
    let found = false;

    zones.forEach((zone: any) => {
      const bounds = zone.getBounds();
      const minX = bounds.x * this.minimapScaleX;
      const minY = bounds.y * this.minimapScaleY;
      const maxX = minX + bounds.width * this.minimapScaleX;
      const maxY = minY + bounds.height * this.minimapScaleY;

      if (localX >= minX && localX <= maxX && localY >= minY && localY <= maxY) {
        const color = this.hexToNumber(this.accentColor.get());
        this.hoverHighlight!.clear();
        this.hoverHighlight!.fillStyle(color, 0.2);
        this.hoverHighlight!.fillRect(minX, minY, maxX - minX, maxY - minY);
        found = true;
      }
    });

    if (!found) {
      this.hoverHighlight.clear();
    }
  }
  
  private moveCameraToPosition(localX: number, localY: number): void {
    // Convert minimap local coords to world coords
    // localX/localY are relative to minimap container (0,0 at top-left of minimap)
    const worldX = localX / this.minimapScaleX;
    const worldY = localY / this.minimapScaleY;
    // Center the camera on the clicked world position
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
    this.pingGraphics?.clear();
    this.drawZones();
    this.drawAgents();
    this.drawPings();
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
      
      // Status-colored fill
      const status = zone.getZoneStatus?.() || 'idle';
      const statusColorMap: Record<string, string> = {
        idle: this.infoColor.get(),
        active: this.successColor.get(),
        busy: this.warningColor.get(),
        error: getDSColor('status-danger')?.toString(16).padStart(6, '0') ? '#' + getDSColor('status-danger').toString(16).padStart(6, '0') : '#ff4444',
        completed: this.successColor.get(),
      };
      const statusColor = statusColorMap[status] || this.infoColor.get();
      const color = isSelected
        ? this.hexToNumber(this.successColor.get())
        : this.hexToNumber(statusColor);
      
      // Fill with status alpha
      this.mapGraphics?.fillStyle(color, isSelected ? 0.35 : 0.25);
      this.mapGraphics?.fillRect(minX, minY, width, height);
      
      // Border
      this.mapGraphics?.lineStyle(isSelected ? 2 : 1, color, 0.9);
      this.mapGraphics?.strokeRect(minX, minY, width, height);
    });
  }
  
  private drawAgents(): void {
    const agents = this.getAgentSprites();
    const now = this.scene.time.now;

    const agentColors: Record<string, string> = {
      writer: this.infoColor.get(),
      dev: this.warningColor.get(),
      analyst: '#E67E22',
      custom: this.accentColor.get(),
    };

    agents.forEach((sprite: any, agentId: string) => {
      const agentType = sprite.getAgentType?.() || 'custom';
      const color = agentColors[agentType] || agentColors.custom;

      const minimapX = sprite.x * this.minimapScaleX;
      const minimapY = sprite.y * this.minimapScaleY;

      // Breathing alpha effect
      let alpha = 1;
      if (!isReducedMotion()) {
        const lastAlpha = this.agentBreathingAlphas.get(agentId) ?? 0.5;
        alpha = 0.7 + Math.sin(now * 0.003 + sprite.x * 0.01) * 0.3;
        this.agentBreathingAlphas.set(agentId, alpha);
      }

      // Glow dot
      this.mapGraphics?.fillStyle(this.hexToNumber(color), alpha * 0.3);
      this.mapGraphics?.fillCircle(minimapX, minimapY, 4);
      
      // Core dot
      this.mapGraphics?.fillStyle(this.hexToNumber(color), alpha);
      this.mapGraphics?.fillCircle(minimapX, minimapY, 2);
    });
  }

  private drawPings(): void {
    const agents = this.getAgentSprites();
    const currentTime = this.scene.time.now;
    const pingInterval = 2000;
    const maxRadius = 8;

    agents.forEach((sprite: any, agentId: string) => {
      const status = sprite.getStatus?.() || sprite.getCurrentStatus?.();
      if (status !== 'busy') {
        this.agentLastPingTime.delete(agentId);
        return;
      }

      const minimapX = sprite.x * this.minimapScaleX;
      const minimapY = sprite.y * this.minimapScaleY;

      let lastPingTime = this.agentLastPingTime.get(agentId);
      if (lastPingTime === undefined) {
        lastPingTime = currentTime;
        this.agentLastPingTime.set(agentId, lastPingTime);
      }

      const elapsed = currentTime - lastPingTime;
      if (elapsed >= pingInterval) {
        lastPingTime = currentTime;
        this.agentLastPingTime.set(agentId, lastPingTime);
      }

      const progress = ((currentTime - lastPingTime) % pingInterval) / pingInterval;
      const radius = progress * maxRadius;
      const alpha = 1 - progress;

      if (alpha > 0) {
        this.pingGraphics?.lineStyle(1, this.hexToNumber(this.warningColor.get()), alpha);
        this.pingGraphics?.strokeCircle(minimapX, minimapY, radius);
        // Glow ring
        this.pingGraphics?.lineStyle(1, this.hexToNumber(this.warningColor.get()), alpha * 0.3);
        this.pingGraphics?.strokeCircle(minimapX, minimapY, radius + 2);
      }
    });
  }
  
  private drawViewport(): void {
    const camera = this.camera;
    const zoom = camera.zoom;

    // Visible world area = camera viewport size / zoom
    const visibleWorldWidth = camera.width / zoom;
    const visibleWorldHeight = camera.height / zoom;

    // Center of visible area
    const centerX = camera.scrollX + visibleWorldWidth / 2;
    const centerY = camera.scrollY + visibleWorldHeight / 2;

    // Minimap coords for viewport rect (centered on camera center)
    const viewportX = centerX * this.minimapScaleX - (visibleWorldWidth * this.minimapScaleX) / 2;
    const viewportY = centerY * this.minimapScaleY - (visibleWorldHeight * this.minimapScaleY) / 2;
    const viewportWidth = visibleWorldWidth * this.minimapScaleX;
    const viewportHeight = visibleWorldHeight * this.minimapScaleY;

    this.viewportRect?.clear();
    // Fill semi-transparent to indicate draggable area
    this.viewportRect?.fillStyle(this.hexToNumber(this.textPrimaryColor.get()), 0.08);
    this.viewportRect?.fillRect(viewportX, viewportY, viewportWidth, viewportHeight);
    
    // Dynamic border with primary color accent
    const primaryColor = getDSColor('color-primary');
    this.viewportRect?.lineStyle(1, primaryColor, 0.6);
    this.viewportRect?.strokeRect(viewportX, viewportY, viewportWidth, viewportHeight);
    
    // Corner highlights
    const cornerSize = 4;
    this.viewportRect?.fillStyle(primaryColor, 0.8);
    // Top-left
    this.viewportRect?.fillRect(viewportX - 1, viewportY - 1, cornerSize, 2);
    this.viewportRect?.fillRect(viewportX - 1, viewportY - 1, 2, cornerSize);
    // Top-right
    this.viewportRect?.fillRect(viewportX + viewportWidth - cornerSize + 1, viewportY - 1, cornerSize, 2);
    this.viewportRect?.fillRect(viewportX + viewportWidth - 1, viewportY - 1, 2, cornerSize);
    // Bottom-left
    this.viewportRect?.fillRect(viewportX - 1, viewportY + viewportHeight - 1, cornerSize, 2);
    this.viewportRect?.fillRect(viewportX - 1, viewportY + viewportHeight - cornerSize + 1, 2, cornerSize);
    // Bottom-right
    this.viewportRect?.fillRect(viewportX + viewportWidth - cornerSize + 1, viewportY + viewportHeight - 1, cornerSize, 2);
    this.viewportRect?.fillRect(viewportX + viewportWidth - 1, viewportY + viewportHeight - cornerSize + 1, 2, cornerSize);
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
    this.hoverHighlight?.destroy();
    this.dragHighlight?.destroy();
    this.pingGraphics?.destroy();
    super.destroy();
  }
}
