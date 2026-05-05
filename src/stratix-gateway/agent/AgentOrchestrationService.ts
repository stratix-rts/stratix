import { StratixAgentConfig } from '../../stratix-core';
import { LRAClient } from '../../stratix-lra-bridge/LRAClient';
import { loadApiKey } from '../api/apiKeyStore';
import { AgentRouter, agentRouter } from '../../stratix-core/agent/AgentRouter';
import type { AgentTask } from '../../stratix-core/agent/types';

import { LLMAgent } from './agents/LLMAgent';
import { OpenClawAgent } from './agents/OpenClawAgent';
import type { AgentInterface, AgentState } from './agents/types';


export type { AgentState };

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

  async startAgent(
    agentId: string,
    projectPath: string,
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

    console.log(`[AgentOrchestrationService] Starting agent ${agentId} for project ${zoneId}`);

    let agent: AgentInterface;

    if (hasOpenClaw) {
      agent = new OpenClawAgent(
        configWithApiKey,
        projectPath,
        zoneId,
        this.lraClient
      );
    } else {
      agent = new LLMAgent(
        configWithApiKey,
        projectPath,
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
