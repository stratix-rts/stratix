import { rtsEventBus } from '../events/core/RTSEventBus';

import type { BaseZoneConfig, ZoneStatus } from './BaseZone';
import type { TaskZoneType } from './TaskZone';

export interface ZoneTemplatePosition {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  taskType?: TaskZoneType;
  status?: ZoneStatus;
}

export interface ZoneTemplate {
  id: string;
  name: string;
  description: string;
  category: 'grid' | 'linear' | 'circular' | 'custom';
  positions: ZoneTemplatePosition[];
  metadata?: {
    author?: string;
    version?: string;
    tags?: string[];
    createdAt?: number;
    updatedAt?: number;
  };
}

export interface TemplateApplicationOptions {
  baseX: number;
  baseY: number;
  scale?: number;
  customWidth?: number;
  customHeight?: number;
  customSpacing?: number;
}

export interface TemplateValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class ZoneTemplateManager {
  private templates: Map<string, ZoneTemplate> = new Map();
  private customTemplates: Map<string, ZoneTemplate> = new Map();
  private storageKey = 'stratix_zone_templates';

  constructor() {
    this.loadCustomTemplates();
  }

  registerTemplate(template: ZoneTemplate): boolean {
    const validation = this.validateTemplate(template);
    if (!validation.valid) {
      console.error('[ZoneTemplateManager] Invalid template:', validation.errors);
      return false;
    }

    this.templates.set(template.id, template);
    return true;
  }

  unregisterTemplate(templateId: string): boolean {
    return this.templates.delete(templateId);
  }

  getTemplate(templateId: string): ZoneTemplate | undefined {
    return this.templates.get(templateId) || this.customTemplates.get(templateId);
  }

  getAllTemplates(): ZoneTemplate[] {
    const all = [...this.templates.values(), ...this.customTemplates.values()];
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  getTemplatesByCategory(category: ZoneTemplate['category']): ZoneTemplate[] {
    return this.getAllTemplates().filter(t => t.category === category);
  }

  searchTemplates(query: string): ZoneTemplate[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllTemplates().filter(t => 
      t.name.toLowerCase().includes(lowerQuery) ||
      t.description.toLowerCase().includes(lowerQuery) ||
      t.metadata?.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  applyTemplate(
    templateId: string,
    options: TemplateApplicationOptions,
    createZoneFn: (config: BaseZoneConfig) => Promise<any>
  ): Promise<{ zones: any[]; actionId: string }> {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const scale = options.scale || 1;
    const positions = this.calculatePositions(template, options);

    const actionId = `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    return this.applyTemplateInternal(template, positions, scale, createZoneFn, actionId);
  }

  private calculatePositions(
    template: ZoneTemplate,
    options: TemplateApplicationOptions
  ): ZoneTemplatePosition[] {
    return template.positions.map(pos => ({
      x: options.baseX + pos.x * (options.scale || 1),
      y: options.baseY + pos.y * (options.scale || 1),
      width: (options.customWidth || pos.width) * (options.scale || 1),
      height: (options.customHeight || pos.height) * (options.scale || 1),
      name: pos.name,
      taskType: pos.taskType,
      status: pos.status
    }));
  }

  private async applyTemplateInternal(
    template: ZoneTemplate,
    positions: ZoneTemplatePosition[],
    scale: number,
    createZoneFn: (config: BaseZoneConfig) => Promise<any>,
    actionId: string
  ): Promise<{ zones: any[]; actionId: string }> {
    const zones: any[] = [];
    const createdZones: any[] = [];

    try {
      for (const pos of positions) {
        const zoneConfig: BaseZoneConfig = {
          id: `zone-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: pos.name,
          x: pos.x,
          y: pos.y,
          width: pos.width,
          height: pos.height
        };

        const zone = await createZoneFn(zoneConfig);
        zones.push(zone);
        createdZones.push({
          zone,
          config: zoneConfig
        });

        rtsEventBus.emit('zone:created' as any, {
          zoneId: zoneConfig.id,
          zoneConfig,
          templateId: template.id,
          actionId
        });
      }

      return { zones, actionId };
    } catch (error) {
      console.error('[ZoneTemplateManager] Failed to apply template:', error);
      
      for (const { zone } of createdZones) {
        if (zone.destroy) {
          zone.destroy();
        }
      }
      
      throw error;
    }
  }

  validateTemplate(template: ZoneTemplate): TemplateValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!template.id || template.id.trim() === '') {
      errors.push('Template ID is required');
    }

    if (!template.name || template.name.trim() === '') {
      errors.push('Template name is required');
    }

    if (!template.description || template.description.trim() === '') {
      warnings.push('Template description is recommended');
    }

    if (!template.positions || template.positions.length === 0) {
      errors.push('Template must have at least one position');
    }

    template.positions.forEach((pos, index) => {
      if (pos.width <= 0) {
        errors.push(`Position ${index}: width must be positive`);
      }
      if (pos.height <= 0) {
        errors.push(`Position ${index}: height must be positive`);
      }
      if (pos.x < 0 || pos.y < 0) {
        warnings.push(`Position ${index}: negative coordinates may be outside viewport`);
      }
    });

    const overlaps = this.detectOverlaps(template.positions);
    if (overlaps.length > 0) {
      warnings.push(`Detected ${overlaps.length} overlapping positions`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  private detectOverlaps(positions: ZoneTemplatePosition[]): Array<[number, number]> {
    const overlaps: Array<[number, number]> = [];

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const pos1 = positions[i];
        const pos2 = positions[j];

        const rect1 = {
          x: pos1.x,
          y: pos1.y,
          width: pos1.width,
          height: pos1.height
        };

        const rect2 = {
          x: pos2.x,
          y: pos2.y,
          width: pos2.width,
          height: pos2.height
        };

        if (this.rectanglesOverlap(rect1, rect2)) {
          overlaps.push([i, j]);
        }
      }
    }

    return overlaps;
  }

  private rectanglesOverlap(
    rect1: { x: number; y: number; width: number; height: number },
    rect2: { x: number; y: number; width: number; height: number }
  ): boolean {
    return !(
      rect1.x + rect1.width <= rect2.x ||
      rect2.x + rect2.width <= rect1.x ||
      rect1.y + rect1.height <= rect2.y ||
      rect2.y + rect2.height <= rect1.y
    );
  }

  serializeTemplate(template: ZoneTemplate): string {
    return JSON.stringify(template, null, 2);
  }

  deserializeTemplate(json: string): ZoneTemplate | null {
    try {
      const template = JSON.parse(json) as ZoneTemplate;
      const validation = this.validateTemplate(template);
      
      if (!validation.valid) {
        console.error('[ZoneTemplateManager] Deserialized template is invalid:', validation.errors);
        return null;
      }

      return template;
    } catch (error) {
      console.error('[ZoneTemplateManager] Failed to deserialize template:', error);
      return null;
    }
  }

  saveCustomTemplate(template: ZoneTemplate): boolean {
    const validation = this.validateTemplate(template);
    if (!validation.valid) {
      console.error('[ZoneTemplateManager] Cannot save invalid template:', validation.errors);
      return false;
    }

    template.metadata = {
      ...template.metadata,
      updatedAt: Date.now()
    };

    if (!template.metadata.createdAt) {
      template.metadata.createdAt = Date.now();
    }

    this.customTemplates.set(template.id, template);
    this.persistCustomTemplates();
    
    rtsEventBus.emit('template:saved' as any, { templateId: template.id });
    return true;
  }

  deleteCustomTemplate(templateId: string): boolean {
    const deleted = this.customTemplates.delete(templateId);
    if (deleted) {
      this.persistCustomTemplates();
      rtsEventBus.emit('template:deleted' as any, { templateId });
    }
    return deleted;
  }

  getCustomTemplates(): ZoneTemplate[] {
    return Array.from(this.customTemplates.values());
  }

  private persistCustomTemplates(): void {
    try {
      const templatesArray = Array.from(this.customTemplates.values());
      localStorage.setItem(this.storageKey, JSON.stringify(templatesArray));
    } catch (error) {
      console.error('[ZoneTemplateManager] Failed to persist templates:', error);
    }
  }

  private loadCustomTemplates(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const templatesArray = JSON.parse(stored) as ZoneTemplate[];
        templatesArray.forEach(template => {
          const validation = this.validateTemplate(template);
          if (validation.valid) {
            this.customTemplates.set(template.id, template);
          } else {
            console.warn('[ZoneTemplateManager] Skipping invalid stored template:', validation.errors);
          }
        });
      }
    } catch (error) {
      console.error('[ZoneTemplateManager] Failed to load custom templates:', error);
    }
  }

  exportTemplates(templateIds?: string[]): string {
    const templatesToExport = templateIds
      ? templateIds.map(id => this.getTemplate(id)).filter((t): t is ZoneTemplate => t !== undefined)
      : this.getAllTemplates();

    return JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      templates: templatesToExport
    }, null, 2);
  }

  importTemplates(json: string, overwrite: boolean = false): {
    imported: number;
    skipped: number;
    errors: string[];
  } {
    const result = {
      imported: 0,
      skipped: 0,
      errors: [] as string[]
    };

    try {
      const data = JSON.parse(json);
      const templates = data.templates || [data];

      for (const template of templates) {
        if (!overwrite && (this.templates.has(template.id) || this.customTemplates.has(template.id))) {
          result.skipped++;
          continue;
        }

        const validation = this.validateTemplate(template);
        if (validation.valid) {
          this.customTemplates.set(template.id, template);
          result.imported++;
        } else {
          result.errors.push(`Template ${template.id}: ${validation.errors.join(', ')}`);
        }
      }

      if (result.imported > 0) {
        this.persistCustomTemplates();
        rtsEventBus.emit('templates:imported' as any, { count: result.imported });
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    }

    return result;
  }

  createTemplateFromZones(
    id: string,
    name: string,
    description: string,
    category: ZoneTemplate['category'],
    zones: Array<{ x: number; y: number; width: number; height: number; name?: string; taskType?: TaskZoneType }>
  ): ZoneTemplate | null {
    const positions: ZoneTemplatePosition[] = zones.map(zone => ({
      x: zone.x,
      y: zone.y,
      width: zone.width,
      height: zone.height,
      name: zone.name,
      taskType: zone.taskType
    }));

    const template: ZoneTemplate = {
      id,
      name,
      description,
      category,
      positions,
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    };

    const validation = this.validateTemplate(template);
    if (!validation.valid) {
      console.error('[ZoneTemplateManager] Created template is invalid:', validation.errors);
      return null;
    }

    return template;
  }

  getTemplateStats(): {
    totalTemplates: number;
    customTemplates: number;
    builtInTemplates: number;
    byCategory: Record<string, number>;
  } {
    const all = this.getAllTemplates();
    const custom = this.customTemplates.size;
    const builtIn = this.templates.size;

    const byCategory: Record<string, number> = {};
    all.forEach(t => {
      byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    });

    return {
      totalTemplates: all.length,
      customTemplates: custom,
      builtInTemplates: builtIn,
      byCategory
    };
  }

  destroy(): void {
    this.templates.clear();
    this.customTemplates.clear();
  }
}