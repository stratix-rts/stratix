import { getDatabase } from './StratixDatabase';
import { generateId } from '../stratix-project/utils/helpers';

export type ZoneMemberRole = 'coordinator' | 'executor';

export interface ZoneMember {
  id: string;
  zoneId: string;
  agentId: string;
  role: ZoneMemberRole;
  enteredAt: number;
  leftAt: number | null;
}

export class ZoneMemberRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  /**
   * Add a member to a zone
   */
  addMember(zoneId: string, agentId: string, role: ZoneMemberRole = 'executor'): ZoneMember | null {
    const now = Date.now();
    const id = generateId('zmem');

    // Use INSERT OR REPLACE to handle re-entry: if member already exists and left, update left_at
    const existing = this.getMember(zoneId, agentId);
    if (existing) {
      // Member already exists and is active
      return existing;
    }

    try {
      const stmt = this.db.prepare(`
        INSERT INTO zone_members (id, zone_id, agent_id, role, entered_at, left_at)
        VALUES (?, ?, ?, ?, ?, NULL)
      `);
      stmt.run(id, zoneId, agentId, role, now);

      return {
        id,
        zoneId,
        agentId,
        role,
        enteredAt: now,
        leftAt: null
      };
    } catch (e) {
      // If unique constraint violated, member already exists
      return this.getMember(zoneId, agentId);
    }
  }

  /**
   * Remove a member from a zone (soft remove by setting left_at)
   */
  removeMember(zoneId: string, agentId: string): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE zone_members SET left_at = ?
      WHERE zone_id = ? AND agent_id = ? AND left_at IS NULL
    `);
    const result = stmt.run(now, zoneId, agentId);
    return result.changes > 0;
  }

  /**
   * Get all active members of a zone (left_at IS NULL)
   */
  getMembers(zoneId: string): ZoneMember[] {
    const rows = this.db.prepare(`
      SELECT * FROM zone_members
      WHERE zone_id = ? AND left_at IS NULL
      ORDER BY entered_at ASC
    `).all(zoneId) as any[];
    return rows.map(row => this.mapRowToMember(row));
  }

  /**
   * Get a specific member record
   */
  getMember(zoneId: string, agentId: string): ZoneMember | null {
    const row = this.db.prepare(`
      SELECT * FROM zone_members
      WHERE zone_id = ? AND agent_id = ?
    `).get(zoneId, agentId) as any;
    return row ? this.mapRowToMember(row) : null;
  }

  /**
   * Update a member's role
   */
  updateRole(zoneId: string, agentId: string, role: ZoneMemberRole): ZoneMember | null {
    const stmt = this.db.prepare(`
      UPDATE zone_members SET role = ?
      WHERE zone_id = ? AND agent_id = ? AND left_at IS NULL
    `);
    const result = stmt.run(role, zoneId, agentId);
    if (result.changes === 0) return null;
    return this.getMember(zoneId, agentId);
  }

  /**
   * Get all zones an agent is currently in
   */
  getMembersByAgent(agentId: string): ZoneMember[] {
    const rows = this.db.prepare(`
      SELECT * FROM zone_members
      WHERE agent_id = ? AND left_at IS NULL
      ORDER BY entered_at DESC
    `).all(agentId) as any[];
    return rows.map(row => this.mapRowToMember(row));
  }

  /**
   * Get all coordinators in a zone
   */
  getCoordinators(zoneId: string): ZoneMember[] {
    const rows = this.db.prepare(`
      SELECT * FROM zone_members
      WHERE zone_id = ? AND role = 'coordinator' AND left_at IS NULL
      ORDER BY entered_at ASC
    `).all(zoneId) as any[];
    return rows.map(row => this.mapRowToMember(row));
  }

  /**
   * Get all executors in a zone
   */
  getExecutors(zoneId: string): ZoneMember[] {
    const rows = this.db.prepare(`
      SELECT * FROM zone_members
      WHERE zone_id = ? AND role = 'executor' AND left_at IS NULL
      ORDER BY entered_at ASC
    `).all(zoneId) as any[];
    return rows.map(row => this.mapRowToMember(row));
  }

  private mapRowToMember(row: any): ZoneMember {
    return {
      id: row.id,
      zoneId: row.zone_id,
      agentId: row.agent_id,
      role: row.role as ZoneMemberRole,
      enteredAt: row.entered_at,
      leftAt: row.left_at || null
    };
  }
}

export const zoneMemberRepository = new ZoneMemberRepository();
