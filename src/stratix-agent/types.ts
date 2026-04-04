import type { StratixSkillConfig, StratixSoulConfig } from '../stratix-core/stratix-protocol';

export interface AgentConfig {
  agentId: string;
  name: string;
  type: 'dev' | 'writer' | 'analyst' | 'custom';
  provider: 'openai' | 'anthropic' | 'ollama' | 'deepseek' | 'qwen' | 'custom';
  model: string;
  endpoint?: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  maxShortTerm: number;
  enableLongTerm: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SoulConfig {
  identity?: string;
  personality?: string;
  goals?: string[];
  constraints?: string[];
  speakingStyle?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: string;
  tool_calls?: ToolUseRequest[];      // assistant 消息中的工具调用
  tool_results?: ToolUseResult[];     // user 消息中的工具结果
}

export interface SkillDefinition {
  skillId: string;
  name: string;
  description: string;
  parameters: SkillParameter[];
  prompt?: string;
  executor: string;
  timeout?: number;  // 超时时间（毫秒），默认使用全局配置
}

export interface SkillParameter {
  name: string;
  type: string;
  required: boolean;
  default?: any;
  description?: string;
}

export interface SkillResult {
  success: boolean;
  skillId: string;
  result?: any;
  error?: string;
  executionTime: number;
  preview?: SkillResultPreview;  // 中间结果预览
  cached?: boolean;  // 是否来自缓存
}

/**
 * 技能执行结果预览（用于中间结果展示）
 */
export interface SkillResultPreview {
  type: 'text' | 'json' | 'image' | 'table' | 'code';
  content: string;
  mimeType?: string;
}

/**
 * 进度回调类型
 */
export type ProgressCallback = (progress: SkillProgress) => void;

/**
 * 技能执行进度
 */
export interface SkillProgress {
  skillId: string;
  stage: 'started' | 'processing' | 'completed' | 'failed';
  message?: string;
  percent?: number;        // 0-100
  partialResult?: any;    // 部分结果（用于预览）
}

/**
 * 技能执行成功结果
 */
export interface SkillResultSuccess {
  success: true;
  skillId: string;
  result: unknown;
  executionTime: number;
}

/**
 * 技能执行失败结果
 */
export interface SkillResultError {
  success: false;
  skillId: string;
  error: string;
  executionTime: number;
}

/**
 * 技能执行结果（联合类型，确保 result 和 error 互斥）
 */
export type SkillExecutionResult = SkillResultSuccess | SkillResultError;

export interface SkillExecutor {
  execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any>;
}

export interface SkillCall {
  skillId: string;
  params: Record<string, any>;
  reasoning?: string;
}

export interface Session {
  sessionId: string;
  agentId: string;
  title?: string;
  status: 'active' | 'closed';
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  metadata?: Record<string, any>;
  messageCount?: number;
}

export interface AgentResponse {
  sessionId: string;
  response: string;
  skillExecutions?: SkillResult[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'deepseek' | 'qwen' | 'custom';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  anthropicVersion?: string;
}

export interface TokenLimit {
  maxTokens: number;
  reservedForResponse: number;
}

export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  importance: 1 | 2 | 3;
  tags?: string[];
  type?: 'default' | 'skill' | 'reflection' | 'correction';  // 记忆类型，用于分类检索
  createdAt: string;
}

export interface MemoryLayers {
  shortTerm: ChatMessage[];
  midTerm: MemoryEntry[];
  longTerm: MemoryEntry[];
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface HealthStatus {
  healthy: boolean;
  lastCheck: number;
  details?: Record<string, any>;
}

export interface MetricsData {
  requests: number;
  errors: number;
  latency: number;
  tokenUsage: number;
}

export type SkillParams = Record<string, string | number | boolean | object | null | undefined>;

export interface SkillExecutorResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ============================================
// Agent Career System Types
// ============================================

/**
 * 技能分类
 */
export type SkillCategory = 'file' | 'code' | 'data' | 'content' | 'mcp' | 'collab';

/**
 * 技能来源
 */
export type SkillProvider = 'skillhub' | 'builtin' | 'learned';

/**
 * 已学会的技能（含养成字段）
 */
export interface LearnedSkill {
  skillId: string;
  name: string;
  description: string;
  category: SkillCategory;
  level: number;                    // 技能等级（1-5）
  experiencePoints: number;          // 经验值
  proficiency: number;              // 熟练度 0-100
  certified: boolean;               // 是否通过认证
  learnedFrom?: string;            // 从哪个 SkillHub 学的
  learnedAt: number;                // 学习时间
  lastPracticedAt: number;          // 最后练习时间
}

/**
 * 共享技能（SkillHub）
 */
export interface SharedSkill {
  skillId: string;
  name: string;
  description: string;
  category: SkillCategory;
  icon?: string;
  mcpTool?: string;                // 对应的 MCP 工具
  endpoint?: string;                // 技能端点
  provider: SkillProvider;
  installedAgents: string[];        // 已安装的 Agent ID 列表
  createdAt: string;
  updatedAt: string;
}

/**
 * 技能点
 */
export interface SkillPoints {
  total: number;                    // 总点数
  spent: number;                   // 已消耗
  available: number;               // 可用
}

/**
 * Agent 职业档案
 */
export interface AgentProfile {
  agentId: string;
  name: string;
  career: string;                  // 职业（来自 agency-agents）
  soul: SoulConfig;
  rules: string[];
  learnedSkills: LearnedSkill[];    // 已学会的技能
  skillPoints: SkillPoints;        // 技能点
  createdAt: string;
  updatedAt: string;
}

/**
 * Agent 职业档案（扩展版，区分静态技能定义和动态学会技能）
 * 用于 Agent 职业规划系统
 */
export interface AgentCareerProfile {
  agentId: string;
  name: string;
  career: string;                      // 职业（来自 agency-agents）
  soul: StratixSoulConfig;
  rules: string[];

  // 技能定义（静态）- 来自 StratixSkillConfig
  installedSkillDefs: StratixSkillConfig[];

  // 已学会的技能（动态）- 通过工作学习获得
  learnedSkills: LearnedSkill[];

  // 技能点（用于学习）
  skillPoints: number;

  // 进化配置
  evolutionConfig: EvolutionConfig;

  createdAt: string;
  updatedAt: string;
}

/**
 * Zone 文件
 */
export interface ZoneFile {
  id: string;
  name: string;
  path: string;
  content?: string;
  size?: number;
}

/**
 * Zone 上下文
 */
export interface ZoneContext {
  zoneId: string;
  title: string;                   // Zone 标题
  prompt: string;                  // Zone 提示词
  files: ZoneFile[];               // 上下文文件
  members: string[];              // 同 Zone Agent ID 列表
  enteredAt?: number;              // 进入时间
}

/**
 * Zone 提示词上下文
 * 用于渲染 Zone 相关的提示词
 */
export interface ZonePromptContext {
  inZone: boolean;                  // 是否在 Zone 内
  currentZone?: {
    zoneId: string;
    title: string;
    prompt: string;
    files: ZoneFile[];
    members: string[];
  };
  availableZones: ZoneInfo[];      // 可进入的 Zone 列表
  idlePrompt?: string;             // 空闲时的提示词
}

/**
 * Zone 信息（用于提示词展示）
 */
export interface ZoneInfo {
  zoneId: string;
  name: string;
  title?: string;
  prompt?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  agentCount: number;
  status?: string;
}

/**
 * 进化配置
 */
export interface EvolutionConfig {
  enabled: boolean;
  triggerThreshold: number;        // 积累 N 次反思后检查
  cooldownHours: number;           // 进化冷却时间
  maxEvolutionsPerDay: number;     // 每日最大进化次数
}

/**
 * 进化限制（熔断机制）
 */
export interface EvolutionLimits {
  maxEvolutionPerDay: number;           // 每日最大进化次数
  maxRefinementsPerEvolution: number;   // 每次进化的最大微调次数
  consecutiveFailuresToBreak: number;   // 连续失败 N 次后暂停
}

/**
 * 进化结果
 */
export interface EvolutionResult {
  success: boolean;
  evolvedFields?: {
    goals?: string[];
    personality?: string;
    constraints?: string[];
  };
  error?: string;
  evolutionCount: number;              // 当日进化次数
  consecutiveFailures: number;          // 连续失败次数
  requiresUserConfirmation: boolean;   // 是否需要用户确认
}

/**
 * 待确认的进化提议
 */
export interface EvolutionProposal {
  id: string;
  agentId: string;
  timestamp: string;
  proposedChanges: {
    goals?: string[];
    personality?: string;
    constraints?: string[];
  };
  reason: string;
  reflectionCount: number;
}

/**
 * 技能学习记录（用于记忆系统）
 */
export interface SkillLearningRecord extends MemoryEntry {
  type: 'skill';
  skillId: string;
  skillName: string;
  level: number;
  learnedFrom?: string;
  learningOutcome?: string;        // 学习成果/总结
}

// ============================================
// Tool Use / Function Calling Types
// ============================================

/**
 * 工具参数属性（用于 LLM 的 tool schema）
 */
export interface ToolParameterProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  description?: string;
  default?: any;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

/**
 * 工具定义（用于传递给 LLM）
 * 统一格式，会转换为 Anthropic/OpenAI 特定格式
 */
export interface ToolDefinition {
  name: string;                      // 工具名称（必须与 skillId 对应）
  description: string;              // 工具描述
  input_schema: {
    type: 'object';
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
  };
}

/**
 * LLM 工具调用请求
 */
export interface ToolUseRequest {
  type: 'tool_use';
  name: string;
  input: Record<string, any>;
  id: string;                        // 用于标识此次调用
}

/**
 * LLM 工具结果响应
 */
export interface ToolUseResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;                    // 结果内容（JSON 字符串或纯文本）
}

/**
 * 工具调用条目（包含调用信息和结果）
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
  result?: any;
  error?: string;
  executionTime: number;
}

/**
 * 沙箱资源限制配置
 */
export interface SandboxConfig {
  maxMemory?: number;        // MB，默认 128
  maxCpuTime?: number;       // seconds，默认 10
  maxOutputSize?: number;    // bytes，默认 1MB
  maxFileSize?: number;      // bytes，默认 10MB
  maxTempFiles?: number;     // 最大临时文件数，默认 5
}

/**
 * 扩展 ExecutionContext 支持安全相关配置
 */
export interface ExecutionContext {
  agentId: string;
  sessionId?: string;
  userId?: string;
  variables?: Record<string, any>;
  // 安全相关
  allowedPaths?: string[];           // 允许的文件操作路径
  allowedDomains?: string[];         // 允许的网络请求域名
  blockedCommands?: string[];         // 禁止的 bash 命令
  maxToolCalls?: number;             // 最大工具调用次数（防止无限循环）
  sandboxConfig?: SandboxConfig;     // 沙箱资源限制
  // 进度回调
  progressCallback?: ProgressCallback;
}

/**
 * 扩展 GenerateResult 支持 tool_use
 */
export interface GenerateResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'error' | 'tool_use';
  tool_calls?: ToolUseRequest[];     // 包含的 tool_use 请求
}

/**
 * Tool Use 循环执行结果
 */
export interface ToolUseLoopResult {
  finalContent: string;              // LLM 最终文本响应
  toolCalls: ToolCall[];             // 所有工具调用记录
  totalIterations: number;           // 总迭代次数
  totalExecutionTime: number;        // 总执行时间(ms)
  success: boolean;                  // 是否成功完成
  error?: string;                    // 错误信息（如有）
}

/**
 * Tool Use 循环配置
 */
export interface ToolUseLoopConfig {
  maxIterations?: number;            // 最大循环次数（默认 10）
  maxTotalTime?: number;             // 最大总执行时间（ms，默认 120s）
  continueOnError?: boolean;          // 单个工具失败是否继续
  maxTotalTokens?: number;           // 最大 token 预算（默认 unlimited）
  maxToolTimeout?: number;           // 单个工具超时（ms，默认 30000）
  maxConsecutiveErrors?: number;     // 断路器：连续错误次数阈值（默认 3）
}
