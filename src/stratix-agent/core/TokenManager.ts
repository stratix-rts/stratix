import { ChatMessage, TokenLimit } from '../types';
import { MODEL_TOKEN_LIMITS } from '@/stratix-core/config/defaults';

export class TokenManager {
  private modelLimits: Map<string, TokenLimit> = new Map([
    ['gpt-4', { maxTokens: MODEL_TOKEN_LIMITS['gpt-4'] || 8192, reservedForResponse: 2048 }],
    ['gpt-4-turbo', { maxTokens: 128000, reservedForResponse: 4096 }],
    ['gpt-4o', { maxTokens: MODEL_TOKEN_LIMITS['gpt-4o'] || 128000, reservedForResponse: 4096 }],
    ['gpt-4o-mini', { maxTokens: MODEL_TOKEN_LIMITS['gpt-4o-mini'] || 128000, reservedForResponse: 4096 }],
    ['gpt-3.5-turbo', { maxTokens: 16385, reservedForResponse: 2048 }],
    ['claude-3-opus-20240229', { maxTokens: MODEL_TOKEN_LIMITS['claude-3-opus'] || 200000, reservedForResponse: 4096 }],
    ['claude-3-sonnet-20240229', { maxTokens: MODEL_TOKEN_LIMITS['claude-3-sonnet'] || 200000, reservedForResponse: 4096 }],
    ['claude-3-haiku-20240307', { maxTokens: MODEL_TOKEN_LIMITS['claude-3-haiku'] || 200000, reservedForResponse: 4096 }],
    ['claude-3-5-sonnet-20241022', { maxTokens: 200000, reservedForResponse: 4096 }],
    ['claude-3-5-haiku-20241022', { maxTokens: 200000, reservedForResponse: 4096 }],
    ['deepseek-chat', { maxTokens: MODEL_TOKEN_LIMITS['deepseek-chat'] || 64000, reservedForResponse: 4096 }],
    ['deepseek-coder', { maxTokens: 32768, reservedForResponse: 4096 }],
    ['qwen-turbo', { maxTokens: MODEL_TOKEN_LIMITS['qwen-turbo'] || 128000, reservedForResponse: 4096 }],
    ['qwen-plus', { maxTokens: 32768, reservedForResponse: 4096 }],
    ['qwen-max', { maxTokens: 32768, reservedForResponse: 4096 }],
  ]);

  constructor(private model: string) {}

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  calculateMessagesTokenCount(messages: ChatMessage[]): number {
    return messages.reduce((sum, msg) => {
      return sum + this.estimateTokens(msg.content) + 4;
    }, 0);
  }

  truncateMessages(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
    const limit = this.getTokenLimit();
    const availableTokens = limit.maxTokens - limit.reservedForResponse - maxTokens;

    if (this.calculateMessagesTokenCount(messages) <= availableTokens) {
      return messages;
    }

    const systemMsg = messages.find(m => m.role === 'system');
    let truncated: ChatMessage[] = systemMsg ? [systemMsg] : [];
    const nonSystem = messages.filter(m => m.role !== 'system');

    for (let i = nonSystem.length - 1; i >= 0; i--) {
      const msg = nonSystem[i];
      const currentTokens = this.calculateMessagesTokenCount(truncated);
      const msgTokens = this.estimateTokens(msg.content) + 4;

      if (currentTokens + msgTokens <= availableTokens) {
        truncated.unshift(msg);
      } else {
        break;
      }
    }

    return truncated;
  }

  private getTokenLimit(): TokenLimit {
    return this.modelLimits.get(this.model) || { maxTokens: 4096, reservedForResponse: 1024 };
  }
}
