import Phaser from 'phaser';

import { getToken } from '@/design-system/config';

import { getDSColor, isReducedMotion, drawGlowRing } from '../themes/ThemeColors';

// 辅助函数：将十六进制颜色字符串转换为 Phaser 数字格式
const hexToNumber = (hex: string): number => {
  if (!hex || !hex.startsWith('#')) return 0x888888;
  const parsed = parseInt(hex.slice(1), 16);
  return Number.isNaN(parsed) ? 0x888888 : parsed;
};

export type ZoneStatus = 'idle' | 'active' | 'busy' | 'error' | 'completed' | 'pending' | 'paused' | 'failed';

export interface BaseZoneConfig {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CornerPosition = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';

const BASE_ZONE_COLORS = {
  fence: hexToNumber(getToken("colors.text.muted")),
  fill: hexToNumber(getToken("colors.text.muted")),
  corner: hexToNumber(getToken("colors.status.warning")),
  selected: hexToNumber(getToken("colors.status.success")),
  warning: hexToNumber(getToken("colors.status.danger")),
  handle: hexToNumber(getToken("colors.status.warning")),
  status: {
    idle: hexToNumber(getToken("colors.text.muted")),
    pending: hexToNumber(getToken("colors.text.muted")),
    active: hexToNumber(getToken("colors.status.success")),
    busy: hexToNumber(getToken("colors.status.warning")),
    error: hexToNumber(getToken("colors.status.danger")),
    completed: hexToNumber(getToken("colors.status.success")),
    paused: hexToNumber(getToken("colors.status.warning")),
    failed: hexToNumber(getToken("colors.status.danger"))
  }
};

export abstract class BaseZone extends Phaser.GameObjects.Container {
  protected zoneId: string;
  protected zoneName: string;
  protected zoneStatus: ZoneStatus = 'idle';
  protected zoneWidth: number;
  protected zoneHeight: number;

  protected graphics: Phaser.GameObjects.Graphics;
  protected fillGraphics: Phaser.GameObjects.Graphics;
  protected shadowGraphics: Phaser.GameObjects.Graphics;
  protected glowGraphics: Phaser.GameObjects.Graphics;
  protected selectionGraphics: Phaser.GameObjects.Graphics;
  protected spawnWaveGraphics: Phaser.GameObjects.Graphics;
  protected cornerHandles: Map<CornerPosition, Phaser.GameObjects.Arc> = new Map();
  protected fencePosts: Phaser.GameObjects.Arc[] = [];

  protected isDragging: boolean = false;
  protected isResizing: boolean = false;
  protected isSelected: boolean = false;
  protected isWarning: boolean = false;
  protected isDragEnabled: boolean = true;
  protected isNearBoundary: boolean = false;
  protected boundaryEdge: 'left' | 'right' | 'top' | 'bottom' | null = null;

  protected resizingCorner: CornerPosition | null = null;
  protected dragOffset: { x: number; y: number } = { x: 0, y: 0 };
  protected dragStartPos: { x: number; y: number } | null = null;
  protected resizeStartState: {
    zoneX: number;
    zoneY: number;
    zoneWidth: number;
    zoneHeight: number;
    pointerX: number;
    pointerY: number;
  } | null = null;

  private dragTween: Phaser.Tweens.Tween | null = null;
  private statusGlowTween: Phaser.Tweens.Tween | null = null;
  private marchingAntsTween: Phaser.Tweens.Tween | null = null;
  private cornerBracketTween: Phaser.Tweens.Tween | null = null;
  private spawnWaveTween: Phaser.Tweens.Tween | null = null;
  private dragPulseTween: Phaser.Tweens.Tween | null = null;
  private statusColorTween: Phaser.Tweens.Tween | null = null;

  private currentStatusColor: number = BASE_ZONE_COLORS.status.idle;
  private targetStatusColor: number = BASE_ZONE_COLORS.status.idle;
  private marchingAntsOffset: number = 0;
  private bracketAlpha: number = 0.8;
  private bracketScale: number = 1;

  constructor(scene: Phaser.Scene, config: BaseZoneConfig) {
    super(scene, config.x, config.y);

    this.zoneId = config.id;
    this.zoneName = config.name || `Zone-${config.id.slice(0, 4)}`;
    this.zoneWidth = config.width;
    this.zoneHeight = config.height;
    this.currentStatusColor = BASE_ZONE_COLORS.status.idle;
    this.targetStatusColor = this.currentStatusColor;

    this.fillGraphics = scene.add.graphics();
    this.add(this.fillGraphics);

    this.graphics = scene.add.graphics();
    this.add(this.graphics);

    this.shadowGraphics = scene.add.graphics();
    this.shadowGraphics.setDepth(998);
    this.add(this.shadowGraphics);

    this.glowGraphics = scene.add.graphics();
    this.glowGraphics.setDepth(-1);
    this.add(this.glowGraphics);

    this.selectionGraphics = scene.add.graphics();
    this.selectionGraphics.setDepth(1000);
    this.add(this.selectionGraphics);

    this.spawnWaveGraphics = scene.add.graphics();
    this.spawnWaveGraphics.setDepth(1001);
    this.add(this.spawnWaveGraphics);

    this.createBaseVisuals();

    this.setSize(this.zoneWidth, this.zoneHeight);
    this.setInteractive();
    this.setData('zoneId', this.zoneId);
    this.setData('isBaseZone', true);

    this.playSpawnEffect();
  }

  protected isPointOnCornerHandle(localX: number, localY: number): boolean {
    for (const handle of this.cornerHandles.values()) {
      const handleX = handle.x;
      const handleY = handle.y;
      const distance = Math.sqrt((localX - handleX) ** 2 + (localY - handleY) ** 2);
      if (distance < 20) return true;
    }
    return false;
  }

  protected createBaseVisuals(): void {
    this.createFence();
    this.drawFill();
    this.createCornerHandles();
  }

  protected createFence(): void {
    const postSpacing = 20;
    const postRadius = 2;
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;

    this.graphics.lineStyle(3, BASE_ZONE_COLORS.fence, 0.9);
    this.graphics.strokeRect(-halfW, -halfH, this.zoneWidth, this.zoneHeight);

    const sides = [
      { start: { x: -halfW, y: -halfH }, end: { x: halfW, y: -halfH } },
      { start: { x: halfW, y: -halfH }, end: { x: halfW, y: halfH } },
      { start: { x: halfW, y: halfH }, end: { x: -halfW, y: halfH } },
      { start: { x: -halfW, y: halfH }, end: { x: -halfW, y: -halfH } }
    ];

    sides.forEach(side => {
      const dx = side.end.x - side.start.x;
      const dy = side.end.y - side.start.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const steps = Math.floor(length / postSpacing);

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = side.start.x + dx * t;
        const py = side.start.y + dy * t;

        const post = this.scene.add.arc(px, py, postRadius, 0, 360, false, BASE_ZONE_COLORS.fence);
        post.setAlpha(0.8);
        this.add(post);
        this.fencePosts.push(post);
      }
    });
  }

  protected drawFill(): void {
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;

    this.fillGraphics.clear();

    // Subtle gradient-like fill using multiple layers
    this.fillGraphics.fillStyle(this.currentStatusColor, 0.06);
    this.fillGraphics.fillRect(-halfW, -halfH, this.zoneWidth, this.zoneHeight);

    // Inner subtle pattern
    this.fillGraphics.lineStyle(1, this.currentStatusColor, 0.05);
    for (let i = -halfW; i < halfW; i += 10) {
      this.fillGraphics.lineBetween(i, -halfH, i, halfH);
    }
    for (let i = -halfH; i < halfH; i += 10) {
      this.fillGraphics.lineBetween(-halfW, i, halfW, i);
    }
  }

  protected createCornerHandles(): void {
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;

    const corners: { position: CornerPosition; x: number; y: number }[] = [
      { position: 'topLeft', x: -halfW, y: -halfH },
      { position: 'topRight', x: halfW, y: -halfH },
      { position: 'bottomRight', x: halfW, y: halfH },
      { position: 'bottomLeft', x: -halfW, y: halfH }
    ];

    corners.forEach(({ position, x, y }) => {
      const handle = this.scene.add.arc(x, y, 8, 0, 360, false, BASE_ZONE_COLORS.corner);
      handle.setAlpha(0.9);
      handle.setDepth(1001);
      handle.setInteractive(
        new Phaser.Geom.Circle(0, 0, 15),
        Phaser.Geom.Circle.Contains
      );
      handle.setData('isCornerHandle', true);
      handle.setData('cornerPosition', position);
      handle.setData('zoneId', this.zoneId);
      handle.setVisible(false);

      handle.on('pointerover', () => {
        if (this.isSelected) {
          const glowColor = getDSColor('color-primary');
          handle.setFillStyle(glowColor);
          handle.setRadius(12);
          // Glow effect
          if (!isReducedMotion()) {
            this.scene.tweens.add({
              targets: handle,
              scaleX: 1.2,
              scaleY: 1.2,
              duration: 150,
              ease: 'Sine.easeOut'
            });
          }
        }
      });

      handle.on('pointerout', () => {
        if (this.isSelected && !this.isResizing) {
          handle.setFillStyle(this.isWarning ? BASE_ZONE_COLORS.warning : BASE_ZONE_COLORS.corner);
          handle.setRadius(8);
          handle.setScale(1);
        }
      });

      this.add(handle);
      this.cornerHandles.set(position, handle);
    });
  }

  protected abstract updateVisuals(): void;

  protected redraw(): void {
    const color = this.isWarning
      ? BASE_ZONE_COLORS.warning
      : this.isSelected
        ? BASE_ZONE_COLORS.selected
        : BASE_ZONE_COLORS.fence;

    this.graphics.clear();
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;

    // Status glow behind border
    this.updateStatusGlow();

    this.graphics.lineStyle(this.isSelected ? 4 : 3, color, this.isSelected ? 1 : 0.9);
    this.graphics.strokeRect(-halfW, -halfH, this.zoneWidth, this.zoneHeight);

    if (this.isSelected) {
      this.graphics.fillStyle(color, this.isWarning ? 0.25 : 0.15);
      this.graphics.fillRect(-halfW, -halfH, this.zoneWidth, this.zoneHeight);
    }

    this.fencePosts.forEach(post => {
      post.setFillStyle(color);
    });

    this.cornerHandles.forEach((handle) => {
      handle.setVisible(this.isSelected);
      handle.setFillStyle(this.isWarning ? BASE_ZONE_COLORS.warning : BASE_ZONE_COLORS.corner);
      handle.setRadius(8);
      handle.setScale(1);
    });

    this.updateVisuals();
  }

  private updateStatusGlow(): void {
    if (this.statusGlowTween) return;
    this.glowGraphics.clear();
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;
    const alpha = this.isSelected ? 0.2 : 0.08;
    drawGlowRing(this.glowGraphics, 0, 0, Math.max(halfW, halfH) + 4, this.currentStatusColor, alpha, 2);
  }

  private startStatusGlowPulse(): void {
    if (!this.scene || this.statusGlowTween) return;
    if (isReducedMotion()) return;
    if (!this.isSelected) return;

    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;
    const maxR = Math.max(halfW, halfH) + 4;
    const glowData = { radius: maxR, alpha: 0.15 };

    this.statusGlowTween = this.scene.tweens.add({
      targets: glowData,
      radius: maxR + 6,
      alpha: 0.3,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.glowGraphics.clear();
        drawGlowRing(this.glowGraphics, 0, 0, glowData.radius, this.currentStatusColor, glowData.alpha, 2);
      }
    });
  }

  private stopStatusGlowPulse(): void {
    if (this.statusGlowTween) {
      this.statusGlowTween.stop();
      this.statusGlowTween = null;
    }
    this.updateStatusGlow();
  }

  private interpolateColor(from: number, to: number, t: number): number {
    const r1 = (from >> 16) & 0xff;
    const g1 = (from >> 8) & 0xff;
    const b1 = from & 0xff;
    const r2 = (to >> 16) & 0xff;
    const g2 = (to >> 8) & 0xff;
    const b2 = to & 0xff;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return (r << 16) | (g << 8) | b;
  }

  private getPointOnPerimeter(t: number, halfW: number, halfH: number): { x: number; y: number } {
    const w = halfW * 2;
    const h = halfH * 2;
    const perimeter = 2 * (w + h);
    t = ((t % perimeter) + perimeter) % perimeter;

    if (t < w) {
      return { x: -halfW + t, y: -halfH };
    } else if (t < w + h) {
      return { x: halfW, y: -halfH + (t - w) };
    } else if (t < 2 * w + h) {
      return { x: halfW - (t - (w + h)), y: halfH };
    } else {
      return { x: -halfW, y: halfH - (t - (2 * w + h)) };
    }
  }

  private drawSelectionEffects(): void {
    this.selectionGraphics.clear();
    if (!this.isSelected) return;

    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;
    const color = this.isWarning ? BASE_ZONE_COLORS.warning : BASE_ZONE_COLORS.selected;

    // Marching ants border
    const dashLen = 10;
    const gapLen = 4;
    const w = this.zoneWidth;
    const h = this.zoneHeight;
    const perimeter = 2 * (w + h);
    const offset = this.marchingAntsOffset;

    this.selectionGraphics.lineStyle(2, color, 0.9);
    for (let t = offset; t < perimeter; t += dashLen + gapLen) {
      const startT = t;
      const endT = Math.min(t + dashLen, perimeter);
      const p1 = this.getPointOnPerimeter(startT, halfW, halfH);
      const p2 = this.getPointOnPerimeter(endT, halfW, halfH);
      this.selectionGraphics.lineBetween(p1.x, p1.y, p2.x, p2.y);
    }

    // Glowing corner brackets
    const len = 14 * this.bracketScale;
    const corners = [
      { x: -halfW, y: -halfH, dx: 1, dy: 1 },
      { x: halfW, y: -halfH, dx: -1, dy: 1 },
      { x: halfW, y: halfH, dx: -1, dy: -1 },
      { x: -halfW, y: halfH, dx: 1, dy: -1 }
    ];

    // Bracket glow (outer)
    this.selectionGraphics.lineStyle(4, color, this.bracketAlpha * 0.35);
    corners.forEach(c => {
      this.selectionGraphics.lineBetween(c.x, c.y, c.x + len * c.dx, c.y);
      this.selectionGraphics.lineBetween(c.x, c.y, c.x, c.y + len * c.dy);
    });

    // Bracket main
    this.selectionGraphics.lineStyle(2, color, this.bracketAlpha);
    corners.forEach(c => {
      this.selectionGraphics.lineBetween(c.x, c.y, c.x + len * c.dx, c.y);
      this.selectionGraphics.lineBetween(c.x, c.y, c.x, c.y + len * c.dy);
    });
  }

  private startMarchingAnts(): void {
    if (!this.scene || this.marchingAntsTween || isReducedMotion()) return;

    const offsetData = { offset: 0 };
    const duration = this.isDragging ? 400 : 800;

    this.marchingAntsTween = this.scene.tweens.add({
      targets: offsetData,
      offset: 14,
      duration,
      repeat: -1,
      ease: 'Linear',
      onUpdate: () => {
        this.marchingAntsOffset = offsetData.offset;
        this.drawSelectionEffects();
      }
    });
  }

  private stopMarchingAnts(): void {
    if (this.marchingAntsTween) {
      this.marchingAntsTween.stop();
      this.marchingAntsTween = null;
    }
    this.selectionGraphics.clear();
  }

  private updateMarchingAntsSpeed(): void {
    if (this.marchingAntsTween) {
      this.marchingAntsTween.timeScale = this.isDragging ? 2 : 1;
    }
  }

  private startCornerBracketPulse(): void {
    if (!this.scene || this.cornerBracketTween || isReducedMotion()) return;

    const pulseData = { alpha: 0.7, scale: 1 };
    this.cornerBracketTween = this.scene.tweens.add({
      targets: pulseData,
      alpha: 1,
      scale: 1.08,
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.bracketAlpha = pulseData.alpha;
        this.bracketScale = pulseData.scale;
      }
    });
  }

  private stopCornerBracketPulse(): void {
    if (this.cornerBracketTween) {
      this.cornerBracketTween.stop();
      this.cornerBracketTween = null;
    }
    this.bracketAlpha = 0.8;
    this.bracketScale = 1;
  }

  private startDragPulse(): void {
    if (!this.scene || this.dragPulseTween || isReducedMotion()) return;

    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;
    const maxR = Math.max(halfW, halfH) + 4;
    const pulseData = { radius: maxR, alpha: 0.25 };

    this.dragPulseTween = this.scene.tweens.add({
      targets: pulseData,
      radius: maxR + 12,
      alpha: 0.55,
      duration: 400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.glowGraphics.clear();
        drawGlowRing(this.glowGraphics, 0, 0, pulseData.radius, this.currentStatusColor, pulseData.alpha, 3);
      }
    });
  }

  private stopDragPulse(): void {
    if (this.dragPulseTween) {
      this.dragPulseTween.stop();
      this.dragPulseTween = null;
    }
    if (this.isSelected) {
      this.stopStatusGlowPulse();
      this.startStatusGlowPulse();
    } else {
      this.updateStatusGlow();
    }
  }

  public playSpawnEffect(): void {
    if (!this.scene || isReducedMotion()) return;

    const waveData = { scale: 0.1, alpha: 0.5, width: 2 };

    this.spawnWaveTween = this.scene.tweens.add({
      targets: waveData,
      scale: 1.4,
      alpha: 0,
      width: 8,
      duration: 600,
      ease: 'Sine.easeOut',
      onUpdate: () => {
        this.spawnWaveGraphics.clear();
        const color = this.zoneStatus === 'idle'
          ? BASE_ZONE_COLORS.selected
          : (BASE_ZONE_COLORS.status[this.zoneStatus] || BASE_ZONE_COLORS.selected);
        this.spawnWaveGraphics.lineStyle(waveData.width, color, waveData.alpha);
        const rectW = this.zoneWidth * waveData.scale;
        const rectH = this.zoneHeight * waveData.scale;
        this.spawnWaveGraphics.strokeRect(-rectW / 2, -rectH / 2, rectW, rectH);
      },
      onComplete: () => {
        this.spawnWaveGraphics.clear();
        this.spawnWaveTween = null;
      }
    });
  }

  public setZoneName(name: string): void {
    this.zoneName = name;
    this.updateVisuals();
  }

  public getZoneId(): string {
    return this.zoneId;
  }

  public getZoneName(): string {
    return this.zoneName;
  }

  public setZoneStatus(status: ZoneStatus): void {
    const oldColor = this.currentStatusColor;
    this.zoneStatus = status;
    this.targetStatusColor = BASE_ZONE_COLORS.status[status] || BASE_ZONE_COLORS.fill;

    if (this.statusColorTween) {
      this.statusColorTween.stop();
      this.statusColorTween = null;
    }

    if (!this.scene || isReducedMotion()) {
      this.currentStatusColor = this.targetStatusColor;
      this.drawFill();
      this.updateVisuals();
      if (this.isSelected) {
        this.stopStatusGlowPulse();
        this.startStatusGlowPulse();
      }
      return;
    }

    const colorData = { t: 0 };
    this.statusColorTween = this.scene.tweens.add({
      targets: colorData,
      t: 1,
      duration: 300,
      ease: 'Linear',
      onUpdate: () => {
        this.currentStatusColor = this.interpolateColor(oldColor, this.targetStatusColor, colorData.t);
        this.drawFill();
        if (this.isSelected && !this.dragPulseTween && !this.statusGlowTween) {
          this.updateStatusGlow();
        }
      },
      onComplete: () => {
        this.currentStatusColor = this.targetStatusColor;
        this.statusColorTween = null;
        this.drawFill();
        this.updateVisuals();
        if (this.isSelected && !this.dragPulseTween) {
          this.stopStatusGlowPulse();
          this.startStatusGlowPulse();
        }
      }
    });
  }

  public getZoneStatus(): ZoneStatus {
    return this.zoneStatus;
  }

  public setHighlight(selected: boolean): void {
    this.isSelected = selected;
    this.redraw();
    if (selected) {
      this.startStatusGlowPulse();
      this.startMarchingAnts();
      this.startCornerBracketPulse();
    } else {
      this.stopStatusGlowPulse();
      this.stopMarchingAnts();
      this.stopCornerBracketPulse();
      this.stopDragPulse();
    }
  }

  public setWarning(warning: boolean): void {
    this.isWarning = warning;
    this.redraw();
  }

  public getBounds(): Phaser.Geom.Rectangle {
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;
    return new Phaser.Geom.Rectangle(
      this.x - halfW,
      this.y - halfH,
      this.zoneWidth,
      this.zoneHeight
    );
  }

  public containsPoint(worldX: number, worldY: number): boolean {
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;
    return (
      worldX >= this.x - halfW &&
      worldX <= this.x + halfW &&
      worldY >= this.y - halfH &&
      worldY <= this.y + halfH
    );
  }

  public overlapsRect(rect: Phaser.Geom.Rectangle): boolean {
    const bounds = this.getBounds();
    return Phaser.Geom.Rectangle.Overlaps(bounds, rect);
  }

  public overlapsZone(other: BaseZone): boolean {
    const bounds1 = this.getBounds();
    const bounds2 = other.getBounds();
    return Phaser.Geom.Rectangle.Overlaps(bounds1, bounds2);
  }

  public startDrag(worldX: number, worldY: number): void {
    this.isDragging = true;
    this.dragOffset.x = this.x - worldX;
    this.dragOffset.y = this.y - worldY;
    this.applyDragVisual(true);
  }

  public updateDrag(worldX: number, worldY: number): void {
    if (!this.isDragging) return;
    this.x = worldX + this.dragOffset.x;
    this.y = worldY + this.dragOffset.y;
    this.updateDragShadow();
  }

  public endDrag(): void {
    this.isDragging = false;
    this.applyDragVisual(false);
  }

  private applyDragVisual(isDragging: boolean): void {
    if (isDragging) {
      this.setDepth(1500);
      this.fillGraphics.setAlpha(0.85);
      this.graphics.setAlpha(0.9);
      this.drawDragShadow();
      this.fencePosts.forEach(post => post.setAlpha(0.7));
      this.stopStatusGlowPulse();
      this.startDragPulse();
      this.updateMarchingAntsSpeed();
    } else {
      this.setDepth(1000);
      this.fillGraphics.setAlpha(1);
      this.graphics.setAlpha(1);
      this.clearDragShadow();
      this.fencePosts.forEach(post => post.setAlpha(0.8));
      this.stopDragPulse();
      this.updateMarchingAntsSpeed();
    }
  }

  private drawDragShadow(): void {
    this.shadowGraphics.clear();
    const halfW = this.zoneWidth / 2 + 8;
    const halfH = this.zoneHeight / 2 + 8;
    const offsetX = 6;
    const offsetY = 6;

    const shadowColor = hexToNumber(getToken('colors.background.sunken'));
    const shadowBorderColor = hexToNumber(getToken('colors.border.subtle'));
    this.shadowGraphics.fillStyle(shadowColor, 0.4);
    this.shadowGraphics.fillRoundedRect(-halfW + offsetX, -halfH + offsetY, this.zoneWidth, this.zoneHeight, 8);

    this.shadowGraphics.lineStyle(2, shadowBorderColor, 0.25);
    this.shadowGraphics.strokeRoundedRect(-halfW + offsetX, -halfH + offsetY, this.zoneWidth, this.zoneHeight, 8);

    // Outer glow on drag shadow
    const statusColor = this.currentStatusColor;
    drawGlowRing(this.shadowGraphics, offsetX * 0.5, offsetY * 0.5, Math.max(halfW, halfH) + 4, statusColor, 0.15, 2);
  }

  private clearDragShadow(): void {
    this.shadowGraphics.clear();
  }

  private updateDragShadow(): void {
    if (!this.isDragging) return;
    this.shadowGraphics.setPosition(this.x, this.y);
  }

  public setBoundaryWarning(nearBoundary: boolean, edge: 'left' | 'right' | 'top' | 'bottom' | null): void {
    this.isNearBoundary = nearBoundary;
    this.boundaryEdge = edge;
    if (nearBoundary && this.isDragging) {
      this.drawBoundaryIndicator();
    } else {
      this.clearBoundaryIndicator();
    }
  }

  private boundaryIndicatorGraphics: Phaser.GameObjects.Graphics | null = null;

  private drawBoundaryIndicator(): void {
    if (!this.boundaryIndicatorGraphics) {
      this.boundaryIndicatorGraphics = this.scene.add.graphics();
      this.boundaryIndicatorGraphics.setDepth(999);
      this.add(this.boundaryIndicatorGraphics);
    }

    this.boundaryIndicatorGraphics.clear();
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;

    const indicatorColor = getDSColor('status-success');
    const alpha = 0.5;

    if (this.boundaryEdge === 'left') {
      this.boundaryIndicatorGraphics.fillStyle(indicatorColor, alpha);
      this.boundaryIndicatorGraphics.fillRect(-halfW - 5, -halfH, 5, this.zoneHeight);
    } else if (this.boundaryEdge === 'right') {
      this.boundaryIndicatorGraphics.fillStyle(indicatorColor, alpha);
      this.boundaryIndicatorGraphics.fillRect(halfW, -halfH, 5, this.zoneHeight);
    } else if (this.boundaryEdge === 'top') {
      this.boundaryIndicatorGraphics.fillStyle(indicatorColor, alpha);
      this.boundaryIndicatorGraphics.fillRect(-halfW, -halfH - 5, this.zoneWidth, 5);
    } else if (this.boundaryEdge === 'bottom') {
      this.boundaryIndicatorGraphics.fillStyle(indicatorColor, alpha);
      this.boundaryIndicatorGraphics.fillRect(-halfW, halfH, this.zoneWidth, 5);
    }
  }

  private clearBoundaryIndicator(): void {
    if (this.boundaryIndicatorGraphics) {
      this.boundaryIndicatorGraphics.clear();
    }
  }

  public animateDrop(onComplete?: () => void): void {
    if (this.dragTween) {
      this.dragTween.stop();
    }

    this.dragTween = this.scene.tweens.add({
      targets: this,
      scaleX: { from: 1.05, to: 1 },
      scaleY: { from: 1.05, to: 1 },
      alpha: { from: 0.8, to: 1 },
      duration: 200,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.setScale(1);
        this.setAlpha(1);
        if (onComplete) onComplete();
      }
    });
  }

  public isZoneDragging(): boolean {
    return this.isDragging;
  }

  public startResize(corner: CornerPosition, worldX: number, worldY: number): void {
    this.isResizing = true;
    this.resizingCorner = corner;
    this.resizeStartState = {
      zoneX: this.x,
      zoneY: this.y,
      zoneWidth: this.zoneWidth,
      zoneHeight: this.zoneHeight,
      pointerX: worldX,
      pointerY: worldY
    };
  }

  public updateResize(worldX: number, worldY: number): void {
    if (!this.isResizing || !this.resizeStartState) return;

    const start = this.resizeStartState;
    const deltaX = worldX - start.pointerX;
    const deltaY = worldY - start.pointerY;

    const minSize = 40;
    let newWidth = start.zoneWidth;
    let newHeight = start.zoneHeight;
    let newCenterX = start.zoneX;
    let newCenterY = start.zoneY;

    const halfOldW = start.zoneWidth / 2;
    const halfOldH = start.zoneHeight / 2;

    const oldLeft = start.zoneX - halfOldW;
    const oldRight = start.zoneX + halfOldW;
    const oldTop = start.zoneY - halfOldH;
    const oldBottom = start.zoneY + halfOldH;

    switch (this.resizingCorner) {
      case 'topLeft':
        newWidth = Math.max(minSize, start.zoneWidth - deltaX);
        newHeight = Math.max(minSize, start.zoneHeight - deltaY);
        newCenterX = oldRight - newWidth / 2;
        newCenterY = oldBottom - newHeight / 2;
        break;
      case 'topRight':
        newWidth = Math.max(minSize, start.zoneWidth + deltaX);
        newHeight = Math.max(minSize, start.zoneHeight - deltaY);
        newCenterX = oldLeft + newWidth / 2;
        newCenterY = oldBottom - newHeight / 2;
        break;
      case 'bottomRight':
        newWidth = Math.max(minSize, start.zoneWidth + deltaX);
        newHeight = Math.max(minSize, start.zoneHeight + deltaY);
        newCenterX = oldLeft + newWidth / 2;
        newCenterY = oldTop + newHeight / 2;
        break;
      case 'bottomLeft':
        newWidth = Math.max(minSize, start.zoneWidth - deltaX);
        newHeight = Math.max(minSize, start.zoneHeight + deltaY);
        newCenterX = oldRight - newWidth / 2;
        newCenterY = oldTop + newHeight / 2;
        break;
    }

    this.x = newCenterX;
    this.y = newCenterY;
    this.applyNewSize(newWidth, newHeight);
  }

  protected applyNewSize(newWidth: number, newHeight: number): void {
    this.zoneWidth = newWidth;
    this.zoneHeight = newHeight;

    this.setSize(newWidth, newHeight);

    this.fencePosts.forEach(post => post.destroy());
    this.fencePosts = [];

    this.graphics.clear();
    this.fillGraphics.clear();

    this.createFence();
    this.drawFill();

    this.updateCornerHandlePositions();
    this.redraw();

    if (this.isSelected) {
      if (this.statusGlowTween) {
        this.stopStatusGlowPulse();
        this.startStatusGlowPulse();
      }
      if (this.marchingAntsTween) {
        this.drawSelectionEffects();
      }
    }
  }

  protected updateCornerHandlePositions(): void {
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;

    const positions: { position: CornerPosition; x: number; y: number }[] = [
      { position: 'topLeft', x: -halfW, y: -halfH },
      { position: 'topRight', x: halfW, y: -halfH },
      { position: 'bottomRight', x: halfW, y: halfH },
      { position: 'bottomLeft', x: -halfW, y: halfH }
    ];

    positions.forEach(({ position, x, y }) => {
      const handle = this.cornerHandles.get(position);
      if (handle) {
        handle.setPosition(x, y);
      }
    });
  }

  public endResize(): void {
    this.isResizing = false;
    this.resizingCorner = null;
    this.resizeStartState = null;

    this.cornerHandles.forEach(handle => {
      handle.setFillStyle(this.isWarning ? BASE_ZONE_COLORS.warning : BASE_ZONE_COLORS.corner);
      handle.setRadius(6);
    });
  }

  public isZoneResizing(): boolean {
    return this.isResizing;
  }

  public getResizingCorner(): CornerPosition | null {
    return this.resizingCorner;
  }

  public getCornerHandle(position: CornerPosition): Phaser.GameObjects.Arc | undefined {
    return this.cornerHandles.get(position);
  }

  public getAllCornerHandles(): Map<CornerPosition, Phaser.GameObjects.Arc> {
    return this.cornerHandles;
  }

  public resize(zoneWidth: number, zoneHeight: number): void {
    this.applyNewSize(zoneWidth, zoneHeight);
  }

  public isWarningState(): boolean {
    return this.isWarning;
  }

  public destroy(): void {
    this.stopStatusGlowPulse();
    this.stopMarchingAnts();
    this.stopCornerBracketPulse();
    this.stopDragPulse();
    if (this.statusColorTween) {
      this.statusColorTween.stop();
      this.statusColorTween = null;
    }
    if (this.spawnWaveTween) {
      this.spawnWaveTween.stop();
      this.spawnWaveTween = null;
    }
    this.fencePosts.forEach(post => post.destroy());
    this.fencePosts = [];
    this.cornerHandles.forEach(handle => handle.destroy());
    this.cornerHandles.clear();
    if (this.boundaryIndicatorGraphics) {
      this.boundaryIndicatorGraphics.destroy();
      this.boundaryIndicatorGraphics = null;
    }
    if (this.dragTween) {
      this.dragTween.stop();
      this.dragTween = null;
    }
    if (this.selectionGraphics) {
      this.selectionGraphics.destroy();
    }
    if (this.spawnWaveGraphics) {
      this.spawnWaveGraphics.destroy();
    }
    if (this.glowGraphics) {
      this.glowGraphics.destroy();
    }
    super.destroy();
  }
}
