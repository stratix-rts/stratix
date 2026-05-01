import Phaser from 'phaser';

import { isReducedMotion } from '../../../themes/ThemeColors';

import type { IStateRenderer } from './IStateRenderer';
import type { AgentInfo, PanelData, RenderContext } from './types';
import { getStatusColor, getStatusText } from './types';

export class AgentDetailRenderer implements IStateRenderer {
  constructor(private context: RenderContext) {}

  render(container: Phaser.GameObjects.Container, data: PanelData, contentWidth: number): Phaser.Tweens.Tween[] {
    const tweens: Phaser.Tweens.Tween[] = [];
    const agent = data.agents[0];
    if (agent) this.renderAgentDetail(container, agent, contentWidth, tweens);
    return tweens;
  }
  destroy(): void {}

  private renderAgentDetail(
    container: Phaser.GameObjects.Container,
    agent: AgentInfo,
    contentWidth: number,
    tweens: Phaser.Tweens.Tween[]
  ): void {
    const { scene } = this.context;
    let yOffset = 0;

    // Selected agent breathing glow effect
    const avatarGlow = scene.add.graphics();
    avatarGlow.fillStyle(this.context.hexToNumber(this.context.getAccentColor()), 0.15);
    avatarGlow.fillRoundedRect(-4, yOffset - 4, 68, 68, 10);
    container.add(avatarGlow);

    if (!isReducedMotion()) {
      tweens.push(scene.tweens.add({
        targets: avatarGlow,
        alpha: 0.35,
        duration: 1000,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      }));
    }

    const avatarBg = scene.add.graphics();
    avatarBg.fillStyle(0x2a2a4e, 1);
    avatarBg.fillRoundedRect(0, yOffset, 60, 60, 8);
    avatarBg.lineStyle(2, this.context.hexToNumber(this.context.getBorderColor()), 0.5);
    avatarBg.strokeRoundedRect(0, yOffset, 60, 60, 8);
    container.add(avatarBg);

    const typeIcon = scene.add.text(30, yOffset + 30, '👤', { fontSize: '28px' }).setOrigin(0.5);
    container.add(typeIcon);

    container.add(scene.add.text(72, yOffset + 8, agent.name, {
      fontFamily: this.context.fontFamily, fontSize: '16px', fontStyle: 'bold',
      color: this.context.getTextPrimaryColor(),
    }));

    container.add(scene.add.text(72, yOffset + 30, `类型: ${agent.type}`, {
      fontFamily: this.context.fontFamily, fontSize: '12px',
      color: this.context.getTextSecondaryColor(),
    }));

    const statusColor = getStatusColor(
      agent.status,
      this.context.getSuccessColor(),
      this.context.getWarningColor(),
      this.context.getDangerColor(),
      this.context.getTextMutedColor()
    );
    const statusColorNum = this.context.hexToNumber(statusColor);
    const statusY = yOffset + 54;

    const pulse = scene.add.graphics();
    pulse.fillStyle(statusColorNum, 0.35);
    pulse.fillCircle(0, 0, 8);
    pulse.setPosition(78, statusY);
    container.add(pulse);
    if (!isReducedMotion()) {
      tweens.push(scene.tweens.add({
        targets: pulse,
        scaleX: 1.7,
        scaleY: 1.7,
        alpha: 0.05,
        duration: 1400,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      }));
    }

    const statusDot = scene.add.graphics();
    statusDot.fillStyle(statusColorNum, 1);
    statusDot.fillCircle(78, statusY, 5);
    container.add(statusDot);

    container.add(scene.add.text(90, yOffset + 48, getStatusText(agent.status), {
      fontFamily: this.context.fontFamily, fontSize: '12px', color: statusColor,
    }));

    yOffset += 75;

    if (agent.currentTask) {
      container.add(scene.add.text(0, yOffset, '当前任务', {
        fontFamily: this.context.fontFamily, fontSize: '12px', fontStyle: 'bold',
        color: this.context.getTextSecondaryColor(),
      }));
      yOffset += 18;

      container.add(scene.add.text(0, yOffset, agent.currentTask, {
        fontFamily: this.context.fontFamily, fontSize: '11px',
        color: this.context.getTextMutedColor(), wordWrap: { width: contentWidth },
      }));
      yOffset += 20;

      if (agent.taskProgress !== undefined) {
        this.renderProgressBar(container, 0, yOffset, contentWidth, agent.taskProgress);
        yOffset += 25;
      }
    }

    if (agent.skills && Object.keys(agent.skills).length > 0) {
      const skillsLabel = scene.add.text(0, yOffset, '技能', {
        fontFamily: this.context.fontFamily,
        fontSize: '12px',
        fontStyle: 'bold',
        color: this.context.getTextSecondaryColor(),
      });
      container.add(skillsLabel);
      yOffset += 18;

      const skillEntries = Object.entries(agent.skills).slice(0, 4);
      const skillWidth = (contentWidth - (skillEntries.length - 1) * 8) / skillEntries.length;

      skillEntries.forEach(([skillName, level], index) => {
        const sx = index * (skillWidth + 8);
        const card = this.createSkillCard(sx, yOffset, skillWidth, 24, skillName, level);
        container.add(card);
      });
    }
  }

  private renderProgressBar(
    container: Phaser.GameObjects.Container,
    x: number,
    y: number,
    width: number,
    progress: number
  ): void {
    const { scene } = this.context;
    const barHeight = 6;
    const ratio = Math.min(progress, 100) / 100;
    const fillWidth = width * ratio;

    const shadow = scene.add.graphics();
    shadow.fillStyle(0x000000, 0.2);
    shadow.fillRoundedRect(x, y + 2, width, barHeight, 3);
    container.add(shadow);

    const progressBg = scene.add.graphics();
    progressBg.fillStyle(this.context.hexToNumber(this.context.getBorderColor()), 1);
    progressBg.fillRoundedRect(x, y, width, barHeight, 3);
    container.add(progressBg);

    const progressGradKey = this.context.getProgressGradKey();
    if (progressGradKey && fillWidth > 0) {
      const gradImage = scene.add.image(x, y + barHeight / 2, progressGradKey);
      gradImage.setOrigin(0, 0.5);
      gradImage.setDisplaySize(fillWidth, barHeight);
      gradImage.setCrop(0, 0, 256 * ratio, 8);
      container.add(gradImage);
    }

    if (fillWidth > 0) {
      const headX = x + fillWidth;
      const headY = y + barHeight / 2;
      const headGlow = scene.add.graphics();
      headGlow.fillStyle(this.context.hexToNumber(this.context.getAccentColor()), 0.35);
      headGlow.fillCircle(headX, headY, 6);
      headGlow.fillStyle(this.context.hexToNumber(this.context.getAccentColor()), 0.9);
      headGlow.fillCircle(headX, headY, 3);
      headGlow.fillStyle(0xffffff, 1);
      headGlow.fillCircle(headX, headY, 1.5);
      container.add(headGlow);
    }

    const progressText = scene.add.text(x + width + 8, y - 2, `${Math.round(progress)}%`, {
      fontFamily: this.context.fontFamily,
      fontSize: '11px',
      color: this.context.getTextSecondaryColor(),
    });
    container.add(progressText);
  }

  private createSkillCard(
    x: number,
    y: number,
    width: number,
    height: number,
    skillName: string,
    level: number
  ): Phaser.GameObjects.Container {
    const { scene } = this.context;
    const container = scene.add.container(x, y);

    const bg = scene.add.graphics();
    bg.fillStyle(this.context.hexToNumber(this.context.getBackgroundTertiaryColor()), 1);
    bg.fillRoundedRect(0, 0, width, height, 4);
    bg.lineStyle(1, this.context.hexToNumber(this.context.getBorderColor()), 0.2);
    bg.strokeRoundedRect(0, 0, width, height, 4);
    container.add(bg);

    const accent = this.context.hexToNumber(this.context.getAccentColor());
    const mark = scene.add.graphics();
    mark.fillStyle(accent, 1);
    mark.fillRoundedRect(0, 2, 3, height - 4, 1.5);
    container.add(mark);

    const skillText = scene.add.text(8, 6, skillName, {
      fontFamily: this.context.fontFamily,
      fontSize: '10px',
      color: this.context.getTextSecondaryColor(),
    });
    container.add(skillText);

    const levelText = scene.add.text(width - 8, 6, `Lv.${level}`, {
      fontFamily: this.context.fontFamily,
      fontSize: '10px',
      fontStyle: 'bold',
      color: this.context.getAccentColor(),
    });
    levelText.setOrigin(1, 0);
    container.add(levelText);

    const hitArea = scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0);
    hitArea.setInteractive({ useHandCursor: true });
    container.add(hitArea);

    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(this.context.hexToNumber(this.context.getBackgroundSecondaryColor()), 1);
      bg.fillRoundedRect(0, 0, width, height, 4);
      bg.lineStyle(1, accent, 0.6);
      bg.strokeRoundedRect(0, 0, width, height, 4);
      if (!isReducedMotion()) {
        scene.tweens.add({ targets: container, y: y - 2, duration: 120, ease: 'Sine.easeOut' });
      }
    });
    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(this.context.hexToNumber(this.context.getBackgroundTertiaryColor()), 1);
      bg.fillRoundedRect(0, 0, width, height, 4);
      bg.lineStyle(1, this.context.hexToNumber(this.context.getBorderColor()), 0.2);
      bg.strokeRoundedRect(0, 0, width, height, 4);
      container.setY(y);
    });

    return container;
  }
}
