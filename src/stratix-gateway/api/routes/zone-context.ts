import { Router, Request, Response } from 'express';
import { zoneContextManager } from '../../../stratix-character-creator/core/ZoneContextManager';

const router = Router();

// ============================================
// Zone Context API
// ============================================

/**
 * POST /api/zone-context/inject
 * Agent 进入 Zone，注入 Zone 上下文
 */
router.post('/inject', async (req: Request, res: Response): Promise<void> => {
  try {
    const { agentId, zoneId } = req.body as { agentId: string; zoneId: string };

    if (!agentId || !zoneId) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: agentId, zoneId',
      });
      return;
    }

    const result = await zoneContextManager.inject(agentId, zoneId);

    if (result.success) {
      res.json({
        success: true,
        context: result.context,
        injectedAt: result.injectedAt,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        injectedAt: result.injectedAt,
      });
    }
  } catch (error) {
    console.error('[ZoneContext API] Inject failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to inject zone context',
    });
  }
});

/**
 * DELETE /api/zone-context/detach
 * Agent 离开 Zone，移除 Zone 上下文
 */
router.delete('/detach', async (req: Request, res: Response): Promise<void> => {
  try {
    const { agentId, zoneId } = req.body as { agentId: string; zoneId?: string };

    if (!agentId) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: agentId',
      });
      return;
    }

    if (zoneId) {
      await zoneContextManager.detachFromZone(agentId, zoneId);
    } else {
      await zoneContextManager.detach(agentId);
    }

    res.json({
      success: true,
      message: zoneId ? `Detached from zone ${zoneId}` : 'Detached from all zones',
    });
  } catch (error) {
    console.error('[ZoneContext API] Detach failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to detach zone context',
    });
  }
});

/**
 * GET /api/zone-context/:agentId
 * 获取 Agent 的 Zone 上下文
 */
router.get('/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;

    if (!agentId) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: agentId',
      });
      return;
    }

    const context = zoneContextManager.getContext(agentId);
    const zones = zoneContextManager.getAgentZones(agentId);

    res.json({
      success: true,
      context,
      zones,
    });
  } catch (error) {
    console.error('[ZoneContext API] Get context failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get zone context',
    });
  }
});

/**
 * GET /api/zone-context/:agentId/zones
 * 获取 Agent 所属的所有 Zone
 */
router.get('/:agentId/zones', async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;

    if (!agentId) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: agentId',
      });
      return;
    }

    const zones = zoneContextManager.getAgentZones(agentId);

    res.json({
      success: true,
      zones,
    });
  } catch (error) {
    console.error('[ZoneContext API] Get zones failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get agent zones',
    });
  }
});

// ============================================
// MCP Tool Bindings
// ============================================

/**
 * POST /api/zone-context/mcp-tools
 * 注册 MCP 工具绑定
 */
router.post('/mcp-tools', async (req: Request, res: Response): Promise<void> => {
  try {
    const binding = req.body as {
      skillId: string;
      mcpToolName: string;
      endpoint: string;
      authType: 'none' | 'bearer' | 'apikey';
      timeout: number;
    };

    if (!binding.skillId || !binding.mcpToolName || !binding.endpoint) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: skillId, mcpToolName, endpoint',
      });
      return;
    }

    zoneContextManager.registerMCPTool(binding);

    res.json({
      success: true,
      message: `MCP tool ${binding.mcpToolName} registered for skill ${binding.skillId}`,
    });
  } catch (error) {
    console.error('[ZoneContext API] Register MCP tool failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to register MCP tool',
    });
  }
});

/**
 * GET /api/zone-context/mcp-tools/:skillId
 * 获取技能对应的 MCP 工具
 */
router.get('/mcp-tools/:skillId', async (req: Request, res: Response): Promise<void> => {
  try {
    const skillId = req.params.skillId as string;

    if (!skillId) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: skillId',
      });
      return;
    }

    const mcpTool = zoneContextManager.getMCPTool(skillId);

    if (!mcpTool) {
      res.status(404).json({
        success: false,
        error: `MCP tool not found for skill: ${skillId}`,
      });
      return;
    }

    res.json({
      success: true,
      mcpTool,
    });
  } catch (error) {
    console.error('[ZoneContext API] Get MCP tool failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get MCP tool',
    });
  }
});

/**
 * GET /api/zone-context/stats
 * 获取统计信息
 */
router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  try {
    const stats = {
      totalAgents: zoneContextManager.getStats().totalAgents,
      totalZones: zoneContextManager.getStats().totalZones,
      mcpTools: zoneContextManager.getStats().mcpTools,
    };

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('[ZoneContext API] Get stats failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get stats',
    });
  }
});

export default router;
