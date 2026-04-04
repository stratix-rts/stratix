import path from 'path';

import fs from 'fs-extra';


import { StratixAgentConfig } from '../../../stratix-core';
import { LRAClient } from '../../../stratix-lra-bridge/LRAClient';
import type { LraTask } from '../../../stratix-lra-bridge/types';
import { createOpenClawAdapter, OpenClawAdapterInterface } from '../../../stratix-openclaw-adapter';
import { budgetController } from '@stratix-core/budget/BudgetController';
import type { TokenUsage } from '@stratix-core/budget/types';

import { AgentInterface, AgentState } from './types';

export class LLMAgent implements AgentInterface {
  private agentConfig: StratixAgentConfig;
  private projectPath: string;
  private projectId: string;
  private lraClient: LRAClient;
  private adapter: OpenClawAdapterInterface;
  
  private shouldStop = false;
  private isPaused = false;
  private currentTaskId: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private startedAt?: Date;
  private totalTokenUsage: TokenUsage = { totalTokens: 0, promptTokens: 0, completionTokens: 0 };
  
  constructor(
    agentConfig: StratixAgentConfig,
    projectPath: string,
    projectId: string,
    lraClient: LRAClient
  ) {
    this.agentConfig = agentConfig;
    this.projectPath = projectPath;
    this.projectId = projectId;
    this.lraClient = lraClient;
    
    if (!agentConfig.openClawConfig) {
      throw new Error('OpenClaw configuration is required for LLMAgent');
    }
    
    this.adapter = createOpenClawAdapter(agentConfig.openClawConfig);
  }
  
  getState(): AgentState {
    return {
      agentId: this.agentConfig.agentId,
      name: this.agentConfig.name,
      projectId: this.projectId,
      status: this.shouldStop ? 'stopping' : (this.isPaused ? 'paused' : 'working'),
      currentTaskId: this.currentTaskId || undefined,
      startedAt: this.startedAt
    };
  }
  
  async start(): Promise<void> {
    console.log(`[LLMAgent] ${this.agentConfig.name} starting`);
    
    await this.adapter.connect();
    this.startedAt = new Date();
    
    while (!this.shouldStop) {
      try {
        while (this.isPaused && !this.shouldStop) {
          await this.sleep(1000);
        }
        
        if (this.shouldStop) break;
        
        const tasks = await this.lraClient.listTasks(this.projectPath);
        const pendingTask = tasks.find(t => t.status === 'pending');
        
        if (!pendingTask) {
          await this.sleep(5000);
          continue;
        }
        
        this.currentTaskId = pendingTask.id;
        console.log(`[LLMAgent] Processing task ${pendingTask.id}`);
        
        await this.lraClient.claimTask(this.projectPath, pendingTask.id);
        await this.lraClient.setTaskStatus(this.projectPath, pendingTask.id, 'in_progress');
        
        this.startHeartbeat(pendingTask.id);
        
        try {
          await this.processTask(pendingTask);
          await this.lraClient.setTaskStatus(this.projectPath, pendingTask.id, 'completed');
        } catch (taskError) {
          console.error(`[LLMAgent] Task failed:`, taskError);
          await this.lraClient.setTaskStatus(this.projectPath, pendingTask.id, 'failed');
        } finally {
          this.stopHeartbeat();
          this.currentTaskId = null;
        }
        
      } catch (error) {
        console.error('[LLMAgent] Error:', error);
        await this.sleep(5000);
      }
    }
    
    console.log(`[LLMAgent] ${this.agentConfig.name} stopped`);
  }
  
  private async processTask(task: LraTask): Promise<void> {
    const soul = (this.agentConfig.soul as any)?.prompt || 'You are a helpful assistant.';
    const prompt = `${soul}\n\nTask: ${task.description}\n\nProject: ${this.projectPath}`;

    // Check budget before executing
    const preCheck = budgetController.evaluate(this.totalTokenUsage, 0);
    if (preCheck.action === 'stop') {
      console.warn(`[LLMAgent] Budget exceeded before task ${task.id}: ${preCheck.nudgeMessage}`);
      throw new Error(`Budget exceeded: ${preCheck.reason}. ${preCheck.nudgeMessage || ''}`);
    }

    const response = await this.adapter.openaiChatCompletion({
      model: 'openclaw',
      messages: [{ role: 'user', content: prompt }],
    });

    const usage = response.usage;
    if (usage) {
      this.totalTokenUsage = {
        totalTokens: this.totalTokenUsage.totalTokens + usage.total_tokens,
        promptTokens: this.totalTokenUsage.promptTokens + usage.prompt_tokens,
        completionTokens: this.totalTokenUsage.completionTokens + usage.completion_tokens,
      };
    }

    const content = response.choices[0]?.message?.content || '';
    console.log(`[LLMAgent] Response:`, content.substring(0, 200));

    // Check budget after execution
    const postCheck = budgetController.evaluate(this.totalTokenUsage, 0);
    if (postCheck.action === 'stop') {
      console.warn(`[LLMAgent] Budget exhausted after task ${task.id}: ${postCheck.nudgeMessage}`);
      throw new Error(`Budget exhausted: ${postCheck.reason}. ${postCheck.nudgeMessage || ''}`);
    }

    await this.lraClient.publish(this.projectPath, task.id);
  }
  
  private startHeartbeat(taskId: string): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.lraClient.heartbeat(this.projectPath, taskId);
      } catch (error) {
        console.error('[LLMAgent] Heartbeat failed:', error);
      }
    }, 30000);
  }
  
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
  
  async stop(): Promise<void> {
    this.shouldStop = true;
    this.stopHeartbeat();
    
    if (this.currentTaskId) {
      await this.lraClient.setTaskStatus(this.projectPath, this.currentTaskId, 'pending');
    }
    
    await this.adapter.disconnect();
  }
  
  async pause(): Promise<void> {
    this.isPaused = true;
  }
  
  async resume(): Promise<void> {
    this.isPaused = false;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}