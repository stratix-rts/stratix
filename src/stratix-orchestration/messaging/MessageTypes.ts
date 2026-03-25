export type AgentMessageType = 'direct' | 'broadcast' | 'mention' | 'task_request' | 'context_share';

export interface AgentMessage {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  messageType: AgentMessageType;
  references: MessageReference[];
  createdAt: number;
}

export interface MessageReference {
  type: 'task' | 'file' | 'agent' | 'url';
  id: string;
  description?: string;
}

export interface Conversation {
  conversationId: string;
  type: 'dm' | 'group' | 'zone_channel';
  name?: string;
  participants: string[];
  zoneId?: string;
  projectId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SendMessageOptions {
  conversationId?: string;
  messageType: AgentMessageType;
  references?: MessageReference[];
  zoneId?: string;
}

export interface MessageEvent {
  type: 'sent' | 'delivered' | 'read';
  messageId: string;
  conversationId: string;
  recipientId?: string;
  timestamp: number;
}

export type MessageEventCallback = (event: MessageEvent) => void;
