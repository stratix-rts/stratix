import Phaser from 'phaser';
import { EnhancedUIComponent } from '@/stratix-core/ui/components/base/EnhancedUIComponent';
import type { StatsCollector, DetailedPerformanceData } from '../../debug/StatsCollector';

export class PerformancePanel extends EnhancedUIComponent {
  private statsCollector: StatsCollector;
  private contentContainer: Phaser.GameObjects.Container | null = null;
  private scrollY: number = 0;
  private contentHeight: number = 0;
  
  private clipContainer: Phaser.GameObjects.Container | null = null;
  
  // 动态更新的文本
  private fpsTexts: {
    current?: Phaser.GameObjects.Text;
    avg?: Phaser.GameObjects.Text;
  } = {};
  private agentTexts: {
    summary?: Phaser.GameObjects.Text;
  } = {};
  private collisionTexts: {
    checks?: Phaser.GameObjects.Text;
  } = {};
  private renderTexts: {
    mode?: Phaser.GameObjects.Text;
  } = {};
  
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    statsCollector: StatsCollector
  ) {
    super(scene, { x, y, width, height, reactiveTheme: true });
    this.statsCollector = statsCollector;
  }
  
  create(): void {
    this.container = this.scene.add.container(this.config.x, this.config.y);
    this.container.setScrollFactor(0, 0);
    this.container.setDepth(1002);
    
    this.createBackground();
    this.createHeader();
    this.createScrollableContent();
    this.setupScrolling();
    
    this.onCreate();
  }
  
  private createBackground(): void {
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x1a1a2e, 0.95);
    bg.fillRoundedRect(0, 0, this.config.width || 400, this.config.height || 600, 8);
    bg.lineStyle(1, 0x4a4a6a, 0.8);
    bg.strokeRoundedRect(0, 0, this.config.width || 400, this.config.height || 600, 8);
    (this.container as Phaser.GameObjects.Container).add(bg);
  }
  
  private createHeader(): void {
    const header = this.scene.add.container(0, 0);
    
    const title = this.scene.add.text(10, 10, '📊 Performance Monitor', {
      fontSize: '16px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffffff',
      fontStyle: 'bold'
    });
    header.add(title);
    
    const closeBtn = this.scene.add.text((this.config.width || 400) - 30, 10, '✕', {
      fontSize: '16px',
      fontFamily: 'Arial, sans-serif',
      color: '#ff6666',
      fontStyle: 'bold'
    });
    closeBtn.setInteractive({ useHandCursor: true });
    closeBtn.on('pointerdown', () => {
      if (this.container) {
        this.container.setVisible(false);
      }
    });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ff0000'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#ff6666'));
    header.add(closeBtn);
    
    (this.container as Phaser.GameObjects.Container).add(header);
  }
  
  private createScrollableContent(): void {
    // 创建剪裁容器（固定大小）
    this.clipContainer = this.scene.add.container(0, 40);
    (this.container as Phaser.GameObjects.Container).add(this.clipContainer);
    
    // 先创建并应用遮罩（在添加内容之前）
    this.applyClippingMask();
    
    // 创建内容容器（可滚动）
    this.contentContainer = this.scene.add.container(5, 0);
    this.clipContainer.add(this.contentContainer);
    
    let yOffset = 0;
    
    try {
      const fpsSection = this.createFPSSection(0, yOffset);
      this.contentContainer.add(fpsSection);
      yOffset += 80;
      
      const agentSection = this.createAgentSection(0, yOffset);
      this.contentContainer.add(agentSection);
      yOffset += 80;
      
      const collisionSection = this.createCollisionSection(0, yOffset);
      this.contentContainer.add(collisionSection);
      yOffset += 80;
      
      const renderSection = this.createRenderSection(0, yOffset);
      this.contentContainer.add(renderSection);
      yOffset += 80;
      
      const debugSection = this.createDebugSection(0, yOffset);
      this.contentContainer.add(debugSection);
      yOffset += 80;
      
      const suggestionsSection = this.createSuggestionsSection(0, yOffset);
      this.contentContainer.add(suggestionsSection);
      
      this.contentHeight = yOffset + 60;
      
      // 应用遮罩到剪裁容器
      this.applyClippingMask();
      
      console.log('[PerformancePanel] Content created successfully', {
        sections: this.contentContainer.length,
        contentHeight: this.contentHeight
      });
    } catch (error) {
      console.error('[PerformancePanel] Error creating content:', error);
    }
  }
  
  private applyClippingMask(): void {
    // 暂时移除遮罩，Phaser 几何遮罩有坐标系问题
    // 内容可能超出面板，但滚动功能正常
    console.log('[PerformancePanel] Clipping disabled');
  }
  
  private createFPSSection(x: number, y: number): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    
    const title = this.scene.add.text(0, 0, '🎮 帧率 (Frame Rate)', {
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      color: '#00ffff',
      fontStyle: 'bold'
    });
    container.add(title);
    
    const stats = this.statsCollector.getStats();
    const fps = stats.fps;
    
    this.fpsTexts.current = this.scene.add.text(0, 25, 
      `当前: ${Math.round(fps.current)} FPS    最小: ${Math.round(fps.min)}    最大: ${Math.round(fps.max)}`, {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: '#cccccc'
    });
    container.add(this.fpsTexts.current);
    
    this.fpsTexts.avg = this.scene.add.text(0, 45, 
      `平均: ${fps.avg.toFixed(1)} FPS  帧时间: ${fps.frameTime.toFixed(1)}ms`, {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: '#aaaaaa'
    });
    container.add(this.fpsTexts.avg);
    
    return container;
  }
  
  private createAgentSection(x: number, y: number): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    
    const title = this.scene.add.text(0, 0, '👥 Agent 统计', {
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      color: '#00ffff',
      fontStyle: 'bold'
    });
    container.add(title);
    
    const stats = this.statsCollector.getStats();
    const agents = stats.agents;
    
    this.agentTexts.summary = this.scene.add.text(0, 25, 
      `总数: ${agents.total}    移动中: ${agents.moving}    可见: ${agents.visible}`, {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: '#cccccc'
    });
    container.add(this.agentTexts.summary);
    
    const thumbnail = this.scene.add.text(0, 45, 
      `缩略图: ${agents.thumbnail}  完整模式: ${agents.full}`, {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: '#aaaaaa'
    });
    container.add(thumbnail);
    
    return container;
  }
  
  private createCollisionSection(x: number, y: number): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    
    const title = this.scene.add.text(0, 0, '💥 碰撞检测 (Collision)', {
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      color: '#00ffff',
      fontStyle: 'bold'
    });
    container.add(title);
    
    const stats = this.statsCollector.getStats();
    const collision = stats.collision;
    
    this.collisionTexts.checks = this.scene.add.text(0, 25, 
      `检测次数: ${collision.checksPerFrame}    时间: ${collision.timeMs.toFixed(2)}ms`, {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: '#cccccc'
    });
    container.add(this.collisionTexts.checks);
    
    const avg = this.scene.add.text(0, 45, 
      `平均/Agent: ${collision.avgPerAgent.toFixed(2)}ms`, {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: '#aaaaaa'
    });
    container.add(avg);
    
    return container;
  }
  
  private createRenderSection(x: number, y: number): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    
    const title = this.scene.add.text(0, 0, '🎨 渲染系统 (Render)', {
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      color: '#00ffff',
      fontStyle: 'bold'
    });
    container.add(title);
    
    const stats = this.statsCollector.getStats();
    const render = stats.render;
    
    this.renderTexts.mode = this.scene.add.text(0, 25, 
      `模式: ${render.mode}    视口密度: ${render.viewportDensity}`, {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: '#cccccc'
    });
    container.add(this.renderTexts.mode);
    
    const drawCalls = this.scene.add.text(0, 45, 
      `Draw Calls: ${render.drawCalls}    可见Agent: ${render.visibleAgents}`, {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: '#aaaaaa'
    });
    container.add(drawCalls);
    
    return container;
  }
  
  private createDebugSection(x: number, y: number): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    
    const title = this.scene.add.text(0, 0, '🔧 调试工具 (Debug Tools)', {
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      color: '#00ffff',
      fontStyle: 'bold'
    });
    container.add(title);
    
    const info = this.scene.add.text(0, 25, 
      '调试信息收集工具已启用', {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: '#cccccc'
    });
    container.add(info);
    
    return container;
  }
  
  private createSuggestionsSection(x: number, y: number): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    
    const title = this.scene.add.text(0, 0, '💡 性能建议 (Suggestions)', {
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      color: '#00ffff',
      fontStyle: 'bold'
    });
    container.add(title);
    
    const info = this.scene.add.text(0, 25, 
      '性能良好，继续保持！', {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: '#00ff00'
    });
    container.add(info);
    
    return container;
  }
  
  private setupScrolling(): void {
    const headerHeight = 40;
    const panelHeight = this.config.height || 600;
    const maxScroll = Math.max(0, this.contentHeight - (panelHeight - headerHeight));
    
    (this.container as Phaser.GameObjects.Container).on('wheel', (pointer: any, deltaX: number, deltaY: number) => {
      if (this.contentContainer) {
        this.scrollY = Phaser.Math.Clamp(
          this.scrollY - deltaY * 0.5,
          -maxScroll,
          0
        );
        this.contentContainer.setY(this.scrollY);
      }
    });
  }
  
  setVisible(visible: boolean): void {
    if (this.container) {
      this.container.setVisible(visible);
    }
  }
  
  update(): void {
    const stats = this.statsCollector.getStats();
    
    // 更新 FPS 文本
    if (this.fpsTexts.current) {
      const fps = stats.fps;
      this.fpsTexts.current.setText(
        `当前: ${Math.round(fps.current)} FPS    最小: ${Math.round(fps.min)}    最大: ${Math.round(fps.max)}`
      );
    }
    if (this.fpsTexts.avg) {
      const fps = stats.fps;
      this.fpsTexts.avg.setText(
        `平均: ${fps.avg.toFixed(1)} FPS  帧时间: ${fps.frameTime.toFixed(1)}ms`
      );
    }
    
    // 更新 Agent 文本
    if (this.agentTexts.summary) {
      const agents = stats.agents;
      this.agentTexts.summary.setText(
        `总数: ${agents.total}    移动中: ${agents.moving}    可见: ${agents.visible}`
      );
    }
    
    // 更新碰撞文本
    if (this.collisionTexts.checks) {
      const collision = stats.collision;
      this.collisionTexts.checks.setText(
        `检测次数: ${collision.checksPerFrame}    时间: ${collision.timeMs.toFixed(2)}ms`
      );
    }
    
    // 更新渲染文本
    if (this.renderTexts.mode) {
      const render = stats.render;
      this.renderTexts.mode.setText(
        `模式: ${render.mode}    视口密度: ${render.viewportDensity}`
      );
    }
  }
  
  destroy(): void {
    if (this.contentContainer) {
      this.contentContainer.destroy();
      this.contentContainer = null;
    }
    
    super.destroy();
  }
}
