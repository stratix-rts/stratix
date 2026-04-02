import type { StratixAgentConfig } from '../stratix-core/stratix-protocol';
import { getDatabase, initializeDatabase } from '../stratix-database';
import { agentChatMessageRepository, type ChatMessage } from '../stratix-database/AgentChatMessageRepository';
import { agentRepository } from '../stratix-database/AgentRepository';

import type { StratixCommandLog, StratixTemplates, LogQueryOptions } from './types';

export class StratixDataStore {
  private initialized: boolean = false;

  public async initialize(dataDir?: string): Promise<void> {
    if (this.initialized) return;

    initializeDatabase({ dataDir });
    getDatabase();
    this.initialized = true;
    console.log('[StratixDataStore] Initialized with SQLite');
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public async saveAgent(config: StratixAgentConfig): Promise<void> {
    await this.ensureInitialized();
    agentRepository.saveAgent(config);
  }

  public async getAgent(agentId: string): Promise<StratixAgentConfig | null> {
    await this.ensureInitialized();
    return agentRepository.getAgent(agentId);
  }

  public async loadAgent(agentId: string): Promise<StratixAgentConfig | null> {
    return this.getAgent(agentId);
  }

  public async listAgents(): Promise<StratixAgentConfig[]> {
    await this.ensureInitialized();
    return agentRepository.getAllAgents();
  }

  public async deleteAgent(agentId: string): Promise<boolean> {
    await this.ensureInitialized();
    return agentRepository.deleteAgent(agentId);
  }

  public async saveCustomTemplate(config: StratixAgentConfig): Promise<void> {
    await this.saveAgent(config);
  }

  public async listTemplates(): Promise<StratixTemplates> {
    await this.ensureInitialized();
    return {
      preset: [],
      custom: []
    };
  }

  public async deleteCustomTemplate(agentId: string): Promise<boolean> {
    return this.deleteAgent(agentId);
  }

  public async saveLog(log: StratixCommandLog): Promise<void> {
    await this.ensureInitialized();
    const db = getDatabase().getDatabase();
    const stmt = db.prepare(`
      INSERT INTO command_logs (log_id, command_id, agent_id, skill_id, skill_name, params, status, result, error, start_time, end_time, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      log.logId,
      log.commandId,
      log.agentId,
      log.skillId,
      log.skillName,
      JSON.stringify(log.params),
      log.status,
      log.result || null,
      log.error || null,
      log.startTime,
      log.endTime || null,
      Date.now()
    );
  }

  public async getLogs(options?: LogQueryOptions): Promise<StratixCommandLog[]> {
    await this.ensureInitialized();
    const db = getDatabase().getDatabase();
    
    let query = 'SELECT * FROM command_logs WHERE 1=1';
    const params: any[] = [];
    
    if (options?.agentId) {
      query += ' AND agent_id = ?';
      params.push(options.agentId);
    }
    if (options?.status) {
      query += ' AND status = ?';
      params.push(options.status);
    }
    
    query += ' ORDER BY start_time DESC';
    
    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    
    const rows = db.prepare(query).all(...params) as any[];
    return rows.map(row => ({
      logId: row.log_id,
      commandId: row.command_id,
      agentId: row.agent_id,
      skillId: row.skill_id,
      skillName: row.skill_name,
      params: JSON.parse(row.params || '{}'),
      status: row.status,
      result: row.result,
      error: row.error,
      startTime: row.start_time,
      endTime: row.end_time
    }));
  }

  public async exportData(): Promise<any> {
    await this.ensureInitialized();
    const agents = await this.listAgents();
    const templates = await this.listTemplates();
    const logs = await this.getLogs();
    return { agents, templates, logs, exportedAt: Date.now() };
  }

  public async importData(data: any): Promise<void> {
    await this.ensureInitialized();
    if (data.agents) {
      for (const agent of data.agents) {
        await this.saveAgent(agent);
      }
    }
  }

  public async addLog(log: StratixCommandLog): Promise<void> {
    await this.saveLog(log);
  }

  public async updateLog(logId: string, updates: Partial<StratixCommandLog>): Promise<void> {
    await this.ensureInitialized();
    const db = getDatabase().getDatabase();
    const fields: string[] = [];
    const values: any[] = [];
    
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.result !== undefined) {
      fields.push('result = ?');
      values.push(updates.result);
    }
    if (updates.error !== undefined) {
      fields.push('error = ?');
      values.push(updates.error);
    }
    if (updates.endTime !== undefined) {
      fields.push('end_time = ?');
      values.push(updates.endTime);
    }
    
    if (fields.length > 0) {
      values.push(logId);
      db.prepare(`UPDATE command_logs SET ${fields.join(', ')} WHERE log_id = ?`).run(...values);
    }
  }

  public async getLog(logId: string): Promise<StratixCommandLog | null> {
    const logs = await this.getLogs();
    return logs.find(l => l.logId === logId) || null;
  }

  public async clearLogs(agentId?: string): Promise<void> {
    await this.ensureInitialized();
    const db = getDatabase().getDatabase();
    if (agentId) {
      db.prepare('DELETE FROM command_logs WHERE agent_id = ?').run(agentId);
    } else {
      db.prepare('DELETE FROM command_logs').run();
    }
  }

  public async saveChatMessage(msg: {
    messageId: string;
    agentId: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }): Promise<void> {
    await this.ensureInitialized();
    agentChatMessageRepository.saveMessage(msg);
  }

  public async getChatMessages(
    agentId: string,
    limit = 20,
    offset = 0
  ): Promise<ChatMessage[]> {
    await this.ensureInitialized();
    return agentChatMessageRepository.getMessagesByAgentId(agentId, limit, offset);
  }

  public async searchChatMessages(
    agentId: string,
    keywords: string[],
    limit = 10
  ): Promise<ChatMessage[]> {
    await this.ensureInitialized();
    return agentChatMessageRepository.searchMessages(agentId, keywords, limit);
  }

  public async deleteChatMessages(agentId: string): Promise<void> {
    await this.ensureInitialized();
    agentChatMessageRepository.deleteMessagesByAgentId(agentId);
  }

  public async setPresetTemplates(templates: StratixAgentConfig[]): Promise<void> {
    console.log('[StratixDataStore] setPresetTemplates not implemented in SQLite');
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

export const dataStoreService = new StratixDataStore();
