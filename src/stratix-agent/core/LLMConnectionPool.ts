import { LLMConnector } from './LLMConnector';
import { LLMConfig } from '../types';

export class LLMConnectionPool {
  private pool: Map<string, LLMConnector[]> = new Map();
  private configPool: Map<string, LLMConfig> = new Map();

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
    this.pool.get(key)!.push(connector);
  }

  clear(key?: string): void {
    if (key) {
      this.pool.delete(key);
    } else {
      this.pool.clear();
    }
  }

  size(key: string): number {
    return this.pool.get(key)?.length || 0;
  }
}
