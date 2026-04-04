// ============================================
// Observer Types
// Phase 1: Step 4 - Observer（规则预处理 + LLM）
// ============================================

import type {
  UserInput,
  UserInputType,
  InputFormat,
  InputLanguage,
  Insight,
  InsightType,
  InsightExtractionResult,
} from '../types';

// ------------------------------------------------
// Preprocessor Types
// ------------------------------------------------

export interface PreprocessorConfig {
  /** 是否启用语言检测 */
  detectLanguageEnabled?: boolean;
  /** 是否启用去重 */
  deduplicationEnabled?: boolean;
  /** 是否启用清洗 */
  cleaningEnabled?: boolean;
}

export interface PreprocessedInput {
  /** 原始内容 */
  original: string;
  /** 清洗后的内容 */
  cleaned: string;
  /** 检测到的格式 */
  format: InputFormat;
  /** 检测到的语言 */
  language: InputLanguage;
  /** 推断的用户输入类型 */
  inferredType: UserInputType;
  /** 格式检测的置信度 */
  formatConfidence: number;
}

// ------------------------------------------------
// Insight Extractor Types
// ------------------------------------------------

export interface ObserverExtractorConfig {
  /** LLM provider ID (optional, uses default if not specified) */
  providerId?: string;
  /** LLM 模型 */
  model?: string;
  /** 最大 token 数 */
  maxTokens?: number;
  /** temperature */
  temperature?: number;
  /** 调用超时（毫秒） */
  timeoutMs?: number;
}

export interface ExtractionContext {
  /** 用户输入 */
  input: UserInput;
  /** 预处理结果 */
  preprocessed: PreprocessedInput;
  /** zone ID */
  zoneId: string;
}

export interface InsightExtractorResult {
  /** 是否成功 */
  success: boolean;
  /** 提取的洞察 */
  insight?: Insight;
  /** 错误信息 */
  error?: string;
  /** LLM _usage 信息 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ------------------------------------------------
// Observer Pipeline Types
// ------------------------------------------------

export interface ObserverPipelineConfig {
  preprocessor: PreprocessorConfig;
  extractor: ObserverExtractorConfig;
}

export interface ObserverDependencies {
  /** 获取 LLM 配置的函数 */
  getLLMConfig: () => Promise<{
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
  } | undefined>;
  /** 保存洞察的函数 */
  saveInsight: (insight: Insight) => Promise<void>;
  /** 保存用户输入的函数 */
  saveInput: (input: UserInput) => Promise<void>;
}

// ------------------------------------------------
// Observer Event Types
// ------------------------------------------------

export type ObserverEventType =
  | 'input_received'
  | 'input_processed'
  | 'insight_extracted'
  | 'extraction_failed'
  | 'status_changed';

export interface ObserverEvent {
  type: ObserverEventType;
  timestamp: Date;
  payload: Record<string, unknown>;
}
