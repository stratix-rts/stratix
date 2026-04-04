// ============================================
// Guardian Module Entry
// Phase 1: Guardian Path Protection + Circuit Breaker
// ============================================

export { Guardian } from './Guardian';
export { PathProtection, ValidationResult } from './PathProtection';
export { CircuitBreakerClass as CircuitBreaker } from './CircuitBreaker';
export type { CircuitBreakerConfig, CircuitBreakerEvents, CircuitState } from './CircuitBreaker';
export { PermissionMatrixClass as PermissionMatrix } from './PermissionMatrix';
export type { PermissionCheckResult } from './PermissionMatrix';
export type { GuardianConfig, GuardianValidationResult } from './Guardian';
