// Re-export all test utilities
// why 没有 page-objects（task_017）：旧 Vue 页面对象（AgentDesigner / Project / CharacterCreator）随 legacy 入口一起退役，
// 它们的定位器指向已删除的 DOM；新 UI 的页面对象待 v3 E2E 起步时按新 DOM 重写。
export * from './canvas-screenshot';
export * from './visual-diff';
