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
    const columns = this.db.prepare('PRAGMA table_info(agents)').all() as any[];
    const columnNames = new Set(columns.map((c: any) => c.name));

    if (!columnNames.has('openclaw_config')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN openclaw_config TEXT');
      console.log('[Database] Added openclaw_config column to agents table');
    }
    if (!columnNames.has('stratix_config')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN stratix_config TEXT');
      console.log('[Database] Added stratix_config column to agents table');
    }
  }

  private createTables(): void {
    this.db.exec(`
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
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
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
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
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

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(type);
      CREATE INDEX IF NOT EXISTS idx_command_logs_agent_id ON command_logs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_command_logs_status ON command_logs(status);
      CREATE INDEX IF NOT EXISTS idx_channels_project_id ON channels(project_id);
      CREATE INDEX IF NOT EXISTS idx_messages_project_id ON messages(project_id);
      CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    `);
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
