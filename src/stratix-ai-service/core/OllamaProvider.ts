import { AIMessage, AIResponse, AIStreamCallback, AIProviderConfig } from '../types';

import { BaseAIProvider } from './AIServiceProvider';

export class OllamaProvider extends BaseAIProvider {
  readonly name = 'ollama';
  private baseUrl: string;
  
  constructor(config: AIProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }
  
  async chat(messages: AIMessage[]): Promise<AIResponse> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          stream: false,
          options: {
            temperature: this.config.temperature || 0.7,
            num_predict: this.config.maxTokens,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      return {
        content: data.message.content,
        model: data.model,
        provider: this.name,
      };
    } catch (error) {
      this.handleError(error, 'chat');
    }
  }
  
  async chatStream(messages: AIMessage[], callback: AIStreamCallback): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          stream: true,
          options: {
            temperature: this.config.temperature || 0.7,
            num_predict: this.config.maxTokens,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is null');
      }
      
      const decoder = new TextDecoder();
      let fullContent = '';
      
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              fullContent += data.message.content;
              callback.onToken(data.message.content);
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }
}
