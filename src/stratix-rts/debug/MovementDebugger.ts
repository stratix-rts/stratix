import type { AgentSprite } from '../sprites/AgentSprite';
import type { MovementSystem } from '../systems/MovementSystem';

import { DebugRenderer } from './DebugRenderer';

export class MovementDebugger extends DebugRenderer {
  private movementSystem: MovementSystem;
  private pathHistory: Map<string, Array<{x: number, y: number, time: number}>>;
  
  constructor(scene: Phaser.Scene, movementSystem: MovementSystem) {
    super(scene);
    this.movementSystem = movementSystem;
    this.pathHistory = new Map();
  }
  
  render(agents: Map<string, AgentSprite>): void {
    if (!this.enabled) return;
    
    this.clear();
    
    agents.forEach(agent => {
      const agentId = (agent as any).agentId || (agent as any).getAgentId?.();
      if (!agentId) return;
      
      const target = this.movementSystem.getTarget(agentId);
      
      if (target) {
        this.graphics.fillStyle(0x00ffff, 0.8);
        this.graphics.fillCircle(target.x, target.y, 5);
        
        this.graphics.lineStyle(2, 0x00ffff, 0.6);
        this.graphics.lineBetween(agent.x, agent.y, target.x, target.y);
        
        const angle = Phaser.Math.Angle.Between(
          agent.x, agent.y, target.x, target.y
        );
        this.drawArrow(agent.x, agent.y, angle, 20);
        
        this.recordPath(agentId, agent);
      }
    });
    
    this.renderPathHistory();
  }
  
  private drawArrow(x: number, y: number, angle: number, size: number): void {
    const arrow = [
      { x: size, y: 0 },
      { x: -size / 2, y: -size / 2 },
      { x: -size / 2, y: size / 2 }
    ];
    
    this.graphics.beginPath();
    arrow.forEach((point, i) => {
      const rotatedX = x + point.x * Math.cos(angle) - point.y * Math.sin(angle);
      const rotatedY = y + point.x * Math.sin(angle) + point.y * Math.cos(angle);
      
      if (i === 0) {
        this.graphics.moveTo(rotatedX, rotatedY);
      } else {
        this.graphics.lineTo(rotatedX, rotatedY);
      }
    });
    this.graphics.closePath();
    this.graphics.fillStyle(0x00ffff, 0.8);
    this.graphics.fillPath();
  }
  
  private recordPath(agentId: string, agent: AgentSprite): void {
    const history = this.pathHistory.get(agentId) || [];
    history.push({
      x: agent.x,
      y: agent.y,
      time: Date.now()
    });
    
    const cutoff = Date.now() - 2000;
    const filtered = history.filter(p => p.time > cutoff);
    this.pathHistory.set(agentId, filtered);
  }
  
  private renderPathHistory(): void {
    this.pathHistory.forEach(history => {
      if (history.length < 2) return;
      
      for (let i = 1; i < history.length; i++) {
        const alpha = i / history.length * 0.5;
        this.graphics.lineStyle(1, 0xffff00, alpha);
        this.graphics.lineBetween(
          history[i-1].x, history[i-1].y,
          history[i].x, history[i].y
        );
      }
    });
  }
}
