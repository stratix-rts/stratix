import type { Database, Statement } from './sqlite-adapter';

import { generateId } from '../stratix-project/utils/helpers';

import { getDatabase } from './StratixDatabase';

export type ZoneMemberRole = 'coordinator' | 'executor';

export interface ZoneMember {
  id: string;
  zoneId: string;
  agentId: string;
  role: ZoneMemberRole;
  enteredAt: number;
  leftAt: number | null;
}

interface ZoneMemberRow {
  id: string;
  zone_id: string;
  agent_id: string;
  role: string;
  entered_at: number;
  left_at: number | null;
}

function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[ZoneMemberRepository] ${message}`, ctx || '');
}

export class ZoneMemberRepository {
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
   * Add a member to a zone.
   * If the member already exists and is active, returns the existing record.
   * Uses a transaction to ensure atomic read-then-write.
   */
  addMember(zoneId: string, agentId: string, role: ZoneMemberRole = 'executor'): ZoneMember | null {
    const now = Date.now();
    const id = generateId('zmem');

    let result: ZoneMember | null = null;

    const tx = this.db.transaction(() => {
      const existing = this.getMember(zoneId, agentId);
      if (existing) {
        result = existing;
        return;
      }

      this.stmt(`
        INSERT INTO zone_members (id, zone_id, agent_id, role, entered_at, left_at)
        VALUES (?, ?, ?, ?, ?, NULL)
      `).run(id, zoneId, agentId, role, now);

      result = {
        id,
        zoneId,
        agentId,
        role,
        enteredAt: now,
        leftAt: null
      };
    });

    try {
      tx();
    } catch (e) {
      log('warn', 'Unique constraint violated when adding member', { zoneId, agentId, error: String(e) });
      result = this.getMember(zoneId, agentId);
    }

    return result;
  }

  /**
   * Remove a member from a zone (soft remove by setting left_at)
   */
  removeMember(zoneId: string, agentId: string): boolean {
    const now = Date.now();
    const result = this.stmt(`
      UPDATE zone_members SET left_at = ?
      WHERE zone_id = ? AND agent_id = ? AND left_at IS NULL
    `).run(now, zoneId, agentId);
    return result.changes > 0;
  }

  /**
   * Get all active members of a zone (left_at IS NULL)
   */
  getMembers(zoneId: string): ZoneMember[] {
    const rows = this.stmt(`
      SELECT * FROM zone_members
      WHERE zone_id = ? AND left_at IS NULL
      ORDER BY entered_at ASC
    `).all(zoneId) as ZoneMemberRow[];
    return rows.map(row => this.mapRowToMember(row));
  }

  /**
   * Get a specific member record (only active members)
   */
  getMember(zoneId: string, agentId: string): ZoneMember | null {
    const row = this.stmt(`
      SELECT * FROM zone_members
      WHERE zone_id = ? AND agent_id = ? AND left_at IS NULL
    `).get(zoneId, agentId) as ZoneMemberRow | undefined;
    return row ? this.mapRowToMember(row) : null;
  }

  /**
   * Update a member's role
   */
  updateRole(zoneId: string, agentId: string, role: ZoneMemberRole): ZoneMember | null {
    const result = this.stmt(`
      UPDATE zone_members SET role = ?
      WHERE zone_id = ? AND agent_id = ? AND left_at IS NULL
    `).run(role, zoneId, agentId);
    if (result.changes === 0) return null;
    return this.getMember(zoneId, agentId);
  }

  /**
   * Get all zones an agent is currently in
   */
  getMembersByAgent(agentId: string): ZoneMember[] {
    const rows = this.stmt(`
      SELECT * FROM zone_members
      WHERE agent_id = ? AND left_at IS NULL
      ORDER BY entered_at DESC
    `).all(agentId) as ZoneMemberRow[];
    return rows.map(row => this.mapRowToMember(row));
  }

  /**
   * Get all coordinators in a zone
   */
  getCoordinators(zoneId: string): ZoneMember[] {
    const rows = this.stmt(`
      SELECT * FROM zone_members
      WHERE zone_id = ? AND role = 'coordinator' AND left_at IS NULL
      ORDER BY entered_at ASC
    `).all(zoneId) as ZoneMemberRow[];
    return rows.map(row => this.mapRowToMember(row));
  }

  /**
   * Get all executors in a zone
   */
  getExecutors(zoneId: string): ZoneMember[] {
    const rows = this.stmt(`
      SELECT * FROM zone_members
      WHERE zone_id = ? AND role = 'executor' AND left_at IS NULL
      ORDER BY entered_at ASC
    `).all(zoneId) as ZoneMemberRow[];
    return rows.map(row => this.mapRowToMember(row));
  }

  private mapRowToMember(row: ZoneMemberRow): ZoneMember {
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
