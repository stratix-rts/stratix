/**
 * OpenClawWebSocketConnection - OpenClaw WebSocket 连接类
 * 
 * 完整功能：
 * - WebSocket 连接管理
 * - Ed25519 设备签名认证
 * - 预共享 Token + 自动升级 Device Token
 * - 流式聊天消息（主要）
 * - 非流式聊天（辅助）
 * - 聊天历史查询
 */

import { deviceIdentityManager } from './DeviceIdentityManager';

// ============ 类型定义 ============

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'challenge'
  | 'pairing'
  | 'connected'
  | 'error';

export interface ConnectionResult {
  success: boolean;
  state: ConnectionState;
  message: string;
  deviceToken?: string;
  pairingRequestId?: string;
  latency?: number;
  errorCode?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatCallbacks {
  /** 流式文本回调 */
  onDelta?: (text: string) => void;
  /** 完成回调 */
  onFinal?: (message: ChatMessage) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
}

export interface SendMessageOptions {
  sessionId?: string;
  attachments?: Array<{ mimeType: string; content: string }>;
}

interface WSMessage {
  id?: string;
  type?: 'req' | 'res' | 'event' | 'error';
  method?: string;
  params?: Record<string, unknown>;
  ok?: boolean;
  payload?: any;
  error?: { message: string; code?: string | number };
  event?: string;
  result?: any;
  // 流式消息字段
  runId?: string;
  stream?: string;
  data?: { text?: string; delta?: string };
  sessionKey?: string;
  seq?: number;
  ts?: number;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ============ 常量 ============

const DEFAULT_TIMEOUT = 15000;
const CLIENT_ID = 'webchat';
const CLIENT_MODE = 'ui';
const CLIENT_VERSION = '1.0.0';
const CLIENT_PLATFORM = 'web';
const ROLE = 'operator';
const SCOPES = ['operator.read', 'operator.write', 'operator.admin', 'operator.approvals', 'operator.pairing'];

// ============ 主类 ============

export class OpenClawWebSocketConnection {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private stateListeners: Set<(state: ConnectionState) => void> = new Set();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestId = 0;
  private endpoint: string = '';
  
  // 聊天相关
  private currentChatCallbacks: ChatCallbacks | null = null;
  private currentChatText: string = '';
  private currentRunId: string | null = null;
  
  // 配对轮询
  private pairingCheckInterval: ReturnType<typeof setInterval> | null = null;
  private pairingRequestId: string | null = null;

  constructor() {}

  // ============ 公共方法：连接 ============

  /**
   * 使用预共享 Token 连接（支持自动升级 Device Token）
   */
  async connectWithPairing(endpoint: string, sharedToken: string): Promise<ConnectionResult> {
    this.endpoint = this.normalizeEndpoint(endpoint);

    const startTime = Date.now();

    try {
      const storedToken = deviceIdentityManager.getDeviceToken(this.endpoint);

      if (!storedToken && !sharedToken) {
        return {
          success: false,
          state: 'error',
          message: '请输入 Shared Token 或使用已有连接',
        };
      }

      this.setState('connecting');
      await this.createWebSocket(this.endpoint);

      // 尝试使用 device token
      if (storedToken) {
        console.log('[OpenClawWS] Trying with device token');
        const result = await this.performConnect(storedToken, true);
        result.latency = Date.now() - startTime;

        // 如果 device token 无效，清除并重试
        if (!result.success && (result.errorCode === 'INVALID_TOKEN' || result.errorCode === 'UNAUTHORIZED')) {
          console.log('[OpenClawWS] Device token invalid, retrying with shared token');
          deviceIdentityManager.clearDeviceToken(this.endpoint);
          this.ws?.close();
          await this.createWebSocket(this.endpoint);
          const retryResult = await this.performConnect(sharedToken, false);
          retryResult.latency = Date.now() - startTime;
          if (retryResult.success && retryResult.deviceToken) {
            await deviceIdentityManager.saveDeviceToken(this.endpoint, retryResult.deviceToken);
          }
          return retryResult;
        }

        if (result.success && result.deviceToken) {
          await deviceIdentityManager.saveDeviceToken(this.endpoint, result.deviceToken);
        }
        return result;
      }

      // 使用 shared token
      console.log('[OpenClawWS] Using shared token');
      const result = await this.performConnect(sharedToken, false);
      result.latency = Date.now() - startTime;

      if (result.success && result.deviceToken) {
        console.log('[OpenClawWS] Device token upgraded and saved');
        await deviceIdentityManager.saveDeviceToken(this.endpoint, result.deviceToken);
      }

      return result;
    } catch (error) {
      this.setState('error');
      return {
        success: false,
        state: 'error',
        message: error instanceof Error ? error.message : '连接失败',
        latency: Date.now() - startTime,
      };
    }
  }

  /**
   * 使用 Tailscale 身份连接（无需 Token）
   */
  async connectWithTailscale(endpoint: string): Promise<ConnectionResult> {
    this.endpoint = this.normalizeEndpoint(endpoint);

    const startTime = Date.now();

    try {
      this.setState('connecting');
      await this.createWebSocket(this.endpoint);
      
      const result = await this.performConnect(null, false);
      result.latency = Date.now() - startTime;
      
      return result;
    } catch (error) {
      this.setState('error');
      return {
        success: false,
        state: 'error',
        message: error instanceof Error ? error.message : '连接失败',
        latency: Date.now() - startTime,
      };
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.stopPairingPolling();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
    this.currentChatCallbacks = null;
    this.currentRunId = null;
  }

  // ============ 公共方法：聊天（流式为主） ============

  /**
   * 发送聊天消息【流式响应 - 主要方法】
   * 
   * @param message 消息内容
   * @param callbacks 回调函数
   * @param options 选项
   * @returns runId
   * 
   * @example
   * ```typescript
   * await conn.sendMessage('你好', {
   *   onDelta: (text) => console.log('流式:', text),
   *   onFinal: (msg) => console.log('完成:', msg.content),
   *   onError: (err) => console.error('错误:', err),
   * });
   * ```
   */
  async sendMessage(
    message: string,
    callbacks?: ChatCallbacks,
    options?: SendMessageOptions
  ): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('未连接');
    }

    const sessionId = options?.sessionId || 'main';
    const runId = this.generateId();
    
    // 保存回调
    this.currentRunId = runId;
    this.currentChatText = '';
    this.currentChatCallbacks = callbacks || null;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('发送请求超时'));
      }, 30000);

      const tempHandler = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data);
          
          // 处理 chat.send 的响应
          if (msg.id && msg.id.startsWith('req_') && !msg.event) {
            clearTimeout(timeout);
            this.ws!.removeEventListener('message', tempHandler);
            
            if (msg.ok) {
              console.log('[OpenClawWS] chat.send success, runId:', runId);
              resolve(runId);
            } else {
              this.currentChatCallbacks = null;
              this.currentRunId = null;
              reject(new Error(msg.error?.message || '发送失败'));
            }
          }
        } catch {
          // Ignore
        }
      };

      this.ws!.addEventListener('message', tempHandler);

      const request: WSMessage = {
        id: `req_${++this.requestId}`,
        type: 'req',
        method: 'chat.send',
        params: {
          sessionKey: sessionId,
          message,
          deliver: false,
          idempotencyKey: runId,
          attachments: options?.attachments,
        },
      };

      console.log('[OpenClawWS] Sending chat message:', { sessionId, runId });
      this.ws!.send(JSON.stringify(request));
    });
  }

  /**
   * 发送聊天消息【非流式 - 辅助方法】
   * 等待完整响应后返回，适合不需要实时显示的场景
   * 
   * @param message 消息内容
   * @param options 选项
   * @returns 完整的聊天消息
   */
  async sendMessageSync(
    message: string,
    options?: SendMessageOptions
  ): Promise<ChatMessage> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('未连接');
    }

    const sessionId = options?.sessionId || 'main';
    const runId = this.generateId();

    return new Promise((resolve, reject) => {
      let accumulatedText = '';
      
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('请求超时'));
      }, 120000);

      const cleanup = () => {
        clearTimeout(timeout);
        this.ws!.removeEventListener('message', handler);
      };

      const handler = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data);
          
          // 处理发送失败
          if (msg.id?.startsWith('req_') && msg.ok === false) {
            cleanup();
            reject(new Error(msg.error?.message || '发送失败'));
            return;
          }
          
          // 格式2: { stream: 'assistant', data: { text, delta }, runId, ... }
          if (msg.stream === 'assistant' && msg.data) {
            // 检查 runId
            if (msg.runId && msg.runId !== runId) return;
            
            // 累积文本
            if (msg.data.text) {
              accumulatedText = msg.data.text;
            }
            
            // 检查是否结束（没有 delta 或者 stream 结束标记）
            // 注意：需要根据实际情况判断结束条件
            // 暂时先累积文本，等待超时或其他结束信号
            return;
          }
          
          // 格式1: { type: 'event', event: 'chat', payload: { state, ... } }
          if (msg.type === 'event' && msg.event === 'chat') {
            const payload = msg.payload;
            if (payload?.runId && payload.runId !== runId) return;
            
            switch (payload?.state) {
              case 'delta':
                const text = this.extractTextContent(payload.message);
                if (text) accumulatedText = text;
                break;
                
              case 'final':
                cleanup();
                resolve({
                  role: 'assistant',
                  content: this.extractTextContent(payload.message) || accumulatedText,
                  timestamp: Date.now(),
                });
                break;
                
              case 'error':
                cleanup();
                reject(new Error(payload.errorMessage || '聊天出错'));
                break;
                
              case 'aborted':
                cleanup();
                reject(new Error('聊天已中止'));
                break;
            }
          }
        } catch {
          // Ignore
        }
      };

      this.ws!.addEventListener('message', handler);

      const request: WSMessage = {
        id: `req_${++this.requestId}`,
        type: 'req',
        method: 'chat.send',
        params: {
          sessionKey: sessionId,
          message,
          deliver: false,
          idempotencyKey: runId,
          attachments: options?.attachments,
        },
      };

      this.ws!.send(JSON.stringify(request));
    });
  }

  /**
   * 中止当前聊天
   */
  async abortChat(sessionId?: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const requestId = `req_${++this.requestId}`;

    this.ws!.send(JSON.stringify({
      id: requestId,
      type: 'req',
      method: 'chat.abort',
      params: {
        sessionKey: sessionId || 'main',
        runId: this.currentRunId,
      },
    }));

    this.currentChatCallbacks = null;
    this.currentRunId = null;
    this.currentChatText = '';
  }

  /**
   * 获取聊天历史
   */
  async getChatHistory(sessionId?: string, limit = 50): Promise<ChatMessage[]> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('未连接');
    }

    return new Promise((resolve, reject) => {
      const requestId = `req_${++this.requestId}`;
      
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('请求超时'));
      }, 30000);

      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          const messages = result?.messages || [];
          resolve(messages.map((m: any) => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : this.extractTextContent(m.content),
            timestamp: m.timestamp || Date.now(),
          })));
        },
        reject,
        timeout,
      });

      this.ws!.send(JSON.stringify({
        id: requestId,
        type: 'req',
        method: 'chat.history',
        params: {
          sessionKey: sessionId || 'main',
          limit,
        },
      }));
    });
  }

  // ============ 公共方法：状态 ============

  getState(): ConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  onStateChange(callback: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  // ============ 配对相关 ============

  async checkPairingStatus(): Promise<ConnectionResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { success: false, state: 'error', message: '连接已断开' };
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, state: 'pairing', message: '等待管理员批准...' });
      }, 5000);

      const originalHandler = this.ws!.onmessage;
      this.ws!.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.payload?.type === 'hello-ok' || msg.result?.status === 'hello-ok') {
            clearTimeout(timeout);
            this.ws!.onmessage = originalHandler;
            this.setState('connected');
            const deviceToken = msg.payload?.auth?.deviceToken || msg.result?.auth?.deviceToken;
            if (deviceToken) {
              deviceIdentityManager.saveDeviceToken(this.endpoint, deviceToken).catch(console.error);
            }
            resolve({ success: true, state: 'connected', message: '配对成功', deviceToken });
          }
        } catch {
          // Ignore
        }
      };

      this.ws!.send(JSON.stringify({
        method: 'pairing.check',
        params: { requestId: this.pairingRequestId },
      }));
    });
  }

  startPairingPolling(callback: (result: ConnectionResult) => void, interval = 3000): void {
    this.stopPairingPolling();
    this.pairingCheckInterval = setInterval(async () => {
      const result = await this.checkPairingStatus();
      callback(result);
      if (result.success) this.stopPairingPolling();
    }, interval);
  }

  stopPairingPolling(): void {
    if (this.pairingCheckInterval) {
      clearInterval(this.pairingCheckInterval);
      this.pairingCheckInterval = null;
    }
  }

  // ============ 私有方法：WebSocket ============

  private async createWebSocket(endpoint: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(endpoint);

      const timeout = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          this.ws?.close();
          reject(new Error('连接超时'));
        }
      }, 10000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket 连接失败'));
      };

      this.ws.onclose = () => this.handleClose();
      this.ws.onmessage = (event) => this.handleMessage(event.data);
    });
  }

  // ============ 私有方法：认证 ============

  private async performConnect(token: string | null, useDeviceToken: boolean): Promise<ConnectionResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('认证超时')), DEFAULT_TIMEOUT);
      const originalHandler = this.ws!.onmessage;
      
      this.ws!.onmessage = async (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);
          
          if (msg.event === 'connect.challenge') {
            this.setState('challenge');
            const { nonce } = msg.payload || {};
            
            if (!nonce) {
              clearTimeout(timeout);
              reject(new Error('无效的 challenge'));
              return;
            }

            const deviceId = await deviceIdentityManager.getDeviceId();
            const publicKey = await deviceIdentityManager.getPublicKeyBase64();
            const signedAtMs = Date.now();

            const signature = await deviceIdentityManager.signChallenge({
              clientId: CLIENT_ID,
              clientMode: CLIENT_MODE,
              role: ROLE,
              scopes: SCOPES,
              signedAtMs,
              token,
              nonce,
            });

            const auth = token ? (useDeviceToken ? { deviceToken: token } : { token }) : undefined;

            this.ws!.send(JSON.stringify({
              type: 'req',
              id: 'connect-1',
              method: 'connect',
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                auth,
                role: ROLE,
                scopes: SCOPES,
                client: {
                  id: CLIENT_ID,
                  version: CLIENT_VERSION,
                  platform: CLIENT_PLATFORM,
                  mode: CLIENT_MODE,
                },
                device: {
                  id: deviceId,
                  publicKey,
                  signature,
                  signedAt: signedAtMs,
                  nonce,
                },
                locale: 'zh-CN',
                userAgent: 'stratix-web/1.0.0',
              },
            }));
            return;
          }

          if (msg.ok === true) {
            const payloadType = msg.payload?.type;
            const resultStatus = msg.result?.status;
            
            if (payloadType === 'hello-ok' || resultStatus === 'hello-ok') {
              clearTimeout(timeout);
              this.ws!.onmessage = originalHandler;
              this.setState('connected');
              const deviceToken = msg.payload?.auth?.deviceToken || msg.result?.auth?.deviceToken;
              resolve({ success: true, state: 'connected', message: '连接成功', deviceToken });
              return;
            }
            
            if (payloadType === 'pairing-required' || resultStatus === 'pairing-required') {
              clearTimeout(timeout);
              this.ws!.onmessage = originalHandler;
              this.setState('pairing');
              this.pairingRequestId = msg.payload?.requestId || msg.result?.requestId || null;
              resolve({
                success: false,
                state: 'pairing',
                message: '等待管理员批准',
                pairingRequestId: this.pairingRequestId || undefined,
              });
              return;
            }
          }

          if (msg.error || msg.type === 'error') {
            clearTimeout(timeout);
            this.ws!.onmessage = originalHandler;
            this.setState('error');
            resolve({
              success: false,
              state: 'error',
              message: msg.error?.message || '认证失败',
              errorCode: String(msg.error?.code || 'UNKNOWN_ERROR'),
            });
          }
        } catch (e) {
          clearTimeout(timeout);
          this.ws!.onmessage = originalHandler;
          reject(e);
        }
      };
    });
  }

  // ============ 私有方法：消息处理 ============

  private handleMessage(data: string): void {
    try {
      const msg: WSMessage = JSON.parse(data);

      // 处理请求响应
      if (msg.id && this.pendingRequests.has(msg.id)) {
        const pending = this.pendingRequests.get(msg.id)!;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msg.id);
        msg.ok ? pending.resolve(msg.payload || msg.result) : pending.reject(new Error(msg.error?.message || '请求失败'));
        return;
      }

      // 处理事件
      // 格式1: { type: 'event', event: 'chat', ... }
      // 格式2: { stream: 'assistant', data: {...}, ... }
      if (msg.type === 'event' || msg.stream === 'assistant') {
        this.handleEvent(msg);
      }
    } catch {
      // Ignore
    }
  }

  private handleEvent(msg: WSMessage): void {
    // 处理 chat 事件
    // 格式1: { type: 'event', event: 'chat', payload: {...} }
    // 格式2: { stream: 'assistant', data: {...}, runId: '...', ... }
    if (msg.event === 'chat' || msg.stream === 'assistant') {
      this.handleChatEvent(msg);
    }
  }

  private handleChatEvent(msg: WSMessage): void {
    if (!this.currentChatCallbacks) return;
    
    // 检查 runId
    if (msg.runId && this.currentRunId && msg.runId !== this.currentRunId) return;

    // 格式2: { stream: 'assistant', data: { text, delta }, runId, ... }
    if (msg.stream === 'assistant' && msg.data) {
      const data = msg.data as { text?: string; delta?: string };
      
      console.log('[OpenClawWS] Received stream message:', {
        text: data.text?.slice(-50),
        delta: data.delta,
        runId: msg.runId,
      });
      
      // 流式文本（text 是累积的完整文本）
      if (data.text) {
        this.currentChatText = data.text;
        this.currentChatCallbacks.onDelta?.(data.text);
      }
      return;
    }

    // 格式1: { event: 'chat', payload: { state, message, ... } }
    const payload = msg.payload;
    if (!payload) return;
    
    console.log('[OpenClawWS] Received chat event:', payload.state, 'message:', JSON.stringify(payload.message).slice(0, 500));

    switch (payload.state) {
      case 'delta':
        const text = this.extractTextContent(payload.message);
        console.log('[OpenClawWS] delta text:', text?.slice(-100), 'raw message type:', typeof payload.message);
        if (text) {
          this.currentChatText = text;
          this.currentChatCallbacks.onDelta?.(text);
        }
        break;

      case 'final':
        const finalText = this.extractTextContent(payload.message) || this.currentChatText;
        console.log('[OpenClawWS] final text:', finalText?.slice(-100), 'raw message type:', typeof payload.message);
        this.currentChatCallbacks.onFinal?.({
          role: 'assistant',
          content: finalText,
          timestamp: Date.now(),
        });
        this.cleanupChat();
        break;

      case 'error':
        this.currentChatCallbacks.onError?.(payload.errorMessage || '聊天出错');
        this.cleanupChat();
        break;

      case 'aborted':
        this.currentChatCallbacks.onError?.('聊天已中止');
        this.cleanupChat();
        break;
    }
  }

  private cleanupChat(): void {
    this.currentChatCallbacks = null;
    this.currentRunId = null;
    this.currentChatText = '';
  }

  private handleClose(): void {
    this.setState('disconnected');
    this.stopPairingPolling();
    this.pendingRequests.forEach((p) => {
      clearTimeout(p.timeout);
      p.reject(new Error('连接已断开'));
    });
    this.pendingRequests.clear();
    this.currentChatCallbacks?.onError?.('连接已断开');
    this.cleanupChat();
  }

  // ============ 私有方法：工具 ============

  private setState(state: ConnectionState): void {
    this.state = state;
    this.stateListeners.forEach((l) => { try { l(state); } catch {} });
  }

  private normalizeEndpoint(endpoint: string): string {
    let url = endpoint.trim();
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = url.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
    }
    url = url.replace(/\/+$/, '');
    if (!url.endsWith('/ws')) url += '/ws';
    return url;
  }

  private generateId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private extractTextContent(content: any): string {
    if (!content) return '';
    
    // 字符串
    if (typeof content === 'string') return content;
    
    // 数组：[{type: 'text', text: '...'}]
    if (Array.isArray(content)) {
      return content
        .filter((c): c is { type: string; text: string } => c?.type === 'text' && typeof c.text === 'string')
        .map(c => c.text)
        .join('');
    }
    
    // 对象
    if (typeof content === 'object') {
      // 格式：{ role: 'assistant', content: [{type: 'text', text: '...'}], timestamp: ... }
      if (content.content) {
        return this.extractTextContent(content.content);
      }
      
      // 其他可能的字段
      if (typeof content.text === 'string') return content.text;
      if (typeof content.delta === 'string') return content.delta;
      
      // 递归检查
      if (content.message) return this.extractTextContent(content.message);
      if (content.data) return this.extractTextContent(content.data);
    }
    
    return '';
  }
}

export default OpenClawWebSocketConnection;
