/**
 * ReflectionManager Unit Tests
 *
 * Tests reflection generation, self-correction, memory entries, and history.
 */

import { ReflectionManager } from '@/stratix-agent/core/ReflectionManager';
import type { LLMConnector } from '@/stratix-agent/core/LLMConnector';
import type { MemoryManager } from '@/stratix-agent/core/MemoryManager';
import type { EnhancedSoulConfig, ReflectionEntry } from '@/stratix-agent/types/soul';

const createMockLLM = (): jest.Mocked<LLMConnector> => ({
  generate: jest.fn().mockResolvedValue({ content: 'mocked reflection', finishReason: 'stop' }),
} as unknown as jest.Mocked<LLMConnector>);

const createMockMemory = (): jest.Mocked<MemoryManager> => ({
  addLongTermMemory: jest.fn().mockReturnValue(undefined),
} as unknown as jest.Mocked<MemoryManager>);

const createTestSoul = (overrides?: Partial<EnhancedSoulConfig>): EnhancedSoulConfig => ({
  identity: 'Test AI',
  personality: 'Helpful',
  reflection: {
    enabled: true,
    afterEachTask: true,
    onError: true,
    weeklyReview: false,
    evolutionCheck: {
      enabled: false,
      triggerThreshold: 5,
      cooldownHours: 24,
      maxEvolutionsPerDay: 3,
    },
  },
  ...overrides,
});

describe('ReflectionManager', () => {
  let manager: ReflectionManager;
  let mockLLM: jest.Mocked<LLMConnector>;
  let mockMemory: jest.Mocked<MemoryManager>;

  beforeEach(() => {
    mockLLM = createMockLLM();
    mockMemory = createMockMemory();
    manager = new ReflectionManager({
      llm: mockLLM,
      soul: createTestSoul(),
      memory: mockMemory,
    });
  });

  describe('performReflection', () => {
    test('does nothing when reflection is disabled', async () => {
      manager = new ReflectionManager({
        llm: mockLLM,
        soul: createTestSoul({ reflection: { enabled: false, afterEachTask: true, onError: true, weeklyReview: false } }),
        memory: mockMemory,
      });

      await manager.performReflection('task', 'result');

      expect(mockLLM.generate).not.toHaveBeenCalled();
      expect(manager.getReflectionHistory()).toEqual([]);
    });

    test('generates reflection and adds to history', async () => {
      mockLLM.generate.mockResolvedValue({ content: 'The task was completed well.', finishReason: 'stop' });

      await manager.performReflection('write code', 'code written');

      expect(mockLLM.generate).toHaveBeenCalledTimes(1);
      const prompt = (mockLLM.generate as jest.Mock).mock.calls[0][0][0].content;
      expect(prompt).toContain('任务: write code');
      expect(prompt).toContain('结果: code written');

      const history = manager.getReflectionHistory();
      expect(history.length).toBe(1);
      expect(history[0].task).toBe('write code');
      expect(history[0].result).toBe('code written');
      expect(history[0].reflection).toBe('The task was completed well.');
    });

    test('triggers self-correction when result contains [ERROR]', async () => {
      mockLLM.generate
        .mockResolvedValueOnce({ content: 'There was an error.', finishReason: 'stop' })
        .mockResolvedValueOnce({ content: 'Correction: retry with better params', finishReason: 'stop' });

      await manager.performReflection('deploy', '[ERROR] deployment failed');

      expect(mockLLM.generate).toHaveBeenCalledTimes(2);
      const correctionPrompt = (mockLLM.generate as jest.Mock).mock.calls[1][0][0].content;
      expect(correctionPrompt).toContain('纠正');
      expect(correctionPrompt).toContain('[ERROR] deployment failed');
    });

    test('triggers evolution check callback when configured', async () => {
      const onEvolutionCheck = jest.fn();
      manager = new ReflectionManager({
        llm: mockLLM,
        soul: createTestSoul({
          reflection: {
            enabled: true,
            afterEachTask: true,
            onError: true,
            weeklyReview: false,
            evolutionCheck: { enabled: true, triggerThreshold: 5, cooldownHours: 24, maxEvolutionsPerDay: 3 },
          },
        }),
        memory: mockMemory,
        onEvolutionCheck,
      });

      mockLLM.generate.mockResolvedValue({ content: 'reflection', finishReason: 'stop' });

      await manager.performReflection('task', 'result');

      expect(onEvolutionCheck).toHaveBeenCalledTimes(1);
    });

    test('summarizes and clears history when exceeds 10 entries', async () => {
      // Add 10 reflections
      for (let i = 0; i < 10; i++) {
        await manager.performReflection(`task-${i}`, `result-${i}`);
      }
      expect(manager.getReflectionHistory().length).toBe(10);

      // 11th should trigger summary: reset mock so first call gets reflection, second gets summary
      mockLLM.generate.mockReset();
      mockLLM.generate
        .mockResolvedValueOnce({ content: 'reflection-11', finishReason: 'stop' })
        .mockResolvedValueOnce({ content: 'summary of reflections', finishReason: 'stop' });
      await manager.performReflection('task-10', 'result-10');

      // History should be cleared after summarization
      expect(manager.getReflectionHistory().length).toBe(0);
      expect(mockMemory.addLongTermMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'summary of reflections',
          importance: 2,
        })
      );
    });

    test('does not trigger evolution check when disabled', async () => {
      const onEvolutionCheck = jest.fn();
      manager = new ReflectionManager({
        llm: mockLLM,
        soul: createTestSoul({
          reflection: {
            enabled: true,
            afterEachTask: true,
            onError: true,
            weeklyReview: false,
            evolutionCheck: { enabled: false, triggerThreshold: 5, cooldownHours: 24, maxEvolutionsPerDay: 3 },
          },
        }),
        memory: mockMemory,
        onEvolutionCheck,
      });

      mockLLM.generate.mockResolvedValue({ content: 'reflection', finishReason: 'stop' });

      await manager.performReflection('task', 'result');

      expect(onEvolutionCheck).not.toHaveBeenCalled();
    });
  });

  describe('selfCorrect', () => {
    test('generates correction and saves to memory', async () => {
      mockLLM.generate.mockResolvedValue({ content: 'Use different approach.', finishReason: 'stop' });

      await (manager as any).selfCorrect('task', 'error result', 'reflection content');

      expect(mockLLM.generate).toHaveBeenCalledTimes(1);
      const prompt = (mockLLM.generate as jest.Mock).mock.calls[0][0][0].content;
      expect(prompt).toContain('原始任务: task');
      expect(prompt).toContain('执行结果: error result');
      expect(prompt).toContain('反思: reflection content');
      expect(prompt).toContain('纠正');

      expect(mockMemory.addLongTermMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('自我纠正'),
          content: expect.stringContaining('Use different approach.'),
          importance: 3,
        })
      );
    });
  });

  describe('summarizeReflections', () => {
    test('returns empty string when no reflections', async () => {
      const result = await (manager as any).summarizeReflections();
      expect(result).toBe('');
      expect(mockLLM.generate).not.toHaveBeenCalled();
    });

    test('summarizes reflection history', async () => {
      mockLLM.generate.mockResolvedValue({ content: 'summary', finishReason: 'stop' });

      // Add some reflections directly
      (manager as any).reflectionHistory = [
        { id: 'r1', reflection: 'First lesson' },
        { id: 'r2', reflection: 'Second lesson' },
      ] as ReflectionEntry[];

      const result = await (manager as any).summarizeReflections();

      expect(result).toBe('summary');
      const prompt = (mockLLM.generate as jest.Mock).mock.calls[0][0][0].content;
      expect(prompt).toContain('First lesson');
      expect(prompt).toContain('Second lesson');
    });
  });

  describe('addMemoryEntry', () => {
    test('adds memory entry when memory manager exists', async () => {
      await (manager as any).addMemoryEntry('Test memory content', 2);

      const entries = manager.getMemoryEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].title).toContain('Test memory content');
      expect(entries[0].content).toBe('Test memory content');
      expect(entries[0].importance).toBe(2);
      expect(entries[0].id).toMatch(/^memory-/);
    });

    test('uses default importance of 2', async () => {
      await (manager as any).addMemoryEntry('Default importance');

      const entries = manager.getMemoryEntries();
      expect(entries[0].importance).toBe(2);
    });

    test('calls addLongTermMemory when supported', async () => {
      await (manager as any).addMemoryEntry('Long term memory', 3);

      expect(mockMemory.addLongTermMemory).toHaveBeenCalledWith({
        title: expect.stringContaining('Long term memory'),
        content: 'Long term memory',
        importance: 3,
      });
    });

    test('does not throw when memory manager is undefined', async () => {
      manager = new ReflectionManager({
        llm: mockLLM,
        soul: createTestSoul(),
        memory: undefined as any,
      });

      await expect((manager as any).addMemoryEntry('test', 1)).resolves.toBeUndefined();
      expect(manager.getMemoryEntries()).toEqual([]);
    });
  });

  describe('getReflectionHistory', () => {
    test('returns empty array initially', () => {
      expect(manager.getReflectionHistory()).toEqual([]);
    });

    test('returns copy of history', async () => {
      mockLLM.generate.mockResolvedValue({ content: 'reflection', finishReason: 'stop' });
      await manager.performReflection('task', 'result');

      const history = manager.getReflectionHistory();
      history.push({ id: 'injected', timestamp: 'now', task: 'x', result: 'y', reflection: 'z' });

      expect(manager.getReflectionHistory().length).toBe(1);
    });
  });

  describe('getMemoryEntries', () => {
    test('returns empty array initially', () => {
      expect(manager.getMemoryEntries()).toEqual([]);
    });

    test('returns copy of entries', async () => {
      await (manager as any).addMemoryEntry('test', 1);

      const entries = manager.getMemoryEntries();
      entries.push({ id: 'injected', title: 'x', content: 'y', importance: 1, createdAt: 'now' });

      expect(manager.getMemoryEntries().length).toBe(1);
    });
  });

  describe('clearReflectionHistory', () => {
    test('clears all reflections', async () => {
      mockLLM.generate.mockResolvedValue({ content: 'reflection', finishReason: 'stop' });
      await manager.performReflection('task', 'result');
      expect(manager.getReflectionHistory().length).toBe(1);

      manager.clearReflectionHistory();
      expect(manager.getReflectionHistory()).toEqual([]);
    });
  });

  describe('clearMemory', () => {
    test('clears all memory entries', async () => {
      await (manager as any).addMemoryEntry('test', 1);
      expect(manager.getMemoryEntries().length).toBe(1);

      manager.clearMemory();
      expect(manager.getMemoryEntries()).toEqual([]);
    });
  });
});
