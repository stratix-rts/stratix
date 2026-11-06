import path from 'path';

import * as fs from 'fs-extra';

import { Database } from './sqlite-adapter';

const DEFAULT_DATA_DIR = 'stratix-data';
const DEFAULT_FILENAME = 'stratix.db';
/**
 * v2（@since v3.12，task_033）：新增 characters + unit_positions（游戏存档表，角色档案与单位站位）。
 * DDL 与 src/app/services/persistence/game-save-dao.ts 的 ensureGameSaveTables 同构 —— 改一处必须同步另一处。
 * v3（@since v3.15，task_036）：新增 character_chat_messages（角色对话历史；task_073 扩 system 事件角色）。
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
/**
 * v10（@since v3.30，task_054）：新增 agent_health_events 表（agent 健康事件审计流：
 * offline / online / unhealthy 三态词表 + (kind, created_at) 索引；DDL 与
 * agent-health-dao.ts 同构）。why 独立表而非 characters 加列：健康是时间序事件流，
 * 列只能存「最后一次」，崩溃历史会被覆盖 —— 见 DAO 文件头。
 */
/**
 * v11（@since v3.32，task_056）：新增 custom_agents 表（自定义 agent 注册表：id/name/
 * probe_cmd/run_cmd_template/output_parser('plain'|'json')/created_at；DDL 与
 * app/services/persistence/custom-agent-dao.ts 同构同步改）。非内置 CLI 手动注册成
 * 战场单位的唯一真相源：id 拼进 kind（`custom:<id>`）对外广播，命令串入库前已过
 * core/custom-agent.ts 的白名单校验（注入面在纯校验层封死，见该文件头安全边界注）。
 */
/**
 * v12（@since v3.36，task_061）：新增 exp_events 表（角色经验事件审计流：exp.gained 逐条
 * 落库 + level_up 里程碑行；DDL 与 app/services/persistence/exp-event-dao.ts 同构）。
 * why 独立表：exp 变更此前无历史表（characters 只有当前快照），成长曲线 / 活动热力 /
 * 履历时间线需要时间序真相源 —— 见 DAO 文件头。
 */
/**
 * v13（@since v3.43，task_092）：新增 sessions + session_events 两张表（会话域存储）。
 * sessions = 会话**摘要快照**（id/kind/title/participants JSON/status/ref_id/created_at/
 * last_event_at/closed_at/event_count；id 主键；kind+status 索引 + created_at 索引）；
 * session_events = 会话**事件流**（session_id/seq/type/payload JSON/created_at；
 * 主键 (session_id, seq)；created_at 索引）。
 * DDL 与 src/app/services/persistence/session-dao.ts / session-event-dao.ts 的 ensure* 同构。
 * why 两张表：摘要可 upsert（状态一直在动），事件只 append（历史即证据）—— 写语义不同，不能挤一张表。
 * why 只加不删：新表不影响既有表结构，老库数据零迁移（与 v11 / v12 同方案）。
 */
/**
 * v14（@since v3.3，task_198）：六张表各加一列 `instance_id`（**nullable、无 DEFAULT**）——
 * characters / character_tasks / sessions / session_events / exp_events / unit_positions。
 * 权威依据：docs/DESIGN-project-map.md §1.3.2 **步 N1**（加列）+ **步 N2**（旧行 instance_id
 *   = NULL 语义 = 默认沙盒实例 DEFAULT_INSTANCE_ID = 'wsp_sandbox'；查询按
 *   `COALESCE(instance_id, 'wsp_sandbox')` 命中；**落库不改写**旧行）。
 * why 是「加法」而不是「迁移」：`ALTER TABLE ADD COLUMN` 只写**表结构**不写**数据** ⇒
 *   存量行的 instance_id 仍是 NULL（= 默认沙盒），**旧行逐字节原样**（步 N2 的硬约束）。
 * why 加列排在所有重建迁移**之后**（migrateMissingColumns 顺序）：character_tasks 的
 *   CHECK 重建会丢掉不在临时表 DDL 里的列 ⇒ 重建跑完再统一加列，列序与新库一致。
 * DDL 与 app/services/persistence/*-dao.ts 的 ensure* 同构同步改（铁律同上）。
 */
/**
 * v15（@since v3.3，task_199）：**N4a** —— `characters` 加 `role_id` 列（= roster 角色 id）
 *   + 复合唯一索引 `(role_id, instance_id)`；**N4c** —— 新增 `character_id_map` 表
 *   （old_id / new_id / instance_id / created_at；主键 `(old_id, instance_id)` + new_id 索引）。
 * 权威依据：docs/DESIGN-project-map.md §1.3.2 **步 N4a**（加列 + 复合唯一索引）
 *   + **步 N4c**（映射表与数据**同库、同事务** —— N4b 唯一的回滚凭据）。
 * why 加法优先：N4a 是纯加列 + 加索引（旧行 role_id 落 NULL = **未回填**，可延后填），
 *   N4c 是纯新表 ⇒ 两步都**不碰存量数据**，回滚只需删索引 / 删表（见 §1.3.2 回滚矩阵）。
 * why role_id 不可解析 id 字符串代替：N4b 之后 `characters.id` 有两种格式并存
 *   （沙盒行 = 历史 id，其它 = `<roleId>_<instanceId>`）⇒ 身份判定只能靠 role_id 列。
 * DDL 与 app/services/persistence/game-save-dao.ts / character-id-map-dao.ts 的 ensure* 同构同步改。
 */
/**
 * v16（@since v3.3，task_200）：**N4b-1** —— 新增 `session_external_refs` 表
 *   （external_session_id / instance_id / character_id / session_id / created_at；
 *   主键 `(external_session_id, instance_id)` + (character_id, instance_id) 索引）。
 * 权威依据：docs/DESIGN-project-map.md §1.3.2「`externalSessionId` 的处置（R1-40）」
 *   + §3.4 **R3**（chat / 互聊会话不得跨副本续发）。
 * why 加法优先：N4b-1 是**纯新表** ⇒ 不碰存量数据，回滚只需删表（见 §1.3.2 回滚矩阵）。
 * why 联合键是 R3 的判据：切副本后 B 副本查 `(extId, B)` 查不到 ⇒ resume 不可能
 *   ⇒ id 重写与副本归属彻底解耦（`characters.externalSessionId` 列退化为只读兼容镜像）。
 * DDL 与 app/services/persistence/session-external-ref-dao.ts 的 ensure* 同构同步改。
 */
const TARGET_SCHEMA_VERSION = 16;

/**
 * 六张带副本维度的表（design §1.3.2 步 N1 的表清单）。
 * ⚠️ 与 app/services/persistence/instance-scope.ts 的同名常量**内容必须一致**：
 *   两层各持一份是既有 DDL 纪律的延续（stratix-database 是驱动层，不反向依赖 app 层）。
 */
const INSTANCE_SCOPED_TABLES = [
  'characters',
  'character_tasks',
  'sessions',
  'session_events',
  'exp_events',
  'unit_positions',
] as const;

/** instance_id 列名（六表统一；改一处必须同步六张表的建表 DDL 与两处迁移链）。 */
const INSTANCE_ID_COLUMN = 'instance_id';

/**
 * role_id 列名（characters 表，design §1.3.2 步 N4a）。
 *
 * 语义：= `.stratix/roster/<role-id>.json` 的角色 id（契约面，M0 的 project-context 已有读取链）
 *   ⇒ 「这个角色行是 roster 里哪个角色」。**与 characters.id 是两回事**：
 *   id 是运行层的行标识（N4b 之后 instance 内唯一），role_id 是契约面的身份。
 * 旧行 role_id = NULL = **未回填**（可延后填，见步 N4a 的加法语义）。
 */
const ROLE_ID_COLUMN = 'role_id';

/** character_id_map 表名（design §1.3.2 步 N4c：N4b 唯一的回滚凭据）。 */
const CHARACTER_ID_MAP_TABLE = 'character_id_map';

/**
 * session_external_refs 表名（design §1.3.2 步 N4b-1：外部会话引用独立成表）。
 *
 * 语义：`externalSessionId`（CLI 侧 resume 凭据）**独立于角色行**存放；
 *   主键 `(external_session_id, instance_id)` = §3.4 R3 的判据（联合匹配）。
 */
const SESSION_EXTERNAL_REFS_TABLE = 'session_external_refs';

/** 联合键反查索引名（session_external_refs(character_id, instance_id)）。 */
const SESSION_EXTERNAL_REFS_CHARACTER_INDEX = 'idx_session_external_refs_character';

/** 复合唯一索引名（characters(role_id, instance_id)）。 */
const CHARACTERS_ROLE_INSTANCE_INDEX = 'idx_characters_role_instance';

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
    const migrateChatRoles = this.db.transaction(() => this.migrateCharacterChatMessages());
    migrateChatRoles();
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
    this.migrateAgentHealthEvents();
    this.migrateCustomAgents();
    this.migrateExpEvents();
    this.migrateSessions();
    this.migrateSafetyIndexes();
    // v14（task_198）：六表加 instance_id 列。**排在所有重建迁移之后** ——
    // character_tasks 的 CHECK 重建只搬临时表 DDL 里的列，最后统一加列 ⇒ 不会丢。
    this.migrateInstanceIdColumns();
    // v15（task_199）：N4a（characters 加 role_id 列 + 复合唯一索引）+ N4c（character_id_map 表）。
    // 排在 instance_id 之后：唯一索引 (role_id, instance_id) 依赖两列都存在。
    this.migrateRoleIdAndIdMap();
    // v16（task_200）：N4b-1（session_external_refs 表：外部会话引用独立成表，联合键 = R3 判据）。
    // 纯新表 ⇒ 不依赖任何列，排在最后即可。
    this.migrateSessionExternalRefs();
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
      // @since v3.3（task_198）：instance_id 是**唯一**例外 —— 两次重建都把它搬过去
      //   （它带数据：副本归属），否则重建一次就把归属抹平一次。
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
          pipeline_id TEXT NOT NULL DEFAULT '',
          mission_id TEXT,
          -- 副本归属（task_198，步 N1）：可空、无 DEFAULT ⇒ 旧行 = NULL = 默认沙盒
          instance_id TEXT
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
    //
    // v14（task_198）：instance_id **在重建之前**先补上 ——
    //   重建的 INSERT SELECT 只搬临时表 DDL 里有的列，而 instance_id **带数据**
    //   （这行属于哪个副本）⇒ 不搬就是静默抹平副本归属（与 artifacts 的「无数据可丢」不同）。
    if (!this.getColumnNames('character_tasks').has(INSTANCE_ID_COLUMN)) {
      this.db.exec(`ALTER TABLE character_tasks ADD COLUMN ${INSTANCE_ID_COLUMN} TEXT`);
      log('info', 'Added instance_id column to character_tasks (task_198)');
    }

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
        ended_at INTEGER,
        instance_id TEXT
      );
      INSERT INTO character_tasks_v5
        (id, character_id, prompt, status, output, created_at, started_at, ended_at, instance_id)
        SELECT id, character_id, prompt, status, output, created_at, started_at, ended_at, instance_id
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
    // ⚠️ instance_id 一并搬（task_198）：该列带数据（副本归属），重建丢它 = 归属被静默抹平。
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
        plan TEXT NOT NULL DEFAULT '',
        instance_id TEXT
      );
      INSERT INTO character_tasks_v7
        (id, character_id, prompt, status, output, created_at, started_at, ended_at, artifacts, instance_id)
        SELECT id, character_id, prompt, status, output, created_at, started_at, ended_at, artifacts, instance_id
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

    // task_076：可空 mission_id 关联键；与 DAO 的 ensureMissionIdColumn 同构（旧库主要由 DAO 读写前补列）。
    if (!columns7.some((column) => column.name === 'mission_id')) {
      this.db.exec('ALTER TABLE character_tasks ADD COLUMN mission_id TEXT');
      log('info', 'Added mission_id column to character_tasks (task_076)');
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
   * agent 健康事件表（@since v3.30，task_054，schema v10）：health-monitor 随判定 / 审计
   * 逐条插入（offline / online 翻转各一条，transport exit 异常记 unhealthy）。
   * IF NOT EXISTS 幂等：新库在 migrateIfNeeded（schema_version = 0）也会走到这里；
   * v9 老库因版本号升到 10 重跑迁移补建。DDL 与 agent-health-dao.ts 同构同步改。
   */
  private migrateAgentHealthEvents(): void {
    const tables = this.getTableNames();
    if (tables.has('agent_health_events')) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_health_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        event TEXT NOT NULL CHECK (event IN ('online', 'offline', 'unhealthy')),
        created_at INTEGER NOT NULL
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_agent_health_events_kind_time ON agent_health_events(kind, created_at)');
    log('info', 'Created agent_health_events table (task_054)');
  }

  /**
   * 角色经验事件表（@since v3.36，task_061，schema v12）：progression-service 在
   * exp.gained / 升级结算时逐条写入（写入面 = app/services/persistence/exp-record.ts 的
   * persister 注入件）。IF NOT EXISTS 幂等：新库在 createTables 里建过，这里是旧库
   * （schema_version ≤ 11）的升级路径。DDL 与 exp-event-dao.ts 同构同步改（铁律同上）。
   */
  private migrateExpEvents(): void {
    const tables = this.getTableNames();
    if (tables.has('exp_events')) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS exp_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('task_completed', 'task_failed', 'chat_round', 'level_up')),
        level INTEGER,
        created_at INTEGER NOT NULL,
        instance_id TEXT
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_exp_events_character_time ON exp_events(character_id, created_at)');
    log('info', 'Created exp_events table (task_061)');
  }

  /**
   * 自定义 agent 注册表（@since v3.32，task_056，schema v11）：主进程 IPC 层随注册 CRUD 写入
   * （向导表单「+ 添加自定义 agent」→ 注册 / 删除；探测命令跑 probe_cmd）。
   * IF NOT EXISTS 幂等：新库（schema_version = 0）与 v10 老库（版本号升 11 重跑迁移）都走到这里。
   * DDL 与 custom-agent-dao.ts 的 ensureCustomAgentsTable 同构同步改（铁律同 agent_health_events）。
   */
  private migrateCustomAgents(): void {
    const tables = this.getTableNames();
    if (tables.has('custom_agents')) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS custom_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        probe_cmd TEXT NOT NULL,
        run_cmd_template TEXT NOT NULL,
        output_parser TEXT NOT NULL CHECK (output_parser IN ('plain', 'json')),
        created_at INTEGER NOT NULL
      )
    `);
    log('info', 'Created custom_agents table (task_056)');
  }

  /**
   * 会话域两张表（@since v3.43，task_092，schema v13）：会话摘要快照 + 会话事件流。
   * IF NOT EXISTS 幂等：新库（schema_version = 0）与 v12 老库（版本号升 13 重跑迁移）都走到这里；
   * 老库里已有同名表时直接跳过（表结构只加不改，重跑不重建）。
   * DDL 与 app/services/persistence/session-dao.ts / session-event-dao.ts 的 ensure* 同构同步改。
   */
  private migrateSessions(): void {
    const tables = this.getTableNames();
    if (!tables.has('sessions')) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          participants TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL,
          ref_id TEXT,
          created_at INTEGER NOT NULL,
          last_event_at INTEGER NOT NULL,
          closed_at INTEGER,
          event_count INTEGER NOT NULL DEFAULT 0,
          instance_id TEXT
        )
      `);
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_kind_status ON sessions(kind, status)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at)');
      log('info', 'Created sessions table (task_092)');
    }
    if (!tables.has('session_events')) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS session_events (
          session_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          type TEXT NOT NULL,
          payload TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          instance_id TEXT,
          PRIMARY KEY (session_id, seq)
        )
      `);
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_session_events_created_at ON session_events(created_at)');
      log('info', 'Created session_events table (task_092)');
    }
  }

  /**
   * 角色对话历史表（@since v3.15，task_036）：chat-service 按回合写入（user 即时 / assistant 收束 / system）。
   * task_073 扩 system 事件角色；SQLite CHECK 不可 ALTER，旧表重建并保留全部旧行（含旧 error 行）。
   */
  private migrateCharacterChatMessages(): void {
    const tables = this.getTableNames();

    if (!tables.has('character_chat_messages')) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS character_chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'error')),
          content TEXT NOT NULL,
          session_ref TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_character_chat_messages_character ON character_chat_messages(character_id, id)');
      log('info', 'Created character_chat_messages table');
      return;
    }

    const row = this.db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'character_chat_messages'`)
      .get() as { sql?: string } | undefined;
    if (typeof row?.sql === 'string' && row.sql.includes("'system'")) return;

    this.db.exec(`
      CREATE TABLE character_chat_messages_system (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'error')),
        content TEXT NOT NULL,
        session_ref TEXT,
        created_at INTEGER NOT NULL
      );
      INSERT INTO character_chat_messages_system
        (id, character_id, role, content, session_ref, created_at)
        SELECT id, character_id, role, content, session_ref, created_at
        FROM character_chat_messages;
      DROP TABLE character_chat_messages;
      ALTER TABLE character_chat_messages_system RENAME TO character_chat_messages;
      CREATE INDEX IF NOT EXISTS idx_character_chat_messages_character ON character_chat_messages(character_id, id);
    `);
    log('info', 'Migrated character_chat_messages role CHECK to include system (task_073)');
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
          -- external_session_id = **只读兼容镜像**（@since v3.3，task_200 / N4b-1）：
          --   真相在 session_external_refs 表（联合键 (external_session_id, instance_id) = R3 判据）。
          --   本列保留是为了兼容旧代码/旧库；新代码的 resume 链路**不读**它（见 design §1.3.2 R1-40）。
          --   兼容期仍照写（镜像写入保持），直到旧链路退役。
          external_session_id TEXT,
          context_enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          instance_id TEXT,
          role_id TEXT
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
          updated_at INTEGER NOT NULL,
          instance_id TEXT
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
   * 六表的 instance_id 列（@since v3.3，task_198，schema v14）——
   * design §1.3.2 步 N1（加列）+ 步 N2（旧行 = NULL = 默认沙盒；落库不改写）。
   *
   * 幂等：列已在（新建库 / 已迁移过的库）⇒ 直接跳过 ⇒ 迁移可重复执行。
   * 零数据改写：`ALTER TABLE ... ADD COLUMN col TEXT`（**无 DEFAULT**）只改表结构，
   *   存量行的该列落 NULL —— 旧行逐字节原样，NULL 的语义由查询期 COALESCE 归一。
   * why 表清单在这里另持一份：stratix-database 是驱动层，不反向依赖 app 层
   *   （app/services/persistence/instance-scope.ts 的 INSTANCE_SCOPED_TABLES 是同一份清单）。
   */
  private migrateInstanceIdColumns(): void {
    const tables = this.getTableNames();
    for (const table of INSTANCE_SCOPED_TABLES) {
      if (!tables.has(table)) continue; // 表还不存在：交给各自的建表路径（建表 DDL 自带该列）
      if (this.getColumnNames(table).has(INSTANCE_ID_COLUMN)) continue;
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${INSTANCE_ID_COLUMN} TEXT`);
      log('info', `Added ${INSTANCE_ID_COLUMN} column to ${table} table (task_198)`);
    }
  }

  /**
   * N4a + N4c（@since v3.3，task_199，schema v15）——
   * design §1.3.2 步 **N4a**（characters 加 `role_id` 列 + 复合唯一索引 `(role_id, instance_id)`）
   *   + 步 **N4c**（`character_id_map` 表，与数据同库、同事务 —— N4b 唯一的回滚凭据）。
   *
   * 幂等：列/索引/表都在（新建库 / 已迁移过的库）⇒ 直接跳过 ⇒ 迁移可重复执行。
   * 零数据改写：加列用 `ALTER TABLE ADD COLUMN col TEXT`（**无 DEFAULT**）⇒ 存量行落 NULL
   *   （= 未回填，与 instance_id 同款的「加法语义」）；新表不装旧行。
   *
   * why 复合唯一索引建在**原始列**上（而不是 `COALESCE(...)` 表达式索引）：
   *   SQLite 的唯一索引把 NULL 视为彼此不同 ⇒ 旧行（role_id IS NULL）之间**不冲突**
   *   ⇒ 索引能在存量库上直接建成（表达式索引会把旧行归一成同一个值而建不出来），
   *   也让「role_id 延后回填」成立（回填时才受唯一约束约束）。
   * why 唯一约束不能吞错：建索引时若真有重复的 (role_id, instance_id) ⇒ 直接抛错，
   *   因为那说明上游写坏了「一个副本内一个 roster 角色只有一行」的硬约束，静默跳过更危险。
   */
  private migrateRoleIdAndIdMap(): void {
    const tables = this.getTableNames();

    // —— N4a：characters 加 role_id 列 ——
    if (tables.has('characters')) {
      const columns = this.getColumnNames('characters');
      if (!columns.has(ROLE_ID_COLUMN)) {
        this.db.exec(`ALTER TABLE characters ADD COLUMN ${ROLE_ID_COLUMN} TEXT`);
        log('info', `Added ${ROLE_ID_COLUMN} column to characters table (task_199)`);
      }
      // —— N4a：复合唯一索引 (role_id, instance_id) ——
      //   两列都在才建：instance_id 由 migrateInstanceIdColumns 负责补（它排在本方法之前）；
      //   万一它没补上，宁可不建索引也不要抛「no such column」把启动炸掉。
      if (this.getColumnNames('characters').has(INSTANCE_ID_COLUMN)) {
        this.db.exec(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${CHARACTERS_ROLE_INSTANCE_INDEX} ON characters(${ROLE_ID_COLUMN}, ${INSTANCE_ID_COLUMN})`
        );
      }
    }

    // —— N4c：character_id_map 表（N4b 唯一的回滚凭据；与数据同库、同寿命）——
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${CHARACTER_ID_MAP_TABLE} (
        old_id TEXT NOT NULL,
        new_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (old_id, instance_id)
      )
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_character_id_map_new ON ${CHARACTER_ID_MAP_TABLE}(new_id)`
    );
  }

  /**
   * N4b-1（@since v3.3，task_200，schema v16）—— design §1.3.2「`externalSessionId` 的处置（R1-40）」。
   *
   * 建 `session_external_refs` 表：`externalSessionId`（CLI 侧 resume 凭据）**独立于角色行**存放。
   * 主键 `(external_session_id, instance_id)` = §3.4 **R3** 的判据：
   *   切副本后 B 副本查 `(extId, B)` 查不到 ⇒ resume 不可能 ⇒ id 重写与副本归属彻底解耦。
   *
   * 幂等：IF NOT EXISTS ⇒ 新库 / 老库 / 迁移重跑都直过（可重复执行）。
   * 零数据改写：纯新表，不装旧行 ⇒ 存量数据一个字节都没动。
   * why `instance_id` 是 NOT NULL（不是可空）：本表没有「NULL = 默认沙盒」的旧行语义 ——
   *   默认沙盒有自己的真实 id（`DEFAULT_INSTANCE_ID = 'wsp_sandbox'`）⇒ 一律写实值。
   */
  private migrateSessionExternalRefs(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${SESSION_EXTERNAL_REFS_TABLE} (
        external_session_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        character_id TEXT,
        session_id TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (external_session_id, instance_id)
      )
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS ${SESSION_EXTERNAL_REFS_CHARACTER_INDEX} ON ${SESSION_EXTERNAL_REFS_TABLE}(character_id, instance_id)`
    );
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
      -- @since v3.3 instance_id = 副本归属（task_198，步 N1：可空、无 DEFAULT ⇒ 旧行 = NULL = 默认沙盒）
      -- @since v3.3 role_id = roster 角色 id（task_199，步 N4a：可空、无 DEFAULT ⇒ 旧行 = NULL = 未回填）
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
        -- external_session_id = **只读兼容镜像**（@since v3.3，task_200 / N4b-1）：
        --   真相在 session_external_refs 表（联合键 (external_session_id, instance_id) = R3 判据）。
        --   本列保留是为了兼容旧代码/旧库；新代码的 resume 链路**不读**它（design §1.3.2 R1-40）。
        --   兼容期仍照写（镜像写入保持），直到旧链路退役。
        external_session_id TEXT,
        context_enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        instance_id TEXT,
        role_id TEXT
      );

      -- character id 重写映射表（@since v3.3，task_199，步 N4c）——
      -- N4b（一次性 id 重写）**唯一的回滚凭据**：与数据同库、同事务、同寿命（不进 .stratix/state/）。
      -- 主键 (old_id, instance_id)：N4b 之后角色 id 是 instance 内唯一 ⇒ 映射天然带副本维度。
      -- new_id 上建索引：前滚回滚（new → old 反向 UPDATE）按它查。
      CREATE TABLE IF NOT EXISTS character_id_map (
        old_id TEXT NOT NULL,
        new_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (old_id, instance_id)
      );

      -- 外部会话引用表（@since v3.3，task_200，步 N4b-1）——
      -- externalSessionId（CLI 侧 resume 凭据）**独立于角色行**存放；主键
      -- (external_session_id, instance_id) = design §3.4 R3 的判据：
      -- 切副本后 B 副本查 (extId, B) 查不到 ⇒ resume 不可能（id 重写与副本归属彻底解耦）。
      CREATE TABLE IF NOT EXISTS session_external_refs (
        external_session_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        character_id TEXT,
        session_id TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (external_session_id, instance_id)
      );

      -- 单位站位表：characterId → 战场世界坐标（app 层防抖批量写入）
      -- @since v3.3 instance_id = 副本归属（task_198，步 N1）
      CREATE TABLE IF NOT EXISTS unit_positions (
        character_id TEXT PRIMARY KEY,
        x REAL NOT NULL,
        y REAL NOT NULL,
        updated_at INTEGER NOT NULL,
        instance_id TEXT
      );

      -- 角色对话历史表（@since v3.15，task_036）：role ∈ user|assistant|system|error（error 为旧行兼容）；
      -- session_ref 是会话 id 的落库回执（审计用，恢复口径见 chat-service 文件头：重启首发重建）
      CREATE TABLE IF NOT EXISTS character_chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'error')),
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
        plan TEXT NOT NULL DEFAULT '',
        -- 关联 mission（task_076）：角色任务终态回报的关联键，NULL = 普通任务
        mission_id TEXT,
        -- 副本归属（task_198，步 N1）：可空、无 DEFAULT ⇒ 旧行 = NULL = 默认沙盒
        instance_id TEXT
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_characters_kind ON characters(kind);
      -- 映射表反查索引（task_199，步 N4c）：前滚回滚按 new_id 查 old_id。
      CREATE INDEX IF NOT EXISTS idx_character_id_map_new ON character_id_map(new_id);
      -- 外部会话引用的联合键反查索引（task_200，步 N4b-1）：resume 读口按 (character_id, instance_id) 查。
      CREATE INDEX IF NOT EXISTS idx_session_external_refs_character ON session_external_refs(character_id, instance_id);
      CREATE INDEX IF NOT EXISTS idx_character_chat_messages_character ON character_chat_messages(character_id, id);
      CREATE INDEX IF NOT EXISTS idx_character_tasks_character ON character_tasks(character_id, created_at);
    `;
    this.db.exec(sql);

    // 复合唯一索引（task_199，步 N4a）：一个副本内一个 roster 角色只能有一行角色档案。
    // NULL 视为彼此不同 ⇒ 旧行（role_id IS NULL）不冲突 ⇒ role_id 可延后回填。
    //
    // why 不写进上面那段 DDL：老库的 characters 表可能是 v13 / v14 形状
    //   （**没有 role_id 或没有 instance_id 列**）⇒ 在 createTables 里建索引会报
    //   「no such column」并炸掉启动。⇒ 这里只在**两列都在**时建；
    //   缺列的老库交给迁移链（ALTER ADD 补列之后再建索引）。
    const characterColumns = this.getColumnNames('characters');
    if (characterColumns.has(ROLE_ID_COLUMN) && characterColumns.has(INSTANCE_ID_COLUMN)) {
      this.db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${CHARACTERS_ROLE_INSTANCE_INDEX} ON characters(${ROLE_ID_COLUMN}, ${INSTANCE_ID_COLUMN})`
      );
    }
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
