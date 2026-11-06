
import { generateId } from '../stratix-core/utils/id';

import { getDatabase } from './StratixDatabase';
import type { Statement } from './sqlite-adapter';

export type Capability = 'coding' | 'writing' | 'analysis' | 'research' | 'general';

export interface AgentCapability {
  id: string;
  agentId: string;
  zoneId: string;
  capability: Capability;
  level: number;
  currentLoad: number;
  updatedAt: number;
}

interface CapabilityRow {
  id: string;
  agent_id: string;
  zone_id: string;
  capability: string;
  level: number;
  current_load: number;
  updated_at: number;
}

export class AgentCapabilityRepository {
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

  /**
   * Set a capability level for an agent in a zone (UPSERT)
   */
  setCapability(agentId: string, zoneId: string, capability: Capability, level: number): AgentCapability {
    const now = Date.now();
    const id = generateId('acap');

    this.stmt(`
      INSERT INTO agent_capabilities (id, agent_id, zone_id, capability, level, current_load, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(agent_id, zone_id, capability) DO UPDATE SET
        level = excluded.level,
        updated_at = excluded.updated_at
    `).run(id, agentId, zoneId, capability, level, now);

    return this.getCapability(agentId, zoneId, capability)!;
  }

  /**
   * Get a specific capability for an agent in a zone
   */
  getCapability(agentId: string, zoneId: string, capability: Capability): AgentCapability | null {
    const row = this.stmt(`
      SELECT * FROM agent_capabilities
      WHERE agent_id = ? AND zone_id = ? AND capability = ?
    `).get(agentId, zoneId, capability) as CapabilityRow | undefined;
    return row ? this.mapRowToCapability(row) : null;
  }

  /**
   * Get all capabilities for an agent in a zone
   */
  getCapabilities(agentId: string, zoneId: string): AgentCapability[] {
    const rows = this.stmt(`
      SELECT * FROM agent_capabilities
      WHERE agent_id = ? AND zone_id = ?
      ORDER BY level DESC, capability ASC
    `).all(agentId, zoneId) as CapabilityRow[];
    return rows.map(row => this.mapRowToCapability(row));
  }

  /**
   * Get available agents in a zone, optionally filtered by capability and max load
   */
  getAvailableAgents(zoneId: string, capability?: Capability, maxLoad?: number): AgentCapability[] {
    let sql = `
      SELECT * FROM agent_capabilities
      WHERE zone_id = ?
    `;
    const params: (string | number)[] = [zoneId];

    if (capability) {
      sql += ` AND capability = ?`;
      params.push(capability);
    }

    if (maxLoad !== undefined) {
      sql += ` AND current_load < ?`;
      params.push(maxLoad);
    }

    sql += ` ORDER BY current_load ASC, level DESC`;

    const rows = this.stmt(sql).all(...params) as CapabilityRow[];
    return rows.map(row => this.mapRowToCapability(row));
  }

  /**
   * Update the current load for an agent in a zone
   */
  updateLoad(agentId: string, zoneId: string, load: number): boolean {
    const now = Date.now();
    const result = this.stmt(`
      UPDATE agent_capabilities SET current_load = ?, updated_at = ?
      WHERE agent_id = ? AND zone_id = ?
    `).run(load, now, agentId, zoneId);
    return result.changes > 0;
  }

  /**
   * Increment the current load for an agent in a zone
   */
  incrementLoad(agentId: string, zoneId: string): boolean {
    const now = Date.now();
    const result = this.stmt(`
      UPDATE agent_capabilities SET current_load = current_load + 1, updated_at = ?
      WHERE agent_id = ? AND zone_id = ?
    `).run(now, agentId, zoneId);
    return result.changes > 0;
  }

  /**
   * Decrement the current load for an agent in a zone
   */
  decrementLoad(agentId: string, zoneId: string): boolean {
    const now = Date.now();
    const result = this.stmt(`
      UPDATE agent_capabilities
      SET current_load = MAX(0, current_load - 1), updated_at = ?
      WHERE agent_id = ? AND zone_id = ?
    `).run(now, agentId, zoneId);
    return result.changes > 0;
  }

  /**
   * Remove all capabilities for an agent in a zone
   */
  removeCapabilities(agentId: string, zoneId: string): boolean {
    const result = this.stmt(`
      DELETE FROM agent_capabilities WHERE agent_id = ? AND zone_id = ?
    `).run(agentId, zoneId);
    return result.changes > 0;
  }

  /**
   * Get top agents by capability and level in a zone
   */
  getTopAgents(zoneId: string, capability: Capability, limit: number = 5): AgentCapability[] {
    const rows = this.stmt(`
      SELECT * FROM agent_capabilities
      WHERE zone_id = ? AND capability = ?
      ORDER BY level DESC, current_load ASC
      LIMIT ?
    `).all(zoneId, capability, limit) as CapabilityRow[];
    return rows.map(row => this.mapRowToCapability(row));
  }

  private mapRowToCapability(row: CapabilityRow): AgentCapability {
    return {
      id: row.id,
      agentId: row.agent_id,
      zoneId: row.zone_id,
      capability: row.capability as Capability,
      level: row.level,
      currentLoad: row.current_load,
      updatedAt: row.updated_at
    };
  }
}

export const agentCapabilityRepository = new AgentCapabilityRepository();
