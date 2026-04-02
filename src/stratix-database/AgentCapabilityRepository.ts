import { generateId } from '../stratix-project/utils/helpers';

import { getDatabase } from './StratixDatabase';

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

export class AgentCapabilityRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  /**
   * Set a capability level for an agent in a zone (UPSERT)
   */
  setCapability(agentId: string, zoneId: string, capability: Capability, level: number): AgentCapability {
    const now = Date.now();
    const id = generateId('acap');

    const stmt = this.db.prepare(`
      INSERT INTO agent_capabilities (id, agent_id, zone_id, capability, level, current_load, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(agent_id, zone_id, capability) DO UPDATE SET
        level = excluded.level,
        updated_at = excluded.updated_at
    `);
    stmt.run(id, agentId, zoneId, capability, level, now);

    return this.getCapability(agentId, zoneId, capability)!;
  }

  /**
   * Get a specific capability for an agent in a zone
   */
  getCapability(agentId: string, zoneId: string, capability: Capability): AgentCapability | null {
    const row = this.db.prepare(`
      SELECT * FROM agent_capabilities
      WHERE agent_id = ? AND zone_id = ? AND capability = ?
    `).get(agentId, zoneId, capability) as any;
    return row ? this.mapRowToCapability(row) : null;
  }

  /**
   * Get all capabilities for an agent in a zone
   */
  getCapabilities(agentId: string, zoneId: string): AgentCapability[] {
    const rows = this.db.prepare(`
      SELECT * FROM agent_capabilities
      WHERE agent_id = ? AND zone_id = ?
      ORDER BY level DESC, capability ASC
    `).all(agentId, zoneId) as any[];
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
    const params: any[] = [zoneId];

    if (capability) {
      sql += ` AND capability = ?`;
      params.push(capability);
    }

    if (maxLoad !== undefined) {
      sql += ` AND current_load < ?`;
      params.push(maxLoad);
    }

    sql += ` ORDER BY current_load ASC, level DESC`;

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.mapRowToCapability(row));
  }

  /**
   * Update the current load for an agent in a zone
   */
  updateLoad(agentId: string, zoneId: string, load: number): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE agent_capabilities SET current_load = ?, updated_at = ?
      WHERE agent_id = ? AND zone_id = ?
    `);
    const result = stmt.run(load, now, agentId, zoneId);
    return result.changes > 0;
  }

  /**
   * Increment the current load for an agent in a zone
   */
  incrementLoad(agentId: string, zoneId: string): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE agent_capabilities SET current_load = current_load + 1, updated_at = ?
      WHERE agent_id = ? AND zone_id = ?
    `);
    const result = stmt.run(now, agentId, zoneId);
    return result.changes > 0;
  }

  /**
   * Decrement the current load for an agent in a zone
   */
  decrementLoad(agentId: string, zoneId: string): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE agent_capabilities
      SET current_load = MAX(0, current_load - 1), updated_at = ?
      WHERE agent_id = ? AND zone_id = ?
    `);
    const result = stmt.run(now, agentId, zoneId);
    return result.changes > 0;
  }

  /**
   * Remove all capabilities for an agent in a zone
   */
  removeCapabilities(agentId: string, zoneId: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM agent_capabilities WHERE agent_id = ? AND zone_id = ?
    `);
    const result = stmt.run(agentId, zoneId);
    return result.changes > 0;
  }

  /**
   * Get top agents by capability and level in a zone
   */
  getTopAgents(zoneId: string, capability: Capability, limit: number = 5): AgentCapability[] {
    const rows = this.db.prepare(`
      SELECT * FROM agent_capabilities
      WHERE zone_id = ? AND capability = ?
      ORDER BY level DESC, current_load ASC
      LIMIT ?
    `).all(zoneId, capability, limit) as any[];
    return rows.map(row => this.mapRowToCapability(row));
  }

  private mapRowToCapability(row: any): AgentCapability {
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
