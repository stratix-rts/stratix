/**
 * TopBar V2 - Cyberpunk×Fantasy Style
 *
 * 使用EnhancedUIComponent和响应式Token
 * 自动响应主题变化
 * V2升级: 几何图标、count-up动画、扫描线、网格背景、旋转Help按钮
 */

import Phaser from 'phaser';

import { EnhancedUIComponent } from '@/stratix-core/ui/components/base/EnhancedUIComponent';
import type { UIComponentConfig } from '@/stratix-core/ui/core/types/component.types';
import { ReactiveToken } from '@/stratix-core/ui/foundation/theme/ReactiveToken';

import type { StatsCollector } from '../../debug/StatsCollector';
import { PerformanceWidget } from '../debug/PerformanceWidget';
import { isReducedMotion } from '../../themes/ThemeColors';
import { HUD_LAYOUT } from './layout/HUDLayout';

export interface TopBarStats {
  totalAgents: number;
  onlineAgents: number;
  busyAgents: number;
  totalZones: number;
  overallProgress: number;
}

export class TopBarV2 extends EnhancedUIComponent {
  private background: Phaser.GameObjects.Graphics | null = null;
  private gridGraphics: Phaser.GameObjects.Graphics | null = null;
  private scanlineGraphics: Phaser.GameObjects.Graphics | null = null;
  private agentIcon: Phaser.GameObjects.Graphics | null = null;
  private agentText: Phaser.GameObjects.Text | null = null;
  private busyIcon: Phaser.GameObjects.Graphics | null = null;
  private busyText: Phaser.GameObjects.Text | null = null;
  private zoneIcon: Phaser.GameObjects.Graphics | null = null;
  private zoneText: Phaser.GameObjects.Text | null = null;
  private performanceWidget: PerformanceWidget | null = null;
  private helpButton: Phaser.GameObjects.Container | null = null;
  private helpButtonGlow: Phaser.GameObjects.Graphics | null = null;

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
  private glassBg: ReactiveToken<string>;
  private glassBorder: ReactiveToken<string>;
  private primaryColor: ReactiveToken<string>;

  // 动画与状态
  private displayedValues: Record<string, number> = {
    onlineAgents: 0,
    totalAgents: 0,
    busyAgents: 0,
    totalZones: 0,
  };
  private countTweens: Map<string, Phaser.Tweens.Tween> = new Map();
  private scanlineTween: Phaser.Tweens.Tween | null = null;
  private helpButtonRotationTween: Phaser.Tweens.Tween | null = null;
  private helpButtonScaleTween: Phaser.Tweens.Tween | null = null;

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
      height: HUD_LAYOUT.topBar.height,
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
    this.glassBg = this.useToken('semantic.glass.background');
    this.glassBorder = this.useToken('semantic.glass.border');
    this.primaryColor = this.useToken('colors.accent');

    // 订阅颜色变化，自动重绘
    this.backgroundColor.subscribe(() => this.redraw());
    this.borderColor.subscribe(() => this.redraw());
  }

  create(): void {
    this.container = this.scene.add.container(this.config.x, this.config.y);
    this.container.setScrollFactor(0, 0);
    this.container.setDepth(1000);

    this.createBackground();
    this.createGridBackground();
    this.createScanline();
    this.createAgentSection(HUD_LAYOUT.topBar.sectionStartX, 12);
    this.createBusySection(HUD_LAYOUT.topBar.sectionStartX + HUD_LAYOUT.topBar.sectionSpacing, 12);
    this.createZoneSection(HUD_LAYOUT.topBar.sectionStartX + HUD_LAYOUT.topBar.sectionSpacing * 2, 12);
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
      (this.config.width || 1920) - HUD_LAYOUT.topBar.perfWidgetOffset,
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

  private createGridBackground(): void {
    this.gridGraphics = this.scene.add.graphics();
    this.drawGrid();
    (this.container as Phaser.GameObjects.Container).add(this.gridGraphics);
  }

  private drawGrid(): void {
    if (!this.gridGraphics) return;
    const width = this.config.width || 1920;
    const height = this.config.height || HUD_LAYOUT.topBar.height;
    const gridColor = this.hexToNumber(this.borderColor.get());
    this.gridGraphics.clear();
    this.gridGraphics.lineStyle(1, gridColor, 0.02);
    const step = HUD_LAYOUT.topBar.gridStep;
    for (let x = 0; x <= width; x += step) {
      this.gridGraphics.lineBetween(x, 0, x, height);
    }
    for (let y = 0; y <= height; y += step) {
      this.gridGraphics.lineBetween(0, y, width, y);
    }
  }

  private createScanline(): void {
    if (isReducedMotion()) return;
    this.scanlineGraphics = this.scene.add.graphics();
    (this.container as Phaser.GameObjects.Container).add(this.scanlineGraphics);

    const width = this.config.width || 1920;
    const scanlineState = { x: -60 };

    this.scanlineTween = this.scene.tweens.add({
      targets: scanlineState,
      x: width + 60,
      duration: 3500,
      ease: 'Linear',
      repeat: -1,
      onUpdate: () => {
        if (!this.scanlineGraphics) return;
        const primaryColor = this.hexToNumber(this.primaryColor.get());
        this.scanlineGraphics.clear();
        // Core bright segment - thinner and more subtle
        this.scanlineGraphics.fillStyle(primaryColor, 0.15);
        this.scanlineGraphics.fillRect(scanlineState.x, 0, 20, 1);
        // Fade tails
        this.scanlineGraphics.fillStyle(primaryColor, 0.06);
        this.scanlineGraphics.fillRect(scanlineState.x - 14, 0, 14, 1);
        this.scanlineGraphics.fillRect(scanlineState.x + 20, 0, 14, 1);
      },
    });
  }

  private drawBackground(): void {
    if (!this.background) return;

    const bgColor = this.hexToNumber(this.backgroundColor.get());
    const borderClr = this.hexToNumber(this.borderColor.get());
    const width = this.config.width || 1920;
    const height = this.config.height || HUD_LAYOUT.topBar.height;

    this.background.clear();
    // Glassmorphism: translucent background
    this.background.fillStyle(bgColor, 0.45);
    this.background.fillRoundedRect(0, 0, width, height, 0);

    // Subtle top highlight line
    const primaryColor = this.hexToNumber(this.primaryColor.get());
    this.background.lineStyle(1, primaryColor, 0.3);
    this.background.lineBetween(0, 0, width, 0);

    // Bottom border
    this.background.lineStyle(1, borderClr, 0.2);
    this.background.lineBetween(0, height, width, height);
  }

  private createAgentSection(x: number, y: number): void {
    this.agentIcon = this.scene.add.graphics();
    this.drawAgentIcon();
    (this.container as Phaser.GameObjects.Container).add(this.agentIcon);

    this.agentText = this.createText(x + 22, y, '0/0 在线', {
      fontSize: '14px',
      color: this.textPrimaryColor.get(),
    });
    (this.container as Phaser.GameObjects.Container).add(this.agentText);
  }

  private createBusySection(x: number, y: number): void {
    this.busyIcon = this.scene.add.graphics();
    this.drawBusyIcon();
    (this.container as Phaser.GameObjects.Container).add(this.busyIcon);

    this.busyText = this.createText(x + 22, y, '0 执行中', {
      fontSize: '14px',
      color: this.textPrimaryColor.get(),
    });
    (this.container as Phaser.GameObjects.Container).add(this.busyText);
  }

  private createZoneSection(x: number, y: number): void {
    this.zoneIcon = this.scene.add.graphics();
    this.drawZoneIcon();
    (this.container as Phaser.GameObjects.Container).add(this.zoneIcon);

    this.zoneText = this.createText(x + 22, y, '0 个区域', {
      fontSize: '14px',
      color: this.textPrimaryColor.get(),
    });
    (this.container as Phaser.GameObjects.Container).add(this.zoneText);
  }

  private createHelpButton(): void {
    const buttonX = (this.config.width || 1920) - HUD_LAYOUT.topBar.helpButtonOffset;
    const buttonY = 8;
    const buttonWidth = HUD_LAYOUT.topBar.helpButtonWidth;
    const buttonHeight = HUD_LAYOUT.topBar.helpButtonHeight;

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

    this.helpButtonGlow = this.scene.add.graphics();
    this.helpButton.add([this.helpButtonGlow, bg, hitArea, questionMark]);

    hitArea.on('pointerover', () => {
      const glowColor = this.hexToNumber(this.primaryColor.get());
      bg.clear();
      bg.fillStyle(glowColor, 0.2);
      bg.fillRoundedRect(0, 0, buttonWidth, buttonHeight, 4);
      bg.lineStyle(1, glowColor, 0.8);
      bg.strokeRoundedRect(0, 0, buttonWidth, buttonHeight, 4);

      if (!isReducedMotion()) {
        if (this.helpButtonScaleTween) {
          this.helpButtonScaleTween.stop();
        }
        this.helpButtonScaleTween = this.scene.tweens.add({
          targets: questionMark,
          scaleX: 1.15,
          scaleY: 1.15,
          duration: 150,
          ease: 'Sine.easeOut',
        });

        if (this.helpButtonRotationTween) {
          this.helpButtonRotationTween.stop();
        }
        this.helpButtonRotationTween = this.scene.tweens.add({
          targets: questionMark,
          angle: 360,
          duration: 600,
          ease: 'Back.easeOut',
          onComplete: () => {
            questionMark.setAngle(0);
          },
        });
      }

      this.helpButtonGlow?.clear();
      this.helpButtonGlow?.fillStyle(glowColor, 0.15);
      this.helpButtonGlow?.fillCircle(buttonWidth / 2, buttonHeight / 2, 18);
    });

    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(this.hexToNumber(this.borderColor.get()), 0.3);
      bg.fillRoundedRect(0, 0, buttonWidth, buttonHeight, 4);
      bg.lineStyle(1, this.hexToNumber(this.borderColor.get()), 0.5);
      bg.strokeRoundedRect(0, 0, buttonWidth, buttonHeight, 4);
      questionMark.setScale(1);
      questionMark.setAngle(0);

      if (this.helpButtonScaleTween) {
        this.helpButtonScaleTween.stop();
        this.helpButtonScaleTween = null;
      }

      if (this.helpButtonRotationTween) {
        this.helpButtonRotationTween.stop();
        this.helpButtonRotationTween = null;
      }

      this.helpButtonGlow?.clear();
    });

    hitArea.on('pointerdown', () => {
      const helpPanel = (window as unknown as Record<string, unknown>).helpPanel;
      if (helpPanel && typeof (helpPanel as { toggle?: () => void }).toggle === 'function') {
        (helpPanel as { toggle: () => void }).toggle();
      }
    });

    (this.container as Phaser.GameObjects.Container).add(this.helpButton);
  }

  private drawAgentIcon(): void {
    if (!this.agentIcon) return;
    const color = this.hexToNumber(this.infoColor.get());
    this.drawHexagon(this.agentIcon, 28, 20, 8, color);
  }

  private drawBusyIcon(): void {
    if (!this.busyIcon) return;
    const color = this.hexToNumber(this.warningColor.get());
    this.drawLightning(this.busyIcon, 148, 20, 10, color);
  }

  private drawZoneIcon(): void {
    if (!this.zoneIcon) return;
    const color = this.hexToNumber(this.successColor.get());
    this.drawDiamond(this.zoneIcon, 268, 20, 9, color);
  }

  private drawHexagon(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, radius: number, color: number): void {
    graphics.fillStyle(color, 1);
    graphics.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius;
      if (i === 0) graphics.moveTo(px, py);
      else graphics.lineTo(px, py);
    }
    graphics.closePath();
    graphics.fillPath();

    // Glow
    graphics.fillStyle(color, 0.2);
    graphics.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      const px = cx + Math.cos(angle) * (radius + 4);
      const py = cy + Math.sin(angle) * (radius + 4);
      if (i === 0) graphics.moveTo(px, py);
      else graphics.lineTo(px, py);
    }
    graphics.closePath();
    graphics.fillPath();
  }

  private drawLightning(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, size: number, color: number): void {
    const s = size;
    const points = [
      { x: cx - s * 0.3, y: cy - s * 0.5 },
      { x: cx + s * 0.1, y: cy - s * 0.1 },
      { x: cx - s * 0.1, y: cy - s * 0.1 },
      { x: cx + s * 0.3, y: cy + s * 0.5 },
      { x: cx - s * 0.1, y: cy + s * 0.1 },
      { x: cx + s * 0.1, y: cy + s * 0.1 },
    ];
    graphics.fillStyle(color, 1);
    graphics.beginPath();
    points.forEach((p, i) => {
      if (i === 0) graphics.moveTo(p.x, p.y);
      else graphics.lineTo(p.x, p.y);
    });
    graphics.closePath();
    graphics.fillPath();

    // Glow
    graphics.fillStyle(color, 0.2);
    graphics.beginPath();
    points.forEach((p, i) => {
      const gx = cx + (p.x - cx) * 1.4;
      const gy = cy + (p.y - cy) * 1.4;
      if (i === 0) graphics.moveTo(gx, gy);
      else graphics.lineTo(gx, gy);
    });
    graphics.closePath();
    graphics.fillPath();
  }

  private drawDiamond(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, size: number, color: number): void {
    const points = [
      { x: cx, y: cy - size },
      { x: cx + size * 0.7, y: cy },
      { x: cx, y: cy + size },
      { x: cx - size * 0.7, y: cy },
    ];
    graphics.fillStyle(color, 1);
    graphics.beginPath();
    points.forEach((p, i) => {
      if (i === 0) graphics.moveTo(p.x, p.y);
      else graphics.lineTo(p.x, p.y);
    });
    graphics.closePath();
    graphics.fillPath();

    // Glow
    graphics.fillStyle(color, 0.2);
    graphics.beginPath();
    const glowPoints = [
      { x: cx, y: cy - size - 3 },
      { x: cx + (size + 3) * 0.7, y: cy },
      { x: cx, y: cy + size + 3 },
      { x: cx - (size + 3) * 0.7, y: cy },
    ];
    glowPoints.forEach((p, i) => {
      if (i === 0) graphics.moveTo(p.x, p.y);
      else graphics.lineTo(p.x, p.y);
    });
    graphics.closePath();
    graphics.fillPath();
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

    this.animateCount('onlineAgents', stats.onlineAgents);
    this.animateCount('totalAgents', stats.totalAgents);
    this.animateCount('busyAgents', stats.busyAgents);
    this.animateCount('totalZones', stats.totalZones);

    // Update colors
    const onlineColor = stats.onlineAgents > 0 ? this.successColor.get() : this.textMutedColor.get();
    this.agentText?.setColor(onlineColor);

    const busyColor = stats.busyAgents > 0 ? this.warningColor.get() : this.textMutedColor.get();
    this.busyText?.setColor(busyColor);
  }

  private animateCount(key: string, targetValue: number): void {
    const currentValue = this.displayedValues[key] ?? 0;
    if (currentValue === targetValue) return;

    const existing = this.countTweens.get(key);
    if (existing) {
      existing.stop();
      this.countTweens.delete(key);
    }

    const proxy = { val: currentValue };
    const tween = this.scene.tweens.add({
      targets: proxy,
      val: targetValue,
      duration: 400,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        this.displayedValues[key] = proxy.val;
        this.refreshAllTexts();
      },
      onComplete: () => {
        this.displayedValues[key] = targetValue;
        this.refreshAllTexts();
        this.countTweens.delete(key);
      },
    });
    this.countTweens.set(key, tween);
  }

  private refreshAllTexts(): void {
    const online = Math.round(this.displayedValues.onlineAgents ?? 0);
    const total = Math.round(this.displayedValues.totalAgents ?? 0);
    const busy = Math.round(this.displayedValues.busyAgents ?? 0);
    const zones = Math.round(this.displayedValues.totalZones ?? 0);

    this.agentText?.setText(`${online}/${total} 在线`);
    this.busyText?.setText(`${busy} 执行中`);
    this.zoneText?.setText(`${zones} 个区域`);
  }

  public setStats(_stats: TopBarStats): void {
    this.updateDisplay();
  }

  public resize(width: number): void {
    this.config.width = width;
    this.drawBackground();
    this.drawGrid();
    // Restart scanline tween for new width
    if (this.scanlineTween) {
      this.scanlineTween.stop();
      this.scanlineTween = null;
    }
    if (this.scanlineGraphics) {
      this.scanlineGraphics.clear();
      this.createScanline();
    }
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
    this.drawGrid();

    // 重绘图标
    if (this.agentIcon) {
      this.agentIcon.clear();
      this.drawAgentIcon();
    }

    if (this.busyIcon) {
      this.busyIcon.clear();
      this.drawBusyIcon();
    }

    if (this.zoneIcon) {
      this.zoneIcon.clear();
      this.drawZoneIcon();
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

    this.countTweens.forEach((tween) => tween.stop());
    this.countTweens.clear();

    if (this.scanlineTween) {
      this.scanlineTween.stop();
      this.scanlineTween = null;
    }

    if (this.helpButtonScaleTween) {
      this.helpButtonScaleTween.stop();
      this.helpButtonScaleTween = null;
    }

    if (this.helpButtonRotationTween) {
      this.helpButtonRotationTween.stop();
      this.helpButtonRotationTween = null;
    }

    this.performanceWidget?.destroy();
    this.background?.destroy();
    this.gridGraphics?.destroy();
    this.scanlineGraphics?.destroy();
    this.agentIcon?.destroy();
    this.busyIcon?.destroy();
    this.zoneIcon?.destroy();
    this.agentText?.destroy();
    this.busyText?.destroy();
    this.zoneText?.destroy();
    this.helpButton?.destroy();
    this.helpButtonGlow?.destroy();

    super.destroy();
  }
}
