import { Router, Request, Response } from 'express';

import { StratixAgent } from '../../../stratix-agent';
import { ExecutorFactory } from '../../../stratix-core/executor';
import type { AgentBackendType, OpenClawConfig, StratixDirectConfig } from '../../../stratix-core/stratix-protocol';
import { StratixRequestHelper , StratixConfigValidator } from '../../../stratix-core/utils';
import { dataStoreService } from '../../dataStoreService';
import { retryPolicyEngine, RetryPolicyEngine } from '@/stratix-core/retry';
import { AgentOrchestrationService } from '../../agent/AgentOrchestrationService';

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
    const partialConfig = req.body;

    if (!partialConfig.agentId) {
      res.json(requestHelper.badRequest('agentId is required'));
      return;
    }

    const store = dataStoreService.getStore();
    const existing = await store.getAgent(partialConfig.agentId);
    if (!existing) {
      res.json(requestHelper.notFound('Agent not found'));
      return;
    }

    // 判断是否为部分更新（仅包含可合并的轻量字段）
    const partialFields = ['position', 'zoneId', 'status', 'configStatus'];
    const isPartialUpdate = Object.keys(partialConfig).every(
      (key) => key === 'agentId' || partialFields.includes(key)
    );

    let finalConfig: any;

    if (isPartialUpdate) {
      // 部分更新：将新字段合并到现有配置中，跳过完整验证
      finalConfig = { ...existing, ...partialConfig };
    } else {
      // 完整更新：进行完整验证
      const validation = validator.validateAgentConfig(partialConfig);
      if (!validation.valid) {
        res.json(requestHelper.badRequest(`配置验证失败: ${validation.errors.join(', ')}`));
        return;
      }
      finalConfig = partialConfig;
    }

    await store.saveAgent(finalConfig);
    res.json(requestHelper.success(finalConfig, 'Agent updated'));
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

    let testConfig: { backendType: AgentBackendType; openClawConfig?: OpenClawConfig; stratixConfig?: StratixDirectConfig };

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
        stratixConfig: agent.stratixConfig
      };
    } else if (backendType && config) {
      testConfig = {
        backendType,
        openClawConfig: backendType === 'openclaw' ? config as OpenClawConfig : undefined,
        stratixConfig: backendType === 'stratix' ? config as StratixDirectConfig : undefined
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
      stratixConfig: testConfig.stratixConfig
    };

    const result = await retryPolicyEngine.executeWithRetry(
      () => executor.testConnection(mockAgentConfig as any),
      RetryPolicyEngine.createDefaultConfig('foreground'),
      { source: 'foreground', provider: testConfig.backendType }
    );

    res.json(requestHelper.success(result, result.success ? 'Connection successful' : 'Connection failed'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { backendType, config, message, systemPrompt, history, soul, rules, skillTree, useToolUse } = req.body;

    if (!message) {
      res.json(requestHelper.badRequest('Message is required'));
      return;
    }

    if (backendType !== 'stratix' && backendType !== 'openclaw') {
      res.json(requestHelper.badRequest('Unsupported backend type for chat'));
      return;
    }

    // 构建 soul 对象：优先使用结构化的 soul 配置，否则回退到 systemPrompt
    const agentSoul = soul || { identity: systemPrompt || '', goals: [], personality: '' };

    // 当 useToolUse 为 true 且 backendType 为 stratix 时，使用完整的 StratixAgent
    if (useToolUse && backendType === 'stratix' && config) {
      try {
        const agentConfig = {
          agentId: 'chat-agent-' + Date.now(),
          name: 'Chat Agent',
          type: 'custom' as const,
          provider: config.provider,
          model: config.model,
          apiKey: config.apiKey,
          endpoint: config.endpoint,
          temperature: config.temperature ?? 0.7,
          maxTokens: config.maxTokens ?? 4096,
          maxShortTerm: config.maxShortTerm ?? 20,
          enableLongTerm: config.enableLongTerm ?? false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const agent = new StratixAgent(agentConfig, agentSoul);
        agent.enableToolUse(true);

        // sessionId 由 chat 方法内部处理
        const result = await agent.chat(message, { useToolUse: true });

        res.json(requestHelper.success({
          content: result.response,
          skillExecutions: result.skillExecutions,
          usage: result.usage
        }, 'Message sent'));

        return;
      } catch (error) {
        console.error('[Chat API] StratixAgent error:', error);
        // 失败时回退到原来的 executor
      }
    }

    // 原来的逻辑：使用 executor
    let chatConfig: { backendType: AgentBackendType; stratixConfig?: StratixDirectConfig; openClawConfig?: OpenClawConfig };

    if (backendType === 'stratix') {
      chatConfig = {
        backendType: 'stratix',
        stratixConfig: config
      };
    } else {
      chatConfig = {
        backendType: 'openclaw',
        openClawConfig: config
      };
    }

    const executorFactory = ExecutorFactory.getInstance();
    const executor = executorFactory.getExecutorByType(chatConfig.backendType);

    const mockAgentConfig = {
      agentId: 'chat-agent',
      name: 'Chat Agent',
      type: 'custom',
      backendType: chatConfig.backendType,
      stratixConfig: chatConfig.stratixConfig,
      openClawConfig: chatConfig.openClawConfig,
      soul: agentSoul,
      rules: rules || [],
      skillTree: skillTree
    };

    const command = {
      commandId: `cmd-${Date.now()}`,
      skillId: 'chat',
      agentId: 'chat-agent',
      params: { message },
      executeAt: Date.now()
    };

    const result = await retryPolicyEngine.executeWithRetry(
      () => executor.execute(command, mockAgentConfig as any, { history }),
      RetryPolicyEngine.createDefaultConfig('background'),
      { source: 'background', provider: chatConfig.backendType }
    );

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

// GET /api/stratix/agent/transcript?agentId=xxx&limit=50
// Returns session transcript for an active agent session
router.get('/transcript', async (req: Request, res: Response) => {
  const { agentId, limit } = req.query;
  if (!agentId) {
    res.json(requestHelper.badRequest('agentId is required'));
    return;
  }

  try {
    // Check if agent is managed by AgentOrchestrationService
    const orchestrator = AgentOrchestrationService.getInstance();
    if (orchestrator.isAgentWorking(agentId as string)) {
      // Agent is active - try to get transcript from orchestration
      const agentState = orchestrator.getAgentState(agentId as string);
      if (agentState && (agentState as any).transcript) {
        const transcriptLimit = Number(limit) || 50;
        const transcript = (agentState as any).transcript.slice(-transcriptLimit);
        res.json(requestHelper.success(transcript));
        return;
      }
    }
    // Agent not active or no transcript available
    res.json(requestHelper.success([], 'Agent session not found or inactive'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Failed to get transcript'));
  }
});

// GET /api/stratix/agent/usage?agentId=xxx
// Returns token usage for an active agent session
router.get('/usage', async (req: Request, res: Response) => {
  const { agentId } = req.query;
  if (!agentId) {
    res.json(requestHelper.badRequest('agentId is required'));
    return;
  }

  try {
    // Check AgentOrchestrationService for usage stats
    const orchestrator = AgentOrchestrationService.getInstance();
    if (orchestrator.isAgentWorking(agentId as string)) {
      const agentState = orchestrator.getAgentState(agentId as string);
      if (agentState && (agentState as any).usage) {
        res.json(requestHelper.success((agentState as any).usage));
        return;
      }
    }
    res.json(requestHelper.success({ promptTokens: 0, completionTokens: 0, totalTokens: 0, turnCount: 0 }));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Failed to get usage'));
  }
});

// 搜索消息 - 必须放在 /:agentId/messages 前面，否则会被错误匹配
router.get('/:agentId/messages/search', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const query = req.query.q as string;

  if (!query) {
    res.json(requestHelper.badRequest('Query is required'));
    return;
  }

  try {
    const keywords = query.split(/[,，\s]+/).filter(k => k.length > 1);
    const messages = await dataStoreService.searchChatMessages(agentId as string, keywords);
    res.json(requestHelper.success({ messages, query, matchedKeywords: keywords }));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Failed to search messages'));
  }
});

// 获取消息列表
router.get('/:agentId/messages', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

  try {
    const messages = await dataStoreService.getChatMessages(agentId as string, limit, offset);
    res.json(requestHelper.success({ messages, total: messages.length, hasMore: messages.length === limit }));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Failed to get messages'));
  }
});

// 保存消息
router.post('/:agentId/messages', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const { role, content, timestamp } = req.body;

  if (!role || !content) {
    res.status(400).json(requestHelper.badRequest('role and content are required'));
    return;
  }

  try {
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await dataStoreService.saveChatMessage({
      messageId,
      agentId: agentId as string,
      role,
      content,
      timestamp: timestamp || Date.now()
    });
    res.json(requestHelper.success({ messageId }));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Failed to save message'));
  }
});

// 删除消息
router.delete('/:agentId/messages', async (req: Request, res: Response) => {
  const { agentId } = req.params;

  try {
    await dataStoreService.deleteChatMessages(agentId as string);
    res.json(requestHelper.success(null, 'Messages deleted'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Failed to delete messages'));
  }
});

export default router;
