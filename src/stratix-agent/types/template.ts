/**
 * Agent 模板类型定义
 * 对应 agency-agents 仓库的 Markdown 格式
 */

/**
 * 领域分类 (对应 agency-agents 的 12 个职能领域)
 */
export type AgentDomain =
  | 'engineering'
  | 'design'
  | 'paid-media'
  | 'sales'
  | 'marketing'
  | 'product'
  | 'project-management'
  | 'testing'
  | 'support'
  | 'spatial-computing'
  | 'specialized'
  | '_mixins';

/**
 * Mixin 类型 (对应 agency-agents 的 base, resource, compliance)
 */
export type MixinType = 'base' | 'resource' | 'compliance';

/**
 * 规则优先级
 */
export type RulePriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * 工作流定义
 */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  triggerConditions?: string[];
  steps: WorkflowStep[];
}

/**
 * 工作流步骤
 */
export interface WorkflowStep {
  id: string;
  order: number;
  name: string;
  description: string;
  expectedOutput: string;
  tools?: string[];
  skills?: string[];
  nextSteps?: string[];
  onError?: string;
}

/**
 * Agent 规则
 */
export interface AgentRule {
  id: string;
  priority: RulePriority;
  rule: string;
  reason?: string;
}

/**
 * 技能参数
 */
export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  defaultValue?: unknown;
  description?: string;
  validation?: string;
}

/**
 * 代码示例
 */
export interface CodeExample {
  language: string;
  code: string;
  description?: string;
}

/**
 * 模板技能定义
 */
export interface TemplateSkill {
  skillId: string;
  name: string;
  description: string;
  triggerPhrases?: string[];
  parameters: SkillParameter[];
  codeExamples?: CodeExample[];
  promptTemplate?: string;
}

/**
 * 成功指标
 */
export interface SuccessMetric {
  name: string;
  description: string;
  measurement: string;
  targetValue?: string;
}

/**
 * 资源限制
 */
export interface ResourceLimits {
  maxTokensPerRequest?: number;
  maxConcurrentTasks?: number;
  rateLimitPerMinute?: number;
  timeoutMs?: number;
  memoryLimitMB?: number;
}

/**
 * 合规配置
 */
export interface ComplianceConfig {
  dataRetention?: string;
  gdprCompliant?: boolean;
  hipaaCompliant?: boolean;
  auditLogging?: boolean;
  encryptionRequired?: boolean;
}

/**
 * 模板元数据
 */
export interface TemplateMetadata {
  author?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  examples?: string[];
  language?: string;
  auditLogging?: boolean;
}

/**
 * agency-agents 兼容的增强型 Agent 模板格式
 */
export interface AgentTemplate {
  // === 基础信息 ===
  id: string;
  name: string;
  version: string;
  description: string;

  // === 分类体系 ===
  domain: AgentDomain;
  tags: string[];
  mixins: MixinType[];

  // === 身份与个性 ===
  identity: string;
  personality: string;
  tone: string;

  // === 核心使命 ===
  mission: string;
  workflows: WorkflowDefinition[];

  // === 行为规则 ===
  rules: AgentRule[];
  constraints: string[];
  forbiddenActions: string[];

  // === 技能定义 ===
  skills: TemplateSkill[];

  // === 工作流步骤 ===
  workflowSteps: WorkflowStep[];

  // === 成功指标 ===
  successMetrics: SuccessMetric[];

  // === 资源限制 ===
  resourceLimits?: ResourceLimits;

  // === 合规要求 ===
  compliance?: ComplianceConfig;

  // === 元数据 ===
  metadata: TemplateMetadata;
}

/**
 * 领域名称映射
 */
export const DOMAIN_NAMES: Record<AgentDomain, string> = {
  'engineering': '工程开发',
  'design': '设计',
  'paid-media': '付费媒体',
  'sales': '销售',
  'marketing': '市场营销',
  'product': '产品管理',
  'project-management': '项目管理',
  'testing': '测试',
  'support': '客户支持',
  'spatial-computing': '空间计算',
  'specialized': '专业领域',
  '_mixins': '混合模板',
};

/**
 * 领域描述映射
 */
export const DOMAIN_DESCRIPTIONS: Record<AgentDomain, string> = {
  'engineering': '后端、前端、移动端、DevOps 等开发相关 Agent',
  'design': 'UI/UX 设计、品牌设计、图形设计等设计相关 Agent',
  'paid-media': '广告投放、竞价优化、媒体采购等付费媒体 Agent',
  'sales': '销售自动化、CRM、潜在客户开发等销售 Agent',
  'marketing': '内容营销、SEO、社交媒体等营销 Agent',
  'product': '产品规划、路线图、用户研究等产品管理 Agent',
  'project-management': '项目管理、敏捷、Scrum 等项目管理 Agent',
  'testing': '自动化测试、性能测试、安全测试等测试 Agent',
  'support': '客户服务、技术支持、FAQ 等支持 Agent',
  'spatial-computing': 'AR/VR、元宇宙、3D 等空间计算 Agent',
  'specialized': '其他专业领域的 Agent',
  '_mixins': '可组合的基础模板',
};

/**
 * Mixin 说明
 */
export const MIXIN_DESCRIPTIONS: Record<MixinType, string> = {
  'base': '安全、协议、审计基础模块',
  'resource': '资源限制、预算告警模块',
  'compliance': 'GDPR/HIPAA 合规追踪模块',
};
