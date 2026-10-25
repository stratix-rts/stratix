import path from 'path';

import * as fs from 'fs-extra';

import { Database } from './sqlite-adapter';

const DEFAULT_DATA_DIR = 'stratix-data';
const DEFAULT_FILENAME = 'stratix.db';
/**
 * v2（@since v3.12，task_033）：新增 characters + unit_positions（游戏存档表，角色档案与单位站位）。
 * DDL 与 src/app/services/persistence/game-save-dao.ts 的 ensureGameSaveTables 同构 —— 改一处必须同步另一处。
 * v3（@since v3.15，task_036）：新增 character_chat_messages（角色对话历史，user/assistant/error 三种角色）。
 * DDL 与 src/app/services/persistence/chat-history-dao.ts 的 ensureCharacterChatMessagesTable 同构。
 * why 不叫 messages：messages 表已被项目/频道聊天占用（v1 起就有，schema 完全不同），
 * 角色对话历史单独建表，命名对齐既有 agent_chat_messages 的先例。
 * v4（@since v3.16，task_037）：新增 character_tasks（角色任务：派发 → 执行 → 产出，与聊天审计分离）。
 * DDL 与 src/app/services/persistence/task-record-dao.ts 的 ensureCharacterTasksTable 同构。
 * why 不叫 tasks：tasks 表已被 agent 平台任务队列占用（v1 起就有，task_id 主键 / zone 形状），
 * 角色任务表命名对齐 character_chat_messages 的先例（character_ 前缀 = 游戏存档域），零冲突。
 * v5（@since v3.23，task_047）：character_tasks.status CHECK 扩五态（增 cancelled，排队取消）。
 * SQLite 的 CHECK 不可 ALTER → **重建表迁移**（建新表 → INSERT SELECT 搬数据 → DROP → RENAME），
 * 保留 CHECK 而不是放弃约束的理由见 task-record-dao.ts 文件头（两处同一方案，同构可审）。
 * v6（@since v3.24，task_048）：character_tasks 增 artifacts 列（任务成果物 JSON，'' = 无）。
 * 纯加列不动 CHECK → ALTER ADD COLUMN 即可，无需重建（与 v5 的重建方案对比见 DAO 文件头）。
 * v7（@since v3.25，task_049）：character_tasks.status CHECK 扩六态（增 awaiting_approval，
 * 任务审批门的挂起相位）+ 增 plan 列（计划草稿全文，'' = 无）。CHECK 又要动 → 沿用 v5 重建
 * 方案（临时表 character_tasks_v7）；plan 列随重建的建表 DDL 一并就位（六态表缺列边角由
 * ALTER ADD 兜底）。前置顺序：artifacts 兜底先行（v7 重建的 INSERT SELECT 要搬运它）。
 */
/**
 * v8（@since v3.27，task_051）：新增 pipelines 表（多 agent 流水线编排态：站序 JSON +
 * 整线相位 + 议题原文；DDL 与 pipeline-record-dao.ts 同构）+ character_tasks 增
 * pipeline_id 列（站任务归属键，'' = 非流水线任务；纯加列 → ALTER ADD，与 v6 同方案）。
 * 写入语义：相位快照不带 pipelineId、stamp 注入件带 → CASE 守卫只进不抹，详见
 * task-record-dao.ts 文件头。
 */
/**
 * v9（@since v3.29，task_053）：characters 增 context_enabled 列（角色级上下文注入开关，
 * INTEGER NOT NULL DEFAULT 1；0 = 该角色对话 / 任务首发不附 <stratix-context> 块）。
 * 纯加列 → ALTER ADD 兜底（与 v6 pipeline_id 同方案，见 migrateGameSaveTables）。
 */
const TARGET_SCHEMA_VERSION = 9;

/** Valid table name characters (alphanumeric + underscore) */
const VALID_TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export interface DatabaseConfig {
  dataDir?: string;
  filename?: string;
}

interface SchemaVersionRow {
  version: number;
}

interface TableInfoRow {
  name: string;
}

interface TableNameRow {
  name: string;
}

function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[Database] ${message}`, ctx || '');
}

export class StratixDatabase {
  private db: Database;
  private dbPath: string;
  private statements = new Map<string, ReturnType<Database['prepare']>>();
  private initPromise: Promise<void> | null = null;

  constructor(config: DatabaseConfig = {}) {
    const dataDir = config.dataDir || DEFAULT_DATA_DIR;
    const filename = config.filename || DEFAULT_FILENAME;

    this.dbPath = path.join(dataDir, `${filename}.sqlite`);
    this.db = new Database(this.dbPath);
    // Initialization is async — callers must call init() or use initializeDatabase()
  }

  /** Async initialization (loads WASM, opens/creates DB file). */
  public async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await fs.ensureDir(path.dirname(this.dbPath));
      await this.db.initialize();
      // Note: sql.js doesn't support WAL mode (it's in-memory + file save)
      // Foreign keys are enforced by default in sql.js
    })();
    return this.initPromise;
  }

  public getDatabase(): Database {
    return this.db;
  }

  public initialize(): void {
    this.createTables();
    this.migrateIfNeeded();
    log('info', `Initialized at: ${this.dbPath}`);
  }

  private migrateIfNeeded(): void {
    // Ensure schema_version table exists first
    this.ensureSchemaVersionTable();

    // Get current schema version
    const currentVersion = this.getSchemaVersion();

    if (currentVersion < TARGET_SCHEMA_VERSION) {
      log('info', `Running migrations from version ${currentVersion} to ${TARGET_SCHEMA_VERSION}`);
      // Wrap migration steps in a transaction for atomicity
      const migration = this.db.transaction(() => {
        this.migrateMissingColumns();
        this.setSchemaVersion(TARGET_SCHEMA_VERSION);
      });
      migration();
      log('info', `Migration complete. Now at version ${TARGET_SCHEMA_VERSION}`);
    }
  }

  private ensureSchemaVersionTable(): void {
    const tables = this.stmtSchemaVersionTables().all() as TableNameRow[];
    if (tables.length === 0) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL
        )
      `);
      // Insert version 0 as baseline
      this.stmtInsertSchemaVersion().run(0, Date.now());
      log('info', 'Created schema_version table');
    }
  }

  private getSchemaVersion(): number {
    const row = this.stmtGetSchemaVersion().get() as SchemaVersionRow | undefined;
    return row?.version ?? 0;
  }

  private setSchemaVersion(version: number): void {
    this.stmtInsertSchemaVersion().run(version, Date.now());
  }

  private migrateMissingColumns(): void {
    this.migrateAgentColumns();
    this.migrateZoneColumns();
    this.migrateZoneContextColumns();
    this.migrateZoneCoordinatorColumns();
    this.migrateNewTables();
    this.migrateGameSaveTables();
    this.migrateCharacterChatMessages();
    this.migrateTasks();
    this.migratePipelines();
    this.migrateSafetyIndexes();
  }

  /**
   * 角色任务表（@since v3.16，task_037）：task-service 随相位快照 upsert（completed 带全文输出）。
   * IF NOT EXISTS 幂等：新库在 createTables 里建过，这里是旧库（schema_version ≤ 3）的升级路径。
   * 表名 character_tasks：v1 的 tasks 表是 agent 平台的任务队列（task_id 主键 / zone 形状），
   * 与角色任务毫无关系 —— character_ 前缀对齐 character_chat_messages 的游戏存档域命名，零冲突。
   * @since v3.23（task_047）追加五态迁移：表已存在但 CHECK 是四态（schema_version = 4 的库）时
   * 重建表（SQLite CHECK 不可 ALTER，方案见文件头 v5 注）。表不存在（≤ 3）直接建五态版。
   */
  private migrateTasks(): void {
    const tables = this.getTableNames();

    if (!tables.has('character_tasks')) {
      // @since v3.25（task_049）：这里建的就是六态形状（CHECK + artifacts + plan），
      // 下面的五态/六态重建与加列兜底对它全部幂等直过。
      // @since v3.27（task_051）：新建表直接带 v8 形状（+pipeline_id）；v7 及更早的库在
      // 方法尾部 ALTER ADD 兑底（重建临时表的 DDL 冻结在 v7 形状，历史迁移不动）。
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS character_tasks (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL,
          prompt TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
          output TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          ended_at INTEGER,
          artifacts TEXT NOT NULL DEFAULT '',
          plan TEXT NOT NULL DEFAULT '',
          pipeline_id TEXT NOT NULL DEFAULT ''
        )
      `);
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_character_tasks_character ON character_tasks(character_id, created_at)');
      log('info', 'Created character_tasks table');
      return;
    }


    // 表已存在：四态 CHECK（schema_version = 4 的库）→ 重建到五态；已是五态（v5 新库）跳过重建。
    // 'cancelled' 只会出现在 CHECK 词表里，作 DDL 指纹足够（与 task-record-dao 同一手法）。
    // why 不在这里 return：下面的 v6 加列对「重建过的 v4 表」和「原生的 v5 表」都要跑
    // （重建产物不带 artifacts 列；v5 表天然也没有）—— 早退会跳过加列。
    const row = this.db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'character_tasks'`)
      .get() as { sql?: string } | undefined;
    const needsRebuild = !(typeof row?.sql === 'string' && row.sql.includes("'cancelled'"));

    if (needsRebuild) {
      this.db.exec(`
      CREATE TABLE character_tasks_v5 (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        output TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER
      );
      INSERT INTO character_tasks_v5
        (id, character_id, prompt, status, output, created_at, started_at, ended_at)
        SELECT id, character_id, prompt, status, output, created_at, started_at, ended_at
        FROM character_tasks;
      DROP TABLE character_tasks;
      ALTER TABLE character_tasks_v5 RENAME TO character_tasks;
      CREATE INDEX IF NOT EXISTS idx_character_tasks_character ON character_tasks(character_id, created_at);
    `);
      log('info', 'Migrated character_tasks status CHECK to five statuses (cancelled)');
    }

    // v6（task_048）：补 artifacts 列（任务成果物 JSON，'' = 无）。纯加列不动 CHECK →
    // ALTER ADD 即可，无需重建；放在五态重建**之后**（重建产物没有该列，重建后统一补齐），
    // 已有该列幂等直过。与 task-record-dao 的 ensureArtifactsColumn 同构（那边是 DAO 自立兑底）。
    const columns = this.db.prepare('PRAGMA table_info(character_tasks)').all() as Array<{ name?: string }>;
    if (!columns.some((column) => column.name === 'artifacts')) {
      this.db.exec("ALTER TABLE character_tasks ADD COLUMN artifacts TEXT NOT NULL DEFAULT ''");
      log('info', 'Added artifacts column to character_tasks (task_048)');
    }

    // v7（task_049）：五态 CHECK → 六态重建（增 awaiting_approval；方案同 v5 —— CHECK 不可
    // ALTER）。**必须在 artifacts 兜底之后**：INSERT SELECT 搬运 artifacts 列，列不在就炸。
    // 'awaiting_approval' 指纹只在 CHECK 词表出现（同 'cancelled' 手法）；已是六态幂等直过。
    // plan 列随重建建表 DDL 就位（老行缺省 ''）；六态表缺 plan 的边角（手改库）ALTER 兜底。
    const row7 = this.db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'character_tasks'`)
      .get() as { sql?: string } | undefined;
    const needsV7Rebuild = !(typeof row7?.sql === 'string' && row7.sql.includes("'awaiting_approval'"));
    if (needsV7Rebuild) {
      this.db.exec(`
      CREATE TABLE character_tasks_v7 (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
        output TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        artifacts TEXT NOT NULL DEFAULT '',
        plan TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO character_tasks_v7
        (id, character_id, prompt, status, output, created_at, started_at, ended_at, artifacts)
        SELECT id, character_id, prompt, status, output, created_at, started_at, ended_at, artifacts
        FROM character_tasks;
      DROP TABLE character_tasks;
      ALTER TABLE character_tasks_v7 RENAME TO character_tasks;
      CREATE INDEX IF NOT EXISTS idx_character_tasks_character ON character_tasks(character_id, created_at);
    `);
      log('info', 'Migrated character_tasks status CHECK to six statuses (awaiting_approval, task_049)');
    }

    const columns7 = this.db.prepare('PRAGMA table_info(character_tasks)').all() as Array<{ name?: string }>;
    if (!columns7.some((column) => column.name === 'plan')) {
      this.db.exec("ALTER TABLE character_tasks ADD COLUMN plan TEXT NOT NULL DEFAULT ''");
      log('info', 'Added plan column to character_tasks (task_049)');
    }

    // v8（task_051）：补 pipeline_id 列（站任务归属键，'' = 非流水线任务）。纯加列不动
    // CHECK → ALTER ADD（同 v6 方案）；对重建产物（v7 形状）与原生 v7 表统一兑底，已有列幂等直过。
    if (!columns7.some((column) => column.name === 'pipeline_id')) {
      this.db.exec("ALTER TABLE character_tasks ADD COLUMN pipeline_id TEXT NOT NULL DEFAULT ''");
      log('info', 'Added pipeline_id column to character_tasks (task_051)');
    }
  }

  /**
   * 流水线表（@since v3.27，task_051）：app 层 pipeline-service 随相位迁移 upsert
   * （发起 running / 每站入列与收尾 / 整线终态）。IF NOT EXISTS 幂等：DAO 自立兑底在
   * pipeline-record-dao.ts 的 ensurePipelinesTable，DDL 两处同构同步改。
   * running 行的存活语义（进程内存里有 driver 才是活的，停机遗骸不复活）见 DAO 文件头。
   */
  private migratePipelines(): void {
    const tables = this.getTableNames();
    if (tables.has('pipelines')) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pipelines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        issue TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
        steps TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        finished_at INTEGER
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_pipelines_created ON pipelines(created_at)');
    log('info', 'Created pipelines table (task_051)');
  }

  /**
   * 角色对话历史表（@since v3.15，task_036）：chat-service 按回合写入（user 即时 / assistant 收束 / error）。
   * IF NOT EXISTS 幂等：新库在 createTables 里建过，这里是旧库（schema_version ≤ 2）的升级路径。
   */
  private migrateCharacterChatMessages(): void {
    const tables = this.getTableNames();

    if (!tables.has('character_chat_messages')) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS character_chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'error')),
          content TEXT NOT NULL,
          session_ref TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_character_chat_messages_character ON character_chat_messages(character_id, id)');
      log('info', 'Created character_chat_messages table');
    }
  }

  /**
   * 游戏存档表（@since v3.12，task_033）：角色档案 + 单位站位。
   * IF NOT EXISTS 幂等：新库在 createTables 里建过，这里是旧库（schema_version 1）的升级路径。
   */
  private migrateGameSaveTables(): void {
    const tables = this.getTableNames();

    if (!tables.has('characters')) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS characters (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          kind TEXT,
          persona TEXT NOT NULL DEFAULT '',
          level INTEGER NOT NULL DEFAULT 1,
          exp INTEGER NOT NULL DEFAULT 0,
          appearance TEXT,
          body_type TEXT,
          skin_id TEXT,
          external_session_id TEXT,
          context_enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_characters_kind ON characters(kind)');
      log('info', 'Created characters table');
    }

    // v9（task_053）：老 characters 表（v8 及以前）补 context_enabled —— ALTER ADD 带
    // DEFAULT 1：存量行一律归「开」（缺省即开的开关语义，与 CharacterView.contextEnabled
    // 缺省 true 的归一口径一致，不在迁移里猜旧档案的偏好）。
    const characterColumns = this.getColumnNames('characters');
    if (!characterColumns.has('context_enabled')) {
      this.db.exec('ALTER TABLE characters ADD COLUMN context_enabled INTEGER NOT NULL DEFAULT 1');
      log('info', 'Added context_enabled column to characters table');
    }

    if (!tables.has('unit_positions')) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS unit_positions (
          character_id TEXT PRIMARY KEY,
          x REAL NOT NULL,
          y REAL NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      log('info', 'Created unit_positions table');
    }
  }

  private migrateAgentColumns(): void {
    const columns = this.getColumnNames('agents');
    if (!columns.has('openclaw_config')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN openclaw_config TEXT');
      log('info', 'Added openclaw_config column to agents table');
    }
    if (!columns.has('stratix_config')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN stratix_config TEXT');
      log('info', 'Added stratix_config column to agents table');
    }
  }

  private migrateZoneColumns(): void {
    const columns = this.getColumnNames('zones');
    if (!columns.has('zone_context_id')) {
      this.db.exec('ALTER TABLE zones ADD COLUMN zone_context_id TEXT REFERENCES zone_contexts(zone_id)');
      log('info', 'Added zone_context_id column to zones table');
    }
    if (!columns.has('description')) {
      this.db.exec("ALTER TABLE zones ADD COLUMN description TEXT DEFAULT ''");
      log('info', 'Added description column to zones table');
    }
    if (!columns.has('priority')) {
      this.db.exec('ALTER TABLE zones ADD COLUMN priority INTEGER DEFAULT 3');
      log('info', 'Added priority column to zones table');
    }
    if (!columns.has('path')) {
      this.db.exec("ALTER TABLE zones ADD COLUMN path TEXT DEFAULT ''");
      log('info', 'Added path column to zones table');
    }
    if (!columns.has('present_agent_ids')) {
      this.db.exec("ALTER TABLE zones ADD COLUMN present_agent_ids TEXT DEFAULT '[]'");
      log('info', 'Added present_agent_ids column to zones table');
    }
    if (!columns.has('started_at')) {
      this.db.exec('ALTER TABLE zones ADD COLUMN started_at INTEGER');
      log('info', 'Added started_at column to zones table');
    }
    if (!columns.has('completed_at')) {
      this.db.exec('ALTER TABLE zones ADD COLUMN completed_at INTEGER');
      log('info', 'Added completed_at column to zones table');
    }
  }

  private migrateZoneContextColumns(): void {
    const columns = this.getColumnNames('zone_contexts');
    if (!columns.has('deleted_at')) {
      this.db.exec('ALTER TABLE zone_contexts ADD COLUMN deleted_at INTEGER');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_zone_contexts_deleted_at ON zone_contexts(deleted_at)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_zone_contexts_project_deleted ON zone_contexts(project_id, deleted_at)');
      log('info', 'Added deleted_at column to zone_contexts table');
    }
    if (!columns.has('task_policy')) {
      this.db.exec("ALTER TABLE zone_contexts ADD COLUMN task_policy TEXT DEFAULT 'creator'");
      log('info', 'Added task_policy column to zone_contexts table');
    }
    if (!columns.has('task_creator_id')) {
      this.db.exec('ALTER TABLE zone_contexts ADD COLUMN task_creator_id TEXT');
      log('info', 'Added task_creator_id column to zone_contexts table');
    }
  }

  private migrateZoneCoordinatorColumns(): void {
    const columns = this.getColumnNames('zone_coordinators');
    if (!columns.has('api_key')) {
      this.db.exec('ALTER TABLE zone_coordinators ADD COLUMN api_key TEXT');
      log('info', 'Added api_key column to zone_coordinators table');
    }
    if (!columns.has('base_url')) {
      this.db.exec('ALTER TABLE zone_coordinators ADD COLUMN base_url TEXT');
      log('info', 'Added base_url column to zone_coordinators table');
    }
    if (!columns.has('cycle_config')) {
      this.db.exec('ALTER TABLE zone_coordinators ADD COLUMN cycle_config TEXT');
      log('info', 'Added cycle_config column to zone_coordinators table');
    }
  }

  private migrateNewTables(): void {
    const tables = this.getTableNames();

    if (!tables.has('zone_tasks')) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS zone_tasks (
          task_id TEXT PRIMARY KEY,
          zone_id TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done')),
          assignee TEXT,
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (zone_id) REFERENCES zones(zone_id) ON DELETE CASCADE
        )
      `);
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_zone_tasks_zone_id ON zone_tasks(zone_id)');
      log('info', 'Created zone_tasks table');
    }

    if (!tables.has('zone_messages')) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS zone_messages (
          message_id TEXT PRIMARY KEY,
          zone_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'agent')),
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (zone_id) REFERENCES zone_contexts(zone_id) ON DELETE CASCADE
        )
      `);
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_zone_messages_zone_id ON zone_messages(zone_id)');
      log('info', 'Created zone_messages table');
    }
  }

  private migrateSafetyIndexes(): void {
    this.createIndexSafely('idx_shared_skill_installs_agent', 'CREATE INDEX IF NOT EXISTS idx_shared_skill_installs_agent ON shared_skill_installs(agent_id)');
    this.createIndexSafely('idx_agent_learned_skills_agent', 'CREATE INDEX IF NOT EXISTS idx_agent_learned_skills_agent ON agent_learned_skills(agent_id)');
    this.createIndexSafely('idx_zone_contexts_simple_zone_id', 'CREATE INDEX IF NOT EXISTS idx_zone_contexts_simple_zone_id ON zone_contexts_simple(zone_id)');
    this.createIndexSafely('idx_agent_zone_bindings_agent', 'CREATE INDEX IF NOT EXISTS idx_agent_zone_bindings_agent ON agent_zone_bindings(agent_id)');
    this.createIndexSafely('idx_agent_zone_bindings_zone', 'CREATE INDEX IF NOT EXISTS idx_agent_zone_bindings_zone ON agent_zone_bindings(zone_id)');
    this.createIndexSafely('idx_zone_members_zone_id', 'CREATE INDEX IF NOT EXISTS idx_zone_members_zone_id ON zone_members(zone_id)');
    this.createIndexSafely('idx_zone_members_agent', 'CREATE INDEX IF NOT EXISTS idx_zone_members_agent ON zone_members(agent_id)');
  }

  /**
   * Get column names for a table.
   * Validates table name to prevent SQL injection (PRAGMA does not support parameter binding).
   */
  private getColumnNames(tableName: string): Set<string> {
    if (!VALID_TABLE_NAME_RE.test(tableName)) {
      throw new Error(`Invalid table name: ${tableName}`);
    }
    const rows = this.stmtTableInfo(tableName).all() as TableInfoRow[];
    return new Set(rows.map(c => c.name));
  }

  private getTableNames(): Set<string> {
    const rows = this.stmtTableNames().all() as TableNameRow[];
    return new Set(rows.map(t => t.name));
  }

  private createIndexSafely(indexName: string, sql: string): void {
    try {
      this.db.exec(sql);
    } catch (e) {
      log('warn', `Failed to create index ${indexName}`, { error: String(e) });
    }
  }

  private createTables(): void {
    const sql = `
      -- Agents表
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'custom',
        profile TEXT,
        soul TEXT,
        rules TEXT,
        backend_type TEXT DEFAULT 'direct',
        config_status TEXT DEFAULT 'draft',
        position TEXT,
        memory TEXT,
        openclaw_config TEXT,
        stratix_config TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 添加新列（如果表中已存在则忽略）
      -- ALTER TABLE agents ADD COLUMN openclaw_config TEXT;
      -- ALTER TABLE agents ADD COLUMN stratix_config TEXT;

      -- Templates表
      CREATE TABLE IF NOT EXISTS templates (
        template_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('preset', 'custom')),
        profile TEXT,
        soul TEXT,
        rules TEXT,
        backend_type TEXT DEFAULT 'direct',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Command Logs表
      CREATE TABLE IF NOT EXISTS command_logs (
        log_id TEXT PRIMARY KEY,
        command_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        params TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        error TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        created_at INTEGER NOT NULL DEFAULT 0
      );

      -- Projects表
      CREATE TABLE IF NOT EXISTS projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        priority INTEGER DEFAULT 3,
        status TEXT DEFAULT 'pending',
        config TEXT,
        path TEXT,
        present_agent_ids TEXT DEFAULT '[]',
        zone_config TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );

      -- Channels表
      CREATE TABLE IF NOT EXISTS channels (
        channel_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        subscriber_ids TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
      );

      -- Messages表
      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        sender TEXT NOT NULL,
        mentions TEXT DEFAULT '[]',
        raw_content TEXT,
        message_type TEXT DEFAULT 'chat',
        task_id TEXT,
        session_key TEXT,
        run_id TEXT,
        metadata TEXT,
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
        FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE
      );

      -- OpenClaw Connections表
      CREATE TABLE IF NOT EXISTS openclaw_connections (
        connection_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        method TEXT NOT NULL,
        endpoint TEXT,
        shared_token TEXT,
        device_token TEXT,
        device_id TEXT,
        status TEXT DEFAULT 'disconnected',
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      );

      -- Gateway Identity表
      CREATE TABLE IF NOT EXISTS gateway_identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        identity_id TEXT,
        device_name TEXT,
        tailscale_enabled INTEGER DEFAULT 0,
        tailscale_ip TEXT,
        config TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );

      -- Agent Chat Messages表
      CREATE TABLE IF NOT EXISTS agent_chat_messages (
        message_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(type);
      CREATE INDEX IF NOT EXISTS idx_command_logs_agent_id ON command_logs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_command_logs_status ON command_logs(status);
      CREATE INDEX IF NOT EXISTS idx_channels_project_id ON channels(project_id);
      CREATE INDEX IF NOT EXISTS idx_messages_project_id ON messages(project_id);
      CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_agent_chat_agent_id ON agent_chat_messages(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_chat_timestamp ON agent_chat_messages(agent_id, timestamp DESC);

      -- ============================================
      -- ORCHESTRATION TABLES (Multi-Agent System)
      -- ============================================

      -- Zones表: Backend zone state (mirrors Phaser zones)
      CREATE TABLE IF NOT EXISTS zones (
        zone_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('task', 'project', 'general')),
        project_id TEXT,
        position_x INTEGER NOT NULL,
        position_y INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        status TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'active', 'busy', 'completed', 'error')),
        config TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Agent Zone Members表: Which agents are in which zones
      CREATE TABLE IF NOT EXISTS agent_zone_members (
        agent_id TEXT NOT NULL,
        zone_id TEXT NOT NULL,
        entered_at INTEGER NOT NULL,
        role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'member', 'observer')),
        PRIMARY KEY (agent_id, zone_id),
        FOREIGN KEY (zone_id) REFERENCES zones(zone_id) ON DELETE CASCADE
      );

      -- Zone Members表: Enhanced zone membership with roles and timestamps
      CREATE TABLE IF NOT EXISTS zone_members (
        id TEXT PRIMARY KEY,
        zone_id TEXT NOT NULL REFERENCES zones(zone_id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        role TEXT DEFAULT 'executor' CHECK (role IN ('coordinator', 'executor')),
        entered_at INTEGER NOT NULL,
        left_at INTEGER,
        UNIQUE(zone_id, agent_id)
      );

      -- Zone Coordinators表: Coordinator configuration per zone
      CREATE TABLE IF NOT EXISTS zone_coordinators (
        zone_id TEXT PRIMARY KEY REFERENCES zones(zone_id) ON DELETE CASCADE,
        llm_provider TEXT DEFAULT 'openai',
        model TEXT,
        auto_decompose INTEGER DEFAULT 1,
        auto_assign INTEGER DEFAULT 1,
        require_user_confirm INTEGER DEFAULT 0,
        assign_strategy TEXT DEFAULT 'capability_match' CHECK (assign_strategy IN ('random', 'capability_match', 'load_balance', 'priority')),
        entry_condition TEXT,
        api_key TEXT,
        base_url TEXT,
        cycle_config TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Tasks表: Unified task queue with priority
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        zone_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL CHECK (type IN ('coding', 'writing', 'analysis', 'research', 'general')),
        priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'failed', 'cancelled')),
        assigned_agent_id TEXT,
        dependencies TEXT DEFAULT '[]',
        context TEXT,
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        assigned_at INTEGER,
        started_at INTEGER,
        completed_at INTEGER,
        FOREIGN KEY (zone_id) REFERENCES zones(zone_id) ON DELETE CASCADE
      );

      -- Agent Messages表: Agent-to-Agent messages (separate from agent_chat_messages)
      CREATE TABLE IF NOT EXISTS agent_messages (
        message_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        content TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK (message_type IN ('direct', 'broadcast', 'mention', 'task_request', 'context_share')),
        refs TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL
      );

      -- Conversation Policies表: Agent communication constraints
      CREATE TABLE IF NOT EXISTS conversation_policies (
        policy_id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('global', 'zone', 'agent')),
        scope_id TEXT,
        allow_dm INTEGER DEFAULT 1,
        allow_broadcast INTEGER DEFAULT 1,
        allowed_participants TEXT,
        share_memory INTEGER DEFAULT 0,
        share_context INTEGER DEFAULT 1,
        share_files INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Context Archives表: Compressed past context for agents
      CREATE TABLE IF NOT EXISTS context_archives (
        archive_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        zone_id TEXT,
        archive_type TEXT NOT NULL CHECK (archive_type IN ('session_summary', 'compressed_messages', 'key_event')),
        content TEXT NOT NULL,
        key_decisions TEXT DEFAULT '[]',
        outstanding_tasks TEXT DEFAULT '[]',
        relevance_score REAL,
        archived_at INTEGER NOT NULL,
        expires_at INTEGER
      );

      -- Agent Backgrounds表: Persistent state for background agents
      CREATE TABLE IF NOT EXISTS agent_backgrounds (
        agent_id TEXT PRIMARY KEY,
        status TEXT DEFAULT 'stopped' CHECK (status IN ('stopped', 'running', 'paused', 'error')),
        current_zone_id TEXT,
        current_task_id TEXT,
        last_heartbeat_at INTEGER,
        last_checkpoint_at INTEGER,
        checkpoint_data TEXT,
        error_log TEXT,
        started_at INTEGER,
        stopped_at INTEGER
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_zones_project_id ON zones(project_id);
      CREATE INDEX IF NOT EXISTS idx_zones_status ON zones(status);
      CREATE INDEX IF NOT EXISTS idx_agent_zone_members_agent ON agent_zone_members(agent_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_zone_id ON tasks(zone_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON agent_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_agent_messages_sender ON agent_messages(sender_id);
      CREATE INDEX IF NOT EXISTS idx_context_archives_agent ON context_archives(agent_id);
      CREATE INDEX IF NOT EXISTS idx_context_archives_expires ON context_archives(agent_id, expires_at);

      -- ============================================
      -- ZONE CONTEXT TABLES (Zone as Dynamic Context Container)
      -- ============================================

      -- Zone Contexts表: Zone context container with title, prompt, and members
      -- This stores the collaborative Zone concept (title + prompt + context files)
      -- Separate from the ORCHESTRATION zones table which tracks Phaser zone positions
      CREATE TABLE IF NOT EXISTS zone_contexts (
        zone_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT,
        members TEXT DEFAULT '[]',
        task_policy TEXT DEFAULT 'creator',
        task_creator_id TEXT,
        deleted_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
      );

      -- Zone Files表: Files associated with a Zone
      CREATE TABLE IF NOT EXISTS zone_files (
        file_id TEXT PRIMARY KEY,
        zone_id TEXT NOT NULL,
        name TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('local', 'url')),
        source TEXT NOT NULL,
        content TEXT,
        file_type TEXT,
        last_fetched INTEGER,
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (zone_id) REFERENCES zone_contexts(zone_id) ON DELETE CASCADE
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_zone_contexts_project_id ON zone_contexts(project_id);
      CREATE INDEX IF NOT EXISTS idx_zone_files_zone_id ON zone_files(zone_id);

      -- ============================================
      -- AGENT CAREER SYSTEM TABLES (SkillHub + 技能养成)
      -- ============================================

      -- 共享技能库 (SkillHub)
      CREATE TABLE IF NOT EXISTS shared_skills (
        skill_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        icon TEXT,
        mcp_tool TEXT,
        endpoint TEXT,
        provider TEXT DEFAULT 'builtin',
        created_at INTEGER,
        updated_at INTEGER
      );

      -- 技能安装关联表（替代 installedAgents 数组）
      -- 表示某个技能已被安装到某个 Agent
      CREATE TABLE IF NOT EXISTS shared_skill_installs (
        skill_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        installed_at INTEGER NOT NULL,
        installed_by TEXT NOT NULL,
        PRIMARY KEY (skill_id, agent_id),
        FOREIGN KEY (skill_id) REFERENCES shared_skills(skill_id) ON DELETE CASCADE
      );

      -- Agent 学会的技能（含养成字段）
      -- 与 shared_skill_installs 不同，learned_skill 表示 Agent 通过工作真正掌握的技能
      CREATE TABLE IF NOT EXISTS agent_learned_skills (
        skill_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        level INTEGER DEFAULT 1,
        experience_points INTEGER DEFAULT 0,
        proficiency INTEGER DEFAULT 0,
        certified INTEGER DEFAULT 0,
        learned_from TEXT,
        learned_at INTEGER NOT NULL,
        last_practiced_at INTEGER,
        PRIMARY KEY (skill_id, agent_id)
      );

      -- Zone 上下文（简化版，用于上下文注入）
      CREATE TABLE IF NOT EXISTS zone_contexts_simple (
        zone_id TEXT PRIMARY KEY,
        context_json TEXT,
        updated_at INTEGER
      );

      -- Agent-Zone 关联（简化版，用于上下文绑定）
      CREATE TABLE IF NOT EXISTS agent_zone_bindings (
        agent_id TEXT NOT NULL,
        zone_id TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (agent_id, zone_id)
      );

      -- Agent Capabilities表: Agent能力等级和负载
      CREATE TABLE IF NOT EXISTS agent_capabilities (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        zone_id TEXT NOT NULL REFERENCES zones(zone_id) ON DELETE CASCADE,
        capability TEXT NOT NULL CHECK (capability IN ('coding', 'writing', 'analysis', 'research', 'general')),
        level INTEGER DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
        current_load INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL,
        UNIQUE(agent_id, zone_id, capability)
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_shared_skill_installs_agent ON shared_skill_installs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_learned_skills_agent ON agent_learned_skills(agent_id);
      CREATE INDEX IF NOT EXISTS idx_zone_contexts_simple_zone_id ON zone_contexts_simple(zone_id);
      CREATE INDEX IF NOT EXISTS idx_agent_zone_bindings_agent ON agent_zone_bindings(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_zone_bindings_zone ON agent_zone_bindings(zone_id);
      CREATE INDEX IF NOT EXISTS idx_agent_capabilities_zone ON agent_capabilities(zone_id);
      CREATE INDEX IF NOT EXISTS idx_agent_capabilities_capability ON agent_capabilities(capability);
      CREATE INDEX IF NOT EXISTS idx_agent_capabilities_agent_zone ON agent_capabilities(agent_id, zone_id);

      -- ============================================
      -- TASK FLOW TABLES (Zone Agent Orchestration)
      -- ============================================

      -- Task Flow表: 任务在 Agent 间的流转记录
      CREATE TABLE IF NOT EXISTS task_flow (
        flow_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        zone_id TEXT NOT NULL,
        from_agent_id TEXT,
        to_agent_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('created', 'delegated', 'claimed', 'started', 'completed', 'failed', 'cancelled')),
        metadata TEXT,
        created_at INTEGER NOT NULL
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_flow_task ON task_flow(task_id);
      CREATE INDEX IF NOT EXISTS idx_flow_zone ON task_flow(zone_id);
      CREATE INDEX IF NOT EXISTS idx_flow_agent ON task_flow(to_agent_id);

      -- ============================================
      -- ZONE AUDIT LOG TABLE (Zone Agent Orchestration)
      -- ============================================

      -- Zone Audit Log表: 审计日志，记录 Zone 内所有操作
      CREATE TABLE IF NOT EXISTS zone_audit_log (
        id TEXT PRIMARY KEY,
        zone_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor_id TEXT,
        target_id TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_audit_zone ON zone_audit_log(zone_id);
      CREATE INDEX IF NOT EXISTS idx_audit_actor ON zone_audit_log(actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_type ON zone_audit_log(event_type);
      CREATE INDEX IF NOT EXISTS idx_audit_time ON zone_audit_log(created_at);

      -- ============================================
      -- GAME SAVE TABLES（@since v3.12，task_033）
      -- DDL 与 src/app/services/persistence/game-save-dao.ts 的 ensureGameSaveTables 同构。
      -- ============================================

      -- 角色档案表：core WorldState.characters 的落库形态（appearance 存 JSON）；
      -- @since v3.29 context_enabled = 角色级上下文注入开关（task_053，缺省开）
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT,
        persona TEXT NOT NULL DEFAULT '',
        level INTEGER NOT NULL DEFAULT 1,
        exp INTEGER NOT NULL DEFAULT 0,
        appearance TEXT,
        body_type TEXT,
        skin_id TEXT,
        external_session_id TEXT,
        context_enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 单位站位表：characterId → 战场世界坐标（app 层防抖批量写入）
      CREATE TABLE IF NOT EXISTS unit_positions (
        character_id TEXT PRIMARY KEY,
        x REAL NOT NULL,
        y REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 角色对话历史表（@since v3.15，task_036）：role ∈ user|assistant|error；
      -- session_ref 是会话 id 的落库回执（审计用，恢复口径见 chat-service 文件头：重启首发重建）
      CREATE TABLE IF NOT EXISTS character_chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'error')),
        content TEXT NOT NULL,
        session_ref TEXT,
        created_at INTEGER NOT NULL
      );

      -- 角色任务表（@since v3.16，task_037；@since v3.23 task_047 status 扩五态；
      -- @since v3.25 task_049 status 扩六态 + plan 列）：
      -- 派发 → 执行 → 产出的审计与全文输出；cancelled = 排队取消（没跑过，output 为占位文案）；
      -- awaiting_approval = 计划挂起等裁决（task_049，output 为计划全文、plan 列同存）。
      -- 不叫 tasks：tasks 表是 agent 平台的任务队列（v1 起），character_ 前缀 = 游戏存档域命名先例
      CREATE TABLE IF NOT EXISTS character_tasks (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
        output TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        -- 任务成果物（@since v3.24，task_048）：parseTaskArtifacts 的 JSON（files+summary），'' = 无
        artifacts TEXT NOT NULL DEFAULT '',
        -- 计划草稿全文（@since v3.25，task_049）：审批门挂起时已剥离标记行的计划，'' = 无
        plan TEXT NOT NULL DEFAULT ''
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_characters_kind ON characters(kind);
      CREATE INDEX IF NOT EXISTS idx_character_chat_messages_character ON character_chat_messages(character_id, id);
      CREATE INDEX IF NOT EXISTS idx_character_tasks_character ON character_tasks(character_id, created_at);
    `;
    this.db.exec(sql);
  }

  // ---- Cached prepared statements ----

  private stmtSchemaVersionTables(): ReturnType<Database["prepare"]> {
    return this.getStmt("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'");
  }

  private stmtInsertSchemaVersion(): ReturnType<Database["prepare"]> {
    return this.getStmt('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)');
  }

  private stmtGetSchemaVersion(): ReturnType<Database["prepare"]> {
    return this.getStmt('SELECT MAX(version) as version FROM schema_version');
  }

  private stmtTableInfo(tableName: string): ReturnType<Database["prepare"]> {
    // PRAGMA does not support parameter binding; tableName is validated before call.
    return this.db.prepare(`PRAGMA table_info(${tableName})`);
  }

  private stmtTableNames(): ReturnType<Database["prepare"]> {
    return this.getStmt("SELECT name FROM sqlite_master WHERE type='table'");
  }

  private getStmt(sql: string): ReturnType<Database["prepare"]> {
    let stmt = this.statements.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  public close(): void {
    this.statements.clear();
    this.db.close();
  }

  public getPath(): string {
    return this.dbPath;
  }

  public isHealthy(): boolean {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      /* expected: database not accessible */
      return false;
    }
  }

  public getStatus(): { path: string; healthy: boolean; schemaVersion: number } {
    return {
      path: this.dbPath,
      healthy: this.isHealthy(),
      schemaVersion: this.getSchemaVersion()
    };
  }
}

let databaseInstance: StratixDatabase | null = null;

export async function initializeDatabase(config?: DatabaseConfig): Promise<StratixDatabase> {
  if (!databaseInstance) {
    databaseInstance = new StratixDatabase(config);
    await databaseInstance.init();
    databaseInstance.initialize();
  }
  return databaseInstance;
}

export function getDatabase(): StratixDatabase {
  if (!databaseInstance) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return databaseInstance;
}

export function destroyDatabase(): void {
  if (databaseInstance) {
    databaseInstance.close();
    databaseInstance = null;
  }
}

export default StratixDatabase;
