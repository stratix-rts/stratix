import { StratixAgentConfig } from '../stratix-core/stratix-protocol';

export type OpenClawConnectionMethod = 'pairing' | 'tailscale';

export interface OpenClawConnectionRecord {
  id: string;
  name: string;
  method: OpenClawConnectionMethod;
  endpoint: string;
  sharedToken?: string;
  deviceToken?: string;
  deviceId?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface OpenClawConnectionsConfig {
  version: string;
  connections: OpenClawConnectionRecord[];
  metadata: {
    createdAt: number;
    updatedAt: number;
  };
}

export const DEFAULT_OPENCLAW_CONFIG: OpenClawConnectionsConfig = {
  version: '1.0.0',
  connections: [],
  metadata: { createdAt: Date.now(), updatedAt: Date.now() }
};

export interface ConnectionPoolStatus {
  connectionId: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  latency?: number;
  lastConnected?: number;
  lastError?: string;
  clientCount: number;
}

export interface StratixCommandLog {
  logId: string;
  commandId: string;
  agentId: string;
  skillId: string;
  skillName: string;
  params: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'failed';
  result?: string;
  error?: string;
  startTime: number;
  endTime?: number;
}

export interface StratixDatabaseMetadata {
  createdAt: number;
  updatedAt: number;
}

export interface StratixTemplates {
  preset: StratixAgentConfig[];
  custom: StratixAgentConfig[];
}

export interface StratixDatabase {
  version: string;
  agents: StratixAgentConfig[];
  templates: StratixTemplates;
  logs: StratixCommandLog[];
  metadata: StratixDatabaseMetadata;
}

export const DEFAULT_DB: StratixDatabase = {
  version: '1.0.0',
  agents: [],
  templates: { preset: [], custom: [] },
  logs: [],
  metadata: { createdAt: Date.now(), updatedAt: Date.now() }
};

export interface LogQueryOptions {
  agentId?: string;
  status?: StratixCommandLog['status'];
  limit?: number;
  offset?: number;
}

export function isValidLogQueryOptions(options: unknown): options is LogQueryOptions {
  if (!options || typeof options !== 'object') return false;
  const opts = options as LogQueryOptions;
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 0)) return false;
  if (opts.offset !== undefined && (!Number.isInteger(opts.offset) || opts.offset < 0)) return false;
  if (opts.agentId !== undefined && typeof opts.agentId !== 'string') return false;
  if (opts.status !== undefined && !['pending', 'running', 'success', 'failed'].includes(opts.status)) return false;
  return true;
}
