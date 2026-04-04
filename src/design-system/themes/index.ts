/**
 * 主题系统聚合导出
 * 
 * 可用主题：
 * - Cyberpunk: 赛博朋克风格（默认）
 * - Minimal: 极简风格
 * - Professional: 商务风格
 */


// 主题配置
export { CyberpunkTheme, CyberpunkRadii, CyberpunkShadows, CyberpunkTypography } from './cyberpunk';
export { MinimalTheme, MinimalRadii, MinimalShadows, MinimalTypography } from './minimal';
export { ProfessionalTheme, ProfessionalRadii, ProfessionalShadows, ProfessionalTypography } from './professional';

// 主题元数据
export interface ThemeMeta {
  id: string;
  name: string;
  description: string;
  preview: {
    primary: string;
    background: string;
    text: string;
  };
}

export const ThemeRegistry: Record<string, ThemeMeta> = {
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: '深色背景，高对比度，霓虹强调色',
    preview: {
      primary: '#00ffff',
      background: '#0d0d14',
      text: '#ffffff',
    },
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description: '浅色背景，圆润边角，清晰层次',
    preview: {
      primary: '#4F46E5',
      background: '#ffffff',
      text: '#0f172a',
    },
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    description: '商务风格，深蓝灰色系',
    preview: {
      primary: '#1E40AF',
      background: '#f8fafc',
      text: '#1e293b',
    },
  },
};

// 主题工具函数

/**
 * 获取主题元数据
 */
export function getThemeMeta(themeId: string): ThemeMeta | undefined {
  return ThemeRegistry[themeId];
}

/**
 * 获取所有可用主题列表
 */
export function getAllThemes(): ThemeMeta[] {
  return Object.values(ThemeRegistry);
}

/**
 * 获取主题预览样式
 */
export function getThemePreviewStyles(themeId: string): Record<string, string> {
  const meta = getThemeMeta(themeId);
  if (!meta) return {};
  
  return {
    backgroundColor: meta.preview.background,
    color: meta.preview.text,
    borderColor: meta.preview.primary,
    '--theme-primary': meta.preview.primary,
    '--theme-bg': meta.preview.background,
    '--theme-text': meta.preview.text,
  } as Record<string, string>;
}
