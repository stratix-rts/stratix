/**
 * Minimap V2 - Cyberpunk×Fantasy Style
 *
 * 使用EnhancedUIComponent和响应式Token
 * 自动响应主题变化
 * V2升级: 状态色Agent点、状态填充Zone框、点击Ping波纹、动态虚线视口、坐标悬停
 */

import Phaser from 'phaser';

import { EnhancedUIComponent } from '@/stratix-core/ui/components/base/EnhancedUIComponent';

import { ReactiveToken } from '@/stratix-core/ui/foundation/theme/ReactiveToken';

import { MAP_WIDTH, MAP_HEIGHT } from '../../constants';
import { isReducedMotion } from '../../themes/ThemeColors';
import { HUD_LAYOUT } from './layout/HUDLayout';

interface MinimapConfig {
  width: number;
  height: number;
  padding: number;
}

const DEFAULT_CONFIG: MinimapConfig = {
  width: HUD_LAYOUT.minimap.width,
  height: HUD_LAYOUT.minimap.height,
  padding: HUD_LAYOUT.minimap.padding,
};

interface ClickPing {
  x: number;
  y: number;
  startTime: number;
}

export class MinimapV2 extends EnhancedUIComponent {
  private minimapConfig: MinimapConfig;
  private background: Phaser.GameObjects.Graphics | null = null;
  private mapGraphics: Phaser.GameObjects.Graphics | null = null;
  private viewportRect: Phaser.GameObjects.Graphics | null = null;
  private minimapScaleX: number;
  private minimapScaleY: number;

  private getAgentSprites: () => Map<string, unknown>;
  private getTaskZones: () => Map<string, unknown>;
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

  private clickPings: ClickPing[] = [];
  private hoverCoordText: Phaser.GameObjects.Text | null = null;
  private viewportDashOffset: number = 0;
  private viewportDashTween: Phaser.Tweens.Tween | null = null;

  private backgroundColor: ReactiveToken<string>;
  private borderColor: ReactiveToken<string>;
  private textPrimaryColor: ReactiveToken<string>;
  private successColor: ReactiveToken<string>;
  private infoColor: ReactiveToken<string>;
  private warningColor: ReactiveToken<string>;
  private accentColor: ReactiveToken<string>;
  private dangerColor: ReactiveToken<string>;
  private textMutedColor: ReactiveToken<string>;
  private primaryColor: ReactiveToken<string>;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    camera: Phaser.Cameras.Scene2D.Camera,
    getAgentSprites: () => Map<string, unknown>,
    getTaskZones: () => Map<string, unknown>,
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
    this.dangerColor = this.useToken('colors.status.danger');
    this.textMutedColor = this.useToken('colors.text.muted');
    this.primaryColor = this.useToken('colors.accent');

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

    // 启动视口虚线动画
    if (!isReducedMotion()) {
      this.viewportDashTween = this.scene.tweens.add({
        targets: this,
        viewportDashOffset: 8,
        duration: 1200,
        ease: 'Linear',
        repeat: -1,
      });
    }

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
    const primaryColor = this.hexToNumber(this.primaryColor.get());

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

    this.hoverCoordText = this.scene.add.text(0, 0, '', {
      fontFamily: this.theme.typography.fontFamily.mono || this.theme.typography.fontFamily.sans,
      fontSize: '10px',
      color: this.textPrimaryColor.get(),
      backgroundColor: '#000000aa',
      padding: { x: 3, y: 1 },
    });
    this.hoverCoordText.setOrigin(0, 1);
    this.hoverCoordText.setVisible(false);
    (this.container as Phaser.GameObjects.Container).add(this.hoverCoordText);
  }

  private setupInteraction(): void {
    const hitArea = new Phaser.Geom.Rectangle(0, 0, this.minimapConfig.width, this.minimapConfig.height);
    (this.container as Phaser.GameObjects.Container).setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);

    (this.container as Phaser.GameObjects.Container).on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.isDragging = true;
      this.addClickPing(pointer.x, pointer.y);
      this.updateDragHighlight(pointer.x, pointer.y);
      this.moveCameraToPosition(pointer.x, pointer.y);
    });

    (this.container as Phaser.GameObjects.Container).on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isDragging) {
        this.updateDragHighlight(pointer.x, pointer.y);
        this.moveCameraToPosition(pointer.x, pointer.y);
      } else {
        this.updateHoverHighlight(pointer.x, pointer.y);
        this.updateHoverCoord(pointer.x, pointer.y);
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
      this.hoverCoordText?.setVisible(false);
    });
  }

  private addClickPing(x: number, y: number): void {
    this.clickPings.push({
      x,
      y,
      startTime: this.scene.time.now,
    });
    // 清理过老的ping
    const now = this.scene.time.now;
    this.clickPings = this.clickPings.filter((p) => now - p.startTime < 900);
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

    zones.forEach((zone: unknown) => {
      const z = zone as { getBounds: () => { x: number; y: number; width: number; height: number } };
      const bounds = z.getBounds();
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

  private updateHoverCoord(localX: number, localY: number): void {
    if (!this.hoverCoordText) return;
    const worldX = Math.round(localX / this.minimapScaleX);
    const worldY = Math.round(localY / this.minimapScaleY);
    this.hoverCoordText.setText(`X:${worldX} Y:${worldY}`);
    this.hoverCoordText.setPosition(localX + 6, localY - 4);
    this.hoverCoordText.setVisible(true);
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
    this.drawClickPings();
    this.drawViewport();
  }

  private drawZones(): void {
    const zones = this.getTaskZones();
    const selectedZoneIds = this.getSelectedZoneIds();

    zones.forEach((zone: unknown, zoneId: string) => {
      const z = zone as {
        getBounds: () => { x: number; y: number; width: number; height: number };
        getZoneStatus?: () => string;
      };
      const bounds = z.getBounds();
      const minX = bounds.x * this.minimapScaleX;
      const minY = bounds.y * this.minimapScaleY;
      const width = bounds.width * this.minimapScaleX;
      const height = bounds.height * this.minimapScaleY;

      const isSelected = selectedZoneIds.has(zoneId);

      // Status-colored fill
      const status = z.getZoneStatus?.() || 'idle';
      let statusColorHex: string;
      let fillAlpha: number;
      switch (status) {
        case 'idle':
          statusColorHex = this.textMutedColor.get();
          fillAlpha = 0.15;
          break;
        case 'active':
        case 'completed':
          statusColorHex = this.successColor.get();
          fillAlpha = 0.25;
          break;
        case 'busy':
          statusColorHex = this.warningColor.get();
          fillAlpha = 0.25;
          break;
        case 'error':
          statusColorHex = this.dangerColor.get();
          fillAlpha = 0.25;
          break;
        default:
          statusColorHex = this.infoColor.get();
          fillAlpha = 0.15;
      }

      const statusColor = this.hexToNumber(statusColorHex);
      const drawColor = isSelected ? this.hexToNumber(this.successColor.get()) : statusColor;
      const drawAlpha = isSelected ? 0.35 : fillAlpha;

      this.mapGraphics?.fillStyle(drawColor, drawAlpha);
      this.mapGraphics?.fillRect(minX, minY, width, height);

      this.mapGraphics?.lineStyle(isSelected ? 2 : 1, drawColor, 0.9);
      this.mapGraphics?.strokeRect(minX, minY, width, height);
    });
  }

  private drawAgents(): void {
    const agents = this.getAgentSprites();
    const now = this.scene.time.now;

    agents.forEach((sprite: unknown) => {
      const s = sprite as {
        x: number;
        y: number;
        getCurrentStatus?: () => string;
        getStatus?: () => string;
      };
      const status = s.getCurrentStatus?.() || s.getStatus?.() || 'online';

      let colorHex: string;
      switch (status) {
        case 'online':
          colorHex = this.successColor.get();
          break;
        case 'busy':
          colorHex = this.warningColor.get();
          break;
        case 'error':
          colorHex = this.dangerColor.get();
          break;
        case 'offline':
        default:
          colorHex = this.textMutedColor.get();
          break;
      }
      const color = this.hexToNumber(colorHex);

      const minimapX = s.x * this.minimapScaleX;
      const minimapY = s.y * this.minimapScaleY;

      // Breathing alpha effect
      let alpha = 1;
      if (!isReducedMotion()) {
        alpha = 0.7 + Math.sin(now * 0.003 + s.x * 0.01) * 0.3;
      }

      // Glow dot
      this.mapGraphics?.fillStyle(color, alpha * 0.3);
      this.mapGraphics?.fillCircle(minimapX, minimapY, 4);

      // Core dot
      this.mapGraphics?.fillStyle(color, alpha);
      this.mapGraphics?.fillCircle(minimapX, minimapY, 2);
    });
  }

  private drawPings(): void {
    const agents = this.getAgentSprites();
    const currentTime = this.scene.time.now;
    const pingInterval = 2000;
    const maxRadius = 8;

    agents.forEach((sprite: unknown, agentId: string) => {
      const s = sprite as {
        x: number;
        y: number;
        getStatus?: () => string;
        getCurrentStatus?: () => string;
      };
      const status = s.getStatus?.() || s.getCurrentStatus?.();
      if (status !== 'busy') {
        this.agentLastPingTime.delete(agentId);
        return;
      }

      const minimapX = s.x * this.minimapScaleX;
      const minimapY = s.y * this.minimapScaleY;

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

  private drawClickPings(): void {
    const now = this.scene.time.now;
    const duration = 800;
    const accentColor = this.hexToNumber(this.accentColor.get());

    this.clickPings = this.clickPings.filter((p) => now - p.startTime < duration);

    this.clickPings.forEach((ping) => {
      const elapsed = now - ping.startTime;
      const progress = elapsed / duration;
      const radius = progress * 24;
      const alpha = 1 - progress;

      if (alpha > 0) {
        this.pingGraphics?.lineStyle(1, accentColor, alpha * 0.8);
        this.pingGraphics?.strokeCircle(ping.x, ping.y, radius);
        this.pingGraphics?.lineStyle(1, accentColor, alpha * 0.25);
        this.pingGraphics?.strokeCircle(ping.x, ping.y, radius + 4);
      }
    });
  }

  private drawDashedLine(
    graphics: Phaser.GameObjects.Graphics,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    dashLen: number,
    gapLen: number,
    offset: number
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const ux = dx / len;
    const uy = dy / len;

    let currentPos = -offset;
    let drawing = currentPos >= 0;
    if (currentPos < 0) currentPos = 0;

    while (currentPos < len) {
      const segmentLen = drawing ? dashLen : gapLen;
      const start = currentPos;
      const end = Math.min(len, currentPos + segmentLen);

      if (drawing && end > start) {
        graphics.lineBetween(
          x1 + ux * start,
          y1 + uy * start,
          x1 + ux * end,
          y1 + uy * end
        );
      }

      currentPos += segmentLen;
      drawing = !drawing;
    }
  }

  private drawDashedRect(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    dashLen: number,
    gapLen: number,
    offset: number
  ): void {
    this.drawDashedLine(graphics, x, y, x + w, y, dashLen, gapLen, offset);
    this.drawDashedLine(graphics, x + w, y, x + w, y + h, dashLen, gapLen, offset);
    this.drawDashedLine(graphics, x + w, y + h, x, y + h, dashLen, gapLen, offset);
    this.drawDashedLine(graphics, x, y + h, x, y, dashLen, gapLen, offset);
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

    // Dynamic dashed border with primary color accent
    const primaryColor = this.hexToNumber(this.primaryColor.get());
    this.viewportRect?.lineStyle(1, primaryColor, 0.85);
    this.drawDashedRect(
      this.viewportRect!,
      viewportX,
      viewportY,
      viewportWidth,
      viewportHeight,
      5,
      3,
      this.viewportDashOffset
    );

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

    if (this.viewportDashTween) {
      this.viewportDashTween.stop();
      this.viewportDashTween = null;
    }

    this.background?.destroy();
    this.mapGraphics?.destroy();
    this.viewportRect?.destroy();
    this.hoverHighlight?.destroy();
    this.dragHighlight?.destroy();
    this.pingGraphics?.destroy();
    this.hoverCoordText?.destroy();
    super.destroy();
  }
}
