/**
 * PermissionOrchestrator unit tests
 */

import { PermissionOrchestrator } from '../../../src/stratix-core/permission/PermissionOrchestrator';
import type {
  PermissionContext,
  PermissionHook,
  ZoneRule,
  PermissionResult,
} from '../../../src/stratix-core/permission/types';

function makeContext(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    action: 'read',
    resource: 'file:///test',
    agentId: 'agent-1',
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Tests: constructor
// --------------------------------------------------------------------------

describe('PermissionOrchestrator', () => {
  describe('constructor', () => {
    it('creates empty orchestrator', () => {
      const op = new PermissionOrchestrator();
      expect(op).toBeInstanceOf(PermissionOrchestrator);
    });

    it('accepts initial zone rules', () => {
      const rules: ZoneRule[] = [
        { zoneId: 'zone-1', actions: ['read'], default: 'allow' },
      ];
      const op = new PermissionOrchestrator(rules);
      const result = op.decide(makeContext({ action: 'read', params: { zoneId: 'zone-1' } }));
      expect(result.decision).toBe('allow');
      expect(result.source).toBe('zone_rule');
    });

    it('accepts initial hooks', () => {
      const hook: PermissionHook = (_ctx, decision) => {
        return decision === 'allow' ? 'deny' : decision;
      };
      const op = new PermissionOrchestrator([], [hook]);
      const result = op.decide(makeContext({ action: 'read' }));
      expect(result.decision).toBe('deny');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: addHook / addZoneRule
  // --------------------------------------------------------------------------

  describe('addHook', () => {
    it('addHook registers a hook that can flip decisions', () => {
      const op = new PermissionOrchestrator();
      op.addHook((_ctx, decision) => 'deny');
      const result = op.decide(makeContext({ action: 'read' }));
      expect(result.decision).toBe('deny');
    });

    it('multiple hooks chain in order', () => {
      const op = new PermissionOrchestrator();
      op.addHook((_ctx, _decision) => 'ask');
      op.addHook((_ctx, decision) => (decision === 'ask' ? 'allow' : decision));
      const result = op.decide(makeContext({ action: 'read' }));
      expect(result.decision).toBe('allow');
    });

    it('hook can return the same decision', () => {
      const op = new PermissionOrchestrator();
      op.addHook((_ctx, decision) => decision);
      const result = op.decide(makeContext({ action: 'delete' }));
      expect(result.decision).toBe('deny'); // classifier default for destructive
    });
  });

  describe('addZoneRule', () => {
    it('adds a zone rule that takes priority over classifier', () => {
      const op = new PermissionOrchestrator();
      op.addZoneRule({ zoneId: 'zone-x', actions: ['delete'], default: 'allow' });
      const result = op.decide(
        makeContext({ action: 'delete', params: { zoneId: 'zone-x' } })
      );
      expect(result.decision).toBe('allow');
      expect(result.source).toBe('zone_rule');
    });

    it('zone rule does not match different zoneId', () => {
      const op = new PermissionOrchestrator();
      op.addZoneRule({ zoneId: 'zone-x', actions: ['read'], default: 'allow' });
      const result = op.decide(
        makeContext({ action: 'read', params: { zoneId: 'zone-y' } })
      );
      expect(result.decision).toBe('allow'); // classifier low-risk
      expect(result.source).toBe('classifier');
    });

    it('zone rule does not match different action', () => {
      const op = new PermissionOrchestrator();
      op.addZoneRule({ zoneId: 'zone-x', actions: ['read'], default: 'allow' });
      const result = op.decide(
        makeContext({ action: 'write', params: { zoneId: 'zone-x' } })
      );
      // 'write' is not in LOW_RISK_ACTIONS and not in DESTRUCTIVE_ACTIONS
      // so classifier returns null → falls through to 'ask'
      expect(result.decision).toBe('ask');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: decide – zone rule priority
  // --------------------------------------------------------------------------

  describe('decide – zone rule priority', () => {
    it('zone rule is checked first', () => {
      const op = new PermissionOrchestrator();
      op.addZoneRule({ zoneId: 'zone-1', actions: ['delete'], default: 'deny' });
      const result = op.decide(
        makeContext({ action: 'delete', params: { zoneId: 'zone-1' } })
      );
      expect(result.decision).toBe('deny');
      expect(result.source).toBe('zone_rule');
    });

    it('zone rule with ask decision', () => {
      const op = new PermissionOrchestrator();
      op.addZoneRule({ zoneId: 'zone-1', actions: ['write'], default: 'ask' });
      const result = op.decide(
        makeContext({ action: 'write', params: { zoneId: 'zone-1' } })
      );
      expect(result.decision).toBe('ask');
      expect(result.source).toBe('zone_rule');
    });

    it('multiple zone rules – first match wins', () => {
      const op = new PermissionOrchestrator();
      op.addZoneRule({ zoneId: 'zone-1', actions: ['read'], default: 'deny' });
      op.addZoneRule({ zoneId: 'zone-1', actions: ['read'], default: 'allow' }); // won't be reached
      const result = op.decide(
        makeContext({ action: 'read', params: { zoneId: 'zone-1' } })
      );
      expect(result.decision).toBe('deny');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: decide – classifier (low-risk actions)
  // --------------------------------------------------------------------------

  describe('decide – classifier low-risk actions', () => {
    const lowRisk = ['read', 'query', 'list', 'get', 'search', 'view'];

    lowRisk.forEach((action) => {
      it(`"${action}" is auto-allowed`, () => {
        const op = new PermissionOrchestrator();
        const result = op.decide(makeContext({ action }));
        expect(result.decision).toBe('allow');
        expect(result.source).toBe('classifier');
      });
    });

    it('low-risk action still runs through hooks', () => {
      const op = new PermissionOrchestrator();
      op.addHook((_ctx, decision) => (decision === 'allow' ? 'ask' : decision));
      const result = op.decide(makeContext({ action: 'read' }));
      expect(result.decision).toBe('ask');
      expect(result.source).toBe('classifier');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: decide – classifier (destructive actions)
  // --------------------------------------------------------------------------

  describe('decide – classifier destructive actions', () => {
    const destructive = ['delete', 'destroy', 'remove', 'drop', 'truncate', 'purge', 'erase'];

    destructive.forEach((action) => {
      it(`"${action}" is auto-denied`, () => {
        const op = new PermissionOrchestrator();
        const result = op.decide(makeContext({ action }));
        expect(result.decision).toBe('deny');
        expect(result.source).toBe('classifier');
      });
    });

    it('destructive action can be overridden by hook to allow', () => {
      const op = new PermissionOrchestrator();
      op.addHook((_ctx, _decision) => 'allow');
      const result = op.decide(makeContext({ action: 'delete' }));
      expect(result.decision).toBe('allow');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: decide – fallback (ask)
  // --------------------------------------------------------------------------

  describe('decide – fallback to ask', () => {
    it('ambiguous action falls through to ask', () => {
      const op = new PermissionOrchestrator();
      const result = op.decide(makeContext({ action: 'update' }));
      expect(result.decision).toBe('ask');
      expect(result.source).toBe('user_dialog');
      expect(result.reason).toContain('Ambiguous action');
    });

    it('ambiguous action hook runs before fallback', () => {
      const op = new PermissionOrchestrator();
      op.addHook((_ctx, _decision) => 'allow');
      const result = op.decide(makeContext({ action: 'update' }));
      expect(result.decision).toBe('allow');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: decide – hook chain
  // --------------------------------------------------------------------------

  describe('decide – hook chain', () => {
    it('hooks receive the current decision and can change it', () => {
      const op = new PermissionOrchestrator();
      op.addHook((_ctx, decision) => {
        if (decision === 'ask') return 'allow';
        return decision;
      });
      const result = op.decide(makeContext({ action: 'update' }));
      expect(result.decision).toBe('allow');
    });

    it('hooks receive zone-rule decision', () => {
      const op = new PermissionOrchestrator();
      op.addZoneRule({ zoneId: 'zone-1', actions: ['read'], default: 'deny' });
      op.addHook((_ctx, decision) => {
        if (decision === 'deny') return 'allow';
        return decision;
      });
      const result = op.decide(
        makeContext({ action: 'read', params: { zoneId: 'zone-1' } })
      );
      expect(result.decision).toBe('allow');
    });

    it('reason reflects hook involvement', () => {
      const op = new PermissionOrchestrator();
      op.addHook((_ctx, decision) => decision);
      const result = op.decide(makeContext({ action: 'read' }));
      expect(result.reason).toContain('Classifier');
      expect(result.reason).toContain('hook');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: decide – case insensitivity of action matching
  // --------------------------------------------------------------------------

  describe('decide – action case insensitivity', () => {
    it('treats DELETE as destructive', () => {
      const op = new PermissionOrchestrator();
      const result = op.decide(makeContext({ action: 'DELETE' }));
      expect(result.decision).toBe('deny');
    });

    it('treats Read as low-risk', () => {
      const op = new PermissionOrchestrator();
      const result = op.decide(makeContext({ action: 'Read' }));
      expect(result.decision).toBe('allow');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: decision reason and source fields
  // --------------------------------------------------------------------------

  describe('decide – result shape', () => {
    it('zone_rule result has correct source and reason', () => {
      const op = new PermissionOrchestrator();
      op.addZoneRule({ zoneId: 'z1', actions: ['read'], default: 'allow' });
      const result = op.decide(makeContext({ action: 'read', params: { zoneId: 'z1' } }));
      expect(result.source).toBe('zone_rule');
      expect(result.reason).toContain('z1');
    });

    it('classifier result has correct source', () => {
      const op = new PermissionOrchestrator();
      const result = op.decide(makeContext({ action: 'read' }));
      expect(result.source).toBe('classifier');
    });

    it('user_dialog result has correct source', () => {
      const op = new PermissionOrchestrator();
      const result = op.decide(makeContext({ action: 'custom' }));
      expect(result.source).toBe('user_dialog');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: edge cases
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty action string', () => {
      const op = new PermissionOrchestrator();
      const result = op.decide(makeContext({ action: '' }));
      expect(result.decision).toBe('ask'); // not in any set
    });

    it('handles undefined params', () => {
      const op = new PermissionOrchestrator();
      const ctx = makeContext({ params: undefined });
      const result = op.decide(ctx);
      // No zone match, classifier runs
      expect(['allow', 'deny', 'ask']).toContain(result.decision);
    });

    it('empty agentId in context is valid', () => {
      const op = new PermissionOrchestrator();
      const result = op.decide(makeContext({ agentId: '' }));
      expect(result).toBeDefined();
    });
  });
});
