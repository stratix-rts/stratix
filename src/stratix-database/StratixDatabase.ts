import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs-extra';

export interface DatabaseConfig {
  dataDir?: string;
  filename?: string;
}

export class StratixDatabase {
  private db: Database.Database;
  private dbPath: string;

  constructor(config: DatabaseConfig = {}) {
    const dataDir = config.dataDir || 'stratix-data';
    const filename = config.filename || 'stratix.db';
    
    fs.ensureDirSync(dataDir);
    this.dbPath = path.join(dataDir, `${filename}.sqlite`);
    this.db = new Database(this.dbPath);
    
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  public getDatabase(): Database.Database {
    return this.db;
  }

  public initialize(): void {
    this.createTables();
    this.migrateMissingColumns();
    console.log(`[Database] Initialized at: ${this.dbPath}`);
  }

  private migrateMissingColumns(): void {
    // 检测并添加 agents 表缺失的列
    const agentColumns = this.db.prepare('PRAGMA table_info(agents)').all() as any[];
    const agentColumnNames = new Set(agentColumns.map((c: any) => c.name));

    if (!agentColumnNames.has('openclaw_config')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN openclaw_config TEXT');
      console.log('[Database] Added openclaw_config column to agents table');
    }
    if (!agentColumnNames.has('stratix_config')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN stratix_config TEXT');
      console.log('[Database] Added stratix_config column to agents table');
    }

    // 检测并添加 zones 表缺失的 zone_context_id 列
    const zoneColumns = this.db.prepare('PRAGMA table_info(zones)').all() as any[];
    const zoneColumnNames = new Set(zoneColumns.map((c: any) => c.name));

    if (!zoneColumnNames.has('zone_context_id')) {
      this.db.exec('ALTER TABLE zones ADD COLUMN zone_context_id TEXT REFERENCES zone_contexts(zone_id)');
      console.log('[Database] Added zone_context_id column to zones table');
    }

    // 检测并添加 zone_contexts 表缺失的 deleted_at 列（软删除）
    const zoneCtxColumns = this.db.prepare('PRAGMA table_info(zone_contexts)').all() as any[];
    const zoneCtxColumnNames = new Set(zoneCtxColumns.map((c: any) => c.name));

    if (!zoneCtxColumnNames.has('deleted_at')) {
      this.db.exec('ALTER TABLE zone_contexts ADD COLUMN deleted_at INTEGER');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_zone_contexts_deleted_at ON zone_contexts(deleted_at)');
      console.log('[Database] Added deleted_at column to zone_contexts table');
    }

    // 添加 task_policy 和 task_creator_id 列到 zone_contexts
    if (!zoneCtxColumnNames.has('task_policy')) {
      this.db.exec("ALTER TABLE zone_contexts ADD COLUMN task_policy TEXT DEFAULT 'creator'");
      console.log('[Database] Added task_policy column to zone_contexts table');
    }
    if (!zoneCtxColumnNames.has('task_creator_id')) {
      this.db.exec('ALTER TABLE zone_contexts ADD COLUMN task_creator_id TEXT');
      console.log('[Database] Added task_creator_id column to zone_contexts table');
    }

    // 检测表是否存在
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
    const tableNames = new Set(tables.map((t: any) => t.name));

    // ============================================
    // Zone Tasks 表迁移
    // ============================================
    if (!tableNames.has('zone_tasks')) {
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
          FOREIGN KEY (zone_id) REFERENCES zone_contexts(zone_id) ON DELETE CASCADE
        )
      `);
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_zone_tasks_zone_id ON zone_tasks(zone_id)');
      console.log('[Database] Created zone_tasks table');
    }

    // ============================================
    // Zone Messages 表迁移
    // ============================================
    if (!tableNames.has('zone_messages')) {
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
      console.log('[Database] Created zone_messages table');
    }

    // ============================================
    // Agent Career System 表迁移
    // ============================================

    // shared_skills 表迁移
    if (!tableNames.has('shared_skills')) {
      this.db.exec(`
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
        )
      `);
      console.log('[Database] Created shared_skills table');
    }

    // shared_skill_installs 表迁移
    if (!tableNames.has('shared_skill_installs')) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS shared_skill_installs (
          skill_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          installed_at INTEGER NOT NULL,
          installed_by TEXT NOT NULL,
          PRIMARY KEY (skill_id, agent_id),
          FOREIGN KEY (skill_id) REFERENCES shared_skills(skill_id) ON DELETE CASCADE
        )
      `);
      console.log('[Database] Created shared_skill_installs table');
    }

    // agent_learned_skills 表迁移
    if (!tableNames.has('agent_learned_skills')) {
      this.db.exec(`
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
        )
      `);
      console.log('[Database] Created agent_learned_skills table');
    }

    // zone_contexts_simple 表迁移
    if (!tableNames.has('zone_contexts_simple')) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS zone_contexts_simple (
          zone_id TEXT PRIMARY KEY,
          context_json TEXT,
          updated_at INTEGER
        )
      `);
      console.log('[Database] Created zone_contexts_simple table');
    }

    // agent_zone_bindings 表迁移
    if (!tableNames.has('agent_zone_bindings')) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS agent_zone_bindings (
          agent_id TEXT NOT NULL,
          zone_id TEXT NOT NULL,
          joined_at INTEGER NOT NULL,
          PRIMARY KEY (agent_id, zone_id)
        )
      `);
      console.log('[Database] Created agent_zone_bindings table');
    }

    // 为 shared_skill_installs 添加索引（如果不存在）
    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_shared_skill_installs_agent ON shared_skill_installs(agent_id)');
    } catch (e) {
      // 索引可能已存在
    }

    // 为 agent_learned_skills 添加索引（如果不存在）
    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_agent_learned_skills_agent ON agent_learned_skills(agent_id)');
    } catch (e) {
      // 索引可能已存在
    }

    // 为 zone_contexts_simple 添加索引（如果不存在）
    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_zone_contexts_simple_zone_id ON zone_contexts_simple(zone_id)');
    } catch (e) {
      // 索引可能已存在
    }

    // 为 agent_zone_bindings 添加索引（如果不存在）
    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_agent_zone_bindings_agent ON agent_zone_bindings(agent_id)');
    } catch (e) {
      // 索引可能已存在
    }
    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_agent_zone_bindings_zone ON agent_zone_bindings(zone_id)');
    } catch (e) {
      // 索引可能已存在
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

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_shared_skill_installs_agent ON shared_skill_installs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_learned_skills_agent ON agent_learned_skills(agent_id);
      CREATE INDEX IF NOT EXISTS idx_zone_contexts_simple_zone_id ON zone_contexts_simple(zone_id);
      CREATE INDEX IF NOT EXISTS idx_agent_zone_bindings_agent ON agent_zone_bindings(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_zone_bindings_zone ON agent_zone_bindings(zone_id);
    `;
    // Find the line with REFERENCES and log context
    const refLine = sql.split('\n').findIndex(l => l.includes('REFERENCES'));
    if (refLine >= 0) {
      console.log('[DB] First REFERENCES at line', refLine);
      console.log('[DB] Context:', sql.split('\n').slice(Math.max(0, refLine-2), refLine+3).join('\n'));
    }
    this.db.exec(sql);
  }

  public close(): void {
    this.db.close();
  }

  public getPath(): string {
    return this.dbPath;
  }
}

let databaseInstance: StratixDatabase | null = null;

export function initializeDatabase(config?: DatabaseConfig): StratixDatabase {
  if (!databaseInstance) {
    databaseInstance = new StratixDatabase(config);
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

export default StratixDatabase;
