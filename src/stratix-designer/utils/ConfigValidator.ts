import {
  StratixAgentConfig,
  StratixSoulConfig,
  StratixSkillConfig,
  OpenClawConfig,
  DirectLLMConfig,
} from '@/stratix-core/stratix-protocol';

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  message: string;
  errors?: ValidationError[];
}

export class ConfigValidator {
  static validate(config: StratixAgentConfig): ValidationResult {
    const errors: ValidationError[] = [];

    if (!config.agentId) {
      errors.push({ field: 'agentId', message: 'Agent ID 不能为空' });
    } else if (!this.validateAgentId(config.agentId)) {
      errors.push({ field: 'agentId', message: 'Agent ID 必须以 "stratix-" 开头' });
    }

    if (!config.name || config.name.trim() === '') {
      errors.push({ field: 'name', message: '英雄名称不能为空' });
    }

    if (!config.type) {
      errors.push({ field: 'type', message: '英雄类型不能为空' });
    }

    if (!config.backendType) {
      errors.push({ field: 'backendType', message: '后端类型不能为空' });
    }

    // Validate based on backend type
    if (config.backendType === 'openclaw') {
      if (!config.openClawConfig) {
        errors.push({ field: 'openClawConfig', message: 'OpenClaw 配置不能为空' });
      } else {
        const openClawResult = this.validateOpenClawConfig(config.openClawConfig);
        if (!openClawResult.valid) {
          errors.push(...(openClawResult.errors || []));
        }
      }
    } else if (config.backendType === 'direct') {
      if (!config.directConfig) {
        errors.push({ field: 'directConfig', message: 'Direct LLM 配置不能为空' });
      } else {
        const directResult = this.validateDirectConfig(config.directConfig);
        if (!directResult.valid) {
          errors.push(...(directResult.errors || []));
        }
      }

      // Direct mode needs soul and skills
      if (config.soul) {
        const soulResult = this.validateSoul(config.soul);
        if (!soulResult.valid) {
          errors.push(...(soulResult.errors || []));
        }
      }

      if (config.skills) {
        const skillsResult = this.validateSkills(config.skills);
        if (!skillsResult.valid) {
          errors.push(...(skillsResult.errors || []));
        }
      }
    }

    if (errors.length > 0) {
      return {
        valid: false,
        message: `配置校验失败：${errors[0].message}`,
        errors,
      };
    }

    return { valid: true, message: '配置校验通过' };
  }

  static validateAgentId(agentId: string): boolean {
    if (!agentId || !agentId.startsWith('stratix-')) {
      return false;
    }
    return true;
  }

  static validateSoul(soul: StratixSoulConfig): ValidationResult {
    const errors: ValidationError[] = [];

    if (!soul) {
      return {
        valid: false,
        message: 'Soul 配置不能为空',
        errors: [{ field: 'soul', message: 'Soul 配置不能为空' }],
      };
    }

    if (!soul.identity || soul.identity.trim() === '') {
      errors.push({ field: 'soul.identity', message: '身份描述不能为空' });
    }

    if (!soul.goals || soul.goals.length === 0) {
      errors.push({ field: 'soul.goals', message: '至少需要一个目标' });
    }

    if (errors.length > 0) {
      return { valid: false, message: errors[0].message, errors };
    }

    return { valid: true, message: 'Soul 配置校验通过' };
  }

  static validateSkills(skills: StratixSkillConfig[]): ValidationResult {
    const errors: ValidationError[] = [];

    if (!skills || skills.length === 0) {
      return {
        valid: false,
        message: '至少需要配置一个技能',
        errors: [{ field: 'skills', message: '至少需要配置一个技能' }],
      };
    }

    skills.forEach((skill, index) => {
      if (!skill.skillId) {
        errors.push({ field: `skills[${index}].skillId`, message: '技能 ID 不能为空' });
      } else if (!skill.skillId.startsWith('stratix-skill-')) {
        errors.push({ field: `skills[${index}].skillId`, message: '技能 ID 必须以 "stratix-skill-" 开头' });
      }

      if (!skill.name || skill.name.trim() === '') {
        errors.push({ field: `skills[${index}].name`, message: '技能名称不能为空' });
      }
    });

    if (errors.length > 0) {
      return { valid: false, message: errors[0].message, errors };
    }

    return { valid: true, message: '技能配置校验通过' };
  }

  static validateOpenClawConfig(config: OpenClawConfig): ValidationResult {
    const errors: ValidationError[] = [];

    if (!config) {
      return {
        valid: false,
        message: 'OpenClaw 配置不能为空',
        errors: [{ field: 'openClawConfig', message: 'OpenClaw 配置不能为空' }],
      };
    }

    if (!config.accountId || config.accountId.trim() === '') {
      errors.push({ field: 'openClawConfig.accountId', message: 'OpenClaw accountId 不能为空' });
    }

    if (!config.endpoint || config.endpoint.trim() === '') {
      errors.push({ field: 'openClawConfig.endpoint', message: 'OpenClaw endpoint 不能为空' });
    }

    if (errors.length > 0) {
      return { valid: false, message: errors[0].message, errors };
    }

    return { valid: true, message: 'OpenClaw 配置校验通过' };
  }

  static validateDirectConfig(config: DirectLLMConfig): ValidationResult {
    const errors: ValidationError[] = [];

    if (!config) {
      return {
        valid: false,
        message: 'Direct LLM 配置不能为空',
        errors: [{ field: 'directConfig', message: 'Direct LLM 配置不能为空' }],
      };
    }

    if (!config.provider) {
      errors.push({ field: 'directConfig.provider', message: 'LLM Provider 不能为空' });
    }

    if (!config.model || config.model.trim() === '') {
      errors.push({ field: 'directConfig.model', message: '模型名称不能为空' });
    }

    if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
      errors.push({ field: 'directConfig.temperature', message: 'temperature 应在 0-2 之间' });
    }

    if (config.maxTokens !== undefined && config.maxTokens < 1) {
      errors.push({ field: 'directConfig.maxTokens', message: 'maxTokens 应大于 0' });
    }

    if (errors.length > 0) {
      return { valid: false, message: errors[0].message, errors };
    }

    return { valid: true, message: 'Direct LLM 配置校验通过' };
  }
}
