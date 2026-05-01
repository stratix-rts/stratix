import Phaser from 'phaser';

import { isReducedMotion } from '../../../themes/ThemeColors';

import { CommandButtonFactory } from './CommandButtonFactory';
import type { IStateRenderer } from './IStateRenderer';
import type { AgentInfo, CommandPanelCallbacks, PanelData, RenderContext } from './types';
import { getStatusColor } from './types';

export class MultiAgentRenderer implements IStateRenderer {
  private buttonFactory: CommandButtonFactory;

  constructor(
    private context: RenderContext,
    private callbacks: CommandPanelCallbacks
  ) {
    this.buttonFactory = new CommandButtonFactory(context.scene, context.fontFamily);
  }

  render(container: Phaser.GameObjects.Container, data: PanelData, contentWidth: number): Phaser.Tweens.Tween[] {
    const tweens: Phaser.Tweens.Tween[] = [];
    let yOffset = 0;

    const headerText = this.context.scene.add.text(0, yOffset, '选中头像列表', {
      fontFamily: this.context.fontFamily,
      fontSize: '12px',
      fontStyle: 'bold',
      color: this.context.getTextSecondaryColor(),
    });
    container.add(headerText);
    yOffset += 20;

    const avatarSize = 40;
    const avatarSpacing = 8;
    const avatarsPerRow = Math.floor((contentWidth + avatarSpacing) / (avatarSize + avatarSpacing));
    const maxVisibleAvatars = avatarsPerRow * 2;
    const displayAgents = data.agents.slice(0, maxVisibleAvatars);

    displayAgents.forEach((agent, index) => {
      const row = Math.floor(index / avatarsPerRow);
      const col = index % avatarsPerRow;
      const x = col * (avatarSize + avatarSpacing);
      const y = yOffset + row * (avatarSize + avatarSpacing);

      const avatarContainer = this.createAvatarItem(x, y, avatarSize, agent, tweens);
      container.add(avatarContainer);
    });

    yOffset += Math.ceil(displayAgents.length / avatarsPerRow) * (avatarSize + avatarSpacing);

    if (data.agents.length > maxVisibleAvatars) {
      const moreText = this.context.scene.add.text(0, yOffset, `+${data.agents.length - maxVisibleAvatars} 个`, {
        fontFamily: this.context.fontFamily,
        fontSize: '11px',
        color: this.context.getTextMutedColor(),
      });
      container.add(moreText);
      yOffset += 20;
    }

    yOffset += 8;

    const countText = this.context.scene.add.text(0, yOffset, `已选择 ${data.agents.length} 个 Agent`, {
      fontFamily: this.context.fontFamily,
      fontSize: '12px',
      fontStyle: 'bold',
      color: this.context.getTextPrimaryColor(),
    });
    container.add(countText);
    yOffset += 24;

    const buttonWidth = 60;
    const buttonHeight = 24;
    const buttonSpacing = 8;

    const btnColors = {
      baseFill: this.context.hexToNumber(this.context.getBackgroundSecondaryColor()),
      border: this.context.hexToNumber(this.context.getBorderColor()),
      label: this.context.hexToNumber(this.context.getTextPrimaryColor()),
      glow: this.context.hexToNumber(this.context.getPrimaryColor()),
    };

    const selectAllBtn = this.buttonFactory.createSmallButton(0, yOffset, buttonWidth, buttonHeight, '全选', () => {
      this.callbacks.onSelectAll?.();
    }, btnColors);
    container.add(selectAllBtn);

    const deselectAllBtn = this.buttonFactory.createSmallButton(
      buttonWidth + buttonSpacing,
      yOffset,
      buttonWidth,
      buttonHeight,
      '取消',
      () => {
        this.callbacks.onDeselectAll?.();
      },
      btnColors
    );
    container.add(deselectAllBtn);

    return tweens;
  }

  destroy(): void {
    // No persistent resources
  }

  private createAvatarItem(
    x: number,
    y: number,
    size: number,
    agent: AgentInfo,
    tweens: Phaser.Tweens.Tween[]
  ): Phaser.GameObjects.Container {
    const { scene } = this.context;
    const container = scene.add.container(x, y);

    const bg = scene.add.graphics();
    bg.fillStyle(this.context.hexToNumber(this.context.getBackgroundTertiaryColor()), 1);
    bg.fillRoundedRect(0, 0, size, size, 6);
    bg.lineStyle(1, this.context.hexToNumber(this.context.getBorderColor()), 0.3);
    bg.strokeRoundedRect(0, 0, size, size, 6);
    container.add(bg);

    const icon = scene.add.text(size / 2, size / 2, '👤', { fontSize: `${size * 0.5}px` });
    icon.setOrigin(0.5);
    container.add(icon);

    const statusColor = getStatusColor(
      agent.status,
      this.context.getSuccessColor(),
      this.context.getWarningColor(),
      this.context.getDangerColor(),
      this.context.getTextMutedColor()
    );
    const statusColorNum = this.context.hexToNumber(statusColor);

    // Breathing pulse
    const pulse = scene.add.graphics();
    pulse.fillStyle(statusColorNum, 0.35);
    pulse.fillCircle(0, 0, 8);
    pulse.setPosition(size - 6, size - 6);
    container.add(pulse);
    if (!isReducedMotion()) {
      const tween = scene.tweens.add({
        targets: pulse,
        scaleX: 1.7,
        scaleY: 1.7,
        alpha: 0.05,
        duration: 1400,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });
      tweens.push(tween);
    }

    const statusCore = scene.add.graphics();
    statusCore.fillStyle(statusColorNum, 1);
    statusCore.fillCircle(size - 6, size - 6, 5);
    container.add(statusCore);

    const hitArea = scene.add.rectangle(size / 2, size / 2, size, size, 0x000000, 0);
    hitArea.setInteractive({ useHandCursor: true });
    container.add(hitArea);

    hitArea.on('pointerdown', () => this.callbacks.onAgentDeselect?.(agent.agentId));
    hitArea.on('pointerover', () => {
      const glowColor = this.context.hexToNumber(this.context.getAccentColor());
      bg.clear();
      // Outer glow
      bg.lineStyle(3, glowColor, 0.3);
      bg.strokeRoundedRect(-1, -1, size + 2, size + 2, 6);
      bg.fillStyle(this.context.hexToNumber(this.context.getBackgroundTertiaryColor()), 1);
      bg.fillRoundedRect(0, 0, size, size, 6);
      bg.lineStyle(1, glowColor, 0.8);
      bg.strokeRoundedRect(0, 0, size, size, 6);
      // Lift effect
      if (!isReducedMotion()) {
        scene.tweens.add({
          targets: container,
          scaleX: 1.08,
          scaleY: 1.08,
          y: y - 4,
          duration: 150,
          ease: 'Sine.easeOut',
        });
      }
    });
    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(this.context.hexToNumber(this.context.getBackgroundTertiaryColor()), 1);
      bg.fillRoundedRect(0, 0, size, size, 6);
      bg.lineStyle(1, this.context.hexToNumber(this.context.getBorderColor()), 0.3);
      bg.strokeRoundedRect(0, 0, size, size, 6);
      container.setScale(1);
      container.setY(y);
    });

    return container;
  }
}
