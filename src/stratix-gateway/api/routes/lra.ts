import { Router, Request, Response } from 'express';

import { LRAService } from '../../lra/LRAService';

const router = Router();
const lraService = new LRAService();

/**
 * POST /api/lra/init
 * 初始化 LRA 项目
 */
router.post('/init', async (req: Request, res: Response): Promise<void> => {
  try {
    const { projectPath, name } = req.body;
    
    if (!projectPath || !name) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: projectPath, name'
      });
      return;
    }
    
    await lraService.init(projectPath, name);
    
    res.json({
      success: true,
      message: 'LRA initialized successfully'
    });
  } catch (error) {
    console.error('[LRA API] Init failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to initialize LRA'
    });
  }
});

/**
 * GET /api/lra/tasks
 * 列出所有任务
 */
router.get('/tasks', async (req: Request, res: Response): Promise<void> => {
  try {
    const { projectPath } = req.query;
    
    if (!projectPath) {
      res.status(400).json({
        success: false,
        error: 'Missing required query parameter: projectPath'
      });
      return;
    }
    
    const tasks = await lraService.listTasks(projectPath as string);
    
    res.json({
      success: true,
      tasks
    });
  } catch (error) {
    console.error('[LRA API] List tasks failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list tasks'
    });
  }
});

/**
 * POST /api/lra/tasks
 * 创建任务
 */
router.post('/tasks', async (req: Request, res: Response): Promise<void> => {
  try {
    const { projectPath, description, template } = req.body;
    
    if (!projectPath || !description) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: projectPath, description'
      });
      return;
    }
    
    const taskId = await lraService.createTask(projectPath, description, template);
    
    res.json({
      success: true,
      taskId
    });
  } catch (error) {
    console.error('[LRA API] Create task failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create task'
    });
  }
});

/**
 * POST /api/lra/tasks/:taskId/claim
 * 认领任务
 */
router.post('/tasks/:taskId/claim', async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = req.params.taskId as string;
    const { projectPath } = req.body;
    
    if (!projectPath) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: projectPath'
      });
      return;
    }
    
    const sessionId = await lraService.claimTask(projectPath as string, taskId);
    
    res.json({
      success: true,
      sessionId
    });
  } catch (error) {
    console.error('[LRA API] Claim task failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to claim task'
    });
  }
});

/**
 * POST /api/lra/tasks/:taskId/heartbeat
 * 发送心跳
 */
router.post('/tasks/:taskId/heartbeat', async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = req.params.taskId as string;
    const { projectPath } = req.body;
    
    if (!projectPath) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: projectPath'
      });
      return;
    }
    
    const alive = await lraService.heartbeat(projectPath as string, taskId);
    
    res.json({
      success: true,
      alive
    });
  } catch (error) {
    console.error('[LRA API] Heartbeat failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send heartbeat'
    });
  }
});

/**
 * POST /api/lra/tasks/:taskId/publish
 * 发布任务
 */
router.post('/tasks/:taskId/publish', async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = req.params.taskId as string;
    const { projectPath } = req.body;
    
    if (!projectPath) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: projectPath'
      });
      return;
    }
    
    const published = await lraService.publish(projectPath as string, taskId);
    
    res.json({
      success: true,
      published
    });
  } catch (error) {
    console.error('[LRA API] Publish task failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to publish task'
    });
  }
});

/**
 * PUT /api/lra/tasks/:taskId/status
 * 设置任务状态
 */
router.put('/tasks/:taskId/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = req.params.taskId as string;
    const { projectPath, status } = req.body;
    
    if (!projectPath || !status) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: projectPath, status'
      });
      return;
    }
    
    await lraService.setTaskStatus(projectPath as string, taskId, status as string);
    
    res.json({
      success: true
    });
  } catch (error) {
    console.error('[LRA API] Set task status failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to set task status'
    });
  }
});

/**
 * GET /api/lra/tasks/:taskId
 * 获取任务详情
 */
router.get('/tasks/:taskId', async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = req.params.taskId as string;
    const { projectPath } = req.query;
    
    if (!projectPath) {
      res.status(400).json({
        success: false,
        error: 'Missing required query parameter: projectPath'
      });
      return;
    }
    
    const task = await lraService.showTask(projectPath as string, taskId);
    
    res.json({
      success: true,
      task
    });
  } catch (error) {
    console.error('[LRA API] Show task failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get task details'
    });
  }
});

export default router;
