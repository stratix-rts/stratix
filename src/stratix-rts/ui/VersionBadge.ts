/**
 * VersionBadge - Displays build version info in bottom-right corner
 */

import Phaser from 'phaser';

export const VERSION = '0.1.0';
export const BUILD_TIMESTAMP = new Date().toISOString();

export class VersionBadge {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container | null = null;
  private text: Phaser.GameObjects.Text | null = null;
  private hitArea: Phaser.GameObjects.Rectangle | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  create(): VersionBadge {
    const width = this.scene.cameras.main.width;
    const height = this.scene.cameras.main.height;

    const label = `Stratix v${VERSION} | ${BUILD_TIMESTAMP}`;

    this.text = this.scene.add.text(0, 0, label, {
      fontSize: '11px',
      color: '#ffffff',
    });
    this.text.setAlpha(0.4);
    this.text.setOrigin(1, 1);
    this.text.setScrollFactor(0, 0);
    this.text.setDepth(9999);

    const textBounds = this.text.getBounds();
    const padding = 8;
    const badgeWidth = textBounds.width + padding * 2;
    const badgeHeight = textBounds.height + padding;

    this.hitArea = this.scene.add.rectangle(
      width - badgeWidth / 2,
      height - badgeHeight / 2,
      badgeWidth,
      badgeHeight,
      0x000000,
      0
    );
    this.hitArea.setOrigin(0.5, 0.5);
    this.hitArea.setScrollFactor(0, 0);
    this.hitArea.setDepth(9998);
    this.hitArea.setInteractive({ useHandCursor: true });

    this.hitArea.on('pointerover', () => {
      this.text?.setAlpha(0.8);
    });

    this.hitArea.on('pointerout', () => {
      this.text?.setAlpha(0.4);
    });

    return this;
  }

  destroy(): void {
    this.text?.destroy();
    this.hitArea?.destroy();
    this.container?.destroy();
  }
}
