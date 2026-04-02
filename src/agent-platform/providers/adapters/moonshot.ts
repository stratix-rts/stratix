import { ChatOpenAI } from '@langchain/openai';

import type { CreateProviderOptions, ProviderConfig } from '../types';

import { LLMAdapter } from './base';

const MOONSHOT_CONFIG: ProviderConfig = {
  id: 'moonshot',
  name: 'Moonshot (月之暗面)',
  icon: '🌙',
  requiresApiKey: true,
  defaultEndpoint: 'https://api.moonshot.cn/v1',
  models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  langchainClass: 'ChatOpenAI',
  langchainModule: '@langchain/openai',
  envKey: 'MOONSHOT_API_KEY',
};

export class MoonshotAdapter extends LLMAdapter {
  createModel(options: CreateProviderOptions): ChatOpenAI {
    return new ChatOpenAI({
      modelName: options.model,
      openAIApiKey: options.apiKey,
      configuration: {
        baseURL: options.endpoint || MOONSHOT_CONFIG.defaultEndpoint,
      },
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 4096,
    });
  }

  getModels(): string[] {
    return MOONSHOT_CONFIG.models;
  }

  getConfig(): ProviderConfig {
    return MOONSHOT_CONFIG;
  }
}
