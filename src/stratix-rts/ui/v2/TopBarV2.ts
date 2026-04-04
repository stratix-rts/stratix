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

import type { StatsCollector } from '../../debug/StatsCollector';
import { PerformanceWidget } from '../debug/PerformanceWidget';

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
  private performanceWidget: PerformanceWidget | null = null;
  private helpButton: Phaser.GameObjects.Container | null = null;
  
  private updateTimer: Phaser.Time.TimerEvent | null = null;
  private getStats: () => TopBarStats;
  private statsCollector?: StatsCollector;
  
  // 响应式Token
  private backgroundColor: ReactiveToken<string>;
  private textPrimaryColor: ReactiveToken<string>;
  private textMutedColor: ReactiveToken<string>;
  private successColor: ReactiveToken<string>;
  private warningColor: ReactiveToken<string>;
  private infoColor: ReactiveToken<string>;
  private borderColor: ReactiveToken<string>;
  
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    getStats: () => TopBarStats,
    statsCollector?: StatsCollector
  ) {
    super(scene, {
      x,
      y,
      width,
      height: 40,
      reactiveTheme: true,
    });
    
    this.getStats = getStats;
    this.statsCollector = statsCollector;
    
    // 创建响应式Token
    this.backgroundColor = this.useToken('colors.background.primary');
    this.textPrimaryColor = this.useToken('colors.text.primary');
    this.textMutedColor = this.useToken('colors.text.muted');
    this.successColor = this.useToken('colors.semantic.success');
    this.warningColor = this.useToken('colors.semantic.warning');
    this.infoColor = this.useToken('colors.semantic.info');
    this.borderColor = this.useToken('colors.border.default');
    
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
    this.createHelpButton();
    
    if (this.statsCollector) {
      this.createPerformanceWidget();
    }
    
    this.startAutoUpdate();
    
    this.onCreate();
  }
  
  private createPerformanceWidget(): void {
    if (!this.statsCollector) return;
    
    this.performanceWidget = new PerformanceWidget(
      this.scene,
      (this.config.width || 1920) - 50,
      20,
      this.statsCollector
    );
    this.performanceWidget.create();
    this.performanceWidget.mount();
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
  
  private createHelpButton(): void {
    const buttonX = (this.config.width || 1920) - 150;
    const buttonY = 8;
    const buttonWidth = 32;
    const buttonHeight = 24;
    
    this.helpButton = this.scene.add.container(buttonX, buttonY);
    
    const bg = this.scene.add.graphics();
    bg.fillStyle(this.hexToNumber(this.borderColor.get()), 0.3);
    bg.fillRoundedRect(0, 0, buttonWidth, buttonHeight, 4);
    bg.lineStyle(1, this.hexToNumber(this.borderColor.get()), 0.5);
    bg.strokeRoundedRect(0, 0, buttonWidth, buttonHeight, 4);
    
    const hitArea = this.scene.add.rectangle(0, 0, buttonWidth, buttonHeight, 0x000000, 0);
    hitArea.setOrigin(0, 0);
    hitArea.setInteractive({ useHandCursor: true });
    
    const questionMark = this.scene.add.text(buttonWidth / 2, buttonHeight / 2, '?', {
      fontFamily: this.theme.typography.fontFamily.sans,
      fontSize: '16px',
      color: this.textPrimaryColor.get(),
    });
    questionMark.setOrigin(0.5, 0.5);
    
    this.helpButton.add([bg, hitArea, questionMark]);
    
    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(this.hexToNumber(this.infoColor.get()), 0.2);
      bg.fillRoundedRect(0, 0, buttonWidth, buttonHeight, 4);
      bg.lineStyle(1, this.hexToNumber(this.infoColor.get()), 0.8);
      bg.strokeRoundedRect(0, 0, buttonWidth, buttonHeight, 4);
    });
    
    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(this.hexToNumber(this.borderColor.get()), 0.3);
      bg.fillRoundedRect(0, 0, buttonWidth, buttonHeight, 4);
      bg.lineStyle(1, this.hexToNumber(this.borderColor.get()), 0.5);
      bg.strokeRoundedRect(0, 0, buttonWidth, buttonHeight, 4);
    });
    
    hitArea.on('pointerdown', () => {
      const helpPanel = (window as any).helpPanel;
      if (helpPanel) {
        helpPanel.toggle();
      }
    });
    
    (this.container as Phaser.GameObjects.Container).add(this.helpButton);
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
  }
  
  public setStats(stats: TopBarStats): void {
    this.updateDisplay();
  }
  
  public resize(width: number): void {
    this.config.width = width;
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

    this.performanceWidget?.destroy();
    this.background?.destroy();
    this.agentIcon?.destroy();
    this.busyIcon?.destroy();
    this.zoneIcon?.destroy();
    this.agentText?.destroy();
    this.busyText?.destroy();
    this.zoneText?.destroy();
    this.helpButton?.destroy();

    super.destroy();
  }
}
