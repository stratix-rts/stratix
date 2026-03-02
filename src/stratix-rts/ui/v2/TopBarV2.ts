/**
 * TopBar V2 - 响应式版本
 * 
 * 使用EnhancedUIComponent和响应式Token
 * 自动响应主题变化
 */

import Phaser from 'phaser';
import { EnhancedUIComponent } from '@/stratix-core/ui/components/base/EnhancedUIComponent';
import type { UIComponentConfig } from '@/stratix-core/ui/core/types/component.types';
import { ReactiveToken } from '@/stratix-core/ui/foundation/theme/ReactiveToken';

export interface TopBarStats {
  totalAgents: number;
  onlineAgents: number;
  busyAgents: number;
  totalZones: number;
  overallProgress: number;
}

export class TopBarV2 extends EnhancedUIComponent {
  private background: Phaser.GameObjects.Graphics | null = null;
  private agentIcon: Phaser.GameObjects.Graphics | null = null;
  private agentText: Phaser.GameObjects.Text | null = null;
  private busyIcon: Phaser.GameObjects.Graphics | null = null;
  private busyText: Phaser.GameObjects.Text | null = null;
  private zoneIcon: Phaser.GameObjects.Graphics | null = null;
  private zoneText: Phaser.GameObjects.Text | null = null;
  private progressContainer: Phaser.GameObjects.Container | null = null;
  private progressBg: Phaser.GameObjects.Graphics | null = null;
  private progressFill: Phaser.GameObjects.Graphics | null = null;
  private progressText: Phaser.GameObjects.Text | null = null;
  
  private updateTimer: Phaser.Time.TimerEvent | null = null;
  private getStats: () => TopBarStats;
  
  // 响应式Token
  private backgroundColor: ReactiveToken<string>;
  private textPrimaryColor: ReactiveToken<string>;
  private textMutedColor: ReactiveToken<string>;
  private successColor: ReactiveToken<string>;
  private warningColor: ReactiveToken<string>;
  private infoColor: ReactiveToken<string>;
  private borderColor: ReactiveToken<string>;
  private progressBgColor: ReactiveToken<string>;
  
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    getStats: () => TopBarStats
  ) {
    super(scene, {
      x,
      y,
      width,
      height: 40,
      reactiveTheme: true,
    });
    
    this.getStats = getStats;
    
    // 创建响应式Token
    this.backgroundColor = this.useToken('colors.background.primary');
    this.textPrimaryColor = this.useToken('colors.text.primary');
    this.textMutedColor = this.useToken('colors.text.muted');
    this.successColor = this.useToken('colors.semantic.success');
    this.warningColor = this.useToken('colors.semantic.warning');
    this.infoColor = this.useToken('colors.semantic.info');
    this.borderColor = this.useToken('colors.border.default');
    this.progressBgColor = this.useToken('colors.background.tertiary');
    
    // 订阅颜色变化，自动重绘
    this.backgroundColor.subscribe(() => this.redraw());
    this.borderColor.subscribe(() => this.redraw());
  }
  
  create(): void {
    this.container = this.scene.add.container(this.config.x, this.config.y);
    this.container.setScrollFactor(0, 0);
    this.container.setDepth(1000);
    
    this.createBackground();
    this.createAgentSection(20, 12);
    this.createBusySection(140, 12);
    this.createZoneSection(260, 12);
    this.createProgressSection((this.config.width || 1920) - 180, 8);
    
    this.startAutoUpdate();
    
    this.onCreate();
  }
  
  private createBackground(): void {
    this.background = this.scene.add.graphics();
    this.drawBackground();
    (this.container as Phaser.GameObjects.Container).add(this.background);
  }
  
  private drawBackground(): void {
    if (!this.background) return;
    
    const bgColor = this.hexToNumber(this.backgroundColor.get());
    const borderClr = this.hexToNumber(this.borderColor.get());
    const width = this.config.width || 1920;
    const height = this.config.height || 40;
    
    this.background.clear();
    this.background.fillStyle(bgColor, 0.9);
    this.background.fillRoundedRect(0, 0, width, height, 0);
    this.background.lineStyle(1, borderClr, 0.3);
    this.background.lineBetween(0, height, width, height);
  }
  
  private createAgentSection(x: number, y: number): void {
    this.agentIcon = this.createIcon(x, y, this.infoColor.get());
    (this.container as Phaser.GameObjects.Container).add(this.agentIcon);
    
    this.agentText = this.createText(x + 22, y, '0/0 在线', {
      fontSize: '14px',
      color: this.textPrimaryColor.get(),
    });
    (this.container as Phaser.GameObjects.Container).add(this.agentText);
  }
  
  private createBusySection(x: number, y: number): void {
    this.busyIcon = this.createIcon(x, y, this.warningColor.get());
    (this.container as Phaser.GameObjects.Container).add(this.busyIcon);
    
    this.busyText = this.createText(x + 22, y, '0 执行中', {
      fontSize: '14px',
      color: this.textPrimaryColor.get(),
    });
    (this.container as Phaser.GameObjects.Container).add(this.busyText);
  }
  
  private createZoneSection(x: number, y: number): void {
    this.zoneIcon = this.createIcon(x, y, this.successColor.get());
    (this.container as Phaser.GameObjects.Container).add(this.zoneIcon);
    
    this.zoneText = this.createText(x + 22, y, '0 个区域', {
      fontSize: '14px',
      color: this.textPrimaryColor.get(),
    });
    (this.container as Phaser.GameObjects.Container).add(this.zoneText);
  }
  
  private createProgressSection(x: number, y: number): void {
    this.progressContainer = this.scene.add.container(x, y);
    (this.container as Phaser.GameObjects.Container).add(this.progressContainer);
    
    const progressBgClr = this.hexToNumber(this.progressBgColor.get());
    this.progressBg = this.scene.add.graphics();
    this.progressBg.fillStyle(progressBgClr, 1);
    this.progressBg.fillRoundedRect(0, 8, 150, 16, 4);
    this.progressContainer.add(this.progressBg);
    
    this.progressFill = this.scene.add.graphics();
    this.progressContainer.add(this.progressFill);
    
    this.progressText = this.createText(75, 8, '0%', {
      fontSize: '12px',
      color: this.textPrimaryColor.get(),
    });
    this.progressText.setOrigin(0.5, 0);
    this.progressContainer.add(this.progressText);
  }
  
  private createIcon(x: number, y: number, color: string): Phaser.GameObjects.Graphics {
    const graphics = this.scene.add.graphics();
    graphics.fillStyle(this.hexToNumber(color), 1);
    graphics.fillCircle(x + 8, y + 8, 8);
    return graphics;
  }
  
  private createText(
    x: number,
    y: number,
    text: string,
    style: Phaser.Types.GameObjects.Text.TextStyle
  ): Phaser.GameObjects.Text {
    return this.scene.add.text(x, y, text, {
      fontFamily: this.theme.typography.fontFamily.sans,
      ...style,
    });
  }
  
  private startAutoUpdate(): void {
    this.updateDisplay();
    this.updateTimer = this.scene.time.addEvent({
      delay: 500,
      callback: this.updateDisplay,
      callbackScope: this,
      loop: true,
    });
  }
  
  private updateDisplay(): void {
    const stats = this.getStats();
    
    // 更新Agent显示
    const onlineColor = stats.onlineAgents > 0
      ? this.successColor.get()
      : this.textMutedColor.get();
    this.agentText?.setText(`${stats.onlineAgents}/${stats.totalAgents} 在线`);
    this.agentText?.setColor(onlineColor);
    
    // 更新Busy显示
    const busyColor = stats.busyAgents > 0
      ? this.warningColor.get()
      : this.textMutedColor.get();
    this.busyText?.setText(`${stats.busyAgents} 执行中`);
    this.busyText?.setColor(busyColor);
    
    // 更新Zone显示
    this.zoneText?.setText(`${stats.totalZones} 个区域`);
    
    // 更新进度
    this.updateProgress(stats.overallProgress);
  }
  
  private updateProgress(progress: number): void {
    const clampedProgress = Math.max(0, Math.min(100, progress));
    const fillWidth = Math.floor((clampedProgress / 100) * 150);
    
    this.progressFill?.clear();
    if (fillWidth > 0) {
      const progressFillColor = this.hexToNumber(this.successColor.get());
      this.progressFill?.fillStyle(progressFillColor, 1);
      this.progressFill?.fillRoundedRect(0, 8, fillWidth, 16, 4);
    }
    
    this.progressText?.setText(`${Math.floor(clampedProgress)}%`);
  }
  
  public setStats(stats: TopBarStats): void {
    this.updateDisplay();
  }
  
  public resize(width: number): void {
    this.config.width = width;
    this.progressContainer?.setX(width - 180);
    this.drawBackground();
  }
  
  /**
   * 主题变化时自动调用
   */
  protected updateThemeStyles(): void {
    this.redraw();
  }
  
  private redraw(): void {
    // 重绘背景
    this.drawBackground();
    
    // 重绘图标颜色
    if (this.agentIcon) {
      this.agentIcon.clear();
      this.agentIcon.fillStyle(this.hexToNumber(this.infoColor.get()), 1);
      this.agentIcon.fillCircle(28, 20, 8);
    }
    
    if (this.busyIcon) {
      this.busyIcon.clear();
      this.busyIcon.fillStyle(this.hexToNumber(this.warningColor.get()), 1);
      this.busyIcon.fillCircle(148, 20, 8);
    }
    
    if (this.zoneIcon) {
      this.zoneIcon.clear();
      this.zoneIcon.fillStyle(this.hexToNumber(this.successColor.get()), 1);
      this.zoneIcon.fillCircle(268, 20, 8);
    }
    
    // 更新显示
    this.updateDisplay();
  }
  
  private hexToNumber(hex: string): number {
    if (!hex || typeof hex !== 'string') return 0xffffff;
    return parseInt(hex.slice(1), 16);
  }
  
  destroy(): void {
    if (this.updateTimer) {
      this.updateTimer.remove();
      this.updateTimer = null;
    }
    
    this.background?.destroy();
    this.agentIcon?.destroy();
    this.busyIcon?.destroy();
    this.zoneIcon?.destroy();
    this.agentText?.destroy();
    this.busyText?.destroy();
    this.zoneText?.destroy();
    this.progressContainer?.destroy();
    this.progressBg?.destroy();
    this.progressFill?.destroy();
    this.progressText?.destroy();
    
    super.destroy();
  }
}
