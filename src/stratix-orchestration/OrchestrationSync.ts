/**
 * OrchestrationSync - Connects orchestration services to StatusSync WebSocket
 *
 * This service bridges ZoneManager, TaskQueueService, BackgroundAgentService,
 * and AgentMessageRouter events to the WebSocket layer for frontend sync.
 */

import { ZoneManager } from './zone/ZoneManager';
import { TaskQueueService } from './task-queue/TaskQueueService';
import { BackgroundAgentService } from './background/BackgroundAgentService';
import { AgentMessageRouter } from './messaging/AgentMessageRouter';
import { ZoneEvent } from './zone/ZoneState';
import { TaskEvent } from './task-queue/TaskItem';
import { MessageEvent } from './messaging/MessageTypes';

// Type for StatusSync - avoid circular dependency at type level
interface StatusSyncInterface {
  notifyZoneUpdate(zoneId: string, data: Record<string, unknown>): void;
  notifyTaskAssigned(taskId: string, agentId: string, zoneId: string): void;
  notifyTaskCompleted(taskId: string, agentId: string, result?: unknown): void;
  notifyBackgroundAgentStatus(agentId: string, status: string, zoneId?: string, error?: string): void;
  notifyAgentMessageSent(messageId: string, conversationId: string, senderId: string, messageType: string): void;
}

export class OrchestrationSync {
  private static instance: OrchestrationSync;
  private zoneManager: ZoneManager;
  private taskQueue: TaskQueueService;
  private backgroundService: BackgroundAgentService;
  private messageRouter: AgentMessageRouter;
  private isInitialized = false;

  // Store cleanup functions for proper memory management
  private cleanupFns: Array<() => void> = [];

  // Lazy reference to StatusSync
  private statusSyncRef: StatusSyncInterface | null = null;

  private constructor() {
    this.zoneManager = ZoneManager.getInstance();
    this.taskQueue = TaskQueueService.getInstance();
    this.backgroundService = BackgroundAgentService.getInstance();
    this.messageRouter = AgentMessageRouter.getInstance();
  }

  static getInstance(): OrchestrationSync {
    if (!OrchestrationSync.instance) {
      OrchestrationSync.instance = new OrchestrationSync();
    }
    return OrchestrationSync.instance;
  }

  private getStatusSync(): StatusSyncInterface | null {
    if (this.statusSyncRef) return this.statusSyncRef;

    try {
      // Static import at runtime - avoid circular import at module load time
      // by using dynamic require only when first accessed
      if (typeof require !== 'undefined') {
        const StatusSyncModule = require('../stratix-gateway/api/websocket/StatusSync');
        this.statusSyncRef = StatusSyncModule.default || StatusSyncModule;
        return this.statusSyncRef;
      }
      return null;
    } catch (e) {
      console.warn('[OrchestrationSync] StatusSync not available:', e);
      return null;
    }
  }

  /**
   * Initialize all event listeners
   */
  initialize(): void {
    if (this.isInitialized) return;

    console.log('[OrchestrationSync] Initializing orchestration sync...');

    // Zone events
    const zoneHandler = (event: ZoneEvent) => {
      const sync = this.getStatusSync();
      if (sync) {
        sync.notifyZoneUpdate(event.zoneId, {
          type: event.type,
          agentId: event.agentId,
          ...event.data,
        });
      }
    };
    this.zoneManager.on('*', zoneHandler);
    this.cleanupFns.push(() => this.zoneManager.off('*', zoneHandler));

    // Task events
    const taskHandler = (event: TaskEvent) => {
      const sync = this.getStatusSync();
      if (sync) {
        if (event.type === 'assigned' || event.type === 'started') {
          sync.notifyTaskAssigned(event.taskId, event.agentId || '', '');
        } else if (event.type === 'completed') {
          sync.notifyTaskCompleted(event.taskId, event.agentId || '');
        }
      }
    };
    this.taskQueue.on('*', taskHandler);
    this.cleanupFns.push(() => this.taskQueue.off('*', taskHandler));

    // Background agent events
    const bgHandler = (event: any) => {
      const sync = this.getStatusSync();
      if (sync) {
        if (event.type === 'agent_started') {
          sync.notifyBackgroundAgentStatus(event.agentId, 'running', event.zoneId);
        } else if (event.type === 'agent_stopped') {
          sync.notifyBackgroundAgentStatus(event.agentId, 'stopped');
        } else if (event.type === 'agent_paused') {
          sync.notifyBackgroundAgentStatus(event.agentId, 'paused');
        } else if (event.type === 'agent_resumed') {
          sync.notifyBackgroundAgentStatus(event.agentId, 'running');
        } else if (event.type === 'task_assigned') {
          sync.notifyTaskAssigned(event.taskId, event.agentId, '');
        } else if (event.type === 'task_completed') {
          sync.notifyTaskCompleted(event.taskId, event.agentId);
        }
      }
    };
    this.backgroundService.onEvent(bgHandler);
    this.cleanupFns.push(() => this.backgroundService.offEvent(bgHandler));

    // Agent message events
    const msgHandler = (event: MessageEvent) => {
      const sync = this.getStatusSync();
      if (sync) {
        sync.notifyAgentMessageSent(
          event.messageId,
          event.conversationId,
          event.recipientId || '',
          'direct'
        );
      }
    };
    this.messageRouter.on('sent', msgHandler);
    this.cleanupFns.push(() => this.messageRouter.off('sent', msgHandler));

    this.isInitialized = true;
    console.log('[OrchestrationSync] Orchestration sync initialized');
  }

  /**
   * Cleanup all listeners
   */
  cleanup(): void {
    if (!this.isInitialized) return;

    // Remove all registered listeners
    for (const cleanupFn of this.cleanupFns) {
      cleanupFn();
    }
    this.cleanupFns = [];

    this.isInitialized = false;
    console.log('[OrchestrationSync] Orchestration sync cleanup complete');
  }
}

export default OrchestrationSync;
