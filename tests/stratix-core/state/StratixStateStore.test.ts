/**
 * StratixStateStore tests – typed state, selectors, atomic & batch updates
 */

import {
  stratixStateStore,
  type AgentState,
  type ZoneState,
  type SessionState,
  type UIState,
  type MCPState,
  type StratixState,
} from '../../../src/stratix-core/state';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    status: { config: 'ready', connection: 'connected', activity: 'idle' },
    currentZone: undefined,
    lastActiveAt: undefined,
    config: {},
    ...overrides,
  };
}

function makeZone(overrides: Partial<ZoneState> = {}): ZoneState {
  return {
    id: 'zone-1',
    title: 'Engineering',
    status: 'active',
    members: [],
    tasks: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    messages: [],
    usage: {},
    startedAt: Date.now(),
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Setup / teardown
// --------------------------------------------------------------------------

beforeEach(() => {
  // Reset store to pristine state
  stratixStateStore.set('agents', new Map());
  stratixStateStore.set('zones', new Map());
  stratixStateStore.set('sessions', new Map());
  stratixStateStore.set('ui', {
    selectedAgents: [],
    selectedZone: null,
    sidebarOpen: true,
    theme: 'auto',
  });
  stratixStateStore.set('mcp', { connections: [], tools: [] });
});

// --------------------------------------------------------------------------
// Tests: get / set
// --------------------------------------------------------------------------

describe('get / set', () => {
  it('returns the agents map', () => {
    const agents = stratixStateStore.get('agents');
    expect(agents).toBeInstanceOf(Map);
    expect(agents.size).toBe(0);
  });

  it('returns the ui state', () => {
    const ui = stratixStateStore.get('ui');
    expect(ui.selectedAgents).toEqual([]);
    expect(ui.sidebarOpen).toBe(true);
    expect(ui.theme).toBe('auto');
  });

  it('set replaces the entire agents map', () => {
    const map = new Map<string, AgentState>();
    map.set('a1', makeAgent({ id: 'a1', name: 'Alpha' }));
    stratixStateStore.set('agents', map);
    expect(stratixStateStore.get('agents').get('a1')?.name).toBe('Alpha');
  });

  it('set triggers subscriber notification', () => {
    const fn = jest.fn();
    stratixStateStore.subscribe(fn);
    stratixStateStore.set('ui', { selectedAgents: ['x'], selectedZone: null, sidebarOpen: true, theme: 'dark' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// Tests: subscribe / unsubscribe
// --------------------------------------------------------------------------

describe('subscribe / unsubscribe', () => {
  it('notifies subscriber on state change', () => {
    const fn = jest.fn();
    stratixStateStore.subscribe(fn);
    stratixStateStore.setAgent('agent-1', makeAgent());
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('notifies multiple subscribers', () => {
    const fn1 = jest.fn();
    const fn2 = jest.fn();
    stratixStateStore.subscribe(fn1);
    stratixStateStore.subscribe(fn2);
    stratixStateStore.setAgent('agent-1', makeAgent());
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe removes the subscriber', () => {
    const fn = jest.fn();
    const unsub = stratixStateStore.subscribe(fn);
    unsub();
    stratixStateStore.setAgent('agent-1', makeAgent());
    expect(fn).not.toHaveBeenCalled();
  });

  it('subscribe returns unsubscribe function that works', () => {
    const fn = jest.fn();
    const unsub = stratixStateStore.subscribe(fn);
    unsub();
    expect(fn).not.toHaveBeenCalled();
  });

  it('subscriber receives current state', () => {
    const fn = jest.fn();
    stratixStateStore.setAgent('agent-1', makeAgent({ name: 'BeforeSub' }));
    stratixStateStore.subscribe(fn);
    stratixStateStore.setAgent('agent-2', makeAgent({ id: 'agent-2', name: 'AfterSub' }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].agents.get('agent-2')?.name).toBe('AfterSub');
  });
});

// --------------------------------------------------------------------------
// Tests: selector pattern
// --------------------------------------------------------------------------

describe('select<K>', () => {
  it('select returns the agents Map', () => {
    stratixStateStore.setAgent('a1', makeAgent({ id: 'a1' }));
    const agents = stratixStateStore.select('agents');
    expect(agents.get('a1')?.id).toBe('a1');
  });

  it('select returns the ui state', () => {
    stratixStateStore.set('ui', { selectedAgents: ['x'], selectedZone: null, sidebarOpen: false, theme: 'dark' });
    const ui = stratixStateStore.select('ui');
    expect(ui.sidebarOpen).toBe(false);
  });
});

describe('createSelector', () => {
  it('returns a function', () => {
    const sel = stratixStateStore.createSelector((s) => s.agents.size);
    expect(typeof sel).toBe('function');
  });

  it('computes the derived value', () => {
    stratixStateStore.setAgent('a1', makeAgent({ id: 'a1' }));
    stratixStateStore.setAgent('a2', makeAgent({ id: 'a2' }));
    const sel = stratixStateStore.createSelector((s) => s.agents.size);
    expect(sel()).toBe(2);
  });

  it('caches result when state reference is unchanged (mutation)', () => {
    stratixStateStore.setAgent('a1', makeAgent({ id: 'a1' }));
    const sel = stratixStateStore.createSelector((s) => s.agents.size);
    const first = sel(); // computes: 1 (agents has a1)
    const second = sel(); // cache hit: 1
    expect(first).toBe(second);
    // setAgent mutates the same Map reference, so state.agents === lastState
    // Selector sees equal computed value (size still 1) and returns cached 1
    expect(sel()).toBe(1);
  });

  it('sees new value after state mutation', () => {
    const sel = stratixStateStore.createSelector((s) => s.agents.size);
    expect(sel()).toBe(0);
    stratixStateStore.setAgent('a1', makeAgent({ id: 'a1' }));
    expect(sel()).toBe(1);
  });

  it('uses custom equalityFn to avoid updates when values are equal', () => {
    stratixStateStore.set('ui', { selectedAgents: ['x'], selectedZone: null, sidebarOpen: true, theme: 'auto' });
    const sel = stratixStateStore.createSelector(
      (s) => s.ui.selectedAgents,
      (a, b) => a.length === b.length,
    );
    const first = sel();
    // Change sidebar (not selectedAgents) – should return same reference due to equalityFn
    stratixStateStore.set('ui', { selectedAgents: ['x'], selectedZone: null, sidebarOpen: false, theme: 'auto' });
    const second = sel();
    expect(first).toBe(second); // same reference because equalityFn says equal
  });

  it('calls the selector function when state actually changes', () => {
    const spy = jest.fn((s: StratixState) => s.agents.size);
    const sel = stratixStateStore.createSelector(spy);
    sel(); // initial call
    stratixStateStore.setAgent('a1', makeAgent({ id: 'a1' }));
    sel();
    // spy is called at least twice (once per sel() when state changed)
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('works with object selectors', () => {
    stratixStateStore.set('ui', { selectedAgents: ['x'], selectedZone: 'z1', sidebarOpen: true, theme: 'dark' });
    const sel = stratixStateStore.createSelector((s) => ({ zone: s.ui.selectedZone, theme: s.ui.theme }));
    const result = sel();
    expect(result.zone).toBe('z1');
    expect(result.theme).toBe('dark');
  });
});

// --------------------------------------------------------------------------
// Tests: atomic updates – agents
// --------------------------------------------------------------------------

describe('atomic agent operations', () => {
  it('setAgent adds an agent', () => {
    stratixStateStore.setAgent('a1', makeAgent({ id: 'a1', name: 'Alpha' }));
    expect(stratixStateStore.getAgent('a1')?.name).toBe('Alpha');
  });

  it('updateAgent merges partial into existing agent', () => {
    stratixStateStore.setAgent('a1', makeAgent({ id: 'a1', name: 'Alpha' }));
    stratixStateStore.updateAgent('a1', { name: 'Beta', currentZone: 'zone-1' });
    const agent = stratixStateStore.getAgent('a1');
    expect(agent?.name).toBe('Beta');
    expect(agent?.currentZone).toBe('zone-1');
    // status sub-object should be preserved
    expect(agent?.status.config).toBe('ready');
  });

  it('updateAgent does nothing for unknown id', () => {
    const fn = jest.fn();
    stratixStateStore.subscribe(fn);
    stratixStateStore.updateAgent('unknown', { name: 'Ghost' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('removeAgent deletes the agent', () => {
    stratixStateStore.setAgent('a1', makeAgent({ id: 'a1' }));
    stratixStateStore.removeAgent('a1');
    expect(stratixStateStore.getAgent('a1')).toBeUndefined();
  });

  it('removeAgent does nothing for unknown id', () => {
    const fn = jest.fn();
    stratixStateStore.subscribe(fn);
    stratixStateStore.removeAgent('unknown');
    expect(fn).not.toHaveBeenCalled();
  });

  it('setAgent triggers notification', () => {
    const fn = jest.fn();
    stratixStateStore.subscribe(fn);
    stratixStateStore.setAgent('a1', makeAgent({ id: 'a1' }));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// Tests: atomic updates – zones
// --------------------------------------------------------------------------

describe('atomic zone operations', () => {
  it('setZone adds a zone', () => {
    stratixStateStore.setZone('z1', makeZone({ id: 'z1', title: 'Engineering' }));
    expect(stratixStateStore.getZone('z1')?.title).toBe('Engineering');
  });

  it('updateZone merges partial into existing zone', () => {
    stratixStateStore.setZone('z1', makeZone({ id: 'z1', title: 'Eng', status: 'active' }));
    stratixStateStore.updateZone('z1', { title: 'Engineering', status: 'archived' });
    const zone = stratixStateStore.getZone('z1');
    expect(zone?.title).toBe('Engineering');
    expect(zone?.status).toBe('archived');
    expect(zone?.members).toEqual([]); // preserved
  });

  it('updateZone does nothing for unknown id', () => {
    const fn = jest.fn();
    stratixStateStore.subscribe(fn);
    stratixStateStore.updateZone('unknown', { title: 'Ghost' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('removeZone deletes the zone', () => {
    stratixStateStore.setZone('z1', makeZone({ id: 'z1' }));
    stratixStateStore.removeZone('z1');
    expect(stratixStateStore.getZone('z1')).toBeUndefined();
  });

  it('removeZone does nothing for unknown id', () => {
    const fn = jest.fn();
    stratixStateStore.subscribe(fn);
    stratixStateStore.removeZone('unknown');
    expect(fn).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// Tests: atomic updates – sessions
// --------------------------------------------------------------------------

describe('atomic session operations', () => {
  it('setSession adds a session', () => {
    const session = makeSession({ id: 's1', agentId: 'a1' });
    stratixStateStore.setSession('s1', session);
    expect(stratixStateStore.getSession('s1')?.agentId).toBe('a1');
  });

  it('getSession returns undefined for unknown id', () => {
    expect(stratixStateStore.getSession('unknown')).toBeUndefined();
  });

  it('updateSession merges partial into existing session', () => {
    stratixStateStore.setSession('s1', makeSession({ id: 's1', agentId: 'a1' }));
    stratixStateStore.updateSession('s1', { usage: { tokens: 100 } });
    expect(stratixStateStore.getSession('s1')?.usage).toEqual({ tokens: 100 });
    expect(stratixStateStore.getSession('s1')?.agentId).toBe('a1'); // preserved
  });

  it('updateSession does nothing for unknown id', () => {
    const fn = jest.fn();
    stratixStateStore.subscribe(fn);
    stratixStateStore.updateSession('unknown', { usage: { tokens: 1 } });
    expect(fn).not.toHaveBeenCalled();
  });

  it('removeSession deletes the session', () => {
    stratixStateStore.setSession('s1', makeSession({ id: 's1' }));
    stratixStateStore.removeSession('s1');
    expect(stratixStateStore.getSession('s1')).toBeUndefined();
  });

  it('removeSession does nothing for unknown id', () => {
    const fn = jest.fn();
    stratixStateStore.subscribe(fn);
    stratixStateStore.removeSession('unknown');
    expect(fn).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// Tests: batch updates
// --------------------------------------------------------------------------

describe('batch updates', () => {
  it('batch notifies only once after multiple operations', () => {
    const fn = jest.fn();
    stratixStateStore.subscribe(fn);
    stratixStateStore.batch((store) => {
      store.setAgent('a1', makeAgent({ id: 'a1' }));
      store.setAgent('a2', makeAgent({ id: 'a2' }));
      store.setZone('z1', makeZone({ id: 'z1' }));
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].agents.size).toBe(2);
    expect(fn.mock.calls[0][0].zones.size).toBe(1);
  });

  it('batch does not notify during the batch – only at the end', () => {
    const fn = jest.fn();
    stratixStateStore.subscribe(fn);
    let midBatch = false;
    stratixStateStore.batch((store) => {
      store.setAgent('a1', makeAgent({ id: 'a1' }));
      // subscriber should NOT have been called yet
      midBatch = fn.mock.calls.length > 0;
    });
    // fn should not have been called during the batch
    expect(midBatch).toBe(false);
    // fn should be called exactly once after the batch ends
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('nested batches notify only at the outermost end', () => {
    const fn = jest.fn();
    stratixStateStore.subscribe(fn);
    stratixStateStore.batch((store) => {
      store.setAgent('a1', makeAgent({ id: 'a1' }));
      store.batch((inner) => {
        inner.setAgent('a2', makeAgent({ id: 'a2' }));
      });
      store.setZone('z1', makeZone({ id: 'z1' }));
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].agents.size).toBe(2);
    expect(fn.mock.calls[0][0].zones.size).toBe(1);
  });

  it('batch collects all state changes before notifying', () => {
    stratixStateStore.setAgent('a1', makeAgent({ id: 'a1', name: 'Old' }));
    const fn = jest.fn();
    stratixStateStore.subscribe(fn);
    stratixStateStore.batch((store) => {
      store.updateAgent('a1', { name: 'New' });
      store.setZone('z1', makeZone({ id: 'z1', title: 'Zone One' }));
    });
    expect(fn).toHaveBeenCalledTimes(1);
    const notifiedState = fn.mock.calls[0][0];
    expect(notifiedState.agents.get('a1')?.name).toBe('New');
    expect(notifiedState.zones.get('z1')?.title).toBe('Zone One');
  });

  it('batch with no operations still notifies once', () => {
    const fn = jest.fn();
    stratixStateStore.subscribe(fn);
    stratixStateStore.batch((_store) => {
      // no-op
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// Tests: type-correctness of ui and mcp
// --------------------------------------------------------------------------

describe('ui and mcp state', () => {
  it('ui state accepts all theme values', () => {
    for (const theme of ['light', 'dark', 'auto'] as const) {
      stratixStateStore.set('ui', {
        selectedAgents: [],
        selectedZone: null,
        sidebarOpen: true,
        theme,
      });
      expect(stratixStateStore.get('ui').theme).toBe(theme);
    }
  });

  it('mcp state accepts connections and tools', () => {
    const mcp: MCPState = {
      connections: [
        { id: 'c1', name: 'Conn 1', status: 'connected', endpoint: 'http://localhost:3001' },
      ],
      tools: [
        { id: 't1', name: 'Tool 1', description: 'A tool', inputSchema: {} },
      ],
    };
    stratixStateStore.set('mcp', mcp);
    expect(stratixStateStore.get('mcp').connections).toHaveLength(1);
    expect(stratixStateStore.get('mcp').tools[0].name).toBe('Tool 1');
  });

  it('ui selectedAgents can be updated via batch', () => {
    stratixStateStore.batch((store) => {
      store.set('ui', { selectedAgents: ['a1', 'a2'], selectedZone: 'z1', sidebarOpen: true, theme: 'dark' });
    });
    expect(stratixStateStore.get('ui').selectedAgents).toEqual(['a1', 'a2']);
  });
});
