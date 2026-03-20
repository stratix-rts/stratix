import { ChatAnthropic } from '@langchain/anthropic';
import { LLMAdapter } from './base';
import type { CreateProviderOptions, ProviderConfig } from '../types';

const ANTHROPIC_CONFIG: ProviderConfig = {
  id: 'anthropic',
  name: 'Anthropic',
  icon: '🧠',
  requiresApiKey: true,
  defaultEndpoint: 'https://api.anthropic.com',
  models: [
    'claude-sonnet-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
  ],
  langchainClass: 'ChatAnthropic',
  langchainModule: '@langchain/anthropic',
  envKey: 'ANTHROPIC_API_KEY',
};

export class AnthropicAdapter extends LLMAdapter {
  createModel(options: CreateProviderOptions): ChatAnthropic {
    return new ChatAnthropic({
      modelName: options.model,
      anthropicApiKey: options.apiKey,
      clientOptions: options.endpoint
        ? { baseURL: options.endpoint }
        : undefined,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 4096,
    });
  }

  getModels(): string[] {
    return ANTHROPIC_CONFIG.models;
  }

  getConfig(): ProviderConfig {
    return ANTHROPIC_CONFIG;
  }
}
