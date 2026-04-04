/**
 * Stratix OpenClaw Adapter - 模块入口
 * 
 * 导出所有类型、类和工厂函数
 */

import { ConnectionPool } from './ConnectionPool';
import { GatewayOpenClawAdapter } from './GatewayOpenClawAdapter';
import { LocalOpenClawAdapter } from './LocalOpenClawAdapter';
import { RemoteOpenClawAdapter } from './RemoteOpenClawAdapter';
import { WebSocketOpenClawAdapter } from './WebSocketOpenClawAdapter';
import type { OpenClawAdapterInterface } from './types';

import { StratixOpenClawConfig } from '@/stratix-core/stratix-protocol';

export type {
  OpenClawAdapterInterface,
  OpenClawAction,
  OpenClawResponse,
  OpenClawStatus,
  OpenClawEvent,
  OpenClawConnectionConfig,
  ChatOptions,
  ChatResponse,
  WebSocketMessage,
  WebSocketResponse,
  WebSocketEvent,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
} from './types';

export { LocalOpenClawAdapter } from './LocalOpenClawAdapter';
export { RemoteOpenClawAdapter } from './RemoteOpenClawAdapter';
export { GatewayOpenClawAdapter } from './GatewayOpenClawAdapter';
export { WebSocketOpenClawAdapter } from './WebSocketOpenClawAdapter';
export { ConnectionPool } from './ConnectionPool';
export type { ConnectionInfo, ConnectionPoolOptions, PoolStats, InvokeAllResult } from './ConnectionPool';

export function createOpenClawAdapter(config: StratixOpenClawConfig): OpenClawAdapterInterface {
  const isBrowser = typeof window !== 'undefined';
  if (isBrowser) {
    return new GatewayOpenClawAdapter(config);
  }
  
  const isLocal =
    config.endpoint.includes('localhost') || config.endpoint.includes('127.0.0.1');
  return isLocal
    ? new LocalOpenClawAdapter(config)
    : new RemoteOpenClawAdapter(config);
}

export function createWebSocketAdapter(config: StratixOpenClawConfig): WebSocketOpenClawAdapter {
  return new WebSocketOpenClawAdapter(config);
}

export function createConnectionPool(options?: import('./ConnectionPool').ConnectionPoolOptions): ConnectionPool {
  return new ConnectionPool(options);
}
