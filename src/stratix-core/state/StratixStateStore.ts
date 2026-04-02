import {
  AgentStateSchema,
  AgentActivityStatus,
  AgentConnectionStatus,
  AgentConfigStatus,
} from '../schemas';

// ============================================================================
// Typed State Interfaces
// ============================================================================

export interface AgentState {
  id: string;
  name: string;
  status: {
    config: AgentConfigStatus;
    connection: AgentConnectionStatus;
    activity: AgentActivityStatus;
    lastError?: string;
    lastActiveAt?: number;
  };
  currentZone?: string;
  lastActiveAt?: number;
  config: Record<string, unknown>;
}

export interface ZoneState {
  id: string;
  title: string;
  status: string;
  members: string[];
  tasks: string[];
  createdAt: number;
}

export interface SessionState {
  id: string;
  agentId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>;
  usage: Record<string, number>;
  startedAt: number;
}

export interface UIState {
  selectedAgents: string[];
  selectedZone: string | null;
  sidebarOpen: boolean;
  theme: 'light' | 'dark' | 'auto';
}

export interface MCPConnection {
  id: string;
  name: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  endpoint: string;
  lastError?: string;
}

export interface MCPTool {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPState {
  connections: MCPConnection[];
  tools: MCPTool[];
}

export interface StratixState {
  agents: Map<string, AgentState>;
  zones: Map<string, ZoneState>;
  sessions: Map<string, SessionState>;
  ui: UIState;
  mcp: MCPState;
}

type Subscriber = (state: StratixState) => void;

export type EqualityFn<T> = (a: T, b: T) => boolean;

// ============================================================================
// Store Implementation
// ============================================================================

class StratixStateStore {
  private state: StratixState = {
    agents: new Map(),
    zones: new Map(),
    sessions: new Map(),
    ui: {
      selectedAgents: [],
      selectedZone: null,
      sidebarOpen: true,
      theme: 'auto',
    },
    mcp: {
      connections: [],
      tools: [],
    },
  };

  private subscribers = new Set<Subscriber>();
  private batchDepth = 0;

  // --------------------------------------------------------------------------
  // Core get/set
  // --------------------------------------------------------------------------

  get<K extends keyof StratixState>(key: K): StratixState[K] {
    return this.state[key];
  }

  set<K extends keyof StratixState>(key: K, value: StratixState[K]): void {
    this.state[key] = value;
    this.notify();
  }

  // --------------------------------------------------------------------------
  // Select by id from a Map-backed key
  // --------------------------------------------------------------------------

  select<K extends keyof StratixState>(key: K): StratixState[K] {
    return this.state[key];
  }

  // --------------------------------------------------------------------------
  // Subscribe/unsubscribe
  // --------------------------------------------------------------------------

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  // --------------------------------------------------------------------------
  // Atomic updates – agents
  // --------------------------------------------------------------------------

  getAgent(id: string): AgentState | undefined {
    return this.state.agents.get(id);
  }

  setAgent(id: string, agent: AgentState): void {
    this.state.agents.set(id, agent);
    this.notify();
  }

  updateAgent(id: string, partial: Partial<AgentState>): void {
    const existing = this.state.agents.get(id);
    if (!existing) return;
    this.state.agents.set(id, { ...existing, ...partial });
    this.notify();
  }

  removeAgent(id: string): void {
    if (!this.state.agents.has(id)) return;
    this.state.agents.delete(id);
    this.notify();
  }

  // --------------------------------------------------------------------------
  // Atomic updates – zones
  // --------------------------------------------------------------------------

  getZone(id: string): ZoneState | undefined {
    return this.state.zones.get(id);
  }

  setZone(id: string, zone: ZoneState): void {
    this.state.zones.set(id, zone);
    this.notify();
  }

  updateZone(id: string, partial: Partial<ZoneState>): void {
    const existing = this.state.zones.get(id);
    if (!existing) return;
    this.state.zones.set(id, { ...existing, ...partial });
    this.notify();
  }

  removeZone(id: string): void {
    if (!this.state.zones.has(id)) return;
    this.state.zones.delete(id);
    this.notify();
  }

  // --------------------------------------------------------------------------
  // Atomic updates – sessions
  // --------------------------------------------------------------------------

  getSession(id: string): SessionState | undefined {
    return this.state.sessions.get(id);
  }

  setSession(id: string, session: SessionState): void {
    this.state.sessions.set(id, session);
    this.notify();
  }

  updateSession(id: string, partial: Partial<SessionState>): void {
    const existing = this.state.sessions.get(id);
    if (!existing) return;
    this.state.sessions.set(id, { ...existing, ...partial });
    this.notify();
  }

  removeSession(id: string): void {
    if (!this.state.sessions.has(id)) return;
    this.state.sessions.delete(id);
    this.notify();
  }

  // --------------------------------------------------------------------------
  // Batch updates – only one notification at the end
  // --------------------------------------------------------------------------

  batch(fn: (store: StratixStateStore) => void): void {
    this.batchDepth++;
    try {
      fn(this);
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) {
        this.notify();
      }
    }
  }

  // --------------------------------------------------------------------------
  // Selector factory – memoization with optional equality check
  // --------------------------------------------------------------------------

  createSelector<R>(selector: (state: StratixState) => R, equalityFn?: EqualityFn<R>): () => R {
    let lastValue: R;
    let lastState: StratixState | undefined = undefined;
    const eq = equalityFn ?? Object.is;

    return () => {
      const currentState = this.state;
      const newValue = selector(currentState);
      if (lastState === currentState && eq(lastValue, newValue)) {
        return lastValue;
      }
      lastValue = newValue;
      lastState = currentState;
      return lastValue;
    };
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private notify(): void {
    if (this.batchDepth > 0) return;
    this.subscribers.forEach((fn) => fn(this.state));
  }
}

// Singleton export
export const stratixStateStore = new StratixStateStore();
