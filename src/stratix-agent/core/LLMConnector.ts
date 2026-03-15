import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { LLMConfig, GenerateResult, ChatMessage } from '../types';

export class LLMConnector {
  private config: LLMConfig;
  private openaiClient: OpenAI | null;
  private anthropicClient: Anthropic | null;

  constructor(config: LLMConfig) {
    this.config = config;
    this.openaiClient = null;
    this.anthropicClient = null;
  }

  private isAnthropic(): boolean {
    return this.config.provider === 'anthropic';
  }

  private getOpenAIClient(): OpenAI {
    if (!this.openaiClient) {
      const baseUrl = this.config.baseUrl || this.getDefaultBaseUrl();
      this.openaiClient = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: baseUrl,
      });
    }
    return this.openaiClient;
  }

  private getAnthropicClient(): Anthropic {
    if (!this.anthropicClient) {
      this.anthropicClient = new Anthropic({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl,
      });
    }
    return this.anthropicClient;
  }

  private getDefaultBaseUrl(): string {
    switch (this.config.provider) {
      case 'openai':
        return 'https://api.openai.com/v1';
      case 'anthropic':
        return 'https://api.anthropic.com';
      case 'ollama':
        return 'http://localhost:11434/v1';
      case 'deepseek':
        return 'https://api.deepseek.com/v1';
      case 'qwen':
        return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
      default:
        return 'https://api.openai.com/v1';
    }
  }

  private convertToAnthropicFormat(messages: ChatMessage[]): Anthropic.MessageParam[] {
    return messages.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content
    }));
  }

  async generate(messages: ChatMessage[]): Promise<GenerateResult> {
    if (this.isAnthropic()) {
      return this.generateAnthropic(messages);
    }
    return this.generateOpenAICompatible(messages);
  }

  private async generateAnthropic(messages: ChatMessage[]): Promise<GenerateResult> {
    const client = this.getAnthropicClient();
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const response = await client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 4096,
      temperature: this.config.temperature ?? 0.7,
      system: systemMessage?.content,
      messages: this.convertToAnthropicFormat(conversationMessages),
    });

    const content = response.content[0]?.type === 'text' 
      ? response.content[0].text 
      : '';

    return {
      content,
      usage: response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      } : undefined,
      finishReason: response.stop_reason === 'end_turn' ? 'stop' : 'length',
    };
  }

  private async generateOpenAICompatible(messages: ChatMessage[]): Promise<GenerateResult> {
    const client = this.getOpenAIClient();

    const response = await client.chat.completions.create({
      model: this.config.model,
      messages: messages as any,
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 4096,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      finishReason: (response.choices[0]?.finish_reason === 'stop' || response.choices[0]?.finish_reason === 'length') 
        ? response.choices[0]?.finish_reason 
        : 'stop',
    };
  }

  async generateStream(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void
  ): Promise<GenerateResult> {
    if (this.isAnthropic()) {
      const result = await this.generate(messages);
      for (const char of result.content) {
        onChunk(char);
        await new Promise(r => setTimeout(r, 10));
      }
      return result;
    }

    const client = this.getOpenAIClient();
    const stream = await client.chat.completions.create({
      model: this.config.model,
      messages: messages as any,
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 4096,
      stream: true,
    });

    let fullContent = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullContent += content;
        onChunk(content);
      }
    }

    return { content: fullContent, finishReason: 'stop' };
  }

  async testConnection(): Promise<{ success: boolean; message: string; latency?: number }> {
    const start = Date.now();
    try {
      const result = await this.generate([
        { role: 'user', content: 'Hi' }
      ]);
      const latency = Date.now() - start;

      if (result.content) {
        return { success: true, message: `Connected to ${this.config.provider}`, latency };
      }
      return { success: false, message: 'No response from model' };
    } catch (error) {
      return { 
        success: false, 
        message: error instanceof Error ? error.message : 'Connection failed' 
      };
    }
  }
}
