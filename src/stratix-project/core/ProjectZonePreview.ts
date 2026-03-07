import Phaser from 'phaser';

export interface ProjectZonePreviewConfig {
  lineColor: number;
  fillColor: number;
  lineWidth: number;
  fillAlpha: number;
  postSpacing: number;
  postRadius: number;
  overlapColor: number;
  overlapFillAlpha: number;
}

const DEFAULT_CONFIG: ProjectZonePreviewConfig = {
  lineColor: 0x00aaff,
  fillColor: 0x00aaff,
  lineWidth: 4,
  fillAlpha: 0.2,
  postSpacing: 20,
  postRadius: 2,
  overlapColor: 0xff0000,
  overlapFillAlpha: 0.3
};

export class ProjectZonePreview {
  private scene: Phaser.Scene;
  private graphics: Phaser.GameObjects.Graphics;
  private config: ProjectZonePreviewConfig;
  private startPoint: { x: number; y: number } | null = null;
  private isActive: boolean = false;
  private checkOverlapCallback: ((rect: Phaser.Geom.Rectangle) => boolean) | null = null;
  private currentOverlap: boolean = false;

  constructor(scene: Phaser.Scene, config?: Partial<ProjectZonePreviewConfig>) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(999);
  }

  public start(x: number, y: number): void {
    this.startPoint = { x, y };
    this.isActive = true;
    this.currentOverlap = false;
    this.graphics.clear();
  }

  public setOverlapCheck(callback: (rect: Phaser.Geom.Rectangle, excludeZoneId?: string) => boolean): void {
    this.checkOverlapCallback = callback;
  }

  public update(x: number, y: number): void {
    if (!this.isActive || !this.startPoint) return;

    this.graphics.clear();

    const rect = this.getRectangle(x, y);

    this.currentOverlap = this.checkOverlapCallback ? this.checkOverlapCallback(rect) : false;

    const lineColor = this.currentOverlap ? this.config.overlapColor : this.config.lineColor;
    const fillColor = this.currentOverlap ? this.config.overlapColor : this.config.fillColor;
    const fillAlpha = this.currentOverlap ? this.config.overlapFillAlpha : this.config.fillAlpha;

    this.graphics.fillStyle(fillColor, fillAlpha);
    this.graphics.fillRect(rect.x, rect.y, rect.width, rect.height);

    this.graphics.lineStyle(this.config.lineWidth, lineColor, 1);
    this.graphics.strokeRect(rect.x, rect.y, rect.width, rect.height);

    this.drawFencePosts(rect, lineColor);
  }

  private drawFencePosts(rect: Phaser.Geom.Rectangle, color: number): void {
    const posts = this.calculatePostPositions(rect);
    
    this.graphics.fillStyle(color, 0.8);
    posts.forEach(pos => {
      this.graphics.fillCircle(pos.x, pos.y, this.config.postRadius);
    });
  }

  private calculatePostPositions(rect: Phaser.Geom.Rectangle): { x: number; y: number }[] {
    const posts: { x: number; y: number }[] = [];
    
    const sides = [
      { startX: rect.x, startY: rect.y, endX: rect.x + rect.width, endY: rect.y },
      { startX: rect.x + rect.width, startY: rect.y, endX: rect.x + rect.width, endY: rect.y + rect.height },
      { startX: rect.x + rect.width, startY: rect.y + rect.height, endX: rect.x, endY: rect.y + rect.height },
      { startX: rect.x, startY: rect.y + rect.height, endX: rect.x, endY: rect.y }
    ];

    sides.forEach(side => {
      const dx = side.endX - side.startX;
      const dy = side.endY - side.startY;
      const length = Math.sqrt(dx * dx + dy * dy);
      const steps = Math.floor(length / this.config.postSpacing);

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        posts.push({
          x: side.startX + dx * t,
          y: side.startY + dy * t
        });
      }
    });

    return posts;
  }

  public cancel(): void {
    this.graphics.clear();
    this.isActive = false;
    this.startPoint = null;
    this.currentOverlap = false;
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
    this.currentOverlap = false;

    if (rect.width >= 100 && rect.height >= 100) {
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

  public isPreviewActive(): boolean {
    return this.isActive;
  }

  public isOverlapping(): boolean {
    return this.currentOverlap;
  }

  public destroy(): void {
    this.graphics.destroy();
  }
}
