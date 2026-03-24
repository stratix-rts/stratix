// LLM 默认配置
export const LLM_DEFAULTS = {
  TEMPERATURE: 0.7,
  MAX_TOKENS: 4096,
  TIMEOUT_MS: 30000,
} as const;

// 连接池配置
export const CONNECTION_POOL_DEFAULTS = {
  MAX_CONNECTIONS: 100,
  IDLE_TIMEOUT_MS: 300000,
  HEALTH_CHECK_INTERVAL_MS: 60000,
} as const;

// 记忆配置
export const MEMORY_DEFAULTS = {
  MAX_SHORT_TERM: 20,
  MAX_LONG_TERM_MB: 512,
} as const;

// 位置保存延迟
export const POSITION_SAVE_DELAY_MS = 5000;

// Token 限制 (来自 TokenManager.ts)
export const MODEL_TOKEN_LIMITS: Record<string, number> = {
  'gpt-4': 8192,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  'deepseek-chat': 64000,
  'qwen-turbo': 128000,
};
