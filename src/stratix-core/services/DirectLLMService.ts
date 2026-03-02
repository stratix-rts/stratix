/**
 * DirectLLMService - 直连 LLM 服务
 * 支持多种 LLM Provider：OpenAI, Anthropic, Ollama, 自定义
 */

import type {
  DirectLLMConfig,
  StratixSoulConfig,
  StratixMemoryConfig,
  StratixSkillConfig,
  LLMProvider,
} from '../stratix-protocol';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  messages?: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface GenerateResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'error';
}

export interface LLMProviderAdapter {
  generate(config: DirectLLMConfig, messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult>;
  generateStream?(
    config: DirectLLMConfig, 
    messages: ChatMessage[], 
    onChunk: (chunk: string) => void,
    options?: GenerateOptions
  ): Promise<GenerateResult>;
  validateConfig(config: DirectLLMConfig): boolean;
}

class OpenAIAdapter implements LLMProviderAdapter {
  validateConfig(config: DirectLLMConfig): boolean {
    return !!(config.model && (config.apiKey || config.provider === 'openai'));
  }

  async generate(
    config: DirectLLMConfig, 
    messages: ChatMessage[], 
    options?: GenerateOptions
  ): Promise<GenerateResult> {
    const endpoint = config.endpoint || 'https://api.openai.com/v1';
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: options?.maxTokens || config.maxTokens || 4096,
        temperature: options?.temperature ?? config.temperature ?? 0.7,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    
    return {
      content: data.choices[0]?.message?.content || '',
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
      finishReason: data.choices[0]?.finish_reason || 'stop',
    };
  }

  async generateStream(
    config: DirectLLMConfig,
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    options?: GenerateOptions
  ): Promise<GenerateResult> {
    const endpoint = config.endpoint || 'https://api.openai.com/v1';
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: options?.maxTokens || config.maxTokens || 4096,
        temperature: options?.temperature ?? config.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response reader');
    }

    const decoder = new TextDecoder();
    let fullContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content || '';
            if (content) {
              fullContent += content;
              onChunk(content);
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      content: fullContent,
      finishReason: 'stop',
    };
  }
}

class AnthropicAdapter implements LLMProviderAdapter {
  validateConfig(config: DirectLLMConfig): boolean {
    return !!(config.model && config.apiKey);
  }

  async generate(
    config: DirectLLMConfig, 
    messages: ChatMessage[], 
    options?: GenerateOptions
  ): Promise<GenerateResult> {
    const endpoint = config.endpoint || 'https://api.anthropic.com';
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error('Anthropic API key is required');
    }

    // Extract system message
    const systemMessage = messages.find(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch(`${endpoint}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: options?.maxTokens || config.maxTokens || 4096,
        system: systemMessage?.content,
        messages: otherMessages.map(m => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    
    return {
      content: data.content[0]?.text || '',
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      } : undefined,
      finishReason: data.stop_reason || 'stop',
    };
  }
}

class OllamaAdapter implements LLMProviderAdapter {
  validateConfig(config: DirectLLMConfig): boolean {
    return !!(config.model && config.endpoint);
  }

  async generate(
    config: DirectLLMConfig, 
    messages: ChatMessage[], 
    options?: GenerateOptions
  ): Promise<GenerateResult> {
    const endpoint = config.endpoint || 'http://localhost:11434';

    const response = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        stream: false,
        options: {
          temperature: options?.temperature ?? config.temperature ?? 0.7,
          num_predict: options?.maxTokens || config.maxTokens || 4096,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    
    return {
      content: data.message?.content || '',
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      finishReason: 'stop',
    };
  }

  async generateStream(
    config: DirectLLMConfig,
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    options?: GenerateOptions
  ): Promise<GenerateResult> {
    const endpoint = config.endpoint || 'http://localhost:11434';

    const response = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        stream: true,
        options: {
          temperature: options?.temperature ?? config.temperature ?? 0.7,
          num_predict: options?.maxTokens || config.maxTokens || 4096,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response reader');
    }

    const decoder = new TextDecoder();
    let fullContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            const content = data.message?.content || '';
            if (content) {
              fullContent += content;
              onChunk(content);
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      content: fullContent,
      finishReason: 'stop',
    };
  }
}

class CustomAdapter implements LLMProviderAdapter {
  validateConfig(config: DirectLLMConfig): boolean {
    return !!(config.model && config.endpoint);
  }

  async generate(
    config: DirectLLMConfig, 
    messages: ChatMessage[], 
    options?: GenerateOptions
  ): Promise<GenerateResult> {
    if (!config.endpoint) {
      throw new Error('Custom endpoint is required');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: options?.maxTokens || config.maxTokens || 4096,
        temperature: options?.temperature ?? config.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Custom API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    
    // Try common response formats
    const content = data.choices?.[0]?.message?.content 
      || data.content?.[0]?.text 
      || data.message?.content 
      || data.text 
      || data.response 
      || '';

    return {
      content,
      finishReason: 'stop',
    };
  }
}

export class DirectLLMService {
  private adapters: Map<LLMProvider, LLMProviderAdapter>;

  constructor() {
    this.adapters = new Map([
      ['openai', new OpenAIAdapter()],
      ['anthropic', new AnthropicAdapter()],
      ['ollama', new OllamaAdapter()],
      ['custom', new CustomAdapter()],
    ]);
  }

  async generateResponse(
    config: DirectLLMConfig,
    soul: StratixSoulConfig,
    memory: StratixMemoryConfig,
    skills: StratixSkillConfig[],
    rules: string[],
    userMessage: string,
    options?: GenerateOptions
  ): Promise<GenerateResult> {
    const adapter = this.adapters.get(config.provider);
    if (!adapter) {
      throw new Error(`Unsupported provider: ${config.provider}`);
    }

    if (!adapter.validateConfig(config)) {
      throw new Error(`Invalid configuration for provider: ${config.provider}`);
    }

    const messages = this.buildMessages(soul, memory, skills, rules, userMessage);
    
    return adapter.generate(config, messages, options);
  }

  async generateStreamResponse(
    config: DirectLLMConfig,
    soul: StratixSoulConfig,
    memory: StratixMemoryConfig,
    skills: StratixSkillConfig[],
    rules: string[],
    userMessage: string,
    onChunk: (chunk: string) => void,
    options?: GenerateOptions
  ): Promise<GenerateResult> {
    const adapter = this.adapters.get(config.provider);
    if (!adapter) {
      throw new Error(`Unsupported provider: ${config.provider}`);
    }

    if (!adapter.validateConfig(config)) {
      throw new Error(`Invalid configuration for provider: ${config.provider}`);
    }

    const messages = this.buildMessages(soul, memory, skills, rules, userMessage);

    if (adapter.generateStream) {
      return adapter.generateStream(config, messages, onChunk, options);
    }

    // Fallback to non-streaming
    const result = await adapter.generate(config, messages, options);
    onChunk(result.content);
    return result;
  }

  async testConnection(config: DirectLLMConfig): Promise<{ success: boolean; message: string }> {
    const adapter = this.adapters.get(config.provider);
    if (!adapter) {
      return { success: false, message: `Unsupported provider: ${config.provider}` };
    }

    if (!adapter.validateConfig(config)) {
      return { success: false, message: `Invalid configuration for provider: ${config.provider}` };
    }

    try {
      const result = await adapter.generate(
        config,
        [{ role: 'user', content: 'Hello, are you there? Please respond with "Yes, I am here."' }],
        { maxTokens: 50 }
      );

      if (result.content && result.finishReason !== 'error') {
        return { success: true, message: `Connected to ${config.provider} (${config.model})` };
      }

      return { success: false, message: 'No response received from the model' };
    } catch (error) {
      return { 
        success: false, 
        message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  private buildMessages(
    soul: StratixSoulConfig,
    memory: StratixMemoryConfig,
    skills: StratixSkillConfig[],
    rules: string[],
    userMessage: string
  ): ChatMessage[] {
    const systemParts: string[] = [];

    // Soul
    if (soul) {
      if (soul.identity) {
        systemParts.push(`## Identity\n${soul.identity}`);
      }
      if (soul.goals && soul.goals.length > 0) {
        systemParts.push(`## Goals\n${soul.goals.map((g, i) => `${i + 1}. ${g}`).join('\n')}`);
      }
      if (soul.personality) {
        systemParts.push(`## Personality\n${soul.personality}`);
      }
    }

    // Memory
    if (memory) {
      if (memory.context) {
        systemParts.push(`## Context\n${memory.context}`);
      }
      if (memory.longTerm && memory.longTerm.length > 0) {
        systemParts.push(`## Long-term Memory\n${memory.longTerm.join('\n')}`);
      }
    }

    // Skills
    if (skills && skills.length > 0) {
      const skillDescriptions = skills.map(s => {
        let desc = `- ${s.name}: ${s.description}`;
        if (s.prompt) {
          desc += `\n  Template: ${s.prompt}`;
        }
        return desc;
      });
      systemParts.push(`## Available Skills\n${skillDescriptions.join('\n')}`);
    }

    // Rules
    if (rules && rules.length > 0) {
      systemParts.push(`## Rules\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`);
    }

    const messages: ChatMessage[] = [];

    if (systemParts.length > 0) {
      messages.push({
        role: 'system',
        content: systemParts.join('\n\n'),
      });
    }

    // Short-term memory as conversation history
    if (memory?.shortTerm && memory.shortTerm.length > 0) {
      memory.shortTerm.forEach(item => {
        messages.push({ role: 'user', content: item });
      });
    }

    messages.push({ role: 'user', content: userMessage });

    return messages;
  }
}

export const directLLMService = new DirectLLMService();
export default DirectLLMService;
