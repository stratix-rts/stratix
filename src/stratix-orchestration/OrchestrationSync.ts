/**
 * OrchestrationSync - Connects orchestration services to StatusSync WebSocket
 *
 * This service bridges ZoneManager, TaskQueueService, BackgroundAgentService,
 * and AgentMessageRouter events to the WebSocket layer for frontend sync.
 */

import path from 'path';

import { BackgroundAgentService } from './background/BackgroundAgentService';
import type { BackgroundAgentEvent } from './background/BackgroundAgentService';
import { AgentMessageRouter } from './messaging/AgentMessageRouter';
import { MessageEvent } from './messaging/MessageTypes';
import { TaskEvent } from './task-queue/TaskItem';
import { TaskQueueService } from './task-queue/TaskQueueService';
import ZoneCoordinatorEventEmitter, { type ZoneCoordinatorEventPayload } from './zone/ZoneCoordinatorEvents';
import { ZoneManager } from './zone/ZoneManager';
import { ZoneEvent } from './zone/ZoneState';

function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[OrchestrationSync] ${message}`, ctx);
}

// Type for StatusSync - avoid circular dependency at type level
interface StatusSyncInterface {
  notifyZoneUpdate(zoneId: string, data: Record<string, unknown>): void;
  notifyTaskAssigned(taskId: string, agentId: string, zoneId: string): void;
  notifyTaskCompleted(taskId: string, agentId: string, result?: unknown): void;
  notifyBackgroundAgentStatus(agentId: string, status: string, zoneId?: string, error?: string): void;
  notifyAgentMessageSent(messageId: string, conversationId: string, senderId: string, messageType: string): void;
  notifyAgentTaskAssigned(agentId: string, task: {
    taskId: string;
    zoneId: string;
    name: string;
    description?: string;
    type: string;
    priority: number;
  }): void;
  notify?: (payload: { type: string; payload: unknown }) => void;
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
      log('warn', 'StatusSync not available', { error: String(e) });
      return null;
    }
  }

  private getZoneService(): { addFiles: (zoneId: string, files: Array<{ name: string; sourceType: 'local'; source: string }>) => Promise<void> } | null {
    try {
      if (typeof require !== 'undefined') {
        const module = require('../stratix-gateway/project/ZoneService');
        return module.zoneService;
      }
      return null;
    } catch (e) {
      log('warn', 'ZoneService not available', { error: String(e) });
      return null;
    }
  }

  /**
   * Notify ZoneCoordinator event via WebSocket
   */
  private notifyZoneCoordinatorEvent(event: ZoneCoordinatorEventPayload): void {
    const sync = this.getStatusSync();
    if (sync?.notify) {
      sync.notify({
        type: 'zone_coordinator_event',
        payload: event,
      });
    }
  }

  /**
   * Sync task output files to the associated zone
   */
  private async syncTaskFilesToZone(taskId: string): Promise<void> {
    const task = await this.taskQueue.getTask(taskId);
    if (!task) return;

    // Skip if task has no zone or no output files
    if (!task.zoneId || !task.result?.files?.length) return;

    const zoneService = this.getZoneService();
    if (!zoneService) return;

    const files = task.result.files.map(filePath => ({
      name: path.basename(filePath),
      sourceType: 'local' as const,
      source: filePath,
    }));

    try {
      await zoneService.addFiles(task.zoneId, files);
      log('info', `Synced ${files.length} output files to zone ${task.zoneId}`);
    } catch (err) {
      log('warn', `Failed to add files to zone ${task.zoneId}`, { error: String(err) });
    }
  }

  private setupZoneListeners(): void {
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
  }

  private setupTaskListeners(): void {
    const taskHandler = (event: TaskEvent) => {
      const sync = this.getStatusSync();
      if (sync) {
        if (event.type === 'assigned' || event.type === 'started') {
          // Try to resolve zoneId from event data or task record
          const zoneId = (event.data?.zoneId as string) || '';
          sync.notifyTaskAssigned(event.taskId, event.agentId || '', zoneId);
        } else if (event.type === 'completed') {
          sync.notifyTaskCompleted(event.taskId, event.agentId || '');
          this.syncTaskFilesToZone(event.taskId).catch(err => {
            log('error', 'Failed to sync task files to zone', { error: String(err) });
          });
        }
      }
    };
    this.taskQueue.on('*', taskHandler);
    this.cleanupFns.push(() => this.taskQueue.off('*', taskHandler));
  }

  private setupBackgroundAgentListeners(): void {
    const bgHandler = (event: BackgroundAgentEvent) => {
      const sync = this.getStatusSync();
      if (!sync) return;

      switch (event.type) {
        case 'agent_started':
          sync.notifyBackgroundAgentStatus(event.agentId, 'running', event.zoneId);
          break;
        case 'agent_stopped':
          sync.notifyBackgroundAgentStatus(event.agentId, 'stopped');
          break;
        case 'agent_paused':
          sync.notifyBackgroundAgentStatus(event.agentId, 'paused');
          break;
        case 'agent_resumed':
          sync.notifyBackgroundAgentStatus(event.agentId, 'running');
          break;
        case 'task_assigned':
          sync.notifyTaskAssigned(event.taskId || '', event.agentId, event.zoneId || '');
          break;
        case 'task_completed':
          sync.notifyTaskCompleted(event.taskId || '', event.agentId);
          break;
      }
    };
    this.backgroundService.onEvent(bgHandler);
    this.cleanupFns.push(() => this.backgroundService.offEvent(bgHandler));
  }

  private setupMessageListeners(): void {
    const msgHandler = (event: MessageEvent) => {
      const sync = this.getStatusSync();
      if (sync) {
        // Map internal event type to a broader message type; fallback to direct
        const messageType = event.type === 'sent' ? 'direct' : event.type;
        sync.notifyAgentMessageSent(
          event.messageId,
          event.conversationId,
          event.recipientId || '',
          messageType
        );
      }
    };
    this.messageRouter.on('sent', msgHandler);
    this.cleanupFns.push(() => this.messageRouter.off('sent', msgHandler));
  }

  private setupZoneCoordinatorListeners(): void {
    const zoneCoordinatorEmitter = ZoneCoordinatorEventEmitter.getInstance();
    const zoneCoordHandler = (payload: ZoneCoordinatorEventPayload) => {
      const sync = this.getStatusSync();
      if (sync && payload.type === 'task_delegated' && payload.agentId && payload.task) {
        sync.notifyAgentTaskAssigned(payload.agentId, {
          taskId: payload.task.id,
          zoneId: payload.zoneId,
          name: payload.task.title,
          description: payload.task.description,
          type: payload.task.type,
          priority: payload.task.priority,
        });
      }
      this.notifyZoneCoordinatorEvent(payload);
    };
    zoneCoordinatorEmitter.onAny(zoneCoordHandler);
    this.cleanupFns.push(() => zoneCoordinatorEmitter.offAny(zoneCoordHandler));
  }

  /**
   * Initialize all event listeners
   */
  initialize(): void {
    if (this.isInitialized) return;

    log('info', 'Initializing orchestration sync...');

    this.setupZoneListeners();
    this.setupTaskListeners();
    this.setupBackgroundAgentListeners();
    this.setupMessageListeners();
    this.setupZoneCoordinatorListeners();

    this.isInitialized = true;
    log('info', 'Orchestration sync initialized');
  }

  /**
   * Cleanup all listeners
   */
  cleanup(): void {
    if (!this.isInitialized) return;

    for (const cleanupFn of this.cleanupFns) {
      try {
        cleanupFn();
      } catch (err) {
        log('warn', 'Error during orchestration sync cleanup', { error: String(err) });
      }
    }
    this.cleanupFns = [];

    this.isInitialized = false;
    log('info', 'Orchestration sync cleanup complete');
  }

  /**
   * Health check for the orchestration sync
   */
  isHealthy(): boolean {
    return this.isInitialized;
  }
}

export default OrchestrationSync;
