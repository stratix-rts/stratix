import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export interface ProviderConfig {
  id: string;
  name: string;
  icon: string;
  requiresApiKey: boolean;
  defaultEndpoint: string;
  models: string[];
  langchainClass: string;
  langchainModule: string;
  envKey: string | null;
  isCustom?: boolean;
}

export interface CreateProviderOptions {
  providerId: string;
  model: string;
  apiKey?: string;
  endpoint?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderInstance {
  config: ProviderConfig;
  llm: BaseChatModel;
}

export interface ProviderTestResult {
  success: boolean;
  message: string;
  latency?: number;
}

export interface ProviderListResult {
  success: boolean;
  providers: ProviderConfig[];
  error?: string;
}
