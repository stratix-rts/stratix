import { Router, Request, Response } from 'express';

import { auditLogRepository, AuditEventType } from '../../../stratix-database/AuditLogRepository';
import { taskFlowRepository } from '../../../stratix-database/TaskFlowRepository';

const router = Router();

// ============================================
// Zone Audit Trail
// ============================================

/**
 * GET /api/zones/:zoneId/audit
 * Get Zone audit trail with filtering and pagination
 */
router.get('/zones/:zoneId/audit', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;

    const eventTypes = req.query.eventTypes
      ? (req.query.eventTypes as string).split(',') as AuditEventType[]
      : undefined;
    const actorId = req.query.actorId as string | undefined;
    const targetId = req.query.targetId as string | undefined;
    const startTime = req.query.startTime ? parseInt(req.query.startTime as string) : undefined;
    const endTime = req.query.endTime ? parseInt(req.query.endTime as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

    const result = auditLogRepository.getZoneAuditTrail(zoneId, {
      eventTypes,
      actorId,
      targetId,
      startTime,
      endTime,
      limit,
      offset
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[Zone Audit API] Get audit trail failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get audit trail'
    });
  }
});

/**
 * GET /api/zones/:zoneId/audit/stats
 * Get audit event statistics by type
 */
router.get('/zones/:zoneId/audit/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;

    const stats = auditLogRepository.countByEventType(zoneId);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('[Zone Audit API] Get audit stats failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get audit stats'
    });
  }
});

/**
 * GET /api/zones/:zoneId/tasks/:taskId/flow
 * Get task flow history
 */
router.get('/zones/:zoneId/tasks/:taskId/flow', async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = req.params.taskId as string;

    const flows = taskFlowRepository.getTaskFlowHistory(taskId);

    res.json({
      success: true,
      data: flows
    });
  } catch (error) {
    console.error('[Zone Audit API] Get task flow failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get task flow'
    });
  }
});

/**
 * GET /api/zones/:zoneId/agents/:agentId/activity
 * Get agent activity log within a zone
 */
router.get('/zones/:zoneId/agents/:agentId/activity', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const agentId = req.params.agentId as string;

    const startTime = req.query.startTime ? parseInt(req.query.startTime as string) : undefined;
    const endTime = req.query.endTime ? parseInt(req.query.endTime as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

    const events = auditLogRepository.getAgentActivityLog(agentId, zoneId, {
      startTime,
      endTime,
      limit,
      offset
    });

    res.json({
      success: true,
      data: events
    });
  } catch (error) {
    console.error('[Zone Audit API] Get agent activity failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get agent activity'
    });
  }
});

/**
 * DELETE /api/zones/:zoneId/audit
 * Cleanup old audit logs
 */
router.delete('/zones/:zoneId/audit', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const olderThan = req.query.olderThan as string;

    if (!olderThan) {
      res.status(400).json({
        success: false,
        error: 'Missing required query parameter: olderThan (timestamp)'
      });
      return;
    }

    const olderThanTimestamp = parseInt(olderThan);
    if (isNaN(olderThanTimestamp)) {
      res.status(400).json({
        success: false,
        error: 'Invalid olderThan parameter: must be a unix timestamp in milliseconds'
      });
      return;
    }

    const deletedCount = auditLogRepository.cleanup(zoneId, olderThanTimestamp);

    res.json({
      success: true,
      data: { deleted: deletedCount }
    });
  } catch (error) {
    console.error('[Zone Audit API] Cleanup audit logs failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cleanup audit logs'
    });
  }
});

/**
 * GET /api/zones/:zoneId/audit/recent
 * Get recent audit events
 */
router.get('/zones/:zoneId/audit/recent', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

    const events = auditLogRepository.getRecentEvents(zoneId, limit);

    res.json({
      success: true,
      data: events
    });
  } catch (error) {
    console.error('[Zone Audit API] Get recent events failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get recent events'
    });
  }
});

export default router;
