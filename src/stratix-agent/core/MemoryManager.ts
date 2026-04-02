import { existsSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';

import { ChatMessage, MemoryEntry, MemoryLayers, SkillLearningRecord } from '../types';

export class MemoryManager {
  private maxShortTerm: number;
  private maxMidTerm: number;
  private maxLongTerm: number;
  private storagePath: string;

  private shortTerm: ChatMessage[] = [];
  private midTerm: MemoryEntry[] = [];
  private longTerm: MemoryEntry[] = [];

  constructor(options: {
    maxShortTerm?: number;
    maxMidTerm?: number;
    maxLongTerm?: number;
    storagePath?: string;
  } = {}) {
    this.maxShortTerm = options.maxShortTerm ?? 20;
    this.maxMidTerm = options.maxMidTerm ?? 50;
    this.maxLongTerm = options.maxLongTerm ?? 100;
    this.storagePath = options.storagePath || './memory';
  }

  addMessage(role: 'user' | 'assistant', content: string): void {
    const message: ChatMessage = {
      role,
      content,
      timestamp: new Date().toISOString(),
    };

    this.shortTerm.push(message);

    if (this.shortTerm.length > this.maxShortTerm) {
      const removed = this.shortTerm.shift();
      if (removed) {
        this.promoteToMidTerm(removed);
      }
    }
  }

  getRecentMessages(count?: number): ChatMessage[] {
    if (count) {
      return this.shortTerm.slice(-count);
    }
    return [...this.shortTerm];
  }

  clearShortTerm(): void {
    this.shortTerm = [];
  }

  private promoteToMidTerm(message: ChatMessage): void {
    const entry: MemoryEntry = {
      id: this.generateId(),
      title: this.extractTitle(message.content),
      content: message.content,
      importance: 2,
      createdAt: message.timestamp || new Date().toISOString(),
    };

    this.midTerm.push(entry);

    if (this.midTerm.length > this.maxMidTerm) {
      this.midTerm.shift();
    }
  }

  addLongTermMemory(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): void {
    const newEntry: MemoryEntry = {
      ...entry,
      id: this.generateId(),
      createdAt: new Date().toISOString(),
    };

    this.longTerm.push(newEntry);

    if (this.longTerm.length > this.maxLongTerm) {
      this.longTerm.sort((a, b) => b.importance - a.importance);
      this.longTerm.pop();
    }
  }

  searchLongTerm(query: string, type?: MemoryEntry['type']): MemoryEntry[] {
    const keywords = query.toLowerCase().split(/\s+/);
    return this.longTerm.filter(entry => {
      if (type && entry.type !== type) return false;
      const text = `${entry.title} ${entry.content} ${(entry.tags || []).join(' ')}`.toLowerCase();
      return keywords.some(kw => text.includes(kw));
    });
  }

  getUserProfile(): MemoryEntry[] {
    return this.longTerm
      .filter(e => e.importance >= 2)
      .sort((a, b) => b.importance - a.importance);
  }

  private async ensureStoragePath(): Promise<void> {
    if (!existsSync(this.storagePath)) {
      await mkdir(this.storagePath, { recursive: true });
    }
  }

  async save(): Promise<void> {
    await this.ensureStoragePath();
    const data: MemoryLayers = {
      shortTerm: this.shortTerm,
      midTerm: this.midTerm,
      longTerm: this.longTerm,
    };
    await writeFile(
      `${this.storagePath}/memory.json`,
      JSON.stringify(data, null, 2)
    );
  }

  async load(): Promise<void> {
    try {
      await this.ensureStoragePath();
      const content = await readFile(`${this.storagePath}/memory.json`, 'utf-8');
      const data: MemoryLayers = JSON.parse(content);
      this.shortTerm = data.shortTerm || [];
      this.midTerm = data.midTerm || [];
      this.longTerm = data.longTerm || [];
    } catch {
      // 文件不存在，使用空内存
    }
  }

  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private extractTitle(content: string): string {
    return content.slice(0, 30) + (content.length > 30 ? '...' : '');
  }

  buildContext(): string {
    const parts: string[] = [];

    const profile = this.getUserProfile();
    if (profile.length > 0) {
      parts.push('## User Profile\n' + profile.map(p => `- ${p.title}: ${p.content}`).join('\n'));
    }

    const knowledge = this.longTerm.filter(e => e.importance >= 2);
    if (knowledge.length > 0) {
      parts.push('## Knowledge\n' + knowledge.map(k => `- ${k.title}: ${k.content}`).join('\n'));
    }

    if (this.midTerm.length > 0) {
      parts.push('## Recent Context\n' + this.midTerm.slice(-5).map(m => m.content).join('\n'));
    }

    return parts.join('\n\n');
  }

  /**
   * 构建技能上下文
   * 用于 Agent 知道自己已学会哪些技能
   */
  buildSkillContext(): string {
    const skillRecords = this.longTerm.filter(e => e.type === 'skill');
    if (skillRecords.length === 0) return '';

    const skills = skillRecords.map(s => {
      const record = s as SkillLearningRecord;
      return `- **${record.skillName}** (Lv.${record.level}): ${record.content.slice(0, 100)}`;
    });

    return `## Learned Skills\n${skills.join('\n')}`;
  }

  /**
   * 获取技能学习记录
   */
  getSkillRecords(): SkillLearningRecord[] {
    return this.longTerm
      .filter(e => e.type === 'skill')
      .map(e => e as SkillLearningRecord);
  }
}
