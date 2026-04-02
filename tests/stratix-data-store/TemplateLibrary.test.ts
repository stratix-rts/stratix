/**
 * TemplateLibrary Unit Tests
 */

// Create mock database
const mockDb = {
  prepare: jest.fn().mockReturnValue({
    run: jest.fn(),
    all: jest.fn().mockReturnValue([])
  }),
  exec: jest.fn()
};

// Mock database module
jest.mock('@/stratix-database', () => ({
  initializeDatabase: jest.fn(),
  getDatabase: jest.fn().mockReturnValue({
    getDatabase: jest.fn().mockReturnValue(mockDb)
  })
}));

// Mock AgentRepository
jest.mock('@/stratix-database/AgentRepository', () => ({
  agentRepository: {
    saveAgent: jest.fn(),
    getAgent: jest.fn().mockReturnValue(null),
    getAllAgents: jest.fn().mockReturnValue([]),
    deleteAgent: jest.fn().mockReturnValue(false)
  }
}));

// Mock AgentChatMessageRepository
jest.mock('@/stratix-database/AgentChatMessageRepository', () => ({
  agentChatMessageRepository: {
    saveMessage: jest.fn(),
    getMessagesByAgentId: jest.fn().mockReturnValue([]),
    searchMessages: jest.fn().mockReturnValue([]),
    deleteMessagesByAgentId: jest.fn()
  }
}));

import { TemplateLibrary } from '@/stratix-data-store/TemplateLibrary';
import { StratixDataStore } from '@/stratix-data-store/StratixDataStore';
import { agentRepository } from '@/stratix-database/AgentRepository';
import type { StratixAgentConfig } from '@/stratix-core/stratix-protocol';

describe('TemplateLibrary', () => {
  let store: StratixDataStore;
  let templateLibrary: TemplateLibrary;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    store = new StratixDataStore();
    templateLibrary = new TemplateLibrary(store);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should initialize preset templates', async () => {
      await templateLibrary.initialize();
      const presets = templateLibrary.getPresetTemplates();
      expect(presets).toHaveLength(3);
    });
  });

  describe('getPresetTemplates', () => {
    it('should return all preset templates', () => {
      const presets = templateLibrary.getPresetTemplates();
      expect(presets).toHaveLength(3);

      const types = presets.map(t => t.type);
      expect(types).toContain('writer');
      expect(types).toContain('dev');
      expect(types).toContain('analyst');
    });

    it('should return copies of presets (not references)', () => {
      const presets1 = templateLibrary.getPresetTemplates();
      const presets2 = templateLibrary.getPresetTemplates();

      expect(presets1).not.toBe(presets2);
      expect(presets1[0]).not.toBe(presets2[0]);
    });

    it('should have correct template structure', () => {
      const presets = templateLibrary.getPresetTemplates();
      const writer = presets.find(t => t.type === 'writer');

      expect(writer).toBeDefined();
      expect(writer!.name).toBe('文案英雄（模板）');
      expect(writer!.skills).toHaveLength(2);
      expect(writer!.soul).toBeDefined();
    });
  });

  describe('getPresetTemplateByType', () => {
    it('should return writer template', () => {
      const template = templateLibrary.getPresetTemplateByType('writer');
      expect(template).not.toBeNull();
      expect(template!.type).toBe('writer');
    });

    it('should return dev template', () => {
      const template = templateLibrary.getPresetTemplateByType('dev');
      expect(template).not.toBeNull();
      expect(template!.type).toBe('dev');
    });

    it('should return analyst template', () => {
      const template = templateLibrary.getPresetTemplateByType('analyst');
      expect(template).not.toBeNull();
      expect(template!.type).toBe('analyst');
    });

    it('should return null for unknown type', () => {
      const template = templateLibrary.getPresetTemplateByType('unknown' as any);
      expect(template).toBeNull();
    });
  });

  describe('getCustomTemplates', () => {
    it('should return custom templates from data store', async () => {
      await store.initialize();
      const customs = await templateLibrary.getCustomTemplates();
      expect(Array.isArray(customs)).toBe(true);
    });
  });

  describe('getAllTemplates', () => {
    it('should return both preset and custom templates', async () => {
      await store.initialize();
      const all = await templateLibrary.getAllTemplates();
      expect(all).toHaveProperty('preset');
      expect(all).toHaveProperty('custom');
      expect(Array.isArray(all.preset)).toBe(true);
      expect(Array.isArray(all.custom)).toBe(true);
    });
  });

  describe('saveCustomTemplate', () => {
    it('should save custom template', async () => {
      await store.initialize();

      const template: StratixAgentConfig = {
        agentId: 'custom-1',
        name: 'Custom Agent',
        type: 'writer',
        profile: {
          characterId: 'char-1',
          name: 'Custom',
          bodyType: 'female',
          parts: {}
        },
        backendType: 'openclaw',
        configStatus: 'draft',
        soul: {
          identity: 'Custom identity',
          goals: ['Goal'],
          personality: 'Custom personality'
        },
        memory: { shortTerm: [], longTerm: [], context: '' }
      };

      await templateLibrary.saveCustomTemplate(template);
      expect(agentRepository.saveAgent).toHaveBeenCalled();
    });
  });

  describe('deleteCustomTemplate', () => {
    it('should delete custom template', async () => {
      await store.initialize();

      const result = await templateLibrary.deleteCustomTemplate('custom-1');
      expect(result).toBe(false);
    });
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = templateLibrary.generateId();
      const id2 = templateLibrary.generateId();

      expect(id1).toMatch(/^stratix-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^stratix-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('createFromTemplate', () => {
    it('should create agent from writer template', () => {
      const agent = templateLibrary.createFromTemplate('writer', 'My Writer');

      expect(agent).not.toBeNull();
      expect(agent!.type).toBe('writer');
      expect(agent!.name).toBe('My Writer');
      expect(agent!.agentId).toMatch(/^stratix-/);
    });

    it('should create agent from dev template with default name', () => {
      const agent = templateLibrary.createFromTemplate('dev');

      expect(agent).not.toBeNull();
      expect(agent!.type).toBe('dev');
      expect(agent!.name).toBe('开发英雄');
    });

    it('should create agent from analyst template', () => {
      const agent = templateLibrary.createFromTemplate('analyst');

      expect(agent).not.toBeNull();
      expect(agent!.type).toBe('analyst');
    });

    it('should return null for unknown template type', () => {
      const agent = templateLibrary.createFromTemplate('unknown' as any);
      expect(agent).toBeNull();
    });

    it('should generate new agentId', () => {
      const agent = templateLibrary.createFromTemplate('writer');
      expect(agent!.agentId).toMatch(/^stratix-\d+-[a-z0-9]+$/);
    });

    it('should copy template skills', () => {
      const agent = templateLibrary.createFromTemplate('writer');

      expect(agent!.skills).toBeDefined();
      expect(agent!.skills!.length).toBeGreaterThan(0);
    });

    it('should reset openClawConfig accountId', () => {
      const agent = templateLibrary.createFromTemplate('writer');

      expect(agent!.openClawConfig).toBeDefined();
      expect(agent!.openClawConfig!.accountId).toBe('');
    });

    it('should not modify original template', () => {
      const originalId = templateLibrary.getPresetTemplateByType('writer')!.agentId;
      templateLibrary.createFromTemplate('writer', 'New Writer');

      const template = templateLibrary.getPresetTemplateByType('writer');
      expect(template!.agentId).toBe(originalId);
    });
  });
});
