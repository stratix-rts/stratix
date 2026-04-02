/**
 * SkillRepository - 技能数据库操作
 * 处理 shared_skills、shared_skill_installs、agent_learned_skills 表的 CRUD 操作
 */

import type { SkillCategory, SkillProvider } from '../stratix-agent/types';

import { getDatabase } from './StratixDatabase';

export interface SharedSkill {
  skillId: string;
  name: string;
  description: string;
  category: SkillCategory;
  icon?: string;
  mcpTool?: string;
  endpoint?: string;
  provider: SkillProvider;
  createdAt: number;
  updatedAt: number;
}

export interface SharedSkillInstall {
  skillId: string;
  agentId: string;
  installedAt: number;
  installedBy: string;
}

export interface AgentLearnedSkill {
  skillId: string;
  agentId: string;
  name: string;
  description: string;
  category: SkillCategory;
  level: number;
  experiencePoints: number;
  proficiency: number;
  certified: boolean;
  learnedFrom?: string;
  learnedAt: number;
  lastPracticedAt: number;
}

export class SkillRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  // ============================================
  // Shared Skills CRUD
  // ============================================

  getAllSharedSkills(): SharedSkill[] {
    const rows = this.db.prepare('SELECT * FROM shared_skills ORDER BY name ASC').all() as any[];
    return rows.map(this.mapRowToSharedSkill);
  }

  getSharedSkill(skillId: string): SharedSkill | null {
    const row = this.db.prepare('SELECT * FROM shared_skills WHERE skill_id = ?').get(skillId) as any;
    return row ? this.mapRowToSharedSkill(row) : null;
  }

  saveSharedSkill(skill: SharedSkill): void {
    const existing = this.getSharedSkill(skill.skillId);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE shared_skills SET
          name = ?, description = ?, category = ?, icon = ?, mcp_tool = ?,
          endpoint = ?, provider = ?, updated_at = ?
        WHERE skill_id = ?
      `);
      stmt.run(
        skill.name,
        skill.description,
        skill.category,
        skill.icon || null,
        skill.mcpTool || null,
        skill.endpoint || null,
        skill.provider,
        Date.now(),
        skill.skillId
      );
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO shared_skills (skill_id, name, description, category, icon, mcp_tool, endpoint, provider, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        skill.skillId,
        skill.name,
        skill.description,
        skill.category,
        skill.icon || null,
        skill.mcpTool || null,
        skill.endpoint || null,
        skill.provider,
        skill.createdAt || Date.now(),
        skill.updatedAt || Date.now()
      );
    }
  }

  deleteSharedSkill(skillId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM shared_skills WHERE skill_id = ?');
    const result = stmt.run(skillId);
    return result.changes > 0;
  }

  searchSharedSkills(query: string, category?: SkillCategory): SharedSkill[] {
    let sql = 'SELECT * FROM shared_skills WHERE 1=1';
    const params: any[] = [];

    if (query) {
      sql += ' AND (name LIKE ? OR description LIKE ?)';
      const likeQuery = `%${query}%`;
      params.push(likeQuery, likeQuery);
    }

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    sql += ' ORDER BY name ASC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.mapRowToSharedSkill);
  }

  // ============================================
  // Shared Skill Installs CRUD
  // ============================================

  getInstalledSkillsForAgent(agentId: string): SharedSkillInstall[] {
    const rows = this.db.prepare(
      'SELECT * FROM shared_skill_installs WHERE agent_id = ? ORDER BY installed_at DESC'
    ).all(agentId) as any[];
    return rows.map(this.mapRowToSharedSkillInstall);
  }

  getAgentsWithSkillInstalled(skillId: string): string[] {
    const rows = this.db.prepare(
      'SELECT agent_id FROM shared_skill_installs WHERE skill_id = ?'
    ).all(skillId) as any[];
    return rows.map((r: any) => r.agent_id);
  }

  isSkillInstalledForAgent(skillId: string, agentId: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM shared_skill_installs WHERE skill_id = ? AND agent_id = ?'
    ).get(skillId, agentId);
    return !!row;
  }

  installSkillForAgent(skillId: string, agentId: string, installedBy: string): boolean {
    try {
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO shared_skill_installs (skill_id, agent_id, installed_at, installed_by)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(skillId, agentId, Date.now(), installedBy);
      return true;
    } catch (e) {
      console.error('[SkillRepository] Failed to install skill:', e);
      return false;
    }
  }

  uninstallSkillFromAgent(skillId: string, agentId: string): boolean {
    const stmt = this.db.prepare(
      'DELETE FROM shared_skill_installs WHERE skill_id = ? AND agent_id = ?'
    );
    const result = stmt.run(skillId, agentId);
    return result.changes > 0;
  }

  // ============================================
  // Agent Learned Skills CRUD
  // ============================================

  getLearnedSkillsForAgent(agentId: string): AgentLearnedSkill[] {
    const rows = this.db.prepare(
      'SELECT * FROM agent_learned_skills WHERE agent_id = ? ORDER BY learned_at DESC'
    ).all(agentId) as any[];
    return rows.map(this.mapRowToAgentLearnedSkill);
  }

  getLearnedSkill(skillId: string, agentId: string): AgentLearnedSkill | null {
    const row = this.db.prepare(
      'SELECT * FROM agent_learned_skills WHERE skill_id = ? AND agent_id = ?'
    ).get(skillId, agentId) as any;
    return row ? this.mapRowToAgentLearnedSkill(row) : null;
  }

  saveLearnedSkill(skill: AgentLearnedSkill): void {
    const existing = this.getLearnedSkill(skill.skillId, skill.agentId);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE agent_learned_skills SET
          name = ?, description = ?, category = ?, level = ?, experience_points = ?,
          proficiency = ?, certified = ?, learned_from = ?, last_practiced_at = ?
        WHERE skill_id = ? AND agent_id = ?
      `);
      stmt.run(
        skill.name,
        skill.description,
        skill.category,
        skill.level,
        skill.experiencePoints,
        skill.proficiency,
        skill.certified ? 1 : 0,
        skill.learnedFrom || null,
        skill.lastPracticedAt,
        skill.skillId,
        skill.agentId
      );
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO agent_learned_skills (skill_id, agent_id, name, description, category, level, experience_points, proficiency, certified, learned_from, learned_at, last_practiced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        skill.skillId,
        skill.agentId,
        skill.name,
        skill.description,
        skill.category,
        skill.level,
        skill.experiencePoints,
        skill.proficiency,
        skill.certified ? 1 : 0,
        skill.learnedFrom || null,
        skill.learnedAt,
        skill.lastPracticedAt
      );
    }
  }

  deleteLearnedSkill(skillId: string, agentId: string): boolean {
    const stmt = this.db.prepare(
      'DELETE FROM agent_learned_skills WHERE skill_id = ? AND agent_id = ?'
    );
    const result = stmt.run(skillId, agentId);
    return result.changes > 0;
  }

  updateLearnedSkillPractice(skillId: string, agentId: string, experienceGained: number): AgentLearnedSkill | null {
    const skill = this.getLearnedSkill(skillId, agentId);
    if (!skill) return null;

    skill.experiencePoints += experienceGained;
    skill.lastPracticedAt = Date.now();

    // Level up logic: every 100 XP = 1 level, max level 5
    const newLevel = Math.min(5, Math.floor(skill.experiencePoints / 100) + 1);
    skill.level = newLevel;

    // Update proficiency (0-100)
    skill.proficiency = Math.min(100, skill.proficiency + Math.floor(experienceGained / 10));

    this.saveLearnedSkill(skill);
    return skill;
  }

  // ============================================
  // Zone Contexts CRUD
  // ============================================

  getZoneContext(zoneId: string): { zoneId: string; contextJson: string; updatedAt: number } | null {
    const row = this.db.prepare(
      'SELECT * FROM zone_contexts_simple WHERE zone_id = ?'
    ).get(zoneId) as any;
    return row ? { zoneId: row.zone_id, contextJson: row.context_json, updatedAt: row.updated_at } : null;
  }

  saveZoneContext(zoneId: string, contextJson: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO zone_contexts_simple (zone_id, context_json, updated_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(zoneId, contextJson, Date.now());
  }

  deleteZoneContext(zoneId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM zone_contexts_simple WHERE zone_id = ?');
    const result = stmt.run(zoneId);
    return result.changes > 0;
  }

  // ============================================
  // Agent Zone Bindings CRUD
  // ============================================

  getZonesForAgent(agentId: string): string[] {
    const rows = this.db.prepare(
      'SELECT zone_id FROM agent_zone_bindings WHERE agent_id = ? ORDER BY joined_at DESC'
    ).all(agentId) as any[];
    return rows.map((r: any) => r.zone_id);
  }

  getAgentsInZone(zoneId: string): string[] {
    const rows = this.db.prepare(
      'SELECT agent_id FROM agent_zone_bindings WHERE zone_id = ? ORDER BY joined_at DESC'
    ).all(zoneId) as any[];
    return rows.map((r: any) => r.agent_id);
  }

  bindAgentToZone(agentId: string, zoneId: string): boolean {
    try {
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO agent_zone_bindings (agent_id, zone_id, joined_at)
        VALUES (?, ?, ?)
      `);
      stmt.run(agentId, zoneId, Date.now());
      return true;
    } catch (e) {
      console.error('[SkillRepository] Failed to bind agent to zone:', e);
      return false;
    }
  }

  unbindAgentFromZone(agentId: string, zoneId: string): boolean {
    const stmt = this.db.prepare(
      'DELETE FROM agent_zone_bindings WHERE agent_id = ? AND zone_id = ?'
    );
    const result = stmt.run(agentId, zoneId);
    return result.changes > 0;
  }

  unbindAgentFromAllZones(agentId: string): number {
    const stmt = this.db.prepare('DELETE FROM agent_zone_bindings WHERE agent_id = ?');
    const result = stmt.run(agentId);
    return result.changes;
  }

  // ============================================
  // Private Mappers
  // ============================================

  private mapRowToSharedSkill(row: any): SharedSkill {
    return {
      skillId: row.skill_id,
      name: row.name,
      description: row.description || '',
      category: row.category as SkillCategory,
      icon: row.icon,
      mcpTool: row.mcp_tool,
      endpoint: row.endpoint,
      provider: (row.provider || 'builtin') as SkillProvider,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapRowToSharedSkillInstall(row: any): SharedSkillInstall {
    return {
      skillId: row.skill_id,
      agentId: row.agent_id,
      installedAt: row.installed_at,
      installedBy: row.installed_by
    };
  }

  private mapRowToAgentLearnedSkill(row: any): AgentLearnedSkill {
    return {
      skillId: row.skill_id,
      agentId: row.agent_id,
      name: row.name,
      description: row.description || '',
      category: row.category as SkillCategory,
      level: row.level,
      experiencePoints: row.experience_points,
      proficiency: row.proficiency,
      certified: !!row.certified,
      learnedFrom: row.learned_from,
      learnedAt: row.learned_at,
      lastPracticedAt: row.last_practiced_at || row.learned_at
    };
  }
}

export const skillRepository = new SkillRepository();
