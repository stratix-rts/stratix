import { Router, Request, Response } from 'express';
import { zoneService } from '../../project/ZoneService';
import { ZoneCreateRequest, ZoneUpdateRequest, ZoneFileAddRequest, ZoneFolderScanRequest, ZoneTaskStatus } from '../../../stratix-project/types';

const router = Router();

// ============================================
// Zone CRUD
// ============================================

/**
 * POST /api/zones
 * Create a new Zone (projectId in body since zoneId === projectId)
 */
router.post('/zones', async (req: Request, res: Response): Promise<void> => {
  try {
    const { projectId, title, prompt } = req.body as ZoneCreateRequest & { projectId?: string };

    if (!title) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: title'
      });
      return;
    }

    // Use projectId from body or generate new one
    const zone = await zoneService.createZone(projectId || '', title, prompt || '');

    res.json({
      success: true,
      zone
    });
  } catch (error) {
    console.error('[Zone API] Create zone failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to create zone';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * GET /api/zones
 * Get all Zones
 */
router.get('/zones', async (req: Request, res: Response): Promise<void> => {
  try {
    // For now, return all zones - could filter by projectId in query if needed
    const zones = await zoneService.getZones('');

    res.json({
      success: true,
      zones
    });
  } catch (error) {
    console.error('[Zone API] Get zones failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to get zones';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * GET /api/zones/:zoneId
 * Get a single Zone
 */
router.get('/zones/:zoneId', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const zone = await zoneService.getZone(zoneId);

    if (!zone) {
      res.status(404).json({
        success: false,
        error: 'Zone not found'
      });
      return;
    }

    res.json({
      success: true,
      zone
    });
  } catch (error) {
    console.error('[Zone API] Get zone failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get zone'
    });
  }
});

/**
 * PUT /api/zones/:zoneId
 * Update a Zone
 */
router.put('/zones/:zoneId', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const updates = req.body as ZoneUpdateRequest;

    const zone = await zoneService.updateZone(zoneId, updates);

    res.json({
      success: true,
      zone
    });
  } catch (error) {
    console.error('[Zone API] Update zone failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to update zone';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * DELETE /api/zones/:zoneId
 * Delete a Zone (soft delete)
 */
router.delete('/zones/:zoneId', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const deleted = await zoneService.deleteZone(zoneId);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: 'Zone not found'
      });
      return;
    }

    res.json({
      success: true,
      message: 'Zone deleted'
    });
  } catch (error) {
    console.error('[Zone API] Delete zone failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete zone'
    });
  }
});

// ============================================
// Zone Files
// ============================================

/**
 * POST /api/zones/:zoneId/files
 * Add a file to a Zone
 */
router.post('/zones/:zoneId/files', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const { name, sourceType, source } = req.body as ZoneFileAddRequest;

    if (!name || !sourceType || !source) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: name, sourceType, source'
      });
      return;
    }

    if (!['local', 'url'].includes(sourceType)) {
      res.status(400).json({
        success: false,
        error: 'Invalid sourceType. Must be "local" or "url"'
      });
      return;
    }

    const file = await zoneService.addFile(zoneId, name, sourceType, source);

    res.json({
      success: true,
      file
    });
  } catch (error) {
    console.error('[Zone API] Add file failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to add file';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * DELETE /api/zones/:zoneId/files/:fileId
 * Remove a file from a Zone
 */
router.delete('/zones/:zoneId/files/:fileId', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const fileId = req.params.fileId as string;
    const deleted = await zoneService.removeFile(zoneId, fileId);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: 'File not found'
      });
      return;
    }

    res.json({
      success: true,
      message: 'File removed'
    });
  } catch (error) {
    console.error('[Zone API] Remove file failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to remove file';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * POST /api/zones/:zoneId/files/:fileId/refresh
 * Refresh file content
 */
router.post('/zones/:zoneId/files/:fileId/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const fileId = req.params.fileId as string;
    const file = await zoneService.refreshFile(zoneId, fileId);

    res.json({
      success: true,
      file
    });
  } catch (error) {
    console.error('[Zone API] Refresh file failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to refresh file';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * POST /api/zones/:zoneId/files/scan-folder
 * Scan a local folder and add files to a Zone
 */
router.post('/zones/:zoneId/files/scan-folder', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const { folderPath, recursive, extensions } = req.body as ZoneFolderScanRequest;

    if (!folderPath) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: folderPath'
      });
      return;
    }

    const files = await zoneService.scanFolder(zoneId, folderPath, recursive || false, extensions);

    res.json({
      success: true,
      files
    });
  } catch (error) {
    console.error('[Zone API] Scan folder failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to scan folder';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

// ============================================
// Zone Members
// ============================================

/**
 * POST /api/zones/:zoneId/members/:agentId
 * Add an Agent to a Zone
 */
router.post('/zones/:zoneId/members/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const agentId = req.params.agentId as string;
    const zone = await zoneService.addMember(zoneId, agentId);

    res.json({
      success: true,
      zone
    });
  } catch (error) {
    console.error('[Zone API] Add member failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to add member';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * DELETE /api/zones/:zoneId/members/:agentId
 * Remove an Agent from a Zone
 */
router.delete('/zones/:zoneId/members/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const agentId = req.params.agentId as string;
    const zone = await zoneService.removeMember(zoneId, agentId);

    res.json({
      success: true,
      zone
    });
  } catch (error) {
    console.error('[Zone API] Remove member failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to remove member';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

// ============================================
// Zone Tasks
// ============================================

/**
 * GET /api/zones/:zoneId/tasks
 * Get all tasks in a Zone
 */
router.get('/zones/:zoneId/tasks', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const tasks = await zoneService.getTasks(zoneId);

    res.json({
      success: true,
      tasks
    });
  } catch (error) {
    console.error('[Zone API] Get tasks failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to get tasks';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * POST /api/zones/:zoneId/tasks
 * Create a task in a Zone (only taskCreatorId can create)
 */
router.post('/zones/:zoneId/tasks', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const { agentId, title } = req.body as { agentId: string; title: string };

    if (!agentId || !title) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: agentId, title'
      });
      return;
    }

    const task = await zoneService.createTask(zoneId, agentId, title);

    res.json({
      success: true,
      task
    });
  } catch (error) {
    console.error('[Zone API] Create task failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to create task';
    if (message.includes('not found') || message.includes('只有任务创建者')) {
      res.status(403).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * PUT /api/zones/:zoneId/tasks/:taskId
 * Update a task (only creator or assignee can update)
 */
router.put('/zones/:zoneId/tasks/:taskId', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const taskId = req.params.taskId as string;
    const { agentId, title, status, assignee } = req.body as { agentId: string; title?: string; status?: string; assignee?: string | null };

    if (!agentId) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: agentId'
      });
      return;
    }

    const task = await zoneService.updateTask(zoneId, taskId, agentId, {
      title,
      status: status as ZoneTaskStatus | undefined,
      assignee
    });

    res.json({
      success: true,
      task
    });
  } catch (error) {
    console.error('[Zone API] Update task failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to update task';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else if (message.includes('只有')) {
      res.status(403).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * DELETE /api/zones/:zoneId/tasks/:taskId
 * Delete a task (only creator can delete)
 */
router.delete('/zones/:zoneId/tasks/:taskId', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const taskId = req.params.taskId as string;
    const { agentId } = req.body as { agentId: string };

    if (!agentId) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: agentId'
      });
      return;
    }

    const deleted = await zoneService.deleteTask(zoneId, taskId, agentId);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: 'Task not found'
      });
      return;
    }

    res.json({
      success: true,
      message: 'Task deleted'
    });
  } catch (error) {
    console.error('[Zone API] Delete task failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete task';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else if (message.includes('只有')) {
      res.status(403).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * POST /api/zones/:zoneId/tasks/:taskId/claim
 * Claim a task (set assignee + status = in_progress)
 */
router.post('/zones/:zoneId/tasks/:taskId/claim', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const taskId = req.params.taskId as string;
    const { agentId } = req.body as { agentId: string };

    if (!agentId) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: agentId'
      });
      return;
    }

    const task = await zoneService.claimTask(zoneId, taskId, agentId);

    res.json({
      success: true,
      task
    });
  } catch (error) {
    console.error('[Zone API] Claim task failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to claim task';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else if (message.includes('已被') || message.includes('已完成')) {
      res.status(409).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

// ============================================
// Zone Messages
// ============================================

/**
 * GET /api/zones/:zoneId/messages
 * Get message history for a Zone
 */
router.get('/zones/:zoneId/messages', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const limit = parseInt(req.query.limit as string) || 100;
    const messages = await zoneService.getMessages(zoneId, limit);

    res.json({
      success: true,
      messages
    });
  } catch (error) {
    console.error('[Zone API] Get messages failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to get messages';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * POST /api/zones/:zoneId/messages
 * Send a message to a Zone
 */
router.post('/zones/:zoneId/messages', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const { senderId, senderType, content } = req.body as { senderId: string; senderType: 'user' | 'agent'; content: string };

    if (!senderId || !senderType || !content) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: senderId, senderType, content'
      });
      return;
    }

    if (!['user', 'agent'].includes(senderType)) {
      res.status(400).json({
        success: false,
        error: 'Invalid senderType. Must be "user" or "agent"'
      });
      return;
    }

    const message = await zoneService.addMessage(zoneId, senderId, senderType, content);

    res.json({
      success: true,
      message
    });
  } catch (error) {
    console.error('[Zone API] Send message failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to send message';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

export default router;
