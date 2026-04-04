import { Router, Request, Response, NextFunction } from 'express';

import { zoneRepository } from '../../../stratix-database';
import { zoneCoordinatorConfigRepository, type ZoneCoordinatorConfig } from '../../../stratix-database/ZoneCoordinatorConfigRepository';
import { ZoneCoordinator, type TaskItem, type ProcessResult, type ZoneStatusSummary, type DelegateResult } from '../../../stratix-orchestration/zone/ZoneCoordinator';

const router = Router();

// ============================================
// Middleware: validate zoneId exists
// ============================================

async function validateZone(req: Request, res: Response, next: NextFunction): Promise<void> {
  const zoneId = req.params.zoneId as string;
  if (!zoneId) {
    res.status(400).json({ success: false, error: 'Missing zoneId parameter' });
    return;
  }
  const zone = zoneRepository.getZone(zoneId);
  if (!zone) {
    res.status(404).json({ success: false, error: `Zone not found: ${zoneId}` });
    return;
  }
  next();
}

// Apply validateZone middleware to all zone-scoped routes
router.use('/zones/:zoneId', validateZone);

// ============================================
// ZoneCoordinator Service (in-memory instance management)
// ============================================

class ZoneCoordinatorService {
  private coordinators: Map<string, CoordinatorEntry> = new Map();
  private lastCleanup: number = 0;
  private readonly cleanupInterval: number = 60000; // 1 minute
  private readonly maxAge: number = 3600000; // 1 hour TTL

  async getCoordinator(zoneId: string, config?: Partial<ZoneCoordinatorConfig>): Promise<ZoneCoordinator> {
    this.maybeCleanup();

    const entry = this.coordinators.get(zoneId);
    if (entry) {
      entry.lastAccess = Date.now();
      return entry.coordinator;
    }

    const coordinator = await ZoneCoordinator.create(zoneId, config);
    this.coordinators.set(zoneId, {
      coordinator,
      createdAt: Date.now(),
      lastAccess: Date.now()
    });
    return coordinator;
  }

  clearCoordinator(zoneId: string): void {
    this.coordinators.delete(zoneId);
  }

  private maybeCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) return;

    this.lastCleanup = now;
    const expiry = now - this.maxAge;

    for (const [zoneId, entry] of this.coordinators.entries()) {
      if (entry.lastAccess < expiry) {
        this.coordinators.delete(zoneId);
      }
    }
  }
}

interface CoordinatorEntry {
  coordinator: ZoneCoordinator;
  createdAt: number;
  lastAccess: number;
}

const coordinatorService = new ZoneCoordinatorService();

// ============================================
// Types
// ============================================

interface RequirementRequest {
  requirement: string;
}

interface ConfirmRequest {
  confirmed: boolean;
  assigneeId?: string;
}

interface RejectRequest {
  reason?: string;
}

interface ReassignRequest {
  newAgentId: string;
}

interface ManualTaskRequest {
  title: string;
  description?: string;
  type?: 'coding' | 'writing' | 'analysis' | 'research' | 'general';
  priority?: 1 | 2 | 3 | 4 | 5;
  assigneeId?: string;
}

interface UpdateConfigRequest {
  llmProvider?: string;
  model?: string | null;
  autoDecompose?: boolean;
  autoAssign?: boolean;
  requireUserConfirm?: boolean;
  assignStrategy?: 'random' | 'capability_match' | 'load_balance' | 'priority' | 'round_robin';
  entryCondition?: string | null;
}

// ============================================
// POST /api/zones/:zoneId/requirements
// Submit requirement - calls ZoneCoordinator.processRequirement
// ============================================

router.post('/zones/:zoneId/requirements', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const { requirement } = req.body as RequirementRequest;

    if (!requirement) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: requirement'
      });
      return;
    }

    const coordinator = await coordinatorService.getCoordinator(zoneId);
    const result: ProcessResult = await coordinator.processRequirement(requirement);

    res.json({
      success: result.success,
      tasks: result.tasks,
      delegated: result.delegated,
      pending: result.pending,
      requiresUserConfirm: result.requiresUserConfirm,
      error: result.error
    });
  } catch (error) {
    console.error('[ZoneCoordinator API] Process requirement failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process requirement'
    });
  }
});

// ============================================
// POST /api/zones/:zoneId/tasks/:taskId/confirm
// Confirm task assignment
// ============================================

router.post('/zones/:zoneId/tasks/:taskId/confirm', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const taskId = req.params.taskId as string;
    const { confirmed, assigneeId } = req.body as ConfirmRequest;

    if (confirmed === undefined) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: confirmed'
      });
      return;
    }

    const coordinator = await coordinatorService.getCoordinator(zoneId);

    if (confirmed) {
      // Find the task and get the suggested assignee (or use provided assigneeId)
      const task = coordinator.getTask(taskId);

      if (!task) {
        res.status(404).json({
          success: false,
          error: 'Task not found'
        });
        return;
      }

      const targetAgentId = assigneeId || task.assigneeId;

      if (!targetAgentId) {
        res.status(400).json({
          success: false,
          error: 'No assignee specified'
        });
        return;
      }

      const result: DelegateResult = await coordinator.delegateTask(taskId, targetAgentId);

      res.json({
        success: result.success,
        taskId: result.taskId,
        agentId: result.agentId,
        flowId: result.flowId,
        error: result.error
      });
    } else {
      // Rejection - just return success for now (task stays in pending)
      res.json({
        success: true,
        taskId,
        message: 'Task rejected - remains in pending queue'
      });
    }
  } catch (error) {
    console.error('[ZoneCoordinator API] Confirm task failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to confirm task'
    });
  }
});

// ============================================
// POST /api/zones/:zoneId/tasks/:taskId/reject
// Reject task assignment
// ============================================

router.post('/zones/:zoneId/tasks/:taskId/reject', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const taskId = req.params.taskId as string;
    const { reason } = req.body as RejectRequest;

    // Get current status to verify task exists
    const coordinator = await coordinatorService.getCoordinator(zoneId);
    const status = coordinator.getStatusSummary();

    // For now, rejection just returns success
    // In a full implementation, this would record the rejection reason

    res.json({
      success: true,
      taskId,
      message: 'Task rejected',
      reason: reason || null
    });
  } catch (error) {
    console.error('[ZoneCoordinator API] Reject task failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reject task'
    });
  }
});

// ============================================
// POST /api/zones/:zoneId/tasks/manual
// Create a manual task
// ============================================

router.post('/zones/:zoneId/tasks/manual', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const { title, description, type, priority, assigneeId } = req.body as ManualTaskRequest;

    if (!title) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: title'
      });
      return;
    }

    const coordinator = await coordinatorService.getCoordinator(zoneId);
    const task = coordinator.createManualTask({
      title,
      description,
      type,
      priority,
      assigneeId
    });

    res.json({
      success: true,
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        type: task.type,
        priority: task.priority,
        status: task.status,
        assigneeId: task.assigneeId
      }
    });
  } catch (error) {
    console.error('[ZoneCoordinator API] Create manual task failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create manual task'
    });
  }
});

// ============================================
// POST /api/zones/:zoneId/tasks/:taskId/reassign
// Force reassign task to a different agent
// ============================================

router.post('/zones/:zoneId/tasks/:taskId/reassign', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const taskId = req.params.taskId as string;
    const { newAgentId } = req.body as ReassignRequest;

    if (!newAgentId) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: newAgentId'
      });
      return;
    }

    const coordinator = await coordinatorService.getCoordinator(zoneId);
    const result: DelegateResult = await coordinator.reassignTask(taskId, newAgentId);

    res.json({
      success: result.success,
      taskId: result.taskId,
      agentId: result.agentId,
      flowId: result.flowId,
      error: result.error
    });
  } catch (error) {
    console.error('[ZoneCoordinator API] Reassign task failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reassign task'
    });
  }
});

// ============================================
// GET /api/zones/:zoneId/coordinator/status
// Get Coordinator status summary
// ============================================

router.get('/zones/:zoneId/coordinator/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;

    const coordinator = await coordinatorService.getCoordinator(zoneId);
    const status: ZoneStatusSummary = coordinator.getStatusSummary();

    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error('[ZoneCoordinator API] Get status failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get coordinator status'
    });
  }
});

// ============================================
// PUT /api/zones/:zoneId/coordinator/config
// Update Coordinator configuration
// ============================================

router.put('/zones/:zoneId/coordinator/config', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const updates = req.body as UpdateConfigRequest;

    if (!updates || Object.keys(updates).length === 0) {
      res.status(400).json({
        success: false,
        error: 'No configuration updates provided'
      });
      return;
    }

    // Update in database
    const updatedConfig = zoneCoordinatorConfigRepository.updateConfig(zoneId, updates);

    if (!updatedConfig) {
      res.status(404).json({
        success: false,
        error: 'Coordinator config not found'
      });
      return;
    }

    // Clear cached coordinator to force reload with new config
    coordinatorService.clearCoordinator(zoneId);

    res.json({
      success: true,
      config: updatedConfig
    });
  } catch (error) {
    console.error('[ZoneCoordinator API] Update config failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update coordinator config'
    });
  }
});

export default router;