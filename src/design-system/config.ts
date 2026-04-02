/**
 * Stratix Design System 主配置
 * 
 * 修改此处快速切换整体风格
 */

import type { CompleteSemanticTokens } from './semantic/_generator';
import { generateAllSemanticTokens } from './semantic/_generator';
import { CyberpunkTheme } from './themes/cyberpunk';
import { MinimalTheme } from './themes/minimal';
import { ProfessionalTheme } from './themes/professional';
import type { DesignSystemTokens, ColorPrimitives } from './types';

export const DesignSystemConfig = {
  activeTheme: 'cyberpunk' as 'cyberpunk' | 'minimal' | 'professional',
  themes: {
    cyberpunk: CyberpunkTheme,
    minimal: MinimalTheme,
    professional: ProfessionalTheme,
  } as const,
  icons: {
    library: 'mixed' as const,
    svgDir: './src/design-system/icons/lucide',
    customDir: './src/design-system/icons/custom',
  },
  documentation: {
    concise: true,
    includeExamples: true,
    fullTypes: true,
  },
  cssVariables: {
    enabled: true,
    prefix: 'ds',
  },
};

export function getCurrentTheme(): DesignSystemTokens {
  return DesignSystemConfig.themes[DesignSystemConfig.activeTheme];
}

export function getSemanticTokens(): CompleteSemanticTokens {
  const theme = getCurrentTheme();
  return generateAllSemanticTokens(
    theme.colors as ColorPrimitives,
    theme.radii,
    theme.shadows
  );
}

export function setTheme(
  themeName: keyof typeof DesignSystemConfig.themes,
  options?: { injectCSS?: boolean; persist?: boolean }
): void {
  const { injectCSS = true, persist = true } = options || {};
  DesignSystemConfig.activeTheme = themeName;
  
  if (injectCSS && typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', themeName);
    injectThemeCSSVariables();
  }
  
  if (persist && typeof localStorage !== 'undefined') {
    localStorage.setItem('stratix-theme', themeName);
  }
  
  if (typeof window !== 'undefined') {
    dispatchEvent(new CustomEvent('theme:change', { 
      detail: { 
        theme: themeName,
        tokens: getCurrentTheme(),
        semantic: getSemanticTokens(),
      }
    }));
  }
}

export function injectThemeCSSVariables(): void {
  if (typeof document === 'undefined') return;
  
  const theme = getCurrentTheme();
  const semantic = getSemanticTokens();
  const colors = theme.colors as ColorPrimitives;
  const prefix = DesignSystemConfig.cssVariables.prefix;
  
  const variables: string[] = [];
  
  // 品牌色
  variables.push(`--${prefix}-color-primary: ${colors.brand.primary};`);
  variables.push(`--${prefix}-color-secondary: ${colors.brand.secondary};`);
  variables.push(`--${prefix}-color-accent: ${colors.brand.accent};`);
  
  // 向后兼容：旧的品牌色变量名
  variables.push(`--${prefix}-primary: ${colors.brand.primary};`);
  variables.push(`--${prefix}-secondary: ${colors.brand.secondary};`);
  variables.push(`--${prefix}-accent: ${colors.brand.accent};`);
  
  // 背景色
  variables.push(`--${prefix}-bg-base: ${colors.background.base};`);
  variables.push(`--${prefix}-bg-elevated: ${colors.background.elevated};`);
  variables.push(`--${prefix}-bg-overlay: ${colors.background.overlay};`);
  variables.push(`--${prefix}-bg-sunken: ${colors.background.sunken};`);
  
  // 向后兼容：旧的背景色变量名
  variables.push(`--${prefix}-bg-primary: ${colors.background.base};`);
  variables.push(`--${prefix}-bg-secondary: ${colors.background.elevated};`);
  variables.push(`--${prefix}-bg-tertiary: ${colors.background.overlay};`);
  
  // 文字色
  variables.push(`--${prefix}-text-primary: ${colors.text.primary};`);
  variables.push(`--${prefix}-text-secondary: ${colors.text.secondary};`);
  variables.push(`--${prefix}-text-muted: ${colors.text.muted};`);
  variables.push(`--${prefix}-text-disabled: ${colors.text.disabled};`);
  
  // 向后兼容：简写的文字色变量名
  variables.push(`--${prefix}-text: ${colors.text.primary};`);
  
  // 边框色
  variables.push(`--${prefix}-border-default: ${colors.border.default};`);
  variables.push(`--${prefix}-border-subtle: ${colors.border.subtle};`);
  variables.push(`--${prefix}-border-strong: ${colors.border.strong};`);
  variables.push(`--${prefix}-border-focus: ${colors.border.focus};`);
  
  // 向后兼容：简写的边框变量名
  variables.push(`--${prefix}-border: ${colors.border.default};`);
  
  // 状态色
  variables.push(`--${prefix}-status-success: ${colors.status.success};`);
  variables.push(`--${prefix}-status-warning: ${colors.status.warning};`);
  variables.push(`--${prefix}-status-danger: ${colors.status.danger};`);
  variables.push(`--${prefix}-status-info: ${colors.status.info};`);
  
  // 向后兼容：简写的状态色变量名
  variables.push(`--${prefix}-success: ${colors.status.success};`);
  variables.push(`--${prefix}-warning: ${colors.status.warning};`);
  variables.push(`--${prefix}-danger: ${colors.status.danger};`);
  variables.push(`--${prefix}-info: ${colors.status.info};`);
  
  (Object.keys(semantic.button) as Array<keyof typeof semantic.button>).forEach((variant) => {
    const btn = semantic.button[variant];
    const varPrefix = `--${prefix}-btn-${variant}`;
    variables.push(`${varPrefix}-bg: ${btn.background};`);
    variables.push(`${varPrefix}-bg-hover: ${btn.backgroundHover};`);
    variables.push(`${varPrefix}-text: ${btn.text};`);
  });
  
  (Object.keys(semantic.panel) as Array<keyof typeof semantic.panel>).forEach((variant) => {
    const panel = semantic.panel[variant];
    const varPrefix = `--${prefix}-panel-${variant}`;
    variables.push(`${varPrefix}-bg: ${panel.background};`);
    variables.push(`${varPrefix}-shadow: ${panel.shadow};`);
  });
  
  variables.push(`--${prefix}-radius-sm: ${theme.radii.sm};`);
  variables.push(`--${prefix}-radius-md: ${theme.radii.md};`);
  variables.push(`--${prefix}-radius-lg: ${theme.radii.lg};`);
  variables.push(`--${prefix}-shadow-sm: ${theme.shadows.sm};`);
  variables.push(`--${prefix}-shadow-md: ${theme.shadows.md};`);
  variables.push(`--${prefix}-shadow-lg: ${theme.shadows.lg};`);
  
  const styleId = 'stratix-theme-variables';
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  
  styleEl.textContent = `:root {\n  ${variables.join('\n  ')}\n}`;
}

export function restoreThemeFromStorage(): void {
  if (typeof localStorage === 'undefined') return;
  const saved = localStorage.getItem('stratix-theme');
  if (saved && saved in DesignSystemConfig.themes) {
    setTheme(saved as any, { persist: false });
  }
}

export function onThemeChange(
  callback: (event: { theme: string; tokens: DesignSystemTokens; semantic: CompleteSemanticTokens }) => void
): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    callback({
      theme: detail.theme,
      tokens: detail.tokens,
      semantic: detail.semantic,
    });
  };
  
  window.addEventListener('theme:change', handler);
  return () => window.removeEventListener('theme:change', handler);
}

export function initDesignSystem(): void {
  restoreThemeFromStorage();
  injectThemeCSSVariables();
}

export function isThemeAvailable(name: string): boolean {
  return name in DesignSystemConfig.themes;
}

export function getAvailableThemes(): string[] {
  return Object.keys(DesignSystemConfig.themes);
}

/**
 * 旧路径到新路径的映射表（向后兼容）
 */
const TOKEN_PATH_MAPPING: Record<string, string> = {
  // 背景色映射
  'colors.background.primary': 'colors.background.base',
  'colors.background.secondary': 'colors.background.elevated',
  'colors.background.tertiary': 'colors.background.overlay',
  
  // 品牌色映射
  'colors.primary': 'colors.brand.primary',
  'colors.secondary': 'colors.brand.secondary',
  'colors.accent': 'colors.brand.accent',
  
  // 状态色映射
  'colors.semantic.success': 'colors.status.success',
  'colors.semantic.warning': 'colors.status.warning',
  'colors.semantic.danger': 'colors.status.danger',
  'colors.semantic.info': 'colors.status.info',
  'colors.info': 'colors.status.info',
  'colors.warning': 'colors.status.warning',
  'colors.success': 'colors.status.success',
  'colors.danger': 'colors.status.danger',
};

/**
 * 将旧路径转换为新路径
 */
function mapTokenPath(path: string): string {
  return TOKEN_PATH_MAPPING[path] || path;
}

export function getToken(path: string): any {
  const theme = getCurrentTheme();
  
  // 处理语义 Token 路径
  if (path.startsWith('semantic.')) {
    const semantic = getSemanticTokens();
    const parts = path.replace('semantic.', '').split('.');
    return parts.reduce((obj: any, key) => obj?.[key], semantic);
  }
  
  // 映射旧路径到新路径
  const mappedPath = mapTokenPath(path);
  const parts = mappedPath.split('.');
  
  // 逐级访问对象属性
  let result: any = theme;
  for (const part of parts) {
    if (result === undefined || result === null) {
      console.warn(`[DesignSystem] Token path not found: "${path}" (mapped to "${mappedPath}")`);
      return undefined;
    }
    result = result[part];
  }
  
  return result;
}

export function getTokens(paths: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  paths.forEach(path => {
    result[path] = getToken(path);
  });
  return result;
}
