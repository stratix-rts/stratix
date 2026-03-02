/**
 * Stratix Core - 统一数据协议定义
 * 
 * 本文件定义了 Stratix 星策系统的所有标准化数据结构
 * 所有模块必须依赖此协议进行数据交换
 */

/**
 * Agent 后端类型
 */
export type AgentBackendType = 'openclaw' | 'direct';

/**
 * LLM Provider 类型
 */
export type LLMProvider = 'openai' | 'anthropic' | 'ollama' | 'custom';

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
 * CharacterData - 角色外观数据
 */
export interface CharacterData {
  characterId: string;
  bodyType: BodyType;
  parts: Record<string, PartSelection>;
  thumbnail?: string;
  texture?: CharacterTexture;
  createdAt: number;
  updatedAt: number;
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
 * DirectLLMConfig - 直连 LLM 配置
 */
export interface DirectLLMConfig {
  provider: LLMProvider;
  model: string;
  endpoint?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
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
  defaultValue: any;
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
 */
export interface StratixAgentConfig {
  agentId: string;
  name: string;
  type: 'writer' | 'dev' | 'analyst' | 'custom' | string;
  
  // 外观数据
  character?: CharacterData;
  
  // 后端类型
  backendType: AgentBackendType;
  
  // OpenClaw 配置 (backendType = 'openclaw' 时使用)
  openClawConfig?: OpenClawConfig;
  
  // 直连 LLM 配置 (backendType = 'direct' 时使用)
  directConfig?: DirectLLMConfig;
  
  // 能力定义 (direct 模式需要)
  soul?: StratixSoulConfig;
  memory?: StratixMemoryConfig;
  skills?: StratixSkillConfig[];
  skillTree?: SkillTreeState;
  attributes?: Record<string, number>;
  rules?: string[];
  
  // 位置
  position?: { x: number; y: number };
  
  // 时间戳
  createdAt?: number;
  updatedAt?: number;
  
  // 兼容旧数据 (deprecated)
  model?: {
    name: string;
    params: Record<string, any>;
  };
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
  | 'stratix:config_updated';

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
    status?: 'online' | 'offline' | 'busy' | 'error';
    commandStatus?: 'pending' | 'running' | 'success' | 'failed';
    commandId?: string;
    data?: any;
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
