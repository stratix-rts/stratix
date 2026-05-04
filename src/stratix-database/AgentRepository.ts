import type { Database, Statement } from './sqlite-adapter';

import { StratixAgentConfig, AgentBackendType, AgentConfigStatus } from '../stratix-core/stratix-protocol';

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
    /* expected: invalid JSON, return fallback */
    return fallback;
  }
}

export class AgentRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  private statements = new Map<string, Statement>();

  private stmt(sql: string): Statement {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  /**
   * 清理 prepared statement 缓存
   */
  shutdown(): void {
    this.statements.clear();
  }

  /**
   * 检查数据库连接是否健康
   */
  isHealthy(): boolean {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  getAllAgents(): StratixAgentConfig[] {
    const rows = this.stmt('SELECT * FROM agents ORDER BY created_at DESC').all() as AgentRow[];
    return rows.map(this.mapRowToAgent);
  }

  getAgent(agentId: string): StratixAgentConfig | null {
    const row = this.stmt('SELECT * FROM agents WHERE agent_id = ?').get(agentId) as AgentRow | undefined;
    return row ? this.mapRowToAgent(row) : null;
  }

  /**
   * 保存 Agent（UPSERT，避免先查后写的竞态条件）
   */
  saveAgent(agent: StratixAgentConfig): void {
    const now = Date.now();
    this.stmt(`
      INSERT INTO agents (agent_id, name, type, profile, soul, rules, backend_type, config_status, position, memory, openclaw_config, stratix_config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        profile = excluded.profile,
        soul = excluded.soul,
        rules = excluded.rules,
        backend_type = excluded.backend_type,
        config_status = excluded.config_status,
        position = excluded.position,
        memory = excluded.memory,
        openclaw_config = excluded.openclaw_config,
        stratix_config = excluded.stratix_config,
        updated_at = excluded.updated_at,
        created_at = agents.created_at
    `).run(
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
      agent.createdAt ?? now,
      agent.updatedAt ?? now
    );
  }

  deleteAgent(agentId: string): boolean {
    const result = this.stmt('DELETE FROM agents WHERE agent_id = ?').run(agentId);
    return result.changes > 0;
  }

  private mapRowToAgent(row: AgentRow): StratixAgentConfig {
    return {
      agentId: row.agent_id,
      name: row.name,
      type: row.type,
      profile: parseJsonSafe(row.profile, undefined) ?? {
        characterId: row.agent_id,
        name: row.name,
        bodyType: 'male',
        parts: {}
      },
      soul: parseJsonSafe(row.soul, undefined),
      rules: parseJsonSafe(row.rules, undefined),
      backendType: row.backend_type as AgentBackendType,
      configStatus: row.config_status as AgentConfigStatus,
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
