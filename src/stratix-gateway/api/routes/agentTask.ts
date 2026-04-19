/**
 * Agent Task API Routes
 *
 * Provides REST endpoints for agents to poll and manage their tasks.
 * These routes bridge the gateway layer with the orchestration TaskQueueService.
 */

import { Router, Request, Response } from 'express';
import { TaskQueueService } from '../../../stratix-orchestration/task-queue/TaskQueueService';
import { gatewayEventBus } from '../../GatewayEventBus';
import { StratixRequestHelper } from '../../../stratix-core/utils';

const router = Router();
const requestHelper = StratixRequestHelper.getInstance();

/**
 * GET /api/agent/:agentId/tasks
 * Poll pending tasks assigned to an agent
 */
router.get('/:agentId/tasks', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.agentId as string;
    const taskQueue = TaskQueueService.getInstance();

    const tasks = await taskQueue.getTasksByAgent(agentId);

    res.json(requestHelper.success({
      tasks: tasks.map(t => ({
        taskId: t.taskId,
        zoneId: t.zoneId,
        name: t.name,
        description: t.description,
        type: t.type,
        priority: t.priority,
        status: t.status,
        assignedAgentId: t.assignedAgentId,
        createdAt: t.createdAt,
        assignedAt: t.assignedAt,
        startedAt: t.startedAt,
        context: t.context,
      })),
      count: tasks.length,
    }));
  } catch (error) {
    console.error('[AgentTask API] Failed to get tasks:', error);
    res.status(500).json(requestHelper.serverError('Failed to get tasks'));
  }
});

/**
 * POST /api/agent/:agentId/tasks/claim
 * Agent claims a pending task from a zone
 */
router.post('/:agentId/tasks/claim', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.agentId as string;
    const { zoneId } = req.body;

    if (!zoneId) {
      res.status(400).json(requestHelper.badRequest('zoneId is required'));
      return;
    }

    const taskQueue = TaskQueueService.getInstance();
    const task = await taskQueue.dequeueTask(agentId, zoneId);

    if (!task) {
      res.json(requestHelper.success({ task: null, message: 'No pending tasks available' }));
      return;
    }

    // Publish task claimed event (zone:task_claimed is a valid event type)
    gatewayEventBus.publishZoneEvent('zone:task_claimed', task.zoneId, task.zoneId, {
      taskId: task.taskId,
      agentId,
    });

    res.json(requestHelper.success({
      task: {
        taskId: task.taskId,
        zoneId: task.zoneId,
        name: task.name,
        description: task.description,
        type: task.type,
        priority: task.priority,
        status: task.status,
        assignedAgentId: task.assignedAgentId,
      },
    }));
  } catch (error) {
    console.error('[AgentTask API] Failed to claim task:', error);
    res.status(500).json(requestHelper.serverError('Failed to claim task'));
  }
});

/**
 * POST /api/agent/:agentId/tasks/:taskId/start
 * Agent starts working on a task
 */
router.post('/:agentId/tasks/:taskId/start', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId as string;
    const taskQueue = TaskQueueService.getInstance();

    const task = await taskQueue.updateTask(taskId, {
      status: 'in_progress',
    });

    if (!task) {
      res.status(404).json(requestHelper.notFound('Task not found'));
      return;
    }

    res.json(requestHelper.success({ taskId: task.taskId, status: task.status }));
  } catch (error) {
    console.error('[AgentTask API] Failed to start task:', error);
    res.status(500).json(requestHelper.serverError('Failed to start task'));
  }
});

/**
 * POST /api/agent/:agentId/tasks/:taskId/complete
 * Agent completes a task
 */
router.post('/:agentId/tasks/:taskId/complete', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId as string;
    const { result } = req.body;

    const taskQueue = TaskQueueService.getInstance();

    const task = await taskQueue.updateTask(taskId, {
      status: 'completed',
      result,
    });

    if (!task) {
      res.status(404).json(requestHelper.notFound('Task not found'));
      return;
    }

    // Publish task completed event
    gatewayEventBus.publishZoneEvent('zone:task_updated', task.zoneId, task.zoneId, {
      taskId: task.taskId,
      status: 'completed',
    });

    res.json(requestHelper.success({ taskId: task.taskId, status: task.status }));
  } catch (error) {
    console.error('[AgentTask API] Failed to complete task:', error);
    res.status(500).json(requestHelper.serverError('Failed to complete task'));
  }
});

/**
 * POST /api/agent/:agentId/tasks/:taskId/fail
 * Agent marks a task as failed
 */
router.post('/:agentId/tasks/:taskId/fail', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId as string;
    const { error } = req.body;

    const taskQueue = TaskQueueService.getInstance();

    const task = await taskQueue.updateTask(taskId, {
      status: 'failed',
      error,
    });

    if (!task) {
      res.status(404).json(requestHelper.notFound('Task not found'));
      return;
    }

    res.json(requestHelper.success({ taskId: task.taskId, status: task.status }));
  } catch (error) {
    console.error('[AgentTask API] Failed to fail task:', error);
    res.status(500).json(requestHelper.serverError('Failed to fail task'));
  }
});

export default router;
