import type { AgentSprite } from '../sprites/AgentSprite';

export class SpatialHashGrid {
  private cellSize: number;
  private cells: Map<string, Set<AgentSprite>>;
  private agentToCell: Map<string, string>;

  constructor(cellSize: number = 64) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.agentToCell = new Map();
  }

  clear(): void {
    this.cells.clear();
    this.agentToCell.clear();
  }

  insert(agent: AgentSprite): void {
    const key = (agent as any).agentId || (agent as any).getAgentId();
    if (!key) return;
    
    const cellKey = this.getCellKey(agent.x, agent.y);
    
    if (!this.cells.has(cellKey)) {
      this.cells.set(cellKey, new Set());
    }
    
    this.cells.get(cellKey)!.add(agent);
    this.agentToCell.set(key, cellKey);
  }

  update(agent: AgentSprite): void {
    const key = (agent as any).agentId || (agent as any).getAgentId?.();
    if (!key) return;
    
    const oldKey = this.agentToCell.get(key);
    const newKey = this.getCellKey(agent.x, agent.y);
    
    if (oldKey !== newKey) {
      if (oldKey && this.cells.has(oldKey)) {
        this.cells.get(oldKey)!.delete(agent);
        if (this.cells.get(oldKey)!.size === 0) {
          this.cells.delete(oldKey);
        }
      }
      this.insert(agent);
    }
  }

  remove(agentId: string): void {
    const cellKey = this.agentToCell.get(agentId);
    if (cellKey && this.cells.has(cellKey)) {
      const cellAgents = this.cells.get(cellKey)!;
      cellAgents.forEach(agent => {
        const key = (agent as any).agentId || (agent as any).getAgentId?.();
        if (key === agentId) {
          cellAgents.delete(agent);
        }
      });
      
      if (cellAgents.size === 0) {
        this.cells.delete(cellKey);
      }
    }
    this.agentToCell.delete(agentId);
  }

  queryNearby(x: number, y: number, radius: number): AgentSprite[] {
    const nearby: AgentSprite[] = [];
    const cellsToCheck = this.getCellsInRadius(x, y, radius);
    
    cellsToCheck.forEach(cellKey => {
      const cellAgents = this.cells.get(cellKey);
      if (cellAgents) {
        nearby.push(...Array.from(cellAgents));
      }
    });
    
    return nearby;
  }

  getAllCells(): Map<string, Set<AgentSprite>> {
    return this.cells;
  }

  getActiveCellCount(): number {
    return this.cells.size;
  }

  getCellSize(): number {
    return this.cellSize;
  }

  private getCellKey(x: number, y: number): string {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    return `${cellX},${cellY}`;
  }

  private getCellsInRadius(x: number, y: number, radius: number): string[] {
    const cells: string[] = [];
    const cellRadius = Math.ceil(radius / this.cellSize);
    const centerCellX = Math.floor(x / this.cellSize);
    const centerCellY = Math.floor(y / this.cellSize);
    
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        cells.push(`${centerCellX + dx},${centerCellY + dy}`);
      }
    }
    
    return cells;
  }

  getStats(): { activeCells: number; totalAgents: number; avgAgentsPerCell: number } {
    let totalAgents = 0;
    this.cells.forEach(agents => {
      totalAgents += agents.size;
    });
    
    return {
      activeCells: this.cells.size,
      totalAgents,
      avgAgentsPerCell: this.cells.size > 0 ? totalAgents / this.cells.size : 0
    };
  }
}
