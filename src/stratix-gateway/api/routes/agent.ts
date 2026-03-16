import { Router, Request, Response } from 'express';
import { dataStoreService } from '../../dataStoreService';
import { StratixRequestHelper } from '../../../stratix-core/utils';
import { StratixConfigValidator } from '../../../stratix-core/utils';
import { ExecutorFactory } from '../../../stratix-core/executor';
import type { AgentBackendType, OpenClawConfig, DirectLLMConfig, StratixDirectConfig } from '../../../stratix-core/stratix-protocol';

const router = Router();
const requestHelper = StratixRequestHelper.getInstance();
const validator = StratixConfigValidator.getInstance();

router.post('/create', async (req: Request, res: Response) => {
  try {
    const agentConfig = req.body;
    
    const validation = validator.validateAgentConfig(agentConfig);
    if (!validation.valid) {
      res.json(requestHelper.badRequest(`配置验证失败: ${validation.errors.join(', ')}`));
      return;
    }

    const store = dataStoreService.getStore();
    const existing = await store.getAgent(agentConfig.agentId);
    if (existing) {
      res.json(requestHelper.error(409, 'Agent already exists'));
      return;
    }

    await store.saveAgent(agentConfig);
    res.json(requestHelper.success(agentConfig, 'Agent created'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.put('/save', async (req: Request, res: Response) => {
  try {
    const agentConfig = req.body;
    
    const validation = validator.validateAgentConfig(agentConfig);
    if (!validation.valid) {
      res.json(requestHelper.badRequest(`配置验证失败: ${validation.errors.join(', ')}`));
      return;
    }

    const store = dataStoreService.getStore();
    await store.saveAgent(agentConfig);
    res.json(requestHelper.success(agentConfig, 'Agent saved'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.put('/update', async (req: Request, res: Response) => {
  try {
    const agentConfig = req.body;
    
    if (!agentConfig.agentId) {
      res.json(requestHelper.badRequest('agentId is required'));
      return;
    }
    
    const validation = validator.validateAgentConfig(agentConfig);
    if (!validation.valid) {
      res.json(requestHelper.badRequest(`配置验证失败: ${validation.errors.join(', ')}`));
      return;
    }

    const store = dataStoreService.getStore();
    const existing = await store.getAgent(agentConfig.agentId);
    if (!existing) {
      res.json(requestHelper.notFound('Agent not found'));
      return;
    }

    await store.saveAgent(agentConfig);
    res.json(requestHelper.success(agentConfig, 'Agent updated'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.get('/get', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.query;
    const store = dataStoreService.getStore();
    const agent = await store.getAgent(agentId as string);
    
    if (!agent) {
      res.json(requestHelper.notFound('Agent not found'));
    } else {
      res.json(requestHelper.success(agent, 'Agent fetched'));
    }
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.delete('/delete', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.query;
    const store = dataStoreService.getStore();
    const deleted = await store.deleteAgent(agentId as string);
    
    if (!deleted) {
      res.json(requestHelper.notFound('Agent not found'));
    } else {
      res.json(requestHelper.success(null, 'Agent deleted'));
    }
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.get('/list', async (req: Request, res: Response) => {
  try {
    if (!dataStoreService.isInitialized()) {
      console.error('[Agent API] DataStore not initialized');
      res.json(requestHelper.serviceUnavailable('DataStore not initialized. Please ensure gateway is running.'));
      return;
    }
    const store = dataStoreService.getStore();
    const agents = await store.listAgents();
    console.log('[Agent API] Listed agents:', agents.length);
    res.json(requestHelper.success(agents, 'Agents fetched'));
  } catch (error) {
    console.error('[Agent API] Error listing agents:', error);
    res.status(500).json(requestHelper.serverError(`Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`));
  }
});

router.post('/test-connection', async (req: Request, res: Response) => {
  try {
    const { backendType, config, agentId } = req.body;
    
    let testConfig: { backendType: AgentBackendType; openClawConfig?: OpenClawConfig; directConfig?: DirectLLMConfig; stratixConfig?: any };
    
    if (agentId) {
      const store = dataStoreService.getStore();
      const agent = await store.getAgent(agentId);
      if (!agent) {
        res.json(requestHelper.notFound('Agent not found'));
        return;
      }
      testConfig = {
        backendType: agent.backendType,
        openClawConfig: agent.openClawConfig,
        directConfig: agent.directConfig,
        stratixConfig: (agent as any).stratixConfig
      };
    } else if (backendType && config) {
      testConfig = {
        backendType,
        openClawConfig: backendType === 'openclaw' ? config as OpenClawConfig : undefined,
        directConfig: backendType === 'direct' ? config as DirectLLMConfig : undefined,
        stratixConfig: backendType === 'stratix' ? config : undefined
      };
    } else {
      res.json(requestHelper.badRequest('Either agentId or (backendType and config) is required'));
      return;
    }
    
    const executorFactory = ExecutorFactory.getInstance();
    const executor = executorFactory.getExecutorByType(testConfig.backendType);
    
    const mockAgentConfig = {
      agentId: 'test-connection',
      name: 'Test Agent',
      type: 'custom',
      backendType: testConfig.backendType,
      openClawConfig: testConfig.openClawConfig,
      directConfig: testConfig.directConfig,
      stratixConfig: testConfig.stratixConfig
    };
    
    const result = await executor.testConnection(mockAgentConfig as any);
    
    res.json(requestHelper.success(result, result.success ? 'Connection successful' : 'Connection failed'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { backendType, config, message, systemPrompt } = req.body;
    
    if (!message) {
      res.json(requestHelper.badRequest('Message is required'));
      return;
    }

    let chatConfig: { backendType: AgentBackendType; directConfig?: DirectLLMConfig; stratixConfig?: any };
    
    if (backendType === 'direct') {
      chatConfig = {
        backendType: 'direct',
        directConfig: config
      };
    } else if (backendType === 'stratix') {
      chatConfig = {
        backendType: 'stratix',
        stratixConfig: config
      };
    } else {
      res.json(requestHelper.badRequest('Unsupported backend type for chat'));
      return;
    }

    const executorFactory = ExecutorFactory.getInstance();
    const executor = executorFactory.getExecutorByType(chatConfig.backendType);

    const mockAgentConfig = {
      agentId: 'chat-agent',
      name: 'Chat Agent',
      type: 'custom',
      backendType: chatConfig.backendType,
      directConfig: chatConfig.directConfig,
      stratixConfig: chatConfig.stratixConfig,
      soul: { identity: systemPrompt || '', goals: [], personality: '' }
    };

    const command = {
      commandId: `cmd-${Date.now()}`,
      skillId: 'chat',
      agentId: 'chat-agent',
      params: { message },
      executeAt: Date.now()
    };

    const result = await executor.execute(command, mockAgentConfig as any);
    
    if (result.success) {
      res.json(requestHelper.success({ content: result.data }, 'Message sent'));
    } else {
      res.json(requestHelper.error(500, result.error || 'Chat failed'));
    }
  } catch (error) {
    console.error('[Chat API] Error:', error);
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

export default router;
