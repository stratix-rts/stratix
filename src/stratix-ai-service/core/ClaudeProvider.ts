import Anthropic from '@anthropic-ai/sdk';

import { AIMessage, AIResponse, AIStreamCallback, AIProviderConfig } from '../types';

import { BaseAIProvider } from './AIServiceProvider';

export class ClaudeProvider extends BaseAIProvider {
  readonly name = 'claude';
  private client: Anthropic;
  
  constructor(config: AIProviderConfig) {
    super(config);
    
    if (!config.apiKey) {
      throw new Error('[Claude] API key is required');
    }
    
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
  }
  
  async chat(messages: AIMessage[]): Promise<AIResponse> {
    try {
      const systemMessage = messages.find(m => m.role === 'system');
      const otherMessages = messages.filter(m => m.role !== 'system');
      
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens || 4096,
        system: systemMessage?.content,
        messages: otherMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      });
      
      const content = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('');
      
      return {
        content,
        usage: response.usage ? {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
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
      const systemMessage = messages.find(m => m.role === 'system');
      const otherMessages = messages.filter(m => m.role !== 'system');
      
      const stream = this.client.messages.stream({
        model: this.config.model,
        max_tokens: this.config.maxTokens || 4096,
        system: systemMessage?.content,
        messages: otherMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      });
      
      let fullContent = '';
      
      stream.on('text', (text: string) => {
        fullContent += text;
        callback.onToken(text);
      });
      
      await stream.finalMessage();
      
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
      await this.client.messages.create({
        model: this.config.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'test' }],
      });
      return true;
    } catch {
      return false;
    }
  }
}
