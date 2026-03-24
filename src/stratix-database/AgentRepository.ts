import { getDatabase } from './StratixDatabase';
import { StratixAgentConfig } from '../stratix-core/stratix-protocol';

export class AgentRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  getAllAgents(): StratixAgentConfig[] {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all() as any[];
    return rows.map(this.mapRowToAgent);
  }

  getAgent(agentId: string): StratixAgentConfig | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE agent_id = ?').get(agentId) as any;
    return row ? this.mapRowToAgent(row) : null;
  }

  saveAgent(agent: StratixAgentConfig): void {
    const existing = this.getAgent(agent.agentId);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE agents SET
          name = ?, type = ?, profile = ?, soul = ?, rules = ?,
          backend_type = ?, config_status = ?, position = ?, memory = ?,
          openclaw_config = ?, stratix_config = ?, updated_at = ?
        WHERE agent_id = ?
      `);
      stmt.run(
        agent.name,
        agent.type,
        JSON.stringify(agent.profile),
        JSON.stringify(agent.soul),
        JSON.stringify(agent.rules),
        agent.backendType,
        agent.configStatus,
        agent.position ? JSON.stringify(agent.position) : null,
        agent.memory ? JSON.stringify(agent.memory) : null,
        agent.openClawConfig ? JSON.stringify(agent.openClawConfig) : null,
        agent.stratixConfig ? JSON.stringify(agent.stratixConfig) : null,
        Date.now(),
        agent.agentId
      );
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO agents (agent_id, name, type, profile, soul, rules, backend_type, config_status, position, memory, openclaw_config, stratix_config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        agent.agentId,
        agent.name,
        agent.type,
        JSON.stringify(agent.profile),
        JSON.stringify(agent.soul),
        JSON.stringify(agent.rules),
        agent.backendType || 'direct',
        agent.configStatus || 'draft',
        agent.position ? JSON.stringify(agent.position) : null,
        agent.memory ? JSON.stringify(agent.memory) : null,
        agent.openClawConfig ? JSON.stringify(agent.openClawConfig) : null,
        agent.stratixConfig ? JSON.stringify(agent.stratixConfig) : null,
        agent.createdAt,
        agent.updatedAt
      );
    }
  }

  deleteAgent(agentId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM agents WHERE agent_id = ?');
    const result = stmt.run(agentId);
    return result.changes > 0;
  }

  private mapRowToAgent(row: any): StratixAgentConfig {
    return {
      agentId: row.agent_id,
      name: row.name,
      type: row.type,
      profile: row.profile ? JSON.parse(row.profile) : undefined,
      soul: row.soul ? JSON.parse(row.soul) : undefined,
      rules: row.rules ? JSON.parse(row.rules) : undefined,
      backendType: row.backend_type,
      configStatus: row.config_status,
      position: row.position ? JSON.parse(row.position) : undefined,
      memory: row.memory ? JSON.parse(row.memory) : undefined,
      openClawConfig: row.openclaw_config ? JSON.parse(row.openclaw_config) : undefined,
      stratixConfig: row.stratix_config ? JSON.parse(row.stratix_config) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export const agentRepository = new AgentRepository();
