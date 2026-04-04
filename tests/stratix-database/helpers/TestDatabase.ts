/**
 * Test Database Helper
 *
 * Creates an in-memory SQLite database for unit testing.
 * Uses better-sqlite3 which supports in-memory databases with ':memory:'.
 */

import Database from 'better-sqlite3';
import path from 'path';

// Schema creation SQL - matches StratixDatabase.createTables()
const SCHEMA_SQL = `
-- Agents table
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

-- Templates table
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

-- Projects table
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

-- Channels table
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

-- Messages table
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

-- OpenClaw Connections table
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

-- Gateway Identity table
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

-- Agent Chat Messages table
CREATE TABLE IF NOT EXISTS agent_chat_messages (
  message_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Zones table (ORCHESTRATION)
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

-- Zone Members table
CREATE TABLE IF NOT EXISTS agent_zone_members (
  agent_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  entered_at INTEGER NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'member', 'observer')),
  PRIMARY KEY (agent_id, zone_id),
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id) ON DELETE CASCADE
);

-- Zone Members enhanced table
CREATE TABLE IF NOT EXISTS zone_members (
  id TEXT PRIMARY KEY,
  zone_id TEXT NOT NULL REFERENCES zones(zone_id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  role TEXT DEFAULT 'executor' CHECK (role IN ('coordinator', 'executor')),
  entered_at INTEGER NOT NULL,
  left_at INTEGER,
  UNIQUE(zone_id, agent_id)
);

-- Zone Contexts table (OKR data)
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

-- Zone Files table
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

-- Zone Tasks table
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
);

-- Zone Messages table
CREATE TABLE IF NOT EXISTS zone_messages (
  message_id TEXT PRIMARY KEY,
  zone_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'agent')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (zone_id) REFERENCES zone_contexts(zone_id) ON DELETE CASCADE
);

-- Zone Coordinators table
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
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Tasks table
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

-- Agent Messages table
CREATE TABLE IF NOT EXISTS agent_messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('direct', 'broadcast', 'mention', 'task_request', 'context_share')),
  refs TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);

-- Conversation Policies table
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

-- Context Archives table
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

-- Agent Backgrounds table
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

-- Shared Skills table
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

-- Shared Skill Installs table
CREATE TABLE IF NOT EXISTS shared_skill_installs (
  skill_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  installed_by TEXT NOT NULL,
  PRIMARY KEY (skill_id, agent_id),
  FOREIGN KEY (skill_id) REFERENCES shared_skills(skill_id) ON DELETE CASCADE
);

-- Agent Learned Skills table
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

-- Zone Contexts Simple table
CREATE TABLE IF NOT EXISTS zone_contexts_simple (
  zone_id TEXT PRIMARY KEY,
  context_json TEXT,
  updated_at INTEGER
);

-- Agent Zone Bindings table
CREATE TABLE IF NOT EXISTS agent_zone_bindings (
  agent_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, zone_id)
);

-- Agent Capabilities table
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

-- Task Flow table
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

-- Zone Audit Log table
CREATE TABLE IF NOT EXISTS zone_audit_log (
  id TEXT PRIMARY KEY,
  zone_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  target_id TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_zone_contexts_project_id ON zone_contexts(project_id);
CREATE INDEX IF NOT EXISTS idx_zone_contexts_deleted_at ON zone_contexts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_zone_files_zone_id ON zone_files(zone_id);
CREATE INDEX IF NOT EXISTS idx_zone_tasks_zone_id ON zone_tasks(zone_id);
CREATE INDEX IF NOT EXISTS idx_zone_messages_zone_id ON zone_messages(zone_id);
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
CREATE INDEX IF NOT EXISTS idx_shared_skill_installs_agent ON shared_skill_installs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_learned_skills_agent ON agent_learned_skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_zone_contexts_simple_zone_id ON zone_contexts_simple(zone_id);
CREATE INDEX IF NOT EXISTS idx_agent_zone_bindings_agent ON agent_zone_bindings(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_zone_bindings_zone ON agent_zone_bindings(zone_id);
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_zone ON agent_capabilities(zone_id);
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_capability ON agent_capabilities(capability);
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_agent_zone ON agent_capabilities(agent_id, zone_id);
CREATE INDEX IF NOT EXISTS idx_flow_task ON task_flow(task_id);
CREATE INDEX IF NOT EXISTS idx_flow_zone ON task_flow(zone_id);
CREATE INDEX IF NOT EXISTS idx_flow_agent ON task_flow(to_agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_zone ON zone_audit_log(zone_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON zone_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_type ON zone_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_time ON zone_audit_log(created_at);
`;

/**
 * Creates an in-memory test database with all schema
 */
export function createTestDatabase(): Database.Database {
  // Use in-memory database
  const db = new Database(':memory:');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create all tables
  db.exec(SCHEMA_SQL);

  return db;
}

/**
 * Creates a mock database wrapper that simulates the getDatabase() interface
 */
export function createMockDatabaseWrapper(db: Database.Database) {
  return {
    getDatabase: () => db,
    close: () => db.close(),
    getPath: () => ':memory:'
  };
}

/**
 * Test database singleton for sharing across tests in a single file
 */
let sharedDb: Database.Database | null = null;

export function getSharedTestDatabase(): Database.Database {
  if (!sharedDb) {
    sharedDb = createTestDatabase();
  }
  return sharedDb;
}

export function resetSharedTestDatabase(): void {
  if (sharedDb) {
    // Delete all data from tables (in reverse dependency order for FK constraints)
    const tables = [
      'zone_audit_log',
      'task_flow',
      'agent_capabilities',
      'agent_zone_bindings',
      'zone_contexts_simple',
      'agent_learned_skills',
      'shared_skill_installs',
      'shared_skills',
      'agent_backgrounds',
      'context_archives',
      'conversation_policies',
      'agent_messages',
      'tasks',
      'zone_coordinators',
      'zone_messages',
      'zone_tasks',
      'zone_files',
      'zone_contexts',
      'agent_zone_members',
      'zones',
      'messages',
      'channels',
      'agent_chat_messages',
      'gateway_identity',
      'openclaw_connections',
      'projects',
      'templates',
      'agents'
    ];

    const deleteAll = sharedDb.transaction(() => {
      for (const table of tables) {
        try {
          sharedDb!.exec(`DELETE FROM ${table}`);
        } catch {
          // Table might not exist, ignore
        }
      }
    });
    deleteAll();
  }
}

export function closeSharedTestDatabase(): void {
  if (sharedDb) {
    sharedDb.close();
    sharedDb = null;
  }
}