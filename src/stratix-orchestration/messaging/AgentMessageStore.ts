import { getDatabase } from '../../stratix-database/StratixDatabase';

import { AgentMessage, Conversation, SendMessageOptions, MessageReference } from './MessageTypes';

// Database row interfaces
interface ConversationRow {
  conversation_id: string;
  type: 'dm' | 'group' | 'zone_channel';
  name: string | null;
  zone_id: string | null;
  project_id: string | null;
  created_at: number;
  updated_at: number;
}

interface ParticipantRow {
  participant_id: string;
}

interface MessageRow {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  references: string;
  created_at: number;
}

export class AgentMessageStore {
  private static instance: AgentMessageStore;

  private constructor() {}

  static getInstance(): AgentMessageStore {
    if (!AgentMessageStore.instance) {
      AgentMessageStore.instance = new AgentMessageStore();
    }
    return AgentMessageStore.instance;
  }

  // ==================== Conversations ====================

  async createConversation(
    conversationId: string,
    type: 'dm' | 'group' | 'zone_channel',
    participants: string[],
    options: { name?: string; zoneId?: string; projectId?: string } = {}
  ): Promise<Conversation> {
    const db = getDatabase().getDatabase();
    const now = Date.now();

    db.prepare(`
      INSERT INTO conversations (conversation_id, type, name, zone_id, project_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      conversationId,
      type,
      options.name || null,
      options.zoneId || null,
      options.projectId || null,
      now,
      now
    );

    // Add participants
    for (const participantId of participants) {
      db.prepare(`
        INSERT INTO conversation_participants (conversation_id, participant_id, joined_at)
        VALUES (?, ?, ?)
      `).run(conversationId, participantId, now);
    }

    return {
      conversationId,
      type,
      name: options.name,
      participants,
      zoneId: options.zoneId,
      projectId: options.projectId,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    const db = getDatabase().getDatabase();

    const row = db.prepare('SELECT * FROM conversations WHERE conversation_id = ?').get(conversationId) as ConversationRow | undefined;
    if (!row) return null;

    const participants = this.getConversationParticipants(conversationId);

    return {
      conversationId: row.conversation_id,
      type: row.type,
      name: row.name ?? undefined,
      participants,
      zoneId: row.zone_id ?? undefined,
      projectId: row.project_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getOrCreateDMConversation(agent1: string, agent2: string): Promise<Conversation> {
    const db = getDatabase().getDatabase();

    // Check if DM already exists (order-independent lookup)
    // Find conversations where both agents are participants
    const existing = db.prepare(`
      SELECT c.conversation_id FROM conversations c
      WHERE c.type = 'dm'
        AND (
          SELECT COUNT(*) FROM conversation_participants
          WHERE conversation_id = c.conversation_id
            AND participant_id IN (?, ?)
        ) = 2
    `).get(agent1, agent2) as { conversation_id: string } | undefined;

    if (existing) {
      const conv = await this.getConversation(existing.conversation_id);
      if (conv) return conv;
    }

    // Create new DM - sort agents for consistent ID
    const sortedAgents = [agent1, agent2].sort();
    const conversationId = `dm_${sortedAgents[0]}_${sortedAgents[1]}_${Date.now()}`;
    return this.createConversation(conversationId, 'dm', [agent1, agent2]);
  }

  async getAgentConversations(agentId: string): Promise<Conversation[]> {
    const db = getDatabase().getDatabase();

    const rows = db.prepare(`
      SELECT DISTINCT c.* FROM conversations c
      JOIN conversation_participants p ON c.conversation_id = p.conversation_id
      WHERE p.participant_id = ?
      ORDER BY c.updated_at DESC
    `).all(agentId) as ConversationRow[];

    const conversations: Conversation[] = [];
    for (const row of rows) {
      const participants = this.getConversationParticipants(row.conversation_id);
      conversations.push({
        conversationId: row.conversation_id,
        type: row.type,
        name: row.name ?? undefined,
        participants,
        zoneId: row.zone_id ?? undefined,
        projectId: row.project_id ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }

    return conversations;
  }

  private getConversationParticipants(conversationId: string): string[] {
    const db = getDatabase().getDatabase();
    const rows = db.prepare(
      'SELECT participant_id FROM conversation_participants WHERE conversation_id = ?'
    ).all(conversationId) as ParticipantRow[];
    return rows.map(r => r.participant_id);
  }

  // ==================== Messages ====================

  async sendMessage(
    senderId: string,
    content: string,
    options: SendMessageOptions
  ): Promise<AgentMessage> {
    const db = getDatabase().getDatabase();
    const now = Date.now();

    let conversationId = options.conversationId;

    // For direct messages, get or create DM conversation
    if (options.messageType === 'direct' && !conversationId) {
      // Need recipientId in references or find it
      const recipientRef = options.references?.find(r => r.type === 'agent');
      if (recipientRef) {
        const conv = await this.getOrCreateDMConversation(senderId, recipientRef.id);
        conversationId = conv.conversationId;
      }
    }

    if (!conversationId) {
      throw new Error('Conversation ID required for non-direct messages');
    }

    const messageId = `msg_${now}_${Math.random().toString(36).slice(2, 8)}`;

    db.prepare(`
      INSERT INTO agent_messages (message_id, conversation_id, sender_id, content, message_type, references, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId,
      conversationId,
      senderId,
      content,
      options.messageType,
      JSON.stringify(options.references || []),
      now
    );

    // Update conversation updated_at
    db.prepare('UPDATE conversations SET updated_at = ? WHERE conversation_id = ?').run(now, conversationId);

    return {
      messageId,
      conversationId,
      senderId,
      content,
      messageType: options.messageType,
      references: options.references || [],
      createdAt: now,
    };
  }

  async getMessages(
    conversationId: string,
    options: { limit?: number; before?: number } = {}
  ): Promise<AgentMessage[]> {
    const db = getDatabase().getDatabase();
    const limit = options.limit || 50;

    let query = 'SELECT * FROM agent_messages WHERE conversation_id = ?';
    const params: any[] = [conversationId];

    if (options.before) {
      query += ' AND created_at < ?';
      params.push(options.before);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(query).all(...params) as MessageRow[];

    return rows.map(row => this.rowToMessage(row)).reverse();
  }

  async searchMessages(
    agentId: string,
    query: string,
    options: { limit?: number } = {}
  ): Promise<AgentMessage[]> {
    const db = getDatabase().getDatabase();
    const limit = options.limit || 20;

    // Sanitize query to prevent SQL injection in LIKE patterns
    const sanitizedQuery = this.sanitizeLikePattern(query);

    // Simple LIKE search - in production would use full-text search
    const rows = db.prepare(`
      SELECT m.* FROM agent_messages m
      JOIN conversation_participants p ON m.conversation_id = p.conversation_id
      WHERE p.participant_id = ?
        AND m.content LIKE ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(agentId, `%${sanitizedQuery}%`, limit) as MessageRow[];

    return rows.map(row => this.rowToMessage(row));
  }

  // ==================== Helpers ====================

  private rowToMessage(row: MessageRow): AgentMessage {
    let references: MessageReference[] = [];
    try {
      references = JSON.parse(row.references || '[]');
    } catch { /* ignore */ }

    return {
      messageId: row.message_id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      content: row.content,
      messageType: row.message_type as AgentMessage['messageType'],
      references,
      createdAt: row.created_at,
    };
  }

  /**
   * Sanitize a string for use in LIKE pattern to prevent SQL injection
   */
  private sanitizeLikePattern(input: string): string {
    // Escape SQL LIKE wildcards
    return input.replace(/[%_]/g, '\\$&');
  }
}

export default AgentMessageStore;
