// ============================================
// System Zone 模块入口
// Phase 1: 类型定义 + 数据库 schema
// ============================================

// 导出所有类型
export * from './types';

// 导出 Guardian 模块（显式导出避免命名冲突）
export { Guardian, PathProtection, CircuitBreaker, PermissionMatrix } from './guardian';
export type { ValidationResult, GuardianValidationResult, PermissionCheckResult } from './guardian';
