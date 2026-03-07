import { Router, Request, Response } from 'express';
import { ProjectService } from '../../project/ProjectService';
import { ProjectConfig, ProjectZoneConfig, ProjectStatus } from '../../../stratix-project/types';

const router = Router();
const projectService = new ProjectService();

/**
 * POST /api/projects/initialize
 * 初始化项目存储
 */
router.post('/initialize', async (req: Request, res: Response): Promise<void> => {
  try {
    await projectService.initialize();
    res.json({
      success: true,
      message: 'Project service initialized'
    });
  } catch (error) {
    console.error('[Project API] Initialize failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to initialize project service'
    });
  }
});

/**
 * GET /api/projects
 * 列出所有项目
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, priority } = req.query;
    
    let projects;
    if (status) {
      projects = await projectService.getProjectsByStatus(status as ProjectStatus);
    } else if (priority) {
      projects = await projectService.getProjectsByPriority(parseInt(priority as string));
    } else {
      projects = await projectService.getAllProjects();
    }
    
    res.json({
      success: true,
      projects
    });
  } catch (error) {
    console.error('[Project API] Get projects failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get projects'
    });
  }
});

/**
 * POST /api/projects
 * 创建项目
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { config, zoneConfig } = req.body;
    
    if (!config) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: config'
      });
      return;
    }
    
    const project = await projectService.createProject(
      config as ProjectConfig,
      zoneConfig as Partial<ProjectZoneConfig>
    );
    
    res.json({
      success: true,
      project
    });
  } catch (error) {
    console.error('[Project API] Create project failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create project'
    });
  }
});

/**
 * GET /api/projects/:id
 * 获取项目详情
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const project = await projectService.getProject(projectId);
    
    if (!project) {
      res.status(404).json({
        success: false,
        error: 'Project not found'
      });
      return;
    }
    
    res.json({
      success: true,
      project
    });
  } catch (error) {
    console.error('[Project API] Get project failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get project'
    });
  }
});

/**
 * PUT /api/projects/:id
 * 更新项目
 */
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const updates = req.body.updates;
    
    if (!updates) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: updates'
      });
      return;
    }
    
    const project = await projectService.updateProject(projectId, updates);
    
    res.json({
      success: true,
      project
    });
  } catch (error) {
    console.error('[Project API] Update project failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update project'
    });
  }
});

/**
 * DELETE /api/projects/:id
 * 删除项目
 */
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const deleted = await projectService.deleteProject(projectId);
    
    if (!deleted) {
      res.status(404).json({
        success: false,
        error: 'Project not found'
      });
      return;
    }
    
    res.json({
      success: true,
      message: 'Project deleted'
    });
  } catch (error) {
    console.error('[Project API] Delete project failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete project'
    });
  }
});

/**
 * POST /api/projects/:id/start
 * 启动项目
 */
router.post('/:id/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const project = await projectService.startProject(projectId);
    
    res.json({
      success: true,
      project
    });
  } catch (error) {
    console.error('[Project API] Start project failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start project'
    });
  }
});

/**
 * POST /api/projects/:id/pause
 * 暂停项目
 */
router.post('/:id/pause', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const project = await projectService.pauseProject(projectId);
    
    res.json({
      success: true,
      project
    });
  } catch (error) {
    console.error('[Project API] Pause project failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to pause project'
    });
  }
});

/**
 * POST /api/projects/:id/complete
 * 完成项目
 */
router.post('/:id/complete', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const project = await projectService.completeProject(projectId);
    
    res.json({
      success: true,
      project
    });
  } catch (error) {
    console.error('[Project API] Complete project failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to complete project'
    });
  }
});

/**
 * POST /api/projects/:id/fail
 * 标记项目失败
 */
router.post('/:id/fail', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const project = await projectService.failProject(projectId);
    
    res.json({
      success: true,
      project
    });
  } catch (error) {
    console.error('[Project API] Fail project failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to mark project as failed'
    });
  }
});

/**
 * POST /api/projects/:id/agents/enter
 * Agent 进入项目
 */
router.post('/:id/agents/enter', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const { agentId } = req.body;
    
    if (!agentId) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: agentId'
      });
      return;
    }
    
    const project = await projectService.agentEnterProject(projectId, agentId);
    
    res.json({
      success: true,
      project
    });
  } catch (error) {
    console.error('[Project API] Agent enter failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add agent to project'
    });
  }
});

/**
 * POST /api/projects/:id/agents/leave
 * Agent 离开项目
 */
router.post('/:id/agents/leave', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const { agentId } = req.body;
    
    if (!agentId) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: agentId'
      });
      return;
    }
    
    const project = await projectService.agentLeaveProject(projectId, agentId);
    
    res.json({
      success: true,
      project
    });
  } catch (error) {
    console.error('[Project API] Agent leave failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove agent from project'
    });
  }
});

/**
 * GET /api/projects/metadata/info
 * 获取数据库元数据
 */
router.get('/metadata/info', async (req: Request, res: Response): Promise<void> => {
  try {
    const metadata = await projectService.getMetadata();
    
    res.json({
      success: true,
      metadata
    });
  } catch (error) {
    console.error('[Project API] Get metadata failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get metadata'
    });
  }
});

export default router;
