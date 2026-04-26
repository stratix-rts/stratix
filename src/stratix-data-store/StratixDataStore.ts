import type { StratixAgentConfig } from '../stratix-core/stratix-protocol';
import { getDatabase, initializeDatabase } from '../stratix-database';
import { agentChatMessageRepository, type ChatMessage } from '../stratix-database/AgentChatMessageRepository';
import { agentRepository } from '../stratix-database/AgentRepository';

import type { StratixCommandLog, StratixTemplates, LogQueryOptions } from './types';

interface CommandLogRow {
  log_id: string;
  command_id: string;
  agent_id: string;
  skill_id: string;
  skill_name: string;
  params: string | null;
  status: string;
  result: string | null;
  error: string | null;
  start_time: number;
  end_time: number | null;
}

interface TemplateRow {
  template_id: string;
  name: string;
  type: string;
  profile: string | null;
  soul: string | null;
  rules: string | null;
  backend_type: string;
  created_at: number;
  updated_at: number;
}

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
    const db = getDatabase().getDatabase();

    const presetRows = db.prepare("SELECT * FROM templates WHERE type = 'preset'").all() as TemplateRow[];
    const customRows = db.prepare("SELECT * FROM templates WHERE type = 'custom'").all() as TemplateRow[];

    const preset = presetRows.map(row => this.mapRowToTemplate(row));
    const custom = customRows.map(row => this.mapRowToTemplate(row));

    return { preset, custom };
  }

  private mapRowToTemplate(row: TemplateRow): StratixAgentConfig {
    return {
      agentId: row.template_id,
      name: row.name,
      type: row.type,
      profile: row.profile ? JSON.parse(row.profile) : undefined,
      soul: row.soul ? JSON.parse(row.soul) : undefined,
      rules: row.rules ? JSON.parse(row.rules) : undefined,
      backendType: row.backend_type,
      configStatus: 'preset',
      createdAt: row.created_at,
      updatedAt: row.updated_at
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
    const params: (string | number)[] = [];

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

    const rows = db.prepare(query).all(...params) as CommandLogRow[];
    return rows.map(row => ({
      logId: row.log_id,
      commandId: row.command_id,
      agentId: row.agent_id,
      skillId: row.skill_id,
      skillName: row.skill_name,
      params: (() => {
        try {
          return JSON.parse(row.params || '{}');
        } catch {
          return {};
        }
      })(),
      status: row.status,
      result: row.result,
      error: row.error,
      startTime: row.start_time,
      endTime: row.end_time
    }));
  }

  public async exportData(): Promise<{ agents: StratixAgentConfig[]; templates: StratixTemplates; logs: StratixCommandLog[]; exportedAt: number }> {
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
      await db.prepare(`UPDATE command_logs SET ${fields.join(', ')} WHERE log_id = ?`).run(...values);
    }
  }

  public async getLog(logId: string): Promise<StratixCommandLog | null> {
    await this.ensureInitialized();
    const db = getDatabase().getDatabase();

    const row = db.prepare('SELECT * FROM command_logs WHERE log_id = ?').get(logId) as CommandLogRow | undefined;
    if (!row) return null;

    return {
      logId: row.log_id,
      commandId: row.command_id,
      agentId: row.agent_id,
      skillId: row.skill_id,
      skillName: row.skill_name,
      params: (() => {
        try {
          return JSON.parse(row.params || '{}');
        } catch {
          return {};
        }
      })(),
      status: row.status,
      result: row.result,
      error: row.error,
      startTime: row.start_time,
      endTime: row.end_time
    };
  }

  public async clearLogs(agentId?: string): Promise<void> {
    await this.ensureInitialized();
    const db = getDatabase().getDatabase();
    if (agentId) {
      await db.prepare('DELETE FROM command_logs WHERE agent_id = ?').run(agentId);
    } else {
      await db.prepare('DELETE FROM command_logs').run();
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
    await this.ensureInitialized();
    const db = getDatabase().getDatabase();
    const now = Date.now();

    for (const template of templates) {
      // Check if template already exists
      const existing = db.prepare('SELECT template_id FROM templates WHERE template_id = ?').get(template.agentId);

      if (existing) {
        // Update existing template
        const stmt = db.prepare(`
          UPDATE templates SET name = ?, profile = ?, soul = ?, rules = ?, backend_type = ?, updated_at = ?
          WHERE template_id = ?
        `);
        stmt.run(
          template.name,
          JSON.stringify(template.profile),
          JSON.stringify(template.soul),
          JSON.stringify(template.rules),
          template.backendType,
          now,
          template.agentId
        );
      } else {
        // Insert new template
        const stmt = db.prepare(`
          INSERT INTO templates (template_id, name, type, profile, soul, rules, backend_type, created_at, updated_at)
          VALUES (?, ?, 'preset', ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
          template.agentId,
          template.name,
          JSON.stringify(template.profile),
          JSON.stringify(template.soul),
          JSON.stringify(template.rules),
          template.backendType,
          now,
          now
        );
      }
    }
    console.log(`[StratixDataStore] Saved ${templates.length} preset templates to database`);
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

export const dataStoreService = new StratixDataStore();
