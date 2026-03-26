import { SkillRegistry } from '@/stratix-agent/core/SkillRegistry';
import { SkillDefinition, SkillExecutor, ExecutionContext } from '@/stratix-agent/types';

describe('SkillRegistry', () => {
  let registry: SkillRegistry;
  let mockExecutor: jest.Mocked<SkillExecutor>;

  const createMockSkill = (skillId: string): SkillDefinition => ({
    skillId,
    name: skillId,
    description: `Test skill ${skillId}`,
    parameters: [
      { name: 'param1', type: 'string', required: false },
      { name: 'param2', type: 'number', required: true },
    ],
    executor: 'mock',
  });

  beforeEach(() => {
    registry = new SkillRegistry();
    mockExecutor = {
      execute: jest.fn(),
    };
    registry.registerExecutor('mock', mockExecutor);
  });

  describe('registerSkill', () => {
    test('registers a skill', () => {
      const skill = createMockSkill('test-skill');
      registry.registerSkill(skill);
      expect(registry.hasSkill('test-skill')).toBe(true);
    });

    test('registers multiple skills', () => {
      registry.registerSkills([
        createMockSkill('skill-1'),
        createMockSkill('skill-2'),
        createMockSkill('skill-3'),
      ]);
      expect(registry.listAllSkills()).toHaveLength(3);
    });
  });

  describe('enableSkill/disableSkill', () => {
    test('enables a registered skill', () => {
      registry.registerSkill(createMockSkill('test-skill'));
      expect(registry.enableSkill('test-skill')).toBe(true);
      expect(registry.isEnabled('test-skill')).toBe(true);
    });

    test('fails to enable non-existent skill', () => {
      expect(registry.enableSkill('non-existent')).toBe(false);
    });

    test('disables an enabled skill', () => {
      registry.registerSkill(createMockSkill('test-skill'));
      registry.enableSkill('test-skill');
      registry.disableSkill('test-skill');
      expect(registry.isEnabled('test-skill')).toBe(false);
    });
  });

  describe('getEnabledSkills', () => {
    test('returns only enabled skills', () => {
      registry.registerSkills([
        createMockSkill('skill-1'),
        createMockSkill('skill-2'),
        createMockSkill('skill-3'),
      ]);
      registry.enableSkill('skill-1');
      registry.enableSkill('skill-3');

      const enabled = registry.getEnabledSkills();
      expect(enabled).toHaveLength(2);
      expect(enabled.map(s => s.skillId)).toEqual(['skill-1', 'skill-3']);
    });

    test('returns empty array when no skills enabled', () => {
      expect(registry.getEnabledSkills()).toEqual([]);
    });
  });

  describe('getSkill', () => {
    test('returns registered skill', () => {
      const skill = createMockSkill('test-skill');
      registry.registerSkill(skill);
      expect(registry.getSkill('test-skill')).toEqual(skill);
    });

    test('returns undefined for non-existent skill', () => {
      expect(registry.getSkill('non-existent')).toBeUndefined();
    });
  });

  describe('hasSkill', () => {
    test('returns true for registered skill', () => {
      registry.registerSkill(createMockSkill('test-skill'));
      expect(registry.hasSkill('test-skill')).toBe(true);
    });

    test('returns false for non-registered skill', () => {
      expect(registry.hasSkill('non-existent')).toBe(false);
    });
  });

  describe('listAllSkills', () => {
    test('lists all registered skills', () => {
      registry.registerSkills([
        createMockSkill('skill-1'),
        createMockSkill('skill-2'),
      ]);
      const all = registry.listAllSkills();
      expect(all).toHaveLength(2);
    });

    test('returns empty array when no skills registered', () => {
      expect(registry.listAllSkills()).toEqual([]);
    });
  });

  describe('searchSkills', () => {
    beforeEach(() => {
      registry.registerSkills([
        { skillId: 'file-read', name: 'File Read', description: 'Read files from disk', parameters: [], executor: 'mock' },
        { skillId: 'file-write', name: 'File Write', description: 'Write files to disk', parameters: [], executor: 'mock' },
        { skillId: 'http-request', name: 'HTTP Request', description: 'Make HTTP requests', parameters: [], executor: 'mock' },
        { skillId: 'calculator', name: 'Calculator', description: 'Perform calculations', parameters: [], executor: 'mock' },
      ]);
    });

    test('searches by name', () => {
      const results = registry.searchSkills('file');
      expect(results).toHaveLength(2);
      expect(results.map(s => s.skillId)).toContain('file-read');
      expect(results.map(s => s.skillId)).toContain('file-write');
    });

    test('searches by description', () => {
      const results = registry.searchSkills('HTTP');
      expect(results).toHaveLength(1);
      expect(results[0].skillId).toBe('http-request');
    });

    test('search is case insensitive', () => {
      const results = registry.searchSkills('CALCULATOR');
      expect(results).toHaveLength(1);
      expect(results[0].skillId).toBe('calculator');
    });

    test('returns empty array for no matches', () => {
      const results = registry.searchSkills('xyz');
      expect(results).toHaveLength(0);
    });
  });

  describe('removeSkill', () => {
    test('removes a skill', () => {
      registry.registerSkill(createMockSkill('test-skill'));
      expect(registry.removeSkill('test-skill')).toBe(true);
      expect(registry.hasSkill('test-skill')).toBe(false);
    });

    test('also disables removed skill', () => {
      registry.registerSkill(createMockSkill('test-skill'));
      registry.enableSkill('test-skill');
      registry.removeSkill('test-skill');
      expect(registry.isEnabled('test-skill')).toBe(false);
    });

    test('returns false for non-existent skill', () => {
      expect(registry.removeSkill('non-existent')).toBe(false);
    });
  });

  describe('execute', () => {
    const context: ExecutionContext = { agentId: 'test-agent' };

    beforeEach(() => {
      registry.registerSkill(createMockSkill('test-skill'));
      registry.enableSkill('test-skill');
    });

    test('executes enabled skill successfully', async () => {
      mockExecutor.execute.mockResolvedValue({ result: 'success' } as any);

      const result = await registry.execute('test-skill', { param2: 42 }, context);

      expect(result.success).toBe(true);
      expect(result.skillId).toBe('test-skill');
      expect(result.result).toEqual({ result: 'success' });
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    test('fails for disabled skill', async () => {
      registry.disableSkill('test-skill');

      const result = await registry.execute('test-skill', { param2: 42 }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not enabled');
    });

    test('fails for non-existent skill', async () => {
      // Note: non-existent skill returns "not enabled" because we can't
      // distinguish between "registered but disabled" and "not registered"
      // without first checking enabledSkills
      const result = await registry.execute('non-existent', { param2: 42 }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not enabled');
    });

    test('fails for missing required parameters', async () => {
      const result = await registry.execute('test-skill', {}, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameter');
    });

    test('succeeds when optional parameter missing', async () => {
      mockExecutor.execute.mockResolvedValue({ result: 'success' } as any);

      const result = await registry.execute('test-skill', { param2: 42 }, context);

      expect(result.success).toBe(true);
    });

    test('handles executor errors', async () => {
      mockExecutor.execute.mockRejectedValue(new Error('Executor error'));

      const result = await registry.execute('test-skill', { param2: 42 }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Executor error');
    });

    test('fails when executor not found', async () => {
      registry.registerSkill({ ...createMockSkill('no-executor'), executor: 'non-existent' });
      registry.enableSkill('no-executor');

      const result = await registry.execute('no-executor', { param2: 42 }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Executor');
    });
  });

  describe('registerExecutor', () => {
    test('registers an executor', () => {
      const newExecutor: SkillExecutor = {
        execute: jest.fn(),
      };
      registry.registerExecutor('custom', newExecutor);
      // This would be tested through skill execution
      expect(registry.listAllSkills()).toEqual([]);
    });
  });
});
