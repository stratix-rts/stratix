import { BuiltinSkillExecutor } from '@/stratix-agent/core/executors/BuiltinSkillExecutor';
import { SkillDefinition, ExecutionContext } from '@/stratix-agent/types';

describe('BuiltinSkillExecutor', () => {
  let executor: BuiltinSkillExecutor;
  let mockSkill: SkillDefinition;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    executor = new BuiltinSkillExecutor();
    mockSkill = {
      skillId: 'builtin_math',
      name: 'Builtin Math',
      description: 'Built-in math operations',
      parameters: [],
      executor: 'builtin',
    };
    mockContext = { agentId: 'test-agent' };
  });

  describe('expression evaluation', () => {
    test('evaluates simple addition', async () => {
      const result = await executor.execute(mockSkill, { expression: '2 + 3' }, mockContext);
      expect(result.result).toBe(5);
    });

    test('evaluates subtraction', async () => {
      const result = await executor.execute(mockSkill, { expression: '10 - 4' }, mockContext);
      expect(result.result).toBe(6);
    });

    test('evaluates multiplication', async () => {
      const result = await executor.execute(mockSkill, { expression: '3 * 7' }, mockContext);
      expect(result.result).toBe(21);
    });

    test('evaluates division', async () => {
      const result = await executor.execute(mockSkill, { expression: '15 / 3' }, mockContext);
      expect(result.result).toBe(5);
    });

    test('evaluates power', async () => {
      const result = await executor.execute(mockSkill, { expression: '2 ^ 3' }, mockContext);
      expect(result.result).toBe(8);
    });

    test('evaluates complex expression with parentheses', async () => {
      const result = await executor.execute(mockSkill, { expression: '(2 + 3) * 4' }, mockContext);
      expect(result.result).toBe(20);
    });

    test('evaluates function sqrt', async () => {
      const result = await executor.execute(mockSkill, { expression: 'sqrt(16)' }, mockContext);
      expect(result.result).toBe(4);
    });

    test('evaluates function abs', async () => {
      const result = await executor.execute(mockSkill, { expression: 'abs(-5)' }, mockContext);
      expect(result.result).toBe(5);
    });

    test('evaluates function round', async () => {
      const result = await executor.execute(mockSkill, { expression: 'round(3.7)' }, mockContext);
      expect(result.result).toBe(4);
    });

    test('evaluates function floor', async () => {
      const result = await executor.execute(mockSkill, { expression: 'floor(3.7)' }, mockContext);
      expect(result.result).toBe(3);
    });

    test('evaluates function ceil', async () => {
      const result = await executor.execute(mockSkill, { expression: 'ceil(3.2)' }, mockContext);
      expect(result.result).toBe(4);
    });

    test('evaluates function sin', async () => {
      const result = await executor.execute(mockSkill, { expression: 'sin(0)' }, mockContext);
      expect(result.result).toBe(0);
    });

    test('evaluates function cos', async () => {
      const result = await executor.execute(mockSkill, { expression: 'cos(0)' }, mockContext);
      expect(result.result).toBe(1);
    });

    test('evaluates function log', async () => {
      const result = await executor.execute(mockSkill, { expression: 'log(1)' }, mockContext);
      expect(result.result).toBe(0);
    });

    test('log10 is parsed as log followed by 10 (tokenizer limitation)', async () => {
      // The tokenizer splits 'log10' into 'log' and '10', so this throws
      await expect(executor.execute(mockSkill, { expression: 'log10(100)' }, mockContext))
        .rejects.toThrow('Expression evaluation failed');
    });

    test('evaluates function exp', async () => {
      const result = await executor.execute(mockSkill, { expression: 'exp(0)' }, mockContext);
      expect(result.result).toBe(1);
    });

    test('evaluates unary minus', async () => {
      const result = await executor.execute(mockSkill, { expression: '-5 + 3' }, mockContext);
      expect(result.result).toBe(-2);
    });

    test('throws on division by zero', async () => {
      await expect(executor.execute(mockSkill, { expression: '10 / 0' }, mockContext))
        .rejects.toThrow('Expression evaluation failed');
    });

    test('throws on invalid character', async () => {
      await expect(executor.execute(mockSkill, { expression: '2 + a' }, mockContext))
        .rejects.toThrow('Expression evaluation failed');
    });

    test('throws on unknown function', async () => {
      await expect(executor.execute(mockSkill, { expression: 'unknown(5)' }, mockContext))
        .rejects.toThrow('Expression evaluation failed');
    });

    test('throws on missing closing parenthesis', async () => {
      await expect(executor.execute(mockSkill, { expression: '(2 + 3' }, mockContext))
        .rejects.toThrow('Expression evaluation failed');
    });

    test('throws on unexpected token after expression', async () => {
      await expect(executor.execute(mockSkill, { expression: '2+3)' }, mockContext))
        .rejects.toThrow('Expression evaluation failed');
    });
  });

  describe('operation mode', () => {
    test('executes add operation', async () => {
      const result = await executor.execute(mockSkill, { operation: 'add', a: 2, b: 3 }, mockContext);
      expect(result.result).toBe(5);
      expect(result.operation).toBe('add');
    });

    test('executes subtract operation', async () => {
      const result = await executor.execute(mockSkill, { operation: 'subtract', a: 10, b: 4 }, mockContext);
      expect(result.result).toBe(6);
    });

    test('executes multiply operation', async () => {
      const result = await executor.execute(mockSkill, { operation: 'multiply', a: 3, b: 7 }, mockContext);
      expect(result.result).toBe(21);
    });

    test('executes divide operation', async () => {
      const result = await executor.execute(mockSkill, { operation: 'divide', a: 15, b: 3 }, mockContext);
      expect(result.result).toBe(5);
    });

    test('executes pow operation', async () => {
      const result = await executor.execute(mockSkill, { operation: 'pow', a: 2, b: 3 }, mockContext);
      expect(result.result).toBe(8);
    });

    test('executes sqrt operation with value param', async () => {
      const result = await executor.execute(mockSkill, { operation: 'sqrt', value: 16 }, mockContext);
      expect(result.result).toBe(4);
    });

    test('executes abs operation with a param', async () => {
      const result = await executor.execute(mockSkill, { operation: 'abs', a: -5 }, mockContext);
      expect(result.result).toBe(5);
    });

    test('throws on division by zero in operation mode', async () => {
      await expect(executor.execute(mockSkill, { operation: 'divide', a: 10, b: 0 }, mockContext))
        .rejects.toThrow('Division by zero');
    });

    test('throws when no operation or expression provided', async () => {
      await expect(executor.execute(mockSkill, {}, mockContext))
        .rejects.toThrow('No operation or expression provided');
    });
  });
});
