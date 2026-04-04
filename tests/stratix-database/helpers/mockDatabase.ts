/**
 * Mock Database Helper for Repository Tests
 *
 * Provides a mock database interface that mimics better-sqlite3 behavior.
 * Allows testing repository logic without a real database connection.
 */

export interface MockStatement {
  all: (...args: any[]) => any[];
  get: (...args: any[]) => any | undefined;
  run: (...args: any[]) => { changes: number };
}

export interface MockDatabase {
  prepare: jest.Mock<MockStatement, [string]>;
}

export interface MockDatabaseConfig {
  tables?: Record<string, any[]>;
}

/**
 * Create a mock database with optional initial data
 */
export function createMockDatabase(config: MockDatabaseConfig = {}): MockDatabase {
  const tables: Record<string, any[]> = config.tables || {};

  const mockPrepare = jest.fn((sql: string): MockStatement => {
    // Track SQL for debugging
    const statement: MockStatement = {
      all: (...args: any[]): any[] => {
        // Return empty array by default
        // Tests should override this per statement
        return [];
      },
      get: (...args: any[]): any | undefined => {
        // Return undefined by default
        // Tests should override this per statement
        return undefined;
      },
      run: (...args: any[]): { changes: number } => {
        // Return 0 changes by default
        // Tests should override this per statement
        return { changes: 0 };
      }
    };

    return statement;
  });

  return {
    prepare: mockPrepare
  };
}

/**
 * Create mock statements for a SQL query with predefined return data
 */
export function createMockStatement(
  sql: string,
  options: {
    returns?: any | any[];
    changes?: number;
    shouldThrow?: Error;
  } = {}
): MockStatement {
  const { returns = [], changes = 0, shouldThrow } = options;

  return {
    all: jest.fn((...args: any[]) => {
      if (shouldThrow) throw shouldThrow;
      return Array.isArray(returns) ? returns : [returns];
    }),
    get: jest.fn((...args: any[]) => {
      if (shouldThrow) throw shouldThrow;
      return Array.isArray(returns) ? returns[0] : returns;
    }),
    run: jest.fn((...args: any[]) => {
      if (shouldThrow) throw shouldThrow;
      return { changes };
    })
  };
}

/**
 * Create a mock zone row for testing
 */
export function createMockZoneRow(overrides: Partial<{
  zone_id: string;
  project_id: string;
  title: string;
  prompt: string;
  members: string;
  description: string;
  priority: number;
  status: string;
  path: string;
  present_agent_ids: string;
  zone_config: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  started_at: number | null;
  completed_at: number | null;
}> = {}): any {
  return {
    zone_id: 'zone-1',
    project_id: 'proj-1',
    title: 'Test Zone',
    prompt: 'Test prompt',
    members: '[]',
    description: '',
    priority: 3,
    status: 'idle',
    path: '',
    present_agent_ids: '[]',
    zone_config: '{}',
    created_at: 1234567890,
    updated_at: 1234567890,
    deleted_at: null,
    started_at: null,
    completed_at: null,
    ...overrides
  };
}

/**
 * Create a mock agent row for testing
 */
export function createMockAgentRow(overrides: Partial<{
  agent_id: string;
  name: string;
  type: string;
  profile: string;
  soul: string;
  rules: string;
  backend_type: string;
  config_status: string;
  position: string;
  memory: string;
  openclaw_config: string;
  stratix_config: string | null;
  created_at: number;
  updated_at: number;
}> = {}): any {
  return {
    agent_id: 'agent-1',
    name: 'Test Agent',
    type: 'custom',
    profile: '{"characterId":"char-1","name":"Test"}',
    soul: '{"personality":"friendly"}',
    rules: '["Rule 1"]',
    backend_type: 'openclaw',
    config_status: 'draft',
    position: '{"x":100,"y":200}',
    memory: '{"shortTerm":[]}',
    openclaw_config: '{"endpoint":"http://localhost"}',
    stratix_config: null,
    created_at: 1234567890,
    updated_at: 1234567890,
    ...overrides
  };
}

/**
 * Create a mock project row for testing
 */
export function createMockProjectRow(overrides: Partial<{
  project_id: string;
  name: string;
  description: string;
  priority: number;
  status: string;
  config: string;
  path: string;
  present_agent_ids: string;
  zone_config: string;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}> = {}): any {
  return {
    project_id: 'proj-1',
    name: 'Test Project',
    description: 'A test project',
    priority: 3,
    status: 'active',
    config: '{"name":"Test"}',
    path: '/path/to/project',
    present_agent_ids: '[]',
    zone_config: '{}',
    created_at: 1234567890,
    updated_at: 1234567890,
    started_at: null,
    completed_at: null,
    ...overrides
  };
}

/**
 * Create a mock zone file row for testing
 */
export function createMockZoneFileRow(overrides: Partial<{
  file_id: string;
  zone_id: string;
  name: string;
  source_type: string;
  source: string;
  content: string | null;
  file_type: string;
  last_fetched: number | null;
  metadata: string;
  created_at: number;
  updated_at: number;
}> = {}): any {
  return {
    file_id: 'file-1',
    zone_id: 'zone-1',
    name: 'readme.md',
    source_type: 'local',
    source: '/path/to/readme.md',
    content: '# Readme\n\nHello world',
    file_type: 'md',
    last_fetched: null,
    metadata: '{}',
    created_at: 1234567890,
    updated_at: 1234567890,
    ...overrides
  };
}

/**
 * Create a mock zone member row for testing
 */
export function createMockZoneMemberRow(overrides: Partial<{
  id: string;
  zone_id: string;
  agent_id: string;
  role: string;
  entered_at: number;
  left_at: number | null;
}> = {}): any {
  return {
    id: 'zmem-1',
    zone_id: 'zone-1',
    agent_id: 'agent-1',
    role: 'executor',
    entered_at: 1234567890,
    left_at: null,
    ...overrides
  };
}

/**
 * Create a mock capability row for testing
 */
export function createMockCapabilityRow(overrides: Partial<{
  id: string;
  agent_id: string;
  zone_id: string;
  capability: string;
  level: number;
  current_load: number;
  updated_at: number;
}> = {}): any {
  return {
    id: 'acap-1',
    agent_id: 'agent-1',
    zone_id: 'zone-1',
    capability: 'coding',
    level: 3,
    current_load: 1,
    updated_at: 1234567890,
    ...overrides
  };
}

/**
 * Create a mock task flow row for testing
 */
export function createMockTaskFlowRow(overrides: Partial<{
  flow_id: string;
  task_id: string;
  zone_id: string;
  from_agent_id: string | null;
  to_agent_id: string | null;
  action: string;
  metadata: string | null;
  created_at: number;
}> = {}): any {
  return {
    flow_id: 'flow-1',
    task_id: 'task-1',
    zone_id: 'zone-1',
    from_agent_id: null,
    to_agent_id: 'agent-1',
    action: 'created',
    metadata: null,
    created_at: 1234567890,
    ...overrides
  };
}

/**
 * Create a mock audit log row for testing
 */
export function createMockAuditLogRow(overrides: Partial<{
  id: string;
  zone_id: string;
  event_type: string;
  actor_id: string | null;
  target_id: string | null;
  metadata: string | null;
  created_at: number;
}> = {}): any {
  return {
    id: 'audit-1',
    zone_id: 'zone-1',
    event_type: 'agent_entered',
    actor_id: 'agent-1',
    target_id: null,
    metadata: null,
    created_at: 1234567890,
    ...overrides
  };
}

/**
 * Create a mock skill row for testing
 */
export function createMockSkillRow(overrides: Partial<{
  skill_id: string;
  name: string;
  description: string;
  category: string;
  icon: string | null;
  mcp_tool: string | null;
  endpoint: string | null;
  provider: string;
  created_at: number;
  updated_at: number;
}> = {}): any {
  return {
    skill_id: 'skill-1',
    name: 'Web Search',
    description: 'Search the web',
    category: 'data',
    icon: null,
    mcp_tool: null,
    endpoint: null,
    provider: 'builtin',
    created_at: 1234567890,
    updated_at: 1234567890,
    ...overrides
  };
}

/**
 * Create a mock learned skill row for testing
 */
export function createMockLearnedSkillRow(overrides: Partial<{
  skill_id: string;
  agent_id: string;
  name: string;
  description: string;
  category: string;
  level: number;
  experience_points: number;
  proficiency: number;
  certified: number;
  learned_from: string | null;
  learned_at: number;
  last_practiced_at: number;
}> = {}): any {
  return {
    skill_id: 'skill-1',
    agent_id: 'agent-1',
    name: 'JavaScript',
    description: 'JavaScript programming',
    category: 'code',
    level: 1,
    experience_points: 0,
    proficiency: 0,
    certified: 0,
    learned_from: null,
    learned_at: 1234567890,
    last_practiced_at: 1234567890,
    ...overrides
  };
}