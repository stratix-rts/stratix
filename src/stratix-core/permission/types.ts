/**
 * Permission system types for Stratix
 */

/**
 * Context provided when checking a permission decision
 */
export interface PermissionContext {
  /** The action being performed (e.g., 'read', 'write', 'delete') */
  action: string;
  /** Resource being acted upon (e.g., file path, zone ID) */
  resource: string;
  /** ID of the agent requesting permission */
  agentId: string;
  /** Additional context parameters */
  params?: Record<string, unknown>;
}

/**
 * Result of a permission decision
 */
export type PermissionDecision = 'allow' | 'deny' | 'ask';

/**
 * A permission hook that can intercept and override permission decisions
 */
export type PermissionHook = (
  context: PermissionContext,
  decision: PermissionDecision
) => PermissionDecision;

/**
 * A zone-level permission rule
 */
export interface ZoneRule {
  zoneId: string;
  /** Actions this rule applies to (e.g., ['read', 'write']) */
  actions: string[];
  /** Default decision for matching actions */
  default: PermissionDecision;
}

/**
 * Result of a permission check
 */
export interface PermissionResult {
  decision: PermissionDecision;
  reason?: string;
  source: 'zone_rule' | 'classifier' | 'hook' | 'user_dialog';
}
