import Phaser from 'phaser';

import { getToken } from '@/design-system/config';

// 辅助函数：将十六进制颜色字符串转换为 Phaser 数字格式
const hexToNumber = (hex: string) => parseInt(hex.replace('#', ''), 16);

export type ZoneStatus = 'idle' | 'active' | 'busy' | 'error' | 'completed';

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
    active: hexToNumber(getToken("colors.status.success")),
    busy: hexToNumber(getToken("colors.status.warning")),
    error: hexToNumber(getToken("colors.status.danger")),
    completed: hexToNumber(getToken("colors.status.success"))
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

  constructor(scene: Phaser.Scene, config: BaseZoneConfig) {
    super(scene, config.x, config.y);

    this.zoneId = config.id;
    this.zoneName = config.name || `Zone-${config.id.slice(0, 4)}`;
    this.zoneWidth = config.width;
    this.zoneHeight = config.height;

    this.fillGraphics = scene.add.graphics();
    this.add(this.fillGraphics);

    this.graphics = scene.add.graphics();
    this.add(this.graphics);

    this.shadowGraphics = scene.add.graphics();
    this.shadowGraphics.setDepth(998);
    this.add(this.shadowGraphics);

    this.createBaseVisuals();

    this.setSize(this.zoneWidth, this.zoneHeight);
    this.setInteractive();
    this.setData('zoneId', this.zoneId);
    this.setData('isBaseZone', true);
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
    this.fillGraphics.fillStyle(BASE_ZONE_COLORS.fill, 0.1);
    this.fillGraphics.fillRect(-halfW, -halfH, this.zoneWidth, this.zoneHeight);

    this.fillGraphics.lineStyle(1, BASE_ZONE_COLORS.fill, 0.1);
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
          handle.setFillStyle(BASE_ZONE_COLORS.handle);
          handle.setRadius(10);
        }
      });

      handle.on('pointerout', () => {
        if (this.isSelected && !this.isResizing) {
          handle.setFillStyle(this.isWarning ? BASE_ZONE_COLORS.warning : BASE_ZONE_COLORS.corner);
          handle.setRadius(8);
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
    });

    this.updateVisuals();
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
    this.zoneStatus = status;
    this.updateVisuals();
  }

  public getZoneStatus(): ZoneStatus {
    return this.zoneStatus;
  }

  public setHighlight(selected: boolean): void {
    this.isSelected = selected;
    this.redraw();
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
    } else {
      this.setDepth(1000);
      this.fillGraphics.setAlpha(1);
      this.graphics.setAlpha(1);
      this.clearDragShadow();
      this.fencePosts.forEach(post => post.setAlpha(0.8));
    }
  }

  private drawDragShadow(): void {
    this.shadowGraphics.clear();
    const halfW = this.zoneWidth / 2 + 8;
    const halfH = this.zoneHeight / 2 + 8;
    const offsetX = 6;
    const offsetY = 6;

    this.shadowGraphics.fillStyle(0x000000, 0.3);
    this.shadowGraphics.fillRoundedRect(-halfW + offsetX, -halfH + offsetY, this.zoneWidth, this.zoneHeight, 8);

    this.shadowGraphics.lineStyle(2, 0xffffff, 0.15);
    this.shadowGraphics.strokeRoundedRect(-halfW + offsetX, -halfH + offsetY, this.zoneWidth, this.zoneHeight, 8);
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

    const indicatorColor = 0x00ff00;
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
    super.destroy();
  }
}
