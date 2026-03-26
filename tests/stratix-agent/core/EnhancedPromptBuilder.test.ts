import { EnhancedPromptBuilder } from '@/stratix-agent/core/EnhancedPromptBuilder';
import { ChatMessage, ZonePromptContext } from '@/stratix-agent/types';
import { AgentTemplate } from '@/stratix-agent/types/template';
import { EnhancedSoulConfig } from '@/stratix-agent/types/soul';

describe('EnhancedPromptBuilder', () => {
  let builder: EnhancedPromptBuilder;

  const createMockTemplate = (overrides?: Partial<AgentTemplate>): AgentTemplate => ({
    id: 'test-template',
    name: 'Test Agent',
    version: '1.0.0',
    description: 'A test agent template',
    domain: 'engineering',
    tags: ['test', 'dev'],
    mixins: [],
    identity: 'You are a helpful AI assistant.',
    personality: 'Friendly and professional.',
    tone: 'Professional but approachable.',
    mission: 'Help users accomplish their tasks efficiently.',
    workflows: [],
    rules: [
      { id: 'rule1', priority: 'critical', rule: 'Always verify inputs', reason: 'Security' },
      { id: 'rule2', priority: 'high', rule: 'Be concise', reason: 'Efficiency' },
    ],
    constraints: ['No harmful content', 'Respect privacy'],
    forbiddenActions: ['Do not make up information'],
    skills: [],
    workflowSteps: [],
    successMetrics: [],
    metadata: { author: 'Test', language: 'en' },
    ...overrides,
  });

  const createMockSoul = (overrides?: Partial<EnhancedSoulConfig>): EnhancedSoulConfig => ({
    identity: 'Helpful AI',
    personality: 'Friendly',
    goals: ['Goal 1', 'Goal 2'],
    constraints: ['Constraint 1'],
    reflection: {
      enabled: true,
      afterEachTask: true,
      onError: true,
      weeklyReview: false,
    },
    ...overrides,
  });

  beforeEach(() => {
    builder = new EnhancedPromptBuilder();
  });

  describe('buildFullSystemPrompt', () => {
    test('builds basic system prompt with all layers', () => {
      const template = createMockTemplate();
      const soul = createMockSoul();
      const memoryContext = 'User prefers dark mode.';
      const skills = [
        { skillId: 'skill1', name: 'Skill One', description: 'Does thing one' },
        { skillId: 'skill2', name: 'Skill Two', description: 'Does thing two' },
      ];

      const messages = builder.buildFullSystemPrompt(
        template,
        soul,
        memoryContext,
        skills,
        []
      );

      expect(messages.length).toBeGreaterThan(0);
      // Should have system messages
      expect(messages.every(m => m.role === 'system')).toBe(true);
    });

    test('includes role layer', () => {
      const template = createMockTemplate({ name: 'Code Assistant', identity: 'Expert coder' });
      const soul = createMockSoul();

      const messages = builder.buildFullSystemPrompt(template, soul, '', [], []);

      const roleMessage = messages.find(m => m.content.includes('角色设定'));
      expect(roleMessage).toBeDefined();
      expect(roleMessage?.content).toContain('Code Assistant');
    });

    test('includes mission layer', () => {
      const template = createMockTemplate({ mission: 'Write high-quality code' });
      const soul = createMockSoul();

      const messages = builder.buildFullSystemPrompt(template, soul, '', [], []);

      const missionMessage = messages.find(m => m.content.includes('核心使命'));
      expect(missionMessage).toBeDefined();
    });

    test('includes workflow layer when template has workflows', () => {
      const template = createMockTemplate({
        workflows: [
          {
            id: 'wf1',
            name: 'Code Review',
            description: 'Review code',
            steps: [
              {
                id: 'step1',
                order: 1,
                name: 'Review',
                description: 'Review code',
                expectedOutput: 'Feedback',
              },
            ],
          },
        ],
      });
      const soul = createMockSoul();

      const messages = builder.buildFullSystemPrompt(
        template,
        soul,
        '',
        [],
        [],
        { includeWorkflow: true }
      );

      const workflowMessage = messages.find(m => m.content.includes('工作流'));
      expect(workflowMessage).toBeDefined();
      expect(workflowMessage?.content).toContain('Code Review');
    });

    test('skips workflow layer when includeWorkflow is false', () => {
      const template = createMockTemplate({
        workflows: [
          {
            id: 'wf1',
            name: 'Code Review',
            description: 'Review code',
            steps: [],
          },
        ],
      });
      const soul = createMockSoul();

      const messages = builder.buildFullSystemPrompt(
        template,
        soul,
        '',
        [],
        [],
        { includeWorkflow: false }
      );

      const workflowMessage = messages.find(m => m.content.includes('工作流'));
      expect(workflowMessage).toBeUndefined();
    });

    test('includes rules layer with priority sorting', () => {
      const template = createMockTemplate({
        rules: [
          { id: 'r1', priority: 'low' as const, rule: 'Low priority rule' },
          { id: 'r2', priority: 'critical' as const, rule: 'Critical rule' },
          { id: 'r3', priority: 'high' as const, rule: 'High priority rule' },
        ],
      });
      const soul = createMockSoul();

      const messages = builder.buildFullSystemPrompt(template, soul, '', [], []);

      const rulesMessage = messages.find(m => m.content.includes('关键规则'));
      expect(rulesMessage).toBeDefined();
      const content = rulesMessage!.content;
      // Critical should appear before high and low
      const criticalIndex = content.indexOf('Critical rule');
      const highIndex = content.indexOf('High priority rule');
      const lowIndex = content.indexOf('Low priority rule');
      expect(criticalIndex).toBeLessThan(highIndex);
      expect(highIndex).toBeLessThan(lowIndex);
    });

    test('includes skills layer', () => {
      const skills = [
        { skillId: 'file-read', name: 'File Read', description: 'Reads files' },
      ];
      const template = createMockTemplate();
      const soul = createMockSoul();

      const messages = builder.buildFullSystemPrompt(template, soul, '', skills, []);

      const skillsMessage = messages.find(m => m.content.includes('可用技能'));
      expect(skillsMessage).toBeDefined();
      expect(skillsMessage?.content).toContain('File Read');
    });

    test('skips skills layer when skills is empty', () => {
      const template = createMockTemplate();
      const soul = createMockSoul();

      const messages = builder.buildFullSystemPrompt(template, soul, '', [], []);

      const skillsMessage = messages.find(m => m.content.includes('可用技能'));
      expect(skillsMessage).toBeUndefined();
    });

    test('includes memory layer', () => {
      const template = createMockTemplate();
      const soul = createMockSoul();
      const memoryContext = 'User likes Python.';

      const messages = builder.buildFullSystemPrompt(template, soul, memoryContext, [], []);

      const memoryMessage = messages.find(m => m.content.includes('上下文与记忆'));
      expect(memoryMessage).toBeDefined();
      expect(memoryMessage?.content).toContain('User likes Python');
    });

    test('includes history layer', () => {
      const template = createMockTemplate();
      const soul = createMockSoul();
      const history: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const messages = builder.buildFullSystemPrompt(
        template,
        soul,
        '',
        [],
        history,
        { includeHistory: true }
      );

      const historyMessage = messages.find(m => m.content.includes('最近对话'));
      expect(historyMessage).toBeDefined();
    });

    test('respects maxHistoryLength', () => {
      const template = createMockTemplate();
      const soul = createMockSoul();
      const history: ChatMessage[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'user', content: 'Message 3' },
      ];

      const messages = builder.buildFullSystemPrompt(
        template,
        soul,
        '',
        [],
        history,
        { maxHistoryLength: 2, includeHistory: true }
      );

      // With maxHistoryLength=2 and 3 messages, should include last 2 (Message 2 and Message 3)
      // Message 1 should NOT be present
      expect(messages.some(m => m.content.includes('Message 1'))).toBe(false);
      expect(messages.some(m => m.content.includes('Message 2'))).toBe(true);
      expect(messages.some(m => m.content.includes('Message 3'))).toBe(true);
    });

    test('includes reflection layer when enabled', () => {
      const template = createMockTemplate();
      const soul = createMockSoul({
        reflection: {
          enabled: true,
          afterEachTask: true,
          onError: true,
          weeklyReview: false,
        },
      });

      const messages = builder.buildFullSystemPrompt(
        template,
        soul,
        '',
        [],
        [],
        { includeReflection: true }
      );

      const reflectionMessage = messages.find(m => m.content.includes('反思机制'));
      expect(reflectionMessage).toBeDefined();
    });

    test('includes success metrics layer', () => {
      const template = createMockTemplate({
        successMetrics: [
          {
            name: 'Accuracy',
            description: 'Task accuracy',
            measurement: 'Percentage of correct outputs',
            targetValue: '95%',
          },
        ],
      });
      const soul = createMockSoul();

      const messages = builder.buildFullSystemPrompt(
        template,
        soul,
        '',
        [],
        [],
        { includeSuccessMetrics: true }
      );

      const metricsMessage = messages.find(m => m.content.includes('成功指标'));
      expect(metricsMessage).toBeDefined();
      expect(metricsMessage?.content).toContain('Accuracy');
    });

    test('includes zone context layer', () => {
      const template = createMockTemplate();
      const soul = createMockSoul();
      const zoneContext: ZonePromptContext = {
        inZone: true,
        currentZone: {
          zoneId: 'zone-1',
          title: 'Engineering Team',
          prompt: 'Work on code',
          files: [],
          members: [],
        },
        availableZones: [],
      };

      const messages = builder.buildFullSystemPrompt(
        template,
        soul,
        '',
        [],
        [],
        { includeZoneContext: true, zoneContext }
      );

      const zoneMessage = messages.find(m => m.content.includes('Zone 上下文'));
      expect(zoneMessage).toBeDefined();
    });
  });

  describe('buildZeroShotPrompt', () => {
    test('builds simple zero-shot prompt', () => {
      const skills = [
        { skillId: 'search', name: 'Search', description: 'Search the web' },
      ];

      const messages = builder.buildZeroShotPrompt('What is AI?', skills);

      expect(messages.length).toBe(2); // Skills + user message
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('What is AI?');
    });

    test('includes thinking prompt when requested', () => {
      const messages = builder.buildZeroShotPrompt(
        'Explain something',
        [],
        { includeThinking: true }
      );

      expect(messages.length).toBe(2);
      expect(messages[0].content).toContain('思考过程');
    });
  });

  describe('buildFewShotPrompt', () => {
    test('builds few-shot prompt with examples', () => {
      const examples = [
        { input: '2+2', output: '4' },
        { input: '3+3', output: '6' },
      ];

      const messages = builder.buildFewShotPrompt('What is 5+5?', examples);

      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('示例');
      expect(messages[0].content).toContain('2+2');
      expect(messages[0].content).toContain('4');
    });

    test('includes skills in few-shot prompt', () => {
      const examples = [{ input: 'in', output: 'out' }];
      const skills = [
        { skillId: 'transform', name: 'Transform', description: 'Transforms input' },
      ];

      const messages = builder.buildFewShotPrompt('Transform X', examples, skills);

      expect(messages.some(m => m.content.includes('Transform'))).toBe(true);
    });
  });

  describe('collapseToSingleMessage', () => {
    test('combines multiple system messages', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'Message 1' },
        { role: 'system', content: 'Message 2' },
        { role: 'user', content: 'User message' },
      ];

      const collapsed = builder.collapseToSingleMessage(messages);

      expect(collapsed.role).toBe('system');
      expect(collapsed.content).toContain('Message 1');
      expect(collapsed.content).toContain('Message 2');
      expect(collapsed.content).toContain('---'); // Separator
    });

    test('filters out non-system messages', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'System 1' },
        { role: 'user', content: 'User' },
        { role: 'assistant', content: 'Assistant' },
      ];

      const collapsed = builder.collapseToSingleMessage(messages);

      expect(collapsed.content).not.toContain('User');
      expect(collapsed.content).not.toContain('Assistant');
    });
  });

  describe('buildThinkingPrompt', () => {
    test('returns thinking prompt message', () => {
      const message = builder.buildThinkingPrompt();

      expect(message.role).toBe('system');
      expect(message.content).toContain('思考过程');
      expect(message.content).toContain('<thinking>');
      expect(message.content).toContain('<output>');
    });
  });

  describe('buildZoneContextLayer', () => {
    test('shows current zone when in zone', () => {
      const zoneContext: ZonePromptContext = {
        inZone: true,
        currentZone: {
          zoneId: 'zone-1',
          title: 'Development Zone',
          prompt: 'Focus on coding',
          files: [
            { id: 'f1', name: 'index.ts', path: '/src/index.ts', content: 'const x = 1;' },
          ],
          members: ['agent-1', 'agent-2'],
        },
        availableZones: [],
      };

      const message = builder.buildZoneContextLayer(zoneContext, { showLayerHeaders: true });

      expect(message.content).toContain('Development Zone');
      expect(message.content).toContain('Focus on coding');
      expect(message.content).toContain('index.ts');
    });

    test('shows idle state when not in zone', () => {
      const zoneContext: ZonePromptContext = {
        inZone: false,
        idlePrompt: 'Waiting for tasks',
        availableZones: [
          {
            zoneId: 'zone-1',
            name: 'Engineering',
            title: 'Engineering',
            prompt: 'Code work',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            agentCount: 2,
          },
        ],
      };

      const message = builder.buildZoneContextLayer(zoneContext, { showLayerHeaders: true });

      expect(message.content).toContain('空闲');
      expect(message.content).toContain('Engineering');
    });

    test('shows no zones available message', () => {
      const zoneContext: ZonePromptContext = {
        inZone: false,
        availableZones: [],
      };

      const message = builder.buildZoneContextLayer(zoneContext, {});

      expect(message.content).toContain('暂无可进入的 Zone');
    });
  });
});
