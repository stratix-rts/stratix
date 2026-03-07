import type { AgentSprite } from '../sprites/AgentSprite';
import { DebugRenderer } from './DebugRenderer';
import type { CollisionSystem } from '../systems/CollisionSystem';

export class CollisionDebugger extends DebugRenderer {
  private collisionSystem: CollisionSystem;
  
  constructor(scene: Phaser.Scene, collisionSystem: CollisionSystem) {
    super(scene);
    this.collisionSystem = collisionSystem;
  }
  
  render(agents: Map<string, AgentSprite>): void {
    if (!this.enabled) return;
    
    this.clear();
    
    agents.forEach(agent => {
      const radius = this.collisionSystem.getCollisionRadius();
      
      this.graphics.lineStyle(1, 0x00ff00, 0.3);
      this.graphics.strokeCircle(agent.x, agent.y, radius);
      
      this.graphics.fillStyle(0x00ff00, 0.05);
      this.graphics.fillCircle(agent.x, agent.y, radius);
      
      const nearby = this.findCollidingAgents(agent, agents);
      if (nearby.length > 0) {
        this.graphics.lineStyle(2, 0xff0000, 0.8);
        this.graphics.strokeCircle(agent.x, agent.y, radius + 2);
        
        nearby.forEach(other => {
          this.graphics.lineStyle(1, 0xff0000, 0.5);
          this.graphics.lineBetween(agent.x, agent.y, other.x, other.y);
        });
      }
    });
  }
  
  private findCollidingAgents(
    agent: AgentSprite,
    allAgents: Map<string, AgentSprite>
  ): AgentSprite[] {
    const radius = this.collisionSystem.getCollisionRadius() * 2;
    const colliding: AgentSprite[] = [];
    const agentId = (agent as any).agentId || (agent as any).getAgentId?.();
    
    allAgents.forEach(other => {
      const otherId = (other as any).agentId || (other as any).getAgentId?.();
      if (agentId === otherId) return;
      
      const dx = other.x - agent.x;
      const dy = other.y - agent.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < radius) {
        colliding.push(other);
      }
    });
    
    return colliding;
  }
}
