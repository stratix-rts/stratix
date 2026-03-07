import Phaser from 'phaser';
import type { AgentSprite } from '../sprites/AgentSprite';

export type RenderMode = 'full' | 'thumbnail' | 'auto';

interface RenderModeConfig {
  densityThreshold: number;
  showNames: boolean;
}

export class RenderModeSystem {
  private currentMode: RenderMode = 'auto';
  private userPreference: RenderMode | null = null;
  private config: RenderModeConfig = {
    densityThreshold: 30,
    showNames: true
  };
  private viewportBuffer: number = 100;
  private lastDensityCheck: number = 0;
  private densityCheckInterval: number = 500;

  setUserMode(mode: RenderMode | null): void {
    this.userPreference = mode;
  }

  getUserMode(): RenderMode | null {
    return this.userPreference;
  }

  getCurrentMode(): RenderMode {
    return this.currentMode;
  }

  setDensityThreshold(threshold: number): void {
    this.config.densityThreshold = Math.max(10, Math.min(100, threshold));
  }

  getDensityThreshold(): number {
    return this.config.densityThreshold;
  }

  setShowNames(show: boolean): void {
    this.config.showNames = show;
  }

  getShowNames(): boolean {
    return this.config.showNames;
  }

  update(
    agents: Map<string, AgentSprite>,
    camera: Phaser.Cameras.Scene2D.Camera,
    time: number
  ): void {
    if (this.userPreference !== null) {
      this.currentMode = this.userPreference;
    } else {
      if (time - this.lastDensityCheck > this.densityCheckInterval) {
        const density = this.calculateViewportDensity(agents, camera);
        this.currentMode = density > this.config.densityThreshold ? 'thumbnail' : 'full';
        this.lastDensityCheck = time;
      }
    }

    this.applyModeToAgents(agents, camera);
  }

  private calculateViewportDensity(
    agents: Map<string, AgentSprite>,
    camera: Phaser.Cameras.Scene2D.Camera
  ): number {
    let count = 0;

    const bounds = {
      left: camera.scrollX - this.viewportBuffer,
      right: camera.scrollX + camera.width + this.viewportBuffer,
      top: camera.scrollY - this.viewportBuffer,
      bottom: camera.scrollY + camera.height + this.viewportBuffer
    };

    agents.forEach(agent => {
      if (
        agent.x >= bounds.left &&
        agent.x <= bounds.right &&
        agent.y >= bounds.top &&
        agent.y <= bounds.bottom
      ) {
        count++;
      }
    });

    return count;
  }

  private applyModeToAgents(
    agents: Map<string, AgentSprite>,
    camera: Phaser.Cameras.Scene2D.Camera
  ): void {
    const bounds = {
      left: camera.scrollX - this.viewportBuffer,
      right: camera.scrollX + camera.width + this.viewportBuffer,
      top: camera.scrollY - this.viewportBuffer,
      bottom: camera.scrollY + camera.height + this.viewportBuffer
    };

    agents.forEach(agent => {
      const inViewport = 
        agent.x >= bounds.left &&
        agent.x <= bounds.right &&
        agent.y >= bounds.top &&
        agent.y <= bounds.bottom;

      if (!inViewport) {
        agent.setVisible(false);
        agent.setActive(false);
      } else {
        agent.setVisible(true);
        agent.setActive(true);
        
        if ('setRenderMode' in agent && typeof agent.setRenderMode === 'function') {
          (agent as any).setRenderMode(this.currentMode);
        }
        
        if ('setShowName' in agent && typeof agent.setShowName === 'function') {
          (agent as any).setShowName(this.config.showNames);
        }
      }
    });
  }

  forceMode(mode: RenderMode): void {
    this.currentMode = mode;
  }

  reset(): void {
    this.userPreference = null;
    this.currentMode = 'auto';
    this.lastDensityCheck = 0;
  }
}
