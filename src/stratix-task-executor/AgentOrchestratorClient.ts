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
      console.error(`[AgentOrchestratorClient] Failed to register agent ${agentId}:`, error);
      throw new Error(`Failed to register agent: ${error}`);
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
      throw new Error(`Failed to start agent ${agentId}: ${error}`);
    }
  }
  
  async stopAgent(agentId: string): Promise<void> {
    try {
      await axios.post(`${this.baseURL}/stop/${agentId}`);
      console.log(`[AgentOrchestratorClient] Agent ${agentId} stopped`);
    } catch (error) {
      console.error(`[AgentOrchestratorClient] Failed to stop agent ${agentId}:`, error);
    }
  }
  
  async pauseAgent(agentId: string): Promise<void> {
    try {
      await axios.post(`${this.baseURL}/pause/${agentId}`);
      console.log(`[AgentOrchestratorClient] Agent ${agentId} paused`);
    } catch (error) {
      throw new Error(`Failed to pause agent ${agentId}: ${error}`);
    }
  }
  
  async resumeAgent(agentId: string): Promise<void> {
    try {
      await axios.post(`${this.baseURL}/resume/${agentId}`);
      console.log(`[AgentOrchestratorClient] Agent ${agentId} resumed`);
    } catch (error) {
      throw new Error(`Failed to resume agent ${agentId}: ${error}`);
    }
  }
  
  async getAgentState(agentId: string): Promise<AgentState | null> {
    try {
      const { data } = await axios.get(`${this.baseURL}/state/${agentId}`);
      return data.state;
    } catch (error) {
      console.error(`[AgentOrchestratorClient] Failed to get state for ${agentId}:`, error);
      return null;
    }
  }
  
  async getActiveAgents(): Promise<AgentState[]> {
    try {
      const { data } = await axios.get(`${this.baseURL}/active`);
      return data.agents || [];
    } catch (error) {
      console.error('[AgentOrchestratorClient] Failed to get active agents:', error);
      return [];
    }
  }
  
  async getProjectAgents(projectId: string): Promise<AgentState[]> {
    try {
      const { data } = await axios.get(`${this.baseURL}/project/${projectId}`);
      return data.agents || [];
    } catch (error) {
      console.error(`[AgentOrchestratorClient] Failed to get project agents for ${projectId}:`, error);
      return [];
    }
  }
  
  async stopAll(): Promise<void> {
    try {
      await axios.post(`${this.baseURL}/stop-all`);
      console.log('[AgentOrchestratorClient] All agents stopped');
    } catch (error) {
      console.error('[AgentOrchestratorClient] Failed to stop all agents:', error);
    }
  }
  
  isAgentWorking(agentId: string): boolean {
    return false;
  }
}
