/**
 * 颜色系统
 * 
 * Cyberpunk 风格配色
 * 支持三个主题切换
 */

export const Colors = {
  // ============ 基础色板 ============
  
  /** 青色系 (Cyberpunk 主色) */
  cyan: {
    50: '#E0FFFF',
    100: '#B3F5FF',
    200: '#80EBFF',
    300: '#4DE0FF',
    400: '#1AD6FF',
    500: '#00CCCC',
    600: '#0099A3',
    700: '#00667A',
    800: '#003352',
    900: '#001A29',
  },
  
  /** 品红色系 (Cyberpunk 辅色) */
  magenta: {
    50: '#FFE0FF',
    100: '#FFB3FF',
    200: '#FF80FF',
    300: '#FF4DFF',
    400: '#FF1AFF',
    500: '#E600E6',
    600: '#B300B3',
    700: '#800080',
    800: '#4D004D',
    900: '#260026',
  },
  
  /** 蓝色系 (Minimal/Professional 主色) */
  indigo: {
    50: '#EEF2FF',
    100: '#E0E7FF',
    200: '#C7D2FE',
    300: '#A5B4FC',
    400: '#818CF8',
    500: '#6366F1',
    600: '#4F46E5',
    700: '#4338CA',
    800: '#3730A3',
    900: '#312E81',
  },
  
  // ============ 语义色板 ============
  
  /** 成功色 */
  success: '#00ff88',
  
  /** 警告色 */
  warning: '#fbbf24',
  
  /** 危险色 */
  danger: '#ff4444',
  
  /** 信息色 */
  info: '#00d4ff',
  
  // ============ 中性色 ============
  
  /** 黑白色板 */
  gray: {
    50: '#FAFAFA',
    100: '#F5F5F5',
    200: '#E5E5E5',
    300: '#D4D4D4',
    400: '#A3A3A3',
    500: '#737373',
    600: '#525252',
    700: '#404040',
    800: '#262626',
    900: '#171717',
    950: '#0A0A0A',
  },
} as const;

/** Cyberpunk 主题颜色 */
export const CyberpunkColors = {
  primary: Colors.cyan[500],
  secondary: Colors.magenta[500],
  accent: Colors.cyan[400],
  
  background: {
    primary: '#0d0d14',
    secondary: '#12121a',
    tertiary: '#1a1a2e',
  },
  
  border: {
    default: '#2a2a3e',
    subtle: '#1e1e2e',
    strong: '#3a3a5e',
  },
  
  text: {
    primary: '#ffffff',
    secondary: '#a0a0a0',
    muted: '#6a6a8a',
    disabled: '#4a4a6a',
  },
  
  semantic: {
    success: Colors.success,
    warning: Colors.warning,
    danger: Colors.danger,
    info: Colors.info,
  },
} as const;

/** Minimal 主题颜色 */
export const MinimalColors = {
  primary: Colors.indigo[600],
  secondary: Colors.indigo[400],
  accent: Colors.indigo[500],
  
  background: {
    primary: '#ffffff',
    secondary: '#f8fafc',
    tertiary: '#f1f5f9',
  },
  
  border: {
    default: '#e2e8f0',
    subtle: '#f1f5f9',
    strong: '#cbd5e1',
  },
  
  text: {
    primary: '#0f172a',
    secondary: '#475569',
    muted: '#94a3b8',
    disabled: '#cbd5e1',
  },
  
  semantic: {
    success: '#22c55e',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#3b82f6',
  },
} as const;

/** Professional 主题颜色 */
export const ProfessionalColors = {
  primary: Colors.indigo[800],
  secondary: Colors.indigo[600],
  accent: Colors.indigo[700],
  
  background: {
    primary: '#f8fafc',
    secondary: '#ffffff',
    tertiary: '#f1f5f9',
  },
  
  border: {
    default: '#cbd5e1',
    subtle: '#e2e8f0',
    strong: '#94a3b8',
  },
  
  text: {
    primary: '#1e293b',
    secondary: '#475569',
    muted: '#64748b',
    disabled: '#94a3b8',
  },
  
  semantic: {
    success: '#16a34a',
    warning: '#d97706',
    danger: '#dc2626',
    info: '#2563eb',
  },
} as const;
