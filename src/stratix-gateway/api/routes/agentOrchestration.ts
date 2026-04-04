import { Router, Request, Response } from 'express';

import { StratixAgentConfig } from '../../../stratix-core';
import { AgentOrchestrationService, AgentState, UsageStats } from '../../agent/AgentOrchestrationService';

const router = Router();
const orchestrator = AgentOrchestrationService.getInstance();

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

router.post('/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const { agentId, projectPath, projectId } = req.body;
    
    if (!agentId || !projectPath || !projectId) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: agentId, projectPath, projectId'
      });
      return;
    }
    
    await orchestrator.startAgent(agentId, projectPath, projectId);
    
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
    const agentId = req.params.agentId as string;
    
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
    const agentId = req.params.agentId as string;
    
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
    const agentId = req.params.agentId as string;
    
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
    const agentId = req.params.agentId as string;
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
    const agentId = req.params.agentId as string;

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

router.get('/project/:projectId', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = req.params.projectId as string;
    const agents = orchestrator.getProjectAgents(projectId);
    
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
