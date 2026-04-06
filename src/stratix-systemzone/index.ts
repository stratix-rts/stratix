// ============================================
// System Zone 模块入口
// Phase 1: 类型定义 + 数据库 schema
// ============================================

// 导出所有类型
export * from './types';

// 导出 Guardian 模块（显式导出避免命名冲突）
export { Guardian, PathProtection, CircuitBreaker, PermissionMatrix } from './guardian';
export type { ValidationResult, GuardianValidationResult, PermissionCheckResult } from './guardian';

// 导出 Strategist 模块
export { ProjectScanner, ProposalMapper, Strategist, StrategistLLMEnhancer } from './strategist';
export type * from './strategist/types';

// 导出 Observer 模块
export { Observer, InputPreprocessor, InsightExtractor } from './observer';
export type * from './observer/types';

// 导出 SystemZone 主类及相关类型
export {
  SystemZone,
  getDefaultSystemZone,
  resetDefaultSystemZone,
} from './SystemZone';
export type {
  SystemZoneEventType,
  SystemZoneEvent,
  SystemZoneDependencies,
  SystemZoneInitConfig,
  SystemZoneState,
} from './SystemZone';

// 导出 SystemZoneManager
export { SystemZoneManager } from './SystemZoneManager';
