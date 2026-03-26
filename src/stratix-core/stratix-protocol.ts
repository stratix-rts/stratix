/**
 * Stratix Core - 统一数据协议定义
 * 
 * 本文件定义了 Stratix 星策系统的所有标准化数据结构
 * 所有模块必须依赖此协议进行数据交换
 */

/**
 * Agent 后端类型
 */
export type AgentBackendType = 'openclaw' | 'stratix';

/**
 * LLM Provider 类型
 */
export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'qwen' | 'moonshot' | 'stepfun' | 'ollama' | 'custom';

/**
 * BodyType - 角色体型类型
 */
export type BodyType = 'male' | 'female' | 'teen' | 'muscular' | 'pregnant' | 'child';

/**
 * PartSelection - 部件选择
 */
export interface PartSelection {
  itemId: string;
  variant: string;
}

/**
 * SkillTreeState - 技能树状态
 */
export interface SkillTreeState {
  selectedNodes: string[];
  unlockedNodes: string[];
}

/**
 * CharacterTexture - 角色纹理信息
 */
export interface CharacterTexture {
  filePath: string;
  width: number;
  height: number;
  animations: string[];
  generatedAt: number;
}

/**
 * CharacterProfile - 角色配置（与 SavedCharacter 对齐）
 * 标准化的角色外观和能力数据结构
 */
export interface CharacterProfile {
  characterId: string;
  name: string;
  bodyType: BodyType;
  parts: Record<string, PartSelection>;
  skillTree?: SkillTreeState;
  attributes?: Record<string, number>;
  thumbnail?: string;
  texture?: CharacterTexture;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * @deprecated Use CharacterProfile instead
 */
export type CharacterData = CharacterProfile;

/**
 * Agent 配置状态（持久化）
 */
export type AgentConfigStatus = 'draft' | 'ready';

/**
 * Agent 连接状态（运行时）
 */
export type AgentConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

/**
 * Agent 工作状态（运行时）
 */
export type AgentActivityStatus = 'idle' | 'busy' | 'error';

/**
 * Agent 完整状态信息
 */
export interface AgentStatusInfo {
  config: AgentConfigStatus;
  connection: AgentConnectionStatus;
  activity: AgentActivityStatus;
  lastError?: string;
  lastActiveAt?: number;
}

/**
 * OpenClaw 连接方式
 */
export type OpenClawConnectionMethod = 'pairing' | 'tailscale';

/**
 * @deprecated Use OpenClawConnectionMethod instead
 */
export type OpenClawConnectionMode = 'auto' | 'local' | 'remote' | 'tailscale';

/**
 * OpenClawConfig - OpenClaw 后端配置
 */
export interface OpenClawConfig {
  endpoint: string;
  accountId: string;
  apiKey?: string;
  agentId?: string;
}

/**
 * @deprecated Use OpenClawConfig instead
 */
export type StratixOpenClawConfig = OpenClawConfig;

/**
 * OpenClawConnectionConfig - 新的统一配置
 */
export interface OpenClawConnectionConfig {
  id?: string;
  name?: string;
  method: OpenClawConnectionMethod;
  endpoint: string;
  sharedToken?: string;
  deviceToken?: string;
}

/**
 * @deprecated Use OpenClawConnectionConfig instead
 */
export interface UnifiedOpenClawConfig {
  mode: OpenClawConnectionMode;
  localEndpoint?: string;
  remoteEndpoint?: string;
  tailscaleNodeId?: string;
  credentials?: {
    token?: string;
    accountId?: string;
    apiKey?: string;
  };
}

/**
 * StratixDirectConfig - StratixAgent 直连配置 (轻量级 Agent)
 */
export interface StratixDirectConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'deepseek' | 'qwen' | 'custom';
  model: string;
  apiKey?: string;
  endpoint?: string;
  temperature?: number;
  maxTokens?: number;
  maxShortTerm?: number;
  enableLongTerm?: boolean;
}

/**
 * StratixSoulConfig - Soul 配置
 */
export interface StratixSoulConfig {
  identity: string;
  goals: string[];
  personality: string;
}

/**
 * StratixMemoryConfig - 记忆配置
 */
export interface StratixMemoryConfig {
  shortTerm: string[];
  longTerm: string[];
  context: string;
}

/**
 * StratixSkillConfig - 技能配置
 */
export interface StratixSkillConfig {
  skillId: string;
  name: string;
  description: string;
  parameters: StratixSkillParameter[];
  executor?: string;                    // 执行器类型: 'fs' | 'bash' | 'http' | 'builtin'（Agent运行时需要）
  executeScript?: string;
  prompt?: string;
}

/**
 * StratixSkillParameter - 技能参数
 */
export interface StratixSkillParameter {
  paramId: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required: boolean;
  defaultValue?: any;                  // 原始字段（保留兼容性）
  default?: any;                      // 标准字段名
  description?: string;                // 参数描述
}

/**
 * Stratix 统一 API 响应格式
 */
export interface StratixApiResponse<T = any> {
  code: number;
  message: string;
  data: T | null;
  requestId: string;
}

/**
 * Agent 配置（Stratix 核心数据结构）
 * 
 * 设计原则：
 * 1. profile 为必填字段，包含完整的角色配置
 * 2. 以 LLM 直连为优先设计，OpenClaw 为兼容模式
 * 3. configStatus 标识配置完成度（draft/ready）
 */
export interface StratixAgentConfig {
  agentId: string;
  name: string;
  type: 'writer' | 'dev' | 'analyst' | 'custom' | string;
  
  profile: CharacterProfile;
  
  backendType: AgentBackendType;
  openClawConfig?: OpenClawConfig;
  stratixConfig?: StratixDirectConfig;
  
  soul?: StratixSoulConfig;
  memory?: StratixMemoryConfig;
  skills?: StratixSkillConfig[];
  rules?: string[];
  
  configStatus: AgentConfigStatus;
  
  lastError?: string;
  lastActiveAt?: number;
  
  position?: { x: number; y: number };
  createdAt?: number;
  updatedAt?: number;
}

/**
 * 模板消费态响应 (轻量，只含 renderedPrompt)
 * 用于 Agent 运行时消费，最小化数据传输
 */
export interface TemplateConsumptionResponse {
  agentId: string;
  name: string;
  renderedPrompt: string;
  recommendedSkills?: string[];
}

/**
 * 模板编辑态响应 (完整数据)
 * 用于 UI 编辑，包含所有可编辑字段
 */
export interface TemplateEditResponse extends StratixAgentConfig {
  renderedPrompt?: string;  // 渲染后的最终提示词
  rawContent?: string;       // Raw markdown (agency 模板)
  source?: 'local' | 'agency';
}

/**
 * 指令数据
 */
export interface StratixCommandData {
  commandId: string;
  skillId: string;
  agentId: string;
  params: Record<string, any>;
  executeAt: number;
}

/**
 * 前端操作事件类型
 */
export type StratixFrontendEventType = 
  | 'stratix:agent_select'
  | 'stratix:agent_deselect'
  | 'stratix:skill_selected'
  | 'stratix:command_execute'
  | 'stratix:command_cancel';

/**
 * 状态同步事件类型
 */
export type StratixStateSyncEventType =
  | 'stratix:agent_status_update'
  | 'stratix:command_status_update'
  | 'stratix:agent_create'
  | 'stratix:config_updated'
  | 'stratix:project_message_new'
  | 'stratix:project_message_sync'
  | 'stratix:project_message_to_agent'
  // Orchestration events
  | 'orchestration:zone_updated'
  | 'orchestration:task_assigned'
  | 'orchestration:task_completed'
  | 'orchestration:agent_status_changed'
  | 'orchestration:message_sent'
  // Zone events
  | 'stratix:zone_updated'
  | 'stratix:zone_file_added'
  | 'stratix:zone_file_removed'
  | 'stratix:zone_file_updated'
  | 'stratix:zone_member_joined'
  | 'stratix:zone_member_left'
  | 'stratix:zone_deleted'
  | 'stratix:zone_restored'
  | 'stratix:zone_task_created'
  | 'stratix:zone_task_updated'
  | 'stratix:zone_task_deleted'
  | 'stratix:zone_task_claimed'
  | 'stratix:zone_message_added';

/**
 * 前端操作事件（Stratix RTS / 指令面板 → 事件总线）
 */
export interface StratixFrontendOperationEvent {
  eventType: StratixFrontendEventType;
  payload: {
    agentIds?: string[];
    skill?: StratixSkillConfig;
    command?: StratixCommandData;
    commandId?: string;
  };
  timestamp: number;
  requestId: string;
}

/**
 * 状态同步事件（事件总线 → 前端模块）
 */
export interface StratixStateSyncEvent {
  eventType: StratixStateSyncEventType;
  payload: {
    agentId?: string;
    status?: AgentStatusInfo;
    commandStatus?: 'pending' | 'running' | 'success' | 'failed';
    commandId?: string;
    data?: any;
    // 项目消息相关
    projectId?: string;
    channelId?: string;
    message?: any;
    messages?: any[];
    subscriberIds?: string[];
    // Orchestration 相关
    zoneId?: string;
    taskId?: string;
    zoneType?: string;
    result?: any;
    error?: string;
    messageId?: string;
    conversationId?: string;
    messageType?: string;
    senderId?: string;
  };
  timestamp: number;
  requestId: string;
}

/**
 * 创建 Agent 请求
 */
export interface StratixCreateAgentRequest {
  config: StratixAgentConfig;
}

/**
 * Zone 信息
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
 * RTS 移动 API - Agent 自主移动接口
 *
 * Agent 可以调用此 API 在 RTS 场景中移动自己
 * 移动命令通过 WebSocket 转发到前端 RTS 场景执行
 */
export interface RTSMoveAPI {
  /**
   * 将 Agent 移动到指定 Zone
   * @param zoneId 目标 Zone ID
   * @returns Promise<void>
   */
  moveTo(zoneId: string): Promise<void>;

  /**
   * 让 Agent 离开当前 Zone
   * @returns Promise<void>
   */
  leaveCurrentZone(): Promise<void>;

  /**
   * 获取 Agent 当前所在的 Zone
   * @returns Zone ID 或 null（如果不在任何 Zone 中）
   */
  getCurrentZone(): string | null;

  /**
   * 获取所有 Zone 列表
   * @returns ZoneInfo 数组
   */
  getZoneList(): ZoneInfo[];
}
