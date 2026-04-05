import path from 'path';

import * as fs from 'fs-extra';

import { StratixAgentConfig } from '../../../stratix-core';
import { LRAClient } from '../../../stratix-lra-bridge/LRAClient';
import type { LraTask } from '../../../stratix-lra-bridge/types';
import { createOpenClawAdapter, OpenClawAdapterInterface } from '../../../stratix-openclaw-adapter';
import { gatewayEventBus, AgentMentionEvent } from '../../GatewayEventBus';
import { budgetController } from '@stratix-core/budget/BudgetController';
import type { TokenUsage } from '@stratix-core/budget/types';

import { AgentInterface, AgentState, ProjectChannelMessage } from './types';

export class OpenClawAgent implements AgentInterface {
  private agentConfig: StratixAgentConfig;
  private projectPath: string;
  private projectId: string;
  private lraClient: LRAClient;
  private adapter: OpenClawAdapterInterface;
  private _workDirOverride: string | undefined;

  private shouldStop = false;
  private isPaused = false;
  private currentTaskId: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private startedAt?: Date;
  private unsubscribeMention: (() => void) | null = null;
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
      throw new Error('OpenClaw configuration is required');
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
    return this._workDirOverride ?? this.projectPath;
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
    console.log(`[OpenClawAgent] ${this.agentConfig.name} starting`);
    
    await this.adapter.connect();
    console.log('[OpenClawAgent] Connected to OpenClaw');
    
    this.startedAt = new Date();
    
    // 订阅 channel 提及消息
    this.subscribeToMentions();
    
    while (!this.shouldStop) {
      try {
        while (this.isPaused && !this.shouldStop) {
          await this.sleep(1000);
        }
        
        if (this.shouldStop) break;
        
        const tasks = await this.lraClient.listTasks(this.effectiveProjectPath);
        const pendingTask = tasks.find(t => t.status === 'pending');
        
        if (!pendingTask) {
          console.log('[OpenClawAgent] No pending tasks, waiting...');
          await this.sleep(5000);
          continue;
        }
        
        this.currentTaskId = pendingTask.id;
        console.log(`[OpenClawAgent] Claiming task ${pendingTask.id}: ${pendingTask.description}`);
        
        const sessionId = await this.lraClient.claimTask(this.effectiveProjectPath, pendingTask.id);

        await this.lraClient.setTaskStatus(this.effectiveProjectPath, pendingTask.id, 'in_progress');

        this.startHeartbeat(pendingTask.id);

        try {
          await this.processTask(pendingTask);
          await this.lraClient.setTaskStatus(this.effectiveProjectPath, pendingTask.id, 'completed');
          console.log(`[OpenClawAgent] Task ${pendingTask.id} completed`);
        } catch (taskError) {
          console.error(`[OpenClawAgent] Task ${pendingTask.id} failed:`, taskError);
          await this.lraClient.setTaskStatus(this.effectiveProjectPath, pendingTask.id, 'failed');
        } finally {
          this.stopHeartbeat();
          this.currentTaskId = null;
        }
        
      } catch (error) {
        console.error('[OpenClawAgent] Error in work loop:', error);
        await this.sleep(5000);
      }
    }
    
    console.log(`[OpenClawAgent] ${this.agentConfig.name} stopped`);
  }
  
  private subscribeToMentions(): void {
    console.log(`[OpenClawAgent] ${this.agentConfig.name} (${this.agentConfig.agentId}) subscribing to mentions...`);
    
    // 监听针对当前 agent 的提及消息
    this.unsubscribeMention = gatewayEventBus.onAgentMention(
      this.agentConfig.agentId,
      (event: AgentMentionEvent) => {
        console.log(`[OpenClawAgent] ${this.agentConfig.name} received mention in channel ${event.channelId}`);
        this.handleMessage(event.message).catch(err => {
          console.error(`[OpenClawAgent] Failed to handle message:`, err);
        });
      }
    );
    
    // 测试监听是否成功
    const eventName = `agent_mention:${this.agentConfig.agentId}`;
    const listenerCount = gatewayEventBus.listenerCount(eventName);
    console.log(`[OpenClawAgent] ${this.agentConfig.name} subscribed to ${eventName}, total listeners: ${listenerCount}`);
  }
  
  private async processTask(task: LraTask): Promise<void> {
    const prompt = `You are working on task: ${task.description}\n\nProject context: ${this.effectiveProjectPath}\n\nPlease complete this task and save any output files.`;

    // Check budget before executing
    const preCheck = budgetController.evaluate(this.totalTokenUsage, 0);
    if (preCheck.action === 'stop') {
      console.warn(`[OpenClawAgent] Budget exceeded before task ${task.id}: ${preCheck.nudgeMessage}`);
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
    console.log(`[OpenClawAgent] Task response:`, content.substring(0, 200));

    // Check budget after execution
    const postCheck = budgetController.evaluate(this.totalTokenUsage, 0);
    if (postCheck.action === 'stop') {
      console.warn(`[OpenClawAgent] Budget exhausted after task ${task.id}: ${postCheck.nudgeMessage}`);
      throw new Error(`Budget exhausted: ${postCheck.reason}. ${postCheck.nudgeMessage || ''}`);
    }

    await this.lraClient.publish(this.effectiveProjectPath, task.id);
  }
  
  private startHeartbeat(taskId: string): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.lraClient.heartbeat(this.effectiveProjectPath, taskId);
      } catch (error) {
        console.error('[OpenClawAgent] Heartbeat failed:', error);
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
    console.log(`[OpenClawAgent] ${this.agentConfig.name} stopping`);
    this.shouldStop = true;
    this.stopHeartbeat();
    
    // 取消订阅提及消息
    if (this.unsubscribeMention) {
      this.unsubscribeMention();
      this.unsubscribeMention = null;
    }
    
    if (this.currentTaskId) {
      await this.lraClient.setTaskStatus(this.effectiveProjectPath, this.currentTaskId, 'pending');
    }
    
    await this.adapter.disconnect();
  }
  
  async pause(): Promise<void> {
    console.log(`[OpenClawAgent] ${this.agentConfig.name} pausing`);
    this.isPaused = true;
  }
  
  async resume(): Promise<void> {
    console.log(`[OpenClawAgent] ${this.agentConfig.name} resuming`);
    this.isPaused = false;
  }

  /**
   * 处理 channel 消息（当 agent 被@提及时调用）
   */
  async handleMessage(message: ProjectChannelMessage): Promise<void> {
    console.log(`[OpenClawAgent] ${this.agentConfig.name} handling message:`, message.content.slice(0, 100));

    // 构建 prompt
    const prompt = `You are ${this.agentConfig.name}. A user mentioned you in a chat message.

User message: ${message.content}

Please respond to the user's message. Keep your response concise and helpful.`;

    try {
      // Check budget before responding
      const preCheck = budgetController.evaluate(this.totalTokenUsage, 0);
      if (preCheck.action === 'stop') {
        console.warn(`[OpenClawAgent] Budget exceeded, skipping message handling: ${preCheck.nudgeMessage}`);
        await this.sendMessageToChannel(message.channelId, 'I apologize, but I have reached my operational budget limit for this session.');
        return;
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
      console.log(`[OpenClawAgent] ${this.agentConfig.name} responded:`, content.substring(0, 200));

      // 发送回复到 channel（通过 HTTP API）
      await this.sendMessageToChannel(message.channelId, content || 'I received your message.');
    } catch (error) {
      console.error(`[OpenClawAgent] ${this.agentConfig.name} failed to handle message:`, error);
    }
  }

  /**
   * 发送消息到 channel
   */
  private async sendMessageToChannel(channelId: string, content: string): Promise<void> {
    try {
      const response = await fetch(`http://127.0.0.1:7524/api/projects/${this.projectId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          sender: {
            id: this.agentConfig.agentId,
            type: 'agent' as const,
            name: this.agentConfig.name,
            role: this.agentConfig.soul?.identity || 'Agent'
          },
          content: content.trim(),
          source: 'local'
        })
      });

      if (!response.ok) {
        console.error(`[OpenClawAgent] Failed to send message to channel: ${response.status}`);
      } else {
        console.log(`[OpenClawAgent] ${this.agentConfig.name} sent message to channel ${channelId}`);
      }
    } catch (error) {
      console.error(`[OpenClawAgent] ${this.agentConfig.name} failed to send message:`, error);
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default OpenClawAgent;
