import { existsSync } from 'fs';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';

import { Session, ChatMessage } from '../types';

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private storagePath: string;
  private maxSessions: number;
  private maxMessagesPerSession: number;
  private maxTotalMessages: number;

  constructor(options: {
    storagePath?: string;
    maxSessions?: number;
    maxMessagesPerSession?: number;
    maxTotalMessages?: number;
  } = {}) {
    this.storagePath = options.storagePath || './sessions';
    this.maxSessions = options.maxSessions || 50;
    this.maxMessagesPerSession = options.maxMessagesPerSession || 100;
    this.maxTotalMessages = options.maxTotalMessages || 5000;
  }

  private generateId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  getOrCreateSession(agentId: string, sessionId?: string): Session {
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing && existing.agentId === agentId) {
        return existing;
      }
    }

    // Enforce maxSessions limit by removing oldest inactive sessions first
    if (this.sessions.size >= this.maxSessions) {
      this.evictOldestSessions(1);
    }

    const session: Session = {
      sessionId: sessionId || this.generateId(),
      agentId,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  addMessage(sessionId: string, message: ChatMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Pre-trim if already at limit to avoid temporary over-allocation
    if (session.messages.length >= this.maxMessagesPerSession) {
      const trimmedCount = session.messages.length - this.maxMessagesPerSession + 1;
      session.messages = session.messages.slice(-(this.maxMessagesPerSession - 1));
      if (trimmedCount > 0) {
        console.warn(`[SessionManager] Session ${sessionId} trimmed ${trimmedCount} messages (max: ${this.maxMessagesPerSession})`);
      }
    }

    session.messages.push(message);
    session.updatedAt = Date.now();

    // Enforce global total message limit across all sessions
    this.enforceTotalMessageLimit();
  }

  getMessages(sessionId: string, count?: number): ChatMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    if (count) {
      return session.messages.slice(-count);
    }
    return [...session.messages];
  }

  async saveSession(session: Session): Promise<void> {
    if (!existsSync(this.storagePath)) {
      await mkdir(this.storagePath, { recursive: true });
    }

    const filePath = `${this.storagePath}/${session.sessionId}.json`;
    await writeFile(filePath, JSON.stringify(session, null, 2));
  }

  async loadSessions(agentId: string): Promise<void> {
    if (!existsSync(this.storagePath)) {
      await mkdir(this.storagePath, { recursive: true });
      return;
    }

    try {
      const files = await readdir(this.storagePath);
      const sessionFiles = files.filter(f => f.endsWith('.json'));

      for (const file of sessionFiles) {
        try {
          const content = await readFile(`${this.storagePath}/${file}`, 'utf-8');
          const session: Session = JSON.parse(content);
          if (session.agentId === agentId) {
            this.sessions.set(session.sessionId, session);
          }
        } catch (e) {
          console.warn(`[SessionManager] Failed to load session file ${file}:`, e);
        }
      }
    } catch (e) {
      console.warn('[SessionManager] Failed to load sessions:', e);
    }
  }

  async saveSessions(agentId: string): Promise<void> {
    const agentSessions = Array.from(this.sessions.values()).filter(
      s => s.agentId === agentId
    );

    for (const session of agentSessions) {
      await this.saveSession(session);
    }
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'closed';
      session.updatedAt = Date.now();
    }
  }

  getActiveSessions(agentId: string): Session[] {
    return Array.from(this.sessions.values()).filter(
      s => s.agentId === agentId && s.status === 'active'
    );
  }

  /**
   * Enforce a hard global limit on total messages across all sessions.
   * When exceeded, trim oldest messages from the session with the most messages.
   */
  private enforceTotalMessageLimit(): void {
    let totalMessages = 0;
    for (const session of this.sessions.values()) {
      totalMessages += session.messages.length;
    }

    if (totalMessages <= this.maxTotalMessages) return;

    let overflow = totalMessages - this.maxTotalMessages;
    // Sort sessions by message count descending, trim from the heaviest
    const sessionsBySize = Array.from(this.sessions.values())
      .sort((a, b) => b.messages.length - a.messages.length);

    for (const session of sessionsBySize) {
      if (overflow <= 0) break;
      const trimCount = Math.min(overflow, session.messages.length);
      session.messages = session.messages.slice(trimCount);
      overflow -= trimCount;
      console.warn(`[SessionManager] Global limit enforced: trimmed ${trimCount} messages from ${session.sessionId}`);
    }
  }

  /**
   * Evict oldest sessions (preferring inactive) when session count exceeds maxSessions.
   */
  private evictOldestSessions(count: number): void {
    const sorted = Array.from(this.sessions.entries()).sort(([, a], [, b]) => {
      // Prefer evicting inactive sessions
      if (a.status !== b.status) return a.status === 'active' ? 1 : -1;
      return a.updatedAt - b.updatedAt;
    });

    for (let i = 0; i < Math.min(count, sorted.length); i++) {
      this.sessions.delete(sorted[i][0]);
      console.warn(`[SessionManager] Evicted session ${sorted[i][0]} due to maxSessions limit`);
    }
  }
}
