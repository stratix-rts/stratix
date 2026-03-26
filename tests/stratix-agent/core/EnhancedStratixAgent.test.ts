/**
 * EnhancedStratixAgent Unit Tests
 *
 * These tests focus on the methods that can be tested without complex LLM mocking.
 * For full integration tests, use Playwright E2E tests.
 */

import { EnhancedStratixAgent } from '@/stratix-agent/EnhancedStratixAgent';
import { AgentConfig, SoulConfig } from '@/stratix-agent/types';
import { AgentTemplate } from '@/stratix-agent/types/template';

// Complete mock AgentConfig for testing
const createTestConfig = (): AgentConfig => ({
  agentId: 'test-agent',
  name: 'Test Agent',
  type: 'custom',
  provider: 'openai',
  model: 'gpt-4',
  apiKey: 'test-key',
  temperature: 0.7,
  maxTokens: 2000,
  maxShortTerm: 20,
  enableLongTerm: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const createTestSoul = (): SoulConfig => ({
  identity: 'Test AI',
  personality: 'Helpful',
});

const createTestTemplate = (): AgentTemplate => ({
  id: 'test-template',
  name: 'Test Agent',
  version: '1.0.0',
  description: 'A test agent',
  domain: 'engineering',
  tags: ['test'],
  mixins: [],
  identity: 'You are a test agent.',
  personality: 'Professional',
  tone: 'Neutral',
  mission: 'Help with testing.',
  workflows: [],
  rules: [],
  constraints: [],
  forbiddenActions: [],
  skills: [
    {
      skillId: 'test-skill',
      name: 'Test Skill',
      description: 'A test skill',
      parameters: [],
    },
  ],
  workflowSteps: [],
  successMetrics: [],
  metadata: { author: 'Test' },
});

describe('EnhancedStratixAgent - Evolution Status', () => {
  describe('getEvolutionStatus', () => {
    test('returns initial status with zero counts', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      const status = agent.getEvolutionStatus();

      expect(status.evolutionCount).toBe(0);
      expect(status.consecutiveFailures).toBe(0);
      expect(status.lastEvolutionTime).toBe(0);
      expect(status.pendingProposal).toBeNull();
      expect(status['熔断触发']).toBe(false);
    });
  });

  describe('resetEvolutionCircuitBreaker', () => {
    test('resets consecutive failures to zero', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      agent.resetEvolutionCircuitBreaker();
      const status = agent.getEvolutionStatus();

      expect(status.consecutiveFailures).toBe(0);
      expect(status['熔断触发']).toBe(false);
    });
  });

  describe('resetDailyEvolutionCount', () => {
    test('resets evolution count to zero', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      agent.resetDailyEvolutionCount();
      const status = agent.getEvolutionStatus();

      expect(status.evolutionCount).toBe(0);
    });
  });

  describe('initEvolution', () => {
    test('initializes with default values', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      agent.initEvolution();
      const status = agent.getEvolutionStatus();

      // Should initialize without errors
      expect(status).toBeDefined();
      expect(status.evolutionCount).toBe(0);
    });

    test('initializes with custom configuration', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      agent.initEvolution({
        enabled: true,
        triggerThreshold: 10,
        cooldownHours: 48,
        maxEvolutionsPerDay: 5,
        consecutiveFailuresToBreak: 5,
      });

      const status = agent.getEvolutionStatus();
      expect(status).toBeDefined();
      expect(status.evolutionCount).toBe(0);
    });
  });

  describe('setEvolutionProposalCallback', () => {
    test('accepts a callback function', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      const callback = async () => true;
      expect(() => agent.setEvolutionProposalCallback(callback)).not.toThrow();
    });
  });

  describe('getPendingEvolutionProposal', () => {
    test('returns null initially', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      expect(agent.getPendingEvolutionProposal()).toBeNull();
    });
  });

  describe('rejectEvolution', () => {
    test('handles null proposal gracefully', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      const proposal = {
        id: 'test-proposal',
        agentId: 'test-agent',
        timestamp: new Date().toISOString(),
        proposedChanges: { goals: ['New goal'] },
        reason: 'Test',
        reflectionCount: 5,
      };

      // Should not throw
      expect(() => agent.rejectEvolution(proposal)).not.toThrow();
      expect(agent.getPendingEvolutionProposal()).toBeNull();
    });
  });
});

describe('EnhancedStratixAgent - Template Management', () => {
  describe('getTemplate', () => {
    test('returns null when no template loaded', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      expect(agent.getTemplate()).toBeNull();
    });
  });

  describe('loadTemplate', () => {
    test('loads and returns template', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      const template = createTestTemplate();
      const result = agent.loadTemplate(template);

      expect(result).toBe(template);
      expect(agent.getTemplate()).toBe(template);
    });
  });

  describe('applyMixin/removeMixin without template', () => {
    test('does not throw when no template loaded', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      expect(() => agent.applyMixin('base')).not.toThrow();
      expect(() => agent.applyMixin('resource')).not.toThrow();
      expect(() => agent.applyMixin('compliance')).not.toThrow();
      expect(() => agent.removeMixin('base')).not.toThrow();
    });
  });
});

describe('EnhancedStratixAgent - Reflection History', () => {
  describe('getReflectionHistory', () => {
    test('returns empty array initially', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      expect(agent.getReflectionHistory()).toEqual([]);
    });
  });

  describe('clearReflectionHistory', () => {
    test('clears reflection history', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      agent.clearReflectionHistory();
      expect(agent.getReflectionHistory()).toEqual([]);
    });
  });
});

describe('EnhancedStratixAgent - Memory Entries', () => {
  describe('getMemoryEntries', () => {
    test('returns empty array initially', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      expect(agent.getMemoryEntries()).toEqual([]);
    });
  });

  describe('clearMemory', () => {
    test('clears memory entries', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      agent.clearMemory();
      expect(agent.getMemoryEntries()).toEqual([]);
    });
  });
});

describe('EnhancedStratixAgent - Capabilities', () => {
  describe('getCapabilities', () => {
    test('returns capabilities object', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      const capabilities = agent.getCapabilities();

      expect(capabilities).toHaveProperty('workflowExecution');
      expect(capabilities).toHaveProperty('reflection');
      expect(capabilities).toHaveProperty('toolUse');
      expect(capabilities).toHaveProperty('multiStepPlanning');
      expect(capabilities).toHaveProperty('selfCorrection');
    });

    test('reflection capability is true', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      const capabilities = agent.getCapabilities();
      expect(capabilities.reflection).toBe(true);
    });

    test('selfCorrection capability is true', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      const capabilities = agent.getCapabilities();
      expect(capabilities.selfCorrection).toBe(true);
    });

    test('workflowExecution is false without workflows', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      const capabilities = agent.getCapabilities();
      expect(capabilities.workflowExecution).toBe(false);
    });

    test('toolUse is false without enabled skills', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      const capabilities = agent.getCapabilities();
      expect(capabilities.toolUse).toBe(false);
    });

    test('multiStepPlanning is false without workflowSteps', () => {
      const config = createTestConfig();
      const soul = createTestSoul();
      const agent = new EnhancedStratixAgent(config, soul);

      const capabilities = agent.getCapabilities();
      expect(capabilities.multiStepPlanning).toBe(false);
    });
  });
});

describe('EnhancedStratixAgent - performEvolution', () => {
  test('returns error when evolution conditions not met', async () => {
    const config = createTestConfig();
    const soul = createTestSoul();
    const agent = new EnhancedStratixAgent(config, soul);

    const result = await agent.performEvolution();

    expect(result.success).toBe(false);
    expect(result.error).toContain('not met');
  });
});
