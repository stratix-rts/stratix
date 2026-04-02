import { rtsEventBus } from '../events/core/RTSEventBus';
import type { ZoneAction } from '../history/ZoneHistory';

import type { ZoneTemplate, ZoneTemplatePosition } from './ZoneTemplateManager';

export interface TemplateApplicationData {
  templateId: string;
  templateName: string;
  positions: ZoneTemplatePosition[];
  zones: Array<{
    zoneId: string;
    config: {
      id: string;
      name?: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
}

export class TemplateApplicationAction implements ZoneAction {
  id: string;
  type = 'create' as const;
  timestamp: number;
  zoneId: string;
  data: TemplateApplicationData;

  constructor(
    private zones: any[],
    private scene: any,
    private template: ZoneTemplate,
    private recreateZoneFn: (config: any) => Promise<any>
  ) {
    this.id = `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.timestamp = Date.now();
    this.zoneId = `template-${template.id}`;
    this.data = {
      templateId: template.id,
      templateName: template.name,
      positions: template.positions,
      zones: zones.map((zone, index) => ({
        zoneId: zone.getZoneId ? zone.getZoneId() : zone.id,
        config: {
          id: zone.getZoneId ? zone.getZoneId() : zone.id,
          name: zone.getZoneName ? zone.getZoneName() : zone.name,
          x: zone.x,
          y: zone.y,
          width: zone.zoneWidth || zone.width,
          height: zone.zoneHeight || zone.height
        }
      }))
    };
  }

  async undo(): Promise<void> {
    for (const zone of this.zones) {
      if (zone && zone.destroy) {
        zone.destroy();
      }
    }

    rtsEventBus.emit('template:undone' as any, {
      templateId: this.data.templateId,
      zoneIds: this.data.zones.map(z => z.zoneId),
      isUndo: true
    });

    for (const zoneData of this.data.zones) {
      rtsEventBus.emit('zone:deleted' as any, {
        zoneId: zoneData.zoneId,
        isUndo: true
      });
    }
  }

  async redo(): Promise<void> {
    this.zones = [];
    
    for (const zoneData of this.data.zones) {
      try {
        const zone = await this.recreateZoneFn(zoneData.config);
        this.zones.push(zone);

        rtsEventBus.emit('zone:created' as any, {
          zoneId: zoneData.zoneId,
          zoneConfig: zoneData.config,
          isRedo: true
        });
      } catch (error) {
        console.error('[TemplateApplicationAction] Failed to recreate zone:', error);
      }
    }

    rtsEventBus.emit('template:redone' as any, {
      templateId: this.data.templateId,
      zoneIds: this.data.zones.map(z => z.zoneId),
      isRedo: true
    });
  }
}