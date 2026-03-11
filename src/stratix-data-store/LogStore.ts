import { StratixDataStore } from './StratixDataStore';
import { StratixCommandLog, LogQueryOptions } from './types';

export class LogStore {
  private dataStore: StratixDataStore;

  constructor(dataStore: StratixDataStore) {
    this.dataStore = dataStore;
  }

  public generateId(): string {
    return `stratix-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  public async createLog(
    commandId: string,
    agentId: string,
    skillId: string,
    skillName: string,
    params: Record<string, any>
  ): Promise<StratixCommandLog> {
    const log: StratixCommandLog = {
      logId: this.generateId(),
      commandId,
      agentId,
      skillId,
      skillName,
      params,
      status: 'pending',
      startTime: Date.now()
    };
    
    await this.dataStore.addLog(log);
    return log;
  }

  public async updateStatus(
    logId: string,
    status: StratixCommandLog['status'],
    result?: string,
    error?: string
  ): Promise<boolean> {
    const updates: Partial<StratixCommandLog> = { status };
    
    if (result !== undefined) {
      updates.result = result;
    }
    
    if (error !== undefined) {
      updates.error = error;
    }
    
    if (status === 'success' || status === 'failed') {
      updates.endTime = Date.now();
    }
    
    await this.dataStore.updateLog(logId, updates);
    return true;
  }

  public async markRunning(logId: string): Promise<boolean> {
    return this.updateStatus(logId, 'running');
  }

  public async markSuccess(logId: string, result?: string): Promise<boolean> {
    return this.updateStatus(logId, 'success', result);
  }

  public async markFailed(logId: string, error?: string): Promise<boolean> {
    return this.updateStatus(logId, 'failed', undefined, error);
  }

  public async getLog(logId: string): Promise<StratixCommandLog | null> {
    return this.dataStore.getLog(logId);
  }

  public async getRecentLogs(agentId?: string, limit: number = 10): Promise<StratixCommandLog[]> {
    return this.dataStore.getLogs({ agentId, limit });
  }

  public async getLogs(options: LogQueryOptions = {}): Promise<StratixCommandLog[]> {
    return this.dataStore.getLogs(options);
  }

  public async getLogsByStatus(
    status: StratixCommandLog['status'],
    limit: number = 20
  ): Promise<StratixCommandLog[]> {
    return this.dataStore.getLogs({ status, limit });
  }

  public async clearAllLogs(): Promise<void> {
    await this.dataStore.clearLogs();
  }

  public async getDuration(logId: string): Promise<number | null> {
    const log = await this.getLog(logId);
    if (!log || !log.endTime) return null;
    return log.endTime - log.startTime;
  }
}
