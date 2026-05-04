import type { Database, Statement } from './sqlite-adapter';

import { getDatabase } from './StratixDatabase';

export type AssignStrategy = 'random' | 'capability_match' | 'load_balance' | 'priority' | 'round_robin';

/**
 * Cycle configuration for Zone task loop execution
 */
export interface CycleConfig {
  enabled: boolean;
  intervalMs: number;
  lastRun: number | null;
  count: number;
  maxCycles: number | null;  // null = infinite
  requirement: string | null; // the requirement to re-execute
}

export interface ZoneCoordinatorConfig {
  llmProvider: string;
  model: string | null;
  autoDecompose: boolean;
  autoAssign: boolean;
  requireUserConfirm: boolean;
  assignStrategy: AssignStrategy;
  entryCondition: string | null;
  apiKey?: string;
  baseUrl?: string;
  cycleConfig?: CycleConfig;
  llmTimeout?: number;
}

export type ZoneCoordinatorConfigRecord = ZoneCoordinatorConfig & {
  zoneId: string;
  createdAt: number;
  updatedAt: number;
};

interface ZoneCoordinatorRow {
  zone_id: string;
  llm_provider: string;
  model: string | null;
  auto_decompose: number;
  auto_assign: number;
  require_user_confirm: number;
  assign_strategy: string;
  entry_condition: string | null;
  api_key: string | null;
  base_url: string | null;
  cycle_config: string | null;
  created_at: number;
  updated_at: number;
}

interface ZoneCoordinatorInsertRow {
  zone_id: string;
  llm_provider: string;
  model: string | null;
  auto_decompose: number;
  auto_assign: number;
  require_user_confirm: number;
  assign_strategy: string;
  entry_condition: string | null;
  api_key: string | null;
  base_url: string | null;
  cycle_config: string | null;
  created_at: number;
  updated_at: number;
}

export class ZoneCoordinatorConfigRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  private statements = new Map<string, Statement>();

  private stmt(sql: string): Statement {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  /**
   * 清理 prepared statement 缓存
   */
  shutdown(): void {
    this.statements.clear();
  }

  /**
   * 检查数据库连接是否健康
   */
  isHealthy(): boolean {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  private mapRowToConfig(row: ZoneCoordinatorRow): ZoneCoordinatorConfigRecord {
    let cycleConfig: CycleConfig | undefined;
    if (row.cycle_config) {
      try {
        cycleConfig = JSON.parse(row.cycle_config) as CycleConfig;
      } catch {
        /* expected: corrupted cycle_config JSON */
      }
    }
    return {
      zoneId: row.zone_id,
      llmProvider: row.llm_provider,
      model: row.model,
      autoDecompose: Boolean(row.auto_decompose),
      autoAssign: Boolean(row.auto_assign),
      requireUserConfirm: Boolean(row.require_user_confirm),
      assignStrategy: row.assign_strategy as AssignStrategy,
      entryCondition: row.entry_condition,
      apiKey: row.api_key || undefined,
      baseUrl: row.base_url || undefined,
      cycleConfig,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapConfigToRow(zoneId: string, config: Partial<ZoneCoordinatorConfig>): ZoneCoordinatorInsertRow {
    const now = Date.now();
    return {
      zone_id: zoneId,
      llm_provider: config.llmProvider ?? 'openai',
      model: config.model ?? null,
      auto_decompose: config.autoDecompose !== undefined ? (config.autoDecompose ? 1 : 0) : 1,
      auto_assign: config.autoAssign !== undefined ? (config.autoAssign ? 1 : 0) : 1,
      require_user_confirm: config.requireUserConfirm !== undefined ? (config.requireUserConfirm ? 1 : 0) : 0,
      assign_strategy: config.assignStrategy ?? 'capability_match',
      entry_condition: config.entryCondition ?? null,
      api_key: config.apiKey ?? null,
      base_url: config.baseUrl ?? null,
      cycle_config: config.cycleConfig ? JSON.stringify(config.cycleConfig) : null,
      created_at: now,
      updated_at: now
    };
  }

  /**
   * Get coordinator config for a zone
   */
  getConfig(zoneId: string): ZoneCoordinatorConfigRecord | null {
    const row = this.stmt(`
      SELECT * FROM zone_coordinators WHERE zone_id = ?
    `).get(zoneId) as ZoneCoordinatorRow | undefined;
    return row ? this.mapRowToConfig(row) : null;
  }

  /**
   * Create or update coordinator config (UPSERT)
   */
  setConfig(zoneId: string, config: ZoneCoordinatorConfig): ZoneCoordinatorConfigRecord {
    const now = Date.now();
    const existing = this.getConfig(zoneId);

    if (existing) {
      this.stmt(`
        UPDATE zone_coordinators SET
          llm_provider = ?,
          model = ?,
          auto_decompose = ?,
          auto_assign = ?,
          require_user_confirm = ?,
          assign_strategy = ?,
          entry_condition = ?,
          api_key = ?,
          base_url = ?,
          cycle_config = ?,
          updated_at = ?
        WHERE zone_id = ?
      `).run(
        config.llmProvider,
        config.model,
        config.autoDecompose ? 1 : 0,
        config.autoAssign ? 1 : 0,
        config.requireUserConfirm ? 1 : 0,
        config.assignStrategy,
        config.entryCondition ?? null,
        config.apiKey ?? null,
        config.baseUrl ?? null,
        config.cycleConfig ? JSON.stringify(config.cycleConfig) : null,
        now,
        zoneId
      );
    } else {
      this.stmt(`
        INSERT INTO zone_coordinators (
          zone_id, llm_provider, model, auto_decompose, auto_assign,
          require_user_confirm, assign_strategy, entry_condition, api_key, base_url, cycle_config, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        zoneId,
        config.llmProvider,
        config.model,
        config.autoDecompose ? 1 : 0,
        config.autoAssign ? 1 : 0,
        config.requireUserConfirm ? 1 : 0,
        config.assignStrategy,
        config.entryCondition ?? null,
        config.apiKey ?? null,
        config.baseUrl ?? null,
        config.cycleConfig ? JSON.stringify(config.cycleConfig) : null,
        now,
        now
      );
    }

    return this.getConfig(zoneId)!;
  }

  /**
   * Partial update of coordinator config
   */
  updateConfig(zoneId: string, partial: Partial<ZoneCoordinatorConfig>): ZoneCoordinatorConfigRecord | null {
    const existing = this.getConfig(zoneId);
    if (!existing) return null;

    const updated: ZoneCoordinatorConfig = {
      llmProvider: partial.llmProvider ?? existing.llmProvider,
      model: partial.model !== undefined ? partial.model : existing.model,
      autoDecompose: partial.autoDecompose !== undefined ? partial.autoDecompose : existing.autoDecompose,
      autoAssign: partial.autoAssign !== undefined ? partial.autoAssign : existing.autoAssign,
      requireUserConfirm: partial.requireUserConfirm !== undefined ? partial.requireUserConfirm : existing.requireUserConfirm,
      assignStrategy: partial.assignStrategy ?? existing.assignStrategy,
      entryCondition: partial.entryCondition !== undefined ? partial.entryCondition : existing.entryCondition,
      apiKey: partial.apiKey !== undefined ? partial.apiKey : existing.apiKey,
      baseUrl: partial.baseUrl !== undefined ? partial.baseUrl : existing.baseUrl,
      cycleConfig: partial.cycleConfig !== undefined ? partial.cycleConfig : existing.cycleConfig
    };

    return this.setConfig(zoneId, updated);
  }

  /**
   * Delete coordinator config for a zone
   */
  deleteConfig(zoneId: string): boolean {
    const result = this.stmt(`DELETE FROM zone_coordinators WHERE zone_id = ?`).run(zoneId);
    return result.changes > 0;
  }

  /**
   * List all zones that have coordinator config
   */
  listConfigs(): ZoneCoordinatorConfigRecord[] {
    const rows = this.stmt(`
      SELECT * FROM zone_coordinators ORDER BY updated_at DESC
    `).all() as ZoneCoordinatorRow[];
    return rows.map(row => this.mapRowToConfig(row));
  }
}

export const zoneCoordinatorConfigRepository = new ZoneCoordinatorConfigRepository();
