// ============================================
// Bootstrap Module - Barrel Export
// Phase 4: P4-06 - Bootstrap Module
// ============================================

export { BootstrapEngine, createBootstrapEngine } from './BootstrapEngine';
export type {
  BootstrapEvent,
  BootstrapEventType,
  BootstrapEngineDependencies,
} from './BootstrapEngine';

export { DiscoveryEngine } from './DiscoveryEngine';
export type {
  LessonEntry,
  HistoryEntry,
  ExternalSuggestion,
  ILessonManager,
  IExternalSource,
  IHistoryStore,
} from './DiscoveryEngine';

export { DecisionEngine, createDecisionEngine } from './DecisionEngine';
export type { DecisionEngineDeps } from './DecisionEngine';

export { ImpactEvaluator } from './ImpactEvaluator';

export { RegressionGuard } from './RegressionGuard';

export type * from './types';
