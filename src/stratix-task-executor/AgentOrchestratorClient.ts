import axios from 'axios';

import { StratixAgentConfig } from '../stratix-core';
import type { AgentState } from '../stratix-gateway/agent/agents/types';

export interface AgentOrchestratorClientConfig {
  baseURL?: string;
}

export class AgentOrchestratorClient {
  private static instance: AgentOrchestratorClient;
  private baseURL: string;
  
  private constructor(config?: AgentOrchestratorClientConfig) {
    this.baseURL = config?.baseURL || '/api/agents/orchestration';
  }
  
  static getInstance(): AgentOrchestratorClient {
    if (!AgentOrchestratorClient.instance) {
      AgentOrchestratorClient.instance = new AgentOrchestratorClient();
    }
    return AgentOrchestratorClient.instance;
  }
  
  async registerAgent(agentId: string, config: StratixAgentConfig): Promise<void> {
    try {
      await axios.post(`${this.baseURL}/register`, { agentId, config });
      console.log(`[AgentOrchestratorClient] Agent ${agentId} registered`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[AgentOrchestratorClient] Failed to register agent ${agentId}:`, msg);
      throw new Error(`Failed to register agent: ${msg}`);
    }
  }
  
  async startAgent(agentId: string, projectPath: string, projectId: string): Promise<void> {
    try {
      await axios.post(`${this.baseURL}/start`, {
        agentId,
        projectPath,
        projectId
      });
      console.log(`[AgentOrchestratorClient] Agent ${agentId} started for project ${projectId}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to start agent ${agentId}: ${msg}`);
    }
  }

  async stopAgent(agentId: string): Promise<void> {
    try {
      await axios.post(`${this.baseURL}/stop/${agentId}`);
      console.log(`[AgentOrchestratorClient] Agent ${agentId} stopped`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[AgentOrchestratorClient] Failed to stop agent ${agentId}:`, msg);
      throw new Error(`Failed to stop agent ${agentId}: ${msg}`);
    }
  }
  
  async pauseAgent(agentId: string): Promise<void> {
    try {
      await axios.post(`${this.baseURL}/pause/${agentId}`);
      console.log(`[AgentOrchestratorClient] Agent ${agentId} paused`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to pause agent ${agentId}: ${msg}`);
    }
  }

  async resumeAgent(agentId: string): Promise<void> {
    try {
      await axios.post(`${this.baseURL}/resume/${agentId}`);
      console.log(`[AgentOrchestratorClient] Agent ${agentId} resumed`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to resume agent ${agentId}: ${msg}`);
    }
  }
  
  async getAgentState(agentId: string): Promise<AgentState | null> {
    try {
      const { data } = await axios.get(`${this.baseURL}/state/${agentId}`);
      return data.state;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[AgentOrchestratorClient] Failed to get state for ${agentId}:`, msg);
      return null;
    }
  }

  async getActiveAgents(): Promise<AgentState[]> {
    try {
      const { data } = await axios.get(`${this.baseURL}/active`);
      return data.agents || [];
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[AgentOrchestratorClient] Failed to get active agents:', msg);
      return [];
    }
  }

  async getProjectAgents(projectId: string): Promise<AgentState[]> {
    try {
      const { data } = await axios.get(`${this.baseURL}/project/${projectId}`);
      return data.agents || [];
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[AgentOrchestratorClient] Failed to get project agents for ${projectId}:`, msg);
      return [];
    }
  }
  
  async stopAll(): Promise<void> {
    try {
      await axios.post(`${this.baseURL}/stop-all`);
      console.log('[AgentOrchestratorClient] All agents stopped');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[AgentOrchestratorClient] Failed to stop all agents:', msg);
      throw new Error(`Failed to stop all agents: ${msg}`);
    }
  }
  
  isAgentWorking(agentId: string): boolean {
    return false;
  }
}
