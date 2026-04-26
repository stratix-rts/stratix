import axios, { AxiosInstance } from 'axios';

import { StratixOpenClawConfig } from '@/stratix-core/stratix-protocol';

import {
  OpenClawAdapterInterface,
  OpenClawAction,
  OpenClawResponse,
  OpenClawStatus,
  OpenClawEvent,
  ChatOptions,
  ChatResponse,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
} from './types';


export class RemoteOpenClawAdapter implements OpenClawAdapterInterface {
  private config: StratixOpenClawConfig;
  private subscribers: ((event: OpenClawEvent) => void)[] = [];
  private axiosInstance: AxiosInstance;

  constructor(config: StratixOpenClawConfig) {
    this.config = config;
    this.axiosInstance = axios.create({
      baseURL: config.endpoint,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
      },
    });
  }

  public async connect(): Promise<void> {
    const status = await this.getStatus();
    if (!status.connected) {
      throw new Error('Failed to connect to remote OpenClaw');
    }
  }

  public async disconnect(): Promise<void> {}

  public async execute(_action: OpenClawAction): Promise<OpenClawResponse> {
    return {
      success: false,
      error: 'Remote adapter does not support WebSocket RPC. Use sendMessage or openaiChatCompletion instead.',
    };
  }

  public async getStatus(): Promise<OpenClawStatus> {
    try {
      const response = await this.axiosInstance.get('/health');
      return {
        connected: true,
        accountId: this.config.accountId,
        lastActive: Date.now(),
        ...response.data,
      };
    } catch {
      return {
        connected: false,
        accountId: this.config.accountId,
        lastActive: 0,
      };
    }
  }

  public subscribe(callback: (event: OpenClawEvent) => void): void {
    this.subscribers.push(callback);
  }

  public unsubscribe(callback: (event: OpenClawEvent) => void): void {
    const index = this.subscribers.indexOf(callback);
    if (index !== -1) {
      this.subscribers.splice(index, 1);
    }
  }

  public async sendMessage(message: string, options?: ChatOptions): Promise<ChatResponse> {
    return this.openaiChatCompletion({
      messages: [{ role: 'user', content: message }],
    }).then((response) => ({
      messageId: response.id,
      content: response.choices[0]?.message?.content || '',
      role: 'assistant',
      sessionId: options?.sessionId,
      done: true,
    }));
  }

  public async openaiChatCompletion(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse> {
    try {
      const response = await this.axiosInstance.post<OpenAIChatCompletionResponse>(
        '/v1/chat/completions',
        request
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message = error.response?.data?.error?.message || error.message;
        throw new Error(`OpenAI API error: ${message}`);
      }
      throw error;
    }
  }

  public async listModels(): Promise<unknown[]> {
    try {
      const response = await this.axiosInstance.get<{ data: Array<{ id: string }> }>('/v1/models');
      return response.data.data.map((m) => m.id);
    } catch {
      return [];
    }
  }

  public async listSessions(): Promise<unknown[]> {
    return this.invokeTool<unknown[]>('sessions_list');
  }

  public async listAgents(): Promise<unknown[]> {
    return this.invokeTool<unknown[]>('agents_list');
  }

  public async streamChatCompletion(
    _request: OpenAIChatCompletionRequest,
    _onChunk: (chunk: string) => void,
    _options?: { agentId?: string }
  ): Promise<void> {
    throw new Error('Remote adapter does not support streaming');
  }

  public isConnected(): boolean {
    // Remote adapter is connected if getStatus returns connected
    // This is a lightweight check - for real status, use getStatus()
    return true;
  }

  public async invokeTool<T = unknown>(
    tool: string,
    args?: Record<string, unknown>,
    options?: { sessionKey?: string; action?: string }
  ): Promise<T> {
    const request = {
      tool,
      args: args || {},
      sessionKey: options?.sessionKey,
      action: options?.action,
    };

    const response = await this.axiosInstance.post<{ ok: boolean; result?: T; error?: { message: string } }>(
      '/tools/invoke',
      request
    );

    if (!response.data.ok) {
      throw new Error(response.data.error?.message || 'Tool invocation failed');
    }

    let result: unknown = response.data.result;
    if (result && typeof result === 'object' && 'content' in result) {
      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      if (Array.isArray(content) && content[0]?.type === 'text') {
        try {
          result = JSON.parse(content[0].text);
        } catch {
          result = content[0].text;
        }
      }
    }

    return result as T;
  }
}
