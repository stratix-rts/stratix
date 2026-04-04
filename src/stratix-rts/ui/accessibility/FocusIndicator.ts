import Phaser from 'phaser';

export interface FocusIndicatorConfig {
  color?: number;
  alpha?: number;
  thickness?: number;
  padding?: number;
  animationDuration?: number;
  cornerRadius?: number;
  dashLength?: number;
  dashGap?: number;
  pulseEnabled?: boolean;
  pulseSpeed?: number;
}

export class FocusIndicator {
  private scene: Phaser.Scene;
  private graphics: Phaser.GameObjects.Graphics;
  private targetObject: Phaser.GameObjects.Container | null = null;
  private config: Required<FocusIndicatorConfig>;
  private visible = false;
  private pulseTime = 0;
  private dashOffset = 0;

  constructor(scene: Phaser.Scene, config: FocusIndicatorConfig = {}) {
    this.scene = scene;
    this.config = {
      color: config.color ?? 0x00ff88,
      alpha: config.alpha ?? 1,
      thickness: config.thickness ?? 3,
      padding: config.padding ?? 4,
      animationDuration: config.animationDuration ?? 200,
      cornerRadius: config.cornerRadius ?? 4,
      dashLength: config.dashLength ?? 8,
      dashGap: config.dashGap ?? 4,
      pulseEnabled: config.pulseEnabled ?? true,
      pulseSpeed: config.pulseSpeed ?? 0.05,
    };

    this.graphics = scene.add.graphics();
    this.graphics.setDepth(10000);
    this.graphics.setVisible(false);

    this.setupAnimation();
  }

  attach(target: Phaser.GameObjects.Container): void {
    this.targetObject = target;
    this.show();
  }

  detach(): void {
    this.targetObject = null;
    this.hide();
  }

  show(): void {
    if (!this.targetObject) return;

    this.visible = true;
    this.graphics.setVisible(true);
    this.update();
  }

  hide(): void {
    this.visible = false;
    this.graphics.setVisible(false);
    this.graphics.clear();
  }

  update(): void {
    if (!this.visible || !this.targetObject) return;

    const bounds = this.getBounds();
    if (!bounds) return;

    this.graphics.clear();

    const alpha = this.config.pulseEnabled
      ? this.config.alpha * (0.7 + 0.3 * Math.sin(this.pulseTime))
      : this.config.alpha;

    this.graphics.lineStyle(this.config.thickness, this.config.color, alpha);

    this.drawDashedRect(bounds);
  }

  setPosition(x: number, y: number): void {
    this.graphics.setPosition(x, y);
  }

  setColor(color: number): void {
    this.config.color = color;
    this.update();
  }

  setThickness(thickness: number): void {
    this.config.thickness = thickness;
    this.update();
  }

  getConfig(): Required<FocusIndicatorConfig> {
    return { ...this.config };
  }

  isVisible(): boolean {
    return this.visible;
  }

  getTarget(): Phaser.GameObjects.Container | null {
    return this.targetObject;
  }

  destroy(): void {
    this.removeAnimation();
    this.hide();
    this.graphics.destroy();
  }

  private getBounds(): { x: number; y: number; width: number; height: number } | null {
    if (!this.targetObject) return null;

    try {
      const padding = this.config.padding;
      return {
        x: this.targetObject.x - this.targetObject.width / 2 - padding,
        y: this.targetObject.y - this.targetObject.height / 2 - padding,
        width: this.targetObject.width + padding * 2,
        height: this.targetObject.height + padding * 2,
      };
    } catch {
      return null;
    }
  }

  private drawDashedRect(bounds: { x: number; y: number; width: number; height: number }): void {
    const { x, y, width, height } = bounds;
    const radius = this.config.cornerRadius;
    const dashLength = this.config.dashLength;
    const dashGap = this.config.dashGap;
    const totalLength = 2 * (width + height);
    const dashPattern = dashLength + dashGap;

    this.dashOffset = (this.dashOffset + 1) % dashPattern;

    const perimeter = [
      { x1: x + radius, y1: y, x2: x + width - radius, y2: y },
      { x1: x + width, y1: y + radius, x2: x + width, y2: y + height - radius },
      { x1: x + width - radius, y1: y + height, x2: x + radius, y2: y + height },
      { x1: x, y1: y + height - radius, x2: x, y2: y + radius },
    ];

    this.graphics.beginPath();

    this.graphics.moveTo(x + radius, y);
    this.graphics.lineTo(x + width - radius, y);
    this.graphics.moveTo(x + width, y + radius);
    this.graphics.lineTo(x + width, y + height - radius);
    this.graphics.moveTo(x + width - radius, y + height);
    this.graphics.lineTo(x + radius, y + height);
    this.graphics.moveTo(x, y + height - radius);
    this.graphics.lineTo(x, y + radius);

    const corners = [
      { x: x + radius, y, cx: x + radius, cy: y + radius, startAngle: Math.PI * 1.5 },
      { x: x + width - radius, y, cx: x + width - radius, cy: y + radius, startAngle: 0 },
      { x: x + width, y: y + radius, cx: x + width - radius, cy: y + radius, startAngle: 0 },
      { x: x + width, y: y + height - radius, cx: x + width - radius, cy: y + height - radius, startAngle: Math.PI / 2 },
      { x: x + width - radius, y: y + height, cx: x + width - radius, cy: y + height - radius, startAngle: Math.PI / 2 },
      { x: x + radius, y: y + height, cx: x + radius, cy: y + height - radius, startAngle: Math.PI },
      { x: x, y: y + height - radius, cx: x + radius, cy: y + height - radius, startAngle: Math.PI },
      { x: x, y: y + radius, cx: x + radius, cy: y + radius, startAngle: Math.PI * 1.5 },
    ];

    this.graphics.strokePath();

    this.graphics.strokeRoundedRect(x, y, width, height, radius);
  }

  private setupAnimation(): void {
    this.scene.events.on('update', this.onUpdate, this);
  }

  private removeAnimation(): void {
    this.scene.events.off('update', this.onUpdate, this);
  }

  private onUpdate(): void {
    if (!this.visible) return;

    this.pulseTime += this.config.pulseSpeed;
    this.update();
  }
}