import Phaser from 'phaser';
import { BaseZone } from './BaseZone';
import { TaskZone } from './TaskZone';
import { ProjectZone } from '../../stratix-project/core/ProjectZone';
import { ZoneSpatialIndex, SpatialZone } from '../spatial/ZoneSpatialIndex';

export type ZoneType = 'task' | 'project' | 'unknown';

export class UnifiedZoneManager {
  private zones: Map<string, BaseZone> = new Map();
  private spatialIndex: ZoneSpatialIndex;
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.spatialIndex = new ZoneSpatialIndex(100);
  }

  register(zone: BaseZone): boolean {
    if (this.zones.has(zone.getZoneId())) {
      console.warn(`[UnifiedZoneManager] Zone already registered: ${zone.getZoneId()}`);
      return false;
    }

    this.zones.set(zone.getZoneId(), zone);
    this.updateSpatialIndex(zone);

    zone.on('position-changed', () => {
      this.updateSpatialIndex(zone);
    });

    return true;
  }

  unregister(zoneId: string): void {
    const zone = this.zones.get(zoneId);
    if (zone) {
      zone.off('position-changed');
    }

    this.zones.delete(zoneId);
    this.spatialIndex.remove(zoneId);
  }

  getZone(zoneId: string): BaseZone | undefined {
    return this.zones.get(zoneId);
  }

  getAllZones(): Map<string, BaseZone> {
    return new Map(this.zones);
  }

  getZonesByType<T extends BaseZone>(type: new (...args: any[]) => T): T[] {
    const result: T[] = [];
    this.zones.forEach(zone => {
      if (zone instanceof type) {
        result.push(zone);
      }
    });
    return result;
  }

  getTaskZones(): Map<string, TaskZone> {
    const taskZones = new Map<string, TaskZone>();
    this.zones.forEach((zone, id) => {
      if (zone instanceof TaskZone) {
        taskZones.set(id, zone);
      }
    });
    return taskZones;
  }

  getProjectZones(): Map<string, ProjectZone> {
    const projectZones = new Map<string, ProjectZone>();
    this.zones.forEach((zone, id) => {
      if (zone instanceof ProjectZone) {
        projectZones.set(id, zone);
      }
    });
    return projectZones;
  }

  getZoneType(zoneId: string): ZoneType {
    const zone = this.zones.get(zoneId);
    if (!zone) return 'unknown';

    if (zone instanceof TaskZone) return 'task';
    if (zone instanceof ProjectZone) return 'project';

    return 'unknown';
  }

  checkOverlap(rect: Phaser.Geom.Rectangle, excludeZoneId?: string): boolean {
    const spatialZone: SpatialZone = {
      id: 'query',
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };

    const overlapping = this.spatialIndex.queryOverlappingZones(spatialZone);

    return overlapping.some(sz => {
      if (excludeZoneId && sz.id === excludeZoneId) {
        return false;
      }

      const actualZone = this.zones.get(sz.id);
      if (!actualZone) return false;

      return actualZone.overlapsRect?.(rect) ??
        Phaser.Geom.Rectangle.Overlaps(rect, actualZone.getBounds());
    });
  }

  updateSpatialIndex(zone: BaseZone): void {
    const bounds = zone.getBounds();

    const spatialZone: SpatialZone = {
      id: zone.getZoneId(),
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    };

    if (this.spatialIndex.getZone(zone.getZoneId())) {
      this.spatialIndex.update(spatialZone);
    } else {
      this.spatialIndex.insert(spatialZone);
    }
  }

  getZoneAtPoint(worldX: number, worldY: number): BaseZone | undefined {
    const candidates = this.spatialIndex.queryPoint(worldX, worldY);

    for (const spatialZone of candidates) {
      const zone = this.zones.get(spatialZone.id);
      if (zone && zone.containsPoint(worldX, worldY)) {
        return zone;
      }
    }

    return undefined;
  }

  rebuildSpatialIndex(): void {
    this.spatialIndex.clear();
    this.zones.forEach(zone => this.updateSpatialIndex(zone));
  }

  getStatistics() {
    return {
      totalZones: this.zones.size,
      spatialIndex: this.spatialIndex.getStatistics(),
      zoneTypes: {
        task: this.getZonesByType(TaskZone).length,
        project: this.getZonesByType(ProjectZone).length
      }
    };
  }

  destroy(): void {
    this.zones.forEach(zone => {
      zone.off('position-changed');
    });
    this.zones.clear();
    this.spatialIndex.clear();
  }
}
