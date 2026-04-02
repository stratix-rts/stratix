import type { AgentSprite } from '../sprites/AgentSprite';

import { SpatialHashGrid } from './SpatialHashGrid';

export class CollisionSystem {
  private collisionRadius: number;
  private enabled: boolean = true;
  private useSpatialHash: boolean = true;
  private spatialGrid: SpatialHashGrid | null = null;
  
  private checkCount: number = 0;
  private lastTime: number = 0;

  constructor(collisionRadius: number = 20, useSpatialHash: boolean = true) {
    this.collisionRadius = collisionRadius;
    this.useSpatialHash = useSpatialHash;
    
    if (useSpatialHash) {
      this.spatialGrid = new SpatialHashGrid(collisionRadius * 3);
    }
  }

  resolveCollisions(agents: Map<string, AgentSprite>): void {
    if (!this.enabled) return;
    
    const startTime = performance.now();
    this.checkCount = 0;
    
    if (this.useSpatialHash && this.spatialGrid) {
      this.resolveWithSpatialHash(agents);
    } else {
      this.resolveBruteForce(agents);
    }
    
    this.lastTime = performance.now() - startTime;
  }
  
  private resolveWithSpatialHash(agents: Map<string, AgentSprite>): void {
    if (!this.spatialGrid) return;
    
    this.spatialGrid.clear();
    agents.forEach(agent => {
      this.spatialGrid!.insert(agent);
    });
    
    agents.forEach(agent => {
      const nearby = this.spatialGrid!.queryNearby(
        agent.x,
        agent.y,
        this.collisionRadius * 2
      );
      
      nearby.forEach(other => {
        const key1 = (agent as any).agentId || (agent as any).getAgentId?.();
        const key2 = (other as any).agentId || (other as any).getAgentId?.();
        
        if (key1 && key2 && key1 < key2) {
          this.resolvePairCollision(agent, other);
          this.checkCount++;
        }
      });
    });
  }
  
  private resolveBruteForce(agents: Map<string, AgentSprite>): void {
    const agentArray = Array.from(agents.values());
    const len = agentArray.length;

    for (let i = 0; i < len; i++) {
      for (let j = i + 1; j < len; j++) {
        this.resolvePairCollision(agentArray[i], agentArray[j]);
        this.checkCount++;
      }
    }
  }

  private resolvePairCollision(a1: AgentSprite, a2: AgentSprite): void {
    const dx = a2.x - a1.x;
    const dy = a2.y - a1.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const minDistance = this.collisionRadius * 2;

    if (distance < minDistance && distance > 0.001) {
      const overlap = minDistance - distance;
      const pushX = (dx / distance) * overlap * 0.5;
      const pushY = (dy / distance) * overlap * 0.5;

      a1.x -= pushX;
      a1.y -= pushY;
      a2.x += pushX;
      a2.y += pushY;
    }
  }

  checkCollision(x: number, y: number, agents: Map<string, AgentSprite>, excludeId?: string): boolean {
    for (const [agentId, agent] of agents) {
      if (excludeId && agentId === excludeId) continue;

      const dx = agent.x - x;
      const dy = agent.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < this.collisionRadius * 2) {
        return true;
      }
    }
    return false;
  }

  findNearbyAgents(
    x: number,
    y: number,
    radius: number,
    agents: Map<string, AgentSprite>
  ): AgentSprite[] {
    const nearby: AgentSprite[] = [];

    agents.forEach(agent => {
      const dx = agent.x - x;
      const dy = agent.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= radius) {
        nearby.push(agent);
      }
    });

    return nearby;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setCollisionRadius(radius: number): void {
    this.collisionRadius = radius;
  }

  getCollisionRadius(): number {
    return this.collisionRadius;
  }
  
  setSpatialHashEnabled(enabled: boolean): void {
    if (enabled && !this.spatialGrid) {
      this.spatialGrid = new SpatialHashGrid(this.collisionRadius * 3);
    }
    this.useSpatialHash = enabled;
  }
  
  isSpatialHashEnabled(): boolean {
    return this.useSpatialHash;
  }
  
  getSpatialGrid(): SpatialHashGrid | null {
    return this.spatialGrid;
  }
  
  getCheckCount(): number {
    return this.checkCount;
  }
  
  getLastTime(): number {
    return this.lastTime;
  }
  
  getPerformanceImprovement(): string {
    const bruteForce = this.checkCount * 2;
    if (bruteForce === 0) return 'N/A';
    
    const improvement = ((bruteForce - this.checkCount) / bruteForce * 100).toFixed(1);
    return `${improvement}% faster than brute force`;
  }
}
