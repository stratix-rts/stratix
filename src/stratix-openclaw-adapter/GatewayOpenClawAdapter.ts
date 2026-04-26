import axios, { AxiosInstance } from 'axios';

import type { StratixOpenClawConfig } from '@/stratix-core/stratix-protocol';

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


interface WSMessage {
  type: string;
  message?: string;
  content?: string;
  requestId?: string;
  error?: string;
  event?: string;
  payload?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class GatewayOpenClawAdapter implements OpenClawAdapterInterface {
  private config: StratixOpenClawConfig;
  private gatewayHttp: AxiosInstance;
  private endpoint: string;
  private apiKey?: string;
  private proxyKey: string;
  private subscribers: ((event: OpenClawEvent) => void)[] = [];
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private connectPromise: Promise<void> | null = null;
  private lastConnectFail = 0;
  private readonly COOLDOWN = 3000;
  private readonly MAX_RETRY = 2;
  private requestId = 0;
  private pendingRequests = new Map<string, PendingRequest>();

  constructor(config: StratixOpenClawConfig) {
    this.config = config;
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.proxyKey = this.computeProxyKey(this.endpoint);
    
    this.gatewayHttp = axios.create({
      baseURL: '/api/stratix/openclaw',
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  private computeProxyKey(endpoint: string): string {
    return endpoint.replace(/[^a-zA-Z0-9]/g, '_');
  }

  private getWebSocketUrl(): string {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${window.location.host}/api/stratix/openclaw/proxy/${this.proxyKey}/ws?clientId=${this.config.accountId}`;
  }

  private async ensureWSConnection(): Promise<boolean> {
    if (this.ws && this.wsConnected && this.ws.readyState === WebSocket.OPEN) {
      return true;
    }

    return new Promise((resolve) => {
      try {
        const url = this.getWebSocketUrl();
        console.log('[GatewayAdapter] Connecting WS to:', url);
        this.ws = new WebSocket(url);

        const timeout = setTimeout(() => {
          if (this.ws?.readyState !== WebSocket.OPEN) {
            console.log('[GatewayAdapter] WS connection timeout');
            this.ws?.close();
            resolve(false);
          }
        }, 10000);

        this.ws.onopen = () => {
          clearTimeout(timeout);
          this.wsConnected = true;
          console.log('[GatewayAdapter] WS connected');
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as WSMessage;
            this.handleWSMessage(data);
          } catch (e) {
            console.error('[GatewayAdapter] Failed to parse WS message:', e);
          }
        };

        this.ws.onerror = (error) => {
          clearTimeout(timeout);
          console.error('[GatewayAdapter] WS error:', error);
          this.wsConnected = false;
          resolve(false);
        };

        this.ws.onclose = () => {
          clearTimeout(timeout);
          this.wsConnected = false;
          console.log('[GatewayAdapter] WS closed');
        };
      } catch (e) {
        console.error('[GatewayAdapter] WS connection failed:', e);
        resolve(false);
      }
    });
  }

  private handleWSMessage(data: WSMessage): void {
    if (data.type === 'response' || data.type === 'text') {
      const requestId = data.requestId;
      if (requestId && this.pendingRequests.has(requestId)) {
        const pending = this.pendingRequests.get(requestId)!;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);

        if (data.error) {
          pending.reject(new Error(data.error));
        } else {
          pending.resolve(data.message || data.content || '');
        }
      }
    } else if (data.type === 'event') {
      this.notifySubscribers({
        type: data.event || 'unknown',
        data: data.payload,
      });
    } else if (data.type === 'error') {
      console.error('[GatewayAdapter] WS error message:', data.error);
    }
  }

  private async sendWSMessage(message: WSMessage, timeout = 30000): Promise<unknown> {
    const connected = await this.ensureWSConnection();
    if (!connected) {
      throw new Error('WebSocket not connected');
    }

    const requestId = `req_${++this.requestId}_${Date.now()}`;
    message.requestId = requestId;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, timeout);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutId,
      });

      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        reject(new Error('WebSocket not connected'));
        return;
      }
      ws.send(JSON.stringify(message));
    });
  }

  private async registerProxy(): Promise<void> {
    const response = await this.gatewayHttp.post('/connect', {
      endpoint: this.endpoint,
      apiKey: this.apiKey,
    });

    if (response.data.code !== 200) {
      throw new Error(response.data.message || 'Failed to connect via gateway');
    }
  }

  private async reconnect(): Promise<void> {
    const now = Date.now();
    if (now - this.lastConnectFail < this.COOLDOWN) {
      throw new Error('Reconnect cooldown, please wait');
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.doReconnect()
      .catch(e => {
        this.lastConnectFail = Date.now();
        throw e;
      })
      .finally(() => {
        this.connectPromise = null;
      });

    return this.connectPromise;
  }

  private async doReconnect(): Promise<void> {
    await this.registerProxy();
    const wsOk = await this.ensureWSConnection();
    if (!wsOk) {
      console.warn('[GatewayAdapter] WS connection failed, falling back to HTTP');
    }
  }

  private isProxyNotFound(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;
      if (status === 404) return true;
      if (data?.message?.includes('not found')) return true;
    }
    return false;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.MAX_RETRY; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.MAX_RETRY && this.isProxyNotFound(error)) {
          await this.reconnect();
        } else {
          throw error;
        }
      }
    }
    throw lastError;
  }

  public async connect(): Promise<void> {
    await this.reconnect();
  }

  public async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.wsConnected = false;
    }
    
    this.pendingRequests.forEach(pending => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Disconnected'));
    });
    this.pendingRequests.clear();
    
    try {
      await this.gatewayHttp.post('/disconnect', {
        endpoint: this.endpoint,
      });
    } catch {
      // ignore
    }
  }

  public async getStatus(): Promise<OpenClawStatus> {
    try {
      const response = await this.gatewayHttp.get('/test', {
        params: {
          endpoint: this.endpoint,
          apiKey: this.apiKey,
        },
      });

      if (response.data.code === 200 && response.data.data?.connected) {
        return {
          connected: true,
          accountId: this.config.accountId,
          lastActive: Date.now(),
        };
      }

      return {
        connected: false,
        accountId: this.config.accountId,
        lastActive: 0,
        error: response.data.message || 'Connection failed',
      };
    } catch (error) {
      return {
        connected: false,
        accountId: this.config.accountId,
        lastActive: 0,
        error: (error as Error).message,
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

  private notifySubscribers(event: OpenClawEvent): void {
    this.subscribers.forEach(cb => {
      try {
        cb(event);
      } catch (e) {
        console.error('[GatewayAdapter] Subscriber error:', e);
      }
    });
  }

  public async execute(action: OpenClawAction): Promise<OpenClawResponse> {
    try {
      const result = await this.sendWSMessage({
        type: 'tool',
        message: action.method,
        payload: action.params,
      });
      return { success: true, data: result };
    } catch {
      return this.withRetry(async () => {
        const response = await this.gatewayHttp.post(
          `/proxy/${this.proxyKey}/tools/invoke`,
          { tool: action.method, args: action.params }
        );
        if (response.data.ok) {
          return { success: true, data: response.data.result };
        }
        return { success: false, error: response.data.error?.message || 'Tool invocation failed' };
      });
    }
  }

  public async invokeTool<T = unknown>(
    tool: string,
    args?: Record<string, unknown>,
    options?: { sessionKey?: string; action?: string }
  ): Promise<T> {
    try {
      const result = await this.sendWSMessage({
        type: 'tool',
        message: tool,
        payload: { args, sessionKey: options?.sessionKey, action: options?.action },
      });
      return result as T;
    } catch {
      return this.withRetry(async () => {
        const response = await this.gatewayHttp.post(
          `/proxy/${this.proxyKey}/tools/invoke`,
          { tool, args: args || {}, sessionKey: options?.sessionKey, action: options?.action }
        );
        if (!response.data.ok) {
          throw new Error(response.data.error?.message || 'Tool invocation failed');
        }
        return response.data.result as T;
      });
    }
  }

  public async sendMessage(message: string, options?: ChatOptions): Promise<ChatResponse> {
    try {
      const result = await this.sendWSMessage({
        type: 'text',
        message,
        payload: { sessionId: options?.sessionId, agentId: options?.agentId },
      }) as string;

      return {
        messageId: `ws_${Date.now()}`,
        content: result,
        role: 'assistant',
        sessionId: options?.sessionId,
        done: true,
      };
    } catch {
      return this.withRetry(async () => {
        const headers: Record<string, string> = {};
        if (options?.agentId) {
          headers['x-openclaw-agent-id'] = options.agentId;
        }

        const response = await this.gatewayHttp.post<OpenAIChatCompletionResponse>(
          `/proxy/${this.proxyKey}/v1/chat/completions`,
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
      });
    }
  }

  public async openaiChatCompletion(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse> {
    return this.withRetry(async () => {
      const headers: Record<string, string> = {};
      if (request.model?.startsWith('openclaw:') || request.model?.startsWith('agent:')) {
        const agentId = request.model.split(':')[1];
        if (agentId) {
          headers['x-openclaw-agent-id'] = agentId;
        }
      }

      const response = await this.gatewayHttp.post<OpenAIChatCompletionResponse>(
        `/proxy/${this.proxyKey}/v1/chat/completions`,
        request,
        { headers }
      );

      return response.data;
    });
  }

  public async streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: string) => void,
    options?: { agentId?: string }
  ): Promise<void> {
    return this.withRetry(async () => {
      const headers: Record<string, string> = {};
      if (options?.agentId) {
        headers['x-openclaw-agent-id'] = options.agentId;
      }

      const response = await this.gatewayHttp.post(
        `/proxy/${this.proxyKey}/v1/chat/completions`,
        { ...request, stream: true },
        { responseType: 'stream', headers }
      );

      return new Promise<void>((resolve, reject) => {
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
                // ignore
              }
            }
          }
        });

        response.data.on('end', resolve);
        response.data.on('error', reject);
      });
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

  public isConnected(): boolean {
    return this.wsConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}

export default GatewayOpenClawAdapter;
