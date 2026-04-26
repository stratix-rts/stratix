import path from 'path';

import * as fs from 'fs-extra';


import { StratixAgentConfig } from '../../../stratix-core';
import { LRAClient } from '../../../stratix-lra-bridge/LRAClient';
import type { LraTask } from '../../../stratix-lra-bridge/types';
import { createOpenClawAdapter, OpenClawAdapterInterface } from '../../../stratix-openclaw-adapter';
import { budgetController } from '@stratix-core/budget/BudgetController';
import type { TokenUsage } from '@stratix-core/budget/types';
import { TaskQueueService } from '../../../stratix-orchestration/task-queue/TaskQueueService';

import { AgentInterface, AgentState } from './types';

export class LLMAgent implements AgentInterface {
  private agentConfig: StratixAgentConfig;
  private projectPath: string;
  private projectId: string;
  private lraClient: LRAClient;
  private adapter: OpenClawAdapterInterface;
  private _workDirOverride: string | undefined;
  private _effectiveProjectPath: string;

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
    this.effectiveProjectPath = projectPath;
    this.projectId = projectId;
    this.lraClient = lraClient;
    
    if (!agentConfig.openClawConfig) {
      throw new Error('OpenClaw configuration is required for LLMAgent');
    }
    
    this.adapter = createOpenClawAdapter(agentConfig.openClawConfig);
  }

  /**
   * Override the project path for worktree isolation.
   * Must be called before start().
   */
  setWorkingDirectory(dir: string): void {
    this._workDirOverride = dir;
  }

  private get effectiveProjectPath(): string {
    return this._workDirOverride ?? this._effectiveProjectPath;
  }

  private set effectiveProjectPath(value: string) {
    this._effectiveProjectPath = value;
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

    // Initialize TaskQueueService for Zone task polling
    const taskQueue = TaskQueueService.getInstance();

    while (!this.shouldStop) {
      try {
        while (this.isPaused && !this.shouldStop) {
          await this.sleep(1000);
        }

        if (this.shouldStop) break;

        // Priority 1: Check Zone tasks from TaskQueueService (ZoneCoordinator delegated tasks)
        try {
          const zoneTasks = await taskQueue.getTasksByAgent(this.agentConfig.agentId);
          const pendingZoneTask = zoneTasks.find(t => t.status === 'assigned' || t.status === 'pending');

          if (pendingZoneTask) {
            this.currentTaskId = pendingZoneTask.taskId;
            console.log(`[LLMAgent] Processing Zone task ${pendingZoneTask.taskId}: ${pendingZoneTask.name}`);

            this.startHeartbeat(pendingZoneTask.taskId);

            try {
              await this.processZoneTask(pendingZoneTask);
              await taskQueue.updateTask(pendingZoneTask.taskId, { status: 'completed' });
            } catch (taskError) {
              console.error(`[LLMAgent] Zone task failed:`, taskError);
              await taskQueue.updateTask(pendingZoneTask.taskId, { status: 'failed', error: String(taskError) });
            } finally {
              this.stopHeartbeat();
              this.currentTaskId = null;
            }

            continue; // Process one task at a time
          }
        } catch (zoneError) {
          console.warn(`[LLMAgent] Zone task polling error:`, zoneError);
          // Fall through to LRA polling
        }

        // Priority 2: Check LRA tasks (original behavior)
        const tasks = await this.lraClient.listTasks(this.effectiveProjectPath);
        const pendingTask = tasks.find(t => t.status === 'pending');

        if (!pendingTask) {
          await this.sleep(5000);
          continue;
        }

        this.currentTaskId = pendingTask.id;
        console.log(`[LLMAgent] Processing LRA task ${pendingTask.id}`);

        await this.lraClient.claimTask(this.effectiveProjectPath, pendingTask.id);
        await this.lraClient.setTaskStatus(this.effectiveProjectPath, pendingTask.id, 'in_progress');

        this.startHeartbeat(pendingTask.id);

        try {
          await this.processTask(pendingTask);
          await this.lraClient.setTaskStatus(this.effectiveProjectPath, pendingTask.id, 'completed');
        } catch (taskError) {
          console.error(`[LLMAgent] Task failed:`, taskError);
          await this.lraClient.setTaskStatus(this.effectiveProjectPath, pendingTask.id, 'failed');
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
    const prompt = `${soul}\n\nTask: ${task.description}\n\nProject: ${this.effectiveProjectPath}`;

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

    await this.lraClient.publish(this.effectiveProjectPath, task.id);
  }

  /**
   * Process a task delegated via ZoneCoordinator / TaskQueueService
   */
  private async processZoneTask(task: { taskId: string; zoneId: string; name: string; description?: string; type?: string }): Promise<void> {
    const soul = (this.agentConfig.soul as any)?.prompt || 'You are a helpful assistant.';
    const taskDescription = task.description || task.name;
    const prompt = `${soul}\n\nZone Task: ${task.name}\n\nDescription: ${taskDescription}\n\nZone: ${task.zoneId}\nProject: ${this.effectiveProjectPath}\n\nPlease complete this task and report the results.`;

    // Check budget before executing
    const preCheck = budgetController.evaluate(this.totalTokenUsage, 0);
    if (preCheck.action === 'stop') {
      console.warn(`[LLMAgent] Budget exceeded before Zone task ${task.taskId}: ${preCheck.nudgeMessage}`);
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
    console.log(`[LLMAgent] Zone task response:`, content.substring(0, 200));

    // Check budget after execution
    const postCheck = budgetController.evaluate(this.totalTokenUsage, 0);
    if (postCheck.action === 'stop') {
      console.warn(`[LLMAgent] Budget exhausted after Zone task ${task.taskId}: ${postCheck.nudgeMessage}`);
      throw new Error(`Budget exhausted: ${postCheck.reason}. ${postCheck.nudgeMessage || ''}`);
    }

    // Notify ZoneCoordinator via the agentTask API
    try {
      const axios = (await import('axios')).default;
      await axios.post(`/api/agent/${this.agentConfig.agentId}/tasks/${task.taskId}/complete`, {
        result: { output: content }
      });
    } catch (notifyError) {
      console.warn(`[LLMAgent] Failed to notify task completion:`, notifyError);
    }
  }

  private startHeartbeat(taskId: string): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.lraClient.heartbeat(this.effectiveProjectPath, taskId);
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
      await this.lraClient.setTaskStatus(this.effectiveProjectPath, this.currentTaskId, 'pending');
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