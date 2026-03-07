/**
 * Stratix Design System 主配置
 * 
 * 修改此处快速切换整体风格
 */

import type { DesignSystemTokens, TokenValue, TokenPath } from './types';
import { CyberpunkTheme } from './themes/cyberpunk';
import { MinimalTheme } from './themes/minimal';
import { ProfessionalTheme } from './themes/professional';

/**
 * 设计系统配置
 */
export const DesignSystemConfig = {
  /** 当前激活的主题 */
  activeTheme: 'cyberpunk' as 'cyberpunk' | 'minimal' | 'professional',
  
  /** 可用主题列表 */
  themes: {
    cyberpunk: CyberpunkTheme,
    minimal: MinimalTheme,
    professional: ProfessionalTheme,
  } as const,
  
  /** 图标库配置 */
  icons: {
    library: 'mixed' as const,
    svgDir: './src/design-system/icons/lucide',
    customDir: './src/design-system/icons/custom',
  },
  
  /** 文档配置 */
  documentation: {
    concise: true,
    includeExamples: true,
    fullTypes: true,
  },
};

/**
 * 获取当前主题
 */
export function getCurrentTheme(): DesignSystemTokens {
  return DesignSystemConfig.themes[DesignSystemConfig.activeTheme];
}

/**
 * 切换主题（运行时）
 */
export function setTheme(themeName: keyof typeof DesignSystemConfig.themes): void {
  DesignSystemConfig.activeTheme = themeName;
  
  // 更新 CSS 变量
  document.documentElement.setAttribute('data-theme', themeName);
  
  // 触发主题更新事件
  dispatchEvent(new CustomEvent('theme:change', { detail: themeName }));
}

/**
 * 获取 Token 值（语义化访问）
 * 
 * @example
 * getToken('colors.primary')
 * getToken('button.primary.background')
 */
export function getToken<T extends string>(path: T): TokenValue<T> {
  const theme = getCurrentTheme();
  return path.split('.').reduce((obj, key) => obj[key as keyof typeof obj], theme as any);
}

/**
 * 批量获取 Tokens
 */
export function getTokens(paths: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  paths.forEach(path => {
    result[path] = getToken(path);
  });
  return result;
}

/**
 * 检查主题是否可用
 */
export function isThemeAvailable(name: string): boolean {
  return name in DesignSystemConfig.themes;
}

/**
 * 获取所有主题名称
 */
export function getAvailableThemes(): string[] {
  return Object.keys(DesignSystemConfig.themes);
}
