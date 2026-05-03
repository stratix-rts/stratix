import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import type { CreateProviderOptions, ProviderConfig } from '../types';

export abstract class LLMAdapter {
  abstract createModel(options: CreateProviderOptions): BaseChatModel;
  abstract getModels(): string[];
  abstract getConfig(): ProviderConfig;
  
  validateOptions(options: CreateProviderOptions): { valid: boolean; error?: string } {
    const config = this.getConfig();
    
    if (config.requiresApiKey && !options.apiKey) {
      return { valid: false, error: `${config.name} requires an API key` };
    }
    
    if (!options.model) {
      return { valid: false, error: 'Model is required' };
    }
    
    if (config.models.length > 0 && !config.models.includes(options.model)) {
      return { valid: false, error: `Model "${options.model}" is not supported by ${config.name}` };
    }
    
    return { valid: true };
  }
}
