/**
 * Stratix Hero Designer - 英雄设计器模块
 *
 * 提供 Agent 配置生成、模板管理和设计验证功能。
 */
export { StratixHeroDesigner } from './StratixHeroDesigner';
export type { HeroDesignerOptions } from './StratixHeroDesigner';
export { ConfigValidator, ConfigConverter } from './utils';
export type { ValidationResult, ValidationError, OpenClawAgentConfig, OpenClawTool } from './utils';
export { WriterHeroTemplate, DevHeroTemplate, AnalystHeroTemplate, generateAgentId, generateSkillId, getHeroColor } from './templates';
export type { HeroType, HeroTemplateBase } from './templates';
export * from './components';
