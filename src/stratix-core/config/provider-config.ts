export interface ProviderConfig {
  id: string;
  name: string;
  defaultEndpoint: string;
  authHeader?: 'Authorization' | 'x-api-key';
  authScheme?: string;
  extraHeaders?: Record<string, string>;
  responsePath: string;
}

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
    authHeader: 'Authorization',
    authScheme: 'Bearer',
    responsePath: 'choices.0.message.content'
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    authHeader: 'x-api-key',
    extraHeaders: { 'anthropic-version': '2023-06-01' },
    responsePath: 'content.0.text'
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    defaultEndpoint: 'http://localhost:11434/api/chat',
    responsePath: 'message.content'
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultEndpoint: 'https://api.deepseek.com/v1/chat/completions',
    authHeader: 'Authorization',
    authScheme: 'Bearer',
    responsePath: 'choices.0.message.content'
  },
  qwen: {
    id: 'qwen',
    name: 'Qwen',
    defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    authHeader: 'Authorization',
    authScheme: 'Bearer',
    responsePath: 'choices.0.message.content'
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    defaultEndpoint: '',
    authHeader: 'Authorization',
    authScheme: 'Bearer',
    responsePath: 'choices.0.message.content'
  }
};
