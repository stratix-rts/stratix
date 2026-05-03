import AgentCheckpointManager from './AgentCheckpoint';
import type { AgentCheckpointData } from './AgentProcess';

export type AgentStatusCallback = (agentId: string, status: string, error?: string) => void;

function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[BackgroundAgentService] ${message}`, ctx);
}

const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds

export interface BackgroundAgentEvent {
  type: 'agent_started' | 'agent_stopped' | 'agent_paused' | 'agent_resumed' | 'task_assigned' | 'task_completed';
  agentId: string;
  zoneId?: string;
  taskId?: string;
  reason?: string;
  timestamp: number;
}

interface AgentProcessInfo {
  agentId: string;
  zoneId?: string;
  status: string;
  currentTaskId?: string;
  heartbeatTimer?: NodeJS.Timeout;
  startedAt: number;
  lastHeartbeat: number;
}

export class BackgroundAgentService {
  private static instance: BackgroundAgentService;

  private processes: Map<string, AgentProcessInfo> = new Map();

  private checkpoint: AgentCheckpointManager;
  private statusListeners: AgentStatusCallback[] = [];
  private globalListeners: ((event: BackgroundAgentEvent) => void)[] = [];

  private constructor() {
    this.checkpoint = AgentCheckpointManager.getInstance();
  }

  static getInstance(): BackgroundAgentService {
    if (!BackgroundAgentService.instance) {
      BackgroundAgentService.instance = new BackgroundAgentService();
    }
    return BackgroundAgentService.instance;
  }

  // ==================== Agent Lifecycle ====================

  async startAgent(
    agentId: string,
    zoneId?: string,
    options: { autoRestart?: boolean; maxRestarts?: number } = {}
  ): Promise<boolean> {
    if (this.processes.has(agentId)) {
      log('warn', `Agent ${agentId} is already running`);
      return false;
    }

    log('info', `Starting agent ${agentId} in zone ${zoneId || 'none'}`);

    const now = Date.now();
    const processInfo: AgentProcessInfo = {
      agentId,
      zoneId,
      status: 'starting',
      startedAt: now,
      lastHeartbeat: now,
    };

    this.processes.set(agentId, processInfo);

    try {
      // Save initial checkpoint
      await this.checkpoint.saveCheckpoint(agentId, {
        agentId,
        zoneId,
        checkpointAt: now,
      });

      // Update status to running
      await this.checkpoint.updateStatus(agentId, 'running');
      await this.checkpoint.updateHeartbeat(agentId);

      // Start heartbeat monitoring
      this.startHeartbeat(agentId);

      processInfo.status = 'running';
      this.notifyStatusChange(agentId, 'running');

      // Emit event
      this.emitEvent({ type: 'agent_started', agentId, zoneId, timestamp: now });

      return true;
    } catch (error) {
      log('error', `Failed to start agent ${agentId}`, { error: String(error) });
      processInfo.status = 'error';
      await this.checkpoint.updateStatus(agentId, 'error', String(error));
      this.notifyStatusChange(agentId, 'error', String(error));
      return false;
    }
  }

  async stopAgent(agentId: string, reason?: string): Promise<boolean> {
    const processInfo = this.processes.get(agentId);
    if (!processInfo) {
      log('warn', `Agent ${agentId} is not running`);
      return false;
    }

    log('info', `Stopping agent ${agentId}, reason: ${reason || 'none'}`);

    processInfo.status = 'stopping';
    this.notifyStatusChange(agentId, 'stopping');

    // Stop heartbeat first (always, even on error)
    this.stopHeartbeat(agentId);

    try {
      // Save final checkpoint
      await this.checkpoint.saveCheckpoint(agentId, {
        agentId,
        currentTaskId: processInfo.currentTaskId,
        zoneId: processInfo.zoneId,
        checkpointAt: Date.now(),
      });

      // Update status to stopped
      await this.checkpoint.updateStatus(agentId, 'stopped');
    } catch (error) {
      log('error', `Error during checkpoint for ${agentId}`, { error: String(error) });
      // Continue with cleanup even if checkpoint fails
    }

    processInfo.status = 'stopped';
    this.processes.delete(agentId);

    this.notifyStatusChange(agentId, 'stopped');
    this.emitEvent({
      type: 'agent_stopped',
      agentId,
      reason,
      timestamp: Date.now()
    });

    return true;
  }

  async pauseAgent(agentId: string): Promise<boolean> {
    const processInfo = this.processes.get(agentId);
    if (!processInfo) return false;

    processInfo.status = 'paused';
    this.stopHeartbeat(agentId);

    await this.checkpoint.updateStatus(agentId, 'paused');
    this.notifyStatusChange(agentId, 'paused');

    this.emitEvent({ type: 'agent_paused', agentId, timestamp: Date.now() });

    return true;
  }

  async resumeAgent(agentId: string): Promise<boolean> {
    const processInfo = this.processes.get(agentId);
    if (!processInfo) return false;

    processInfo.status = 'running';
    this.startHeartbeat(agentId);

    await this.checkpoint.updateStatus(agentId, 'running');
    await this.checkpoint.updateHeartbeat(agentId);

    this.notifyStatusChange(agentId, 'running');
    this.emitEvent({ type: 'agent_resumed', agentId, timestamp: Date.now() });

    return true;
  }

  // ==================== Recovery ====================

  async recoverAgents(): Promise<{ recovered: number; failed: number }> {
    log('info', 'Starting agent recovery...');

    const runningAgents = await this.checkpoint.getRunningAgents();
    let recovered = 0;
    let failed = 0;

    for (const agentId of runningAgents) {
      try {
        const checkpoint = await this.checkpoint.getCheckpoint(agentId);
        if (checkpoint) {
          await this.startAgent(agentId, checkpoint.zoneId);
          recovered++;
        } else {
          // No checkpoint data, just start fresh
          await this.startAgent(agentId);
          recovered++;
        }
      } catch (error) {
        log('error', `Failed to recover agent ${agentId}`, { error: String(error) });
        await this.checkpoint.updateStatus(agentId, 'error', String(error));
        failed++;
      }
    }

    log('info', `Recovery complete: ${recovered} recovered, ${failed} failed`);
    return { recovered, failed };
  }

  // ==================== Task Assignment ====================

  async assignTask(agentId: string, taskId: string): Promise<boolean> {
    const processInfo = this.processes.get(agentId);
    if (!processInfo || processInfo.status !== 'running') {
      return false;
    }

    processInfo.currentTaskId = taskId;
    await this.checkpoint.updateCurrentTask(agentId, taskId);

    this.emitEvent({
      type: 'task_assigned',
      agentId,
      taskId,
      timestamp: Date.now()
    });

    return true;
  }

  async completeTask(agentId: string, taskId: string): Promise<boolean> {
    const processInfo = this.processes.get(agentId);
    if (!processInfo) return false;

    if (processInfo.currentTaskId === taskId) {
      processInfo.currentTaskId = undefined;
      await this.checkpoint.updateCurrentTask(agentId);
    }

    this.emitEvent({
      type: 'task_completed',
      agentId,
      taskId,
      timestamp: Date.now()
    });

    return true;
  }

  // ==================== Status & Info ====================

  getAgentInfo(agentId: string): AgentProcessInfo | null {
    return this.processes.get(agentId) || null;
  }

  getAllAgents(): AgentProcessInfo[] {
    return Array.from(this.processes.values());
  }

  getRunningCount(): number {
    return Array.from(this.processes.values()).filter(p => p.status === 'running').length;
  }

  // ==================== Event System ====================

  onStatusChange(callback: AgentStatusCallback): void {
    this.statusListeners.push(callback);
  }

  offStatusChange(callback: AgentStatusCallback): void {
    this.statusListeners = this.statusListeners.filter(cb => cb !== callback);
  }

  onEvent(callback: (event: BackgroundAgentEvent) => void): void {
    this.globalListeners.push(callback);
  }

  offEvent(callback: (event: BackgroundAgentEvent) => void): void {
    this.globalListeners = this.globalListeners.filter(cb => cb !== callback);
  }

  private notifyStatusChange(agentId: string, status: string, error?: string): void {
    this.statusListeners.forEach(cb => cb(agentId, status, error));
  }

  private emitEvent(event: BackgroundAgentEvent): void {
    this.globalListeners.forEach(cb => cb(event));
  }

  // ==================== Heartbeat ====================

  private startHeartbeat(agentId: string): void {
    const processInfo = this.processes.get(agentId);
    if (!processInfo) return;

    this.stopHeartbeat(agentId);

    processInfo.heartbeatTimer = setInterval(async () => {
      try {
        await this.checkpoint.updateHeartbeat(agentId);
        processInfo.lastHeartbeat = Date.now();
      } catch (error) {
        log('error', `Heartbeat failed for ${agentId}`, { error: String(error) });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(agentId: string): void {
    const processInfo = this.processes.get(agentId);
    if (processInfo?.heartbeatTimer) {
      clearInterval(processInfo.heartbeatTimer);
      processInfo.heartbeatTimer = undefined;
    }
  }

  // ==================== Cleanup ====================

  async shutdown(): Promise<void> {
    log('info', 'Shutting down all agents...');

    const stopPromises = Array.from(this.processes.keys()).map(agentId =>
      this.stopAgent(agentId, 'service_shutdown')
    );

    await Promise.all(stopPromises);

    log('info', 'All agents stopped');
  }

  destroy(): void {
    this.statusListeners = [];
    this.globalListeners = [];
    for (const [agentId] of this.processes) {
      this.stopHeartbeat(agentId);
    }
    this.processes.clear();
  }
}

export default BackgroundAgentService;
