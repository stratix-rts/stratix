import { StratixAgent } from '../StratixAgent';
import { AgentConfig, SoulConfig, AgentResponse } from '../types';

import { LLMConnectionPool } from './LLMConnectionPool';
import { SharedMemoryCache } from './SharedMemoryCache';
import { StorageManager } from './StorageManager';

export interface ManagerOptions {
  maxAgents?: number;
  enableSharedCache?: boolean;
}

export class StratixAgentManager {
  private agents: Map<string, StratixAgent> = new Map();
  private storage: StorageManager;
  private sharedCache: SharedMemoryCache;
  private llmPool: LLMConnectionPool;
  private maxAgents: number;

  constructor(options: ManagerOptions = {}) {
    this.maxAgents = options.maxAgents || 10;
    this.storage = new StorageManager();
    this.sharedCache = options.enableSharedCache !== false 
      ? new SharedMemoryCache() 
      : new SharedMemoryCache(0);
    this.llmPool = new LLMConnectionPool();
  }

  async createAgent(config: AgentConfig, soul: SoulConfig): Promise<StratixAgent> {
    if (this.agents.size >= this.maxAgents) {
      throw new Error(`Maximum number of agents (${this.maxAgents}) reached`);
    }

    if (this.agents.has(config.agentId)) {
      throw new Error(`Agent ${config.agentId} already exists`);
    }

    const agent = new StratixAgent(config, soul);
    await agent.initialize();
    this.agents.set(config.agentId, agent);

    return agent;
  }

  async removeAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      await agent.dispose();
      this.agents.delete(agentId);
    }
  }

  getAgent(agentId: string): StratixAgent | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): StratixAgent[] {
    return Array.from(this.agents.values());
  }

  async listAgents(): Promise<{ agentId: string; name: string; status: string }[]> {
    const agents = await this.storage.listAgents();
    const result: { agentId: string; name: string; status: string }[] = [];

    for (const agentId of agents) {
      const config = await this.storage.loadConfig(agentId);
      const agent = this.agents.get(agentId);
      result.push({
        agentId,
        name: config?.name || agentId,
        status: agent ? 'active' : 'inactive',
      });
    }

    return result;
  }

  async loadAgent(agentId: string): Promise<StratixAgent | null> {
    if (this.agents.has(agentId)) {
      return this.agents.get(agentId)!;
    }

    const config = await this.storage.loadConfig(agentId);
    if (!config) {
      return null;
    }

    const soul = await this.storage.loadSoul(agentId);
    if (!soul) {
      return null;
    }

    return this.createAgent(config, soul);
  }

  getSharedCache(): SharedMemoryCache {
    return this.sharedCache;
  }

  async dispose(): Promise<void> {
    const agents = Array.from(this.agents.values());
    for (const agent of agents) {
      await agent.dispose();
    }
    this.agents.clear();
    this.sharedCache.clear();
  }

  getAgentCount(): number {
    return this.agents.size;
  }
}
