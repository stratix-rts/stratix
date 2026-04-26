import { StratixAgentConfig } from '../stratix-core/stratix-protocol';

import { getDatabase } from './StratixDatabase';

// Database row type for agents table
interface AgentRow {
  agent_id: string;
  name: string;
  type: string;
  profile: string | null;
  soul: string | null;
  rules: string | null;
  backend_type: string;
  config_status: string;
  position: string | null;
  memory: string | null;
  openclaw_config: string | null;
  stratix_config: string | null;
  created_at: number;
  updated_at: number;
}

function parseJsonSafe<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class AgentRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  getAllAgents(): StratixAgentConfig[] {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all() as AgentRow[];
    return rows.map(this.mapRowToAgent);
  }

  getAgent(agentId: string): StratixAgentConfig | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE agent_id = ?').get(agentId) as AgentRow | undefined;
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

  private mapRowToAgent(row: AgentRow): StratixAgentConfig {
    return {
      agentId: row.agent_id,
      name: row.name,
      type: row.type,
      profile: parseJsonSafe(row.profile, undefined),
      soul: parseJsonSafe(row.soul, undefined),
      rules: parseJsonSafe(row.rules, undefined),
      backendType: row.backend_type,
      configStatus: row.config_status,
      position: parseJsonSafe(row.position, undefined),
      memory: parseJsonSafe(row.memory, undefined),
      openClawConfig: parseJsonSafe(row.openclaw_config, undefined),
      stratixConfig: parseJsonSafe(row.stratix_config, undefined),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export const agentRepository = new AgentRepository();
