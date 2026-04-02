import { getDatabase } from '../../stratix-database/StratixDatabase';

import type { AgentCheckpointData } from './AgentProcess';

// Database row interface
interface AgentBackgroundRow {
  agent_id: string;
  status: string;
  current_zone_id: string | null;
  current_task_id: string | null;
  last_heartbeat_at: number | null;
  last_checkpoint_at: number | null;
  checkpoint_data: string | null;
  error_log: string | null;
  started_at: number | null;
  stopped_at: number | null;
}

export class AgentCheckpointManager {
  private static instance: AgentCheckpointManager;

  private constructor() {}

  static getInstance(): AgentCheckpointManager {
    if (!AgentCheckpointManager.instance) {
      AgentCheckpointManager.instance = new AgentCheckpointManager();
    }
    return AgentCheckpointManager.instance;
  }

  async saveCheckpoint(agentId: string, checkpoint: Partial<AgentCheckpointData>): Promise<void> {
    const db = getDatabase().getDatabase();
    const now = Date.now();

    const existing = db.prepare(
      'SELECT agent_id FROM agent_backgrounds WHERE agent_id = ?'
    ).get(agentId);

    const checkpointData = JSON.stringify({
      currentTaskId: checkpoint.currentTaskId,
      context: checkpoint.context,
      zoneId: checkpoint.zoneId,
      checkpointAt: now,
    });

    if (existing) {
      db.prepare(`
        UPDATE agent_backgrounds
        SET last_checkpoint_at = ?,
            checkpoint_data = ?,
            last_heartbeat_at = ?
        WHERE agent_id = ?
      `).run(now, checkpointData, now, agentId);
    } else {
      db.prepare(`
        INSERT INTO agent_backgrounds (agent_id, status, last_checkpoint_at, checkpoint_data, last_heartbeat_at, started_at)
        VALUES (?, 'running', ?, ?, ?, ?)
      `).run(agentId, now, checkpointData, now, now);
    }
  }

  async getCheckpoint(agentId: string): Promise<AgentCheckpointData | null> {
    const db = getDatabase().getDatabase();

    const row = db.prepare(
      'SELECT checkpoint_data FROM agent_backgrounds WHERE agent_id = ?'
    ).get(agentId) as { checkpoint_data: string | null } | undefined;

    if (!row || !row.checkpoint_data) return null;

    try {
      return JSON.parse(row.checkpoint_data);
    } catch {
      return null;
    }
  }

  async updateHeartbeat(agentId: string): Promise<void> {
    const db = getDatabase().getDatabase();
    const now = Date.now();

    db.prepare(`
      UPDATE agent_backgrounds SET last_heartbeat_at = ? WHERE agent_id = ?
    `).run(now, agentId);
  }

  async updateStatus(
    agentId: string,
    status: 'running' | 'paused' | 'stopped' | 'error',
    error?: string
  ): Promise<void> {
    const db = getDatabase().getDatabase();
    const now = Date.now();

    const updates: string[] = ['last_heartbeat_at = ?'];
    const values: any[] = [now];

    if (status === 'stopped') {
      updates.push('stopped_at = ?');
      values.push(now);
    }

    if (error) {
      updates.push('error_log = ?');
      values.push(error);
    }

    // Map status string to DB format
    let dbStatus = status;
    if (status === 'running') {
      // Only update if not already stopped
      const existing = db.prepare('SELECT status FROM agent_backgrounds WHERE agent_id = ?').get(agentId) as { status: string } | undefined;
      if (existing && existing.status === 'stopped') {
        dbStatus = 'running'; // Reactivating
      }
    }

    updates.push('status = ?');
    values.push(dbStatus);
    values.push(agentId);

    db.prepare(`
      UPDATE agent_backgrounds SET ${updates.join(', ')} WHERE agent_id = ?
    `).run(...values);
  }

  async updateCurrentTask(agentId: string, taskId?: string): Promise<void> {
    const db = getDatabase().getDatabase();

    if (taskId) {
      db.prepare(`
        UPDATE agent_backgrounds SET current_task_id = ?, last_heartbeat_at = ?
        WHERE agent_id = ?
      `).run(taskId, Date.now(), agentId);
    } else {
      db.prepare(`
        UPDATE agent_backgrounds SET current_task_id = NULL, last_heartbeat_at = ?
        WHERE agent_id = ?
      `).run(Date.now(), agentId);
    }
  }

  async getRunningAgents(): Promise<string[]> {
    const db = getDatabase().getDatabase();

    const rows = db.prepare(
      "SELECT agent_id FROM agent_backgrounds WHERE status = 'running'"
    ).all() as { agent_id: string }[];

    return rows.map(r => r.agent_id);
  }

  async getAgentStatus(agentId: string): Promise<string | null> {
    const db = getDatabase().getDatabase();

    const row = db.prepare(
      'SELECT status FROM agent_backgrounds WHERE agent_id = ?'
    ).get(agentId) as { status: string } | undefined;

    return row?.status || null;
  }
}

export default AgentCheckpointManager;
