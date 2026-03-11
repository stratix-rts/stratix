/**
 * Stratix Gateway - 状态同步服务
 * 
 * 通过 WebSocket 实时推送 Agent 和指令状态到前端
 */

import { WebSocketServer, WebSocket } from 'ws';
import { StratixStateSyncEvent, AgentStatusInfo } from '../../../stratix-core/stratix-protocol';
import { ProjectChannelMessage } from '../../../stratix-project/types';

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

  constructor(port: number = 3001) {
    this.wss = new WebSocketServer({ port });
    this.setupServer();
    this.startHeartbeat();
  }

  private setupServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);
      console.log(`Client connected. Total clients: ${this.clients.size}`);

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
        console.log(`Client disconnected. Total clients: ${this.clients.size}`);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
        this.clientInfo.delete(ws);
      });

      this.sendWelcome(ws);
    });
  }

  private sendWelcome(ws: WebSocket): void {
    const welcomeMessage: StratixStateSyncEvent = {
      eventType: 'stratix:agent_status_update',
      payload: { data: { message: 'Connected to Stratix Gateway' } },
      timestamp: Date.now(),
      requestId: `stratix-req-${Date.now()}`
    };
    ws.send(JSON.stringify(welcomeMessage));
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

  public notifyNewMessage(message: ProjectChannelMessage): void {
    console.log('[StatusSync] Broadcasting new message:', {
      id: message.id,
      projectId: message.projectId,
      channelId: message.channelId,
      sender: message.sender.name,
      content: message.content.slice(0, 50),
      mentions: message.mentions
    });

    this.broadcast({
      eventType: 'stratix:project_message_new',
      payload: {
        projectId: message.projectId,
        channelId: message.channelId,
        message
      },
      timestamp: Date.now(),
      requestId: `stratix-req-${Date.now()}`
    });
  }

  public notifyMessageSync(projectId: string, channelId: string, messages: ProjectChannelMessage[]): void {
    console.log('[StatusSync] Broadcasting message sync:', {
      projectId,
      channelId,
      count: messages.length
    });

    this.broadcast({
      eventType: 'stratix:project_message_sync',
      payload: {
        projectId,
        channelId,
        messages
      },
      timestamp: Date.now(),
      requestId: `stratix-req-${Date.now()}`
    });
  }

  public notifyAgentsInChannel(channelId: string, subscriberIds: string[], message: ProjectChannelMessage): void {
    console.log('[StatusSync] Notifying agents in channel:', {
      channelId,
      subscriberIds,
      messageId: message.id,
      sender: message.sender.name
    });

    const event: StratixStateSyncEvent = {
      eventType: 'stratix:project_message_to_agent',
      payload: {
        channelId,
        subscriberIds,
        message
      },
      timestamp: Date.now(),
      requestId: `stratix-req-${Date.now()}`
    };

    const messageStr = JSON.stringify(event);
    
    this.clientInfo.forEach((info, ws) => {
      if (info.type === 'agent' && info.agentId && subscriberIds.includes(info.agentId)) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(messageStr);
        }
      }
    });
  }

  public close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.wss.close();
  }

  public getClientCount(): number {
    return this.clients.size;
  }
}

export default StatusSyncService;
