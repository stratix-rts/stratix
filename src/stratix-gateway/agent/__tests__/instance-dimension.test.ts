/**
 * 文件职责：编排链的**实例维度**单测（@since v3.3，task_206 / M2-09）——
 *   agent 的工作目录必须来自**实例注册表**（`instanceId` ⇒ 副本项目根），
 *   旧的「调用方自带 projectPath」链路已退役。
 * 输入：真编排服务（单例）+ 假 agent 类（只记构造参数，不连网）+ 假解析口（注入口）。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. 不连真 OpenClaw（agent 类整体打桩 —— 这里要验的是「路径从哪来」，不是「怎么连」）；
 *   2. 不碰真注册表（解析口是注入口：生产接线在 `src/stratix-gateway/index.ts`）。
 */

import type { StratixAgentConfig } from '../../../stratix-core';

import { AgentOrchestrationService } from '../AgentOrchestrationService';
import { OpenClawAgent } from '../agents/OpenClawAgent';

jest.mock('../agents/OpenClawAgent', () => ({
  OpenClawAgent: jest.fn().mockImplementation((_config: unknown, _instancePath: string) => ({
    getState: () => ({ agentId: 'agent-a', name: 'A', zoneId: 'zone-1', status: 'working' }),
    start: async (): Promise<void> => undefined,
    stop: async (): Promise<void> => undefined,
    pause: async (): Promise<void> => undefined,
    resume: async (): Promise<void> => undefined,
  })),
}));

jest.mock('../agents/LLMAgent', () => ({ LLMAgent: jest.fn() }));

const openClawMock = OpenClawAgent as unknown as jest.Mock;

/** 最小可用的 agent 配置（只带 openClaw endpoint —— 够走进「起 agent」分支）。 */
function agentConfig(agentId: string): StratixAgentConfig {
  return {
    agentId,
    name: agentId,
    type: 'custom',
    openClawConfig: { endpoint: 'http://127.0.0.1:1' },
    configStatus: 'active',
  } as unknown as StratixAgentConfig;
}

describe('编排链的实例维度（task_206 / M2-09）', () => {
  const orchestrator = AgentOrchestrationService.getInstance();

  beforeEach(() => {
    orchestrator.destroy();
    openClawMock.mockClear();
  });

  it('工作目录来自实例注册表（instanceId ⇒ path），不是调用方给的路径', async () => {
    orchestrator.setInstancePathResolver((instanceId) =>
      instanceId === 'inst-a' ? '/tmp/inst-a' : undefined
    );
    orchestrator.registerAgentConfig('agent-a', agentConfig('agent-a'));

    await orchestrator.startAgent('agent-a', 'inst-a', 'zone-1');

    expect(openClawMock).toHaveBeenCalledTimes(1);
    // 构造参数第二位 = 工作目录 ⇒ 必须是注册表查到的副本根
    expect(openClawMock.mock.calls[0][1]).toBe('/tmp/inst-a');
  });

  it('副本查不到 path ⇒ 抛错且不起 agent（查不到就是查不到，不猜路径）', async () => {
    orchestrator.setInstancePathResolver(() => undefined);
    orchestrator.registerAgentConfig('agent-a', agentConfig('agent-a'));

    await expect(orchestrator.startAgent('agent-a', 'inst-missing', 'zone-1')).rejects.toThrow(
      /inst-missing/
    );
    expect(openClawMock).not.toHaveBeenCalled();
    expect(orchestrator.isAgentWorking('agent-a')).toBe(false);
  });

  it('没接解析口 ⇒ 抛错（不回落成「进程 cwd」——回落就又多一个路径真相源）', async () => {
    orchestrator.setInstancePathResolver(undefined);
    orchestrator.registerAgentConfig('agent-a', agentConfig('agent-a'));

    await expect(orchestrator.startAgent('agent-a', 'inst-a', 'zone-1')).rejects.toThrow(
      /inst-a/
    );
    expect(openClawMock).not.toHaveBeenCalled();
  });

  it('没有 agent 配置 ⇒ 照旧跳过（不因实例维度改动而改变既有跳过语义）', async () => {
    orchestrator.setInstancePathResolver(() => '/tmp/inst-a');

    await orchestrator.startAgent('agent-unknown', 'inst-a', 'zone-1');

    expect(openClawMock).not.toHaveBeenCalled();
  });
});
