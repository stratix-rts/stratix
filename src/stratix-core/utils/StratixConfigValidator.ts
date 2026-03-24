/**
 * Stratix 配置校验器
 *
 * 校验 Agent/Skill/Model 配置是否符合 Stratix 规范
 */

import {
  StratixAgentConfig,
  StratixSkillConfig,
  StratixSoulConfig,
  StratixMemoryConfig,
  OpenClawConfig,
  StratixSkillParameter,
  CharacterProfile,
  AgentBackendType,
  AgentConfigStatus,
} from '../stratix-protocol';
import StratixIdGenerator from './StratixIdGenerator';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class StratixConfigValidator {
  private static instance: StratixConfigValidator;
  private idGenerator: StratixIdGenerator;

  private constructor() {
    this.idGenerator = StratixIdGenerator.getInstance();
  }

  public static getInstance(): StratixConfigValidator {
    if (!StratixConfigValidator.instance) {
      StratixConfigValidator.instance = new StratixConfigValidator();
    }
    return StratixConfigValidator.instance;
  }

  /**
   * 校验 Agent 配置
   */
  public validateAgentConfig(config: StratixAgentConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const backendType = config.backendType || 'stratix';

    if (!config.agentId) {
      errors.push('agentId 是必填字段');
    } else if (!this.idGenerator.isValidAgentId(config.agentId)) {
      warnings.push('agentId 建议使用 stratix-{timestamp}-{random} 格式');
    }

    if (!config.name || config.name.trim() === '') {
      errors.push('name 是必填字段');
    }

    if (!config.type) {
      errors.push('type 是必填字段');
    }

    if (!['openclaw', 'stratix'].includes(backendType)) {
      errors.push('backendType 必须是 openclaw 或 stratix');
    }

    if (!config.configStatus) {
      warnings.push('configStatus 建议设置为 draft 或 ready');
    } else if (!['draft', 'ready'].includes(config.configStatus)) {
      errors.push('configStatus 必须是 draft 或 ready');
    }

    if (!config.profile) {
      errors.push('profile 是必填字段');
    } else {
      const profileResult = this.validateCharacterProfile(config.profile);
      errors.push(...profileResult.errors);
      warnings.push(...profileResult.warnings);
    }

    if (backendType === 'openclaw') {
      if (!config.openClawConfig) {
        if (config.configStatus === 'ready') {
          errors.push('OpenClaw ready 状态需要 openClawConfig');
        }
      } else {
        const openClawResult = this.validateOpenClawConfig(config.openClawConfig);
        errors.push(...openClawResult.errors);
        warnings.push(...openClawResult.warnings);
      }
    }

    if (backendType === 'stratix') {
      if (!config.stratixConfig) {
        if (config.configStatus === 'ready') {
          errors.push('StratixAgent ready 状态需要 stratixConfig');
        }
      } else {
        const stratixResult = this.validateStratixConfig(config.stratixConfig);
        errors.push(...stratixResult.errors);
        warnings.push(...stratixResult.warnings);
      }

      if (config.configStatus === 'ready') {
        if (!config.soul) {
          warnings.push('StratixAgent ready 状态建议配置 soul');
        }
        if (!config.skills || config.skills.length === 0) {
          warnings.push('StratixAgent ready 状态建议至少配置一个技能');
        }
      }

      if (config.soul) {
        const soulResult = this.validateSoulConfig(config.soul);
        errors.push(...soulResult.errors);
        warnings.push(...soulResult.warnings);
      }

      if (config.skills && config.skills.length > 0) {
        config.skills.forEach((skill, index) => {
          const skillResult = this.validateSkillConfig(skill);
          skillResult.errors.forEach((err) => errors.push(`skills[${index}]: ${err}`));
          skillResult.warnings.forEach((warn) => warnings.push(`skills[${index}]: ${warn}`));
        });
      }
    }

    if (config.memory) {
      const memoryResult = this.validateMemoryConfig(config.memory);
      errors.push(...memoryResult.errors);
      warnings.push(...memoryResult.warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 校验 CharacterProfile
   */
  public validateCharacterProfile(profile: CharacterProfile): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!profile.characterId) {
      errors.push('profile.characterId 是必填字段');
    }

    if (!profile.name || profile.name.trim() === '') {
      errors.push('profile.name 是必填字段');
    }

    if (!profile.bodyType) {
      errors.push('profile.bodyType 是必填字段');
    }

    if (!profile.parts || typeof profile.parts !== 'object') {
      errors.push('profile.parts 必须是对象');
    }

    if (!profile.thumbnail) {
      warnings.push('profile.thumbnail 建议设置头像');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * 校验 Soul 配置
   */
  public validateSoulConfig(config: StratixSoulConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.identity || config.identity.trim() === '') {
      errors.push('identity 是必填字段');
    } else if (config.identity.length < 10) {
      warnings.push('identity 描述过短，建议至少 10 个字符');
    }

    if (!config.goals || config.goals.length === 0) {
      warnings.push('goals 建议至少设置一个目标');
    }

    if (!config.personality || config.personality.trim() === '') {
      warnings.push('personality 建议设置性格描述');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * 校验 Memory 配置
   */
  public validateMemoryConfig(config: StratixMemoryConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!Array.isArray(config.shortTerm)) {
      errors.push('shortTerm 必须是数组');
    }

    if (!Array.isArray(config.longTerm)) {
      errors.push('longTerm 必须是数组');
    }

    if (!config.context || config.context.trim() === '') {
      warnings.push('context 建议设置上下文');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * 校验 Skill 配置
   */
  public validateSkillConfig(config: StratixSkillConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.skillId) {
      errors.push('skillId 是必填字段');
    } else if (!this.idGenerator.isValidSkillId(config.skillId)) {
      warnings.push('skillId 建议使用 stratix-skill-{action}-{random} 格式');
    }

    if (!config.name || config.name.trim() === '') {
      errors.push('name 是必填字段');
    }

    if (!config.description || config.description.trim() === '') {
      warnings.push('description 建议设置技能描述');
    }

    if (!config.parameters || config.parameters.length === 0) {
      warnings.push('parameters 建议至少设置一个参数');
    } else {
      config.parameters.forEach((param, index) => {
        const paramResult = this.validateSkillParameter(param);
        paramResult.errors.forEach((err) => errors.push(`parameters[${index}]: ${err}`));
        paramResult.warnings.forEach((warn) => warnings.push(`parameters[${index}]: ${warn}`));
      });
    }

    if (!config.executeScript && !config.prompt) {
      warnings.push('建议设置 executeScript 或 prompt');
    }

    if (config.executeScript) {
      try {
        JSON.parse(config.executeScript);
      } catch {
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * 校验技能参数
   */
  public validateSkillParameter(param: StratixSkillParameter): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!param.paramId) {
      errors.push('paramId 是必填字段');
    }

    if (!param.name || param.name.trim() === '') {
      errors.push('name 是必填字段');
    }

    const validTypes = ['string', 'number', 'boolean', 'object'];
    if (!validTypes.includes(param.type)) {
      errors.push(`type 必须是 ${validTypes.join(' | ')} 之一`);
    }

    if (param.defaultValue === undefined && !param.required) {
      warnings.push('非必填参数建议设置 defaultValue');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * 校验 OpenClaw 配置
   */
  public validateOpenClawConfig(config: OpenClawConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.accountId || config.accountId.trim() === '') {
      errors.push('accountId 是必填字段');
    }

    if (!config.endpoint || config.endpoint.trim() === '') {
      errors.push('endpoint 是必填字段');
    } else {
      try {
        new URL(config.endpoint);
      } catch {
        errors.push('endpoint 必须是有效的 URL');
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * 校验 StratixAgent 配置
   */
  public validateStratixConfig(config: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const validProviders = ['openai', 'anthropic', 'ollama', 'deepseek', 'qwen', 'custom'];
    if (!config.provider || !validProviders.includes(config.provider)) {
      errors.push(`provider 必须是 ${validProviders.join(' | ')} 之一`);
    }

    if (!config.model || config.model.trim() === '') {
      errors.push('model 是必填字段');
    }

    if (config.endpoint) {
      try {
        new URL(config.endpoint);
      } catch {
        errors.push('endpoint 必须是有效的 URL');
      }
    }

    if (config.temperature !== undefined) {
      if (config.temperature < 0 || config.temperature > 2) {
        errors.push('temperature 应在 0-2 之间');
      }
    }

    if (config.maxTokens !== undefined) {
      if (config.maxTokens < 1) {
        errors.push('maxTokens 应大于 0');
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * 快速校验 Agent 配置（仅返回是否有效）
   */
  public isValidAgentConfig(config: StratixAgentConfig): boolean {
    return this.validateAgentConfig(config).valid;
  }

  /**
   * 快速校验 Skill 配置（仅返回是否有效）
   */
  public isValidSkillConfig(config: StratixSkillConfig): boolean {
    return this.validateSkillConfig(config).valid;
  }

  /**
   * 校验配置是否为 ready 状态
   */
  public isReadyConfig(config: StratixAgentConfig): boolean {
    if (config.configStatus !== 'ready') return false;

    if (config.backendType === 'openclaw') {
      return !!(config.openClawConfig?.endpoint && config.openClawConfig?.accountId);
    } else if (config.backendType === 'stratix') {
      return !!(config.stratixConfig?.provider && config.stratixConfig?.model);
    }
    return false;
  }
}

export default StratixConfigValidator;
