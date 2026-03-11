/**
 * SelectBox - 迁移版本
 * 使用设计系统 Token
 */

import Phaser from 'phaser';
import { getCurrentTheme } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';

export interface SelectBoxConfig {
  lineWidth: number;
  minSize: number;
}

const DEFAULT_CONFIG: SelectBoxConfig = {
  lineWidth: 2,
  minSize: 10
};

export class SelectBox {
  private scene: Phaser.Scene;
  private graphics: Phaser.GameObjects.Graphics;
  private config: SelectBoxConfig;
  private startPoint: { x: number; y: number } | null = null;
  private isActive: boolean = false;

  constructor(scene: Phaser.Scene, config?: Partial<SelectBoxConfig>) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(Depth.UI_ZONE_HANDLES);
  }

  public start(x: number, y: number): void {
    this.startPoint = { x, y };
    this.isActive = true;
    this.graphics.clear();
  }

  public update(x: number, y: number): void {
    if (!this.isActive || !this.startPoint) return;

    this.graphics.clear();

    const rect = this.getRectangle(x, y);
    const successColor = getToken('colors.status.success') || '#00ff88';
    const lineColor = parseInt(successColor.slice(1), 16);
    const fillColor = parseInt(successColor.slice(1), 16);

    this.graphics.fillStyle(fillColor, 0.2);
    this.graphics.fillRect(rect.x, rect.y, rect.width, rect.height);

    this.graphics.lineStyle(this.config.lineWidth, lineColor, 1);
    this.graphics.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }

  public end(): Phaser.Geom.Rectangle | null {
    if (!this.isActive || !this.startPoint) {
      return null;
    }

    const pointer = this.scene.input.activePointer;
    const rect = this.getRectangle(pointer.worldX, pointer.worldY);

    this.graphics.clear();
    this.isActive = false;
    this.startPoint = null;

    if (rect.width >= this.config.minSize && rect.height >= this.config.minSize) {
      return rect;
    }

    return null;
  }

  public getCurrentBounds(): Phaser.Geom.Rectangle | null {
    if (!this.isActive || !this.startPoint) return null;
    const pointer = this.scene.input.activePointer;
    return this.getRectangle(pointer.worldX, pointer.worldY);
  }

  private getRectangle(endX: number, endY: number): Phaser.Geom.Rectangle {
    if (!this.startPoint) {
      return new Phaser.Geom.Rectangle(0, 0, 0, 0);
    }

    const x = Math.min(this.startPoint.x, endX);
    const y = Math.min(this.startPoint.y, endY);
    
    const width = Math.abs(endX - this.startPoint.x);
    const height = Math.abs(endY - this.startPoint.y);

    return new Phaser.Geom.Rectangle(x, y, width, height);
  }

  public containsSprite(sprite: Phaser.GameObjects.Container): boolean {
    const bounds = this.getCurrentBounds();
    if (!bounds) return false;
    return Phaser.Geom.Rectangle.Contains(bounds, sprite.x, sprite.y);
  }

  public getSpritesInBounds(sprites: Iterable<Phaser.GameObjects.Container>): Phaser.GameObjects.Container[] {
    const bounds = this.getCurrentBounds();
    if (!bounds) return [];
    
    const result: Phaser.GameObjects.Container[] = [];
    for (const sprite of sprites) {
      if (Phaser.Geom.Rectangle.Contains(bounds, sprite.x, sprite.y)) {
        result.push(sprite);
      }
    }
    return result;
  }

  public destroy(): void {
    this.graphics.destroy();
  }
}
