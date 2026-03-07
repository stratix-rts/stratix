import Phaser from 'phaser';

export abstract class DebugRenderer {
  protected scene: Phaser.Scene;
  protected graphics: Phaser.GameObjects.Graphics;
  protected enabled: boolean = false;
  
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(10000);
    this.graphics.setVisible(false);
  }
  
  enable(): void {
    this.enabled = true;
    this.graphics.setVisible(true);
  }
  
  disable(): void {
    this.enabled = false;
    this.graphics.setVisible(false);
    this.graphics.clear();
  }
  
  toggle(): void {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }
  
  isEnabled(): boolean {
    return this.enabled;
  }
  
  protected clear(): void {
    this.graphics.clear();
  }
  
  abstract render(...args: any[]): void;
  
  destroy(): void {
    this.graphics.destroy();
  }
}
