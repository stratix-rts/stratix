/**
 * Gateway 内部事件总线
 * 
 * 用于 gateway 内部组件间的消息传递，特别是：
 * - Channel 消息分发
 * - Agent 状态变更通知
 * - 项目事件广播
 */

import { EventEmitter } from 'events';

import { ProjectChannelMessage } from '../stratix-project/types';

export interface ChannelMessageEvent {
  type: 'channel_message';
  projectId: string;
  channelId: string;
  message: ProjectChannelMessage;
  subscriberIds: string[];
}

export interface AgentMentionEvent {
  type: 'agent_mention';
  projectId: string;
  channelId: string;
  message: ProjectChannelMessage;
  agentId: string;
}

// Zone Events
export interface ZoneEvent {
  type: 'zone:updated' | 'zone:file_added' | 'zone:file_removed' | 'zone:file_updated' | 'zone:member_joined' | 'zone:member_left' | 'zone:deleted' | 'zone:restored' | 'zone:task_created' | 'zone:task_updated' | 'zone:task_deleted' | 'zone:task_claimed' | 'zone:message_added';
  zoneId: string;
  projectId: string;
  data?: any;
}

export type GatewayEvent = ChannelMessageEvent | AgentMentionEvent | ZoneEvent;

class GatewayEventBus extends EventEmitter {
  private static instance: GatewayEventBus;

  static getInstance(): GatewayEventBus {
    if (!GatewayEventBus.instance) {
      GatewayEventBus.instance = new GatewayEventBus();
    }
    return GatewayEventBus.instance;
  }

  /**
   * 发布 channel 消息
   * 所有订阅者（包括 WebSocket 和内部 Agent）都会收到
   */
  publishChannelMessage(
    projectId: string,
    channelId: string,
    message: ProjectChannelMessage,
    subscriberIds: string[]
  ): void {
    console.log(`[GatewayEventBus] Publishing message to channel ${channelId}:`, {
      messageId: message.id,
      mentions: message.mentions,
      subscriberIds: subscriberIds
    });

    const event: ChannelMessageEvent = {
      type: 'channel_message',
      projectId,
      channelId,
      message,
      subscriberIds
    };

    // 广播给所有监听器
    this.emit('channel_message', event);
    console.log(`[GatewayEventBus] Emitted channel_message event`);

    // 单独通知被提及的 agent
    if (message.mentions && message.mentions.length > 0) {
      for (const agentId of message.mentions) {
        const eventName = `agent_mention:${agentId}`;
        const listenerCount = this.listenerCount(eventName);
        console.log(`[GatewayEventBus] Checking agent ${agentId}: in subscribers=${subscriberIds.includes(agentId)}, listeners=${listenerCount}`);
        
        if (subscriberIds.includes(agentId)) {
          const mentionEvent: AgentMentionEvent = {
            type: 'agent_mention',
            projectId,
            channelId,
            message,
            agentId
          };
          try {
            this.emit(eventName, mentionEvent);
            console.log(`[GatewayEventBus] Emitted ${eventName} event`);
          } catch (error) {
            console.error(`[GatewayEventBus] Error emitting ${eventName}:`, error);
          }
        }
      }
    }
  }

  /**
   * 订阅 channel 消息
   */
  onChannelMessage(handler: (event: ChannelMessageEvent) => void): () => void {
    this.on('channel_message', handler);
    return () => this.off('channel_message', handler);
  }

  /**
   * 订阅特定 agent 的提及消息
   */
  onAgentMention(agentId: string, handler: (event: AgentMentionEvent) => void): () => void {
    const eventName = `agent_mention:${agentId}`;
    this.on(eventName, handler);
    return () => this.off(eventName, handler);
  }

  // ==================== Zone Events ====================

  /**
   * 发布 Zone 事件
   */
  publishZoneEvent(
    type: ZoneEvent['type'],
    zoneId: string,
    projectId: string,
    data?: any
  ): void {
    console.log(`[GatewayEventBus] Publishing zone event ${type} for zone ${zoneId}:`, data);

    const event: ZoneEvent = {
      type,
      zoneId,
      projectId,
      data
    };

    try {
      this.emit('zone_event', event);
      console.log(`[GatewayEventBus] Emitted zone_event:${type}`);
    } catch (error) {
      console.error(`[GatewayEventBus] Error emitting zone_event:${type}:`, error);
    }
  }

  /**
   * 订阅 Zone 事件
   */
  onZoneEvent(handler: (event: ZoneEvent) => void): () => void {
    this.on('zone_event', handler);
    return () => this.off('zone_event', handler);
  }
}

export const gatewayEventBus = GatewayEventBus.getInstance();
export default gatewayEventBus;
