/**
 * Stratix Gateway - 状态同步服务
 * 
 * 通过 WebSocket 实时推送 Agent 和指令状态到前端
 * 监听 GatewayEventBus 将内部事件转发到 WebSocket
 */

import { WebSocketServer, WebSocket } from 'ws';
import { StratixStateSyncEvent, AgentStatusInfo } from '../../../stratix-core/stratix-protocol';
import { ProjectChannelMessage } from '../../../stratix-project/types';
import { gatewayEventBus, ChannelMessageEvent } from '../../GatewayEventBus';

interface ClientInfo {
  ws: WebSocket;
  type: 'frontend' | 'agent';
  agentId?: string;
}

export class StatusSyncService {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private clientInfo: Map<WebSocket, ClientInfo> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private unsubscribeChannelMessage: (() => void) | null = null;

  constructor(port: number = 3001) {
    this.wss = new WebSocketServer({ port });
    this.setupServer();
    this.startHeartbeat();
    this.setupEventBusListeners();
  }

  private setupServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);
      console.log(`[StatusSync] Client connected. Total clients: ${this.clients.size}`);

      (ws as any).isAlive = true;

      ws.on('pong', () => {
        (ws as any).isAlive = true;
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
        console.log(`[StatusSync] Client disconnected. Total clients: ${this.clients.size}`);
      });

      ws.on('error', (error) => {
        console.error('[StatusSync] WebSocket error:', error);
        this.clients.delete(ws);
        this.clientInfo.delete(ws);
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
          projectId: event.projectId,
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

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((ws: WebSocket) => {
        if (!(ws as any).isAlive) {
          this.clients.delete(ws);
          return ws.terminate();
        }

        (ws as any).isAlive = false;
        ws.ping();
      });
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
    result?: any,
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

  public close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.unsubscribeChannelMessage) {
      this.unsubscribeChannelMessage();
    }
    this.wss.close();
  }

  public getClientCount(): number {
    return this.clients.size;
  }
}

export default StatusSyncService;
