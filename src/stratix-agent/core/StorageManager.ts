import { existsSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join as pathJoin } from 'path';

import { AgentConfig, SoulConfig } from '../types';

export class StorageManager {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath || pathJoin(process.cwd(), 'stratix-data', 'agents');
  }

  private async ensureDir(dirPath: string): Promise<void> {
    if (!existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true });
    }
  }

  private getAgentPath(agentId: string): string {
    return pathJoin(this.basePath, agentId);
  }

  async saveConfig(config: AgentConfig): Promise<void> {
    const agentPath = this.getAgentPath(config.agentId);
    await this.ensureDir(agentPath);
    const configPath = pathJoin(agentPath, 'config.json');
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  async loadConfig(agentId: string): Promise<AgentConfig | null> {
    const configPath = pathJoin(this.getAgentPath(agentId), 'config.json');
    if (!existsSync(configPath)) {
      return null;
    }
    try {
      const content = await readFile(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      console.error(`[StorageManager] Failed to load config for ${agentId}:`, e);
      return null;
    }
  }

  async saveSoul(agentId: string, soul: SoulConfig): Promise<void> {
    const agentPath = this.getAgentPath(agentId);
    await this.ensureDir(agentPath);
    const soulPath = pathJoin(agentPath, 'soul.json');
    await writeFile(soulPath, JSON.stringify(soul, null, 2), 'utf-8');
  }

  async loadSoul(agentId: string): Promise<SoulConfig | null> {
    const soulPath = pathJoin(this.getAgentPath(agentId), 'soul.json');
    if (!existsSync(soulPath)) {
      return null;
    }
    try {
      const content = await readFile(soulPath, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      console.error(`[StorageManager] Failed to load soul for ${agentId}:`, e);
      return null;
    }
  }

  async saveRules(agentId: string, rules: string[]): Promise<void> {
    const agentPath = this.getAgentPath(agentId);
    await this.ensureDir(agentPath);
    const rulesPath = pathJoin(agentPath, 'rules.json');
    await writeFile(rulesPath, JSON.stringify({ rules }, null, 2), 'utf-8');
  }

  async loadRules(agentId: string): Promise<string[]> {
    const rulesPath = pathJoin(this.getAgentPath(agentId), 'rules.json');
    if (!existsSync(rulesPath)) {
      return [];
    }
    try {
      const content = await readFile(rulesPath, 'utf-8');
      const data = JSON.parse(content);
      return data.rules || [];
    } catch (e) {
      console.error(`[StorageManager] Failed to load rules for ${agentId}:`, e);
      return [];
    }
  }

  async deleteAgent(agentId: string): Promise<void> {
    const { rm } = await import('fs/promises');
    const agentPath = this.getAgentPath(agentId);
    if (existsSync(agentPath)) {
      await rm(agentPath, { recursive: true, force: true });
    }
  }

  async listAgents(): Promise<string[]> {
    const { readdir } = await import('fs/promises');
    if (!existsSync(this.basePath)) {
      return [];
    }
    const entries = await readdir(this.basePath, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name);
  }
}
