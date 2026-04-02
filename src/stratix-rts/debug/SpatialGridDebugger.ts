import type { SpatialHashGrid } from '../systems/SpatialHashGrid';

import { DebugRenderer } from './DebugRenderer';

export class SpatialGridDebugger extends DebugRenderer {
  private spatialGrid: SpatialHashGrid;
  private cellSize: number;
  
  constructor(scene: Phaser.Scene, spatialGrid: SpatialHashGrid, cellSize: number) {
    super(scene);
    this.spatialGrid = spatialGrid;
    this.cellSize = cellSize;
  }
  
  render(): void {
    if (!this.enabled) return;
    
    this.clear();
    
    const cells = this.spatialGrid.getAllCells();
    
    cells.forEach((agents, cellKey) => {
      const [cellX, cellY] = cellKey.split(',').map(Number);
      const worldX = cellX * this.cellSize;
      const worldY = cellY * this.cellSize;
      
      this.graphics.lineStyle(1, 0x444444, 0.3);
      this.graphics.strokeRect(worldX, worldY, this.cellSize, this.cellSize);
      
      const intensity = Math.min(agents.size / 5, 1);
      const color = Phaser.Display.Color.GetColor(
        255 * intensity,
        100 * (1 - intensity),
        0
      );
      
      this.graphics.fillStyle(color, 0.2);
      this.graphics.fillRect(worldX, worldY, this.cellSize, this.cellSize);
    });
  }
  
  highlightQueryArea(x: number, y: number, radius: number): void {
    this.graphics.lineStyle(2, 0x00ff00, 0.8);
    this.graphics.strokeCircle(x, y, radius);
  }
}
