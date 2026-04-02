import { PermissionOrchestrator } from '@/stratix-core/permission/PermissionOrchestrator';
import type { PermissionContext, PermissionHook, ZoneRule, PermissionDecision } from '@/stratix-core/permission/types';

describe('PermissionOrchestrator', () => {
  let orchestrator: PermissionOrchestrator;

  const createContext = (overrides?: Partial<PermissionContext>): PermissionContext => ({
    action: 'read',
    resource: '/test/path',
    agentId: 'agent-1',
    ...overrides,
  });

  beforeEach(() => {
    orchestrator = new PermissionOrchestrator();
  });

  describe('constructor', () => {
    test('creates instance', () => {
      expect(orchestrator).toBeInstanceOf(PermissionOrchestrator);
    });

    test('accepts initial rules and hooks', () => {
      const rules: ZoneRule[] = [{ zoneId: 'zone-1', actions: ['read'], default: 'allow' as PermissionDecision }];
      const hooks: PermissionHook[] = [jest.fn()];
      const op = new PermissionOrchestrator(rules, hooks);
      expect(op).toBeInstanceOf(PermissionOrchestrator);
    });
  });

  describe('low-risk actions', () => {
    test('allows read action', () => {
      const result = orchestrator.decide(createContext({ action: 'read' }));
      expect(result.decision).toBe('allow');
      expect(result.source).toBe('classifier');
    });

    test('allows query action', () => {
      const result = orchestrator.decide(createContext({ action: 'query' }));
      expect(result.decision).toBe('allow');
    });

    test('allows list action', () => {
      const result = orchestrator.decide(createContext({ action: 'list' }));
      expect(result.decision).toBe('allow');
    });

    test('allows get action', () => {
      const result = orchestrator.decide(createContext({ action: 'get' }));
      expect(result.decision).toBe('allow');
    });

    test('allows search action', () => {
      const result = orchestrator.decide(createContext({ action: 'search' }));
      expect(result.decision).toBe('allow');
    });

    test('allows view action', () => {
      const result = orchestrator.decide(createContext({ action: 'view' }));
      expect(result.decision).toBe('allow');
    });
  });

  describe('destructive actions', () => {
    test('denies delete action without rules', () => {
      const result = orchestrator.decide(createContext({ action: 'delete' }));
      expect(result.decision).toBe('deny');
      expect(result.source).toBe('classifier');
    });

    test('denies destroy action without rules', () => {
      const result = orchestrator.decide(createContext({ action: 'destroy' }));
      expect(result.decision).toBe('deny');
    });

    test('denies remove action without rules', () => {
      const result = orchestrator.decide(createContext({ action: 'remove' }));
      expect(result.decision).toBe('deny');
    });

    test('denies drop action without rules', () => {
      const result = orchestrator.decide(createContext({ action: 'drop' }));
      expect(result.decision).toBe('deny');
    });

    test('denies purge action without rules', () => {
      const result = orchestrator.decide(createContext({ action: 'purge' }));
      expect(result.decision).toBe('deny');
    });
  });

  describe('ambiguous actions', () => {
    test('returns ask for unknown actions', () => {
      const result = orchestrator.decide(createContext({ action: 'unknownAction' }));
      expect(result.decision).toBe('ask');
      expect(result.source).toBe('user_dialog');
    });

    test('returns ask for write action', () => {
      const result = orchestrator.decide(createContext({ action: 'write' }));
      expect(result.decision).toBe('ask');
    });

    test('returns ask for execute action', () => {
      const result = orchestrator.decide(createContext({ action: 'execute' }));
      expect(result.decision).toBe('ask');
    });
  });

  describe('hook override', () => {
    test('hook can override allow to deny', () => {
      const denyHook: PermissionHook = () => 'deny';
      orchestrator.addHook(denyHook);

      const result = orchestrator.decide(createContext({ action: 'read' }));
      expect(result.decision).toBe('deny');
      expect(result.source).toBe('classifier');
    });

    test('hook can override deny to allow', () => {
      const allowHook: PermissionHook = () => 'allow';
      orchestrator.addHook(allowHook);

      const result = orchestrator.decide(createContext({ action: 'delete' }));
      expect(result.decision).toBe('allow');
    });

    test('multiple hooks chain in order', () => {
      const hook1: PermissionHook = (_ctx, decision) => {
        return decision === 'allow' ? 'deny' : 'allow';
      };
      const hook2: PermissionHook = (_ctx, decision) => {
        return decision === 'allow' ? 'deny' : 'allow';
      };
      orchestrator.addHook(hook1);
      orchestrator.addHook(hook2);

      // read -> allow -> deny (hook1) -> allow (hook2)
      const result = orchestrator.decide(createContext({ action: 'read' }));
      expect(result.decision).toBe('allow');
    });

    test('hook receives correct context and decision', () => {
      const spyHook: PermissionHook = jest.fn((ctx, decision) => decision);
      orchestrator.addHook(spyHook);

      const ctx = createContext({ action: 'read', agentId: 'agent-42', resource: '/path' });
      orchestrator.decide(ctx);

      expect(spyHook).toHaveBeenCalledWith(ctx, 'allow');
    });
  });

  describe('zone rule priority', () => {
    test('zone rule takes priority over classifier', () => {
      orchestrator.addZoneRule({
        zoneId: 'zone-1',
        actions: ['delete'],
        default: 'allow',
      });

      const result = orchestrator.decide(
        createContext({ action: 'delete', params: { zoneId: 'zone-1' } })
      );
      expect(result.decision).toBe('allow');
      expect(result.source).toBe('zone_rule');
    });

    test('zone rule with deny overrides classifier allow', () => {
      orchestrator.addZoneRule({
        zoneId: 'zone-1',
        actions: ['read'],
        default: 'deny',
      });

      const result = orchestrator.decide(
        createContext({ action: 'read', params: { zoneId: 'zone-1' } })
      );
      expect(result.decision).toBe('deny');
      expect(result.source).toBe('zone_rule');
    });

    test('zone rule only matches if zoneId matches', () => {
      orchestrator.addZoneRule({
        zoneId: 'zone-1',
        actions: ['delete'],
        default: 'allow',
      });

      const result = orchestrator.decide(
        createContext({ action: 'delete', params: { zoneId: 'zone-2' } })
      );
      // Should fall through to classifier since zone doesn't match
      expect(result.decision).toBe('deny');
      expect(result.source).toBe('classifier');
    });

    test('zone rule only matches if action matches', () => {
      orchestrator.addZoneRule({
        zoneId: 'zone-1',
        actions: ['read'],
        default: 'allow',
      });

      const result = orchestrator.decide(
        createContext({ action: 'delete', params: { zoneId: 'zone-1' } })
      );
      // Should fall through to classifier since action doesn't match
      expect(result.decision).toBe('deny');
      expect(result.source).toBe('classifier');
    });

    test('zone rule with ask returns ask', () => {
      orchestrator.addZoneRule({
        zoneId: 'zone-1',
        actions: ['write'],
        default: 'ask',
      });

      const result = orchestrator.decide(
        createContext({ action: 'write', params: { zoneId: 'zone-1' } })
      );
      expect(result.decision).toBe('ask');
      expect(result.source).toBe('zone_rule');
    });
  });

  describe('addZoneRule', () => {
    test('adds rule to orchestrator', () => {
      orchestrator.addZoneRule({
        zoneId: 'zone-1',
        actions: ['read'],
        default: 'allow',
      });

      const result = orchestrator.decide(
        createContext({ action: 'read', params: { zoneId: 'zone-1' } })
      );
      expect(result.decision).toBe('allow');
      expect(result.source).toBe('zone_rule');
    });
  });

  describe('decision result structure', () => {
    test('returns decision property', () => {
      const result = orchestrator.decide(createContext({ action: 'read' }));
      expect(result).toHaveProperty('decision');
      expect(['allow', 'deny', 'ask']).toContain(result.decision);
    });

    test('returns source property', () => {
      const result = orchestrator.decide(createContext({ action: 'read' }));
      expect(result).toHaveProperty('source');
      expect(['zone_rule', 'classifier', 'hook', 'user_dialog']).toContain(result.source);
    });

    test('returns reason when available', () => {
      const result = orchestrator.decide(createContext({ action: 'read' }));
      expect(result).toHaveProperty('reason');
      expect(typeof result.reason).toBe('string');
    });
  });
});
