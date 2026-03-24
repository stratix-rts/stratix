/**
 * 增强的 Soul 配置类型定义
 * 兼容原有 SoulConfig 并扩展新功能
 */

/**
 * 反思配置
 */
export interface ReflectionConfig {
  enabled: boolean;
  afterEachTask: boolean;
  onError: boolean;
  weeklyReview: boolean;
}

/**
 * 学习偏好配置
 */
export interface LearningConfig {
  preferExamples: boolean;
  explanationLevel: 'brief' | 'detailed' | 'comprehensive';
  feedbackPreference: 'immediate' | 'delayed' | 'none';
}

/**
 * 增强的 Soul 配置
 * 包含原有字段 + 新增的增强字段
 */
export interface EnhancedSoulConfig {
  // 基础属性 (兼容原有 SoulConfig)
  identity?: string;
  personality?: string;
  goals?: string[];
  constraints?: string[];
  speakingStyle?: string;

  // 增强属性
  mission?: string;
  tone?: string;
  values?: string[];
  workingMode?: 'autonomous' | 'collaborative' | 'supervised';

  // 反思机制
  reflection?: ReflectionConfig;

  // 学习偏好
  learning?: LearningConfig;

  // 禁止行为
  forbiddenActions?: string[];

  // 说话风格 (别名)
  speaking_style?: string;

  // 核心使命 (alias for mission)
  core_mission?: string;
}

/**
 * 反思历史条目
 */
export interface ReflectionEntry {
  id: string;
  timestamp: string;
  task: string;
  result: string;
  reflection: string;
  improvements?: string[];
  lessonsLearned?: string[];
}

/**
 * 反思摘要
 */
export interface ReflectionSummary {
  period: string;
  totalReflections: number;
  commonThemes: string[];
  improvements: string[];
  nextSteps: string[];
}
