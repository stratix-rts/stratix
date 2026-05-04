/**
 * SkillRepository - 技能数据库操作
 * 处理 shared_skills、shared_skill_installs、agent_learned_skills 表的 CRUD 操作
 */

import type { Database, Statement } from './sqlite-adapter';

import type { SkillCategory, SkillProvider } from '../stratix-agent/types';

import { getDatabase } from './StratixDatabase';

const XP_PER_LEVEL = 100;
const MAX_LEVEL = 5;
const MAX_PROFICIENCY = 100;
const PROFICIENCY_GAIN_DIVISOR = 10;

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

interface SharedSkillRow {
  skill_id: string;
  name: string;
  description: string;
  category: string;
  icon: string | null;
  mcp_tool: string | null;
  endpoint: string | null;
  provider: string;
  created_at: number;
  updated_at: number;
}

interface SharedSkillInstallRow {
  skill_id: string;
  agent_id: string;
  installed_at: number;
  installed_by: string;
}

interface AgentLearnedSkillRow {
  skill_id: string;
  agent_id: string;
  name: string;
  description: string;
  category: string;
  level: number;
  experience_points: number;
  proficiency: number;
  certified: number;
  learned_from: string | null;
  learned_at: number;
  last_practiced_at: number;
}

interface ZoneContextRow {
  zone_id: string;
  context_json: string;
  updated_at: number;
}

interface AgentZoneBindingRow {
  zone_id: string;
  agent_id: string;
  joined_at: number;
}

function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[SkillRepository] ${message}`, ctx || '');
}

export class SkillRepository {
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

  // ============================================
  // Shared Skills CRUD
  // ============================================

  getAllSharedSkills(): SharedSkill[] {
    const rows = this.stmt('SELECT * FROM shared_skills ORDER BY name ASC').all() as SharedSkillRow[];
    return rows.map(this.mapRowToSharedSkill);
  }

  getSharedSkill(skillId: string): SharedSkill | null {
    const row = this.stmt('SELECT * FROM shared_skills WHERE skill_id = ?').get(skillId) as SharedSkillRow | undefined;
    return row ? this.mapRowToSharedSkill(row) : null;
  }

  /**
   * 保存共享技能（UPSERT，避免先查后写的竞态条件）
   */
  saveSharedSkill(skill: SharedSkill): void {
    const now = Date.now();
    this.stmt(`
      INSERT INTO shared_skills (skill_id, name, description, category, icon, mcp_tool, endpoint, provider, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(skill_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        category = excluded.category,
        icon = excluded.icon,
        mcp_tool = excluded.mcp_tool,
        endpoint = excluded.endpoint,
        provider = excluded.provider,
        updated_at = excluded.updated_at
    `).run(
      skill.skillId,
      skill.name,
      skill.description,
      skill.category,
      skill.icon || null,
      skill.mcpTool || null,
      skill.endpoint || null,
      skill.provider,
      skill.createdAt || now,
      skill.updatedAt || now
    );
  }

  deleteSharedSkill(skillId: string): boolean {
    const result = this.stmt('DELETE FROM shared_skills WHERE skill_id = ?').run(skillId);
    return result.changes > 0;
  }

  searchSharedSkills(query: string, category?: SkillCategory): SharedSkill[] {
    let sql = 'SELECT * FROM shared_skills WHERE 1=1';
    const params: (string | SkillCategory)[] = [];

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

    const rows = this.stmt(sql).all(...params) as SharedSkillRow[];
    return rows.map(this.mapRowToSharedSkill);
  }

  // ============================================
  // Shared Skill Installs CRUD
  // ============================================

  getInstalledSkillsForAgent(agentId: string): SharedSkillInstall[] {
    const rows = this.stmt(
      'SELECT * FROM shared_skill_installs WHERE agent_id = ? ORDER BY installed_at DESC'
    ).all(agentId) as SharedSkillInstallRow[];
    return rows.map(this.mapRowToSharedSkillInstall);
  }

  getAgentsWithSkillInstalled(skillId: string): string[] {
    const rows = this.stmt(
      'SELECT agent_id FROM shared_skill_installs WHERE skill_id = ?'
    ).all(skillId) as Array<{ agent_id: string }>;
    return rows.map(r => r.agent_id);
  }

  isSkillInstalledForAgent(skillId: string, agentId: string): boolean {
    const row = this.stmt(
      'SELECT 1 FROM shared_skill_installs WHERE skill_id = ? AND agent_id = ?'
    ).get(skillId, agentId);
    return !!row;
  }

  installSkillForAgent(skillId: string, agentId: string, installedBy: string): boolean {
    try {
      this.stmt(`
        INSERT OR IGNORE INTO shared_skill_installs (skill_id, agent_id, installed_at, installed_by)
        VALUES (?, ?, ?, ?)
      `).run(skillId, agentId, Date.now(), installedBy);
      return true;
    } catch (e) {
      log('error', 'Failed to install skill', { skillId, agentId, error: String(e) });
      return false;
    }
  }

  uninstallSkillFromAgent(skillId: string, agentId: string): boolean {
    const result = this.stmt(
      'DELETE FROM shared_skill_installs WHERE skill_id = ? AND agent_id = ?'
    ).run(skillId, agentId);
    return result.changes > 0;
  }

  // ============================================
  // Agent Learned Skills CRUD
  // ============================================

  getLearnedSkillsForAgent(agentId: string): AgentLearnedSkill[] {
    const rows = this.stmt(
      'SELECT * FROM agent_learned_skills WHERE agent_id = ? ORDER BY learned_at DESC'
    ).all(agentId) as AgentLearnedSkillRow[];
    return rows.map(this.mapRowToAgentLearnedSkill);
  }

  getLearnedSkill(skillId: string, agentId: string): AgentLearnedSkill | null {
    const row = this.stmt(
      'SELECT * FROM agent_learned_skills WHERE skill_id = ? AND agent_id = ?'
    ).get(skillId, agentId) as AgentLearnedSkillRow | undefined;
    return row ? this.mapRowToAgentLearnedSkill(row) : null;
  }

  /**
   * 保存 Agent 学会的技能（UPSERT，避免先查后写的竞态条件）
   */
  saveLearnedSkill(skill: AgentLearnedSkill): void {
    this.stmt(`
      INSERT INTO agent_learned_skills (skill_id, agent_id, name, description, category, level, experience_points, proficiency, certified, learned_from, learned_at, last_practiced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(skill_id, agent_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        category = excluded.category,
        level = excluded.level,
        experience_points = excluded.experience_points,
        proficiency = excluded.proficiency,
        certified = excluded.certified,
        learned_from = excluded.learned_from,
        last_practiced_at = excluded.last_practiced_at
    `).run(
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

  deleteLearnedSkill(skillId: string, agentId: string): boolean {
    const result = this.stmt(
      'DELETE FROM agent_learned_skills WHERE skill_id = ? AND agent_id = ?'
    ).run(skillId, agentId);
    return result.changes > 0;
  }

  /**
   * 更新技能练习记录（事务包装）
   */
  updateLearnedSkillPractice(skillId: string, agentId: string, experienceGained: number): AgentLearnedSkill | null {
    const skill = this.getLearnedSkill(skillId, agentId);
    if (!skill) return null;

    skill.experiencePoints += experienceGained;
    skill.lastPracticedAt = Date.now();

    // Level up logic: every 100 XP = 1 level, max level 5
    const newLevel = Math.min(MAX_LEVEL, Math.floor(skill.experiencePoints / XP_PER_LEVEL) + 1);
    skill.level = newLevel;

    // Update proficiency (0-100)
    skill.proficiency = Math.min(MAX_PROFICIENCY, skill.proficiency + Math.floor(experienceGained / PROFICIENCY_GAIN_DIVISOR));

    // Wrap save in transaction to ensure atomicity
    const tx = this.db.transaction(() => {
      this.saveLearnedSkill(skill);
    });
    tx();

    return skill;
  }

  // ============================================
  // Zone Contexts CRUD
  // ============================================

  getZoneContext(zoneId: string): { zoneId: string; contextJson: string; updatedAt: number } | null {
    const row = this.stmt(
      'SELECT * FROM zone_contexts_simple WHERE zone_id = ?'
    ).get(zoneId) as ZoneContextRow | undefined;
    return row ? { zoneId: row.zone_id, contextJson: row.context_json, updatedAt: row.updated_at } : null;
  }

  saveZoneContext(zoneId: string, contextJson: string): void {
    this.stmt(`
      INSERT OR REPLACE INTO zone_contexts_simple (zone_id, context_json, updated_at)
      VALUES (?, ?, ?)
    `).run(zoneId, contextJson, Date.now());
  }

  deleteZoneContext(zoneId: string): boolean {
    const result = this.stmt('DELETE FROM zone_contexts_simple WHERE zone_id = ?').run(zoneId);
    return result.changes > 0;
  }

  // ============================================
  // Agent Zone Bindings CRUD
  // ============================================

  getZonesForAgent(agentId: string): string[] {
    const rows = this.stmt(
      'SELECT zone_id FROM agent_zone_bindings WHERE agent_id = ? ORDER BY joined_at DESC'
    ).all(agentId) as Array<{ zone_id: string }>;
    return rows.map(r => r.zone_id);
  }

  getAgentsInZone(zoneId: string): string[] {
    const rows = this.stmt(
      'SELECT agent_id FROM agent_zone_bindings WHERE zone_id = ? ORDER BY joined_at DESC'
    ).all(zoneId) as Array<{ agent_id: string }>;
    return rows.map(r => r.agent_id);
  }

  bindAgentToZone(agentId: string, zoneId: string): boolean {
    try {
      this.stmt(`
        INSERT OR IGNORE INTO agent_zone_bindings (agent_id, zone_id, joined_at)
        VALUES (?, ?, ?)
      `).run(agentId, zoneId, Date.now());
      return true;
    } catch (e) {
      log('error', 'Failed to bind agent to zone', { agentId, zoneId, error: String(e) });
      return false;
    }
  }

  unbindAgentFromZone(agentId: string, zoneId: string): boolean {
    const result = this.stmt(
      'DELETE FROM agent_zone_bindings WHERE agent_id = ? AND zone_id = ?'
    ).run(agentId, zoneId);
    return result.changes > 0;
  }

  unbindAgentFromAllZones(agentId: string): number {
    const result = this.stmt('DELETE FROM agent_zone_bindings WHERE agent_id = ?').run(agentId);
    return result.changes;
  }

  // ============================================
  // Private Mappers
  // ============================================

  private mapRowToSharedSkill(row: SharedSkillRow): SharedSkill {
    return {
      skillId: row.skill_id,
      name: row.name,
      description: row.description || '',
      category: row.category as SkillCategory,
      icon: row.icon ?? undefined,
      mcpTool: row.mcp_tool ?? undefined,
      endpoint: row.endpoint ?? undefined,
      provider: (row.provider || 'builtin') as SkillProvider,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapRowToSharedSkillInstall(row: SharedSkillInstallRow): SharedSkillInstall {
    return {
      skillId: row.skill_id,
      agentId: row.agent_id,
      installedAt: row.installed_at,
      installedBy: row.installed_by
    };
  }

  private mapRowToAgentLearnedSkill(row: AgentLearnedSkillRow): AgentLearnedSkill {
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
      learnedFrom: row.learned_from ?? undefined,
      learnedAt: row.learned_at,
      lastPracticedAt: row.last_practiced_at || row.learned_at
    };
  }
}

export const skillRepository = new SkillRepository();
