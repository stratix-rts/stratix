/**
 * Schema validation tests for stratix-core schemas
 */

import {
  AgentConfigSchema,
  AgentStateSchema,
  ZoneConfigSchema,
  MessageSchema,
  CommandLogSchema,
  CharacterProfileSchema,
  validateOrThrow,
  validateSafe,
  BodyTypeSchema,
  OpenClawConfigSchema,
  StratixDirectConfigSchema,
} from '../../src/stratix-core/schemas';

describe('CharacterProfileSchema', () => {
  const validProfile = {
    characterId: 'char-1',
    name: 'Test Agent',
    bodyType: 'male',
    parts: { head: { itemId: 'head-1', variant: 'v1' } },
    skillTree: { selectedNodes: ['node1'], unlockedNodes: ['node1', 'node2'] },
    attributes: { strength: 10, agility: 5 },
  };

  it('passes for valid profile', () => {
    const result = validateOrThrow(CharacterProfileSchema, validProfile);
    expect(result.characterId).toBe('char-1');
    expect(result.name).toBe('Test Agent');
    expect(result.bodyType).toBe('male');
  });

  it('passes for minimal profile (only required fields)', () => {
    const minimal = {
      characterId: 'char-2',
      name: 'Minimal',
      bodyType: 'female',
      parts: {},
    };
    const result = validateOrThrow(CharacterProfileSchema, minimal);
    expect(result.characterId).toBe('char-2');
  });

  it('throws for missing required fields', () => {
    expect(() => validateOrThrow(CharacterProfileSchema, {})).toThrow();
    expect(() => validateOrThrow(CharacterProfileSchema, { name: 'No ID' })).toThrow();
  });

  it('throws for invalid bodyType', () => {
    const invalid = { ...validProfile, bodyType: 'invalid' };
    expect(() => validateOrThrow(CharacterProfileSchema, invalid)).toThrow();
  });

  it('rejects non-string characterId', () => {
    const invalid = { ...validProfile, characterId: 123 };
    expect(() => validateOrThrow(CharacterProfileSchema, invalid)).toThrow();
  });

  it('validateSafe returns null for invalid data', () => {
    const result = validateSafe(CharacterProfileSchema, { name: 'No ID' });
    expect(result).toBeNull();
  });
});

describe('AgentConfigSchema', () => {
  const minimalValidConfig = {
    agentId: 'agent-1',
    name: 'Test Agent',
    type: 'dev',
    profile: {
      characterId: 'char-1',
      name: 'Dev Character',
      bodyType: 'male',
      parts: {},
    },
    backendType: 'stratix',
    configStatus: 'ready',
  };

  it('passes for valid minimal config', () => {
    const result = validateOrThrow(AgentConfigSchema, minimalValidConfig);
    expect(result.agentId).toBe('agent-1');
    expect(result.configStatus).toBe('ready');
  });

  it('passes with all optional fields', () => {
    const full = {
      ...minimalValidConfig,
      openClawConfig: { endpoint: 'https://api.example.com', accountId: 'acc-1', apiKey: 'key-1' },
      stratixConfig: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
      soul: { identity: 'You are helpful', goals: ['Goal 1'], personality: 'Friendly' },
      memory: { shortTerm: ['msg1'], longTerm: ['old'], context: 'context' },
      skills: [{ skillId: 'skill-1', name: 'Code', description: 'Writes code', parameters: [] }],
      rules: ['Rule 1', 'Rule 2'],
      lastError: 'previous error',
      lastActiveAt: Date.now(),
      position: { x: 100, y: 200 },
    };
    const result = validateOrThrow(AgentConfigSchema, full);
    expect(result.openClawConfig?.endpoint).toBe('https://api.example.com');
    expect(result.stratixConfig?.temperature).toBe(0.7);
    expect(result.skills).toHaveLength(1);
  });

  it('throws for missing required fields', () => {
    expect(() => validateOrThrow(AgentConfigSchema, {})).toThrow();
    expect(() => validateOrThrow(AgentConfigSchema, { agentId: 'a' })).toThrow();
  });

  it('throws for invalid backendType', () => {
    const invalid = { ...minimalValidConfig, backendType: 'invalid' };
    expect(() => validateOrThrow(AgentConfigSchema, invalid)).toThrow();
  });

  it('throws for invalid configStatus', () => {
    const invalid = { ...minimalValidConfig, configStatus: 'invalid' };
    expect(() => validateOrThrow(AgentConfigSchema, invalid)).toThrow();
  });

  it('throws for invalid nested profile', () => {
    const invalid = { ...minimalValidConfig, profile: { name: 'No characterId' } };
    expect(() => validateOrThrow(AgentConfigSchema, invalid)).toThrow();
  });

  it('validateSafe returns null for invalid data', () => {
    const result = validateSafe(AgentConfigSchema, null);
    expect(result).toBeNull();
  });
});

describe('AgentStateSchema', () => {
  it('passes for valid state', () => {
    const state = { config: 'ready', connection: 'connected', activity: 'idle' };
    const result = validateOrThrow(AgentStateSchema, state);
    expect(result.connection).toBe('connected');
  });

  it('passes with optional fields', () => {
    const state = {
      config: 'ready',
      connection: 'error',
      activity: 'error',
      lastError: 'Connection timeout',
      lastActiveAt: Date.now(),
    };
    const result = validateOrThrow(AgentStateSchema, state);
    expect(result.lastError).toBe('Connection timeout');
  });

  it('throws for invalid config status', () => {
    const state = { config: 'invalid', connection: 'connected', activity: 'idle' };
    expect(() => validateOrThrow(AgentStateSchema, state)).toThrow();
  });

  it('throws for invalid connection status', () => {
    const state = { config: 'ready', connection: 'unknown', activity: 'idle' };
    expect(() => validateOrThrow(AgentStateSchema, state)).toThrow();
  });

  it('throws for invalid activity status', () => {
    const state = { config: 'ready', connection: 'connected', activity: 'unknown' };
    expect(() => validateOrThrow(AgentStateSchema, state)).toThrow();
  });
});

describe('ZoneConfigSchema', () => {
  const validZone = {
    zoneId: 'zone-1',
    name: 'Engineering',
    title: 'O: Build features',
    prompt: 'KR: Ship v2',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    agentCount: 3,
    status: 'active',
  };

  it('passes for valid zone', () => {
    const result = validateOrThrow(ZoneConfigSchema, validZone);
    expect(result.zoneId).toBe('zone-1');
    expect(result.agentCount).toBe(3);
  });

  it('passes for minimal zone (only required fields)', () => {
    const minimal = { zoneId: 'z1', name: 'Zone', x: 0, y: 0, width: 100, height: 100, agentCount: 0 };
    const result = validateOrThrow(ZoneConfigSchema, minimal);
    expect(result.zoneId).toBe('z1');
  });

  it('throws for missing required fields', () => {
    expect(() => validateOrThrow(ZoneConfigSchema, {})).toThrow();
    expect(() => validateOrThrow(ZoneConfigSchema, { zoneId: 'z1' })).toThrow();
  });

  it('throws for negative dimensions', () => {
    const invalid = { ...validZone, width: -10 };
    expect(() => validateOrThrow(ZoneConfigSchema, invalid)).toThrow();
  });

  it('throws for non-number coordinates', () => {
    const invalid = { ...validZone, x: '0' };
    expect(() => validateOrThrow(ZoneConfigSchema, invalid)).toThrow();
  });
});

describe('MessageSchema', () => {
  it('passes for user message', () => {
    const msg = { role: 'user', content: 'Hello', timestamp: Date.now() };
    const result = validateOrThrow(MessageSchema, msg);
    expect(result.role).toBe('user');
  });

  it('passes for assistant message', () => {
    const msg = { role: 'assistant', content: 'Hi there', timestamp: Date.now() };
    const result = validateOrThrow(MessageSchema, msg);
    expect(result.role).toBe('assistant');
  });

  it('throws for invalid role', () => {
    const msg = { role: 'system', content: 'Hello', timestamp: Date.now() };
    expect(() => validateOrThrow(MessageSchema, msg)).toThrow();
  });

  it('throws for missing fields', () => {
    expect(() => validateOrThrow(MessageSchema, { role: 'user' })).toThrow();
    expect(() => validateOrThrow(MessageSchema, { content: 'Hello' })).toThrow();
  });

  it('throws for non-number timestamp', () => {
    const msg = { role: 'user', content: 'Hello', timestamp: 'now' };
    expect(() => validateOrThrow(MessageSchema, msg)).toThrow();
  });
});

describe('CommandLogSchema', () => {
  const validCommand = {
    commandId: 'cmd-1',
    skillId: 'skill-1',
    agentId: 'agent-1',
    params: { filePath: '/src/index.ts', dryRun: false },
    executeAt: Date.now(),
  };

  it('passes for valid command', () => {
    const result = validateOrThrow(CommandLogSchema, validCommand);
    expect(result.commandId).toBe('cmd-1');
    expect(result.params.dryRun).toBe(false);
  });

  it('passes for empty params', () => {
    const cmd = { ...validCommand, params: {} };
    const result = validateOrThrow(CommandLogSchema, cmd);
    expect(result.params).toEqual({});
  });

  it('throws for missing required fields', () => {
    expect(() => validateOrThrow(CommandLogSchema, {})).toThrow();
    expect(() => validateOrThrow(CommandLogSchema, { commandId: 'cmd-1' })).toThrow();
  });

  it('throws for non-object params', () => {
    const cmd = { ...validCommand, params: 'not-an-object' };
    expect(() => validateOrThrow(CommandLogSchema, cmd)).toThrow();
  });
});

describe('BodyTypeSchema', () => {
  it('accepts all valid body types', () => {
    const types = ['male', 'female', 'teen', 'muscular', 'pregnant', 'child'] as const;
    for (const type of types) {
      const result = BodyTypeSchema.parse(type);
      expect(result).toBe(type);
    }
  });

  it('rejects invalid body type', () => {
    expect(() => BodyTypeSchema.parse('robot')).toThrow();
  });
});

describe('OpenClawConfigSchema', () => {
  it('passes for valid config', () => {
    const config = { endpoint: 'https://api.openclaw.dev', accountId: 'acc-123' };
    const result = validateOrThrow(OpenClawConfigSchema, config);
    expect(result.endpoint).toBe('https://api.openclaw.dev');
  });

  it('passes with optional apiKey', () => {
    const config = { endpoint: 'https://api.openclaw.dev', accountId: 'acc-123', apiKey: 'secret' };
    const result = validateOrThrow(OpenClawConfigSchema, config);
    expect(result.apiKey).toBe('secret');
  });

  it('throws for missing required fields', () => {
    expect(() => validateOrThrow(OpenClawConfigSchema, {})).toThrow();
    expect(() => validateOrThrow(OpenClawConfigSchema, { endpoint: 'url' })).toThrow();
  });
});

describe('StratixDirectConfigSchema', () => {
  it('passes for valid config', () => {
    const config = { provider: 'openai', model: 'gpt-4o' };
    const result = validateOrThrow(StratixDirectConfigSchema, config);
    expect(result.model).toBe('gpt-4o');
  });

  it('passes with all optional fields', () => {
    const config = {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      apiKey: 'sk-ant-...',
      endpoint: 'https://api.anthropic.com',
      temperature: 0.5,
      maxTokens: 4096,
      maxShortTerm: 10,
      enableLongTerm: true,
    };
    const result = validateOrThrow(StratixDirectConfigSchema, config);
    expect(result.temperature).toBe(0.5);
    expect(result.enableLongTerm).toBe(true);
  });

  it('throws for invalid provider', () => {
    const config = { provider: 'invalid', model: 'gpt-4' };
    expect(() => validateOrThrow(StratixDirectConfigSchema, config)).toThrow();
  });
});

describe('validateOrThrow', () => {
  it('returns typed data on success', () => {
    const data = { role: 'user', content: 'test', timestamp: 123 };
    const result = validateOrThrow(MessageSchema, data);
    // result should be typed as Message
    expect((result as any).content).toBe('test');
  });

  it('throws ZodError with issues on failure', () => {
    expect(() => validateOrThrow(MessageSchema, { role: 'invalid' })).toThrow();
  });
});

describe('validateSafe', () => {
  it('returns typed data on success', () => {
    const data = { role: 'assistant', content: 'hello', timestamp: 456 };
    const result = validateSafe(MessageSchema, data);
    expect(result).not.toBeNull();
    expect((result as any).content).toBe('hello');
  });

  it('returns null on failure', () => {
    const result = validateSafe(MessageSchema, { role: 'invalid' });
    expect(result).toBeNull();
  });

  it('returns null for null input', () => {
    const result = validateSafe(MessageSchema, null);
    expect(result).toBeNull();
  });
});
