import { ZoneTemplateManager } from './ZoneTemplateManager';
import { ZoneTemplates } from './ZoneTemplates';
import { TemplateApplicationAction } from './TemplateApplicationAction';
import { ZoneHistory } from '../history/ZoneHistory';
import { rtsEventBus } from '../events/core/RTSEventBus';
import type { BaseZoneConfig } from './BaseZone';
import type { TemplateApplicationOptions } from './ZoneTemplateManager';

export class ZoneTemplateIntegration {
  private templateManager: ZoneTemplateManager;
  private history: ZoneHistory;

  constructor(history: ZoneHistory) {
    this.templateManager = new ZoneTemplateManager();
    this.history = history;
    this.registerBuiltInTemplates();
  }

  private registerBuiltInTemplates(): void {
    const builtInTemplates = ZoneTemplates.getAllBuiltInTemplates();
    builtInTemplates.forEach(template => {
      this.templateManager.registerTemplate(template);
    });
  }

  async applyTemplateWithHistory(
    templateId: string,
    options: TemplateApplicationOptions,
    createZoneFn: (config: BaseZoneConfig) => Promise<any>,
    scene: any
  ): Promise<{ zones: any[]; actionId: string }> {
    const template = this.templateManager.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const { zones, actionId } = await this.templateManager.applyTemplate(
      templateId,
      options,
      createZoneFn
    );

    const action = new TemplateApplicationAction(
      zones,
      scene,
      template,
      createZoneFn
    );

    await this.history.execute(action);

    rtsEventBus.emit('template:applied' as any, {
      templateId,
      templateName: template.name,
      zoneCount: zones.length,
      actionId
    });

    return { zones, actionId };
  }

  getTemplateManager(): ZoneTemplateManager {
    return this.templateManager;
  }

  getAvailableTemplates() {
    return this.templateManager.getAllTemplates();
  }

  getTemplatesByCategory(category: 'grid' | 'linear' | 'circular' | 'custom') {
    return this.templateManager.getTemplatesByCategory(category);
  }

  saveCustomTemplate(template: Parameters<ZoneTemplateManager['saveCustomTemplate']>[0]) {
    return this.templateManager.saveCustomTemplate(template);
  }

  deleteCustomTemplate(templateId: string) {
    return this.templateManager.deleteCustomTemplate(templateId);
  }

  exportTemplates(templateIds?: string[]) {
    return this.templateManager.exportTemplates(templateIds);
  }

  importTemplates(json: string, overwrite: boolean = false) {
    return this.templateManager.importTemplates(json, overwrite);
  }

  destroy(): void {
    this.templateManager.destroy();
  }
}