/**
 * 文件职责：**agent 编排的启动 / 停止 / 状态**（本进程内的一份编排真相）。
 *
 * ============ 工作目录口径（@since v3.3，task_206 / M2-09）============
 *   agent 的工作目录 = **活跃副本的项目根**（不可变绝对路径）⇒ 取值走**实例注册表**
 *   （`instanceId` ⇒ `ProjectInstanceView.path`），与 cli-transport 的 `SpawnOptions.cwd`
 *   同源（design §1.3.1.1 三条裁决第 2 条：M2 统一到 instance 维度）。
 *   退役的旧链路：编排层 `projectPath`（调用方自带路径）—— 已被 `instanceId` 取代，
 *   **新代码不得再写 `projectPath` 这个名字**（同一条命名纪律，见 design §1.3.1.1 裁决 3）。
 *
 * ============ dsh 双面向 ============
 *   - **用**：dsh 的 session 归属按 `header.cwd` 判定 ⇒ 「一个副本一个 path」与之同构；
 *   - **暴露**：宿主可见控制面 —— 派单 cwd 语义统一后，宿主换副本 = 换 instanceId。
 */

import { StratixAgentConfig } from '../../stratix-core';
import { AgentRouter, agentRouter } from '../../stratix-core/agent/AgentRouter';
import type { AgentTask } from '../../stratix-core/agent/types';
import type { ProjectInstanceId } from '../../core/types';
import { LRAClient } from '../../stratix-lra-bridge/LRAClient';
import { loadApiKey } from '../api/apiKeyStore';

import { LLMAgent } from './agents/LLMAgent';
import { OpenClawAgent } from './agents/OpenClawAgent';
import type { AgentInterface, AgentState } from './agents/types';


export type { AgentState };

/**
 * 实例路径解析口（**注册表为准**）—— @since v3.3（task_206 / M2-09）。
 *
 * 口径：副本 id ⇒ 该副本的**绝对项目根**（= `ProjectInstanceView.path`）。
 * why 是端口而不是直接依赖注册表：编排服务在 gateway 进程里，注册表由**组合根**持有
 *   （`src/stratix-gateway/index.ts` 建一份，boot / 归档 / 容量守门共用）——
 *   编排层只认「给我 id 我还你路径」这一件事，不该自己去摸注册表。
 * why 查不到就是查不到（返回 undefined）：副本被删 / 归档 / 路径丢了 ⇒ 派单无处可跑，
 *   如实报错，不猜路径（写错地方比不写更糟 —— 与 instance-loader-node 的纪律同源）。
 */
export type InstancePathResolver = (instanceId: ProjectInstanceId) => string | undefined;

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  turnCount: number;
}

export class AgentOrchestrationService {
  private static instance: AgentOrchestrationService;
  private agents: Map<string, AgentInterface> = new Map();
  private agentStates: Map<string, AgentState> = new Map();
  private usageStats: Map<string, UsageStats> = new Map();
  private lraClient: LRAClient;
  private agentConfigs: Map<string, StratixAgentConfig> = new Map();
  private router: AgentRouter;
  /** 实例路径解析口（@since v3.3，task_206 / M2-09）—— 组合根注入，见 `setInstancePathResolver`。 */
  private resolveInstancePath: InstancePathResolver | undefined;

  private constructor() {
    this.lraClient = new LRAClient();
    this.router = agentRouter;

    // Wire router executor to this service's agent start logic
    this.router.initializeWithOrchestration(
      (task: AgentTask, _agentId: string | undefined, _signal: AbortSignal) => {
        const actualAgentId = task.agentId ?? task.taskId;
        const agent = this.agents.get(actualAgentId);
        if (!agent) {
          return Promise.reject(new Error(`Agent ${actualAgentId} not found`));
        }
        return agent.start().catch((error: unknown) => {
          this.agents.delete(actualAgentId);
          this.agentStates.delete(actualAgentId);
          throw error;
        });
      }
    );
  }

  static getInstance(): AgentOrchestrationService {
    if (!AgentOrchestrationService.instance) {
      AgentOrchestrationService.instance = new AgentOrchestrationService();
    }
    return AgentOrchestrationService.instance;
  }

  registerAgentConfig(agentId: string, config: StratixAgentConfig): void {
    this.agentConfigs.set(agentId, config);
  }

  /**
   * 注入**实例路径解析口**（@since v3.3，task_206 / M2-09）—— 组合根接线用。
   *
   * why 是 setter 而不是构造参数：编排服务是**单例**（路由模块 import 即建），
   *   而注册表由组合根在**路由挂载之前**才建好（`src/stratix-gateway/index.ts`）——
   *   构造注入拿不到，注册表注入是唯一说得通的时序。
   * why 可以后覆盖：解析口是**接线件**不是 agent 状态，覆盖即换一份注册表（副本清单变了）。
   * why 允许传 undefined：**未接线**是一种真实状态（嵌入式用法 / 单测）——
   *   此时 startAgent 报「解析不出路径」而不是回落成进程 cwd（回落 = 又多一个路径真相源）。
   */
  setInstancePathResolver(resolver: InstancePathResolver | undefined): void {
    this.resolveInstancePath = resolver;
  }

  /**
   * 启动一个 agent（工作目录 = **副本的项目根**，由实例注册表解析）。
   *
   * @param agentId agent id。
   * @param instanceId **物理副本 id**（= 实例注册表的稳定 id；路径移动后不变）。
   * @param zoneId 编排层的 zone 分组（Zone 玩法已退役，字段保留不删）。
   */
  async startAgent(
    agentId: string,
    instanceId: ProjectInstanceId,
    zoneId: string
  ): Promise<void> {
    if (this.agents.has(agentId)) {
      throw new Error(`Agent ${agentId} is already working`);
    }

    const agentConfig = this.agentConfigs.get(agentId);
    if (!agentConfig) {
      console.warn(`[AgentOrchestrationService] Agent ${agentId} config not found, skipping start`);
      return;
    }

    const configWithApiKey = { ...agentConfig };

    if (configWithApiKey.stratixConfig && !configWithApiKey.stratixConfig.apiKey) {
      const apiKeyResult = await loadApiKey(configWithApiKey.stratixConfig.provider);
      if (apiKeyResult.success && apiKeyResult.data) {
        configWithApiKey.stratixConfig.apiKey = apiKeyResult.data;
      }
    }

    const hasOpenClaw = configWithApiKey.openClawConfig && configWithApiKey.openClawConfig.endpoint;
    const hasStratix = configWithApiKey.stratixConfig && (configWithApiKey.stratixConfig.apiKey || configWithApiKey.stratixConfig.endpoint);

    if (!hasOpenClaw && !hasStratix) {
      console.warn(`[AgentOrchestrationService] Agent ${agentId} has no LLM/OpenClaw configuration, skipping start (agent will not respond to messages)`);
      return;
    }

    // 副本 id ⇒ 项目根（注册表为准）。查不到 = 派单无处可跑 ⇒ 如实抛错，不猜路径。
    const instancePath = this.resolveInstancePath?.(instanceId);
    if (!instancePath) {
      throw new Error(
        `[AgentOrchestrationService] 无法解析副本 ${instanceId} 的项目根（实例注册表查不到 path）`
      );
    }

    console.log(`[AgentOrchestrationService] Starting agent ${agentId} for instance ${instanceId}`);

    let agent: AgentInterface;

    if (hasOpenClaw) {
      agent = new OpenClawAgent(
        configWithApiKey,
        instancePath,
        zoneId,
        this.lraClient
      );
    } else {
      agent = new LLMAgent(
        configWithApiKey,
        instancePath,
        zoneId,
        this.lraClient
      );
    }

    this.agents.set(agentId, agent);
    this.agentStates.set(agentId, agent.getState());

    const task: AgentTask = {
      taskId: agentId,
      type: "teammate",
      agentId,
      isolation: "worktree",
      runInBackground: true,
      prompt: `session-start:${agentId}`,
    };

    this.router.dispatch(task);
  }

  async stopAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      console.log(`[AgentOrchestrationService] Agent ${agentId} not found`);
      return;
    }

    console.log(`[AgentOrchestrationService] Stopping agent ${agentId}`);

    const state = this.agentStates.get(agentId);
    if (state) {
      this.agentStates.set(agentId, {
        ...state,
        status: 'stopping'
      });
    }

    await agent.stop();

    this.agents.delete(agentId);
    this.agentStates.delete(agentId);
    this.usageStats.delete(agentId);

    console.log(`[AgentOrchestrationService] Agent ${agentId} stopped`);
  }

  async pauseAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    await agent.pause();

    const state = this.agentStates.get(agentId);
    if (state) {
      this.agentStates.set(agentId, {
        ...state,
        status: 'paused'
      });
    }
  }

  async resumeAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    await agent.resume();

    const state = this.agentStates.get(agentId);
    if (state) {
      this.agentStates.set(agentId, {
        ...state,
        status: 'working'
      });
    }
  }

  getActiveAgents(): AgentState[] {
    return Array.from(this.agentStates.values());
  }

  getProjectAgents(zoneId: string): AgentState[] {
    return this.getActiveAgents().filter(
      state => state.zoneId === zoneId
    );
  }

  getAgentState(agentId: string): AgentState | undefined {
    return this.agentStates.get(agentId);
  }

  isAgentWorking(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Update usage statistics for an agent
   */
  updateUsage(agentId: string, usage: Partial<UsageStats>): void {
    const current = this.usageStats.get(agentId) || {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      turnCount: 0,
    };
    this.usageStats.set(agentId, {
      promptTokens: current.promptTokens + (usage.promptTokens ?? 0),
      completionTokens: current.completionTokens + (usage.completionTokens ?? 0),
      totalTokens: current.totalTokens + (usage.totalTokens ?? 0),
      turnCount: current.turnCount + (usage.turnCount ?? 0),
    });
  }

  /**
   * Get usage statistics for an agent
   */
  getUsage(agentId: string): UsageStats {
    return this.usageStats.get(agentId) || {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      turnCount: 0,
    };
  }

  /**
   * Get usage from SessionRuntime (EnhancedStratixAgent).
   * Returns undefined if the agent is not an EnhancedStratixAgent or has no active session.
   */
  getAgentUsage(agentId: string): { promptTokens: number; completionTokens: number; totalTokens: number; turnCount: number } | null {
    const agent = this.agents.get(agentId);
    if (agent && agent.getUsage) {
      return agent.getUsage() ?? null;
    }
    return null;
  }

  /**
   * Get transcript from SessionRuntime (EnhancedStratixAgent).
   * Returns undefined if the agent is not an EnhancedStratixAgent or has no active session.
   */
  getAgentTranscript(agentId: string, limit: number = 50): Array<{ id: string; role: string; content: string; timestamp: number }> | null {
    const agent = this.agents.get(agentId);
    if (agent && agent.getTranscript) {
      return agent.getTranscript(limit) ?? null;
    }
    return null;
  }

  async stopAll(): Promise<void> {
    console.log('[AgentOrchestrationService] Stopping all agents');

    const results = await Promise.allSettled(
      Array.from(this.agents.keys()).map(agentId => this.stopAgent(agentId))
    );

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length > 0) {
      console.error(`[AgentOrchestrationService] ${failures.length} agents failed to stop:`, failures.map(f => f.reason));
    }
  }

  async stopProjectAgents(zoneId: string): Promise<void> {
    console.log(`[AgentOrchestrationService] Stopping all agents in project ${zoneId}`);

    const projectAgents = this.getProjectAgents(zoneId);
    const results = await Promise.allSettled(
      projectAgents.map(state => this.stopAgent(state.agentId))
    );

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length > 0) {
      console.error(`[AgentOrchestrationService] ${failures.length} agents failed to stop in project ${zoneId}:`, failures.map(f => f.reason));
    }
  }

  destroy(): void {
    this.agents.clear();
    this.agentStates.clear();
    this.usageStats.clear();
    this.agentConfigs.clear();
  }
}

export default AgentOrchestrationService;
