import { ZoneTemplateManager } from '@/stratix-rts/zones/ZoneTemplateManager';
import type { ZoneTemplate } from '@/stratix-rts/zones/ZoneTemplateManager';
import { ZoneTemplates } from '@/stratix-rts/zones/ZoneTemplates';

describe('ZoneTemplateManager', () => {
  let manager: ZoneTemplateManager;

  beforeEach(() => {
    manager = new ZoneTemplateManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('Template Registration', () => {
    it('should register a valid template', () => {
      const template = ZoneTemplates.GRID_2X2;
      const result = manager.registerTemplate(template);
      expect(result).toBe(true);
      expect(manager.getTemplate(template.id)).toEqual(template);
    });

    it('should reject invalid template', () => {
      const invalidTemplate = {
        id: '',
        name: '',
        description: 'Invalid template',
        category: 'grid' as const,
        positions: []
      };
      const result = manager.registerTemplate(invalidTemplate);
      expect(result).toBe(false);
    });

    it('should unregister a template', () => {
      const template = ZoneTemplates.GRID_2X2;
      manager.registerTemplate(template);
      const result = manager.unregisterTemplate(template.id);
      expect(result).toBe(true);
      expect(manager.getTemplate(template.id)).toBeUndefined();
    });
  });

  describe('Template Retrieval', () => {
    beforeEach(() => {
      ZoneTemplates.getAllBuiltInTemplates().forEach(t => manager.registerTemplate(t));
    });

    it('should get all templates', () => {
      const templates = manager.getAllTemplates();
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should get templates by category', () => {
      const gridTemplates = manager.getTemplatesByCategory('grid');
      expect(gridTemplates.length).toBeGreaterThan(0);
      expect(gridTemplates.every(t => t.category === 'grid')).toBe(true);
    });

    it('should search templates', () => {
      const results = manager.searchTemplates('grid');
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(t => 
        t.name.toLowerCase().includes('grid') || 
        t.description.toLowerCase().includes('grid')
      )).toBe(true);
    });
  });

  describe('Template Validation', () => {
    it('should validate a valid template', () => {
      const template = ZoneTemplates.GRID_2X2;
      const result = manager.validateTemplate(template);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const template = {
        id: '',
        name: '',
        description: 'Test',
        category: 'grid' as const,
        positions: [{ x: 0, y: 0, width: 100, height: 100 }]
      };
      const result = manager.validateTemplate(template);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should warn about negative coordinates', () => {
      const template: ZoneTemplate = {
        id: 'test',
        name: 'Test',
        description: 'Test template',
        category: 'grid',
        positions: [
          { x: -100, y: -100, width: 100, height: 100 }
        ]
      };
      const result = manager.validateTemplate(template);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should warn about overlapping positions', () => {
      const template: ZoneTemplate = {
        id: 'test',
        name: 'Test',
        description: 'Test template',
        category: 'grid',
        positions: [
          { x: 0, y: 0, width: 100, height: 100 },
          { x: 50, y: 50, width: 100, height: 100 }
        ]
      };
      const result = manager.validateTemplate(template);
      expect(result.warnings.some(w => w.includes('overlapping'))).toBe(true);
    });
  });

  describe('Template Serialization', () => {
    it('should serialize a template', () => {
      const template = ZoneTemplates.GRID_2X2;
      const json = manager.serializeTemplate(template);
      expect(json).toContain(template.id);
      expect(json).toContain(template.name);
    });

    it('should deserialize a valid template', () => {
      const template = ZoneTemplates.GRID_2X2;
      const json = manager.serializeTemplate(template);
      const deserialized = manager.deserializeTemplate(json);
      expect(deserialized).toEqual(template);
    });

    it('should reject invalid JSON', () => {
      const invalidJson = 'not valid json';
      const result = manager.deserializeTemplate(invalidJson);
      expect(result).toBeNull();
    });

    it('should reject deserialized invalid template', () => {
      const invalidTemplateJson = JSON.stringify({
        id: '',
        name: '',
        positions: []
      });
      const result = manager.deserializeTemplate(invalidTemplateJson);
      expect(result).toBeNull();
    });
  });

  describe('Template Application', () => {
    beforeEach(() => {
      manager.registerTemplate(ZoneTemplates.GRID_2X2);
    });

    it('should apply template and create zones', async () => {
      const mockZones: any[] = [];
      const createZoneFn = async (config: any) => {
        const zone = {
          getZoneId: () => config.id,
          getZoneName: () => config.name,
          x: config.x,
          y: config.y,
          zoneWidth: config.width,
          zoneHeight: config.height,
          destroy: () => {}
        };
        mockZones.push(zone);
        return zone;
      };

      const result = await manager.applyTemplate(
        'grid-2x2',
        { baseX: 100, baseY: 100 },
        createZoneFn
      );

      expect(result.zones).toHaveLength(4);
      expect(mockZones).toHaveLength(4);
    });

    it('should scale template positions', async () => {
      const createdConfigs: any[] = [];
      const createZoneFn = async (config: any) => {
        createdConfigs.push(config);
        return {
          getZoneId: () => config.id,
          x: config.x,
          y: config.y,
          zoneWidth: config.width,
          zoneHeight: config.height,
          destroy: () => {}
        };
      };

      await manager.applyTemplate(
        'grid-2x2',
        { baseX: 0, baseY: 0, scale: 2 },
        createZoneFn
      );

      expect(createdConfigs[0].width).toBe(300);
      expect(createdConfigs[0].height).toBe(300);
    });

    it('should throw error for non-existent template', async () => {
      const createZoneFn = async () => ({});

      try {
        await manager.applyTemplate('non-existent', { baseX: 0, baseY: 0 }, createZoneFn);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Template not found');
      }
    });
  });

  describe('Custom Templates', () => {
    it('should save custom template', () => {
      const customTemplate: ZoneTemplate = {
        id: 'custom-1',
        name: 'Custom Template',
        description: 'A custom template',
        category: 'custom',
        positions: [
          { x: 0, y: 0, width: 100, height: 100 }
        ]
      };

      const result = manager.saveCustomTemplate(customTemplate);
      expect(result).toBe(true);
      expect(manager.getTemplate('custom-1')).toEqual(customTemplate);
    });

    it('should delete custom template', () => {
      const customTemplate: ZoneTemplate = {
        id: 'custom-2',
        name: 'Custom Template',
        description: 'A custom template',
        category: 'custom',
        positions: [
          { x: 0, y: 0, width: 100, height: 100 }
        ]
      };

      manager.saveCustomTemplate(customTemplate);
      const result = manager.deleteCustomTemplate('custom-2');
      expect(result).toBe(true);
      expect(manager.getTemplate('custom-2')).toBeUndefined();
    });

    it('should get only custom templates', () => {
      manager.registerTemplate(ZoneTemplates.GRID_2X2);
      
      const customTemplate: ZoneTemplate = {
        id: 'custom-3',
        name: 'Custom Template',
        description: 'A custom template',
        category: 'custom',
        positions: [
          { x: 0, y: 0, width: 100, height: 100 }
        ]
      };

      manager.saveCustomTemplate(customTemplate);
      const customTemplates = manager.getCustomTemplates();
      expect(customTemplates).toHaveLength(1);
      expect(customTemplates[0].id).toBe('custom-3');
    });
  });

  describe('Template Import/Export', () => {
    beforeEach(() => {
      manager.registerTemplate(ZoneTemplates.GRID_2X2);
      manager.registerTemplate(ZoneTemplates.GRID_3X3);
    });

    it('should export templates', () => {
      const exported = manager.exportTemplates(['grid-2x2']);
      const data = JSON.parse(exported);
      expect(data.templates).toHaveLength(1);
      expect(data.templates[0].id).toBe('grid-2x2');
    });

    it('should export all templates', () => {
      const exported = manager.exportTemplates();
      const data = JSON.parse(exported);
      expect(data.templates.length).toBeGreaterThan(0);
    });

    it('should import templates', () => {
      const newTemplate: ZoneTemplate = {
        id: 'imported-1',
        name: 'Imported Template',
        description: 'An imported template',
        category: 'grid',
        positions: [
          { x: 0, y: 0, width: 100, height: 100 }
        ]
      };

      const importJson = JSON.stringify({ templates: [newTemplate] });
      const result = manager.importTemplates(importJson);

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
      expect(manager.getTemplate('imported-1')).toBeDefined();
    });

    it('should skip existing templates when not overwriting', () => {
      const importJson = manager.exportTemplates(['grid-2x2']);
      const result = manager.importTemplates(importJson, false);

      expect(result.skipped).toBeGreaterThan(0);
    });

    it('should overwrite existing templates when specified', () => {
      const importJson = manager.exportTemplates(['grid-2x2']);
      const result = manager.importTemplates(importJson, true);

      expect(result.imported).toBeGreaterThan(0);
    });
  });

  describe('Template Statistics', () => {
    it('should return correct statistics', () => {
      ZoneTemplates.getAllBuiltInTemplates().forEach(t => manager.registerTemplate(t));
      
      const customTemplate: ZoneTemplate = {
        id: 'custom-stats',
        name: 'Custom',
        description: 'Custom template',
        category: 'custom',
        positions: [{ x: 0, y: 0, width: 100, height: 100 }]
      };
      manager.saveCustomTemplate(customTemplate);

      const stats = manager.getTemplateStats();
      expect(stats.totalTemplates).toBeGreaterThan(0);
      expect(stats.customTemplates).toBe(1);
      expect(stats.builtInTemplates).toBeGreaterThan(0);
      expect(stats.byCategory).toBeDefined();
    });
  });

  describe('Create Template from Zones', () => {
    it('should create template from zones', () => {
      const zones = [
        { x: 0, y: 0, width: 100, height: 100, name: 'Zone 1' },
        { x: 110, y: 0, width: 100, height: 100, name: 'Zone 2' }
      ];

      const template = manager.createTemplateFromZones(
        'from-zones',
        'From Zones',
        'Created from existing zones',
        'grid',
        zones
      );

      expect(template).toBeDefined();
      expect(template?.id).toBe('from-zones');
      expect(template?.positions).toHaveLength(2);
    });

    it('should return null for invalid zones', () => {
      const zones = [
        { x: 0, y: 0, width: -100, height: 100 }
      ];

      const template = manager.createTemplateFromZones(
        'invalid',
        'Invalid',
        'Invalid template',
        'grid',
        zones as any
      );

      expect(template).toBeNull();
    });
  });
});