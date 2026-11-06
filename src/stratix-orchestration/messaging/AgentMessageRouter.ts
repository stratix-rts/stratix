
import { AgentMessageStore } from './AgentMessageStore';
import { ConversationConstraints } from './ConversationConstraints';
import { MessageReference, MessageEventCallback } from './MessageTypes';

export interface RouteResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface RouteOptions {
  recipientId?: string;
  zoneId?: string;
  references?: MessageReference[];
  conversationId?: string;
}

interface MessageRouterEvent {
  type: 'sent';
  messageId: string;
  conversationId: string;
  recipientId?: string;
  timestamp: number;
}

export class AgentMessageRouter {
  private static instance: AgentMessageRouter;

  private messageStore: AgentMessageStore;
  private constraints: ConversationConstraints;
  private eventListeners: Map<string, MessageEventCallback[]> = new Map();

  private constructor() {
    this.messageStore = AgentMessageStore.getInstance();
    this.constraints = ConversationConstraints.getInstance();
  }

  static getInstance(): AgentMessageRouter {
    if (!AgentMessageRouter.instance) {
      AgentMessageRouter.instance = new AgentMessageRouter();
    }
    return AgentMessageRouter.instance;
  }

  /**
   * Route and send a message
   */
  async routeMessage(
    senderId: string,
    content: string,
    messageType: 'direct' | 'broadcast' | 'mention' | 'task_request' | 'context_share',
    options: RouteOptions = {}
  ): Promise<RouteResult> {
    try {
      // Validate based on message type
      switch (messageType) {
        case 'direct':
          if (!options.recipientId) {
            return { success: false, error: 'Recipient ID required for direct messages' };
          }
          return this.handleDirectMessage(senderId, options.recipientId, content, options);

        case 'broadcast':
          // D5：Zone 整体砍掉后没有广播范围（无 zone 成员表），广播路径下线
          return { success: false, error: 'Broadcast is no longer supported: zones were removed in v3' };

        case 'mention':
          if (!options.recipientId) {
            return { success: false, error: 'Recipient ID required for mentions' };
          }
          return this.handleMention(senderId, options.recipientId, content, options);

        case 'task_request':
          if (!options.recipientId) {
            return { success: false, error: 'Recipient ID required for task requests' };
          }
          return this.handleTaskRequest(senderId, options.recipientId, content, options);

        case 'context_share':
          if (!options.recipientId) {
            // D5：Zone 砍掉后没有"分享给整区"的分支，只能定向分享
            return { success: false, error: 'Recipient ID required for context sharing (zone-wide sharing removed in v3)' };
          }
          return this.handleContextShare(senderId, content, options);

        default:
          return { success: false, error: `Unknown message type: ${messageType}` };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ==================== Message Handlers ====================

  private async handleDirectMessage(
    senderId: string,
    recipientId: string,
    content: string,
    options: RouteOptions
  ): Promise<RouteResult> {
    // Check policy
    const check = await this.constraints.canSend(senderId, recipientId, 'direct', { zoneId: options.zoneId });
    if (!check.allowed) {
      return { success: false, error: check.reason };
    }

    // Create DM conversation if needed
    const conversation = await this.messageStore.getOrCreateDMConversation(senderId, recipientId);

    // Send message
    const message = await this.messageStore.sendMessage(senderId, content, {
      conversationId: conversation.conversationId,
      messageType: 'direct',
      references: options.references,
    });

    // Emit event
    this.emitEvent({
      type: 'sent',
      messageId: message.messageId,
      conversationId: message.conversationId,
      recipientId,
      timestamp: message.createdAt,
    });

    return { success: true, messageId: message.messageId };
  }

  private async handleMention(
    senderId: string,
    recipientId: string,
    content: string,
    options: RouteOptions
  ): Promise<RouteResult> {
    // Mentions are like DMs but with @mention reference
    const references: MessageReference[] = [
      ...(options.references || []),
      { type: 'agent', id: recipientId, description: 'mentioned' },
    ];

    const conversation = await this.messageStore.getOrCreateDMConversation(senderId, recipientId);

    const message = await this.messageStore.sendMessage(senderId, content, {
      conversationId: conversation.conversationId,
      messageType: 'mention',
      references,
    });

    this.emitEvent({
      type: 'sent',
      messageId: message.messageId,
      conversationId: message.conversationId,
      recipientId,
      timestamp: message.createdAt,
    });

    return { success: true, messageId: message.messageId };
  }

  private async handleTaskRequest(
    senderId: string,
    recipientId: string,
    content: string,
    options: RouteOptions
  ): Promise<RouteResult> {
    // Check policy
    const check = await this.constraints.canSend(senderId, recipientId, 'direct', { zoneId: options.zoneId });
    if (!check.allowed) {
      return { success: false, error: check.reason };
    }

    const taskRef = options.references?.find((r: MessageReference) => r.type === 'task');
    if (!taskRef) {
      return { success: false, error: 'Task reference required for task requests' };
    }

    const conversation = await this.messageStore.getOrCreateDMConversation(senderId, recipientId);

    const message = await this.messageStore.sendMessage(senderId, content, {
      conversationId: conversation.conversationId,
      messageType: 'task_request',
      references: options.references,
    });

    this.emitEvent({
      type: 'sent',
      messageId: message.messageId,
      conversationId: message.conversationId,
      recipientId,
      timestamp: message.createdAt,
    });

    return { success: true, messageId: message.messageId };
  }

  private async handleContextShare(
    senderId: string,
    content: string,
    options: RouteOptions
  ): Promise<RouteResult> {
    // For context share, we need to check share policy
    const recipientId = options.recipientId;

    if (recipientId) {
      const check = await this.constraints.canShare(senderId, recipientId, 'context', { zoneId: options.zoneId });
      if (!check.allowed) {
        return { success: false, error: check.reason };
      }
    }

    const references: MessageReference[] = [
      ...(options.references || []),
      { type: 'agent', id: senderId, description: 'context_sharer' },
    ];

    if (recipientId) {
      const conversation = await this.messageStore.getOrCreateDMConversation(senderId, recipientId);

      const message = await this.messageStore.sendMessage(senderId, content, {
        conversationId: conversation.conversationId,
        messageType: 'context_share',
        references,
      });

      return { success: true, messageId: message.messageId };
    }
    // D5 补记：调用方在 route() 入口已强制 recipientId，这里不可达；保留断言防止后续重构绕过校验
    return { success: false, error: 'Recipient ID required for context sharing' };
  }

  // ==================== Event System ====================

  on(event: string, callback: MessageEventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  off(event: string, callback: MessageEventCallback): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      this.eventListeners.set(event, listeners.filter(cb => cb !== callback));
    }
  }

  clearAllListeners(): void {
    this.eventListeners.clear();
  }

  destroy(): void {
    this.clearAllListeners();
  }

  /**
   * Health check for the message router
   */
  isHealthy(): boolean {
    return this.eventListeners.size < 1000;
  }

  private emitEvent(event: MessageRouterEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach(cb => cb(event));
    }

    // Also emit to '*' listeners
    const globalListeners = this.eventListeners.get('*');
    if (globalListeners) {
      globalListeners.forEach(cb => cb(event));
    }
  }
}

export default AgentMessageRouter;
