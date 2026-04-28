import { DefaultSkillExecutor } from '@/stratix-agent/core/executors/DefaultSkillExecutor';
import { SkillDefinition, ExecutionContext } from '@/stratix-agent/types';

describe('DefaultSkillExecutor', () => {
  let executor: DefaultSkillExecutor;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    executor = new DefaultSkillExecutor();
    mockContext = { agentId: 'test-agent' };
  });

  test('returns success message with skill info', async () => {
    const skill: SkillDefinition = {
      skillId: 'test-skill',
      name: 'Test Skill',
      description: 'A test skill',
      parameters: [],
      executor: 'default',
    };

    const result = await executor.execute(skill, { param1: 'value1', param2: 42 }, mockContext);

    expect(result).toEqual({
      skillId: 'test-skill',
      params: { param1: 'value1', param2: 42 },
      message: 'Skill Test Skill executed successfully',
    });
  });

  test('returns success message with empty params', async () => {
    const skill: SkillDefinition = {
      skillId: 'empty-skill',
      name: 'Empty Skill',
      description: 'A skill with no params',
      parameters: [],
      executor: 'default',
    };

    const result = await executor.execute(skill, {}, mockContext);

    expect(result).toEqual({
      skillId: 'empty-skill',
      params: {},
      message: 'Skill Empty Skill executed successfully',
    });
  });

  test('handles nested object params', async () => {
    const skill: SkillDefinition = {
      skillId: 'complex-skill',
      name: 'Complex Skill',
      description: 'A complex skill',
      parameters: [],
      executor: 'default',
    };

    const params = { config: { nested: true, items: [1, 2, 3] } };
    const result = await executor.execute(skill, params, mockContext);

    expect(result.skillId).toBe('complex-skill');
    expect(result.params).toEqual(params);
    expect(result.message).toBe('Skill Complex Skill executed successfully');
  });
});
