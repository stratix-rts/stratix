import { Router, Request, Response } from 'express';
import { zoneService, ZoneFileBatchRequest } from '../../project/ZoneService';
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
// Zone Recycle Bin
// ============================================

/**
 * GET /api/zones/:projectId/trash
 * Get all soft-deleted zones for a project (recycle bin)
 */
router.get('/zones/:projectId/trash', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const zones = await zoneService.getDeletedZones(projectId);

    res.json({
      success: true,
      zones
    });
  } catch (error) {
    console.error('[Zone API] Get deleted zones failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to get deleted zones';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * POST /api/zones/:zoneId/restore
 * Restore a soft-deleted zone
 */
router.post('/zones/:zoneId/restore', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const zone = await zoneService.restoreZone(zoneId);

    res.json({
      success: true,
      zone
    });
  } catch (error) {
    console.error('[Zone API] Restore zone failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to restore zone';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * DELETE /api/zones/:zoneId/permanent
 * Permanently delete a zone (cannot be recovered)
 */
router.delete('/zones/:zoneId/permanent', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const deleted = await zoneService.permanentlyDeleteZone(zoneId);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: 'Zone not found in trash'
      });
      return;
    }

    res.json({
      success: true,
      message: 'Zone permanently deleted'
    });
  } catch (error) {
    console.error('[Zone API] Permanent delete failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to permanently delete zone'
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
 * GET /api/zones/:zoneId/files/:fileId/versions
 * Get file version history
 */
router.get('/zones/:zoneId/files/:fileId/versions', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const fileId = req.params.fileId as string;
    const versions = await zoneService.getFileVersions(zoneId, fileId);

    res.json({
      success: true,
      ...versions
    });
  } catch (error) {
    console.error('[Zone API] Get file versions failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to get file versions';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * PUT /api/zones/:zoneId/files/:fileId
 * Update file content (with version tracking for text files)
 */
router.put('/zones/:zoneId/files/:fileId', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const fileId = req.params.fileId as string;
    const { content, description } = req.body as { content: string; description?: string };

    if (content === undefined) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: content'
      });
      return;
    }

    const file = await zoneService.updateFileWithVersion(zoneId, fileId, content, description);

    res.json({
      success: true,
      file
    });
  } catch (error) {
    console.error('[Zone API] Update file failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to update file';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * POST /api/zones/:zoneId/files/:fileId/rollback/:versionId
 * Rollback file to a specific version
 */
router.post('/zones/:zoneId/files/:fileId/rollback/:versionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const fileId = req.params.fileId as string;
    const versionId = req.params.versionId as string;

    const file = await zoneService.rollbackFileToVersion(zoneId, fileId, versionId);

    res.json({
      success: true,
      file
    });
  } catch (error) {
    console.error('[Zone API] Rollback file failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to rollback file';
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

/**
 * POST /api/zones/:zoneId/files/batch
 * Batch add files to a Zone
 */
router.post('/zones/:zoneId/files/batch', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const { files } = req.body as ZoneFileBatchRequest;

    if (!files || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: files (array)'
      });
      return;
    }

    if (files.length > 50) {
      res.status(400).json({
        success: false,
        error: 'Maximum 50 files per batch'
      });
      return;
    }

    // Validate each file
    for (const file of files) {
      if (!file.name || !file.sourceType || !file.source) {
        res.status(400).json({
          success: false,
          error: 'Each file must have name, sourceType, and source'
        });
        return;
      }
      if (!['local', 'url'].includes(file.sourceType)) {
        res.status(400).json({
          success: false,
          error: 'Invalid sourceType. Must be "local" or "url"'
        });
        return;
      }
    }

    const addedFiles = await zoneService.addFiles(zoneId, files);

    res.json({
      success: true,
      files: addedFiles,
      count: addedFiles.length
    });
  } catch (error) {
    console.error('[Zone API] Batch add files failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to batch add files';
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
 * Get tasks in a Zone (with pagination)
 */
router.get('/zones/:zoneId/tasks', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const limit = parseInt(req.query.limit as string) || undefined;
    const offset = parseInt(req.query.offset as string) || undefined;

    const [tasks, total] = await Promise.all([
      zoneService.getTasks(zoneId, limit, offset),
      zoneService.getTasksCount(zoneId)
    ]);

    res.json({
      success: true,
      tasks,
      pagination: {
        total,
        limit: limit || total,
        offset: offset || 0
      }
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
 * Get message history for a Zone (with pagination)
 */
router.get('/zones/:zoneId/messages', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    const [messages, total] = await Promise.all([
      zoneService.getMessages(zoneId, limit, offset),
      zoneService.getMessagesCount(zoneId)
    ]);

    res.json({
      success: true,
      messages,
      pagination: {
        total,
        limit,
        offset
      }
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

// ============================================
// Zone Template Export/Import
// ============================================

/**
 * GET /api/zones/:zoneId/export
 * Export Zone as template (JSON)
 */
router.get('/zones/:zoneId/export', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const exportData = await zoneService.exportZone(zoneId);

    res.json({
      success: true,
      ...exportData
    });
  } catch (error) {
    console.error('[Zone API] Export zone failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to export zone';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

/**
 * POST /api/zones/import
 * Import Zone from template
 */
router.post('/zones/import', async (req: Request, res: Response): Promise<void> => {
  try {
    const { projectId, template, creatorAgentId } = req.body as {
      projectId: string;
      template: { title: string; prompt: string; files?: Array<{ name: string; sourceType: 'local' | 'url'; source: string }>; tasks?: Array<{ title: string }> };
      creatorAgentId?: string;
    };

    if (!projectId || !template || !template.title) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: projectId, template.title'
      });
      return;
    }

    const zone = await zoneService.importZone(projectId, template, creatorAgentId);

    res.json({
      success: true,
      zone
    });
  } catch (error) {
    console.error('[Zone API] Import zone failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to import zone';
    if (message.includes('not found')) {
      res.status(404).json({ success: false, error: message });
    } else {
      res.status(500).json({ success: false, error: message });
    }
  }
});

export default router;
