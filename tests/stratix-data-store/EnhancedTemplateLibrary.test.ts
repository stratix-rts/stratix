/**
 * EnhancedTemplateLibrary Unit Tests
 */

import { EnhancedTemplateLibrary } from '@/stratix-data-store/EnhancedTemplateLibrary';
import { AgentTemplate, AgentDomain, MixinType } from '@/stratix-agent/types/template';
import * as fs from 'fs';
import * as path from 'path';

describe('EnhancedTemplateLibrary', () => {
  let library: EnhancedTemplateLibrary;
  let tempDir: string;

  beforeEach(() => {
    jest.resetModules();
    tempDir = path.join('/tmp', `test-templates-${Date.now()}`);
    library = new EnhancedTemplateLibrary(tempDir);
  });

  afterEach(async () => {
    // Cleanup temp files
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
    } catch (e) {
      // ignore cleanup errors
    }
  });

  const createMockTemplate = (overrides: Partial<AgentTemplate> = {}): AgentTemplate => ({
    id: `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Template',
    version: '1.0.0',
    description: 'A test template',
    domain: 'engineering' as AgentDomain,
    tags: ['typescript', 'node'],
    mixins: ['base'] as MixinType[],
    identity: 'Test identity',
    personality: 'Test personality',
    tone: 'professional',
    mission: 'Test mission',
    workflows: [],
    rules: [],
    constraints: [],
    forbiddenActions: [],
    skills: [],
    workflowSteps: [],
    successMetrics: [],
    metadata: {
      source: 'test',
      createdAt: new Date().toISOString()
    },
    ...overrides
  });

  describe('constructor', () => {
    it('should use default data path if not provided', () => {
      const lib = new EnhancedTemplateLibrary();
      expect(lib).toBeDefined();
    });

    it('should use custom data path', () => {
      const customPath = '/custom/path';
      const lib = new EnhancedTemplateLibrary(customPath);
      expect(lib).toBeDefined();
    });
  });

  describe('registerTemplate', () => {
    it('should register a template', () => {
      const template = createMockTemplate();
      library.registerTemplate(template);

      expect(library.getTemplate(template.id)).toBeDefined();
      expect(library.getCount()).toBe(1);
    });

    it('should update domain index', () => {
      const template = createMockTemplate({ domain: 'engineering' });
      library.registerTemplate(template);

      const byDomain = library.getTemplatesByDomain();
      expect(byDomain.get('engineering')?.length).toBe(1);
    });

    it('should update tag index', () => {
      const template = createMockTemplate({ tags: ['typescript', 'react'] });
      library.registerTemplate(template);

      const popularTags = library.getPopularTags();
      const tsTag = popularTags.find(t => t.tag === 'typescript');
      expect(tsTag?.count).toBe(1);
    });

    it('should update mixin index', () => {
      const template = createMockTemplate({ mixins: ['base', 'resource'] });
      library.registerTemplate(template);

      const stats = library.getStats();
      expect(stats.byMixin['base']).toBe(1);
      expect(stats.byMixin['resource']).toBe(1);
    });
  });

  describe('unregisterTemplate', () => {
    it('should unregister existing template', () => {
      const template = createMockTemplate();
      library.registerTemplate(template);
      expect(library.getCount()).toBe(1);

      const result = library.unregisterTemplate(template.id);
      expect(result).toBe(true);
      expect(library.getCount()).toBe(0);
    });

    it('should return false for non-existent template', () => {
      const result = library.unregisterTemplate('non-existent');
      expect(result).toBe(false);
    });

    it('should remove from domain index', () => {
      const template = createMockTemplate({ domain: 'design' });
      library.registerTemplate(template);
      library.unregisterTemplate(template.id);

      const byDomain = library.getTemplatesByDomain();
      expect(byDomain.get('design')?.length).toBe(0);
    });
  });

  describe('getTemplate', () => {
    it('should return registered template', () => {
      const template = createMockTemplate({ id: 'test-id' });
      library.registerTemplate(template);

      const found = library.getTemplate('test-id');
      expect(found).toBeDefined();
      expect(found!.id).toBe('test-id');
    });

    it('should return undefined for non-existent template', () => {
      const found = library.getTemplate('non-existent');
      expect(found).toBeUndefined();
    });
  });

  describe('getAllTemplates', () => {
    it('should return all registered templates', () => {
      library.registerTemplate(createMockTemplate({ id: 't1' }));
      library.registerTemplate(createMockTemplate({ id: 't2' }));

      const all = library.getAllTemplates();
      expect(all).toHaveLength(2);
    });
  });

  describe('getCount', () => {
    it('should return 0 for empty library', () => {
      expect(library.getCount()).toBe(0);
    });

    it('should return correct count after registering templates', () => {
      library.registerTemplate(createMockTemplate());
      library.registerTemplate(createMockTemplate());
      expect(library.getCount()).toBe(2);
    });
  });

  describe('query', () => {
    beforeEach(() => {
      library.registerTemplate(createMockTemplate({
        id: 'eng-1',
        domain: 'engineering',
        tags: ['typescript', 'node'],
        mixins: ['base']
      }));
      library.registerTemplate(createMockTemplate({
        id: 'eng-2',
        domain: 'engineering',
        tags: ['python', 'django'],
        mixins: ['base']
      }));
      library.registerTemplate(createMockTemplate({
        id: 'design-1',
        domain: 'design',
        tags: ['figma', 'ui'],
        mixins: ['resource']
      }));
    });

    it('should return all templates with no query', () => {
      const results = library.query({});
      expect(results).toHaveLength(3);
    });

    it('should filter by domain', () => {
      const results = library.query({ domain: 'engineering' });
      expect(results).toHaveLength(2);
      expect(results.every(t => t.domain === 'engineering')).toBe(true);
    });

    it('should filter by tags', () => {
      const results = library.query({ tags: ['typescript'] });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('eng-1');
    });

    it('should filter by multiple tags (OR)', () => {
      const results = library.query({ tags: ['typescript', 'python'] });
      expect(results).toHaveLength(2);
    });

    it('should filter by mixins', () => {
      const results = library.query({ mixins: ['resource'] });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('design-1');
    });

    it('should filter by search text in name', () => {
      library.clear();
      library.registerTemplate(createMockTemplate({ name: 'Python Developer' }));
      library.registerTemplate(createMockTemplate({ name: 'TypeScript Engineer' }));

      const results = library.query({ searchText: 'Python' });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Python Developer');
    });

    it('should filter by search text in description', () => {
      library.clear();
      library.registerTemplate(createMockTemplate({
        name: 'Template 1',
        description: 'This is a python web application'
      }));

      const results = library.query({ searchText: 'python' });
      expect(results).toHaveLength(1);
    });

    it('should filter by search text in identity', () => {
      library.clear();
      library.registerTemplate(createMockTemplate({
        name: 'Template 1',
        identity: 'Expert in Python programming'
      }));

      const results = library.query({ searchText: 'python' });
      expect(results).toHaveLength(1);
    });

    it('should filter by search text in tags', () => {
      library.clear();
      library.registerTemplate(createMockTemplate({
        name: 'Template 1',
        tags: ['python', 'django']
      }));

      const results = library.query({ searchText: 'python' });
      expect(results).toHaveLength(1);
    });

    it('should apply pagination', () => {
      const results = library.query({ limit: 2, offset: 0 });
      expect(results).toHaveLength(2);
    });

    it('should apply offset', () => {
      const page1 = library.query({ limit: 2, offset: 0 });
      const page2 = library.query({ limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('should combine multiple filters', () => {
      library.clear();
      library.registerTemplate(createMockTemplate({
        id: 'eng-ts',
        domain: 'engineering',
        tags: ['typescript'],
        mixins: ['base']
      }));
      library.registerTemplate(createMockTemplate({
        id: 'eng-py',
        domain: 'engineering',
        tags: ['python'],
        mixins: ['base']
      }));

      const results = library.query({
        domain: 'engineering',
        tags: ['typescript']
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('eng-ts');
    });
  });

  describe('getTemplatesByDomain', () => {
    it('should return templates grouped by domain', () => {
      library.registerTemplate(createMockTemplate({ domain: 'engineering' }));
      library.registerTemplate(createMockTemplate({ domain: 'engineering' }));
      library.registerTemplate(createMockTemplate({ domain: 'design' }));

      const byDomain = library.getTemplatesByDomain();
      expect(byDomain.get('engineering')?.length).toBe(2);
      expect(byDomain.get('design')?.length).toBe(1);
    });

    it('should return empty array for domains with no templates', () => {
      library.registerTemplate(createMockTemplate({ domain: 'engineering' }));

      const byDomain = library.getTemplatesByDomain();
      // getTemplatesByDomain returns all initialized domains, including empty ones
      // It returns an empty array for domains with no templates
      expect(byDomain.get('design') ?? []).toEqual([]);
    });
  });

  describe('getCategories', () => {
    it('should return categories sorted by count', () => {
      library.registerTemplate(createMockTemplate({ domain: 'engineering' }));
      library.registerTemplate(createMockTemplate({ domain: 'engineering' }));
      library.registerTemplate(createMockTemplate({ domain: 'design' }));

      const categories = library.getCategories();
      expect(categories).toHaveLength(2);
      expect(categories[0].id).toBe('engineering');
      expect(categories[0].count).toBe(2);
    });

    it('should include domain metadata', () => {
      library.registerTemplate(createMockTemplate({ domain: 'engineering' }));

      const categories = library.getCategories();
      expect(categories[0].name).toBeDefined();
      expect(categories[0].description).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      library.registerTemplate(createMockTemplate({
        domain: 'engineering',
        mixins: ['base']
      }));
      library.registerTemplate(createMockTemplate({
        domain: 'design',
        mixins: ['resource']
      }));

      const stats = library.getStats();
      expect(stats.total).toBe(2);
      expect(stats.byDomain['engineering']).toBe(1);
      expect(stats.byDomain['design']).toBe(1);
      expect(stats.byMixin['base']).toBe(1);
      expect(stats.byMixin['resource']).toBe(1);
    });
  });

  describe('getRecommendations', () => {
    it('should return templates with popular tags even when context is empty', () => {
      // Create a template WITHOUT popular tags
      library.registerTemplate(createMockTemplate({
        id: 'no-popular-tags',
        tags: ['unusual-tag']
      }));
      const recommendations = library.getRecommendations({});
      expect(recommendations).toHaveLength(0);

      // Now add a template WITH popular tags
      library.clear();
      library.registerTemplate(createMockTemplate({
        id: 'with-popular-tags',
        tags: ['typescript', 'node']
      }));
      const recommendations2 = library.getRecommendations({});
      expect(recommendations2.length).toBeGreaterThan(0);
    });

    it('should score templates matching recent domains', () => {
      library.registerTemplate(createMockTemplate({
        id: 'eng-1',
        domain: 'engineering'
      }));
      library.registerTemplate(createMockTemplate({
        id: 'design-1',
        domain: 'design'
      }));

      const recommendations = library.getRecommendations({
        recentDomains: ['engineering']
      });

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0].domain).toBe('engineering');
    });

    it('should score templates matching user preferences', () => {
      library.registerTemplate(createMockTemplate({
        id: 't1',
        tags: ['typescript']
      }));
      library.registerTemplate(createMockTemplate({
        id: 't2',
        tags: ['python']
      }));

      const recommendations = library.getRecommendations({
        userPreferences: ['typescript']
      });

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0].id).toBe('t1');
    });

    it('should boost popular tags', () => {
      library.registerTemplate(createMockTemplate({
        id: 't1',
        tags: ['typescript', 'react']
      }));
      library.registerTemplate(createMockTemplate({
        id: 't2',
        tags: ['python']
      }));

      const recommendations = library.getRecommendations({
        userPreferences: ['react']
      });

      // TypeScript and React are popular tags
      expect(recommendations.length).toBeGreaterThan(0);
    });

    it('should limit to 10 recommendations', () => {
      for (let i = 0; i < 20; i++) {
        library.registerTemplate(createMockTemplate({
          id: `t${i}`,
          domain: 'engineering'
        }));
      }

      const recommendations = library.getRecommendations({
        recentDomains: ['engineering']
      });

      expect(recommendations.length).toBeLessThanOrEqual(10);
    });
  });

  describe('findSimilar', () => {
    it('should return empty array for non-existent template', () => {
      const similar = library.findSimilar('non-existent');
      expect(similar).toEqual([]);
    });

    it('should find similar templates by domain', () => {
      library.registerTemplate(createMockTemplate({
        id: 'target',
        domain: 'engineering',
        tags: ['typescript']
      }));
      library.registerTemplate(createMockTemplate({
        id: 'similar-eng',
        domain: 'engineering',
        tags: ['python']
      }));
      library.registerTemplate(createMockTemplate({
        id: 'different',
        domain: 'design',
        tags: ['typescript']
      }));

      const similar = library.findSimilar('target');
      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0].id).toBe('similar-eng');
    });

    it('should score by common tags', () => {
      library.registerTemplate(createMockTemplate({
        id: 'target',
        domain: 'engineering',
        tags: ['typescript', 'react', 'node']
      }));
      library.registerTemplate(createMockTemplate({
        id: 'same-tags',
        domain: 'design',
        tags: ['typescript', 'react']
      }));

      const similar = library.findSimilar('target');
      expect(similar[0].id).toBe('same-tags');
    });

    it('should score by common mixins', () => {
      library.registerTemplate(createMockTemplate({
        id: 'target',
        domain: 'engineering',
        mixins: ['base', 'resource']
      }));
      library.registerTemplate(createMockTemplate({
        id: 'same-mixin',
        domain: 'design',
        mixins: ['base', 'compliance']
      }));

      const similar = library.findSimilar('target');
      expect(similar.length).toBeGreaterThan(0);
    });

    it('should respect limit', () => {
      library.registerTemplate(createMockTemplate({
        id: 'target',
        domain: 'engineering',
        tags: ['typescript']
      }));
      for (let i = 0; i < 10; i++) {
        library.registerTemplate(createMockTemplate({
          id: `similar-${i}`,
          domain: 'engineering'
        }));
      }

      const similar = library.findSimilar('target', 3);
      expect(similar).toHaveLength(3);
    });
  });

  describe('toAgentConfig', () => {
    it('should convert template to agent config', () => {
      const template = createMockTemplate({
        id: 'test-template',
        name: 'Test Agent',
        domain: 'engineering',
        skills: [{
          skillId: 'skill-1',
          name: 'Test Skill',
          description: 'A test skill',
          parameters: [{
            name: 'param1',
            type: 'string',
            required: true,
            defaultValue: 'default'
          }]
        }],
        rules: [{
          id: 'rule-1',
          priority: 'high',
          rule: 'Test rule'
        }]
      });

      const config = library.toAgentConfig(template);

      expect(config.agentId).toMatch(/^agent-\d+-[a-z0-9]+$/);
      expect(config.name).toBe('Test Agent');
      expect(config.type).toBe('dev'); // engineering maps to dev
      expect(config.profile.characterId).toBe('test-template');
      expect(config.backendType).toBe('stratix');
      expect(config.soul?.identity).toBe(template.identity);
      expect(config.skills).toHaveLength(1);
      expect(config.rules).toHaveLength(1);
    });

    it('should use custom name if provided', () => {
      const template = createMockTemplate({ name: 'Original Name' });
      const config = library.toAgentConfig(template, 'Custom Name');
      expect(config.name).toBe('Custom Name');
    });
  });

  describe('fromAgentConfig', () => {
    it('should convert agent config to template', () => {
      const config = {
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'dev',
        profile: {
          characterId: 'char-1',
          name: 'Test',
          bodyType: 'male' as const,
          parts: {}
        },
        backendType: 'openclaw' as const,
        configStatus: 'draft' as const,
        soul: {
          identity: 'Test identity',
          goals: ['Goal 1', 'Goal 2'],
          personality: 'Test personality'
        },
        memory: { shortTerm: [], longTerm: [], context: '' },
        skills: [{
          skillId: 'skill-1',
          name: 'Test Skill',
          description: 'Description',
          parameters: [{
            paramId: 'param1',
            name: 'Param 1',
            type: 'string' as const,
            required: true
          }]
        }],
        rules: ['Rule 1', 'Rule 2']
      };

      const template = library.fromAgentConfig(config);

      expect(template.id).toBe('agent-1');
      expect(template.name).toBe('Test Agent');
      expect(template.domain).toBe('engineering'); // dev maps to engineering
      expect(template.identity).toBe('Test identity');
      expect(template.mission).toBe('Goal 1 Goal 2');
      expect(template.skills).toHaveLength(1);
      expect(template.rules).toHaveLength(2);
      expect(template.metadata.source).toBe('converted');
    });
  });

  describe('saveToFile and loadFromFile', () => {
    it('should save and load templates', async () => {
      library.registerTemplate(createMockTemplate({ id: 'saved-1' }));
      library.registerTemplate(createMockTemplate({ id: 'saved-2' }));

      const filePath = path.join(tempDir, 'templates.json');
      await library.saveToFile(filePath);

      const newLibrary = new EnhancedTemplateLibrary(tempDir);
      const count = await newLibrary.loadFromFile(filePath);

      expect(count).toBe(2);
      expect(newLibrary.getTemplate('saved-1')).toBeDefined();
      expect(newLibrary.getTemplate('saved-2')).toBeDefined();
    });

    it('should handle empty library', async () => {
      const filePath = path.join(tempDir, 'empty.json');
      await library.saveToFile(filePath);

      const newLibrary = new EnhancedTemplateLibrary(tempDir);
      const count = await newLibrary.loadFromFile(filePath);
      expect(count).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all templates', () => {
      library.registerTemplate(createMockTemplate());
      library.registerTemplate(createMockTemplate());

      expect(library.getCount()).toBe(2);
      library.clear();
      expect(library.getCount()).toBe(0);
    });

    it('should reset indexes', () => {
      library.registerTemplate(createMockTemplate({
        domain: 'engineering',
        tags: ['typescript'],
        mixins: ['base']
      }));

      library.clear();

      const stats = library.getStats();
      expect(stats.total).toBe(0);
      expect(stats.byDomain['engineering']).toBe(0);
    });
  });

  describe('getPopularTags', () => {
    it('should return tags sorted by count', () => {
      library.registerTemplate(createMockTemplate({
        tags: ['typescript']
      }));
      library.registerTemplate(createMockTemplate({
        tags: ['typescript']
      }));
      library.registerTemplate(createMockTemplate({
        tags: ['python']
      }));

      const popular = library.getPopularTags();
      expect(popular[0].tag).toBe('typescript');
      expect(popular[0].count).toBe(2);
      expect(popular[1].tag).toBe('python');
      expect(popular[1].count).toBe(1);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 30; i++) {
        library.registerTemplate(createMockTemplate({
          id: `t${i}`,
          tags: [`tag${i}`]
        }));
      }

      const popular = library.getPopularTags(10);
      expect(popular).toHaveLength(10);
    });
  });

  describe('searchTags', () => {
    it('should find tags matching query', () => {
      library.registerTemplate(createMockTemplate({
        id: 't1',
        tags: ['typescript', 'ts-node']
      }));
      library.registerTemplate(createMockTemplate({
        id: 't2',
        tags: ['python']
      }));

      const results = library.searchTags('ts');
      // Both typescript and ts-node contain 'ts'
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r === 'typescript' || r === 'ts-node')).toBe(true);
    });

    it('should be case insensitive', () => {
      library.registerTemplate(createMockTemplate({
        tags: ['TypeScript']
      }));

      const results = library.searchTags('typescript');
      expect(results).toContain('TypeScript');
    });

    it('should respect limit', () => {
      for (let i = 0; i < 20; i++) {
        library.registerTemplate(createMockTemplate({
          id: `t${i}`,
          tags: [`tag${i}`]
        }));
      }

      const results = library.searchTags('tag', 5);
      expect(results).toHaveLength(5);
    });
  });

  describe('importFromDirectory', () => {
    it('should return import result structure', async () => {
      const result = await library.importFromDirectory('/non/existent');
      expect(result).toHaveProperty('imported');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('skipped');
      expect(result).toHaveProperty('errors');
    });
  });

  describe('importFromFile', () => {
    it('should return null for non-existent file', async () => {
      const result = await library.importFromFile('/non/existent/file.md');
      expect(result).toBeNull();
    });
  });
});
