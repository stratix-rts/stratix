export interface DetailedPerformanceData {
  fps: {
    current: number;
    min: number;
    max: number;
    avg: number;
    frameTime: number;
    frameTimeHistory: number[];
    fpsHistory: number[];
  };
  
  agents: {
    total: number;
    moving: number;
    visible: number;
    thumbnail: number;
    full: number;
    byType: {
      writer: number;
      dev: number;
      analyst: number;
      custom: number;
    };
    byStatus: {
      online: number;
      busy: number;
      offline: number;
      error: number;
    };
  };
  
  collision: {
    enabled: boolean;
    spatialHashEnabled: boolean;
    checksPerFrame: number;
    timeMs: number;
    avgPerAgent: number;
    improvementPercent: number;
    cellSize: number;
    activeCells: number;
  };
  
  render: {
    mode: 'full' | 'thumbnail' | 'auto';
    viewportDensity: number;
    drawCalls: number;
    visibleAgents: number;
    thumbnailAgents: number;
    fullAgents: number;
    culledAgents: number;
  };
  
  ui: {
    componentCount: number;
    eventQueueSize: number;
    renderTimeMs: number;
    eventTimeMs: number;
    topBarStats: {
      updateCalls: number;
      redrawCalls: number;
    };
    minimapStats: {
      updateCalls: number;
      agentDrawn: number;
      zoneDrawn: number;
    };
  };
  
  memory?: {
    totalMB: number;
    texturesMB: number;
    spritesMB: number;
    objectCount: number;
    breakdown: {
      agents: number;
      zones: number;
      ui: number;
      textures: number;
      other: number;
    };
  };
  
  timestamp: number;
}

export class StatsCollector {
  private frameCount: number = 0;
  private lastTime: number = 0;
  private fpsHistory: number[] = [];
  private frameTimeHistory: number[] = [];
  private currentFPS: number = 60;
  
  private gameScene: any = null;
  private uiScene: any = null;
  private collisionSystem: any = null;
  private movementSystem: any = null;
  private renderModeSystem: any = null;
  
  private frameStartTime: number = 0;
  
  setGameScene(scene: any): void {
    this.gameScene = scene;
  }
  
  setUIScene(scene: any): void {
    this.uiScene = scene;
  }
  
  setCollisionSystem(system: any): void {
    this.collisionSystem = system;
  }
  
  setMovementSystem(system: any): void {
    this.movementSystem = system;
  }
  
  setRenderModeSystem(system: any): void {
    this.renderModeSystem = system;
  }
  
  beginFrame(): void {
    this.frameStartTime = performance.now();
    
    if (this.lastTime === 0) {
      this.lastTime = this.frameStartTime;
    }
  }
  
  endFrame(): void {
    const now = performance.now();
    const frameTime = now - this.lastTime;
    
    this.currentFPS = frameTime > 0 ? 1000 / frameTime : 60;
    
    this.fpsHistory.push(this.currentFPS);
    if (this.fpsHistory.length > 60) {
      this.fpsHistory.shift();
    }
    
    this.frameTimeHistory.push(frameTime);
    if (this.frameTimeHistory.length > 60) {
      this.frameTimeHistory.shift();
    }
    
    this.lastTime = now;
    this.frameCount++;
  }
  
  getStats(): DetailedPerformanceData {
    const fpsStats = this.calculateFPSStats();
    const agentStats = this.collectAgentStats();
    const collisionStats = this.collectCollisionStats();
    const renderStats = this.collectRenderStats();
    const uiStats = this.collectUIStats();
    const memoryStats = this.collectMemoryStats();
    
    const stats: DetailedPerformanceData = {
      fps: fpsStats,
      agents: agentStats,
      collision: collisionStats,
      render: renderStats,
      ui: uiStats,
      timestamp: Date.now()
    };
    
    if (memoryStats) {
      stats.memory = memoryStats;
    }
    
    return stats;
  }
  
  private calculateFPSStats(): DetailedPerformanceData['fps'] {
    const history = this.fpsHistory;
    
    if (history.length === 0) {
      return {
        current: 60,
        min: 60,
        max: 60,
        avg: 60,
        frameTime: 16.67,
        frameTimeHistory: [],
        fpsHistory: []
      };
    }
    
    const min = Math.min(...history);
    const max = Math.max(...history);
    const avg = history.reduce((a, b) => a + b, 0) / history.length;
    const frameTime = 1000 / this.currentFPS;
    
    return {
      current: this.currentFPS,
      min,
      max,
      avg,
      frameTime,
      frameTimeHistory: [...this.frameTimeHistory],
      fpsHistory: [...history]
    };
  }
  
  private collectAgentStats(): DetailedPerformanceData['agents'] {
    const stats = {
      total: 0,
      moving: 0,
      visible: 0,
      thumbnail: 0,
      full: 0,
      byType: {
        writer: 0,
        dev: 0,
        analyst: 0,
        custom: 0
      },
      byStatus: {
        online: 0,
        busy: 0,
        offline: 0,
        error: 0
      }
    };
    
    if (!this.gameScene || !this.gameScene.getAgentSprites) {
      return stats;
    }
    
    const agents = this.gameScene.getAgentSprites();
    if (!agents) return stats;
    
    stats.total = agents.size;
    
    agents.forEach((agent: any) => {
      if (agent.visible) stats.visible++;
      
      if (agent.getRenderMode) {
        const mode = agent.getRenderMode();
        if (mode === 'thumbnail') stats.thumbnail++;
        else stats.full++;
      }
      
      if (this.movementSystem && this.movementSystem.isMoving) {
        if (this.movementSystem.isMoving(agent.getAgentId())) {
          stats.moving++;
        }
      }
      
      const type = agent.getAgentType ? agent.getAgentType() : 'custom';
      if (type in stats.byType) {
        stats.byType[type as keyof typeof stats.byType]++;
      } else {
        stats.byType.custom++;
      }
      
      const status = agent.getCurrentStatus ? agent.getCurrentStatus() : 'online';
      if (status in stats.byStatus) {
        stats.byStatus[status as keyof typeof stats.byStatus]++;
      }
    });
    
    return stats;
  }
  
  private collectCollisionStats(): DetailedPerformanceData['collision'] {
    const stats = {
      enabled: true,
      spatialHashEnabled: false,
      checksPerFrame: 0,
      timeMs: 0,
      avgPerAgent: 0,
      improvementPercent: 0,
      cellSize: 0,
      activeCells: 0
    };
    
    if (!this.collisionSystem) {
      return stats;
    }
    
    stats.enabled = this.collisionSystem.isEnabled ? this.collisionSystem.isEnabled() : true;
    stats.spatialHashEnabled = this.collisionSystem.isSpatialHashEnabled ? 
      this.collisionSystem.isSpatialHashEnabled() : false;
    stats.checksPerFrame = this.collisionSystem.getCheckCount ? 
      this.collisionSystem.getCheckCount() : 0;
    stats.timeMs = this.collisionSystem.getLastTime ? 
      this.collisionSystem.getLastTime() : 0;
    
    if (this.gameScene && this.gameScene.getAgentSprites) {
      const agents = this.gameScene.getAgentSprites();
      if (agents && agents.size > 0) {
        stats.avgPerAgent = stats.checksPerFrame / agents.size;
        
        const bruteForce = (agents.size * (agents.size - 1)) / 2;
        if (bruteForce > 0 && stats.checksPerFrame > 0) {
          stats.improvementPercent = ((bruteForce - stats.checksPerFrame) / bruteForce) * 100;
        }
      }
    }
    
    return stats;
  }
  
  private collectRenderStats(): DetailedPerformanceData['render'] {
    const stats = {
      mode: 'auto' as 'full' | 'thumbnail' | 'auto',
      viewportDensity: 0,
      drawCalls: 0,
      visibleAgents: 0,
      thumbnailAgents: 0,
      fullAgents: 0,
      culledAgents: 0
    };
    
    if (!this.renderModeSystem) {
      return stats;
    }
    
    stats.mode = this.renderModeSystem.getCurrentMode ? 
      this.renderModeSystem.getCurrentMode() : 'auto';
    stats.viewportDensity = this.renderModeSystem.getLastDensity ? 
      this.renderModeSystem.getLastDensity() : 0;
    
    if (this.gameScene && this.gameScene.getAgentSprites) {
      const agents = this.gameScene.getAgentSprites();
      if (agents) {
        agents.forEach((agent: any) => {
          if (agent.visible) {
            stats.visibleAgents++;
            if (agent.getRenderMode) {
              if (agent.getRenderMode() === 'thumbnail') {
                stats.thumbnailAgents++;
              } else {
                stats.fullAgents++;
              }
            }
          } else {
            stats.culledAgents++;
          }
        });
      }
    }
    
    return stats;
  }
  
  private collectUIStats(): DetailedPerformanceData['ui'] {
    const stats = {
      componentCount: 0,
      eventQueueSize: 0,
      renderTimeMs: 0,
      eventTimeMs: 0,
      topBarStats: {
        updateCalls: 0,
        redrawCalls: 0
      },
      minimapStats: {
        updateCalls: 0,
        agentDrawn: 0,
        zoneDrawn: 0
      }
    };
    
    stats.componentCount = 4;
    
    return stats;
  }
  
  private collectMemoryStats(): DetailedPerformanceData['memory'] | undefined {
    const perf = performance as any;
    
    if (!perf.memory) {
      return undefined;
    }
    
    return {
      totalMB: perf.memory.usedJSHeapSize / (1024 * 1024),
      texturesMB: 0,
      spritesMB: 0,
      objectCount: 0,
      breakdown: {
        agents: 0,
        zones: 0,
        ui: 0,
        textures: 0,
        other: 0
      }
    };
  }
  
  reset(): void {
    this.frameCount = 0;
    this.lastTime = 0;
    this.fpsHistory = [];
    this.frameTimeHistory = [];
    this.currentFPS = 60;
  }
  
  getFrameCount(): number {
    return this.frameCount;
  }
}
