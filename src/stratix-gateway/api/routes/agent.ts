import { Router, Request, Response } from 'express';

import { StratixAgent } from '../../../stratix-agent';
import { ExecutorFactory } from '../../../stratix-core/executor';
import type { AgentBackendType, OpenClawConfig, StratixDirectConfig, StratixAgentConfig } from '../../../stratix-core/stratix-protocol';
import { StratixRequestHelper , StratixConfigValidator } from '../../../stratix-core/utils';
import { dataStoreService } from '../../dataStoreService';
import { retryPolicyEngine, RetryPolicyEngine } from '@/stratix-core/retry';
import { AgentOrchestrationService } from '../../agent/AgentOrchestrationService';
import { AgentConfigSchema, validateOrThrow, ZodError } from '../../../stratix-core/schemas';

const router = Router();
const requestHelper = StratixRequestHelper.getInstance();
const validator = StratixConfigValidator.getInstance();

router.post('/create', async (req: Request, res: Response) => {
  try {
    let agentConfig: StratixAgentConfig;
    try {
      agentConfig = validateOrThrow(AgentConfigSchema, req.body) as StratixAgentConfig;
    } catch (err) {
      const zErr = err as ZodError;
      res.status(400).json(requestHelper.badRequest(`Schema validation failed: ${zErr.issues.map((e) => e.message).join('; ')}`));
      return;
    }

    const validation = validator.validateAgentConfig(agentConfig);
    if (!validation.valid) {
      res.status(400).json(requestHelper.badRequest(`配置验证失败: ${validation.errors.join(', ')}`));
      return;
    }

    const store = dataStoreService.getStore();
    const existing = await store.getAgent(agentConfig.agentId);
    if (existing) {
      res.status(409).json(requestHelper.error(409, 'Agent already exists'));
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
    let agentConfig: StratixAgentConfig;
    try {
      agentConfig = validateOrThrow(AgentConfigSchema, req.body) as StratixAgentConfig;
    } catch (err) {
      const zErr = err as ZodError;
      res.status(400).json(requestHelper.badRequest(`Schema validation failed: ${zErr.issues.map((e) => e.message).join('; ')}`));
      return;
    }

    const validation = validator.validateAgentConfig(agentConfig);
    if (!validation.valid) {
      res.status(400).json(requestHelper.badRequest(`配置验证失败: ${validation.errors.join(', ')}`));
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

    if (!partialConfig || typeof partialConfig !== 'object' || !partialConfig.agentId || typeof partialConfig.agentId !== 'string') {
      res.status(400).json(requestHelper.badRequest('agentId is required'));
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

    let finalConfig: StratixAgentConfig;

    if (isPartialUpdate) {
      // 部分更新：将新字段合并到现有配置中，跳过完整验证
      finalConfig = { ...existing, ...partialConfig } as StratixAgentConfig;
    } else {
      // 完整更新：进行完整验证
      const validation = validator.validateAgentConfig(partialConfig as StratixAgentConfig);
      if (!validation.valid) {
        res.status(400).json(requestHelper.badRequest(`配置验证失败: ${validation.errors.join(', ')}`));
        return;
      }
      finalConfig = partialConfig as StratixAgentConfig;
    }

    await store.saveAgent(finalConfig);
    res.json(requestHelper.success(finalConfig, 'Agent updated'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.get('/get', async (req: Request, res: Response) => {
  try {
    const agentId = req.query.agentId;
    if (!agentId || typeof agentId !== 'string') {
      res.status(400).json(requestHelper.badRequest('agentId is required'));
      return;
    }
    const store = dataStoreService.getStore();
    const agent = await store.getAgent(agentId);

    if (!agent) {
      res.status(404).json(requestHelper.notFound('Agent not found'));
    } else {
      res.json(requestHelper.success(agent, 'Agent fetched'));
    }
  } catch (error) {
    console.error('[Agent API] Get failed:', error);
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.delete('/delete', async (req: Request, res: Response) => {
  try {
    const agentId = req.query.agentId;
    if (!agentId || typeof agentId !== 'string') {
      res.status(400).json(requestHelper.badRequest('agentId is required'));
      return;
    }
    const store = dataStoreService.getStore();
    const deleted = await store.deleteAgent(agentId);

    if (!deleted) {
      res.status(404).json(requestHelper.notFound('Agent not found'));
    } else {
      res.json(requestHelper.success(null, 'Agent deleted'));
    }
  } catch (error) {
    console.error('[Agent API] Delete failed:', error);
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
      () => executor.testConnection(mockAgentConfig as unknown as StratixAgentConfig),
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

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json(requestHelper.badRequest('Message is required'));
      return;
    }

    if (message.length > 50000) {
      res.status(400).json(requestHelper.badRequest('Message exceeds maximum length of 50000 characters'));
      return;
    }

    if (backendType !== 'stratix' && backendType !== 'openclaw') {
      res.status(400).json(requestHelper.badRequest('Unsupported backend type for chat'));
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
      () => executor.execute(command, mockAgentConfig as unknown as StratixAgentConfig, { history }),
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
  const agentId = req.query.agentId;
  const limit = req.query.limit;
  if (!agentId || typeof agentId !== 'string') {
    res.status(400).json(requestHelper.badRequest('agentId is required'));
    return;
  }

  try {
    const transcriptLimit = Math.max(1, Math.min(500, Number(limit) || 50));
    // Prefer SessionRuntime transcript from EnhancedStratixAgent via AgentOrchestrationService
    const orchestrator = AgentOrchestrationService.getInstance();
    const sessionRuntimeTranscript = orchestrator.getAgentTranscript(agentId, transcriptLimit);
    if (sessionRuntimeTranscript) {
      res.json(requestHelper.success(sessionRuntimeTranscript));
      return;
    }
    // Agent not active or no transcript available
    res.json(requestHelper.success([], 'Agent session not found or inactive'));
  } catch (error) {
    console.error('[Agent API] Get transcript failed:', error);
    res.status(500).json(requestHelper.serverError('Failed to get transcript'));
  }
});

// GET /api/stratix/agent/usage?agentId=xxx
// Returns token usage for an active agent session
router.get('/usage', async (req: Request, res: Response) => {
  const agentId = req.query.agentId;
  if (!agentId || typeof agentId !== 'string') {
    res.status(400).json(requestHelper.badRequest('agentId is required'));
    return;
  }

  try {
    // Prefer SessionRuntime data from EnhancedStratixAgent via AgentOrchestrationService
    const orchestrator = AgentOrchestrationService.getInstance();
    const sessionRuntimeUsage = orchestrator.getAgentUsage(agentId);
    if (sessionRuntimeUsage) {
      res.json(requestHelper.success(sessionRuntimeUsage));
      return;
    }
    // Fall back to AgentOrchestrationService's own stats (for LLMAgent/OpenClawAgent)
    const usage = orchestrator.getUsage(agentId);
    res.json(requestHelper.success(usage));
  } catch (error) {
    console.error('[Agent API] Get usage failed:', error);
    res.status(500).json(requestHelper.serverError('Failed to get usage'));
  }
});

function getAgentIdParam(req: Request): string {
  const val = req.params.agentId;
  return Array.isArray(val) ? val[0] : val;
}

// 搜索消息 - 必须放在 /:agentId/messages 前面，否则会被错误匹配
router.get('/:agentId/messages/search', async (req: Request, res: Response) => {
  const agentId = getAgentIdParam(req);
  const query = req.query.q as string;

  if (!query || typeof query !== 'string') {
    res.status(400).json(requestHelper.badRequest('Query is required'));
    return;
  }

  try {
    const keywords = query.split(/[,，\s]+/).filter(k => k.length > 1);
    const messages = await dataStoreService.searchChatMessages(agentId, keywords);
    res.json(requestHelper.success({ messages, query, matchedKeywords: keywords }));
  } catch (error) {
    console.error('[Agent API] Search messages failed:', error);
    res.status(500).json(requestHelper.serverError('Failed to search messages'));
  }
});

// 获取消息列表
router.get('/:agentId/messages', async (req: Request, res: Response) => {
  const agentId = getAgentIdParam(req);
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit as string, 10) || 20));
  const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 0);

  try {
    const messages = await dataStoreService.getChatMessages(agentId, limit, offset);
    res.json(requestHelper.success({ messages, total: messages.length, hasMore: messages.length === limit }));
  } catch (error) {
    console.error('[Agent API] Get messages failed:', error);
    res.status(500).json(requestHelper.serverError('Failed to get messages'));
  }
});

// 保存消息
router.post('/:agentId/messages', async (req: Request, res: Response) => {
  const agentId = getAgentIdParam(req);
  const { role, content, timestamp } = req.body;

  if (!role || !content || typeof content !== 'string') {
    res.status(400).json(requestHelper.badRequest('role and content are required'));
    return;
  }

  if (content.length > 50000) {
    res.status(400).json(requestHelper.badRequest('Content exceeds maximum length of 50000 characters'));
    return;
  }

  try {
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    await dataStoreService.saveChatMessage({
      messageId,
      agentId,
      role,
      content,
      timestamp: timestamp || Date.now()
    });
    res.json(requestHelper.success({ messageId }));
  } catch (error) {
    console.error('[Agent API] Save message failed:', error);
    res.status(500).json(requestHelper.serverError('Failed to save message'));
  }
});

// 删除消息
router.delete('/:agentId/messages', async (req: Request, res: Response) => {
  const agentId = getAgentIdParam(req);

  try {
    await dataStoreService.deleteChatMessages(agentId);
    res.json(requestHelper.success(null, 'Messages deleted'));
  } catch (error) {
    console.error('[Agent API] Delete messages failed:', error);
    res.status(500).json(requestHelper.serverError('Failed to delete messages'));
  }
});

export default router;
