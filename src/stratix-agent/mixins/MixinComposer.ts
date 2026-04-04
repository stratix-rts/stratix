/**
 * Mixin 组合器
 * 将 base, resource, compliance 模块组合到模板
 */

import {
  LLM_DEFAULTS,
  MEMORY_DEFAULTS,
} from '@/stratix-core/config/defaults';

import {
  AgentTemplate,
  MixinType,
  AgentRule,
  ResourceLimits,
  ComplianceConfig,
} from '../types/template';


/**
 * Base Mixin: 安全/协议/审计规则
 */
const BASE_MIXIN_RULES: AgentRule[] = [
  {
    id: 'base-1',
    priority: 'critical',
    rule: '始终保护用户隐私和数据安全',
    reason: '基础安全要求',
  },
  {
    id: 'base-2',
    priority: 'critical',
    rule: '遵守所有适用的法律和法规',
    reason: '合规要求',
  },
  {
    id: 'base-3',
    priority: 'high',
    rule: '保持透明的沟通，及时报告问题和进度',
    reason: '建立信任',
  },
  {
    id: 'base-4',
    priority: 'high',
    rule: '记录所有重要操作以供审计追踪',
    reason: '审计要求',
  },
  {
    id: 'base-5',
    priority: 'medium',
    rule: '尊重知识产权，只使用有权限的内容',
    reason: '法律合规',
  },
];

const BASE_MIXIN_CONSTRAINTS = [
  '不得存储明文密码或敏感凭据',
  '不得绕过安全检查',
  '所有操作必须在日志中记录',
  '不得在未经授权的情况下访问用户数据',
];

const BASE_MIXIN_FORBIDDEN = [
  '不得向第三方透露用户信息',
  '不得使用未加密的通信渠道传输敏感数据',
  '不得忽略系统警告和安全提示',
];

/**
 * Resource Mixin: 资源限制配置
 */
const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxTokensPerRequest: LLM_DEFAULTS.MAX_TOKENS,
  maxConcurrentTasks: 3,
  rateLimitPerMinute: 60,
  timeoutMs: LLM_DEFAULTS.TIMEOUT_MS,
  memoryLimitMB: MEMORY_DEFAULTS.MAX_LONG_TERM_MB,
};

/**
 * Compliance Mixin: GDPR/HIPAA 合规配置
 */
const COMPLIANCE_MIXIN_RULES: AgentRule[] = [
  {
    id: 'gdpr-1',
    priority: 'critical',
    rule: '处理个人数据前必须获得明确同意',
    reason: 'GDPR 要求',
  },
  {
    id: 'gdpr-2',
    priority: 'critical',
    rule: '用户有权删除其个人数据',
    reason: 'GDPR 要求 - 被遗忘权',
  },
  {
    id: 'gdpr-3',
    priority: 'high',
    rule: '数据泄露必须在 72 小时内报告',
    reason: 'GDPR 要求 - 违规通知',
  },
  {
    id: 'hipaa-1',
    priority: 'critical',
    rule: '不得披露受保护的健康信息 (PHI)',
    reason: 'HIPAA 要求',
  },
  {
    id: 'hipaa-2',
    priority: 'critical',
    rule: '确保所有医疗数据存储和传输加密',
    reason: 'HIPAA 要求 - 加密标准',
  },
];

const DEFAULT_COMPLIANCE_CONFIG: ComplianceConfig = {
  dataRetention: '30days',
  gdprCompliant: true,
  hipaaCompliant: false,
  auditLogging: true,
  encryptionRequired: true,
};

/**
 * MixinComposer 类
 */
export class MixinComposer {
  /**
   * 组合多个 mixin 到模板
   */
  compose(template: AgentTemplate, mixins: MixinType[]): AgentTemplate {
    const composed: AgentTemplate = {
      ...template,
      mixins: [...new Set([...template.mixins, ...mixins])],
      rules: [...template.rules],
      constraints: [...template.constraints],
      forbiddenActions: [...template.forbiddenActions],
    };

    for (const mixin of mixins) {
      switch (mixin) {
        case 'base':
          this.applyBaseMixin(composed);
          break;
        case 'resource':
          this.applyResourceMixin(composed);
          break;
        case 'compliance':
          this.applyComplianceMixin(composed);
          break;
      }
    }

    // 合并去重规则
    composed.rules = this.deduplicateRules(composed.rules);
    // 合并去重约束
    composed.constraints = [...new Set(composed.constraints)];
    // 合并去重禁止行为
    composed.forbiddenActions = [...new Set(composed.forbiddenActions)];

    return composed;
  }

  /**
   * 单独应用 Base Mixin
   */
  applyBaseMixin(template: AgentTemplate): AgentTemplate {
    // 添加规则
    for (const rule of BASE_MIXIN_RULES) {
      if (!template.rules.some(r => r.id === rule.id)) {
        template.rules.push(rule);
      }
    }

    // 添加约束
    for (const constraint of BASE_MIXIN_CONSTRAINTS) {
      if (!template.constraints.includes(constraint)) {
        template.constraints.push(constraint);
      }
    }

    // 添加禁止行为
    for (const forbidden of BASE_MIXIN_FORBIDDEN) {
      if (!template.forbiddenActions.includes(forbidden)) {
        template.forbiddenActions.push(forbidden);
      }
    }

    // 设置审计日志
    if (!template.metadata) {
      template.metadata = {};
    }
    template.metadata.auditLogging = true;

    return template;
  }

  /**
   * 单独应用 Resource Mixin
   */
  applyResourceMixin(template: AgentTemplate): AgentTemplate {
    template.resourceLimits = {
      ...DEFAULT_RESOURCE_LIMITS,
      ...template.resourceLimits,
    };

    // 添加资源相关规则
    const resourceRules: AgentRule[] = [
      {
        id: 'resource-1',
        priority: 'medium',
        rule: '避免生成过长的响应，优先简洁明了',
        reason: '资源优化',
      },
      {
        id: 'resource-2',
        priority: 'medium',
        rule: '合理使用 API 调用次数，避免不必要的请求',
        reason: '成本控制',
      },
    ];

    for (const rule of resourceRules) {
      if (!template.rules.some(r => r.id === rule.id)) {
        template.rules.push(rule);
      }
    }

    return template;
  }

  /**
   * 单独应用 Compliance Mixin
   */
  applyComplianceMixin(template: AgentTemplate): AgentTemplate {
    template.compliance = {
      ...DEFAULT_COMPLIANCE_CONFIG,
      ...template.compliance,
    };

    // 添加合规规则
    for (const rule of COMPLIANCE_MIXIN_RULES) {
      if (!template.rules.some(r => r.id === rule.id)) {
        template.rules.push(rule);
      }
    }

    // 添加合规相关约束
    const complianceConstraints = [
      '仅在必要时收集个人数据',
      '不得将个人数据用于原始收集目的之外的任何目的',
      '确保数据处理活动有完整的审计追踪',
    ];

    for (const constraint of complianceConstraints) {
      if (!template.constraints.includes(constraint)) {
        template.constraints.push(constraint);
      }
    }

    return template;
  }

  /**
   * 移除 mixin
   */
  removeMixin(template: AgentTemplate, mixin: MixinType): AgentTemplate {
    // 移除 mixin 标签
    template.mixins = template.mixins.filter(m => m !== mixin);

    switch (mixin) {
      case 'base':
        // 移除 base 规则
        template.rules = template.rules.filter(r => !r.id.startsWith('base-'));
        // 移除 base 约束
        template.constraints = template.constraints.filter(
          c => !BASE_MIXIN_CONSTRAINTS.includes(c)
        );
        // 移除 base 禁止行为
        template.forbiddenActions = template.forbiddenActions.filter(
          f => !BASE_MIXIN_FORBIDDEN.includes(f)
        );
        break;

      case 'resource':
        // 重置资源限制为默认值
        template.resourceLimits = undefined;
        // 移除 resource 规则
        template.rules = template.rules.filter(r => !r.id.startsWith('resource-'));
        break;

      case 'compliance':
        // 重置合规配置
        template.compliance = undefined;
        // 移除 compliance 规则
        template.rules = template.rules.filter(
          r => !r.id.startsWith('gdpr-') && !r.id.startsWith('hipaa-')
        );
        break;
    }

    return template;
  }

  /**
   * 获取 mixin 的规则说明
   */
  getMixinRules(mixin: MixinType): AgentRule[] {
    switch (mixin) {
      case 'base':
        return BASE_MIXIN_RULES;
      case 'compliance':
        return COMPLIANCE_MIXIN_RULES;
      default:
        return [];
    }
  }

  /**
   * 获取 mixin 的约束说明
   */
  getMixinConstraints(mixin: MixinType): string[] {
    switch (mixin) {
      case 'base':
        return BASE_MIXIN_CONSTRAINTS;
      default:
        return [];
    }
  }

  /**
   * 获取 mixin 的禁止行为说明
   */
  getMixinForbidden(mixin: MixinType): string[] {
    switch (mixin) {
      case 'base':
        return BASE_MIXIN_FORBIDDEN;
      default:
        return [];
    }
  }

  /**
   * 去重规则
   */
  private deduplicateRules(rules: AgentRule[]): AgentRule[] {
    const seen = new Set<string>();
    return rules.filter(rule => {
      if (seen.has(rule.rule)) {
        return false;
      }
      seen.add(rule.rule);
      return true;
    });
  }
}

export default MixinComposer;
