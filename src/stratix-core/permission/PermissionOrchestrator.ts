import type {
  PermissionContext,
  PermissionDecision,
  PermissionHook,
  ZoneRule,
  PermissionResult,
} from './types';

/**
 * Classifier for determining risk level of actions
 */
const LOW_RISK_ACTIONS = new Set(['read', 'query', 'list', 'get', 'search', 'view']);
const DESTRUCTIVE_ACTIONS = new Set([
  'delete',
  'destroy',
  'remove',
  'drop',
  'truncate',
  'purge',
  'erase',
]);

/**
 * Default classifier that auto-allows low-risk actions and auto-denies destructive ones
 */
function defaultClassifier(context: PermissionContext): PermissionDecision | null {
  const action = context.action.toLowerCase();

  if (LOW_RISK_ACTIONS.has(action)) {
    return 'allow';
  }

  if (DESTRUCTIVE_ACTIONS.has(action)) {
    return 'deny';
  }

  return null;
}

/**
 * PermissionOrchestrator decides whether an action should be allowed, denied,
 * or requires user confirmation.
 *
 * Decision flow:
 * 1. Check zone rules (highest priority)
 * 2. Run classifier for default decisions
 * 3. Run permission hooks
 * 4. Show user dialog as fallback (returns 'ask')
 */
export class PermissionOrchestrator {
  private hooks: PermissionHook[] = [];
  private zoneRules: ZoneRule[] = [];

  constructor(rules?: ZoneRule[], hooks?: PermissionHook[]) {
    if (rules) {
      this.zoneRules = rules;
    }
    if (hooks) {
      this.hooks = hooks;
    }
  }

  /**
   * Register a permission hook
   */
  addHook(hook: PermissionHook): void {
    this.hooks.push(hook);
  }

  /**
   * Add a zone rule
   */
  addZoneRule(rule: ZoneRule): void {
    this.zoneRules.push(rule);
  }

  /**
   * Check if a context matches any zone rules
   */
  private checkZoneRules(context: PermissionContext): PermissionDecision | null {
    for (const rule of this.zoneRules) {
      if (rule.zoneId === context.params?.zoneId && rule.actions.includes(context.action)) {
        return rule.default;
      }
    }
    return null;
  }

  /**
   * Run the classifier on the context
   */
  private runClassifier(context: PermissionContext): PermissionDecision | null {
    return defaultClassifier(context);
  }

  /**
   * Run all permission hooks in order
   */
  private runPermissionHooks(
    context: PermissionContext,
    decision: PermissionDecision
  ): PermissionDecision {
    let result = decision;
    for (const hook of this.hooks) {
      result = hook(context, result);
    }
    return result;
  }

  /**
   * Decide whether an action should be allowed
   */
  decide(context: PermissionContext): PermissionResult {
    // Step 1: Check zone rules
    const zoneDecision = this.checkZoneRules(context);
    if (zoneDecision !== null) {
      // Run hooks on zone-rule decision
      const hookDecision = this.runPermissionHooks(context, zoneDecision);
      return {
        decision: hookDecision,
        reason: `Zone rule matched for zone ${context.params?.zoneId}`,
        source: 'zone_rule',
      };
    }

    // Step 2: Run classifier
    const classifierDecision = this.runClassifier(context);
    if (classifierDecision !== null) {
      // Step 3: Run hooks on classifier decision
      const hookDecision = this.runPermissionHooks(context, classifierDecision);
      return {
        decision: hookDecision,
        reason: `Classifier ${classifierDecision} → hook ${hookDecision}`,
        source: 'classifier',
      };
    }

    // Step 4: Fallback to ask (user dialog) - run hooks on ask decision
    const fallbackDecision = this.runPermissionHooks(context, 'ask');
    return {
      decision: fallbackDecision,
      reason: 'Ambiguous action, user confirmation required',
      source: 'user_dialog',
    };
  }
}
