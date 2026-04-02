import { rtsEventBus } from '../events/core/RTSEventBus';
import { ZoneHistory, ZoneMoveAction } from '../history/ZoneHistory';
import type { TaskZone } from '../zones/TaskZone';

export class ZoneBatchOperations {
  static moveZones(
    zones: TaskZone[],
    deltaX: number,
    deltaY: number,
    history: ZoneHistory
  ): void {
    zones.forEach(zone => {
      const oldPos = { x: zone.x, y: zone.y };
      const newPos = { x: zone.x + deltaX, y: zone.y + deltaY };
      const action = new ZoneMoveAction(zone, oldPos, newPos);
      history.execute(action);
    });
  }

  static deleteZones(
    zones: TaskZone[],
    scene: any,
    showConfirmation: boolean = true
  ): void {
    if (zones.length === 0) return;

    if (showConfirmation) {
      rtsEventBus.emit('scene:ui:notification' as any, {
        message: `确认删除 ${zones.length} 个区域？`,
        type: 'warning',
      });
    }

    zones.forEach(zone => {
      if (zone.destroy) {
        zone.destroy();
      }
    });

    rtsEventBus.emit('zone:batch_deleted' as any, {
      count: zones.length,
      zoneIds: zones.map(z => z.getZoneId()),
    });
  }

  static duplicateZones(
    zones: TaskZone[],
    scene: any,
    offsetX: number = 20,
    offsetY: number = 20
  ): TaskZone[] {
    const duplicated: TaskZone[] = [];

    zones.forEach(zone => {
      const bounds = zone.getBounds();
      const config = {
        id: `${zone.getZoneId()}-copy-${Date.now()}`,
        x: zone.x + offsetX,
        y: zone.y + offsetY,
        width: bounds.width,
        height: bounds.height,
      };

      rtsEventBus.emit('zone:duplicate_requested' as any, {
        originalZoneId: zone.getZoneId(),
        config,
      });
    });

    return duplicated;
  }

  static selectZonesInRect(
    zones: TaskZone[],
    rect: Phaser.Geom.Rectangle
  ): TaskZone[] {
    return zones.filter(zone => {
      const zoneBounds = zone.getBounds();
      return Phaser.Geom.Rectangle.Overlaps(rect, zoneBounds);
    });
  }

  static alignZones(
    zones: TaskZone[],
    alignment: 'left' | 'right' | 'top' | 'bottom' | 'center_h' | 'center_v',
    history: ZoneHistory
  ): void {
    if (zones.length < 2) return;

    zones.forEach(zone => {
      const oldPos = { x: zone.x, y: zone.y };
      const newPos = { x: zone.x, y: zone.y };

      const bounds = zone.getBounds();
      const positions = {
        left: Math.min(...zones.map(z => z.x - z.getBounds().width / 2)),
        right: Math.max(...zones.map(z => z.x + z.getBounds().width / 2)),
        top: Math.min(...zones.map(z => z.y - z.getBounds().height / 2)),
        bottom: Math.max(...zones.map(z => z.y + z.getBounds().height / 2)),
        center_h: zones.reduce((sum, z) => sum + z.x, 0) / zones.length,
        center_v: zones.reduce((sum, z) => sum + z.y, 0) / zones.length,
      };

      switch (alignment) {
        case 'left':
          newPos.x = positions.left + bounds.width / 2;
          break;
        case 'right':
          newPos.x = positions.right - bounds.width / 2;
          break;
        case 'top':
          newPos.y = positions.top + bounds.height / 2;
          break;
        case 'bottom':
          newPos.y = positions.bottom - bounds.height / 2;
          break;
        case 'center_h':
          newPos.x = positions.center_h;
          break;
        case 'center_v':
          newPos.y = positions.center_v;
          break;
      }

      if (oldPos.x !== newPos.x || oldPos.y !== newPos.y) {
        const action = new ZoneMoveAction(zone, oldPos, newPos);
        history.execute(action);
      }
    });
  }
}