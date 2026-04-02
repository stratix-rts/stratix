import { ChatOpenAI } from '@langchain/openai';

import type { CreateProviderOptions, ProviderConfig } from '../types';

import { LLMAdapter } from './base';

const STEPFUN_CONFIG: ProviderConfig = {
  id: 'stepfun',
  name: 'StepFun (阶跃星辰)',
  icon: '📈',
  requiresApiKey: true,
  defaultEndpoint: 'https://api.stepfun.com/v1',
  models: ['step-1v-8k', 'step-1v-32k', 'step-1v-128k'],
  langchainClass: 'ChatOpenAI',
  langchainModule: '@langchain/openai',
  envKey: 'STEPFUN_API_KEY',
};

export class StepFunAdapter extends LLMAdapter {
  createModel(options: CreateProviderOptions): ChatOpenAI {
    return new ChatOpenAI({
      modelName: options.model,
      openAIApiKey: options.apiKey,
      configuration: {
        baseURL: options.endpoint || STEPFUN_CONFIG.defaultEndpoint,
      },
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 4096,
    });
  }

  getModels(): string[] {
    return STEPFUN_CONFIG.models;
  }

  getConfig(): ProviderConfig {
    return STEPFUN_CONFIG;
  }
}
