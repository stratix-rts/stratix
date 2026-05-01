import Phaser from 'phaser';

import { isReducedMotion } from '../../../themes/ThemeColors';

import type { IStateRenderer } from './IStateRenderer';
import type { PanelData, RenderContext } from './types';

export class EmptyStateRenderer implements IStateRenderer {
  constructor(private context: RenderContext) {}

  render(container: Phaser.GameObjects.Container, _data: PanelData, contentWidth: number): Phaser.Tweens.Tween[] {
    const tweens: Phaser.Tweens.Tween[] = [];
    const { scene } = this.context;
    const contentHeight = this.context.getContentHeight();

    // Gradient background
    const emptyGradKey = this.context.getEmptyGradKey();
    if (emptyGradKey) {
      const gradBg = scene.add.image(0, 0, emptyGradKey);
      gradBg.setOrigin(0, 0);
      gradBg.setDisplaySize(contentWidth, contentHeight);
      gradBg.setAlpha(0.7);
      container.add(gradBg);
    }

    // Subtle overlay
    const overlay = scene.add.graphics();
    overlay.fillStyle(this.context.hexToNumber(this.context.getBackgroundColor()), 0.3);
    overlay.fillRoundedRect(0, 0, contentWidth, contentHeight, 8);
    container.add(overlay);

    // Particles
    if (!isReducedMotion()) {
      for (let i = 0; i < 14; i++) {
        const px = 8 + Math.random() * (contentWidth - 16);
        const py = 8 + Math.random() * (contentHeight - 16);
        const size = 6 + Math.random() * 8;
        const star = scene.add.text(px, py, Math.random() > 0.5 ? '✦' : '•', {
          fontSize: `${size}px`,
          color: this.context.getAccentColor(),
        });
        star.setOrigin(0.5);
        const baseAlpha = 0.2 + Math.random() * 0.4;
        star.setAlpha(baseAlpha);
        container.add(star);

        const tween = scene.tweens.add({
          targets: star,
          alpha: { from: baseAlpha, to: 0.05 },
          y: py - 8 - Math.random() * 12,
          duration: 1800 + Math.random() * 2200,
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: -1,
          delay: Math.random() * 1200,
        });
        tweens.push(tween);
      }
    }

    const emptyIcon = scene.add.text(contentWidth / 2, contentHeight / 2 - 20, '📋', {
      fontSize: '32px',
    });
    emptyIcon.setOrigin(0.5);
    container.add(emptyIcon);

    const emptyText = scene.add.text(contentWidth / 2, contentHeight / 2 + 20, '未选中任何对象', {
      fontFamily: this.context.fontFamily,
      fontSize: '14px',
      color: this.context.getTextMutedColor(),
    });
    emptyText.setOrigin(0.5);
    container.add(emptyText);

    return tweens;
  }

  destroy(): void {
    // No persistent resources to clean up
  }
}
