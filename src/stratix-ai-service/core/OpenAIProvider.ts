import OpenAI from 'openai';

import { AIMessage, AIResponse, AIStreamCallback, AIProviderConfig } from '../types';

import { BaseAIProvider } from './AIServiceProvider';

export class OpenAIProvider extends BaseAIProvider {
  readonly name = 'openai';
  private client: OpenAI;
  
  constructor(config: AIProviderConfig) {
    super(config);
    
    if (!config.apiKey) {
      throw new Error('[OpenAI] API key is required');
    }
    
    this.client = new OpenAI({
      apiKey: config.apiKey,
    });
  }
  
  async chat(messages: AIMessage[]): Promise<AIResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: this.config.temperature || 0.7,
        max_tokens: this.config.maxTokens,
      });
      
      const choice = response.choices[0];
      
      return {
        content: choice.message.content || '',
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        } : undefined,
        model: response.model,
        provider: this.name,
      };
    } catch (error) {
      this.handleError(error, 'chat');
    }
  }
  
  async chatStream(messages: AIMessage[], callback: AIStreamCallback): Promise<void> {
    try {
      const stream = await this.client.chat.completions.create({
        model: this.config.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: this.config.temperature || 0.7,
        max_tokens: this.config.maxTokens,
        stream: true,
      });
      
      let fullContent = '';
      
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          fullContent += delta;
          callback.onToken(delta);
        }
      }
      
      callback.onComplete({
        content: fullContent,
        model: this.config.model,
        provider: this.name,
      });
    } catch (error) {
      callback.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
  
  async complete(prompt: string): Promise<AIResponse> {
    return this.chat([{ role: 'user', content: prompt }]);
  }
  
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }
}
