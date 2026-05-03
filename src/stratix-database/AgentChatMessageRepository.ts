import { getDatabase } from './StratixDatabase';

/** Default limit for message queries */
const DEFAULT_MESSAGE_LIMIT = 20;
/** Default limit for search queries */
const DEFAULT_SEARCH_LIMIT = 10;
/** Default offset for paginated queries */
const DEFAULT_OFFSET = 0;

export interface ChatMessage {
  messageId: string;
  agentId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  createdAt: number;
}

export class AgentChatMessageRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  saveMessage(msg: Omit<ChatMessage, 'createdAt'>): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO agent_chat_messages
      (message_id, agent_id, role, content, timestamp, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(msg.messageId, msg.agentId, msg.role, msg.content, msg.timestamp, Date.now());
  }

  getMessagesByAgentId(agentId: string, limit = DEFAULT_MESSAGE_LIMIT, offset = DEFAULT_OFFSET): ChatMessage[] {
    const stmt = this.db.prepare(`
      SELECT message_id as messageId, agent_id as agentId, role, content, timestamp, created_at as createdAt
      FROM agent_chat_messages
      WHERE agent_id = ?
      ORDER BY timestamp ASC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(agentId, limit, offset) as ChatMessage[];
  }

  searchMessages(agentId: string, keywords: string[], limit = DEFAULT_SEARCH_LIMIT): ChatMessage[] {
    if (keywords.length === 0) {
      return [];
    }

    const conditions = keywords.map(() => `content LIKE ?`).join(' AND ');
    const params = keywords.map(kw => `%${kw}%`);

    const stmt = this.db.prepare(`
      SELECT message_id as messageId, agent_id as agentId, role, content, timestamp, created_at as createdAt
      FROM agent_chat_messages
      WHERE agent_id = ? AND ${conditions}
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    return stmt.all(agentId, ...params, limit) as ChatMessage[];
  }

  deleteMessagesByAgentId(agentId: string): void {
    const stmt = this.db.prepare('DELETE FROM agent_chat_messages WHERE agent_id = ?');
    stmt.run(agentId);
  }
}

export const agentChatMessageRepository = new AgentChatMessageRepository();
