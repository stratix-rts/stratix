import { ChatOpenAI } from '@langchain/openai';

import type { CreateProviderOptions, ProviderConfig } from '../types';

import { LLMAdapter } from './base';

const DEEPSEEK_CONFIG: ProviderConfig = {
  id: 'deepseek',
  name: 'DeepSeek',
  icon: '📊',
  requiresApiKey: true,
  defaultEndpoint: 'https://api.deepseek.com',
  models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
  langchainClass: 'ChatOpenAI',
  langchainModule: '@langchain/openai',
  envKey: 'DEEPSEEK_API_KEY',
};

export class DeepSeekAdapter extends LLMAdapter {
  createModel(options: CreateProviderOptions): ChatOpenAI {
    return new ChatOpenAI({
      modelName: options.model,
      openAIApiKey: options.apiKey,
      configuration: {
        baseURL: options.endpoint || DEEPSEEK_CONFIG.defaultEndpoint,
      },
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 4096,
    });
  }

  getModels(): string[] {
    return DEEPSEEK_CONFIG.models;
  }

  getConfig(): ProviderConfig {
    return DEEPSEEK_CONFIG;
  }
}
