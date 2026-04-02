import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import { LLMConfig, GenerateResult, ChatMessage, ToolDefinition, ToolUseRequest, SkillDefinition } from '../types';

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
    return messages.map(msg => {
      // 如果有 tool_results，构建 tool_result 块
      if (msg.role === 'user' && msg.tool_results && msg.tool_results.length > 0) {
        const content: Anthropic.ToolResultBlockParam[] = msg.tool_results.map(tr => ({
          type: 'tool_result',
          tool_use_id: tr.tool_use_id,
          content: tr.content
        }));
        return { role: 'user' as const, content };
      }

      // 如果有 tool_calls，构建 assistant 消息
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const content: Anthropic.ToolUseBlockParam[] = msg.tool_calls.map(tc => ({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.input
        }));
        return { role: 'assistant' as const, content };
      }

      return {
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      };
    });
  }

  async generate(messages: ChatMessage[]): Promise<GenerateResult> {
    if (this.isAnthropic()) {
      return this.generateAnthropic(messages);
    }
    return this.generateOpenAICompatible(messages);
  }

  /**
   * 生成支持工具调用的消息
   * @param messages 对话历史
   * @param tools 工具定义列表
   * @returns 生成结果（可能包含 tool_calls）
   */
  async generateWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[]
  ): Promise<GenerateResult> {
    if (this.isAnthropic()) {
      return this.generateAnthropicWithTools(messages, tools);
    }
    return this.generateOpenAIWithTools(messages, tools);
  }

  /**
   * 将 SkillDefinition 转换为 ToolDefinition
   */
  static skillToTool(skill: SkillDefinition): ToolDefinition {
    return {
      name: skill.skillId,
      description: skill.description,
      input_schema: {
        type: 'object',
        properties: skill.parameters.reduce((acc, p) => {
          acc[p.name] = {
            type: p.type as ToolDefinition['input_schema']['properties'][string]['type'],
            description: p.description,
            default: p.default
          };
          return acc;
        }, {} as Record<string, any>),
        required: skill.parameters.filter(p => p.required).map(p => p.name)
      }
    };
  }

  /**
   * 批量转换 SkillDefinition[] 为 ToolDefinition[]
   */
  static skillsToTools(skills: SkillDefinition[]): ToolDefinition[] {
    return skills.map(skill => LLMConnector.skillToTool(skill));
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

  private async generateAnthropicWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[]
  ): Promise<GenerateResult> {
    const client = this.getAnthropicClient();

    // 转换为 Anthropic 格式
    const anthropicTools = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema
    }));

    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const response = await client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 4096,
      temperature: this.config.temperature ?? 0.7,
      system: systemMessage?.content,
      messages: this.convertToAnthropicFormat(conversationMessages),
      tools: anthropicTools,
    });

    // 解析响应中的 tool_use
    const tool_calls: ToolUseRequest[] = [];
    const content_blocks = response.content;

    for (const block of content_blocks) {
      if (block.type === 'tool_use') {
        tool_calls.push({
          type: 'tool_use',
          name: block.name,
          input: block.input as Record<string, any>,
          id: block.id
        });
      }
    }

    // 提取文本内容
    const textContent = content_blocks
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('\n');

    return {
      content: textContent,
      usage: response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      } : undefined,
      finishReason: tool_calls.length > 0 ? 'tool_use' :
        (response.stop_reason === 'end_turn' ? 'stop' : 'length'),
      tool_calls
    };
  }

  private async generateOpenAIWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[]
  ): Promise<GenerateResult> {
    const client = this.getOpenAIClient();

    // 转换为 OpenAI 格式
    const openaiTools = tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema
      }
    }));

    const response = await client.chat.completions.create({
      model: this.config.model,
      messages: messages as any,
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 4096,
      tools: openaiTools,
    });

    const choice = response.choices[0];
    const message = choice?.message;

    // 解析 tool_calls
    const tool_calls: ToolUseRequest[] = [];
    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.type === 'function') {
          tool_calls.push({
            type: 'tool_use',
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
            id: tc.id
          });
        }
      }
    }

    return {
      content: message?.content || '',
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      finishReason: tool_calls.length > 0 ? 'tool_use' :
        (choice?.finish_reason === 'stop' ? 'stop' : 'length'),
      tool_calls
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
