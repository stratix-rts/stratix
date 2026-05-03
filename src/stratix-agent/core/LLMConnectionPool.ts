import { LLMConfig } from '../types';

import { LLMConnector } from './LLMConnector';

/** Maximum connectors to retain per key in the pool */
const DEFAULT_MAX_POOL_SIZE = 5;

export class LLMConnectionPool {
  private pool: Map<string, LLMConnector[]> = new Map();
  private configPool: Map<string, LLMConfig> = new Map();
  private maxPoolSize: number;

  constructor(maxPoolSize: number = DEFAULT_MAX_POOL_SIZE) {
    this.maxPoolSize = maxPoolSize;
  }

  registerConfig(key: string, config: LLMConfig): void {
    this.configPool.set(key, config);
  }

  getConnector(key: string = 'default'): LLMConnector {
    if (!this.pool.has(key)) {
      const config = this.configPool.get(key);
      if (!config) {
        throw new Error(`No config registered for key: ${key}`);
      }
      this.pool.set(key, []);
    }

    const connectors = this.pool.get(key)!;
    
    if (connectors.length > 0) {
      return connectors.pop()!;
    }

    const config = this.configPool.get(key)!;
    return new LLMConnector(config);
  }

  releaseConnector(key: string, connector: LLMConnector): void {
    if (!this.pool.has(key)) {
      this.pool.set(key, []);
    }
    const connectors = this.pool.get(key)!;
    if (connectors.length < this.maxPoolSize) {
      connectors.push(connector);
    }
  }

  clear(key?: string): void {
    if (key) {
      this.pool.delete(key);
      this.configPool.delete(key);
    } else {
      this.pool.clear();
      this.configPool.clear();
    }
  }

  /**
   * Dispose all pooled connectors and clear configuration state.
   */
  dispose(): void {
    this.pool.clear();
    this.configPool.clear();
  }

  size(key: string): number {
    return this.pool.get(key)?.length || 0;
  }
}
