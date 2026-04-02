export interface StratixState {
  agents: Map<string, any>;
  zones: Map<string, any>;
  sessions: Map<string, any>;
  ui: any;
  mcp: any;
}

type Subscriber = (state: StratixState) => void;

class StratixStateStore {
  private state: StratixState = {
    agents: new Map(),
    zones: new Map(),
    sessions: new Map(),
    ui: null,
    mcp: null,
  };

  private subscribers = new Set<Subscriber>();

  get<K extends keyof StratixState>(key: K): StratixState[K] {
    return this.state[key];
  }

  set<K extends keyof StratixState>(key: K, value: StratixState[K]): void {
    this.state[key] = value;
    this.notify();
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private notify(): void {
    this.subscribers.forEach((fn) => fn(this.state));
  }
}

export const stratixStateStore = new StratixStateStore();
