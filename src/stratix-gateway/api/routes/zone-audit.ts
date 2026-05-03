import { Router, Request, Response } from 'express';

import { auditLogRepository, AuditEventType } from '../../../stratix-database/AuditLogRepository';
import { taskFlowRepository } from '../../../stratix-database/TaskFlowRepository';

const router = Router();

const MAX_AUDIT_LIMIT = 1000;

function getParam(req: Request, key: string): string {
  const val = req.params[key];
  return Array.isArray(val) ? val[0] : val;
}

function clampInt(value: unknown, min: number, max: number, defaultValue: number): number {
  const parsed = parseInt(value as string, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, parsed));
}

// ============================================
// Zone Audit Trail
// ============================================

/**
 * GET /api/zones/:zoneId/audit
 * Get Zone audit trail with filtering and pagination
 */
router.get('/zones/:zoneId/audit', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = getParam(req, 'zoneId');

    const eventTypes = req.query.eventTypes
      ? (req.query.eventTypes as string).split(',').filter(Boolean) as AuditEventType[]
      : undefined;
    const actorId = req.query.actorId as string | undefined;
    const targetId = req.query.targetId as string | undefined;
    const startTime = req.query.startTime ? parseInt(req.query.startTime as string, 10) : undefined;
    const endTime = req.query.endTime ? parseInt(req.query.endTime as string, 10) : undefined;
    const limit = req.query.limit ? clampInt(req.query.limit, 1, MAX_AUDIT_LIMIT, 100) : undefined;
    const offset = req.query.offset ? clampInt(req.query.offset, 0, Number.MAX_SAFE_INTEGER, 0) : undefined;

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
    const zoneId = getParam(req, 'zoneId');

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
    const taskId = getParam(req, 'taskId');

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
    const zoneId = getParam(req, 'zoneId');
    const agentId = getParam(req, 'agentId');

    const startTime = req.query.startTime ? parseInt(req.query.startTime as string, 10) : undefined;
    const endTime = req.query.endTime ? parseInt(req.query.endTime as string, 10) : undefined;
    const limit = req.query.limit ? clampInt(req.query.limit, 1, MAX_AUDIT_LIMIT, 100) : undefined;
    const offset = req.query.offset ? clampInt(req.query.offset, 0, Number.MAX_SAFE_INTEGER, 0) : undefined;

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
    const zoneId = getParam(req, 'zoneId');
    const olderThan = req.query.olderThan as string;

    if (!olderThan) {
      res.status(400).json({
        success: false,
        error: 'Missing required query parameter: olderThan (timestamp)'
      });
      return;
    }

    const olderThanTimestamp = parseInt(olderThan, 10);
    if (Number.isNaN(olderThanTimestamp)) {
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
    const zoneId = getParam(req, 'zoneId');
    const limit = req.query.limit ? clampInt(req.query.limit, 1, MAX_AUDIT_LIMIT, 10) : 10;

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
