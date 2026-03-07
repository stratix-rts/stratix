/**
 * MagicCircle - 魔法阵效果
 * 
 * 视觉效果：
 * - 外圈：青色发光环
 * - 内圈：粉色发光环
 * - 旋转动画 + 脉冲效果
 * - 符文装饰（可选）
 */

import Phaser from 'phaser';

export interface MagicCircleConfig {
  x: number;
  y: number;
  outerRadius?: number;
  innerRadius?: number;
  color1?: number;
  color2?: number;
}

export class MagicCircle {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private config: Required<MagicCircleConfig>;
  
  private outerRing: Phaser.GameObjects.Graphics;
  private innerRing: Phaser.GameObjects.Graphics;
  private runes: Phaser.GameObjects.Graphics;
  
  private rotationSpeed: number = 60;
  private pulsePhase: number = 0;
  private expandProgress: number = 0;
  private active: boolean = false;
  
  constructor(scene: Phaser.Scene, config: MagicCircleConfig) {
    this.scene = scene;
    this.config = {
      x: config.x,
      y: config.y,
      outerRadius: config.outerRadius ?? 80,
      innerRadius: config.innerRadius ?? 50,
      color1: config.color1 ?? 0x00ffff,
      color2: config.color2 ?? 0xff00ff
    };
    
    this.container = scene.add.container(this.config.x, this.config.y);
    this.container.setDepth(1000);
    
    this.outerRing = scene.add.graphics();
    this.innerRing = scene.add.graphics();
    this.runes = scene.add.graphics();
    
    this.container.add([this.outerRing, this.innerRing, this.runes]);
    
    this.draw();
  }
  
  private draw(): void {
    const { outerRadius, innerRadius, color1, color2 } = this.config;
    const scale = this.expandProgress;
    const pulse = 1 + Math.sin(this.pulsePhase) * 0.1;
    const actualRadius = outerRadius * scale * pulse;
    const actualInnerRadius = innerRadius * scale * pulse;
    
    this.outerRing.clear();
    this.innerRing.clear();
    this.runes.clear();
    
    if (this.expandProgress === 0) return;
    
    this.outerRing.lineStyle(3, color1, 0.8);
    this.outerRing.strokeCircle(0, 0, actualRadius);
    
    this.outerRing.lineStyle(1.5, color1, 0.4);
    this.outerRing.strokeCircle(0, 0, actualRadius * 0.9);
    
    const glowOuter = this.outerRing.scene.add.graphics();
    glowOuter.lineStyle(8, color1, 0.15);
    glowOuter.strokeCircle(0, 0, actualRadius);
    this.outerRing.destroy();
    this.outerRing = glowOuter;
    this.container.addAt(this.outerRing, 0);
    
    this.innerRing.lineStyle(3, color2, 0.8);
    this.innerRing.strokeCircle(0, 0, actualInnerRadius);
    
    this.innerRing.lineStyle(1.5, color2, 0.4);
    this.innerRing.strokeCircle(0, 0, actualInnerRadius * 1.1);
    
    const glowInner = this.innerRing.scene.add.graphics();
    glowInner.lineStyle(6, color2, 0.2);
    glowInner.strokeCircle(0, 0, actualInnerRadius);
    this.innerRing.destroy();
    this.innerRing = glowInner;
    this.container.addAt(this.innerRing, 1);
    
    this.drawRunes(actualRadius * 0.7);
  }
  
  private drawRunes(radius: number): void {
    const runeCount = 6;
    const runeLength = radius * 0.3;
    
    this.runes.lineStyle(2, this.config.color1, 0.5);
    
    for (let i = 0; i < runeCount; i++) {
      const angle = (i / runeCount) * Math.PI * 2 + this.container.rotation;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      
      this.runes.fillStyle(this.config.color1, 0.3);
      this.runes.fillTriangle(
        x, y - runeLength / 2,
        x - runeLength / 3, y + runeLength / 2,
        x + runeLength / 3, y + runeLength / 2
      );
    }
  }
  
  start(): void {
    console.log('[MagicCircle] 🚀 start() called');
    console.log('[MagicCircle] 📊 Initial state:', {
      active: this.active,
      expandProgress: this.expandProgress,
      position: { x: this.config.x, y: this.config.y }
    });
    
    this.active = true;
    this.expandProgress = 0;
    this.pulsePhase = 0;
    
    this.scene.tweens.add({
      targets: this,
      expandProgress: 1,
      duration: 500,
      ease: 'Power2',
      onUpdate: () => {
        this.draw();
      }
    });
  }
  
  update(delta: number): void {
    if (!this.active) return;
    
    const deltaSeconds = delta / 1000;
    this.container.rotation += (this.rotationSpeed * Math.PI / 180) * deltaSeconds;
    
    this.pulsePhase += deltaSeconds * 3;
    
    if (this.expandProgress >= 1) {
      this.draw();
    }
  }
  
  setExpandProgress(progress: number): void {
    this.expandProgress = Math.max(0, Math.min(1, progress));
    this.draw();
  }
  
  getPosition(): { x: number; y: number } {
    return { x: this.config.x, y: this.config.y };
  }
  
  destroy(): void {
    this.active = false;
    this.outerRing.destroy();
    this.innerRing.destroy();
    this.runes.destroy();
    this.container.destroy();
  }
}
