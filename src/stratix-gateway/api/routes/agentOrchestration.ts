import { Router, Request, Response } from 'express';

import { StratixAgentConfig } from '../../../stratix-core';
import { AgentOrchestrationService, AgentState, UsageStats } from '../../agent/AgentOrchestrationService';

const router = Router();
const orchestrator = AgentOrchestrationService.getInstance();

function getParam(req: Request, key: string): string {
  const val = req.params[key];
  return Array.isArray(val) ? val[0] : val;
}

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { agentId, config } = req.body;
    
    if (!agentId || !config) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: agentId, config'
      });
      return;
    }
    
    if (!config || typeof config !== 'object') {
      res.status(400).json({
        success: false,
        error: 'config must be an object'
      });
      return;
    }
    orchestrator.registerAgentConfig(agentId, config as StratixAgentConfig);
    
    res.json({
      success: true,
      message: `Agent ${agentId} registered`
    });
  } catch (error) {
    console.error('[Agent API] Register failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to register agent'
    });
  }
});

/**
 * 启动 agent（@since v3.3，task_206 / M2-09：**instance 维度**）。
 *
 * 请求体：`agentId` + `instanceId` + `zoneId`。
 *   工作目录**不再由调用方给路径** —— 由 `instanceId` 查**实例注册表**取该副本的项目根
 *   （design §1.3.1.1 裁决 2：编排层 `projectPath` 映射收编到 instance 维度）。
 * 旧的 `projectPath` 字段**已退役**：仍传它 ⇒ 400 并说清该改传什么（不做静默兜底 ——
 *   静默兜底会让「路径来源」这件事又出现第二个真相源，正是本单要消灭的）。
 */
router.post('/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const { agentId, instanceId, zoneId, projectPath } = req.body;

    if (!agentId || !zoneId) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: agentId, zoneId'
      });
      return;
    }

    if (!instanceId) {
      res.status(400).json({
        success: false,
        error: projectPath
          ? 'projectPath 已退役（task_206 / M2-09）：请传 instanceId，工作目录由实例注册表解析'
          : 'Missing required field: instanceId'
      });
      return;
    }

    await orchestrator.startAgent(agentId, instanceId, zoneId);

    res.json({
      success: true,
      message: `Agent ${agentId} started`
    });
  } catch (error) {
    console.error('[Agent API] Start failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start agent'
    });
  }
});

router.post('/stop/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = getParam(req, 'agentId');
    
    await orchestrator.stopAgent(agentId);
    
    res.json({
      success: true,
      message: `Agent ${agentId} stopped`
    });
  } catch (error) {
    console.error('[Agent API] Stop failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stop agent'
    });
  }
});

router.post('/pause/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = getParam(req, 'agentId');
    
    await orchestrator.pauseAgent(agentId);
    
    res.json({
      success: true,
      message: `Agent ${agentId} paused`
    });
  } catch (error) {
    console.error('[Agent API] Pause failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to pause agent'
    });
  }
});

router.post('/resume/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = getParam(req, 'agentId');
    
    await orchestrator.resumeAgent(agentId);
    
    res.json({
      success: true,
      message: `Agent ${agentId} resumed`
    });
  } catch (error) {
    console.error('[Agent API] Resume failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resume agent'
    });
  }
});

router.get('/state/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = getParam(req, 'agentId');
    const state = orchestrator.getAgentState(agentId);

    if (!state) {
      res.status(404).json({
        success: false,
        error: 'Agent not found'
      });
      return;
    }

    res.json({
      success: true,
      state
    });
  } catch (error) {
    console.error('[Agent API] Get state failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get agent state'
    });
  }
});

router.get('/usage/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = getParam(req, 'agentId');

    if (!orchestrator.isAgentWorking(agentId)) {
      res.status(404).json({
        success: false,
        error: 'Agent not found or not active'
      });
      return;
    }

    const usage: UsageStats = orchestrator.getUsage(agentId);

    res.json({
      success: true,
      usage
    });
  } catch (error) {
    console.error('[Agent API] Get usage failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get usage'
    });
  }
});

router.get('/active', async (req: Request, res: Response): Promise<void> => {
  try {
    const agents = orchestrator.getActiveAgents();
    
    res.json({
      success: true,
      agents
    });
  } catch (error) {
    console.error('[Agent API] Get active agents failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get active agents'
    });
  }
});

router.get('/project/:zoneId', async (req: Request, res: Response): Promise<void> => {
  try {
    const zoneId = getParam(req, 'zoneId');
    const agents = orchestrator.getProjectAgents(zoneId);
    
    res.json({
      success: true,
      agents
    });
  } catch (error) {
    console.error('[Agent API] Get project agents failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get project agents'
    });
  }
});

router.post('/stop-all', async (req: Request, res: Response): Promise<void> => {
  try {
    await orchestrator.stopAll();
    
    res.json({
      success: true,
      message: 'All agents stopped'
    });
  } catch (error) {
    console.error('[Agent API] Stop all failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stop all agents'
    });
  }
});

export default router;
