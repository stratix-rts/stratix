import { getDatabase } from './StratixDatabase';

export type AssignStrategy = 'random' | 'capability_match' | 'load_balance' | 'priority';

export interface ZoneCoordinatorConfig {
  llmProvider: string;
  model: string | null;
  autoDecompose: boolean;
  autoAssign: boolean;
  requireUserConfirm: boolean;
  assignStrategy: AssignStrategy;
  entryCondition: string | null;
}

export type ZoneCoordinatorConfigRecord = ZoneCoordinatorConfig & {
  zoneId: string;
  createdAt: number;
  updatedAt: number;
};

export class ZoneCoordinatorConfigRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  private mapRowToConfig(row: any): ZoneCoordinatorConfigRecord {
    return {
      zoneId: row.zone_id,
      llmProvider: row.llm_provider,
      model: row.model,
      autoDecompose: Boolean(row.auto_decompose),
      autoAssign: Boolean(row.auto_assign),
      requireUserConfirm: Boolean(row.require_user_confirm),
      assignStrategy: row.assign_strategy as AssignStrategy,
      entryCondition: row.entry_condition,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapConfigToRow(zoneId: string, config: Partial<ZoneCoordinatorConfig>): any {
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
      created_at: now,
      updated_at: now
    };
  }

  /**
   * Get coordinator config for a zone
   */
  getConfig(zoneId: string): ZoneCoordinatorConfigRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM zone_coordinators WHERE zone_id = ?
    `).get(zoneId) as any;
    return row ? this.mapRowToConfig(row) : null;
  }

  /**
   * Create or update coordinator config (UPSERT)
   */
  setConfig(zoneId: string, config: ZoneCoordinatorConfig): ZoneCoordinatorConfigRecord {
    const now = Date.now();
    const existing = this.getConfig(zoneId);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE zone_coordinators SET
          llm_provider = ?,
          model = ?,
          auto_decompose = ?,
          auto_assign = ?,
          require_user_confirm = ?,
          assign_strategy = ?,
          entry_condition = ?,
          updated_at = ?
        WHERE zone_id = ?
      `);
      stmt.run(
        config.llmProvider,
        config.model,
        config.autoDecompose ? 1 : 0,
        config.autoAssign ? 1 : 0,
        config.requireUserConfirm ? 1 : 0,
        config.assignStrategy,
        config.entryCondition ?? null,
        now,
        zoneId
      );
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO zone_coordinators (
          zone_id, llm_provider, model, auto_decompose, auto_assign,
          require_user_confirm, assign_strategy, entry_condition, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        zoneId,
        config.llmProvider,
        config.model,
        config.autoDecompose ? 1 : 0,
        config.autoAssign ? 1 : 0,
        config.requireUserConfirm ? 1 : 0,
        config.assignStrategy,
        config.entryCondition ?? null,
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
      entryCondition: partial.entryCondition !== undefined ? partial.entryCondition : existing.entryCondition
    };

    return this.setConfig(zoneId, updated);
  }

  /**
   * Delete coordinator config for a zone
   */
  deleteConfig(zoneId: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM zone_coordinators WHERE zone_id = ?`);
    const result = stmt.run(zoneId);
    return result.changes > 0;
  }

  /**
   * List all zones that have coordinator config
   */
  listConfigs(): ZoneCoordinatorConfigRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM zone_coordinators ORDER BY updated_at DESC
    `).all() as any[];
    return rows.map(row => this.mapRowToConfig(row));
  }
}

export const zoneCoordinatorConfigRepository = new ZoneCoordinatorConfigRepository();
