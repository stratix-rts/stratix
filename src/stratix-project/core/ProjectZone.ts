import Phaser from 'phaser';
import { BaseZone, BaseZoneConfig, ZoneStatus } from '../../stratix-rts/zones/BaseZone';
import { Project, ProjectStatus, ProjectZoneConfig } from '../types';

const PROJECT_ZONE_COLORS = {
  fence: 0x00aaff,
  fill: 0x00aaff,
  corner: 0xffaa00,
  selected: 0x00ff00,
  warning: 0xff0000,
  handle: 0xffff00,
  status: {
    pending: 0x888888,
    active: 0x00aaff,
    completed: 0x00ff00,
    paused: 0xffaa00,
    failed: 0xff0000
  }
};

const PROJECT_ZONE_CONFIG: BaseZoneConfig = {
  id: '',
  name: '',
  x: 0,
  y: 0,
  width: 800,
  height: 600
};

export class ProjectZone extends BaseZone {
  private project: Project;
  private statusText: Phaser.GameObjects.Text | null = null;
  private priorityText: Phaser.GameObjects.Text | null = null;
  private agentCountText: Phaser.GameObjects.Text | null = null;

  constructor(scene: Phaser.Scene, project: Project, zoneConfig?: Partial<ProjectZoneConfig>) {
    const config: BaseZoneConfig = {
      ...PROJECT_ZONE_CONFIG,
      id: project.id,
      name: project.name,
      x: zoneConfig?.x ?? project.zoneConfig.x,
      y: zoneConfig?.y ?? project.zoneConfig.y,
      width: zoneConfig?.width ?? project.zoneConfig.width,
      height: zoneConfig?.height ?? project.zoneConfig.height
    };

    super(scene, config);

    this.project = project;

    this.createStatusText();
    this.createPriorityText();
    this.createAgentCountText();

    this.setData('isProjectZone', true);
    this.setData('projectId', project.id);

    this.updateFromProject();
  }

  protected createBaseVisuals(): void {
    super.createBaseVisuals();
  }

  private createStatusText(): void {
    this.statusText = this.scene.add.text(0, 0, '', {
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffffff',
      fontStyle: 'bold'
    });
    this.statusText.setOrigin(0.5);
    this.statusText.setDepth(1002);
    this.add(this.statusText);
  }

  private createPriorityText(): void {
    this.priorityText = this.scene.add.text(0, 0, '', {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffaa00'
    });
    this.priorityText.setOrigin(0.5);
    this.priorityText.setDepth(1002);
    this.add(this.priorityText);
  }

  private createAgentCountText(): void {
    this.agentCountText = this.scene.add.text(0, 0, '', {
      fontSize: '11px',
      fontFamily: 'Arial, sans-serif',
      color: '#00ff88'
    });
    this.agentCountText.setOrigin(0.5);
    this.agentCountText.setDepth(1002);
    this.add(this.agentCountText);
  }

  protected updateVisuals(): void {
    this.updateStatusText();
    this.updatePriorityText();
    this.updateAgentCountText();
  }

  private updateStatusText(): void {
    if (!this.statusText) return;

    const halfH = this.zoneHeight / 2;
    const statusText = this.getStatusText();
    
    this.statusText.setText(statusText);
    this.statusText.setPosition(0, -halfH + 25);

    const color = this.getStatusColor();
    this.statusText.setColor(`#${color.toString(16).padStart(6, '0')}`);
  }

  private updatePriorityText(): void {
    if (!this.priorityText) return;

    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;

    this.priorityText.setText(`优先级: ${this.project.priority}`);
    this.priorityText.setPosition(-halfW + 15, halfH - 15);
  }

  private updateAgentCountText(): void {
    if (!this.agentCountText) return;

    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;

    const agentCount = this.project.presentAgentIds.length;
    if (agentCount > 0) {
      this.agentCountText.setText(`英雄: ${agentCount}`);
      this.agentCountText.setPosition(halfW - 15, halfH - 15);
      this.agentCountText.setOrigin(1, 0);
      this.agentCountText.setVisible(true);
    } else {
      this.agentCountText.setVisible(false);
    }
  }

  private getStatusText(): string {
    switch (this.project.status) {
      case 'pending':
        return '⏸ 未启动';
      case 'active':
        return `▶ 执行中`;
      case 'completed':
        return '✓ 已完成';
      case 'paused':
        return '⏸ 已暂停';
      case 'failed':
        return '✗ 失败';
      default:
        return '';
    }
  }

  private getStatusColor(): number {
    return PROJECT_ZONE_COLORS.status[this.project.status] || PROJECT_ZONE_COLORS.status.pending;
  }

  private updateFromProject(): void {
    // Use zone_contexts.title if available (OKR data), otherwise fallback to project.name
    const displayName = this.project.zoneContext?.title || this.project.name;
    this.setZoneName(displayName);
    this.setZoneStatus(this.mapProjectStatus(this.project.status));
    this.redrawWithCustomColors();
  }

  private mapProjectStatus(status: ProjectStatus): ZoneStatus {
    const mapping: Record<ProjectStatus, ZoneStatus> = {
      pending: 'idle',
      active: 'active',
      completed: 'completed',
      paused: 'idle',
      failed: 'error'
    };
    return mapping[status];
  }

  private redrawWithCustomColors(): void {
    const statusColor = this.getStatusColor();
    const color = this.isWarningState()
      ? PROJECT_ZONE_COLORS.warning
      : this.isSelected
        ? PROJECT_ZONE_COLORS.selected
        : statusColor;

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
      handle.setFillStyle(this.isWarningState() ? PROJECT_ZONE_COLORS.warning : PROJECT_ZONE_COLORS.corner);
      handle.setRadius(8);
    });

    this.updateVisuals();
  }

  public updateProject(project: Project): void {
    this.project = project;
    this.updateFromProject();
  }

  public updateZoneTitle(title: string): void {
    // Update the zoneContext title if it exists, otherwise create it
    if (this.project.zoneContext) {
      this.project.zoneContext.title = title;
    } else {
      this.project.zoneContext = { title, prompt: '', members: [] };
    }
    this.setZoneName(title);
    this.redrawWithCustomColors();
  }

  public getProject(): Project {
    return this.project;
  }

  public getProjectId(): string {
    return this.project.id;
  }

  protected applyNewSize(newWidth: number, newHeight: number): void {
    super.applyNewSize(newWidth, newHeight);
    this.updateVisuals();
  }

  public toJSON(): any {
    return {
      ...this.project,
      zoneConfig: {
        x: this.x,
        y: this.y,
        width: this.zoneWidth,
        height: this.zoneHeight
      }
    };
  }

  public destroy(): void {
    if (this.statusText) {
      this.statusText.destroy();
      this.statusText = null;
    }
    if (this.priorityText) {
      this.priorityText.destroy();
      this.priorityText = null;
    }
    if (this.agentCountText) {
      this.agentCountText.destroy();
      this.agentCountText = null;
    }
    super.destroy();
  }
}
