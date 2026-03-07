import Phaser from 'phaser';
import { EnhancedUIComponent } from '@/stratix-core/ui/components/base/EnhancedUIComponent';
import type { StatsCollector } from '../../debug/StatsCollector';
import { PerformancePanel } from './PerformancePanel';

export class PerformanceWidget extends EnhancedUIComponent {
  private statsCollector: StatsCollector;
  private fpsButton: Phaser.GameObjects.Container | null = null;
  private fpsText: Phaser.GameObjects.Text | null = null;
  private fpsIndicator: Phaser.GameObjects.Graphics | null = null;
  private panel: PerformancePanel | null = null;
  
  private isExpanded: boolean = false;
  private buttonSize: number = 40;
  private panelWidth: number = 400;
  private panelHeight: number = 600;
  
  private updateTimer: Phaser.Time.TimerEvent | null = null;
  
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    statsCollector: StatsCollector
  ) {
    super(scene, {
      x,
      y,
      width: 40,
      height: 40,
      reactiveTheme: true
    });
    
    this.statsCollector = statsCollector;
  }
  
  create(): void {
    this.container = this.scene.add.container(this.config.x, this.config.y);
    this.container.setScrollFactor(0, 0);
    this.container.setDepth(1001);
    
    this.createFPSButton();
    this.createPanel();
    this.setupInteraction();
    this.startAutoUpdate();
    
    this.onCreate();
  }
  
  private createFPSButton(): void {
    this.fpsButton = this.scene.add.container(0, 0);
    
    // 创建小圆点指示器
    this.fpsIndicator = this.scene.add.graphics();
    this.drawFPSIndicator(60);
    this.fpsIndicator.setPosition(-30, 0);
    this.fpsButton.add(this.fpsIndicator);
    
    // FPS 文本：fps: 60
    this.fpsText = this.scene.add.text(-20, 0, 'fps: 60', {
      fontSize: '12px',
      fontFamily: 'Monaco, Consolas, monospace',
      color: '#ffffff',
    });
    this.fpsText.setOrigin(0, 0.5);
    this.fpsButton.add(this.fpsText);
    
    (this.container as Phaser.GameObjects.Container).add(this.fpsButton);
  }
  
  private createPanel(): void {
    const screenWidth = this.scene.cameras.main.width;
    
    this.panel = new PerformancePanel(
      this.scene,
      screenWidth - this.panelWidth - 20,
      this.buttonSize + 10,
      this.panelWidth,
      this.panelHeight,
      this.statsCollector
    );
    this.panel.create();
    this.panel.setVisible(false);
  }
  
  private setupInteraction(): void {
    if (!this.fpsButton) return;
    
    // 创建点击区域（文本 + 圆点的范围）
    const hitArea = new Phaser.Geom.Rectangle(-35, -10, 70, 20);
    this.fpsButton.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);
    
    this.fpsButton.on('pointerdown', () => {
      this.togglePanel();
    });
    
    this.fpsButton.on('pointerover', () => {
      if (this.fpsButton) {
        this.fpsButton.setAlpha(0.8);
      }
    });
    
    this.fpsButton.on('pointerout', () => {
      if (this.fpsButton) {
        this.fpsButton.setAlpha(1);
      }
    });
  }
  
  togglePanel(): void {
    this.isExpanded = !this.isExpanded;
    if (this.panel) {
      this.panel.setVisible(this.isExpanded);
      
      if (this.isExpanded) {
        this.panel.update();
      }
    }
  }
  
  private startAutoUpdate(): void {
    this.updateTimer = this.scene.time.addEvent({
      delay: 500,
      callback: this.updateFPS,
      callbackScope: this,
      loop: true
    });
  }
  
  private updateFPS(): void {
    const stats = this.statsCollector.getStats();
    const fps = stats.fps.current;
    
    if (this.fpsText) {
      this.fpsText.setText(`fps: ${Math.round(fps)}`);
    }
    
    this.drawFPSIndicator(fps);
    
    if (this.isExpanded && this.panel) {
      this.panel.update();
    }
  }
  
  private drawFPSIndicator(fps: number): void {
    if (!this.fpsIndicator) return;
    
    this.fpsIndicator.clear();
    
    let color: number;
    if (fps >= 55) {
      color = 0x00ff00;
    } else if (fps >= 30) {
      color = 0xffff00;
    } else {
      color = 0xff0000;
    }
    
    // 绘制小圆点（半径6px）
    this.fpsIndicator.fillStyle(color, 1);
    this.fpsIndicator.fillCircle(0, 0, 5);
  }
  
  mount(): void {
    if (this.container) {
      this.container.setVisible(true);
    }
  }
  
  destroy(): void {
    if (this.updateTimer) {
      this.updateTimer.remove();
      this.updateTimer = null;
    }
    
    if (this.panel) {
      this.panel.destroy();
      this.panel = null;
    }
    
    super.destroy();
  }
}
