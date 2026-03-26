/**
 * StratixDataStore Unit Tests
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
jest.mock('../../src/stratix-database', () => ({
  getDatabase: jest.fn().mockReturnValue({
    getDatabase: jest.fn().mockReturnValue(mockDb)
  })
}));

// Mock AgentRepository
jest.mock('../../src/stratix-database/AgentRepository', () => ({
  agentRepository: {
    saveAgent: jest.fn(),
    getAgent: jest.fn().mockReturnValue(null),
    getAllAgents: jest.fn().mockReturnValue([]),
    deleteAgent: jest.fn().mockReturnValue(false)
  }
}));

// Mock AgentChatMessageRepository
jest.mock('../../src/stratix-database/AgentChatMessageRepository', () => ({
  agentChatMessageRepository: {
    saveMessage: jest.fn(),
    getMessagesByAgentId: jest.fn().mockReturnValue([]),
    searchMessages: jest.fn().mockReturnValue([]),
    deleteMessagesByAgentId: jest.fn()
  }
}));

import { StratixDataStore } from '@/stratix-data-store/StratixDataStore';
import { agentRepository } from '@/stratix-database/AgentRepository';
import { agentChatMessageRepository } from '@/stratix-database/AgentChatMessageRepository';
import type { StratixCommandLog } from '@/stratix-data-store/types';
import type { StratixAgentConfig } from '@/stratix-core/stratix-protocol';

describe('StratixDataStore', () => {
  let store: StratixDataStore;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    store = new StratixDataStore();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await store.initialize();
      expect(store.isInitialized()).toBe(true);
    });

    it('should not re-initialize if already initialized', async () => {
      await store.initialize();
      await store.initialize();
      expect(store.isInitialized()).toBe(true);
    });
  });

  describe('isInitialized', () => {
    it('should return false before initialization', () => {
      expect(store.isInitialized()).toBe(false);
    });

    it('should return true after initialization', async () => {
      await store.initialize();
      expect(store.isInitialized()).toBe(true);
    });
  });

  describe('saveAgent', () => {
    it('should save agent via repository', async () => {
      await store.initialize();

      const agent: StratixAgentConfig = {
        agentId: 'agent-123',
        name: 'Test Agent',
        type: 'dev',
        profile: {
          characterId: 'char-1',
          name: 'Test',
          bodyType: 'male',
          parts: {}
        },
        backendType: 'openclaw',
        configStatus: 'draft',
        soul: {
          identity: 'Test identity',
          goals: ['Goal 1'],
          personality: 'Test personality'
        },
        memory: { shortTerm: [], longTerm: [], context: '' }
      };

      await store.saveAgent(agent);
      expect(agentRepository.saveAgent).toHaveBeenCalledWith(agent);
    });
  });

  describe('getAgent', () => {
    it('should return null for non-existent agent', async () => {
      await store.initialize();
      const result = await store.getAgent('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('loadAgent', () => {
    it('should return same result as getAgent', async () => {
      await store.initialize();
      const result = await store.loadAgent('agent-123');
      expect(result).toBeNull();
    });
  });

  describe('listAgents', () => {
    it('should return agents from repository', async () => {
      await store.initialize();
      await store.listAgents();
      expect(agentRepository.getAllAgents).toHaveBeenCalled();
    });
  });

  describe('deleteAgent', () => {
    it('should return result from repository', async () => {
      await store.initialize();
      const result = await store.deleteAgent('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('saveCustomTemplate', () => {
    it('should save custom template via repository', async () => {
      await store.initialize();

      const template: StratixAgentConfig = {
        agentId: 'template-1',
        name: 'Custom Template',
        type: 'writer',
        profile: {
          characterId: 'char-1',
          name: 'Template',
          bodyType: 'female',
          parts: {}
        },
        backendType: 'openclaw',
        configStatus: 'draft',
        soul: {
          identity: 'Identity',
          goals: ['Goal'],
          personality: 'Personality'
        },
        memory: { shortTerm: [], longTerm: [], context: '' }
      };

      await store.saveCustomTemplate(template);
      expect(agentRepository.saveAgent).toHaveBeenCalled();
    });
  });

  describe('listTemplates', () => {
    it('should return preset and custom arrays', async () => {
      await store.initialize();
      const templates = await store.listTemplates();
      expect(templates).toEqual({ preset: [], custom: [] });
    });
  });

  describe('deleteCustomTemplate', () => {
    it('should return result of deleteAgent', async () => {
      await store.initialize();
      const result = await store.deleteCustomTemplate('template-1');
      expect(result).toBe(false);
    });
  });

  describe('saveLog', () => {
    it('should save command log to database', async () => {
      await store.initialize();

      const log: StratixCommandLog = {
        logId: 'log-1',
        commandId: 'cmd-1',
        agentId: 'agent-1',
        skillId: 'skill-1',
        skillName: 'Test Skill',
        params: { key: 'value' },
        status: 'pending',
        startTime: Date.now()
      };

      await store.saveLog(log);
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('getLogs', () => {
    it('should return empty array when no logs', async () => {
      await store.initialize();
      const logs = await store.getLogs();
      expect(logs).toEqual([]);
    });

    it('should query with agentId filter', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          {
            log_id: 'log-1',
            command_id: 'cmd-1',
            agent_id: 'agent-1',
            skill_id: 'skill-1',
            skill_name: 'Test',
            params: '{}',
            status: 'pending',
            start_time: Date.now()
          }
        ])
      });

      const logs = await store.getLogs({ agentId: 'agent-1' });
      expect(logs).toHaveLength(1);
    });

    it('should query with status filter', async () => {
      await store.initialize();
      await store.getLogs({ status: 'success' });
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it('should query with limit', async () => {
      await store.initialize();
      await store.getLogs({ limit: 10 });
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('updateLog', () => {
    it('should update log fields', async () => {
      await store.initialize();

      mockDb.prepare.mockReturnValue({
        run: jest.fn()
      });

      await store.updateLog('log-1', { status: 'success', result: 'done' });
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it('should not update if no fields provided', async () => {
      await store.initialize();
      await store.updateLog('log-1', {});
    });
  });

  describe('getLog', () => {
    it('should return null for non-existent log', async () => {
      await store.initialize();
      // Reset mock to include all()
      mockDb.prepare.mockReturnValue({
        run: jest.fn(),
        all: jest.fn().mockReturnValue([])
      });
      const log = await store.getLog('non-existent');
      expect(log).toBeNull();
    });
  });

  describe('clearLogs', () => {
    it('should clear all logs when no agentId provided', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({ run: jest.fn() });

      await store.clearLogs();
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it('should clear logs for specific agent', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({ run: jest.fn() });

      await store.clearLogs('agent-1');
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('exportData', () => {
    it('should export all data', async () => {
      await store.initialize();
      // Reset mock to include all()
      mockDb.prepare.mockReturnValue({
        run: jest.fn(),
        all: jest.fn().mockReturnValue([])
      });
      const data = await store.exportData();
      expect(data).toHaveProperty('agents');
      expect(data).toHaveProperty('templates');
      expect(data).toHaveProperty('logs');
      expect(data).toHaveProperty('exportedAt');
    });
  });

  describe('importData', () => {
    it('should import agents', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({ run: jest.fn() });

      const data = {
        agents: [
          {
            agentId: 'agent-1',
            name: 'Imported Agent',
            type: 'dev',
            profile: {
              characterId: 'char-1',
              name: 'Test',
              bodyType: 'male',
              parts: {}
            },
            backendType: 'openclaw',
            configStatus: 'draft',
            soul: {
              identity: 'Identity',
              goals: ['Goal'],
              personality: 'Personality'
            },
            memory: { shortTerm: [], longTerm: [], context: '' }
          }
        ]
      };

      await store.importData(data);
      expect(agentRepository.saveAgent).toHaveBeenCalled();
    });
  });

  describe('saveChatMessage', () => {
    it('should save chat message', async () => {
      await store.initialize();

      const msg = {
        messageId: 'msg-1',
        agentId: 'agent-1',
        role: 'user' as const,
        content: 'Hello',
        timestamp: Date.now()
      };

      await store.saveChatMessage(msg);
      expect(agentChatMessageRepository.saveMessage).toHaveBeenCalledWith(msg);
    });
  });

  describe('getChatMessages', () => {
    it('should get chat messages for agent', async () => {
      await store.initialize();
      const messages = await store.getChatMessages('agent-1');
      expect(agentChatMessageRepository.getMessagesByAgentId).toHaveBeenCalledWith('agent-1', 20, 0);
    });
  });

  describe('searchChatMessages', () => {
    it('should search chat messages', async () => {
      await store.initialize();
      const messages = await store.searchChatMessages('agent-1', ['hello'], 10);
      expect(agentChatMessageRepository.searchMessages).toHaveBeenCalledWith('agent-1', ['hello'], 10);
    });
  });

  describe('deleteChatMessages', () => {
    it('should delete chat messages for agent', async () => {
      await store.initialize();
      await store.deleteChatMessages('agent-1');
      expect(agentChatMessageRepository.deleteMessagesByAgentId).toHaveBeenCalledWith('agent-1');
    });
  });

  describe('setPresetTemplates', () => {
    it('should log not implemented message', async () => {
      await store.initialize();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      await store.setPresetTemplates([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[StratixDataStore] setPresetTemplates not implemented in SQLite'
      );
    });
  });
});
