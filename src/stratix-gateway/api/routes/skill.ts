/**
 * Skill Routes - 技能 CRUD API
 * 提供共享技能库、技能安装、学会技能的管理接口
 */

import { Router, Request, Response } from 'express';

import { BUILTIN_SKILLS, SKILLS_BY_CATEGORY } from '../../../stratix-agent/core/BuiltinSkills';
import { skillAuditLogger, type AuditLogQuery } from '../../../stratix-agent/core/SkillAuditLogger';
import type { SkillCategory, SkillProvider } from '../../../stratix-agent/types';
import { skillRepository, type SharedSkill, type SharedSkillInstall, type AgentLearnedSkill } from '../../../stratix-database/SkillRepository';

const router = Router();

// ============================================
// Builtin Skills API
// ============================================

/**
 * GET /api/skills/builtin
 * 获取所有内置技能
 */
router.get('/builtin', async (req: Request, res: Response): Promise<void> => {
  try {
    const { category } = req.query as { category?: string };

    let skills = BUILTIN_SKILLS;
    if (category && SKILLS_BY_CATEGORY[category as keyof typeof SKILLS_BY_CATEGORY]) {
      const skillIds = SKILLS_BY_CATEGORY[category as keyof typeof SKILLS_BY_CATEGORY];
      skills = BUILTIN_SKILLS.filter(s => skillIds.includes(s.skillId));
    }

    res.json({
      success: true,
      data: skills,
      categories: SKILLS_BY_CATEGORY,
      total: skills.length
    });
  } catch (error) {
    console.error('[Skill API] Failed to get builtin skills:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get builtin skills'
    });
  }
});

/**
 * GET /api/skills/builtin/categories
 * 获取内置技能分类
 */
router.get('/builtin/categories', async (req: Request, res: Response): Promise<void> => {
  try {
    const categoryList = Object.entries(SKILLS_BY_CATEGORY).map(([name, skillIds]) => ({
      name,
      skillIds,
      count: skillIds.length
    }));

    res.json({
      success: true,
      data: categoryList,
      total: categoryList.length
    });
  } catch (error) {
    console.error('[Skill API] Failed to get builtin skill categories:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get builtin skill categories'
    });
  }
});

// ============================================
// Shared Skills API
// ============================================

/**
 * GET /api/skills
 * 获取所有共享技能
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, category } = req.query as { query?: string; category?: SkillCategory };
    const skills = query || category
      ? skillRepository.searchSharedSkills(query || '', category)
      : skillRepository.getAllSharedSkills();

    res.json({
      success: true,
      data: skills,
      total: skills.length
    });
  } catch (error) {
    console.error('[Skill API] Failed to get skills:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get skills'
    });
  }
});

/**
 * GET /api/skills/:skillId
 * 获取单个共享技能详情
 */
router.get('/:skillId', async (req: Request, res: Response): Promise<void> => {
  try {
    const skillId = req.params.skillId as string;
    const skill = skillRepository.getSharedSkill(skillId);

    if (!skill) {
      res.status(404).json({
        success: false,
        error: 'Skill not found'
      });
      return;
    }

    // 获取已安装该技能的 Agent 列表
    const installedAgents = skillRepository.getAgentsWithSkillInstalled(skillId);

    res.json({
      success: true,
      data: {
        ...skill,
        installedAgents
      }
    });
  } catch (error) {
    console.error('[Skill API] Failed to get skill:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get skill'
    });
  }
});

/**
 * POST /api/skills
 * 创建共享技能
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const skill = req.body as SharedSkill;

    if (!skill.skillId || !skill.name) {
      res.status(400).json({
        success: false,
        error: 'skillId and name are required'
      });
      return;
    }

    skill.provider = skill.provider || 'builtin';
    skill.createdAt = skill.createdAt || Date.now();
    skill.updatedAt = skill.updatedAt || Date.now();

    skillRepository.saveSharedSkill(skill);

    res.status(201).json({
      success: true,
      data: skill,
      message: 'Skill created'
    });
  } catch (error) {
    console.error('[Skill API] Failed to create skill:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create skill'
    });
  }
});

/**
 * PUT /api/skills/:skillId
 * 更新共享技能
 */
router.put('/:skillId', async (req: Request, res: Response): Promise<void> => {
  try {
    const skillId = req.params.skillId as string;
    const skillData = req.body as Partial<SharedSkill>;

    const existing = skillRepository.getSharedSkill(skillId);
    if (!existing) {
      res.status(404).json({
        success: false,
        error: 'Skill not found'
      });
      return;
    }

    const updated: SharedSkill = {
      ...existing,
      ...skillData,
      skillId, // 保持不变的 skillId
      updatedAt: Date.now()
    };

    skillRepository.saveSharedSkill(updated);

    res.json({
      success: true,
      data: updated,
      message: 'Skill updated'
    });
  } catch (error) {
    console.error('[Skill API] Failed to update skill:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update skill'
    });
  }
});

/**
 * DELETE /api/skills/:skillId
 * 删除共享技能
 */
router.delete('/:skillId', async (req: Request, res: Response): Promise<void> => {
  try {
    const skillId = req.params.skillId as string;
    const deleted = skillRepository.deleteSharedSkill(skillId);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: 'Skill not found'
      });
      return;
    }

    res.json({
      success: true,
      message: 'Skill deleted'
    });
  } catch (error) {
    console.error('[Skill API] Failed to delete skill:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete skill'
    });
  }
});

// ============================================
// Skill Installs API (Agent-Environment)
// ============================================

/**
 * GET /api/skills/installs/:agentId
 * 获取 Agent 已安装的技能列表
 */
router.get('/installs/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;
    const installs = skillRepository.getInstalledSkillsForAgent(agentId);

    // 获取完整的技能信息
    const skillsWithDetails = installs.map((install: SharedSkillInstall) => {
      const skillInfo = skillRepository.getSharedSkill(install.skillId);
      return {
        ...install,
        skill: skillInfo
      };
    });

    res.json({
      success: true,
      data: skillsWithDetails,
      total: skillsWithDetails.length
    });
  } catch (error) {
    console.error('[Skill API] Failed to get installed skills:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get installed skills'
    });
  }
});

/**
 * POST /api/skills/installs
 * 为 Agent 安装技能
 */
router.post('/installs', async (req: Request, res: Response): Promise<void> => {
  try {
    const { skillId, agentId, installedBy = 'user' } = req.body as {
      skillId: string;
      agentId: string;
      installedBy?: string;
    };

    if (!skillId || !agentId) {
      res.status(400).json({
        success: false,
        error: 'skillId and agentId are required'
      });
      return;
    }

    // 检查技能是否存在
    const skill = skillRepository.getSharedSkill(skillId);
    if (!skill) {
      res.status(404).json({
        success: false,
        error: 'Skill not found'
      });
      return;
    }

    const success = skillRepository.installSkillForAgent(skillId, agentId, installedBy);

    if (success) {
      res.status(201).json({
        success: true,
        message: 'Skill installed for agent',
        data: { skillId, agentId, installedBy }
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to install skill'
      });
    }
  } catch (error) {
    console.error('[Skill API] Failed to install skill:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to install skill'
    });
  }
});

/**
 * DELETE /api/skills/installs
 * 从 Agent 卸载技能
 */
router.delete('/installs', async (req: Request, res: Response): Promise<void> => {
  try {
    const { skillId, agentId } = req.body as { skillId: string; agentId: string };

    if (!skillId || !agentId) {
      res.status(400).json({
        success: false,
        error: 'skillId and agentId are required'
      });
      return;
    }

    const success = skillRepository.uninstallSkillFromAgent(skillId, agentId);

    res.json({
      success,
      message: success ? 'Skill uninstalled from agent' : 'Skill was not installed'
    });
  } catch (error) {
    console.error('[Skill API] Failed to uninstall skill:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to uninstall skill'
    });
  }
});

// ============================================
// Learned Skills API (Agent Personal)
// ============================================

/**
 * GET /api/skills/learned/:agentId
 * 获取 Agent 已学会的技能列表
 */
router.get('/learned/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;
    const learnedSkills = skillRepository.getLearnedSkillsForAgent(agentId);

    res.json({
      success: true,
      data: learnedSkills,
      total: learnedSkills.length
    });
  } catch (error) {
    console.error('[Skill API] Failed to get learned skills:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get learned skills'
    });
  }
});

/**
 * POST /api/skills/learned
 * Agent 学习新技能
 */
router.post('/learned', async (req: Request, res: Response): Promise<void> => {
  try {
    const { skillId, agentId, name, description, category, learnedFrom } = req.body as {
      skillId: string;
      agentId: string;
      name: string;
      description?: string;
      category?: SkillCategory;
      learnedFrom?: string;
    };

    if (!skillId || !agentId || !name) {
      res.status(400).json({
        success: false,
        error: 'skillId, agentId, and name are required'
      });
      return;
    }

    const now = Date.now();
    const learnedSkill: AgentLearnedSkill = {
      skillId,
      agentId,
      name,
      description: description || '',
      category: category || 'collab',
      level: 1,
      experiencePoints: 0,
      proficiency: 0,
      certified: false,
      learnedFrom,
      learnedAt: now,
      lastPracticedAt: now
    };

    skillRepository.saveLearnedSkill(learnedSkill);

    res.status(201).json({
      success: true,
      data: learnedSkill,
      message: 'Skill learned'
    });
  } catch (error) {
    console.error('[Skill API] Failed to learn skill:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to learn skill'
    });
  }
});

/**
 * PUT /api/skills/learned/:skillId/:agentId/practice
 * Agent 练习技能，增加经验
 */
router.put('/learned/:skillId/:agentId/practice', async (req: Request, res: Response): Promise<void> => {
  try {
    const skillId = req.params.skillId as string;
    const agentId = req.params.agentId as string;
    const { experienceGained = 10 } = req.body as { experienceGained?: number };

    const updated = skillRepository.updateLearnedSkillPractice(skillId, agentId, experienceGained);

    if (!updated) {
      res.status(404).json({
        success: false,
        error: 'Learned skill not found'
      });
      return;
    }

    res.json({
      success: true,
      data: updated,
      message: `Gained ${experienceGained} experience`
    });
  } catch (error) {
    console.error('[Skill API] Failed to practice skill:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to practice skill'
    });
  }
});

/**
 * PUT /api/skills/learned/:skillId/:agentId/certify
 * 为技能设置认证状态
 */
router.put('/learned/:skillId/:agentId/certify', async (req: Request, res: Response): Promise<void> => {
  try {
    const skillId = req.params.skillId as string;
    const agentId = req.params.agentId as string;
    const { certified = true } = req.body as { certified?: boolean };

    const skill = skillRepository.getLearnedSkill(skillId, agentId);
    if (!skill) {
      res.status(404).json({
        success: false,
        error: 'Learned skill not found'
      });
      return;
    }

    skill.certified = certified;
    skillRepository.saveLearnedSkill(skill);

    res.json({
      success: true,
      data: skill,
      message: certified ? 'Skill certified' : 'Skill certification revoked'
    });
  } catch (error) {
    console.error('[Skill API] Failed to certify skill:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to certify skill'
    });
  }
});

/**
 * DELETE /api/skills/learned/:skillId/:agentId
 * 删除已学会的技能
 */
router.delete('/learned/:skillId/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const skillId = req.params.skillId as string;
    const agentId = req.params.agentId as string;
    const deleted = skillRepository.deleteLearnedSkill(skillId, agentId);

    res.json({
      success: deleted,
      message: deleted ? 'Learned skill deleted' : 'Learned skill not found'
    });
  } catch (error) {
    console.error('[Skill API] Failed to delete learned skill:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete learned skill'
    });
  }
});

// ============================================
// Audit Logs API
// ============================================

/**
 * GET /api/skills/audit
 * 获取所有审计日志
 */
router.get('/audit', async (req: Request, res: Response): Promise<void> => {
  try {
    const query: AuditLogQuery = {
      agentId: req.query.agentId as string,
      skillId: req.query.skillId as string,
      startTime: req.query.startTime ? parseInt(req.query.startTime as string, 10) : undefined,
      endTime: req.query.endTime ? parseInt(req.query.endTime as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
    };

    const logs = skillAuditLogger.getAllLogs(query);
    const total = skillAuditLogger.getTotalCount();

    res.json({
      success: true,
      data: logs,
      total,
      query
    });
  } catch (error) {
    console.error('[Skill API] Failed to get audit logs:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get audit logs'
    });
  }
});

/**
 * GET /api/skills/audit/:agentId
 * 获取指定 Agent 的审计日志
 */
router.get('/audit/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;
    const query: AuditLogQuery = {
      skillId: req.query.skillId as string,
      startTime: req.query.startTime ? parseInt(req.query.startTime as string, 10) : undefined,
      endTime: req.query.endTime ? parseInt(req.query.endTime as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
    };

    const logs = skillAuditLogger.getLogsByAgent(agentId, query);
    const total = skillAuditLogger.getLogsCountByAgent(agentId);

    res.json({
      success: true,
      data: logs,
      total,
      agentId,
      query
    });
  } catch (error) {
    console.error('[Skill API] Failed to get agent audit logs:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get agent audit logs'
    });
  }
});

/**
 * GET /api/skills/audit/log/:logId
 * 获取指定日志详情
 */
router.get('/audit/log/:logId', async (req: Request, res: Response): Promise<void> => {
  try {
    const logId = req.params.logId as string;
    const log = skillAuditLogger.getLogById(logId);

    if (!log) {
      res.status(404).json({
        success: false,
        error: 'Log not found'
      });
      return;
    }

    res.json({
      success: true,
      data: log
    });
  } catch (error) {
    console.error('[Skill API] Failed to get audit log:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get audit log'
    });
  }
});

/**
 * DELETE /api/skills/audit
 * 清除审计日志
 */
router.delete('/audit', async (req: Request, res: Response): Promise<void> => {
  try {
    const before = req.query.before ? parseInt(req.query.before as string, 10) : undefined;

    if (before) {
      const cleared = skillAuditLogger.clearBefore(before);
      res.json({
        success: true,
        message: `Cleared ${cleared} logs before ${new Date(before).toISOString()}`
      });
    } else {
      skillAuditLogger.clearAll();
      res.json({
        success: true,
        message: 'All audit logs cleared'
      });
    }
  } catch (error) {
    console.error('[Skill API] Failed to clear audit logs:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to clear audit logs'
    });
  }
});

export default router;
