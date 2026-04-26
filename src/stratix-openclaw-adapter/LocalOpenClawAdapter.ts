import axios, { AxiosInstance } from 'axios';

import { StratixOpenClawConfig } from '@/stratix-core/stratix-protocol';

import type {
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


const isBrowser = typeof window !== 'undefined';
const BrowserWebSocket = isBrowser ? window.WebSocket : null;

const PROTOCOL_VERSION = 3;

interface ConnectChallenge {
  nonce: string;
  ts: number;
}

interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    version: string;
    platform?: string;
    mode: string;
    displayName?: string;
  };
  role: 'operator' | 'node';
  scopes?: string[];
  auth?: { token?: string; password?: string };
}

interface ToolsInvokeRequest {
  tool: string;
  action?: string;
  args?: Record<string, unknown>;
  sessionKey?: string;
  dryRun?: boolean;
}

interface ToolsInvokeResponse {
  ok: boolean;
  result?: unknown;
  error?: { type: string; message: string };
}

export class LocalOpenClawAdapter implements OpenClawAdapterInterface {
  private config: StratixOpenClawConfig;
  private subscribers: ((event: OpenClawEvent) => void)[] = [];
  private http: AxiosInstance;
  private requestId = 0;
  private pendingRequests: Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  > = new Map();
  private isConnectedFlag = false;

  constructor(config: StratixOpenClawConfig) {
    this.config = config;
    this.http = axios.create({
      baseURL: config.endpoint,
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
      },
    });
  }

  public async connect(): Promise<void> {
    const status = await this.getStatus();
    if (!status.connected) {
      throw new Error(`Failed to connect: ${status.error || 'Gateway not responding'}`);
    }
    this.isConnectedFlag = true;
  }

  public async disconnect(): Promise<void> {
    this.isConnectedFlag = false;
    this.pendingRequests.clear();
  }

  public async getStatus(): Promise<OpenClawStatus> {
    try {
      const response = await this.http.get('/');
      return {
        connected: true,
        accountId: this.config.accountId,
        lastActive: Date.now(),
      };
    } catch (error) {
      return {
        connected: false,
        accountId: this.config.accountId,
        lastActive: 0,
        error: this.formatError(error),
      };
    }
  }

  public subscribe(callback: (event: OpenClawEvent) => void): void {
    this.subscribers.push(callback);
  }

  public async invokeTool<T = unknown>(
    tool: string,
    args?: Record<string, unknown>,
    options?: { sessionKey?: string; action?: string }
  ): Promise<T> {
    const request: ToolsInvokeRequest = {
      tool,
      args: args || {},
      sessionKey: options?.sessionKey,
      action: options?.action,
    };

    const response = await this.http.post('/tools/invoke', request);

    if (!response.data.ok) {
      throw new Error(response.data.error?.message || 'Tool invocation failed');
    }

    let result = response.data.result;
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

  public async execute(action: OpenClawAction): Promise<OpenClawResponse> {
    try {
      const result = await this.invokeTool(action.method, action.params as Record<string, unknown>);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  public async sendMessage(message: string, options?: ChatOptions): Promise<ChatResponse> {
    const headers: Record<string, string> = {};
    if (options?.agentId) {
      headers['x-openclaw-agent-id'] = options.agentId;
    }

    const response = await this.http.post<OpenAIChatCompletionResponse>(
      '/v1/chat/completions',
      {
        model: options?.agentId ? `openclaw:${options.agentId}` : 'openclaw',
        messages: [{ role: 'user', content: message }],
        user: options?.sessionId,
      },
      { headers }
    );

    return {
      messageId: response.data.id,
      content: response.data.choices[0]?.message?.content || '',
      role: 'assistant',
      sessionId: options?.sessionId,
      done: true,
    };
  }

  public async openaiChatCompletion(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse> {
    const headers: Record<string, string> = {};
    if (request.model?.startsWith('openclaw:') || request.model?.startsWith('agent:')) {
      const agentId = request.model.split(':')[1];
      if (agentId) {
        headers['x-openclaw-agent-id'] = agentId;
      }
    }

    const response = await this.http.post<OpenAIChatCompletionResponse>(
      '/v1/chat/completions',
      request,
      { headers }
    );
    return response.data;
  }

  public async streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: string) => void,
    options?: { agentId?: string }
  ): Promise<void> {
    const headers: Record<string, string> = {};
    if (options?.agentId) {
      headers['x-openclaw-agent-id'] = options.agentId;
    }

    const response = await this.http.post(
      '/v1/chat/completions',
      { ...request, stream: true },
      { responseType: 'stream', headers }
    );

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              resolve();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                onChunk(content);
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      });

      response.data.on('end', resolve);
      response.data.on('error', reject);
    });
  }

  public async listSessions(): Promise<unknown[]> {
    return this.invokeTool<unknown[]>('sessions_list');
  }

  public async listAgents(): Promise<unknown[]> {
    return this.invokeTool<unknown[]>('agents_list');
  }

  public async listModels(): Promise<unknown[]> {
    return this.invokeTool<unknown[]>('models_list');
  }

  private formatError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data;
      if (data?.error?.message) return data.error.message;
      if (data?.message) return data.message;
      return error.message;
    }
    return (error as Error).message;
  }

  public isConnected(): boolean {
    return this.isConnectedFlag;
  }
}
