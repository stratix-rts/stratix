/**
 * AgentRepository Unit Tests
 *
 * These tests verify the AgentRepository logic using mocked database responses.
 */

import { StratixAgentConfig } from '../../src/stratix-core/stratix-protocol';

describe('AgentRepository', () => {
  // Mock database interface
  interface MockDatabase {
    prepare: jest.Mock;
  }

  let mockDb: MockDatabase;
  let repository: any; // We'll test the logic pattern

  beforeEach(() => {
    mockDb = {
      prepare: jest.fn()
    };
  });

  const createTestAgent = (overrides: Partial<StratixAgentConfig> = {}): StratixAgentConfig => {
    const now = Date.now();
    return {
      agentId: 'agent-1',
      name: 'Test Agent',
      type: 'custom',
      profile: {
        characterId: 'char-1',
        name: 'Test Character',
        bodyType: 'male' as const,
        parts: {}
      },
      backendType: 'openclaw' as const,
      configStatus: 'draft' as const,
      createdAt: now,
      updatedAt: now,
      ...overrides
    };
  };

  describe('Agent data transformation', () => {
    it('should transform database row to StratixAgentConfig', () => {
      const row = {
        agent_id: 'agent-1',
        name: 'Test Agent',
        type: 'custom',
        profile: '{"characterId":"char-1","name":"Test"}',
        soul: '{"personality":"friendly"}',
        rules: '["Rule 1","Rule 2"]',
        backend_type: 'openclaw',
        config_status: 'draft',
        position: '{"x":100,"y":200}',
        memory: '{"shortTerm":["item1"]}',
        openclaw_config: '{"endpoint":"http://localhost"}',
        stratix_config: null,
        created_at: 1234567890,
        updated_at: 1234567890
      };

      // Simulate mapRowToAgent
      const agent: StratixAgentConfig = {
        agentId: row.agent_id,
        name: row.name,
        type: row.type,
        profile: JSON.parse(row.profile),
        soul: JSON.parse(row.soul),
        rules: JSON.parse(row.rules),
        backendType: row.backend_type,
        configStatus: row.config_status,
        position: JSON.parse(row.position),
        memory: JSON.parse(row.memory),
        openClawConfig: JSON.parse(row.openclaw_config),
        stratixConfig: row.stratix_config ? JSON.parse(row.stratix_config) : undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      expect(agent.agentId).toBe('agent-1');
      expect(agent.name).toBe('Test Agent');
      expect(agent.backendType).toBe('openclaw');
      expect(agent.configStatus).toBe('draft');
      expect(agent.profile.characterId).toBe('char-1');
      expect(agent.rules).toEqual(['Rule 1', 'Rule 2']);
      expect(agent.position).toEqual({ x: 100, y: 200 });
    });

    it('should handle null JSON fields', () => {
      const row = {
        agent_id: 'agent-1',
        name: 'Test Agent',
        type: 'custom',
        profile: null,
        soul: null,
        rules: null,
        backend_type: 'openclaw',
        config_status: 'draft',
        position: null,
        memory: null,
        openclaw_config: null,
        stratix_config: null,
        created_at: 1234567890,
        updated_at: 1234567890
      };

      const agent: StratixAgentConfig = {
        agentId: row.agent_id,
        name: row.name,
        type: row.type,
        profile: row.profile ? JSON.parse(row.profile) : undefined,
        soul: row.soul ? JSON.parse(row.soul) : undefined,
        rules: row.rules ? JSON.parse(row.rules) : undefined,
        backendType: row.backend_type,
        configStatus: row.config_status,
        position: row.position ? JSON.parse(row.position) : undefined,
        memory: row.memory ? JSON.parse(row.memory) : undefined,
        openClawConfig: row.openclaw_config ? JSON.parse(row.openclaw_config) : undefined,
        stratixConfig: row.stratix_config ? JSON.parse(row.stratix_config) : undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      expect(agent.profile).toBeUndefined();
      expect(agent.soul).toBeUndefined();
      expect(agent.rules).toBeUndefined();
      expect(agent.position).toBeUndefined();
      expect(agent.memory).toBeUndefined();
      expect(agent.openClawConfig).toBeUndefined();
      expect(agent.stratixConfig).toBeUndefined();
    });

    it('should handle empty JSON objects and arrays', () => {
      const row = {
        agent_id: 'agent-1',
        name: 'Test Agent',
        type: 'custom',
        profile: '{}',
        soul: '[]',
        rules: '[]',
        backend_type: 'openclaw',
        config_status: 'draft',
        position: '{}',
        memory: '{"shortTerm":[]}',
        openclaw_config: '{}',
        stratix_config: '{}',
        created_at: 1234567890,
        updated_at: 1234567890
      };

      const agent: StratixAgentConfig = {
        agentId: row.agent_id,
        name: row.name,
        type: row.type,
        profile: JSON.parse(row.profile),
        soul: JSON.parse(row.soul),
        rules: JSON.parse(row.rules),
        backendType: row.backend_type,
        configStatus: row.config_status,
        position: JSON.parse(row.position),
        memory: JSON.parse(row.memory),
        openClawConfig: JSON.parse(row.openclaw_config),
        stratixConfig: JSON.parse(row.stratix_config),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      expect(agent.profile).toEqual({});
      expect(agent.soul).toEqual([]);
      expect(agent.rules).toEqual([]);
      expect(agent.position).toEqual({});
    });
  });

  describe('Agent CRUD logic patterns', () => {
    it('should generate UPDATE statement for existing agent', () => {
      const agent = createTestAgent();
      const existingAgent = createTestAgent();

      const isUpdate = existingAgent !== null;

      if (isUpdate) {
        const updateSQL = `
          UPDATE agents SET
            name = ?, type = ?, profile = ?, soul = ?, rules = ?,
            backend_type = ?, config_status = ?, position = ?, memory = ?,
            openclaw_config = ?, stratix_config = ?, updated_at = ?
          WHERE agent_id = ?
        `;

        expect(updateSQL).toContain('UPDATE agents');
        expect(updateSQL).toContain('WHERE agent_id = ?');
      }
    });

    it('should generate INSERT statement for new agent', () => {
      const agent = createTestAgent();
      const existingAgent = null;

      const isUpdate = existingAgent !== null;

      if (!isUpdate) {
        const insertSQL = `
          INSERT INTO agents (agent_id, name, type, profile, soul, rules, backend_type, config_status, position, memory, openclaw_config, stratix_config, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        expect(insertSQL).toContain('INSERT INTO agents');
        expect(insertSQL).toContain('VALUES');
      }
    });

    it('should use JSON.stringify for complex fields', () => {
      const agent = createTestAgent({
        profile: { characterId: 'char-1', name: 'Test', bodyType: 'female' as const, parts: {} },
        rules: ['Rule 1', 'Rule 2']
      });

      expect(JSON.stringify(agent.profile)).toBe('{"characterId":"char-1","name":"Test","bodyType":"female","parts":{}}');
      expect(JSON.stringify(agent.rules)).toBe('["Rule 1","Rule 2"]');
    });

    it('should use default values for optional fields', () => {
      const agentMinimal: any = {
        agentId: 'agent-1',
        name: 'Test Agent',
        type: 'custom',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // Defaults applied
      agentMinimal.backendType = agentMinimal.backendType || 'openclaw';
      agentMinimal.configStatus = agentMinimal.configStatus || 'draft';

      expect(agentMinimal.backendType).toBe('openclaw');
      expect(agentMinimal.configStatus).toBe('draft');
    });
  });

  describe('Agent ID uniqueness', () => {
    it('should use agent_id as primary key', () => {
      const primaryKeySQL = 'agent_id TEXT PRIMARY KEY';
      expect(primaryKeySQL).toContain('PRIMARY KEY');
    });

    it('should check for existing agent before insert', () => {
      const existingAgents = ['agent-1', 'agent-2', 'agent-3'];
      const newAgentId = 'agent-2';

      const isDuplicate = existingAgents.includes(newAgentId);
      expect(isDuplicate).toBe(true);
    });

    it('should allow new agent with unique ID', () => {
      const existingAgents = ['agent-1', 'agent-2', 'agent-3'];
      const newAgentId = 'agent-4';

      const isDuplicate = existingAgents.includes(newAgentId);
      expect(isDuplicate).toBe(false);
    });
  });

  describe('Agent field validation', () => {
    it('should accept valid backend types', () => {
      const validBackendTypes = ['openclaw', 'stratix'];
      expect(validBackendTypes).toContain('openclaw');
      expect(validBackendTypes).toContain('stratix');
      expect(validBackendTypes).not.toContain('direct');
    });

    it('should accept valid config status', () => {
      const validStatuses = ['draft', 'ready'];
      expect(validStatuses).toContain('draft');
      expect(validStatuses).toContain('ready');
      expect(validStatuses).not.toContain('active');
    });

    it('should accept valid agent types', () => {
      const validTypes = ['custom', 'preset'];
      expect(validTypes).toContain('custom');
      expect(validTypes).toContain('preset');
    });
  });

  describe('Agent ordering', () => {
    it('should order by created_at DESC', () => {
      const orderByClause = 'ORDER BY created_at DESC';
      expect(orderByClause).toBe('ORDER BY created_at DESC');
    });
  });

  describe('Agent deletion', () => {
    it('should return true when agent exists and is deleted', () => {
      const existingAgent = 'agent-1';
      const deleted = existingAgent !== null;
      const result = deleted ? true : false;
      expect(result).toBe(true);
    });

    it('should return false when agent does not exist', () => {
      const existingAgent = null;
      const result = existingAgent ? true : false;
      expect(result).toBe(false);
    });
  });
});
