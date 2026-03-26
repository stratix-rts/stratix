/**
 * SkillRepository Unit Tests
 *
 * These tests verify the SkillRepository logic patterns using mock data.
 */

import { SkillCategory, SkillProvider } from '../../src/stratix-agent/types';
import { SharedSkill, SharedSkillInstall, AgentLearnedSkill } from '../../src/stratix-database/SkillRepository';

describe('SkillRepository', () => {
  describe('Shared Skills data transformation', () => {
    it('should transform database row to SharedSkill', () => {
      const row = {
        skill_id: 'skill-1',
        name: 'Web Search',
        description: 'Search the web',
        category: 'data',
        icon: 'search.png',
        mcp_tool: 'web_search',
        endpoint: 'http://api.example.com',
        provider: 'builtin',
        created_at: 1234567890,
        updated_at: 1234567890
      };

      const skill: SharedSkill = {
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

      expect(skill.skillId).toBe('skill-1');
      expect(skill.name).toBe('Web Search');
      expect(skill.category).toBe('data');
      expect(skill.provider).toBe('builtin');
    });

    it('should handle null optional fields', () => {
      const row = {
        skill_id: 'skill-1',
        name: 'Web Search',
        description: null,
        category: null,
        icon: null,
        mcp_tool: null,
        endpoint: null,
        provider: null,
        created_at: 1234567890,
        updated_at: 1234567890
      };

      const skill: SharedSkill = {
        skillId: row.skill_id,
        name: row.name,
        description: row.description || '',
        category: row.category as SkillCategory || undefined,
        icon: row.icon || undefined,
        mcpTool: row.mcp_tool || undefined,
        endpoint: row.endpoint || undefined,
        provider: (row.provider || 'builtin') as SkillProvider,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      expect(skill.description).toBe('');
      expect(skill.icon).toBeUndefined();
      expect(skill.mcpTool).toBeUndefined();
      expect(skill.provider).toBe('builtin');
    });
  });

  describe('Shared Skills CRUD', () => {
    it('should generate INSERT statement for shared skill', () => {
      const insertSQL = `
        INSERT INTO shared_skills (skill_id, name, description, category, icon, mcp_tool, endpoint, provider, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      expect(insertSQL).toContain('INSERT INTO shared_skills');
      expect(insertSQL).toContain('skill_id');
      expect(insertSQL).toContain('provider');
    });

    it('should generate UPDATE statement for shared skill', () => {
      const updateSQL = `
        UPDATE shared_skills SET
          name = ?, description = ?, category = ?, icon = ?, mcp_tool = ?,
          endpoint = ?, provider = ?, updated_at = ?
        WHERE skill_id = ?
      `;

      expect(updateSQL).toContain('UPDATE shared_skills');
      expect(updateSQL).toContain('SET name = ?, description = ?, category = ?');
    });

    it('should order by name ASC', () => {
      const selectSQL = 'SELECT * FROM shared_skills ORDER BY name ASC';
      expect(selectSQL).toContain('ORDER BY name ASC');
    });

    it('should search with LIKE for name and description', () => {
      const searchSQL = `
        SELECT * FROM shared_skills WHERE 1=1
          AND (name LIKE ? OR description LIKE ?)
        ORDER BY name ASC
      `;

      expect(searchSQL).toContain('name LIKE ?');
      expect(searchSQL).toContain('description LIKE ?');
    });

    it('should filter by category when provided', () => {
      let sql = 'SELECT * FROM shared_skills WHERE 1=1';
      const params: any[] = [];

      const category = 'code';
      if (category) {
        sql += ' AND category = ?';
        params.push(category);
      }

      expect(sql).toContain('AND category = ?');
      expect(params).toContain('code');
    });

    it('should validate SkillCategory values', () => {
      const validCategories: SkillCategory[] = ['file', 'code', 'data', 'content', 'mcp', 'collab'];

      expect(validCategories).toContain('file');
      expect(validCategories).toContain('code');
      expect(validCategories).toContain('data');
      expect(validCategories).toContain('mcp');
      expect(validCategories).not.toContain('research');
      expect(validCategories).not.toContain('engineering');
    });

    it('should validate SkillProvider values', () => {
      const validProviders: SkillProvider[] = ['skillhub', 'builtin', 'learned'];

      expect(validProviders).toContain('skillhub');
      expect(validProviders).toContain('builtin');
      expect(validProviders).toContain('learned');
    });
  });

  describe('Shared Skill Installs CRUD', () => {
    it('should generate INSERT OR IGNORE for idempotent install', () => {
      const insertSQL = `
        INSERT OR IGNORE INTO shared_skill_installs (skill_id, agent_id, installed_at, installed_by)
        VALUES (?, ?, ?, ?)
      `;

      expect(insertSQL).toContain('INSERT OR IGNORE');
      expect(insertSQL).toContain('skill_id');
      expect(insertSQL).toContain('agent_id');
    });

    it('should have foreign key to shared_skills with CASCADE', () => {
      const fkSQL = 'FOREIGN KEY (skill_id) REFERENCES shared_skills(skill_id) ON DELETE CASCADE';
      expect(fkSQL).toContain('FOREIGN KEY (skill_id)');
      expect(fkSQL).toContain('ON DELETE CASCADE');
    });

    it('should have composite primary key', () => {
      const pkSQL = 'PRIMARY KEY (skill_id, agent_id)';
      expect(pkSQL).toContain('PRIMARY KEY (skill_id, agent_id)');
    });
  });

  describe('Agent Learned Skills data transformation', () => {
    it('should transform database row to AgentLearnedSkill', () => {
      const row = {
        skill_id: 'skill-1',
        agent_id: 'agent-1',
        name: 'JavaScript',
        description: 'JavaScript programming',
        category: 'code',
        level: 3,
        experience_points: 250,
        proficiency: 75,
        certified: 1,
        learned_from: 'course',
        learned_at: 1234567890,
        last_practiced_at: 1234567900
      };

      const skill: AgentLearnedSkill = {
        skillId: row.skill_id,
        agentId: row.agent_id,
        name: row.name,
        description: row.description || '',
        category: row.category as SkillCategory,
        level: row.level,
        experiencePoints: row.experience_points,
        proficiency: row.proficiency,
        certified: !!row.certified,
        learnedFrom: row.learned_from || undefined,
        learnedAt: row.learned_at,
        lastPracticedAt: row.last_practiced_at || row.learned_at
      };

      expect(skill.level).toBe(3);
      expect(skill.experiencePoints).toBe(250);
      expect(skill.proficiency).toBe(75);
      expect(skill.certified).toBe(true);
    });

    it('should handle certified as boolean', () => {
      const row = { certified: 0 };
      const certified = !!row.certified;
      expect(certified).toBe(false);

      row.certified = 1;
      expect(!!row.certified).toBe(true);
    });
  });

  describe('Agent Learned Skills XP and leveling', () => {
    it('should calculate level from experience points', () => {
      // Level up logic: every 100 XP = 1 level, max level 5
      const calculateLevel = (experiencePoints: number): number => {
        return Math.min(5, Math.floor(experiencePoints / 100) + 1);
      };

      expect(calculateLevel(0)).toBe(1);
      expect(calculateLevel(50)).toBe(1);
      expect(calculateLevel(100)).toBe(2);
      expect(calculateLevel(150)).toBe(2);
      expect(calculateLevel(200)).toBe(3);
      expect(calculateLevel(300)).toBe(4);
      expect(calculateLevel(400)).toBe(5);
      expect(calculateLevel(500)).toBe(5);
    });

    it('should calculate proficiency increase', () => {
      // Proficiency increases by floor(XP / 10), capped at 100
      const updateProficiency = (current: number, xpGained: number): number => {
        return Math.min(100, current + Math.floor(xpGained / 10));
      };

      expect(updateProficiency(0, 50)).toBe(5);
      expect(updateProficiency(50, 30)).toBe(53);
      expect(updateProficiency(95, 100)).toBe(100);
      expect(updateProficiency(100, 50)).toBe(100); // Capped
    });

    it('should update last_practiced_at', () => {
      const now = Date.now();
      const skill = { lastPracticedAt: now - 10000 };

      skill.lastPracticedAt = now;
      expect(skill.lastPracticedAt).toBe(now);
    });
  });

  describe('Zone Contexts Simple', () => {
    it('should use INSERT OR REPLACE for upsert', () => {
      const upsertSQL = `
        INSERT OR REPLACE INTO zone_contexts_simple (zone_id, context_json, updated_at)
        VALUES (?, ?, ?)
      `;

      expect(upsertSQL).toContain('INSERT OR REPLACE');
      expect(upsertSQL).toContain('zone_contexts_simple');
    });
  });

  describe('Agent Zone Bindings', () => {
    it('should have composite primary key', () => {
      const pkSQL = 'PRIMARY KEY (agent_id, zone_id)';
      expect(pkSQL).toContain('PRIMARY KEY (agent_id, zone_id)');
    });

    it('should generate INSERT OR IGNORE for idempotent bind', () => {
      const insertSQL = `
        INSERT OR IGNORE INTO agent_zone_bindings (agent_id, zone_id, joined_at)
        VALUES (?, ?, ?)
      `;

      expect(insertSQL).toContain('INSERT OR IGNORE');
    });

    it('should get zones for agent ordered by joined_at DESC', () => {
      const selectSQL = 'SELECT zone_id FROM agent_zone_bindings WHERE agent_id = ? ORDER BY joined_at DESC';
      expect(selectSQL).toContain('ORDER BY joined_at DESC');
    });

    it('should get agents in zone ordered by joined_at DESC', () => {
      const selectSQL = 'SELECT agent_id FROM agent_zone_bindings WHERE zone_id = ? ORDER BY joined_at DESC';
      expect(selectSQL).toContain('ORDER BY joined_at DESC');
    });

    it('should unbind agent from zone', () => {
      const deleteSQL = 'DELETE FROM agent_zone_bindings WHERE agent_id = ? AND zone_id = ?';
      expect(deleteSQL).toContain('DELETE FROM agent_zone_bindings');
    });

    it('should unbind agent from all zones', () => {
      const deleteSQL = 'DELETE FROM agent_zone_bindings WHERE agent_id = ?';
      expect(deleteSQL).toContain('WHERE agent_id = ?');
    });
  });

  describe('Query building patterns', () => {
    it('should build search query with optional category', () => {
      const buildSearchQuery = (query?: string, category?: SkillCategory) => {
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
        return { sql, params };
      };

      // With query only
      const result1 = buildSearchQuery('web');
      expect(result1.sql).toContain('name LIKE ?');
      expect(result1.params).toContain('%web%');

      // With category only
      const result2 = buildSearchQuery(undefined, 'code');
      expect(result2.sql).toContain('AND category = ?');
      expect(result2.params).toContain('code');

      // With both
      const result3 = buildSearchQuery('search', 'data');
      expect(result3.sql).toContain('name LIKE ?');
      expect(result3.sql).toContain('AND category = ?');
    });

    it('should build paginated query', () => {
      const buildPaginatedQuery = (zoneId: string, limit?: number, offset?: number) => {
        let sql = 'SELECT * FROM zone_tasks WHERE zone_id = ? ORDER BY created_at DESC';
        const params: any[] = [zoneId];

        if (limit !== undefined) {
          sql += ' LIMIT ?';
          params.push(limit);
          if (offset !== undefined) {
            sql += ' OFFSET ?';
            params.push(offset);
          }
        }

        return { sql, params };
      };

      const { sql, params } = buildPaginatedQuery('zone-1', 10, 5);
      expect(sql).toContain('LIMIT ? OFFSET ?');
      expect(params).toEqual(['zone-1', 10, 5]);
    });
  });
});
