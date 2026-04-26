import { existsSync } from 'fs';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';

import { Session, ChatMessage } from '../types';

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private storagePath: string;
  private maxSessions: number;
  private maxMessagesPerSession: number;

  constructor(options: {
    storagePath?: string;
    maxSessions?: number;
    maxMessagesPerSession?: number;
  } = {}) {
    this.storagePath = options.storagePath || './sessions';
    this.maxSessions = options.maxSessions || 50;
    this.maxMessagesPerSession = options.maxMessagesPerSession || 100;
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

    session.messages.push(message);
    session.updatedAt = Date.now();

    if (session.messages.length > this.maxMessagesPerSession) {
      const trimmedCount = session.messages.length - this.maxMessagesPerSession;
      session.messages = session.messages.slice(-this.maxMessagesPerSession);
      console.warn(`[SessionManager] Session ${sessionId} trimmed ${trimmedCount} messages (max: ${this.maxMessagesPerSession})`);
    }
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
}
