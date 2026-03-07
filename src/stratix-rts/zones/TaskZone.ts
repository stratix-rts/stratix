import Phaser from 'phaser';
import { BaseZone, BaseZoneConfig, ZoneStatus } from './BaseZone';
import type { CornerPosition } from './BaseZone';

export type TaskZoneStatus = 'idle' | 'active' | 'busy' | 'error';
export type TaskZoneType = 'code' | 'analysis' | 'writing' | 'general';
export type { CornerPosition };

export interface TaskZoneConfig extends BaseZoneConfig {
  taskType?: TaskZoneType;
}

const TASK_ZONE_COLORS = {
  fence: 0xff6600,
  fill: 0xff6600,
  corner: 0xffaa00,
  selected: 0x00ff00,
  warning: 0xff0000,
  handle: 0xffff00,
  status: {
    idle: 0x888888,
    active: 0x00ff88,
    busy: 0xffff00,
    error: 0xff4444
  },
  type: {
    code: 0x9B59B6,
    analysis: 0xE67E22,
    writing: 0x4A90E2,
    general: 0x00ffff
  }
};

const TASK_ZONE_TYPE_ICONS: Record<TaskZoneType, string> = {
  code: '</>',
  analysis: '📊',
  writing: '✍️',
  general: '◆'
};

export class TaskZone extends BaseZone {
  private zoneType: TaskZoneType;
  private assignedAgentCount: number = 0;
  private queuedAgentCount: number = 0;
  private taskProgress: number = 0;
  private activeTaskName: string = '';

  private statusIndicator: Phaser.GameObjects.Graphics | null = null;
  private typeIcon: Phaser.GameObjects.Text | null = null;
  private queueText: Phaser.GameObjects.Text | null = null;
  private progressBar: Phaser.GameObjects.Graphics | null = null;
  private progressText: Phaser.GameObjects.Text | null = null;
  private statusPulse: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, config: TaskZoneConfig) {
    super(scene, config);

    this.zoneType = config.taskType || 'general';

    this.createStatusIndicator();
    this.createTypeIcon();
    this.createQueueDisplay();
    this.createProgressBar();

    this.setData('isTaskZone', true);

    this.redrawWithCustomColors();
  }

  private createStatusIndicator(): void {
    this.statusIndicator = this.scene.add.graphics();
    this.statusIndicator.setDepth(1002);
    this.add(this.statusIndicator);
    this.updateStatusIndicator();
  }

  private createTypeIcon(): void {
    const halfH = this.zoneHeight / 2;
    this.typeIcon = this.scene.add.text(-this.zoneWidth / 2 + 8, -halfH - 20, TASK_ZONE_TYPE_ICONS[this.zoneType], {
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif'
    });
    this.typeIcon.setDepth(1002);
    this.add(this.typeIcon);
  }

  private createQueueDisplay(): void {
    const halfW = this.zoneWidth / 2;
    this.queueText = this.scene.add.text(halfW - 8, -this.zoneHeight / 2 - 20, '', {
      fontSize: '11px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { x: 4, y: 2 }
    });
    this.queueText.setOrigin(1, 0);
    this.queueText.setDepth(1002);
    this.add(this.queueText);
  }

  private createProgressBar(): void {
    this.progressBar = this.scene.add.graphics();
    this.progressBar.setDepth(1002);
    this.add(this.progressBar);

    this.progressText = this.scene.add.text(0, 0, '', {
      fontSize: '10px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffffff'
    });
    this.progressText.setOrigin(0.5);
    this.progressText.setDepth(1003);
    this.progressText.setVisible(false);
    this.add(this.progressText);
  }

  private updateStatusIndicator(): void {
    if (!this.statusIndicator) return;

    this.statusIndicator.clear();
    const statusColor = TASK_ZONE_COLORS.status[this.getZoneStatus() as TaskZoneStatus];
    const halfH = this.zoneHeight / 2;

    this.statusIndicator.fillStyle(statusColor, 1);
    this.statusIndicator.fillCircle(-this.zoneWidth / 2 + 24, -halfH - 12, 5);

    if (this.getZoneStatus() === 'busy' && !this.statusPulse) {
      this.statusPulse = this.scene.tweens.add({
        targets: this.statusIndicator,
        alpha: { from: 1, to: 0.5 },
        duration: 500,
        yoyo: true,
        repeat: -1
      });
    } else if (this.getZoneStatus() !== 'busy' && this.statusPulse) {
      this.statusPulse.stop();
      this.statusPulse = null;
      this.statusIndicator.setAlpha(1);
    }
  }

  private updateQueueDisplay(): void {
    if (!this.queueText) return;

    if (this.queuedAgentCount > 0) {
      this.queueText.setText(`⏳ ${this.queuedAgentCount}`);
      this.queueText.setVisible(true);
    } else {
      this.queueText.setVisible(false);
    }
  }

  private updateProgressBar(): void {
    if (!this.progressBar || !this.progressText) return;

    this.progressBar.clear();
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;
    const barWidth = Math.min(this.zoneWidth - 20, 100);
    const barHeight = 6;
    const barX = -barWidth / 2;
    const barY = halfH + 8;

    if (this.taskProgress > 0 && this.taskProgress < 100) {
      this.progressBar.fillStyle(0x333333, 0.8);
      this.progressBar.fillRoundedRect(barX, barY, barWidth, barHeight, 3);

      const fillWidth = Math.floor((this.taskProgress / 100) * barWidth);
      if (fillWidth > 0) {
        const fillColor = TASK_ZONE_COLORS.type[this.zoneType];
        this.progressBar.fillStyle(fillColor, 1);
        this.progressBar.fillRoundedRect(barX, barY, fillWidth, barHeight, 3);
      }

      this.progressText.setText(`${Math.floor(this.taskProgress)}%`);
      this.progressText.setPosition(0, barY + barHeight + 2);
      this.progressText.setVisible(true);
    } else {
      this.progressText.setVisible(false);
    }
  }

  protected updateVisuals(): void {
    this.updateStatusIndicator();
    this.updateProgressBar();
  }

  private redrawWithCustomColors(): void {
    const color = this.isWarningState()
      ? TASK_ZONE_COLORS.warning
      : this.isSelected
        ? TASK_ZONE_COLORS.selected
        : TASK_ZONE_COLORS.fence;

    this.graphics.clear();
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;
    this.graphics.lineStyle(this.isSelected ? 4 : 3, color, this.isSelected ? 1 : 0.9);
    this.graphics.strokeRect(-halfW, -halfH, this.zoneWidth, this.zoneHeight);

    if (this.isSelected) {
      this.graphics.fillStyle(color, this.isWarningState() ? 0.25 : 0.15);
      this.graphics.fillRect(-halfW, -halfH, this.zoneWidth, this.zoneHeight);
    }

    this.fencePosts.forEach(post => {
      post.setFillStyle(color);
    });

    this.cornerHandles.forEach((handle) => {
      handle.setVisible(this.isSelected);
      handle.setFillStyle(this.isWarningState() ? TASK_ZONE_COLORS.warning : TASK_ZONE_COLORS.corner);
      handle.setRadius(8);
    });

    this.updateVisuals();
  }

  public setZoneStatus(status: TaskZoneStatus): void {
    super.setZoneStatus(status as ZoneStatus);
    this.updateStatusIndicator();
    this.redrawWithCustomColors();
  }

  public getZoneStatus(): TaskZoneStatus {
    return super.getZoneStatus() as TaskZoneStatus;
  }

  public setZoneType(type: TaskZoneType): void {
    this.zoneType = type;
    if (this.typeIcon) {
      this.typeIcon.setText(TASK_ZONE_TYPE_ICONS[type]);
    }
    this.updateProgressBar();
  }

  public getZoneType(): TaskZoneType {
    return this.zoneType;
  }

  public setAssignedAgents(count: number): void {
    this.assignedAgentCount = count;
    if (count > 0 && this.getZoneStatus() === 'idle') {
      this.setZoneStatus('active');
    } else if (count === 0 && this.getZoneStatus() === 'active') {
      this.setZoneStatus('idle');
    }
  }

  public getAssignedAgents(): number {
    return this.assignedAgentCount;
  }

  public setQueuedAgents(count: number): void {
    this.queuedAgentCount = count;
    this.updateQueueDisplay();
  }

  public getQueuedAgents(): number {
    return this.queuedAgentCount;
  }

  public setTaskProgress(progress: number): void {
    this.taskProgress = Math.max(0, Math.min(100, progress));
    this.updateProgressBar();

    if (progress > 0 && progress < 100) {
      this.setZoneStatus('busy');
    }
  }

  public getTaskProgress(): number {
    return this.taskProgress;
  }

  public setActiveTaskName(name: string): void {
    this.activeTaskName = name;
  }

  public getActiveTaskName(): string {
    return this.activeTaskName;
  }

  public overlapsZone(other: TaskZone): boolean {
    const bounds1 = this.getBounds();
    const bounds2 = other.getBounds();
    return Phaser.Geom.Rectangle.Overlaps(bounds1, bounds2);
  }

  public overlapsRect(rect: Phaser.Geom.Rectangle): boolean {
    const bounds = this.getBounds();
    return Phaser.Geom.Rectangle.Overlaps(bounds, rect);
  }

  protected applyNewSize(newWidth: number, newHeight: number): void {
    super.applyNewSize(newWidth, newHeight);

    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;

    if (this.typeIcon) {
      this.typeIcon.setPosition(-halfW + 8, -halfH - 20);
    }

    if (this.queueText) {
      this.queueText.setPosition(halfW - 8, -halfH - 20);
    }

    this.updateProgressBar();
  }

  public destroy(): void {
    if (this.statusIndicator) {
      this.statusIndicator.destroy();
      this.statusIndicator = null;
    }
    if (this.typeIcon) {
      this.typeIcon.destroy();
      this.typeIcon = null;
    }
    if (this.queueText) {
      this.queueText.destroy();
      this.queueText = null;
    }
    if (this.progressBar) {
      this.progressBar.destroy();
      this.progressBar = null;
    }
    if (this.progressText) {
      this.progressText.destroy();
      this.progressText = null;
    }
    if (this.statusPulse) {
      this.statusPulse.stop();
      this.statusPulse = null;
    }
    super.destroy();
  }
}
