/**
 * Stratix Gateway - 状态同步服务
 *
 * 通过 WebSocket 实时推送 Agent 和指令状态到前端
 * 监听 GatewayEventBus 将内部事件转发到 WebSocket
 */

import { WebSocketServer, WebSocket } from 'ws';

import { StratixStateSyncEvent, StratixStateSyncEventType, AgentStatusInfo } from '../../../stratix-core/stratix-protocol';
import { ProjectChannelMessage } from '../../../stratix-project/types';
import { gatewayEventBus, ChannelMessageEvent, ZoneEvent } from '../../GatewayEventBus';
import ZoneCoordinatorEventEmitter, { type ZoneCoordinatorEventPayload } from '../../../stratix-orchestration/zone/ZoneCoordinatorEvents';

interface ClientInfo {
  ws: WebSocket;
  type: 'frontend' | 'agent';
  agentId?: string;
}

interface AliveMarker {
  isAlive: boolean;
}

const aliveMarkers = new WeakMap<WebSocket, AliveMarker>();

export class StatusSyncService {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private clientInfo: Map<WebSocket, ClientInfo> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private unsubscribeChannelMessage: (() => void) | null = null;
  private unsubscribeZoneEvent: (() => void) | null = null;
  private unsubscribeZoneCoordinatorEvent: (() => void) | null = null;

  constructor(port: number = 3001) {
    this.wss = new WebSocketServer({ port });
    this.setupServer();
    this.startHeartbeat();
    this.setupEventBusListeners();
    this.setupZoneCoordinatorListeners();
  }

  private setAlive(ws: WebSocket, value: boolean): void {
    let marker = aliveMarkers.get(ws);
    if (!marker) {
      marker = { isAlive: true };
      aliveMarkers.set(ws, marker);
    }
    marker.isAlive = value;
  }

  private getAlive(ws: WebSocket): boolean {
    return aliveMarkers.get(ws)?.isAlive ?? true;
  }

  private setupServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);
      console.log(`[StatusSync] Client connected. Total clients: ${this.clients.size}`);

      this.setAlive(ws, true);

      ws.on('pong', () => {
        this.setAlive(ws, true);
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'register') {
            const clientType = message.clientType || 'frontend';
            const agentId = message.agentId;
            
            this.clientInfo.set(ws, {
              ws,
              type: clientType,
              agentId
            });
            
            console.log(`[StatusSync] Client registered: ${clientType}${agentId ? ` (agent: ${agentId})` : ''}`);
          }
        } catch (e) {
          console.warn('[StatusSync] Failed to parse client message:', e);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.clientInfo.delete(ws);
        aliveMarkers.delete(ws);
        console.log(`[StatusSync] Client disconnected. Total clients: ${this.clients.size}`);
      });

      ws.on('error', (error) => {
        console.error('[StatusSync] WebSocket error:', error);
        this.clients.delete(ws);
        this.clientInfo.delete(ws);
        aliveMarkers.delete(ws);
      });

      this.sendWelcome(ws);
    });
  }

  private setupEventBusListeners(): void {
    // 监听 channel 消息事件，转发到 WebSocket
    this.unsubscribeChannelMessage = gatewayEventBus.onChannelMessage((event: ChannelMessageEvent) => {
      // 广播新消息给所有前端客户端
      this.broadcast({
        eventType: 'stratix:project_message_new',
        payload: {
          zoneId: event.zoneId,
          channelId: event.channelId,
          message: event.message
        },
        timestamp: Date.now(),
        requestId: `stratix-req-${Date.now()}`
      });

      // 单独通知被提及的 agent（通过 WebSocket）
      if (event.message.mentions && event.message.mentions.length > 0) {
        for (const agentId of event.message.mentions) {
          if (event.subscriberIds.includes(agentId)) {
            this.notifyAgentMention(agentId, event);
          }
        }
      }
    });

    // 监听 Zone 事件，转发到 WebSocket
    this.unsubscribeZoneEvent = gatewayEventBus.onZoneEvent((event: ZoneEvent) => {
      this.broadcastZoneEvent(event);
    });
  }

  private setupZoneCoordinatorListeners(): void {
    const eventEmitter = ZoneCoordinatorEventEmitter.getInstance();

    // Listen for task_delegated events and push to agent WebSocket
    this.unsubscribeZoneCoordinatorEvent = eventEmitter.on('task_delegated', (payload: ZoneCoordinatorEventPayload) => {
      if (payload.agentId && payload.task) {
        this.notifyAgentTaskAssigned(payload.agentId, {
          taskId: payload.task.id,
          zoneId: payload.zoneId,
          name: payload.task.title,
          description: payload.task.description,
          type: payload.task.type,
          priority: payload.task.priority
        });
      }
    });
  }

  private broadcastZoneEvent(event: ZoneEvent): void {
    const eventTypeMap: Record<ZoneEvent['type'], StratixStateSyncEventType> = {
      'zone:created': 'stratix:zone_created',
      'zone:updated': 'stratix:zone_updated',
      'zone:file_added': 'stratix:zone_file_added',
      'zone:file_removed': 'stratix:zone_file_removed',
      'zone:file_updated': 'stratix:zone_file_updated',
      'zone:member_joined': 'stratix:zone_member_joined',
      'zone:member_left': 'stratix:zone_member_left',
      'zone:deleted': 'stratix:zone_deleted',
      'zone:restored': 'stratix:zone_restored',
      'zone:task_created': 'stratix:zone_task_created',
      'zone:task_updated': 'stratix:zone_task_updated',
      'zone:task_deleted': 'stratix:zone_task_deleted',
      'zone:task_claimed': 'stratix:zone_task_claimed',
      'zone:message_added': 'stratix:zone_message_added'
    };

    // For zone:created events, notify idle agents
    if (event.type === 'zone:created') {
      this.notifyIdleAgentsZoneCreated(event);
    }

    this.broadcast({
      eventType: eventTypeMap[event.type],
      payload: {
        zoneId: event.zoneId,
        ...event.data
      },
      timestamp: Date.now(),
      requestId: `stratix-req-${Date.now()}`
    });
  }

  private sendWelcome(ws: WebSocket): void {
    const welcomeMessage: StratixStateSyncEvent = {
      eventType: 'stratix:agent_status_update',
      payload: { data: { message: 'Connected to Stratix Gateway' } },
      timestamp: Date.now(),
      requestId: `stratix-req-${Date.now()}`
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(welcomeMessage));
    }
  }

  /**
   * Notify all connected idle agents about a new zone creation
   * Agents can decide whether to join based on their capabilities
   */
  private notifyIdleAgentsZoneCreated(event: ZoneEvent): void {
    const notification: StratixStateSyncEvent = {
      eventType: 'stratix:zone_created',
      payload: {
        zoneId: event.zoneId,
        data: {
          title: event.data?.title as string || 'Untitled Zone',
          prompt: event.data?.prompt as string || '',
          creator: event.data?.creator as string || 'system',
        }
      },
      timestamp: Date.now(),
      requestId: `stratix-req-${Date.now()}`
    };

    const message = JSON.stringify(notification);

    // Send to all connected agent clients
    // The agents will decide whether to join based on their capabilities
    this.clients.forEach(client => {
      const clientType = this.clientInfo.get(client)?.type;
      if (clientType === 'agent' && client.readyState === WebSocket.OPEN) {
        client.send(message);
        console.log(`[StatusSync] Notified agent about new zone: ${event.zoneId}`);
      }
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const deadClients: WebSocket[] = [];
      this.clients.forEach((ws: WebSocket) => {
        if (!this.getAlive(ws)) {
          deadClients.push(ws);
          return;
        }
        this.setAlive(ws, false);
        try {
          ws.ping();
        } catch {
          deadClients.push(ws);
        }
      });
      for (const ws of deadClients) {
        this.clients.delete(ws);
        this.clientInfo.delete(ws);
        aliveMarkers.delete(ws);
        try {
          ws.terminate();
        } catch {
          // ignore termination errors
        }
      }
    }, 30000);
  }

  public broadcast(event: StratixStateSyncEvent): void {
    const message = JSON.stringify(event);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  private notifyAgentMention(agentId: string, event: ChannelMessageEvent): void {
    const messageStr = JSON.stringify({
      eventType: 'stratix:project_message_to_agent',
      payload: {
        channelId: event.channelId,
        subscriberIds: event.subscriberIds,
        message: event.message
      },
      timestamp: Date.now(),
      requestId: `stratix-req-${Date.now()}`
    });

    // 发送给通过 WebSocket 连接的 agent
    this.clientInfo.forEach((info, ws) => {
      if (info.type === 'agent' && info.agentId === agentId) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(messageStr);
        }
      }
    });
  }

  public notifyAgentStatus(
    agentId: string,
    status: AgentStatusInfo
  ): void {
    this.broadcast({
      eventType: 'stratix:agent_status_update',
      payload: { agentId, status },
      timestamp: Date.now(),
      requestId: `stratix-req-${Date.now()}`
    });
  }

  public notifyCommandStatus(
    commandId: string,
    agentId: string,
    status: 'pending' | 'running' | 'success' | 'failed',
    progress?: number,
    result?: unknown,
    error?: string
  ): void {
    this.broadcast({
      eventType: 'stratix:command_status_update',
      payload: {
        agentId,
        commandId,
        commandStatus: status,
        data: { progress, result, error }
      },
      timestamp: Date.now(),
      requestId: `stratix-req-${Date.now()}`
    });
  }

  // ==================== Orchestration Events ====================

  /**
   * Notify zone state change
   */
  public notifyZoneUpdate(zoneId: string, zoneData: Record<string, unknown>): void {
    this.broadcast({
      eventType: 'orchestration:zone_updated',
      payload: { zoneId, ...zoneData },
      timestamp: Date.now(),
      requestId: `orchestration-req-${Date.now()}`
    });
  }

  /**
   * Notify task assignment
   */
  public notifyTaskAssigned(taskId: string, agentId: string, zoneId: string): void {
    this.broadcast({
      eventType: 'orchestration:task_assigned',
      payload: { taskId, agentId, zoneId },
      timestamp: Date.now(),
      requestId: `orchestration-req-${Date.now()}`
    });
  }

  /**
   * Push task directly to a specific Agent via WebSocket
   * Used for real-time task delivery when task is assigned
   */
  public notifyAgentTaskAssigned(agentId: string, task: {
    taskId: string;
    zoneId: string;
    name: string;
    description?: string;
    type: string;
    priority: number;
  }): void {
    const message = JSON.stringify({
      eventType: 'agent:task_assigned',
      payload: { task },
      timestamp: Date.now(),
      requestId: `agent-task-${Date.now()}`
    });

    // Find the specific agent's WebSocket connection and send directly
    this.clientInfo.forEach((info, ws) => {
      if (info.type === 'agent' && info.agentId === agentId) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
          console.log(`[StatusSync] Sent task ${task.taskId} to agent ${agentId}`);
        }
      }
    });
  }

  /**
   * Notify task completion
   */
  public notifyTaskCompleted(taskId: string, agentId: string, result?: unknown): void {
    this.broadcast({
      eventType: 'orchestration:task_completed',
      payload: { taskId, agentId, result },
      timestamp: Date.now(),
      requestId: `orchestration-req-${Date.now()}`
    });
  }

  /**
   * Notify background agent status change
   */
  public notifyBackgroundAgentStatus(
    agentId: string,
    status: 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'error',
    zoneId?: string,
    error?: string
  ): void {
    this.broadcast({
      eventType: 'orchestration:agent_status_changed',
      payload: {
        agentId,
        data: { status, zoneId, error }
      },
      timestamp: Date.now(),
      requestId: `orchestration-req-${Date.now()}`
    });
  }

  /**
   * Notify agent-to-agent message sent
   */
  public notifyAgentMessageSent(
    messageId: string,
    conversationId: string,
    senderId: string,
    messageType: string
  ): void {
    this.broadcast({
      eventType: 'orchestration:message_sent',
      payload: { messageId, conversationId, senderId, messageType },
      timestamp: Date.now(),
      requestId: `orchestration-req-${Date.now()}`
    });
  }

  public close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.unsubscribeChannelMessage) {
      this.unsubscribeChannelMessage();
      this.unsubscribeChannelMessage = null;
    }
    if (this.unsubscribeZoneEvent) {
      this.unsubscribeZoneEvent();
      this.unsubscribeZoneEvent = null;
    }
    if (this.unsubscribeZoneCoordinatorEvent) {
      this.unsubscribeZoneCoordinatorEvent();
      this.unsubscribeZoneCoordinatorEvent = null;
    }
    // Close all client connections before closing server
    this.clients.forEach((ws) => {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    });
    this.clients.clear();
    this.clientInfo.clear();
    this.wss.close();
  }

  public getClientCount(): number {
    return this.clients.size;
  }
}

export default StatusSyncService;
