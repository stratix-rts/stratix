/**
 * TranscriptStore - File-based transcript persistence
 * Append-only JSONL storage for session transcripts
 */

import { existsSync, mkdirSync } from 'fs';
import { appendFile, readFile, writeFile, readdir, stat } from 'fs/promises';
import { join } from 'path';

import type { TranscriptEntry, TranscriptQuery } from './types.js';

export class TranscriptStore {
  private baseDir: string;

  constructor(baseDir: string = '.transcripts') {
    this.baseDir = baseDir;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getFilePath(sessionId: string): string {
    return join(this.baseDir, `${sessionId}.jsonl`);
  }

  /**
   * Append a single entry to the transcript (append-only)
   */
  async append(entry: TranscriptEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    await appendFile(this.getFilePath(entry.sessionId), line, 'utf-8');
  }

  /**
   * Append multiple entries in a batch
   */
  async appendBatch(entries: TranscriptEntry[]): Promise<void> {
    const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await appendFile(this.getFilePath(entries[0].sessionId), lines, 'utf-8');
  }

  /**
   * Query transcript entries by session and/or time range
   */
  async query(query: TranscriptQuery): Promise<TranscriptEntry[]> {
    const { sessionId, startTime, endTime, limit = 1000 } = query;
    const results: TranscriptEntry[] = [];

    if (sessionId) {
      const filePath = this.getFilePath(sessionId);
      if (existsSync(filePath)) {
        const entries = await this.readFileEntries(filePath);
        const filtered = this.filterEntries(entries, startTime, endTime, limit);
        return filtered;
      }
      return [];
    }

    // Query across all session files
    const files = await readdir(this.baseDir);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = join(this.baseDir, file);
      const entries = await this.readFileEntries(filePath);
      const filtered = this.filterEntries(entries, startTime, endTime, limit);
      results.push(...filtered);
      if (results.length >= limit) break;
    }

    // Sort by timestamp
    results.sort((a, b) => a.timestamp - b.timestamp);
    return results.slice(0, limit);
  }

  /**
   * Get all entries for a specific session
   */
  async getBySession(sessionId: string): Promise<TranscriptEntry[]> {
    const filePath = this.getFilePath(sessionId);
    if (!existsSync(filePath)) {
      return [];
    }
    return this.readFileEntries(filePath);
  }

  /**
   * Get entries for a session within a time range
   */
  async getByTimeRange(
    sessionId: string,
    startTime: number,
    endTime: number
  ): Promise<TranscriptEntry[]> {
    const entries = await this.getBySession(sessionId);
    return entries.filter((e) => e.timestamp >= startTime && e.timestamp <= endTime);
  }

  private filterEntries(
    entries: TranscriptEntry[],
    startTime?: number,
    endTime?: number,
    limit?: number
  ): TranscriptEntry[] {
    let filtered = entries;

    if (startTime !== undefined) {
      filtered = filtered.filter((e) => e.timestamp >= startTime);
    }
    if (endTime !== undefined) {
      filtered = filtered.filter((e) => e.timestamp <= endTime);
    }

    filtered.sort((a, b) => a.timestamp - b.timestamp);

    if (limit !== undefined) {
      filtered = filtered.slice(0, limit);
    }

    return filtered;
  }

  private async readFileEntries(filePath: string): Promise<TranscriptEntry[]> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim() !== '');
      return lines.map((line) => JSON.parse(line) as TranscriptEntry);
    } catch (e) {
      console.warn(`[TranscriptStore] Failed to read entries from ${filePath}:`, e);
      return [];
    }
  }

  /**
   * Delete transcript for a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const { unlink } = await import('fs/promises');
    const filePath = this.getFilePath(sessionId);
    try {
      await unlink(filePath);
    } catch {
      // File doesn't exist, ignore
    }
  }

  /**
   * Get transcript file size in bytes
   */
  async getTranscriptSize(sessionId: string): Promise<number> {
    const filePath = this.getFilePath(sessionId);
    if (!existsSync(filePath)) {
      return 0;
    }
    const stats = await stat(filePath);
    return stats.size;
  }
}
