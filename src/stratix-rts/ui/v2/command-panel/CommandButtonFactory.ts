import Phaser from 'phaser';

import { isReducedMotion } from '../../../themes/ThemeColors';

import type { CommandPanelCallbacks } from './types';

interface ButtonBuildConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  icon?: string;
  onClick: () => void;
  enabled?: boolean;
  baseFillColor: number;
  baseBorderColor: number;
  labelColor: number;
  glowColor: number;
  hoverFillAlpha: number;
}

export class CommandButtonFactory {
  constructor(
    private scene: Phaser.Scene,
    private fontFamily: string
  ) {}

  createSmallButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onClick: () => void,
    colors: {
      baseFill: number;
      border: number;
      label: number;
      glow: number;
    }
  ): Phaser.GameObjects.Container {
    return this.buildButton({
      x,
      y,
      width,
      height,
      label,
      onClick,
      enabled: true,
      baseFillColor: colors.baseFill,
      baseBorderColor: colors.border,
      labelColor: colors.label,
      glowColor: colors.glow,
      hoverFillAlpha: 0.2,
    });
  }

  createActionButton(
    x: number,
    y: number,
    width: number,
    height: number,
    btn: { key: string; label: string; icon: string; enabled: boolean },
    colors: {
      baseFill: number;
      border: number;
      label: number;
      glow: number;
    },
    callbacks: CommandPanelCallbacks,
    getAgentIds: () => string[],
    getSingleAgentId: () => string | null
  ): Phaser.GameObjects.Container {
    const onClick = () => {
      if (!btn.enabled) return;
      const agentIds = getAgentIds();
      const singleAgentId = getSingleAgentId();
      switch (btn.key) {
        case 'chat':
          callbacks.onChatClick(agentIds);
          break;
        case 'config':
          if (singleAgentId) callbacks.onConfigClick(singleAgentId);
          break;
        case 'task':
          callbacks.onTaskClick(agentIds);
          break;
        case 'stop':
          callbacks.onStopClick(agentIds);
          break;
      }
    };

    return this.buildButton({
      x,
      y,
      width,
      height,
      label: btn.label,
      icon: btn.icon,
      onClick,
      enabled: btn.enabled,
      baseFillColor: colors.baseFill,
      baseBorderColor: colors.border,
      labelColor: colors.label,
      glowColor: colors.glow,
      hoverFillAlpha: 0.25,
    });
  }

  private buildButton(config: ButtonBuildConfig): Phaser.GameObjects.Container {
    const { scene } = this;
    const container = scene.add.container(config.x, config.y);

    const bg = scene.add.graphics();
    bg.fillStyle(config.baseFillColor, 1);
    bg.fillRoundedRect(0, 0, config.width, config.height, 4);
    bg.lineStyle(1, config.baseBorderColor, 0.3);
    bg.strokeRoundedRect(0, 0, config.width, config.height, 4);
    container.add(bg);

    // Ripple container for click effect
    const rippleContainer = scene.add.container(0, 0);
    container.add(rippleContainer);

    const isDisabled = config.enabled === false;
    if (isDisabled) {
      container.setAlpha(0.5);
    }

    const hitArea = scene.add.rectangle(
      config.width / 2,
      config.height / 2,
      config.width,
      config.height,
      0x000000,
      0
    );
    hitArea.setInteractive({ useHandCursor: !isDisabled });
    container.add(hitArea);

    let labelText: Phaser.GameObjects.Text;

    if (config.icon) {
      const iconText = scene.add.text(8, config.height / 2, config.icon, { fontSize: '12px' });
      iconText.setOrigin(0, 0.5);
      container.add(iconText);

      labelText = scene.add.text(24, config.height / 2, config.label, {
        fontFamily: this.fontFamily,
        fontSize: '11px',
        color: '#' + config.labelColor.toString(16).padStart(6, '0'),
      });
      labelText.setOrigin(0, 0.5);
      container.add(labelText);
    } else {
      labelText = scene.add.text(config.width / 2, config.height / 2, config.label, {
        fontFamily: this.fontFamily,
        fontSize: '11px',
        color: '#' + config.labelColor.toString(16).padStart(6, '0'),
      });
      labelText.setOrigin(0.5);
      container.add(labelText);
    }

    let pressTween: Phaser.Tweens.Tween | undefined;

    // Handle click
    hitArea.on('pointerdown', config.onClick);

    if (!isDisabled) {

      hitArea.on('pointerover', () => {
        bg.clear();
        // Glow border
        bg.lineStyle(3, config.glowColor, 0.25);
        bg.strokeRoundedRect(-1, -1, config.width + 2, config.height + 2, 5);
        bg.fillStyle(config.glowColor, config.hoverFillAlpha);
        bg.fillRoundedRect(0, 0, config.width, config.height, 4);
        // Bright border
        bg.lineStyle(2, config.glowColor, 0.8);
        bg.strokeRoundedRect(0, 0, config.width, config.height, 4);

        if (!isReducedMotion()) {
          scene.tweens.add({
            targets: container,
            scaleX: 1.05,
            scaleY: 1.05,
            duration: 120,
            ease: 'Sine.easeOut',
          });
        }
      });

      hitArea.on('pointerout', () => {
        bg.clear();
        bg.fillStyle(config.baseFillColor, 1);
        bg.fillRoundedRect(0, 0, config.width, config.height, 4);
        bg.lineStyle(1, config.baseBorderColor, 0.3);
        bg.strokeRoundedRect(0, 0, config.width, config.height, 4);
        container.setScale(1);
        if (pressTween && pressTween.isPlaying()) {
          pressTween.stop();
        }
      });

      hitArea.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (!isReducedMotion()) {
          if (pressTween && pressTween.isPlaying()) pressTween.stop();
          pressTween = scene.tweens.add({
            targets: container,
            scaleX: 0.95,
            scaleY: 0.95,
            duration: 60,
            ease: 'Sine.easeInOut',
          });
        }

        // Press visual reinforcement: darken background
        bg.clear();
        bg.fillStyle(config.glowColor, 0.15);
        bg.fillRoundedRect(0, 0, config.width, config.height, 4);
        bg.lineStyle(3, config.glowColor, 0.25);
        bg.strokeRoundedRect(-1, -1, config.width + 2, config.height + 2, 5);
        bg.lineStyle(2, config.glowColor, 0.8);
        bg.strokeRoundedRect(0, 0, config.width, config.height, 4);

        // Click ripple effect
        if (!isReducedMotion()) {
          const localX = pointer.x - config.x;
          const localY = pointer.y - config.y;
          this.createRipple(rippleContainer, localX, localY, config.glowColor);
        }
      });

      hitArea.on('pointerup', () => {
        // Restore hover state or normal state
        bg.clear();
        bg.fillStyle(config.glowColor, config.hoverFillAlpha);
        bg.fillRoundedRect(0, 0, config.width, config.height, 4);
        bg.lineStyle(3, config.glowColor, 0.25);
        bg.strokeRoundedRect(-1, -1, config.width + 2, config.height + 2, 5);
        bg.lineStyle(2, config.glowColor, 0.8);
        bg.strokeRoundedRect(0, 0, config.width, config.height, 4);

        if (!isReducedMotion()) {
          if (pressTween && pressTween.isPlaying()) pressTween.stop();
          pressTween = scene.tweens.add({
            targets: container,
            scaleX: 1.05,
            scaleY: 1.05,
            duration: 80,
            ease: 'Sine.easeOut',
            onComplete: () => {
              scene.tweens.add({
                targets: container,
                scaleX: 1,
                scaleY: 1,
                duration: 80,
                ease: 'Sine.easeInOut',
              });
            },
          });
        }
      });
    }

    return container;
  }

  private createRipple(container: Phaser.GameObjects.Container, x: number, y: number, color: number): void {
    const { scene } = this;
    const ripple = scene.add.graphics();
    ripple.fillStyle(color, 0.4);
    ripple.fillCircle(x, y, 2);
    container.add(ripple);

    const tween = scene.tweens.add({
      targets: ripple,
      scaleX: 12,
      scaleY: 12,
      alpha: 0,
      duration: 300,
      ease: 'Sine.easeOut',
      onComplete: () => {
        ripple.destroy();
      },
    });
  }
}
