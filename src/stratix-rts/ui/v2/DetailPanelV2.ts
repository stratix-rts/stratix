/**
 * DetailPanel V2 - 响应式版本
 * 
 * 使用EnhancedUIComponent和响应式Token
 * 自动响应主题变化
 */

import Phaser from 'phaser';
import { EnhancedUIComponent } from '@/stratix-core/ui/components/base/EnhancedUIComponent';
import type { UIComponentConfig } from '@/stratix-core/ui/core/types/component.types';
import { ReactiveToken } from '@/stratix-core/ui/foundation/theme/ReactiveToken';

type SelectionType = 'none' | 'agent' | 'zone';

interface AgentDetail {
  id: string;
  name: string;
  type: string;
  status: string;
  currentTask?: string;
  taskProgress?: number;
  skills?: Record<string, number>;
}

export class DetailPanelV2 extends EnhancedUIComponent {
  private contentContainer: Phaser.GameObjects.Container | null = null;
  private currentSelectionType: SelectionType = 'none';
  private getSelectedAgent: () => any | null;
  private getSelectedZone: () => any | null;
  
  private backgroundColor: ReactiveToken<string>;
  private textPrimaryColor: ReactiveToken<string>;
  private textSecondaryColor: ReactiveToken<string>;
  private textMutedColor: ReactiveToken<string>;
  private successColor: ReactiveToken<string>;
  private warningColor: ReactiveToken<string>;
  private dangerColor: ReactiveToken<string>;
  private borderColor: ReactiveToken<string>;
  
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    getSelectedAgent: () => any | null,
    getSelectedZone: () => any | null
  ) {
    super(scene, {
      x,
      y,
      width,
      height,
      reactiveTheme: true,
    });
    
    this.getSelectedAgent = getSelectedAgent;
    this.getSelectedZone = getSelectedZone;
    
    this.backgroundColor = this.useToken('colors.background.primary');
    this.textPrimaryColor = this.useToken('colors.text.primary');
    this.textSecondaryColor = this.useToken('colors.text.secondary');
    this.textMutedColor = this.useToken('colors.text.muted');
    this.successColor = this.useToken('colors.semantic.success');
    this.warningColor = this.useToken('colors.warning');
    this.dangerColor = this.useToken('colors.semantic.danger');
    this.borderColor = this.useToken('colors.border.default');
  }
  
  create(): void {
    this.container = this.scene.add.container(this.config.x, this.config.y);
    this.container.setScrollFactor(0, 0);
    this.container.setDepth(1000);
    
    this.createBackground();
    this.createContentContainer();
    this.showEmptyState();
    
    this.onCreate();
  }
  
  private createBackground(): void {
    const bg = this.scene.add.graphics();
    const bgColor = this.hexToNumber(this.backgroundColor.get());
    bg.fillStyle(bgColor, 0.95);
    bg.fillRoundedRect(0, 0, this.config.width || 300, this.config.height || 400, 8);
    (this.container as Phaser.GameObjects.Container).add(bg);
  }
  
  private createContentContainer(): void {
    this.contentContainer = this.scene.add.container(16, 16);
    (this.container as Phaser.GameObjects.Container).add(this.contentContainer);
    
    const title = this.createText(0, 0, '详情', {
      fontSize: '18px',
      fontStyle: 'bold',
    });
    this.contentContainer.add(title);
  }
  
  private showEmptyState(): void {
    const emptyText = this.createText(
      ((this.config.width || 300) / 2) - 16,
      (this.config.height || 400) / 2,
      '未选中任何对象',
      {
        fontSize: '14px',
        color: this.textMutedColor.get(),
      }
    );
    emptyText.setOrigin(0.5);
    this.contentContainer?.add(emptyText);
  }
  
  showAgentDetail(agent: AgentDetail): void {
    this.currentSelectionType = 'agent';
    this.contentContainer?.removeAll(true);
    
    const title = this.createText(0, 0, agent.name, {
      fontSize: '18px',
      fontStyle: 'bold',
    });
    this.contentContainer?.add(title);
    
    const typeLabel = this.createText(0, 30, `类型：${agent.type}`, {
      fontSize: '14px',
      color: this.textSecondaryColor.get(),
    });
    this.contentContainer?.add(typeLabel);
    
    const statusColor = this.getStatusColor(agent.status);
    const statusDot = this.scene.add.graphics();
    statusDot.fillStyle(this.hexToNumber(statusColor), 1);
    statusDot.fillCircle(6, 58, 6);
    this.contentContainer?.add(statusDot);
    
    const statusText = this.createText(20, 52, this.getStatusText(agent.status), {
      fontSize: '14px',
      color: statusColor,
    });
    this.contentContainer?.add(statusText);
    
    if (agent.currentTask) {
      this.renderCurrentTask(agent);
    }
    
    if (agent.skills && Object.keys(agent.skills).length > 0) {
      this.renderSkills(agent.skills);
    }
  }
  
  private renderCurrentTask(agent: AgentDetail): void {
    const taskLabel = this.createText(0, 80, '当前任务', {
      fontSize: '14px',
      fontStyle: 'bold',
    });
    this.contentContainer?.add(taskLabel);
    
    const taskText = this.createText(0, 100, agent.currentTask!, {
      fontSize: '12px',
      color: this.textSecondaryColor.get(),
      wordWrap: { width: (this.config.width || 300) - 32 },
    });
    this.contentContainer?.add(taskText);
    
    if (agent.taskProgress !== undefined) {
      this.renderProgressBar(130, agent.taskProgress);
    }
  }
  
  private renderProgressBar(y: number, progress: number): void {
    const width = (this.config.width || 300) - 32;
    
    const progressBg = this.scene.add.graphics();
    progressBg.fillStyle(this.hexToNumber(this.borderColor.get()), 1);
    progressBg.fillRoundedRect(0, y, width, 8, 4);
    this.contentContainer?.add(progressBg);
    
    const progressFill = this.scene.add.graphics();
    progressFill.fillStyle(this.hexToNumber(this.successColor.get()), 1);
    progressFill.fillRoundedRect(0, y, width * (progress / 100), 8, 4);
    this.contentContainer?.add(progressFill);
    
    const progressText = this.createText(0, y + 15, `${progress}%`, {
      fontSize: '12px',
      color: this.textSecondaryColor.get(),
    });
    this.contentContainer?.add(progressText);
  }
  
  private renderSkills(skills: Record<string, number>): void {
    const skillsLabel = this.createText(0, 170, '技能', {
      fontSize: '14px',
      fontStyle: 'bold',
    });
    this.contentContainer?.add(skillsLabel);
    
    let yOffset = 195;
    Object.entries(skills).forEach(([skillName, level]) => {
      const skillText = this.createText(0, yOffset, `${skillName}: Lv.${level}`, {
        fontSize: '12px',
        color: this.textSecondaryColor.get(),
      });
      this.contentContainer?.add(skillText);
      yOffset += 24;
    });
  }
  
  private getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      online: this.successColor.get(),
      offline: this.textMutedColor.get(),
      busy: this.warningColor.get(),
      error: this.dangerColor.get(),
    };
    return colors[status] || this.textMutedColor.get();
  }
  
  private getStatusText(status: string): string {
    const texts: Record<string, string> = {
      online: '在线',
      offline: '离线',
      busy: '忙碌',
      error: '错误',
    };
    return texts[status] || '未知';
  }
  
  update(): void {
    if (this.currentSelectionType === 'agent') {
      const agent = this.getSelectedAgent();
      if (agent) {
        this.showAgentDetail(agent);
      }
    }
  }
  
  protected updateThemeStyles(): void {
    this.contentContainer?.removeAll(true);
    this.createContentContainer();
    this.showEmptyState();
  }
  
  private createText(
    x: number,
    y: number,
    text: string,
    style: Phaser.Types.GameObjects.Text.TextStyle
  ): Phaser.GameObjects.Text {
    return this.scene.add.text(x, y, text, {
      fontFamily: this.theme.typography.fontFamily.sans,
      color: this.textPrimaryColor.get(),
      ...style,
    });
  }
  
  private hexToNumber(hex: string): number {
    if (!hex || typeof hex !== 'string') return 0xffffff;
    return parseInt(hex.slice(1), 16);
  }
  
  destroy(): void {
    this.contentContainer?.destroy();
    super.destroy();
  }
}