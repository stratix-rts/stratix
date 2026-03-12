/**
 * 颜色系统 - 完整版
 * 
 * 设计原则：
 * 1. 基础色板 (Primitives): 纯颜色值，无语义
 * 2. 主题色板 (Themes): 将基础色板映射到主题
 * 3. 语义颜色 (Semantic): 从主题色板派生，随主题变化
 * 
 * 参考：Carbon Design System, Atlassian Design System
 */

// ============ 基础色板 (Primitives) ============

/** 青色系 - Cyberpunk 主色 */
export const Cyan = {
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
  950: '#000D14',
} as const;

/** 品红色系 - Cyberpunk 辅色 */
export const Magenta = {
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
  950: '#130013',
} as const;

/** 靛蓝色系 - Minimal/Professional 主色 */
export const Indigo = {
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
  950: '#1E1B4B',
} as const;

/** 中性灰色系 */
export const Gray = {
  0: '#FFFFFF',
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
  1000: '#000000',
} as const;

/**  Slate 灰色系 (冷灰) - Professional 主题 */
export const Slate = {
  50: '#F8FAFC',
  100: '#F1F5F9',
  200: '#E2E8F0',
  300: '#CBD5E1',
  400: '#94A3B8',
  500: '#64748B',
  600: '#475569',
  700: '#334155',
  800: '#1E293B',
  900: '#0F172A',
  950: '#020617',
} as const;

/** 功能色板 - 成功 */
export const Green = {
  50: '#F0FDF4',
  100: '#DCFCE7',
  200: '#BBF7D0',
  300: '#86EFAC',
  400: '#4ADE80',
  500: '#22C55E',
  600: '#16A34A',
  700: '#15803D',
  800: '#166534',
  900: '#14532D',
  950: '#052E16',
} as const;

/** 功能色板 - 警告 */
export const Amber = {
  50: '#FFFBEB',
  100: '#FEF3C7',
  200: '#FDE68A',
  300: '#FCD34D',
  400: '#FBBF24',
  500: '#F59E0B',
  600: '#D97706',
  700: '#B45309',
  800: '#92400E',
  900: '#78350F',
  950: '#451A03',
} as const;

/** 功能色板 - 危险 */
export const Red = {
  50: '#FEF2F2',
  100: '#FEE2E2',
  200: '#FECACA',
  300: '#FCA5A5',
  400: '#F87171',
  500: '#EF4444',
  600: '#DC2626',
  700: '#B91C1C',
  800: '#991B1B',
  900: '#7F1D1D',
  950: '#450A0A',
} as const;

/** 功能色板 - 信息 */
export const Blue = {
  50: '#EFF6FF',
  100: '#DBEAFE',
  200: '#BFDBFE',
  300: '#93C5FD',
  400: '#60A5FA',
  500: '#3B82F6',
  600: '#2563EB',
  700: '#1D4ED8',
  800: '#1E40AF',
  900: '#1E3A8A',
  950: '#172554',
} as const;

/** 紫罗兰色系 */
export const Violet = {
  50: '#F5F3FF',
  100: '#EDE9FE',
  200: '#DDD6FE',
  300: '#C4B5FD',
  400: '#A78BFA',
  500: '#8B5CF6',
  600: '#7C3AED',
  700: '#6D28D9',
  800: '#5B21B6',
  900: '#4C1D95',
  950: '#2E1065',
} as const;

// ============ 主题色板 (Theme Primitives) ============

/** 
 * Cyberpunk 主题色板
 * 深色背景，高对比度，霓虹强调色
 */
export const CyberpunkPrimitives = {
  // 品牌色
  brand: {
    primary: Cyan[500],
    secondary: Magenta[500],
    accent: Cyan[400],
  },
  
  // 背景色 (分层级)
  background: {
    base: '#0d0d14',        // 最底层
    elevated: '#12121a',    // 卡片、面板
    overlay: '#1a1a2e',     // 悬浮、下拉
    sunken: '#08080c',      // 输入框、凹陷区域
  },
  
  // 边框色
  border: {
    subtle: '#1e1e2e',      // 最淡的分隔
    default: '#2a2a3e',     // 标准边框
    strong: '#3a3a5e',      // 强调边框
    focus: Cyan[500],       // 聚焦状态
  },
  
  // 文字色
  text: {
    primary: '#ffffff',
    secondary: '#a0a0b0',
    muted: '#6a6a8a',
    disabled: '#4a4a6a',
    inverse: '#0d0d14',     // 用于亮色背景上的文字
  },
  
  // 功能色
  status: {
    success: '#00ff88',     // 霓虹绿
    warning: '#fbbf24',     // 琥珀色
    danger: '#ff4444',      // 霓虹红
    info: '#00d4ff',        // 青色
  },
  
  // 交互色
  interactive: {
    default: Cyan[500],
    hover: Cyan[400],
    active: Cyan[600],
    disabled: Gray[600],
  },
} as const;

/**
 * Minimal 主题色板
 * 浅色背景，清晰层次，靛蓝强调
 */
export const MinimalPrimitives = {
  brand: {
    primary: Indigo[600],
    secondary: Indigo[400],
    accent: Violet[500],     // 使用紫色作为强调色，更活泼
  },
  
  background: {
    base: '#ffffff',         // 纯白背景
    elevated: '#fafafa',     // 极浅的灰色
    overlay: '#f5f5f5',      // 更中性的灰
    sunken: '#eeeeee',       // 中性灰
  },
  
  border: {
    subtle: '#f0f0f0',       // 更中性的浅色边框
    default: '#e0e0e0',
    strong: '#bdbdbd',
    focus: Indigo[500],
  },
  
  text: {
    primary: '#212121',      // 近黑色，更中性
    secondary: '#616161',
    muted: '#9e9e9e',
    disabled: '#bdbdbd',
    inverse: '#ffffff',
  },
  
  status: {
    success: Green[600],
    warning: Amber[500],
    danger: Red[500],
    info: Blue[500],
  },
  
  interactive: {
    default: Indigo[600],
    hover: Indigo[500],
    active: Indigo[700],
    disabled: Slate[300],
  },
} as const;

/**
 * Professional 主题色板
 * 商务风格，深蓝灰色系
 */
export const ProfessionalPrimitives = {
  brand: {
    primary: Blue[700],
    secondary: Slate[500],
    accent: Blue[600],
  },
  
  background: {
    base: '#f1f5f9',        // 比 Minimal 更深的灰蓝色背景
    elevated: '#ffffff',     // 卡片纯白
    overlay: '#e2e8f0',      // 悬浮层更深
    sunken: '#cbd5e1',       // 凹陷区域
  },
  
  border: {
    subtle: '#cbd5e1',       // 更明显的边框
    default: '#94a3b8',
    strong: '#64748b',
    focus: Blue[600],
  },
  
  text: {
    primary: Slate[900],     // 更深的文字颜色
    secondary: Slate[700],
    muted: Slate[500],
    disabled: Slate[400],
    inverse: '#ffffff',
  },
  
  status: {
    success: Green[700],
    warning: Amber[600],
    danger: Red[600],
    info: Blue[600],
  },
  
  interactive: {
    default: Blue[800],
    hover: Blue[700],
    active: Blue[900],
    disabled: Slate[400],
  },
} as const;

// ============ 向后兼容导出 ============

/** @deprecated 使用 CyberpunkPrimitives */
export const CyberpunkColors = CyberpunkPrimitives;
/** @deprecated 使用 MinimalPrimitives */
export const MinimalColors = MinimalPrimitives;
/** @deprecated 使用 ProfessionalPrimitives */
export const ProfessionalColors = ProfessionalPrimitives;

/** @deprecated 使用基础色板常量 */
export const Colors = {
  cyan: Cyan,
  magenta: Magenta,
  indigo: Indigo,
  gray: Gray,
  success: '#00ff88',
  warning: '#fbbf24',
  danger: '#ff4444',
  info: '#00d4ff',
} as const;
