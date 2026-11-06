import { getDatabase } from './StratixDatabase';
import type { Statement } from './sqlite-adapter';


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

  private statements = new Map<string, Statement>();

  private stmt(sql: string): Statement {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  /**
   * 清理 prepared statement 缓存
   */
  shutdown(): void {
    this.statements.clear();
  }

  /**
   * 检查数据库连接是否健康
   */
  isHealthy(): boolean {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  saveMessage(msg: Omit<ChatMessage, 'createdAt'>): void {
    this.stmt(`
      INSERT OR REPLACE INTO agent_chat_messages
      (message_id, agent_id, role, content, timestamp, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(msg.messageId, msg.agentId, msg.role, msg.content, msg.timestamp, Date.now());
  }

  getMessagesByAgentId(agentId: string, limit = DEFAULT_MESSAGE_LIMIT, offset = DEFAULT_OFFSET): ChatMessage[] {
    return this.stmt(`
      SELECT message_id as messageId, agent_id as agentId, role, content, timestamp, created_at as createdAt
      FROM agent_chat_messages
      WHERE agent_id = ?
      ORDER BY timestamp ASC
      LIMIT ? OFFSET ?
    `).all(agentId, limit, offset) as ChatMessage[];
  }

  /**
   * 获取某个 Agent 的消息总数（用于分页）
   */
  getMessageCountByAgentId(agentId: string): number {
    const row = this.stmt(`
      SELECT COUNT(*) as count FROM agent_chat_messages WHERE agent_id = ?
    `).get(agentId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  searchMessages(agentId: string, keywords: string[], limit = DEFAULT_SEARCH_LIMIT): ChatMessage[] {
    if (keywords.length === 0) {
      return [];
    }

    const conditions = keywords.map(() => `content LIKE ?`).join(' AND ');
    const params = keywords.map(kw => `%${kw}%`);

    return this.stmt(`
      SELECT message_id as messageId, agent_id as agentId, role, content, timestamp, created_at as createdAt
      FROM agent_chat_messages
      WHERE agent_id = ? AND ${conditions}
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(agentId, ...params, limit) as ChatMessage[];
  }

  deleteMessagesByAgentId(agentId: string): void {
    this.stmt('DELETE FROM agent_chat_messages WHERE agent_id = ?').run(agentId);
  }
}

export const agentChatMessageRepository = new AgentChatMessageRepository();
