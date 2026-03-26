import { Router, Request, Response } from 'express';
import { ProjectService } from '../../project/ProjectService';
import { ProjectConfig, ProjectZoneConfig, ProjectStatus, ProjectChannel, ProjectChannelMessage, MessageSender } from '../../../stratix-project/types';
import { StatusSyncService } from '../websocket/StatusSync';
import { AgentOrchestrationService } from '../../agent/AgentOrchestrationService';
import { dataStoreService } from '../../dataStoreService';
import { StratixAgentConfig } from '../../../stratix-core';
import { gatewayEventBus } from '../../GatewayEventBus';

const router = Router();
const projectService = new ProjectService();
const orchestrator = AgentOrchestrationService.getInstance();
let statusSyncService: StatusSyncService | null = null;

export function setStatusSyncService(service: StatusSyncService) {
  statusSyncService = service;
}

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
      projects = await projectService.getProjects();
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
 * PATCH /api/projects/:id/zone-context-link
 * 更新项目的 zone_context_id FK
 */
router.patch('/:id/zone-context-link', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.id as string;
    const { zoneContextId } = req.body;

    if (!zoneContextId) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: zoneContextId'
      });
      return;
    }

    await projectService.updateZoneContextId(zoneId, zoneContextId);

    res.json({
      success: true,
      message: 'Zone context link updated'
    });
  } catch (error) {
    console.error('[Project API] Update zone context link failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update zone context link'
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
    
    // 1. Agent 进入项目并订阅 channel
    const project = await projectService.agentEnterProject(projectId, agentId);
    
    // 2. 获取 project 路径
    const projectPath = project.path;
    if (!projectPath) {
      console.warn(`[Project API] Project ${projectId} has no path, cannot start agent`);
    } else {
      // 3. 获取 Agent 配置并启动 Agent
      try {
        // 从 dataStore 获取 agent 配置
        const agentConfig = await dataStoreService.getStore().getAgent(agentId) as StratixAgentConfig | null;
        
        if (agentConfig) {
          // 注册 agent 配置
          orchestrator.registerAgentConfig(agentId, agentConfig);
          
          // 启动 agent
          await orchestrator.startAgent(agentId, projectPath, projectId);
          console.log(`[Project API] Agent ${agentId} auto-started for project ${projectId}`);
        } else {
          console.warn(`[Project API] Agent ${agentId} config not found in dataStore, cannot auto-start`);
        }
      } catch (startError) {
        console.error(`[Project API] Failed to auto-start agent ${agentId}:`, startError);
        // 不阻止 agent 进入项目，只是记录错误
      }
    }
    
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
    
    // 1. Agent 离开项目并取消订阅 channel
    const project = await projectService.agentLeaveProject(projectId, agentId);
    
    // 2. 停止 Agent
    try {
      await orchestrator.stopAgent(agentId);
      console.log(`[Project API] Agent ${agentId} auto-stopped for project ${projectId}`);
    } catch (stopError) {
      console.error(`[Project API] Failed to auto-stop agent ${agentId}:`, stopError);
      // 不阻止 agent 离开项目，只是记录错误
    }
    
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

// ============================================
// Channel API
// ============================================

/**
 * GET /api/projects/:id/channels
 * 获取项目的Channel列表
 */
router.get('/:id/channels', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const channels = await projectService.getChannels(projectId);
    
    res.json({
      success: true,
      channels
    });
  } catch (error) {
    console.error('[Project API] Get channels failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get channels'
    });
  }
});

/**
 * POST /api/projects/:id/channels
 * 创建Channel
 */
router.post('/:id/channels', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const { name, type, description } = req.body;
    
    if (!name || !type) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: name, type'
      });
      return;
    }
    
    const channel = await projectService.createChannel(projectId, name as string, type as ProjectChannel['type'], description as string | undefined);
    
    res.json({
      success: true,
      channel
    });
  } catch (error) {
    console.error('[Project API] Create channel failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create channel'
    });
  }
});

/**
 * PUT /api/projects/:id/channels/:channelId/subscribe
 * 订阅Channel
 */
router.put('/:id/channels/:channelId/subscribe', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const channelId = req.params.channelId as string;
    const { agentId } = req.body;
    
    if (!agentId) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: agentId'
      });
      return;
    }
    
    const channel = await projectService.subscribeChannel(projectId, channelId, agentId as string);
    
    res.json({
      success: true,
      channel
    });
  } catch (error) {
    console.error('[Project API] Subscribe channel failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to subscribe channel'
    });
  }
});

/**
 * PUT /api/projects/:id/channels/:channelId/unsubscribe
 * 取消订阅Channel
 */
router.put('/:id/channels/:channelId/unsubscribe', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const channelId = req.params.channelId as string;
    const { agentId } = req.body;
    
    if (!agentId) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: agentId'
      });
      return;
    }

    const channel = await projectService.unsubscribeChannel(projectId, channelId, agentId as string);
    
    res.json({
      success: true,
      channel
    });
  } catch (error) {
    console.error('[Project API] Unsubscribe channel failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to unsubscribe channel'
    });
  }
});

// ============================================
// Message API
// ============================================

/**
 * GET /api/projects/:id/messages
 * 获取项目消息
 */
router.get('/:id/messages', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const { channelId, since } = req.query;
    
    const messages = await projectService.getMessages(
      projectId,
      channelId as string | undefined,
      since ? parseInt(since as string) : undefined
    );
    
    res.json({
      success: true,
      messages
    });
  } catch (error) {
    console.error('[Project API] Get messages failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get messages'
    });
  }
});

/**
 * POST /api/projects/:id/messages
 * 发送消息
 */
router.post('/:id/messages', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const { channelId, sender, content, messageType, taskId, sessionKey, runId, source } = req.body;
    
    if (!channelId || !sender || !content) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: channelId, sender, content'
      });
      return;
    }
    
    const message = await projectService.sendMessage(
      projectId,
      channelId as string,
      sender as MessageSender,
      content as string,
      {
        messageType,
        taskId,
        sessionKey,
        runId,
        source
      }
    );

    // 通过事件总线发布消息，WebSocket 和内部 Agent 都会收到
    const channel = await projectService.getChannel(projectId, channelId as string);
    // 即使没有订阅者也要发布消息（至少前端需要通过 WebSocket 看到消息）
    const subscriberIds = channel?.subscriberIds || [];
    gatewayEventBus.publishChannelMessage(
      projectId,
      channelId as string,
      message,
      subscriberIds
    );
    
    res.json({
      success: true,
      message
    });
  } catch (error) {
    console.error('[Project API] Send message failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send message'
    });
  }
});

/**
 * GET /api/projects/:id/messages/mentions/:agentId
 * 获取@Mention消息
 */
router.get('/:id/messages/mentions/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.id as string;
    const agentId = req.params.agentId as string;
    
    const messages = await projectService.getMessagesByMention(projectId, agentId);
    
    res.json({
      success: true,
      messages
    });
  } catch (error) {
    console.error('[Project API] Get mentions failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get mentions'
    });
  }
});

export default router;
