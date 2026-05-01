import Phaser from 'phaser';

import type { IStateRenderer } from './IStateRenderer';
import type { PanelData, RenderContext } from './types';
import { getZoneStatusColor, getZoneStatusText } from './types';

export class ZoneDetailRenderer implements IStateRenderer {
  constructor(private context: RenderContext) {}

  render(container: Phaser.GameObjects.Container, data: PanelData, _contentWidth: number): Phaser.Tweens.Tween[] {
    const zone = data.zone;
    if (!zone) return [];

    const { scene } = this.context;
    const yOffset = 0;

    const zoneIconBg = scene.add.graphics();
    zoneIconBg.fillStyle(this.context.hexToNumber(this.context.getAccentColor()), 0.2);
    zoneIconBg.fillRoundedRect(0, yOffset, 60, 60, 8);
    zoneIconBg.lineStyle(2, this.context.hexToNumber(this.context.getAccentColor()), 0.5);
    zoneIconBg.strokeRoundedRect(0, yOffset, 60, 60, 8);
    container.add(zoneIconBg);

    const zoneIcon = scene.add.text(30, yOffset + 30, '📦', { fontSize: '28px' });
    zoneIcon.setOrigin(0.5);
    container.add(zoneIcon);

    const nameText = scene.add.text(72, yOffset + 8, zone.name, {
      fontFamily: this.context.fontFamily,
      fontSize: '16px',
      fontStyle: 'bold',
      color: this.context.getTextPrimaryColor(),
    });
    container.add(nameText);

    const statusColor = getZoneStatusColor(
      zone.status,
      this.context.getSuccessColor(),
      this.context.getWarningColor(),
      this.context.getDangerColor(),
      this.context.getTextMutedColor()
    );
    const statusText = scene.add.text(72, yOffset + 30, `状态: ${getZoneStatusText(zone.status)}`, {
      fontFamily: this.context.fontFamily,
      fontSize: '12px',
      color: statusColor,
    });
    container.add(statusText);

    const agentsText = scene.add.text(72, yOffset + 48, `代理数量: ${zone.agentCount}`, {
      fontFamily: this.context.fontFamily,
      fontSize: '12px',
      color: this.context.getTextSecondaryColor(),
    });
    container.add(agentsText);

    return [];
  }

  destroy(): void {
    // No persistent resources
  }
}
