import {
  StratixAgentConfig,
  StratixSoulConfig,
  StratixMemoryConfig,
  StratixSkillConfig,
  OpenClawConfig,
  StratixSkillParameter,
  AgentBackendType,
} from '@/stratix-core/stratix-protocol';

export interface OpenClawTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export interface OpenClawAgentConfig {
  account_id: string;
  endpoint: string;
  api_key?: string;
  model: string;
  model_params: Record<string, any>;
  system_prompt: string;
  tools: OpenClawTool[];
}

export class ConfigConverter {
  static toOpenClawFormat(config: StratixAgentConfig): OpenClawAgentConfig | null {
    if (config.backendType !== 'openclaw' || !config.openClawConfig) {
      return null;
    }

    return {
      account_id: config.openClawConfig.accountId,
      endpoint: config.openClawConfig.endpoint,
      api_key: config.openClawConfig.apiKey ? '***REDACTED***' : undefined,
      model: 'gpt-4',
      model_params: {},
      system_prompt: this.buildSystemPrompt(config.soul, config.memory, config.rules),
      tools: this.convertSkillsToTools(config.skills || []),
    };
  }

  static fromOpenClawFormat(openClawConfig: OpenClawAgentConfig, baseConfig: Partial<StratixAgentConfig> = {}): StratixAgentConfig {
    const name = baseConfig.name || '导入的英雄';

    return {
      agentId: baseConfig.agentId || `stratix-${Date.now()}-imported`,
      name,
      type: baseConfig.type || 'custom',
      profile: baseConfig.profile || {
        characterId: `char-${Date.now()}`,
        name,
        bodyType: 'male',
        parts: {},
      },
      backendType: 'openclaw',
      configStatus: 'draft',
      soul: baseConfig.soul || {
        identity: '',
        goals: [],
        personality: '',
      },
      memory: baseConfig.memory || {
        shortTerm: [],
        longTerm: [],
        context: '',
      },
      skills: baseConfig.skills || [],
      openClawConfig: {
        accountId: openClawConfig.account_id,
        endpoint: openClawConfig.endpoint,
        apiKey: openClawConfig.api_key,
      },
    };
  }

  static toJson(config: StratixAgentConfig, pretty: boolean = true): string {
    return pretty ? JSON.stringify(config, null, 2) : JSON.stringify(config);
  }

  static fromJson(json: string): StratixAgentConfig {
    try {
      const parsed = JSON.parse(json);
      return this.applyDefaults(parsed);
    } catch (error) {
      throw new Error(`配置解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  static mergeConfigs(base: StratixAgentConfig, override: Partial<StratixAgentConfig>): StratixAgentConfig {
    const backendType: AgentBackendType = override.backendType || base.backendType;
    const name = override.name || base.name;

    const result: StratixAgentConfig = {
      agentId: override.agentId || base.agentId,
      name,
      type: override.type || base.type,
      profile: override.profile || base.profile,
      backendType,
      configStatus: override.configStatus || base.configStatus,
    };

    // Merge soul
    if (base.soul || override.soul) {
      const bs: StratixSoulConfig = base.soul || { identity: '', goals: [], personality: '' };
      const os: Partial<StratixSoulConfig> = override.soul || {};
      result.soul = {
        identity: os.identity !== undefined ? os.identity : bs.identity,
        goals: os.goals !== undefined ? os.goals : bs.goals,
        personality: os.personality !== undefined ? os.personality : bs.personality,
      };
    }

    // Merge memory
    if (base.memory || override.memory) {
      const bm: StratixMemoryConfig = base.memory || { shortTerm: [], longTerm: [], context: '' };
      const om: Partial<StratixMemoryConfig> = override.memory || {};
      result.memory = {
        shortTerm: om.shortTerm !== undefined ? om.shortTerm : bm.shortTerm,
        longTerm: om.longTerm !== undefined ? om.longTerm : bm.longTerm,
        context: om.context !== undefined ? om.context : bm.context,
      };
    }

    // Merge openClawConfig
    if (base.openClawConfig || override.openClawConfig) {
      const boc: OpenClawConfig = base.openClawConfig || { accountId: '', endpoint: '' };
      const ooc: Partial<OpenClawConfig> = override.openClawConfig || {};
      result.openClawConfig = {
        accountId: ooc.accountId !== undefined ? ooc.accountId : boc.accountId,
        endpoint: ooc.endpoint !== undefined ? ooc.endpoint : boc.endpoint,
        apiKey: ooc.apiKey !== undefined ? ooc.apiKey : boc.apiKey,
        agentId: ooc.agentId !== undefined ? ooc.agentId : boc.agentId,
      };
    }

    // Merge stratixConfig
    if (base.stratixConfig || override.stratixConfig) {
      result.stratixConfig = override.stratixConfig || base.stratixConfig;
    }

    // Skills and rules
    result.skills = override.skills !== undefined ? override.skills : base.skills;
    result.rules = override.rules !== undefined ? override.rules : base.rules;

    return result;
  }

  private static buildSystemPrompt(
    soul?: StratixSoulConfig,
    memory?: StratixMemoryConfig,
    rules?: string[]
  ): string {
    const parts: string[] = [];

    if (soul?.identity) {
      parts.push(`## 身份\n${soul.identity}`);
    }

    if (soul?.goals && soul.goals.length > 0) {
      parts.push(`## 目标\n${soul.goals.map((g, i) => `${i + 1}. ${g}`).join('\n')}`);
    }

    if (soul?.personality) {
      parts.push(`## 性格\n${soul.personality}`);
    }

    if (memory?.context) {
      parts.push(`## 上下文\n${memory.context}`);
    }

    if (rules && rules.length > 0) {
      parts.push(`## 规则\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`);
    }

    return parts.join('\n\n');
  }

  private static convertSkillsToTools(skills: StratixSkillConfig[]): OpenClawTool[] {
    return skills.map((skill) => ({
      type: 'function' as const,
      function: {
        name: skill.skillId,
        description: skill.description,
        parameters: {
          type: 'object',
          properties: this.convertParametersToProperties(skill.parameters || []),
          required: (skill.parameters || []).filter((p) => p.required).map((p) => p.paramId),
        },
      },
    }));
  }

  private static convertParametersToProperties(parameters: StratixSkillConfig['parameters']): Record<string, any> {
    const properties: Record<string, any> = {};

    parameters.forEach((param) => {
      properties[param.paramId] = {
        type: param.type,
        description: param.name,
        default: param.defaultValue,
      };
    });

    return properties;
  }

  private static applyDefaults(raw: any): StratixAgentConfig {
    const backendType: AgentBackendType = raw.backendType || 'stratix';
    const name = raw.name || '导入的英雄';

    return {
      agentId: raw.agentId || `stratix-${Date.now()}-imported`,
      name,
      type: raw.type || 'custom',
      profile: raw.profile || {
        characterId: `char-${Date.now()}`,
        name,
        bodyType: 'male',
        parts: {},
      },
      backendType,
      configStatus: raw.configStatus || 'draft',
      soul: raw.soul || { identity: '', goals: [], personality: '' },
      memory: raw.memory || { shortTerm: [], longTerm: [], context: '' },
      skills: raw.skills || [],
      rules: raw.rules || [],
      openClawConfig: raw.openClawConfig || { accountId: '', endpoint: '' },
      stratixConfig: raw.stratixConfig,
    };
  }
}
