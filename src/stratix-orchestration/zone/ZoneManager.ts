import { getDatabase } from '../../stratix-database/StratixDatabase';
import { ZoneState, ZoneConfig, ZoneEvent, DEFAULT_ZONE_CONFIG } from './ZoneState';

type ZoneEventCallback = (event: ZoneEvent) => void;

// Database row interfaces
interface ZoneRow {
  zone_id: string;
  name: string;
  type: 'task' | 'project' | 'general';
  project_id: string | null;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  status: string;
  config: string;
  created_at: number;
  updated_at: number;
}

interface AgentMemberRow {
  agent_id: string;
}

interface TaskRow {
  task_id: string;
}

export class ZoneManager {
  private static instance: ZoneManager;
  private zones: Map<string, ZoneState> = new Map();
  private eventListeners: Map<string, ZoneEventCallback[]> = new Map();
  private globalListeners: ZoneEventCallback[] = [];

  // Lazy import to avoid circular dependency
  private taskQueueService: any = null;

  private constructor() {}

  private getTaskQueueService() {
    if (!this.taskQueueService) {
      try {
        const { TaskQueueService } = require('../task-queue/TaskQueueService');
        this.taskQueueService = TaskQueueService.getInstance();
      } catch (e) {
        console.warn('[ZoneManager] TaskQueueService not available:', e);
      }
    }
    return this.taskQueueService;
  }

  static getInstance(): ZoneManager {
    if (!ZoneManager.instance) {
      ZoneManager.instance = new ZoneManager();
    }
    return ZoneManager.instance;
  }

  // ==================== Zone CRUD ====================

  async createZone(
    zoneId: string,
    name: string,
    type: 'task' | 'project' | 'general',
    position: { x: number; y: number },
    size: { width: number; height: number },
    config: Partial<ZoneConfig> = {},
    projectId?: string
  ): Promise<ZoneState> {
    const db = getDatabase().getDatabase();
    const now = Date.now();

    const fullConfig: ZoneConfig = { ...DEFAULT_ZONE_CONFIG, ...config };

    db.prepare(`
      INSERT INTO zones (zone_id, name, type, project_id, position_x, position_y, width, height, status, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?)
    `).run(
      zoneId,
      name,
      type,
      projectId || null,
      position.x,
      position.y,
      size.width,
      size.height,
      JSON.stringify(fullConfig),
      now,
      now
    );

    const zone: ZoneState = {
      zoneId,
      name,
      type,
      projectId,
      position,
      size,
      status: 'idle',
      config: fullConfig,
      enteredAgents: [],
      taskPool: [],
      createdAt: now,
      updatedAt: now,
    };

    this.zones.set(zoneId, zone);
    this.emitEvent({ type: 'status_change', zoneId, timestamp: now, data: { status: 'idle' } });

    return zone;
  }

  async getZone(zoneId: string): Promise<ZoneState | null> {
    // Check memory first
    if (this.zones.has(zoneId)) {
      return this.zones.get(zoneId)!;
    }

    // Load from database
    const db = getDatabase().getDatabase();
    const row = db.prepare('SELECT * FROM zones WHERE zone_id = ?').get(zoneId) as ZoneRow | undefined;

    if (!row) return null;

    const zone = this.rowToZone(row);
    this.zones.set(zoneId, zone);
    return zone;
  }

  async getAllZones(): Promise<ZoneState[]> {
    const db = getDatabase().getDatabase();
    const rows = db.prepare('SELECT * FROM zones ORDER BY created_at DESC').all() as ZoneRow[];

    return rows.map(row => {
      const zone = this.rowToZone(row);
      this.zones.set(zone.zoneId, zone);
      return zone;
    });
  }

  async updateZone(zoneId: string, updates: Partial<Pick<ZoneState, 'name' | 'status' | 'config'>>): Promise<ZoneState | null> {
    const zone = await this.getZone(zoneId);
    if (!zone) return null;

    const db = getDatabase().getDatabase();
    const now = Date.now();

    const setClauses: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    if (updates.name !== undefined) {
      zone.name = updates.name;
      setClauses.push('name = ?');
      values.push(updates.name);
    }

    if (updates.status !== undefined) {
      zone.status = updates.status;
      setClauses.push('status = ?');
      values.push(updates.status);
    }

    if (updates.config !== undefined) {
      zone.config = { ...zone.config, ...updates.config };
      setClauses.push('config = ?');
      values.push(JSON.stringify(zone.config));
    }

    values.push(zoneId);
    db.prepare(`UPDATE zones SET ${setClauses.join(', ')} WHERE zone_id = ?`).run(...values);

    zone.updatedAt = now;
    this.zones.set(zoneId, zone);
    this.emitEvent({ type: 'status_change', zoneId, timestamp: now, data: { status: zone.status } });

    return zone;
  }

  async deleteZone(zoneId: string): Promise<boolean> {
    const db = getDatabase().getDatabase();
    const result = db.prepare('DELETE FROM zones WHERE zone_id = ?').run(zoneId);

    if (result.changes > 0) {
      this.zones.delete(zoneId);
      return true;
    }
    return false;
  }

  // ==================== Zone Membership ====================

  async enterZone(agentId: string, zoneId: string, role: 'owner' | 'member' | 'observer' = 'member'): Promise<boolean> {
    const zone = await this.getZone(zoneId);
    if (!zone) return false;

    const db = getDatabase().getDatabase();
    const now = Date.now();

    // Check if already in zone
    const existing = db.prepare(
      'SELECT 1 FROM agent_zone_members WHERE agent_id = ? AND zone_id = ?'
    ).get(agentId, zoneId);

    if (existing) {
      // Update role if different
      db.prepare('UPDATE agent_zone_members SET role = ?, entered_at = ? WHERE agent_id = ? AND zone_id = ?')
        .run(role, now, agentId, zoneId);
    } else {
      // Insert new membership
      db.prepare('INSERT INTO agent_zone_members (agent_id, zone_id, entered_at, role) VALUES (?, ?, ?, ?)')
        .run(agentId, zoneId, now, role);
    }

    if (!zone.enteredAgents.includes(agentId)) {
      zone.enteredAgents.push(agentId);
    }

    // Update zone status
    if (zone.status === 'idle') {
      await this.updateZone(zoneId, { status: 'active' });
    }

    this.emitEvent({
      type: 'enter',
      zoneId,
      agentId,
      timestamp: now,
    });

    return true;
  }

  async exitZone(agentId: string, zoneId: string, reason?: string): Promise<boolean> {
    const zone = await this.getZone(zoneId);
    if (!zone) return false;

    const db = getDatabase().getDatabase();
    const now = Date.now();

    db.prepare('DELETE FROM agent_zone_members WHERE agent_id = ? AND zone_id = ?').run(agentId, zoneId);

    zone.enteredAgents = zone.enteredAgents.filter(id => id !== agentId);

    // Update zone status if no agents left
    if (zone.enteredAgents.length === 0) {
      await this.updateZone(zoneId, { status: 'idle' });
    }

    this.emitEvent({
      type: 'exit',
      zoneId,
      agentId,
      timestamp: now,
      data: { reason },
    });

    return true;
  }

  async getAgentsInZone(zoneId: string): Promise<string[]> {
    const zone = await this.getZone(zoneId);
    return zone?.enteredAgents || [];
  }

  // ==================== Task Pool ====================

  async addTaskToZone(zoneId: string, taskId: string): Promise<boolean> {
    const zone = await this.getZone(zoneId);
    if (!zone) return false;

    if (!zone.taskPool.includes(taskId)) {
      zone.taskPool.push(taskId);

      // Update zone status if needed
      if (zone.status === 'idle') {
        await this.updateZone(zoneId, { status: 'active' });
      }

      this.emitEvent({
        type: 'task_added',
        zoneId,
        timestamp: Date.now(),
        data: { taskId },
      });
    }

    return true;
  }

  async removeTaskFromZone(zoneId: string, taskId: string): Promise<boolean> {
    const zone = await this.getZone(zoneId);
    if (!zone) return false;

    zone.taskPool = zone.taskPool.filter(id => id !== taskId);
    this.emitEvent({
      type: 'task_removed',
      zoneId,
      timestamp: Date.now(),
      data: { taskId },
    });

    return true;
  }

  // ==================== Event System ====================

  on(event: string, callback: ZoneEventCallback): void {
    if (event === '*') {
      this.globalListeners.push(callback);
    } else {
      if (!this.eventListeners.has(event)) {
        this.eventListeners.set(event, []);
      }
      this.eventListeners.get(event)!.push(callback);
    }
  }

  off(event: string, callback: ZoneEventCallback): void {
    if (event === '*') {
      this.globalListeners = this.globalListeners.filter(cb => cb !== callback);
    } else {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        this.eventListeners.set(event, listeners.filter(cb => cb !== callback));
      }
    }
  }

  private emitEvent(event: ZoneEvent): void {
    // Call specific listeners
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach(cb => cb(event));
    }

    // Call global listeners
    this.globalListeners.forEach(cb => cb(event));
  }

  // ==================== Sync with Frontend ====================

  async syncToFrontend(): Promise<ZoneState[]> {
    const zones = await this.getAllZones();
    return zones.map(zone => ({
      ...zone,
      taskPool: zone.taskPool, // Include task pool for frontend sync
    }));
  }

  // ==================== Helpers ====================

  private rowToZone(row: any): ZoneState {
    let config: ZoneConfig;
    try {
      config = JSON.parse(row.config || '{}');
    } catch {
      config = DEFAULT_ZONE_CONFIG;
    }

    // Load agents from membership table
    const db = getDatabase().getDatabase();
    const members = db.prepare(
      'SELECT agent_id FROM agent_zone_members WHERE zone_id = ?'
    ).all(row.zone_id) as AgentMemberRow[];

    // Load pending task IDs from tasks table
    const tasks = db.prepare(
      "SELECT task_id FROM tasks WHERE zone_id = ? AND status = 'pending'"
    ).all(row.zone_id) as TaskRow[];
    const taskPool = tasks.map(t => t.task_id);

    return {
      zoneId: row.zone_id,
      name: row.name,
      type: row.type,
      projectId: row.project_id,
      position: { x: row.position_x, y: row.position_y },
      size: { width: row.width, height: row.height },
      status: row.status,
      config,
      enteredAgents: members.map(m => m.agent_id),
      taskPool, // Loaded from tasks table
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export default ZoneManager;
