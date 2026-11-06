/**
 * 文件职责：agent 编排 API（`/api/agents/orchestration/*`）的单测（@since v3.3，task_206 / M2-09）——
 *   `/start` 走**实例维度**：请求体给 `instanceId`，工作目录由实例注册表解析；
 *   旧的 `projectPath` 字段**已退役**（仍传 ⇒ 400 并说清改传什么，不做静默兜底）。
 * 输入：真 express 路由（真起 app，不打桩 HTTP 层）+ 假 agent 类（不连网）。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. 不静默兼容 projectPath —— 静默兜底 = 路径来源又出现第二个真相源（本单要消灭的正是它）；
 *   2. 不连真 OpenClaw。
 */

import express from 'express';
import request from 'supertest';

import { AgentOrchestrationService } from '../../../agent/AgentOrchestrationService';
import { OpenClawAgent } from '../../../agent/agents/OpenClawAgent';
import type { StratixAgentConfig } from '../../../../stratix-core';
import agentOrchestrationRoutes from '../agentOrchestration';

jest.mock('../../../agent/agents/OpenClawAgent', () => ({
  OpenClawAgent: jest.fn().mockImplementation((_config: unknown, _instancePath: string) => ({
    getState: () => ({ agentId: 'agent-a', name: 'A', zoneId: 'zone-1', status: 'working' }),
    start: async (): Promise<void> => undefined,
    stop: async (): Promise<void> => undefined,
    pause: async (): Promise<void> => undefined,
    resume: async (): Promise<void> => undefined,
  })),
}));

jest.mock('../../../agent/agents/LLMAgent', () => ({ LLMAgent: jest.fn() }));

const openClawMock = OpenClawAgent as unknown as jest.Mock;

function agentConfig(agentId: string): StratixAgentConfig {
  return {
    agentId,
    name: agentId,
    type: 'custom',
    openClawConfig: { endpoint: 'http://127.0.0.1:1' },
    configStatus: 'active',
  } as unknown as StratixAgentConfig;
}

describe('agent 编排 API：/start 的实例维度（task_206 / M2-09）', () => {
  const orchestrator = AgentOrchestrationService.getInstance();
  const app = express();
  app.use(express.json());
  app.use('/api/agents/orchestration', agentOrchestrationRoutes);

  beforeEach(() => {
    orchestrator.destroy();
    openClawMock.mockClear();
    orchestrator.setInstancePathResolver((instanceId) =>
      instanceId === 'inst-a' ? '/tmp/inst-a' : undefined
    );
    orchestrator.registerAgentConfig('agent-a', agentConfig('agent-a'));
  });

  it('带 instanceId ⇒ 起 agent，工作目录 = 注册表查到的副本根', async () => {
    const response = await request(app)
      .post('/api/agents/orchestration/start')
      .send({ agentId: 'agent-a', instanceId: 'inst-a', zoneId: 'zone-1' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true });
    expect(openClawMock).toHaveBeenCalledTimes(1);
    expect(openClawMock.mock.calls[0][1]).toBe('/tmp/inst-a');
  });

  it('只带 projectPath ⇒ 400 并指向 instanceId（该链路已退役）', async () => {
    const response = await request(app)
      .post('/api/agents/orchestration/start')
      .send({ agentId: 'agent-a', projectPath: '/tmp/legacy', zoneId: 'zone-1' });

    expect(response.status).toBe(400);
    expect(String(response.body.error)).toContain('instanceId');
    expect(openClawMock).not.toHaveBeenCalled();
  });

  it('既无 instanceId 也无 projectPath ⇒ 400（缺 instanceId）', async () => {
    const response = await request(app)
      .post('/api/agents/orchestration/start')
      .send({ agentId: 'agent-a', zoneId: 'zone-1' });

    expect(response.status).toBe(400);
    expect(String(response.body.error)).toContain('instanceId');
  });

  it('副本查不到 ⇒ 500 且如实说明解析不出路径（不假装已启动）', async () => {
    const response = await request(app)
      .post('/api/agents/orchestration/start')
      .send({ agentId: 'agent-a', instanceId: 'inst-missing', zoneId: 'zone-1' });

    expect(response.status).toBe(500);
    expect(String(response.body.error)).toContain('inst-missing');
  });
});
