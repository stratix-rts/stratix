export interface ContextLayer1 {
  type: 'working';
  recentMessages: Array<{ role: string; content: string; timestamp: number }>;
  currentTask?: string;
  activeFiles?: string[];
  maxTokens: number;
}

export interface ContextLayer2 {
  type: 'session';
  messages: Array<{ role: string; content: string; timestamp: number }>;
  summary?: string;
  keyDecisions: string[];
  outstandingTasks: string[];
}

export interface ContextLayer3 {
  type: 'archive';
  archives: ContextArchive[];
}

export interface ContextArchive {
  archiveId: string;
  agentId: string;
  zoneId?: string;
  summary: string;
  keyDecisions: string[];
  outstandingTasks: string[];
  archivedAt: number;
  expiresAt?: number;
}

export interface ContextData {
  agentId: string;
  layer1: ContextLayer1;
  layer2: ContextLayer2;
  layer3?: ContextLayer3;
  totalTokens: number;
  maxTokens: number;
}

export const DEFAULT_MAX_TOKENS = {
  layer1: 8000,
  layer2: 64000,
};

/**
 * Estimate token count from text (rough approximation: 1 token ≈ 4 chars for English/Chinese mixed text)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if a context archive has expired
 */
export function isContextArchiveExpired(archive: ContextArchive): boolean {
  if (!archive.expiresAt) return false;
  return Date.now() > archive.expiresAt;
}
