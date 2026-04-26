/**
 * WebSocketOpenClawAdapter - WebSocket 直连 OpenClaw Gateway
 * 
 * 支持完整的设备认证流程：
 * 1. 生成/加载 RSA 密钥对
 * 2. 派生 device.id（公钥 SHA256 前16位）
 * 3. WebSocket 连接 OpenClaw
 * 4. 处理 connect.challenge 签名
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import WebSocket from 'ws';

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


const CLIENT_VERSION = '1.0.0';
const DEVICE_KEY_FILE = '.stratix/device_key.json';

interface DeviceKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
  deviceId: string;
}

interface WSMessage {
  type: 'req' | 'res' | 'event' | 'error';
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
  ok?: boolean;
  payload?: unknown;
  error?: { message: string; code?: number };
  event?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class WebSocketOpenClawAdapter implements OpenClawAdapterInterface {
  private config: StratixOpenClawConfig;
  private deviceKey: DeviceKeyPair | null = null;
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private wsHandshaked = false;
  private requestId = 0;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private subscribers: ((event: OpenClawEvent) => void)[] = [];
  private messageQueue: WSMessage[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: StratixOpenClawConfig) {
    this.config = config;
    this.loadOrCreateDeviceKey();
  }

  private getDeviceKeyPath(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(homeDir, DEVICE_KEY_FILE);
  }

  private loadOrCreateDeviceKey(): DeviceKeyPair {
    if (this.deviceKey) {
      return this.deviceKey;
    }

    const keyPath = this.getDeviceKeyPath();

    try {
      if (fs.existsSync(keyPath)) {
        const stored = JSON.parse(fs.readFileSync(keyPath, 'utf-8')) as DeviceKeyPair;
        if (stored.publicKeyPem && stored.privateKeyPem && stored.deviceId) {
          this.deviceKey = stored;
          console.log('[WebSocketAdapter] Loaded device key:', stored.deviceId);
          return stored;
        }
      }
    } catch (e) {
      console.warn('[WebSocketAdapter] Failed to load device key:', e);
    }

    const keyPathDir = path.dirname(keyPath);
    if (!fs.existsSync(keyPathDir)) {
      fs.mkdirSync(keyPathDir, { recursive: true });
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const pubKeyHash = crypto
      .createHash('sha256')
      .update(publicKey)
      .digest('hex')
      .slice(0, 16);
    const deviceId = `device_${pubKeyHash}`;

    this.deviceKey = {
      publicKeyPem: publicKey,
      privateKeyPem: privateKey,
      deviceId,
    };

    fs.writeFileSync(keyPath, JSON.stringify(this.deviceKey, null, 2));
    console.log('[WebSocketAdapter] Generated new device key:', deviceId);

    return this.deviceKey;
  }

  private signChallenge(nonce: string): string {
    if (!this.deviceKey) {
      throw new Error('Device key not loaded');
    }

    const sign = crypto.createSign('SHA256');
    sign.update(nonce);
    return sign.sign(this.deviceKey.privateKeyPem, 'base64');
  }

  private getWebSocketUrl(): string {
    const endpoint = this.config.endpoint.replace(/^http/, 'ws');
    return `${endpoint}/ws`;
  }

  async connect(): Promise<void> {
    await this.ensureWebSocket();
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.wsConnected = false;
    this.wsHandshaked = false;

    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Disconnected'));
    });
    this.pendingRequests.clear();
    this.messageQueue = [];
  }

  private async ensureWebSocket(): Promise<boolean> {
    if (this.ws && this.wsHandshaked && this.ws.readyState === WebSocket.OPEN) {
      return true;
    }

    if (!this.deviceKey) {
      this.loadOrCreateDeviceKey();
    }

    return new Promise((resolve) => {
      const url = this.getWebSocketUrl();
      console.log('[WebSocketAdapter] Connecting to:', url);

      const timeout = setTimeout(() => {
        if (!this.wsHandshaked) {
          console.log('[WebSocketAdapter] Connection timeout');
          this.ws?.close();
          resolve(false);
        }
      }, 15000);

      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('[WebSocketAdapter] Socket opened, waiting for challenge...');
          this.wsConnected = true;
        };

        this.ws.onmessage = (event) => {
          this.handleWebSocketMessage(event.toString(), timeout, resolve);
        };

        this.ws.onerror = (error) => {
          clearTimeout(timeout);
          console.error('[WebSocketAdapter] WebSocket error:', error);
          this.wsConnected = false;
          this.wsHandshaked = false;
          resolve(false);
        };

        this.ws.onclose = () => {
          clearTimeout(timeout);
          this.wsConnected = false;
          this.wsHandshaked = false;
          console.log('[WebSocketAdapter] WebSocket closed');
          this.scheduleReconnect();
        };
      } catch (e) {
        clearTimeout(timeout);
        console.error('[WebSocketAdapter] Failed to create WebSocket:', e);
        resolve(false);
      }
    });
  }

  private handleWebSocketMessage(
    data: string,
    handshakeTimeout: ReturnType<typeof setTimeout>,
    handshakeResolve: (value: boolean) => void
  ): void {
    try {
      const msg = JSON.parse(data) as WSMessage;
      console.log('[WebSocketAdapter] Received:', msg.type, msg.event || msg.method || '');

      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        this.handleChallenge(msg, handshakeTimeout, handshakeResolve);
      } else if (msg.type === 'res' && this.isHandshakeResponse(msg)) {
        this.handleHandshakeResponse(msg, handshakeTimeout, handshakeResolve);
      } else {
        this.handleRegularMessage(msg);
      }
    } catch (e) {
      console.error('[WebSocketAdapter] Failed to parse message:', e);
    }
  }

  private isHandshakeResponse(msg: WSMessage): boolean {
    const payload = msg.payload as { type?: string } | undefined;
    return msg.ok === true && payload?.type === 'hello-ok';
  }

  private handleChallenge(
    msg: WSMessage,
    timeout: ReturnType<typeof setTimeout>,
    resolve: (value: boolean) => void
  ): void {
    if (!this.deviceKey || !this.ws) {
      resolve(false);
      return;
    }

    const nonce = (msg.params as { nonce?: string })?.nonce || '';

    const signature = this.signChallenge(nonce);

    const connectReq: WSMessage = {
      type: 'req',
      id: `req_${Date.now()}`,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'cli',
          version: CLIENT_VERSION,
          platform: process.platform,
          mode: 'cli',
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        caps: [],
        commands: [],
        permissions: {},
        auth: { token: this.config.apiKey || '' },
        locale: 'zh-CN',
        userAgent: 'Stratix-rts/1.0.0',
        device: {
          id: this.deviceKey.deviceId,
          publicKey: this.deviceKey.publicKeyPem,
          signature,
          signedAt: Date.now(),
          nonce,
        },
      },
    };

    console.log('[WebSocketAdapter] Sending connect request with deviceId:', this.deviceKey.deviceId);
    this.ws.send(JSON.stringify(connectReq));
  }

  private handleHandshakeResponse(
    msg: WSMessage,
    timeout: ReturnType<typeof setTimeout>,
    resolve: (value: boolean) => void
  ): void {
    clearTimeout(timeout);
    this.wsHandshaked = true;
    console.log('[WebSocketAdapter] Handshake successful');
    this.flushMessageQueue();
    resolve(true);
  }

  private handleRegularMessage(msg: WSMessage): void {
    if (msg.type === 'res' && msg.id && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(msg.id);

      if (!msg.ok && msg.error) {
        pending.reject(new Error(msg.error.message || 'Unknown error'));
      } else if (msg.ok) {
        pending.resolve(msg.payload);
      }
    } else if (msg.type === 'event') {
      this.notifySubscribers({
        type: msg.event || 'unknown',
        data: msg.payload,
      });
    } else if (msg.type === 'error') {
      console.error('[WebSocketAdapter] Error message:', msg.error);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('[WebSocketAdapter] Attempting to reconnect...');
      this.ensureWebSocket().catch((e) => {
        console.error('[WebSocketAdapter] Reconnect failed:', e);
      });
    }, 5000);
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.messageQueue.shift()!;
      this.ws.send(JSON.stringify(msg));
    }
  }

  private async sendRequest<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30000
  ): Promise<T> {
    const connected = await this.ensureWebSocket();
    if (!connected) {
      throw new Error('WebSocket not connected');
    }

    const id = `req_${++this.requestId}_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });

      const msg: WSMessage = {
        type: 'req',
        id,
        method,
        params,
      };

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      } else {
        this.messageQueue.push(msg);
      }
    });
  }

  async getStatus(): Promise<OpenClawStatus> {
    const connected = this.wsHandshaked && this.ws?.readyState === WebSocket.OPEN;
    return {
      connected,
      accountId: this.config.accountId,
      lastActive: connected ? Date.now() : 0,
      version: connected ? 'ws-connected' : undefined,
      error: connected ? undefined : 'Not connected',
    };
  }

  subscribe(callback: (event: OpenClawEvent) => void): void {
    this.subscribers.push(callback);
  }

  unsubscribe(callback: (event: OpenClawEvent) => void): void {
    const index = this.subscribers.indexOf(callback);
    if (index !== -1) {
      this.subscribers.splice(index, 1);
    }
  }

  private notifySubscribers(event: OpenClawEvent): void {
    this.subscribers.forEach((cb) => {
      try {
        cb(event);
      } catch (e) {
        console.error('[WebSocketAdapter] Subscriber error:', e);
      }
    });
  }

  async execute(action: OpenClawAction): Promise<OpenClawResponse> {
    try {
      const result = await this.sendRequest(action.method, action.params);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Execution failed',
      };
    }
  }

  async invokeTool<T = unknown>(
    tool: string,
    args?: Record<string, unknown>,
    options?: { sessionKey?: string; action?: string }
  ): Promise<T> {
    return this.sendRequest<T>('tools.invoke', {
      tool,
      args: args || {},
      sessionKey: options?.sessionKey,
      action: options?.action,
    });
  }

  async sendMessage(message: string, options?: ChatOptions): Promise<ChatResponse> {
    const result = await this.sendRequest<OpenAIChatCompletionResponse>(
      'v1.chat.completions',
      {
        model: options?.agentId ? `openclaw:${options.agentId}` : 'openclaw',
        messages: [{ role: 'user', content: message }],
        user: options?.sessionId,
      }
    );

    return {
      messageId: result.id,
      content: result.choices?.[0]?.message?.content || '',
      role: 'assistant',
      sessionId: options?.sessionId,
      done: true,
    };
  }

  async openaiChatCompletion(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse> {
    return this.sendRequest<OpenAIChatCompletionResponse>('v1.chat.completions', request as unknown as Record<string, unknown>);
  }

  async listAgents(): Promise<unknown[]> {
    return this.invokeTool<unknown[]>('agents_list');
  }

  async listSessions(): Promise<unknown[]> {
    return this.invokeTool<unknown[]>('sessions_list');
  }

  async listModels(): Promise<unknown[]> {
    return this.invokeTool<unknown[]>('models_list');
  }

  async streamChatCompletion(
    _request: OpenAIChatCompletionRequest,
    _onChunk: (chunk: string) => void,
    _options?: { agentId?: string }
  ): Promise<void> {
    throw new Error('WebSocket adapter does not support streaming');
  }

  isConnected(): boolean {
    return this.wsHandshaked && this.ws?.readyState === WebSocket.OPEN;
  }

  getDeviceId(): string | null {
    return this.deviceKey?.deviceId || null;
  }
}

export default WebSocketOpenClawAdapter;
