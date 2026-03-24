import { OpenClawAgent } from './agents/OpenClawAgent';
import { LLMAgent } from './agents/LLMAgent';
import type { AgentInterface, AgentState } from './agents/types';
import { LRAClient } from '../../stratix-lra-bridge/LRAClient';
import { StratixAgentConfig } from '../../stratix-core';
import { loadApiKey } from '../api/apiKeyStore';

export type { AgentState };

export class AgentOrchestrationService {
  private static instance: AgentOrchestrationService;
  private agents: Map<string, AgentInterface> = new Map();
  private agentStates: Map<string, AgentState> = new Map();
  private lraClient: LRAClient;
  private agentConfigs: Map<string, StratixAgentConfig> = new Map();

  private constructor() {
    this.lraClient = new LRAClient();
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
    projectId: string
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

    console.log(`[AgentOrchestrationService] Starting agent ${agentId} for project ${projectId}`);

    let agent: AgentInterface;

    if (hasOpenClaw) {
      agent = new OpenClawAgent(
        configWithApiKey,
        projectPath,
        projectId,
        this.lraClient
      );
    } else {
      agent = new LLMAgent(
        configWithApiKey,
        projectPath,
        projectId,
        this.lraClient
      );
    }

    this.agents.set(agentId, agent);
    this.agentStates.set(agentId, agent.getState());

    agent.start().catch((error: any) => {
      console.error(`[AgentOrchestrationService] Agent ${agentId} error:`, error);
      this.agents.delete(agentId);
      this.agentStates.delete(agentId);
    });
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

  getProjectAgents(projectId: string): AgentState[] {
    return this.getActiveAgents().filter(
      state => state.projectId === projectId
    );
  }

  getAgentState(agentId: string): AgentState | undefined {
    return this.agentStates.get(agentId);
  }

  isAgentWorking(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  async stopAll(): Promise<void> {
    console.log('[AgentOrchestrationService] Stopping all agents');
    
    const stopPromises = Array.from(this.agents.keys()).map(agentId => 
      this.stopAgent(agentId)
    );

    await Promise.all(stopPromises);
  }

  async stopProjectAgents(projectId: string): Promise<void> {
    console.log(`[AgentOrchestrationService] Stopping all agents in project ${projectId}`);
    
    const projectAgents = this.getProjectAgents(projectId);
    const stopPromises = projectAgents.map(state => 
      this.stopAgent(state.agentId)
    );

    await Promise.all(stopPromises);
  }
}

export default AgentOrchestrationService;
