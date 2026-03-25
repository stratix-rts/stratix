import type { AgentCheckpointData } from './AgentProcess';
import AgentCheckpointManager from './AgentCheckpoint';

export type AgentStatusCallback = (agentId: string, status: string, error?: string) => void;

export class BackgroundAgentService {
  private static instance: BackgroundAgentService;

  private processes: Map<string, {
    agentId: string;
    zoneId?: string;
    status: string;
    currentTaskId?: string;
    heartbeatTimer?: NodeJS.Timeout;
    startedAt: number;
    lastHeartbeat: number;
  }> = new Map();

  private checkpoint: AgentCheckpointManager;
  private statusListeners: AgentStatusCallback[] = [];
  private globalListeners: ((event: any) => void)[] = [];

  private heartbeatInterval = 30000; // 30 seconds

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
      console.warn(`[BackgroundAgentService] Agent ${agentId} is already running`);
      return false;
    }

    console.log(`[BackgroundAgentService] Starting agent ${agentId} in zone ${zoneId || 'none'}`);

    const now = Date.now();
    const processInfo = {
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
      console.error(`[BackgroundAgentService] Failed to start agent ${agentId}:`, error);
      processInfo.status = 'error';
      await this.checkpoint.updateStatus(agentId, 'error', String(error));
      this.notifyStatusChange(agentId, 'error', String(error));
      return false;
    }
  }

  async stopAgent(agentId: string, reason?: string): Promise<boolean> {
    const processInfo = this.processes.get(agentId);
    if (!processInfo) {
      console.warn(`[BackgroundAgentService] Agent ${agentId} is not running`);
      return false;
    }

    console.log(`[BackgroundAgentService] Stopping agent ${agentId}, reason: ${reason || 'none'}`);

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
      console.error(`[BackgroundAgentService] Error during checkpoint for ${agentId}:`, error);
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
    console.log('[BackgroundAgentService] Starting agent recovery...');

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
        console.error(`[BackgroundAgentService] Failed to recover agent ${agentId}:`, error);
        await this.checkpoint.updateStatus(agentId, 'error', String(error));
        failed++;
      }
    }

    console.log(`[BackgroundAgentService] Recovery complete: ${recovered} recovered, ${failed} failed`);
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

  getAgentInfo(agentId: string) {
    return this.processes.get(agentId) || null;
  }

  getAllAgents(): Array<{
    agentId: string;
    zoneId?: string;
    status: string;
    currentTaskId?: string;
    startedAt: number;
    lastHeartbeat: number;
  }> {
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

  onEvent(callback: (event: any) => void): void {
    this.globalListeners.push(callback);
  }

  offEvent(callback: (event: any) => void): void {
    this.globalListeners = this.globalListeners.filter(cb => cb !== callback);
  }

  private notifyStatusChange(agentId: string, status: string, error?: string): void {
    this.statusListeners.forEach(cb => cb(agentId, status, error));
  }

  private emitEvent(event: any): void {
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
        console.error(`[BackgroundAgentService] Heartbeat failed for ${agentId}:`, error);
      }
    }, this.heartbeatInterval);
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
    console.log('[BackgroundAgentService] Shutting down all agents...');

    const stopPromises = Array.from(this.processes.keys()).map(agentId =>
      this.stopAgent(agentId, 'service_shutdown')
    );

    await Promise.all(stopPromises);

    console.log('[BackgroundAgentService] All agents stopped');
  }
}

export default BackgroundAgentService;
