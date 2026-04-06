// ============================================
// SystemZoneCycle API Routes
// D2: 手动触发 + 自动循环 API
// ============================================

import { Router, Request, Response } from 'express';
import { SystemZoneCycle } from '@/stratix-systemzone/SystemZoneCycle';
import { SystemZoneManager } from '@/stratix-systemzone/SystemZoneManager';

const router = Router();

// ============================================
// Singleton cycle instance + auto loop
// ============================================

let cycle: SystemZoneCycle | null = null;
let autoInterval: NodeJS.Timeout | null = null;
let autoRunning = false;

function getCycle(): SystemZoneCycle {
  if (!cycle) {
    const manager = new SystemZoneManager();
    cycle = new SystemZoneCycle(manager);
  }
  return cycle;
}

// ============================================
// Helper
// ============================================

function sanitizeError(error: unknown): string {
  if (!(error instanceof Error)) return 'Internal server error';
  let msg = error.message;
  msg = msg.replace(/(\/?[\w\-.\\/]+)+[\w\-.\\/]+\.\w+:\d+:\d+/g, '<file>');
  msg = msg.replace(/at\s+(\/?[\w\-.\\/]+)+[\w\-.\\/]+\.\w+:\d+/g, 'at <file>');
  msg = msg.replace(/\/[\w\-.\\/]+\/[\w\-.\\/]+\.\w+/g, '<file>');
  msg = msg.replace(/(<file>\s*)+/g, '<file>');
  return msg.length > 200 ? msg.substring(0, 200) + '...' : msg;
}

// ============================================
// Routes
// ============================================

/**
 * POST /api/system-zone/cycle/trigger
 * 手动触发一次 cycle
 */
router.post('/cycle/trigger', async (req: Request, res: Response): Promise<void> => {
  try {
    const c = getCycle();
    const state = await c.run(req.body?.input);

    res.json({
      success: true,
      data: state,
    });
  } catch (error) {
    console.error('[SystemZoneCycle API] Trigger failed:', error);
    res.status(500).json({
      success: false,
      error: sanitizeError(error),
    });
  }
});

/**
 * POST /api/system-zone/cycle/start
 * 开始自动循环
 * body.interval: ms, 默认 3600000 (1小时)
 */
router.post('/cycle/start', async (req: Request, res: Response): Promise<void> => {
  try {
    if (autoRunning) {
      res.status(409).json({
        success: false,
        error: 'Auto cycle already running',
      });
      return;
    }

    const interval = parseInt(req.body?.interval as string, 10) || 3_600_000;

    if (interval < 1000) {
      res.status(400).json({
        success: false,
        error: 'Interval must be at least 1000ms',
      });
      return;
    }

    autoRunning = true;

    // Run immediately, then on interval
    const c = getCycle();
    c.run().catch(console.error);

    autoInterval = setInterval(() => {
      if (autoRunning) {
        c.run().catch(console.error);
      }
    }, interval);

    res.json({
      success: true,
      data: {
        autoRunning: true,
        intervalMs: interval,
      },
    });
  } catch (error) {
    console.error('[SystemZoneCycle API] Start failed:', error);
    res.status(500).json({
      success: false,
      error: sanitizeError(error),
    });
  }
});

/**
 * POST /api/system-zone/cycle/stop
 * 停止自动循环
 */
router.post('/cycle/stop', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!autoRunning) {
      res.status(409).json({
        success: false,
        error: 'Auto cycle not running',
      });
      return;
    }

    autoRunning = false;

    if (autoInterval) {
      clearInterval(autoInterval);
      autoInterval = null;
    }

    res.json({
      success: true,
      data: {
        autoRunning: false,
      },
    });
  } catch (error) {
    console.error('[SystemZoneCycle API] Stop failed:', error);
    res.status(500).json({
      success: false,
      error: sanitizeError(error),
    });
  }
});

/**
 * GET /api/system-zone/cycle/status
 * 获取当前 cycle 状态
 */
router.get('/cycle/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const c = getCycle();
    const state = c.getState();

    res.json({
      success: true,
      data: {
        cycle: state,
        autoRunning,
      },
    });
  } catch (error) {
    console.error('[SystemZoneCycle API] Status failed:', error);
    res.status(500).json({
      success: false,
      error: sanitizeError(error),
    });
  }
});

/**
 * POST /api/system-zone/cycle/confirm
 * 确认 blocked cycle 继续执行
 */
router.post('/cycle/confirm', async (req: Request, res: Response): Promise<void> => {
  try {
    const c = getCycle();
    const state = c.getState();

    if (state.phase !== 'blocked') {
      res.status(409).json({
        success: false,
        error: `Cannot confirm: cycle is not in blocked phase (current: ${state.phase})`,
      });
      return;
    }

    const newState = await c.confirmAndContinue();

    res.json({
      success: true,
      data: newState,
    });
  } catch (error) {
    console.error('[SystemZoneCycle API] Confirm failed:', error);
    res.status(500).json({
      success: false,
      error: sanitizeError(error),
    });
  }
});

/**
 * POST /api/system-zone/cycle/reject
 * 拒绝 blocked cycle
 */
router.post('/cycle/reject', async (req: Request, res: Response): Promise<void> => {
  try {
    const c = getCycle();
    const state = c.getState();

    if (state.phase !== 'blocked') {
      res.status(409).json({
        success: false,
        error: `Cannot reject: cycle is not in blocked phase (current: ${state.phase})`,
      });
      return;
    }

    const newState = c.cancel();

    res.json({
      success: true,
      data: newState,
    });
  } catch (error) {
    console.error('[SystemZoneCycle API] Reject failed:', error);
    res.status(500).json({
      success: false,
      error: sanitizeError(error),
    });
  }
});

export default router;
