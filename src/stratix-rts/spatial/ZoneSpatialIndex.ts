export interface SpatialZone {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SpatialCell {
  zones: Set<string>;
}

export class ZoneSpatialIndex {
  private cellSize: number;
  private grid: Map<string, SpatialCell> = new Map();
  private zones: Map<string, SpatialZone> = new Map();

  constructor(cellSize: number = 100) {
    this.cellSize = cellSize;
  }

  insert(zone: SpatialZone): void {
    this.zones.set(zone.id, zone);
    
    const cells = this.getZoneCells(zone);
    cells.forEach(cellKey => {
      if (!this.grid.has(cellKey)) {
        this.grid.set(cellKey, { zones: new Set() });
      }
      this.grid.get(cellKey)!.zones.add(zone.id);
    });
  }

  remove(zoneId: string): void {
    const zone = this.zones.get(zoneId);
    if (!zone) return;

    const cells = this.getZoneCells(zone);
    cells.forEach(cellKey => {
      const cell = this.grid.get(cellKey);
      if (cell) {
        cell.zones.delete(zoneId);
        if (cell.zones.size === 0) {
          this.grid.delete(cellKey);
        }
      }
    });

    this.zones.delete(zoneId);
  }

  update(zone: SpatialZone): void {
    this.remove(zone.id);
    this.insert(zone);
  }

  queryOverlappingZones(zone: SpatialZone): SpatialZone[] {
    const cells = this.getZoneCells(zone);
    const candidateIds = new Set<string>();
    
    cells.forEach(cellKey => {
      const cell = this.grid.get(cellKey);
      if (cell) {
        cell.zones.forEach(id => {
          if (id !== zone.id) {
            candidateIds.add(id);
          }
        });
      }
    });

    const overlappingZones: SpatialZone[] = [];
    candidateIds.forEach(id => {
      const candidate = this.zones.get(id);
      if (candidate && this.checkOverlap(zone, candidate)) {
        overlappingZones.push(candidate);
      }
    });

    return overlappingZones;
  }

  queryPoint(x: number, y: number): SpatialZone[] {
    const cellKey = this.getCellKey(
      Math.floor(x / this.cellSize),
      Math.floor(y / this.cellSize)
    );
    
    const cell = this.grid.get(cellKey);
    if (!cell) return [];

    const result: SpatialZone[] = [];
    cell.zones.forEach(id => {
      const zone = this.zones.get(id);
      if (zone && this.pointInZone(x, y, zone)) {
        result.push(zone);
      }
    });

    return result;
  }

  queryRegion(x: number, y: number, width: number, height: number): SpatialZone[] {
    const queryZone: SpatialZone = { id: 'query', x, y, width, height };
    return this.queryOverlappingZones(queryZone);
  }

  getAllZones(): SpatialZone[] {
    return Array.from(this.zones.values());
  }

  getZone(zoneId: string): SpatialZone | undefined {
    return this.zones.get(zoneId);
  }

  clear(): void {
    this.grid.clear();
    this.zones.clear();
  }

  getStatistics(): { zoneCount: number; cellCount: number; averageZonesPerCell: number } {
    let totalZonesInCells = 0;
    this.grid.forEach(cell => {
      totalZonesInCells += cell.zones.size;
    });

    return {
      zoneCount: this.zones.size,
      cellCount: this.grid.size,
      averageZonesPerCell: this.grid.size > 0 ? totalZonesInCells / this.grid.size : 0
    };
  }

  private getZoneCells(zone: SpatialZone): string[] {
    const cells: string[] = [];
    
    const startCol = Math.floor(zone.x / this.cellSize);
    const endCol = Math.floor((zone.x + zone.width) / this.cellSize);
    const startRow = Math.floor(zone.y / this.cellSize);
    const endRow = Math.floor((zone.y + zone.height) / this.cellSize);

    for (let col = startCol; col <= endCol; col++) {
      for (let row = startRow; row <= endRow; row++) {
        cells.push(this.getCellKey(col, row));
      }
    }

    return cells;
  }

  private getCellKey(col: number, row: number): string {
    return `${col},${row}`;
  }

  private checkOverlap(a: SpatialZone, b: SpatialZone): boolean {
    return !(
      a.x + a.width <= b.x ||
      b.x + b.width <= a.x ||
      a.y + a.height <= b.y ||
      b.y + b.height <= a.y
    );
  }

  private pointInZone(x: number, y: number, zone: SpatialZone): boolean {
    return (
      x >= zone.x &&
      x <= zone.x + zone.width &&
      y >= zone.y &&
      y <= zone.y + zone.height
    );
  }
}