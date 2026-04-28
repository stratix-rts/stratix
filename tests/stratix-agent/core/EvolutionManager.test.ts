/**
 * EvolutionManager Unit Tests
 *
 * Tests evolution conditions, proposal generation, parsing, apply/confirm/reject.
 */

import { EvolutionManager } from '@/stratix-agent/core/EvolutionManager';
import type { LLMConnector } from '@/stratix-agent/core/LLMConnector';
import type { EnhancedSoulConfig, ReflectionEntry } from '@/stratix-agent/types/soul';
import type { EvolutionProposal } from '@/stratix-agent/types';

const createMockLLM = (): jest.Mocked<LLMConnector> => ({
  generate: jest.fn().mockResolvedValue({ content: '{"goals": ["new goal"], "personality": "evolved", "constraints": ["new constraint"]}', finishReason: 'stop' }),
} as unknown as jest.Mocked<LLMConnector>);

const createTestSoul = (overrides?: Partial<EnhancedSoulConfig>): EnhancedSoulConfig => ({
  identity: 'Test Agent',
  personality: 'Helpful',
  goals: ['original goal'],
  constraints: ['original constraint'],
  reflection: {
    enabled: true,
    afterEachTask: true,
    onError: true,
    weeklyReview: false,
    evolutionCheck: {
      enabled: true,
      triggerThreshold: 5,
      cooldownHours: 24,
      maxEvolutionsPerDay: 3,
    },
  },
  ...overrides,
});

const createReflections = (count: number): ReflectionEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `ref-${i}`,
    timestamp: new Date().toISOString(),
    task: `task-${i}`,
    result: `result-${i}`,
    reflection: `reflection-${i}`,
  }));

describe('EvolutionManager', () => {
  let manager: EvolutionManager;
  let mockLLM: jest.Mocked<LLMConnector>;
  let reflections: ReflectionEntry[];
  let addMemoryEntry: jest.Mock;

  beforeEach(() => {
    mockLLM = createMockLLM();
    reflections = createReflections(5);
    addMemoryEntry = jest.fn().mockResolvedValue(undefined);

    manager = new EvolutionManager({
      llm: mockLLM,
      soul: createTestSoul(),
      agentId: 'test-agent',
      getReflectionHistory: () => reflections,
      clearReflectionHistory: () => { reflections = []; },
      addMemoryEntry,
    });
  });

  describe('initEvolution', () => {
    test('initializes with default values when no config provided', () => {
      manager.initEvolution();
      const status = manager.getEvolutionStatus();
      expect(status).toBeDefined();
      expect(status.evolutionCount).toBe(0);
    });

    test('initializes with custom configuration', () => {
      manager.initEvolution({
        enabled: true,
        triggerThreshold: 10,
        cooldownHours: 48,
        maxEvolutionsPerDay: 5,
        consecutiveFailuresToBreak: 5,
      });

      // canEvolve should use these values
      reflections = createReflections(10);
      expect(manager.canEvolve()).toBe(true);
    });
  });

  describe('canEvolve', () => {
    test('returns false when evolution is disabled', () => {
      manager = new EvolutionManager({
        llm: mockLLM,
        soul: createTestSoul({ reflection: { enabled: true, afterEachTask: true, onError: true, weeklyReview: false, evolutionCheck: { enabled: false, triggerThreshold: 5, cooldownHours: 24, maxEvolutionsPerDay: 3 } } }),
        agentId: 'test-agent',
        getReflectionHistory: () => reflections,
        clearReflectionHistory: jest.fn(),
        addMemoryEntry,
      });
      manager.initEvolution({ enabled: false });

      expect(manager.canEvolve()).toBe(false);
    });

    test('returns false when reflection count below threshold', () => {
      reflections = createReflections(3);
      expect(manager.canEvolve()).toBe(false);
    });

    test('returns false when in cooldown period', () => {
      // Force last evolution to now
      (manager as any).lastEvolutionTime = Date.now();
      expect(manager.canEvolve()).toBe(false);
    });

    test('returns false when max evolutions per day reached', () => {
      (manager as any).evolutionCount = 3;
      expect(manager.canEvolve()).toBe(false);
    });

    test('returns false when circuit breaker triggered', () => {
      (manager as any).consecutiveFailures = 3;
      expect(manager.canEvolve()).toBe(false);
    });

    test('returns true when all conditions met', () => {
      reflections = createReflections(5);
      expect(manager.canEvolve()).toBe(true);
    });

    test('uses initEvolution values when soul config missing', () => {
      manager = new EvolutionManager({
        llm: mockLLM,
        soul: createTestSoul({ reflection: undefined }),
        agentId: 'test-agent',
        getReflectionHistory: () => reflections,
        clearReflectionHistory: jest.fn(),
        addMemoryEntry,
      });
      manager.initEvolution({ enabled: true, triggerThreshold: 5, cooldownHours: 24, maxEvolutionsPerDay: 3 });

      reflections = createReflections(5);
      expect(manager.canEvolve()).toBe(true);
    });
  });

  describe('performEvolution', () => {
    test('returns error when evolution conditions not met', async () => {
      reflections = createReflections(2);
      const result = await manager.performEvolution();

      expect(result.success).toBe(false);
      expect(result.error).toContain('not met');
      expect(mockLLM.generate).not.toHaveBeenCalled();
    });

    test('generates proposal with valid LLM response', async () => {
      mockLLM.generate.mockResolvedValue({
        content: '{"goals": ["learn more"], "personality": "Enhanced", "constraints": ["be careful"]}',
        finishReason: 'stop',
      });

      const result = await manager.performEvolution();

      expect(result.success).toBe(false); // requiresUserConfirmation=true, success=false until confirmed
      expect(result.requiresUserConfirmation).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockLLM.generate).toHaveBeenCalledTimes(1);

      const proposal = manager.getPendingEvolutionProposal();
      expect(proposal).not.toBeNull();
      expect(proposal!.agentId).toBe('test-agent');
      expect(proposal!.proposedChanges.goals).toContain('learn more');
    });

    test('increments consecutiveFailures on invalid JSON response', async () => {
      mockLLM.generate.mockResolvedValue({ content: 'not valid json at all', finishReason: 'stop' });

      const result = await manager.performEvolution();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to generate valid evolution proposal');
      expect((manager as any).consecutiveFailures).toBe(1);
    });

    test('increments consecutiveFailures on LLM error', async () => {
      mockLLM.generate.mockRejectedValue(new Error('LLM timeout'));

      const result = await manager.performEvolution();

      expect(result.success).toBe(false);
      expect(result.error).toContain('LLM timeout');
      expect((manager as any).consecutiveFailures).toBe(1);
    });

    test('auto-applies proposal when callback confirms', async () => {
      mockLLM.generate.mockResolvedValue({
        content: '{"goals": ["auto goal"]}',
        finishReason: 'stop',
      });

      manager.setEvolutionProposalCallback(async () => true);

      const result = await manager.performEvolution();

      expect(result.success).toBe(true);
      expect(result.evolvedFields).toEqual({ goals: ['original goal', 'auto goal'] });
      expect(result.evolutionCount).toBe(1);
      expect(manager.getPendingEvolutionProposal()).toBeNull();
    });

    test('rejects proposal when callback returns false', async () => {
      mockLLM.generate.mockResolvedValue({
        content: '{"goals": ["rejected goal"]}',
        finishReason: 'stop',
      });

      manager.setEvolutionProposalCallback(async () => false);

      const result = await manager.performEvolution();

      expect(result.success).toBe(false);
      expect(result.error).toContain('rejected');
      expect(result.evolutionCount).toBe(0);
    });

    test('returns requiresUserConfirmation when no callback set', async () => {
      mockLLM.generate.mockResolvedValue({
        content: '{"goals": ["pending goal"]}',
        finishReason: 'stop',
      });

      const result = await manager.performEvolution();

      expect(result.success).toBe(false);
      expect(result.requiresUserConfirmation).toBe(true);
      expect(manager.getPendingEvolutionProposal()).not.toBeNull();
    });
  });

  describe('parseEvolutionResponse', () => {
    test('parses valid JSON with all fields', () => {
      const soul = createTestSoul();
      const content = '{"goals": ["g1", "g2"], "personality": "new personality", "constraints": ["c1"]}';

      const result = (manager as any).parseEvolutionResponse(content, soul);

      expect(result).toEqual({
        goals: ['original goal', 'g1', 'g2'],
        personality: 'new personality',
        constraints: ['original constraint', 'c1'],
      });
    });

    test('parses JSON embedded in markdown', () => {
      const soul = createTestSoul();
      const content = 'Here is the suggestion:\n```json\n{"goals": ["embedded"]}\n```';

      const result = (manager as any).parseEvolutionResponse(content, soul);

      expect(result?.goals).toContain('embedded');
    });

    test('returns null when no JSON found', () => {
      const soul = createTestSoul();
      const result = (manager as any).parseEvolutionResponse('just text', soul);
      expect(result).toBeNull();
    });

    test('returns null on invalid JSON', () => {
      const soul = createTestSoul();
      const result = (manager as any).parseEvolutionResponse('{invalid json}', soul);
      expect(result).toBeNull();
    });

    test('filters out empty goals and constraints', () => {
      const soul = createTestSoul();
      const content = '{"goals": ["valid", "", "  "], "constraints": ["", "valid constraint"]}';

      const result = (manager as any).parseEvolutionResponse(content, soul);

      expect(result?.goals).toEqual(['original goal', 'valid']);
      expect(result?.constraints).toEqual(['original constraint', 'valid constraint']);
    });

    test('deduplicates goals and constraints', () => {
      const soul = createTestSoul({ goals: ['duplicate'], constraints: ['dup'] });
      const content = '{"goals": ["duplicate", "new"], "constraints": ["dup", "new-c"]}';

      const result = (manager as any).parseEvolutionResponse(content, soul);

      expect(result?.goals).toEqual(['duplicate', 'new']);
      expect(result?.constraints).toEqual(['dup', 'new-c']);
    });

    test('ignores non-array goals', () => {
      const soul = createTestSoul();
      const content = '{"goals": "not an array"}';

      const result = (manager as any).parseEvolutionResponse(content, soul);
      expect(result?.goals).toBeUndefined();
    });

    test('ignores non-string personality', () => {
      const soul = createTestSoul();
      const content = '{"personality": 123}';

      const result = (manager as any).parseEvolutionResponse(content, soul);
      expect(result?.personality).toBeUndefined();
    });

    test('handles partial JSON with only goals', () => {
      const soul = createTestSoul();
      const content = '{"goals": ["only goal"]}';

      const result = (manager as any).parseEvolutionResponse(content, soul);
      expect(result?.goals).toEqual(['original goal', 'only goal']);
      expect(result?.personality).toBeUndefined();
      expect(result?.constraints).toBeUndefined();
    });
  });

  describe('applyEvolution', () => {
    test('applies all proposed changes to soul', async () => {
      const soul = createTestSoul();
      const proposal: EvolutionProposal = {
        id: 'evo-1',
        agentId: 'test-agent',
        timestamp: new Date().toISOString(),
        proposedChanges: {
          goals: ['goal1', 'goal2'],
          personality: 'Evolved Personality',
          constraints: ['c1'],
        },
        reason: 'Test evolution',
        reflectionCount: 5,
      };

      manager = new EvolutionManager({
        llm: mockLLM,
        soul,
        agentId: 'test-agent',
        getReflectionHistory: () => reflections,
        clearReflectionHistory: () => { reflections = []; },
        addMemoryEntry,
      });

      const result = await manager.applyEvolution(proposal);

      expect(result.success).toBe(true);
      expect(result.evolvedFields).toEqual(proposal.proposedChanges);
      expect(soul.goals).toEqual(['goal1', 'goal2']);
      expect(soul.personality).toBe('Evolved Personality');
      expect(soul.constraints).toEqual(['c1']);
    });

    test('updates evolution state after application', async () => {
      const soul = createTestSoul();
      const proposal: EvolutionProposal = {
        id: 'evo-1',
        agentId: 'test-agent',
        timestamp: new Date().toISOString(),
        proposedChanges: { goals: ['new goal'] },
        reason: 'Test',
        reflectionCount: 5,
      };

      manager = new EvolutionManager({
        llm: mockLLM,
        soul,
        agentId: 'test-agent',
        getReflectionHistory: () => reflections,
        clearReflectionHistory: jest.fn(),
        addMemoryEntry,
      });

      const result = await manager.applyEvolution(proposal);

      expect(result.evolutionCount).toBe(1);
      expect(result.consecutiveFailures).toBe(0);
      expect(manager.getPendingEvolutionProposal()).toBeNull();
    });

    test('clears reflection history after evolution', async () => {
      const clearFn = jest.fn();
      const soul = createTestSoul();
      const proposal: EvolutionProposal = {
        id: 'evo-1',
        agentId: 'test-agent',
        timestamp: new Date().toISOString(),
        proposedChanges: { goals: ['new goal'] },
        reason: 'Test',
        reflectionCount: 5,
      };

      manager = new EvolutionManager({
        llm: mockLLM,
        soul,
        agentId: 'test-agent',
        getReflectionHistory: () => reflections,
        clearReflectionHistory: clearFn,
        addMemoryEntry,
      });

      await manager.applyEvolution(proposal);
      expect(clearFn).toHaveBeenCalledTimes(1);
    });

    test('saves memory entry after evolution', async () => {
      const soul = createTestSoul();
      const proposal: EvolutionProposal = {
        id: 'evo-1',
        agentId: 'test-agent',
        timestamp: new Date().toISOString(),
        proposedChanges: { goals: ['new goal'] },
        reason: 'Test',
        reflectionCount: 5,
      };

      manager = new EvolutionManager({
        llm: mockLLM,
        soul,
        agentId: 'test-agent',
        getReflectionHistory: () => reflections,
        clearReflectionHistory: jest.fn(),
        addMemoryEntry,
      });

      await manager.applyEvolution(proposal);
      expect(addMemoryEntry).toHaveBeenCalledWith(
        expect.stringContaining('Soul 进化完成'),
        3
      );
    });

    test('handles errors during application', async () => {
      const soul = createTestSoul();
      const proposal: EvolutionProposal = {
        id: 'evo-1',
        agentId: 'test-agent',
        timestamp: new Date().toISOString(),
        proposedChanges: { goals: ['new goal'] },
        reason: 'Test',
        reflectionCount: 5,
      };

      addMemoryEntry.mockRejectedValue(new Error('Memory failure'));

      manager = new EvolutionManager({
        llm: mockLLM,
        soul,
        agentId: 'test-agent',
        getReflectionHistory: () => reflections,
        clearReflectionHistory: jest.fn(),
        addMemoryEntry,
      });

      const result = await manager.applyEvolution(proposal);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Memory failure');
      expect((manager as any).consecutiveFailures).toBe(1);
    });
  });

  describe('confirmEvolution', () => {
    test('delegates to applyEvolution', async () => {
      const soul = createTestSoul();
      const proposal: EvolutionProposal = {
        id: 'evo-1',
        agentId: 'test-agent',
        timestamp: new Date().toISOString(),
        proposedChanges: { goals: ['confirmed'] },
        reason: 'Test',
        reflectionCount: 5,
      };

      manager = new EvolutionManager({
        llm: mockLLM,
        soul,
        agentId: 'test-agent',
        getReflectionHistory: () => reflections,
        clearReflectionHistory: jest.fn(),
        addMemoryEntry,
      });

      const result = await manager.confirmEvolution(proposal);

      expect(result.success).toBe(true);
      expect(soul.goals).toEqual(['confirmed']);
    });
  });

  describe('rejectEvolution', () => {
    test('clears pending proposal when IDs match', async () => {
      mockLLM.generate.mockResolvedValue({
        content: '{"goals": ["rejected"]}',
        finishReason: 'stop',
      });

      await manager.performEvolution();
      const proposal = manager.getPendingEvolutionProposal();
      expect(proposal).not.toBeNull();

      manager.rejectEvolution(proposal!);
      expect(manager.getPendingEvolutionProposal()).toBeNull();
    });

    test('does nothing when proposal ID does not match', async () => {
      mockLLM.generate.mockResolvedValue({
        content: '{"goals": ["kept"]}',
        finishReason: 'stop',
      });

      await manager.performEvolution();
      const proposal = manager.getPendingEvolutionProposal()!;

      manager.rejectEvolution({ ...proposal, id: 'different-id' });
      expect(manager.getPendingEvolutionProposal()).not.toBeNull();
    });
  });

  describe('getEvolutionStatus', () => {
    test('returns initial status', () => {
      const status = manager.getEvolutionStatus();

      expect(status.evolutionCount).toBe(0);
      expect(status.consecutiveFailures).toBe(0);
      expect(status.lastEvolutionTime).toBe(0);
      expect(status.pendingProposal).toBeNull();
      expect(status['熔断触发']).toBe(false);
    });

    test('reflects circuit breaker when consecutive failures high', () => {
      (manager as any).consecutiveFailures = 3;
      const status = manager.getEvolutionStatus();
      expect(status['熔断触发']).toBe(true);
    });
  });

  describe('resetEvolutionCircuitBreaker', () => {
    test('resets consecutive failures to zero', () => {
      (manager as any).consecutiveFailures = 2;
      manager.resetEvolutionCircuitBreaker();
      expect(manager.getEvolutionStatus().consecutiveFailures).toBe(0);
    });
  });

  describe('resetDailyEvolutionCount', () => {
    test('resets evolution count to zero', () => {
      (manager as any).evolutionCount = 2;
      manager.resetDailyEvolutionCount();
      expect(manager.getEvolutionStatus().evolutionCount).toBe(0);
    });
  });

  describe('setEvolutionProposalCallback', () => {
    test('accepts a callback function', () => {
      const callback = async () => true;
      expect(() => manager.setEvolutionProposalCallback(callback)).not.toThrow();
    });
  });
});
