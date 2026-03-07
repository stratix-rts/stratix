import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { StratixAgentConfig } from '../stratix-core/stratix-protocol';
import { 
  StratixDatabase, 
  StratixCommandLog, 
  DEFAULT_DB,
  StratixTemplates,
  LogQueryOptions 
} from './types';
import fs from 'fs-extra';
import path from 'path';

export class StratixDataStore {
  public db: Low<StratixDatabase>;
  private dbPath: string;
  private initialized: boolean = false;

  constructor(dataDir: string = 'stratix-data') {
    this.dbPath = path.join(dataDir, 'stratix.db.json');
    this.db = new Low<StratixDatabase>(new JSONFile(this.dbPath), DEFAULT_DB);
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await fs.ensureDir(path.dirname(this.dbPath));
    
    try {
      await this.db.read();
    } catch {
      // File doesn't exist or is invalid, use default
    }
    
    if (!this.db.data || !this.db.data.metadata) {
      this.db.data = JSON.parse(JSON.stringify(DEFAULT_DB));
      this.db.data.metadata.createdAt = Date.now();
      this.db.data.metadata.updatedAt = Date.now();
      await this.db.write();
    }
    
    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async refresh(): Promise<void> {
    await this.db.read();
  }

  private async persist(): Promise<void> {
    this.db.data.metadata.updatedAt = Date.now();
    await this.db.write();
  }

  public async saveAgent(config: StratixAgentConfig): Promise<void> {
    await this.ensureInitialized();
    await this.refresh();
    
    const index = this.db.data.agents.findIndex(a => a.agentId === config.agentId);
    if (index >= 0) {
      this.db.data.agents[index] = config;
    } else {
      this.db.data.agents.push(config);
    }
    
    await this.persist();
  }

  public async getAgent(agentId: string): Promise<StratixAgentConfig | null> {
    await this.ensureInitialized();
    await this.refresh();
    return this.db.data.agents.find(a => a.agentId === agentId) || null;
  }

  public async loadAgent(agentId: string): Promise<StratixAgentConfig | null> {
    return this.getAgent(agentId);
  }

  public async listAgents(): Promise<StratixAgentConfig[]> {
    await this.ensureInitialized();
    await this.refresh();
    return [...this.db.data.agents];
  }

  public async deleteAgent(agentId: string): Promise<boolean> {
    await this.ensureInitialized();
    await this.refresh();
    
    const initialLength = this.db.data.agents.length;
    this.db.data.agents = this.db.data.agents.filter(a => a.agentId !== agentId);
    
    if (this.db.data.agents.length < initialLength) {
      await this.persist();
      return true;
    }
    return false;
  }

  public async saveCustomTemplate(config: StratixAgentConfig): Promise<void> {
    await this.ensureInitialized();
    await this.refresh();
    
    const index = this.db.data.templates.custom.findIndex(t => t.agentId === config.agentId);
    if (index >= 0) {
      this.db.data.templates.custom[index] = config;
    } else {
      this.db.data.templates.custom.push(config);
    }
    
    await this.persist();
  }

  public async listTemplates(): Promise<StratixTemplates> {
    await this.ensureInitialized();
    await this.refresh();
    return {
      preset: [...this.db.data.templates.preset],
      custom: [...this.db.data.templates.custom]
    };
  }

  public async deleteCustomTemplate(agentId: string): Promise<boolean> {
    await this.ensureInitialized();
    await this.refresh();
    
    const initialLength = this.db.data.templates.custom.length;
    this.db.data.templates.custom = this.db.data.templates.custom.filter(t => t.agentId !== agentId);
    
    if (this.db.data.templates.custom.length < initialLength) {
      await this.persist();
      return true;
    }
    return false;
  }

  public async setPresetTemplates(templates: StratixAgentConfig[]): Promise<void> {
    await this.ensureInitialized();
    await this.refresh();
    this.db.data.templates.preset = templates;
    await this.persist();
  }

  public async addLog(log: StratixCommandLog): Promise<void> {
    await this.ensureInitialized();
    await this.refresh();
    
    this.db.data.logs.unshift(log);
    
    if (this.db.data.logs.length > 100) {
      this.db.data.logs = this.db.data.logs.slice(0, 100);
    }
    
    await this.persist();
  }

  public async updateLog(logId: string, updates: Partial<StratixCommandLog>): Promise<boolean> {
    await this.ensureInitialized();
    await this.refresh();
    
    const index = this.db.data.logs.findIndex(l => l.logId === logId);
    if (index >= 0) {
      this.db.data.logs[index] = { ...this.db.data.logs[index], ...updates };
      await this.persist();
      return true;
    }
    return false;
  }

  public async getLog(logId: string): Promise<StratixCommandLog | null> {
    await this.ensureInitialized();
    await this.refresh();
    return this.db.data.logs.find(l => l.logId === logId) || null;
  }

  public async getLogs(options: LogQueryOptions = {}): Promise<StratixCommandLog[]> {
    await this.ensureInitialized();
    await this.refresh();
    
    let logs = [...this.db.data.logs];
    
    if (options.agentId) {
      logs = logs.filter(l => l.agentId === options.agentId);
    }
    
    if (options.status) {
      logs = logs.filter(l => l.status === options.status);
    }
    
    const offset = options.offset || 0;
    const limit = options.limit || 20;
    
    return logs.slice(offset, offset + limit);
  }

  public async clearLogs(): Promise<void> {
    await this.ensureInitialized();
    await this.refresh();
    this.db.data.logs = [];
    await this.persist();
  }

  public async exportData(): Promise<string> {
    await this.ensureInitialized();
    await this.refresh();
    return JSON.stringify(this.db.data, null, 2);
  }

  public async importData(jsonData: string): Promise<void> {
    await this.ensureInitialized();
    const data = JSON.parse(jsonData) as StratixDatabase;
    this.db.data = data;
    await this.persist();
  }

  public getDbPath(): string {
    return this.dbPath;
  }

  public async getMetadata(): Promise<{ createdAt: number; updatedAt: number }> {
    await this.ensureInitialized();
    await this.refresh();
    return { ...this.db.data.metadata };
  }
}
