import Phaser from 'phaser';
import { rtsEventBus } from '../events/core/RTSEventBus';

export class ZoneDrawingUI {
  private scene: Phaser.Scene;
  private cursorIndicator: Phaser.GameObjects.Graphics;
  private tooltipText: Phaser.GameObjects.Text | null = null;
  private isEnabled: boolean = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.cursorIndicator = scene.add.graphics();
    this.cursorIndicator.setDepth(10000);
    this.cursorIndicator.setVisible(false);

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isEnabled) {
        this.drawDrawingCursor(pointer.worldX, pointer.worldY);
      }
    });
  }

  enable(): void {
    this.isEnabled = true;
    this.cursorIndicator.setVisible(true);
  }

  disable(): void {
    this.isEnabled = false;
    this.cursorIndicator.setVisible(false);
  }

  private drawDrawingCursor(x: number, y: number): void {
    this.cursorIndicator.clear();
    this.cursorIndicator.setVisible(true);

    this.cursorIndicator.lineStyle(2, 0xff6600, 0.8);
    this.cursorIndicator.lineBetween(x - 20, y, x + 20, y);
    this.cursorIndicator.lineBetween(x, y - 20, x, y + 20);

    this.cursorIndicator.strokeCircle(x, y, 10);

    this.cursorIndicator.fillStyle(0xff6600, 0.3);
    this.cursorIndicator.fillCircle(x, y, 3);
  }

  showTooltip(x: number, y: number, message: string): void {
    if (this.tooltipText) {
      this.tooltipText.destroy();
    }

    this.tooltipText = this.scene.add.text(x, y - 30, message, {
      fontSize: '12px',
      color: '#ffffff',
      backgroundColor: '#333333',
      padding: { x: 8, y: 4 },
    });
    this.tooltipText.setDepth(10001);
    this.tooltipText.setOrigin(0.5, 1);
  }

  hideTooltip(): void {
    if (this.tooltipText) {
      this.tooltipText.destroy();
      this.tooltipText = null;
    }
  }

  destroy(): void {
    this.cursorIndicator.destroy();
    if (this.tooltipText) {
      this.tooltipText.destroy();
    }
    this.scene.input.off('pointermove');
  }
}