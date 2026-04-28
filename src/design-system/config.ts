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
import type { DesignSystemTokens } from './types';
import { isColorPrimitives } from './types';

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

/**
 * 语义 Token 缓存
 * 避免每次调用 getSemanticTokens 时重复计算
 */
let _semanticTokenCache: {
  theme: string;
  tokens: CompleteSemanticTokens;
} | null = null;

export function getCurrentTheme(): DesignSystemTokens {
  return DesignSystemConfig.themes[DesignSystemConfig.activeTheme];
}

/**
 * 获取语义 Token（带缓存）
 * 在同主题下多次调用会返回缓存结果
 */
export function getSemanticTokens(): CompleteSemanticTokens {
  const themeName = DesignSystemConfig.activeTheme;

  if (_semanticTokenCache && _semanticTokenCache.theme === themeName) {
    return _semanticTokenCache.tokens;
  }

  const theme = getCurrentTheme();
  const colors = isColorPrimitives(theme.colors) ? theme.colors : theme.colors as any;

  const tokens = generateAllSemanticTokens(
    colors,
    theme.radii,
    theme.shadows
  );

  _semanticTokenCache = { theme: themeName, tokens };
  return tokens;
}

/**
 * 使语义 Token 缓存失效
 * 在手动修改主题配置后调用
 */
export function invalidateSemanticTokenCache(): void {
  _semanticTokenCache = null;
}

export function setTheme(
  themeName: keyof typeof DesignSystemConfig.themes,
  options?: { injectCSS?: boolean; persist?: boolean }
): void {
  const { injectCSS = true, persist = true } = options || {};

  if (DesignSystemConfig.activeTheme !== themeName) {
    _semanticTokenCache = null;
  }

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

/**
 * 将语义 Token 对象展平为 CSS 变量字符串数组
 */
function flattenSemanticTokens(
  semantic: CompleteSemanticTokens,
  prefix: string
): string[] {
  const variables: string[] = [];

  // Button
  (Object.keys(semantic.button) as Array<keyof typeof semantic.button>).forEach((variant) => {
    const btn = semantic.button[variant];
    const vp = `--${prefix}-btn-${variant}`;
    variables.push(`${vp}-bg: ${btn.background};`);
    variables.push(`${vp}-bg-hover: ${btn.backgroundHover};`);
    variables.push(`${vp}-bg-active: ${btn.backgroundActive};`);
    variables.push(`${vp}-text: ${btn.text};`);
    variables.push(`${vp}-border: ${btn.border};`);
    variables.push(`${vp}-radius: ${btn.borderRadius};`);
    if (btn.shadow) variables.push(`${vp}-shadow: ${btn.shadow};`);
    if (btn.shadowHover) variables.push(`${vp}-shadow-hover: ${btn.shadowHover};`);
  });

  // Panel
  (Object.keys(semantic.panel) as Array<keyof typeof semantic.panel>).forEach((variant) => {
    const panel = semantic.panel[variant];
    const vp = `--${prefix}-panel-${variant}`;
    variables.push(`${vp}-bg: ${panel.background};`);
    variables.push(`${vp}-border: ${panel.border};`);
    variables.push(`${vp}-radius: ${panel.borderRadius};`);
    variables.push(`${vp}-padding: ${panel.padding};`);
    variables.push(`${vp}-shadow: ${panel.shadow};`);
  });

  // Input
  (Object.keys(semantic.input) as Array<keyof typeof semantic.input>).forEach((state) => {
    const input = semantic.input[state];
    const vp = `--${prefix}-input-${state}`;
    variables.push(`${vp}-bg: ${input.background};`);
    variables.push(`${vp}-border: ${input.border};`);
    variables.push(`${vp}-text: ${input.text};`);
    variables.push(`${vp}-placeholder: ${input.placeholder};`);
    if (input.shadow) variables.push(`${vp}-shadow: ${input.shadow};`);
  });

  // Status
  (Object.keys(semantic.status) as Array<keyof typeof semantic.status>).forEach((variant) => {
    const s = semantic.status[variant];
    const vp = `--${prefix}-status-${variant}`;
    variables.push(`${vp}-bg: ${s.background};`);
    variables.push(`${vp}-bg-subtle: ${s.backgroundSubtle};`);
    variables.push(`${vp}-border: ${s.border};`);
    variables.push(`${vp}-text: ${s.text};`);
    variables.push(`${vp}-icon: ${s.icon};`);
  });

  // Form
  const form = semantic.form;
  variables.push(`--${prefix}-form-label-color: ${form.label.color};`);
  variables.push(`--${prefix}-form-label-required: ${form.label.requiredColor};`);
  variables.push(`--${prefix}-form-label-font-size: ${form.label.fontSize};`);
  variables.push(`--${prefix}-form-label-font-weight: ${form.label.fontWeight};`);
  variables.push(`--${prefix}-form-help-color: ${form.helpText.color};`);
  variables.push(`--${prefix}-form-help-error: ${form.helpText.errorColor};`);
  variables.push(`--${prefix}-form-help-success: ${form.helpText.successColor};`);
  variables.push(`--${prefix}-form-help-font-size: ${form.helpText.fontSize};`);
  variables.push(`--${prefix}-form-fieldset-border: ${form.fieldset.border};`);
  variables.push(`--${prefix}-form-fieldset-bg: ${form.fieldset.background};`);
  variables.push(`--${prefix}-form-layout-gap: ${form.layout.gap};`);
  variables.push(`--${prefix}-form-layout-label-gap: ${form.layout.labelGap};`);
  variables.push(`--${prefix}-form-layout-field-margin: ${form.layout.fieldMarginBottom};`);

  // Navigation
  const nav = semantic.navigation;
  variables.push(`--${prefix}-nav-bg: ${nav.background};`);
  variables.push(`--${prefix}-nav-item-default-bg: ${nav.itemDefault.background};`);
  variables.push(`--${prefix}-nav-item-default-text: ${nav.itemDefault.text};`);
  variables.push(`--${prefix}-nav-item-hover-bg: ${nav.itemHover.background};`);
  variables.push(`--${prefix}-nav-item-hover-text: ${nav.itemHover.text};`);
  variables.push(`--${prefix}-nav-item-active-bg: ${nav.itemActive.background};`);
  variables.push(`--${prefix}-nav-item-active-text: ${nav.itemActive.text};`);
  variables.push(`--${prefix}-nav-item-active-indicator: ${nav.itemActive.indicator};`);
  variables.push(`--${prefix}-nav-divider: ${nav.divider};`);

  // Tooltip
  (Object.keys(semantic.tooltip) as Array<keyof typeof semantic.tooltip>).forEach((variant) => {
    const t = semantic.tooltip[variant];
    const vp = `--${prefix}-tooltip-${variant}`;
    variables.push(`${vp}-bg: ${t.background};`);
    variables.push(`${vp}-text: ${t.text};`);
    variables.push(`${vp}-border: ${t.border};`);
    variables.push(`${vp}-shadow: ${t.shadow};`);
    variables.push(`${vp}-radius: ${t.borderRadius};`);
    variables.push(`${vp}-padding: ${t.padding};`);
    variables.push(`${vp}-arrow: ${t.arrowColor};`);
  });

  // Table
  const table = semantic.table;
  variables.push(`--${prefix}-table-header-bg: ${table.headerBackground};`);
  variables.push(`--${prefix}-table-header-text: ${table.headerText};`);
  variables.push(`--${prefix}-table-row-bg: ${table.rowBackground};`);
  variables.push(`--${prefix}-table-row-alt-bg: ${table.rowBackgroundAlt};`);
  variables.push(`--${prefix}-table-row-hover: ${table.rowHover};`);
  variables.push(`--${prefix}-table-border: ${table.border};`);
  variables.push(`--${prefix}-table-text: ${table.text};`);
  variables.push(`--${prefix}-table-selected-bg: ${table.selectedBackground};`);

  // Card
  (Object.keys(semantic.card) as Array<keyof typeof semantic.card>).forEach((variant) => {
    const card = semantic.card[variant];
    const vp = `--${prefix}-card-${variant}`;
    variables.push(`${vp}-bg: ${card.background};`);
    variables.push(`${vp}-border: ${card.border};`);
    variables.push(`${vp}-radius: ${card.borderRadius};`);
    variables.push(`${vp}-shadow: ${card.shadow};`);
    variables.push(`${vp}-padding: ${card.padding};`);
    variables.push(`${vp}-header-bg: ${card.headerBackground};`);
    variables.push(`${vp}-footer-bg: ${card.footerBackground};`);
  });

  // Divider
  const divider = semantic.divider;
  variables.push(`--${prefix}-divider-color: ${divider.color};`);
  variables.push(`--${prefix}-divider-width: ${divider.width};`);
  variables.push(`--${prefix}-divider-style: ${divider.style};`);
  variables.push(`--${prefix}-divider-margin: ${divider.margin};`);

  // Scrollbar
  const sb = semantic.scrollbar;
  variables.push(`--${prefix}-scrollbar-track: ${sb.track};`);
  variables.push(`--${prefix}-scrollbar-thumb: ${sb.thumb};`);
  variables.push(`--${prefix}-scrollbar-thumb-hover: ${sb.thumbHover};`);
  variables.push(`--${prefix}-scrollbar-width: ${sb.width};`);
  variables.push(`--${prefix}-scrollbar-radius: ${sb.borderRadius};`);

  // Badge
  (Object.keys(semantic.badge) as Array<keyof typeof semantic.badge>).forEach((variant) => {
    const b = semantic.badge[variant];
    const vp = `--${prefix}-badge-${variant}`;
    variables.push(`${vp}-bg: ${b.background};`);
    variables.push(`${vp}-text: ${b.text};`);
    variables.push(`${vp}-border: ${b.border};`);
    variables.push(`${vp}-radius: ${b.borderRadius};`);
    variables.push(`${vp}-padding: ${b.padding};`);
  });

  // Avatar
  const avatar = semantic.avatar;
  variables.push(`--${prefix}-avatar-bg: ${avatar.background};`);
  variables.push(`--${prefix}-avatar-text: ${avatar.text};`);
  variables.push(`--${prefix}-avatar-border: ${avatar.border};`);
  variables.push(`--${prefix}-avatar-radius: ${avatar.borderRadius};`);
  variables.push(`--${prefix}-avatar-placeholder-bg: ${avatar.placeholderBackground};`);
  variables.push(`--${prefix}-avatar-placeholder-text: ${avatar.placeholderText};`);

  // Progress
  const progress = semantic.progress;
  variables.push(`--${prefix}-progress-track: ${progress.track};`);
  variables.push(`--${prefix}-progress-fill: ${progress.fill};`);
  variables.push(`--${prefix}-progress-fill-success: ${progress.fillSuccess};`);
  variables.push(`--${prefix}-progress-fill-warning: ${progress.fillWarning};`);
  variables.push(`--${prefix}-progress-fill-danger: ${progress.fillDanger};`);
  variables.push(`--${prefix}-progress-text: ${progress.text};`);
  variables.push(`--${prefix}-progress-height: ${progress.height};`);
  variables.push(`--${prefix}-progress-radius: ${progress.borderRadius};`);

  // Skeleton
  const skeleton = semantic.skeleton;
  variables.push(`--${prefix}-skeleton-base: ${skeleton.base};`);
  variables.push(`--${prefix}-skeleton-highlight: ${skeleton.highlight};`);
  variables.push(`--${prefix}-skeleton-radius: ${skeleton.borderRadius};`);
  variables.push(`--${prefix}-skeleton-shimmer-duration: ${skeleton.shimmerDuration}ms;`);

  // Gradient
  const gradient = semantic.gradient;
  variables.push(`--${prefix}-gradient-brand-primary: ${gradient.brand.primary};`);
  variables.push(`--${prefix}-gradient-brand-subtle: ${gradient.brand.subtle};`);
  variables.push(`--${prefix}-gradient-brand-glow: ${gradient.brand.glow};`);
  variables.push(`--${prefix}-gradient-bg-base: ${gradient.background.base};`);
  variables.push(`--${prefix}-gradient-bg-elevated: ${gradient.background.elevated};`);
  variables.push(`--${prefix}-gradient-bg-subtle: ${gradient.background.subtle};`);
  variables.push(`--${prefix}-gradient-status-success: ${gradient.status.success};`);
  variables.push(`--${prefix}-gradient-status-warning: ${gradient.status.warning};`);
  variables.push(`--${prefix}-gradient-status-danger: ${gradient.status.danger};`);
  variables.push(`--${prefix}-gradient-status-info: ${gradient.status.info};`);

  // Glass
  const glass = semantic.glass;
  variables.push(`--${prefix}-glass-bg: ${glass.background};`);
  variables.push(`--${prefix}-glass-bg-hover: ${glass.backgroundHover};`);
  variables.push(`--${prefix}-glass-border: ${glass.border};`);
  variables.push(`--${prefix}-glass-radius: ${glass.borderRadius};`);
  variables.push(`--${prefix}-glass-shadow: ${glass.shadow};`);
  variables.push(`--${prefix}-glass-blur: ${glass.backdropBlur};`);
  variables.push(`--${prefix}-glass-saturate: ${glass.saturation};`);

  return variables;
}

export function injectThemeCSSVariables(): void {
  if (typeof document === 'undefined') return;

  const theme = getCurrentTheme();
  const semantic = getSemanticTokens();
  const colors = isColorPrimitives(theme.colors) ? theme.colors : theme.colors as any;
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
  variables.push(`--${prefix}-text-inverse: ${colors.text.inverse};`);

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

  // 交互色
  variables.push(`--${prefix}-interactive-default: ${colors.interactive.default};`);
  variables.push(`--${prefix}-interactive-hover: ${colors.interactive.hover};`);
  variables.push(`--${prefix}-interactive-active: ${colors.interactive.active};`);
  variables.push(`--${prefix}-interactive-disabled: ${colors.interactive.disabled};`);

  // 语义 Token CSS 变量
  variables.push(...flattenSemanticTokens(semantic, prefix));

  // 全局 Token CSS 变量
  variables.push(`--${prefix}-radius-none: ${theme.radii.none};`);
  variables.push(`--${prefix}-radius-sm: ${theme.radii.sm};`);
  variables.push(`--${prefix}-radius-md: ${theme.radii.md};`);
  variables.push(`--${prefix}-radius-lg: ${theme.radii.lg};`);
  variables.push(`--${prefix}-radius-xl: ${theme.radii.xl};`);
  variables.push(`--${prefix}-radius-full: ${theme.radii.full};`);

  variables.push(`--${prefix}-shadow-sm: ${theme.shadows.sm};`);
  variables.push(`--${prefix}-shadow-md: ${theme.shadows.md};`);
  variables.push(`--${prefix}-shadow-lg: ${theme.shadows.lg};`);
  variables.push(`--${prefix}-shadow-xl: ${theme.shadows.xl};`);
  variables.push(`--${prefix}-shadow-2xl: ${theme.shadows['2xl']};`);
  if (theme.shadows.glow) variables.push(`--${prefix}-shadow-glow: ${theme.shadows.glow};`);
  if (theme.shadows.inner) variables.push(`--${prefix}-shadow-inner: ${theme.shadows.inner};`);

  variables.push(`--${prefix}-spacing-xs: ${theme.spacing.xs}px;`);
  variables.push(`--${prefix}-spacing-sm: ${theme.spacing.sm}px;`);
  variables.push(`--${prefix}-spacing-md: ${theme.spacing.md}px;`);
  variables.push(`--${prefix}-spacing-lg: ${theme.spacing.lg}px;`);
  variables.push(`--${prefix}-spacing-xl: ${theme.spacing.xl}px;`);
  variables.push(`--${prefix}-spacing-2xl: ${theme.spacing['2xl']}px;`);
  if (theme.spacing['3xl']) variables.push(`--${prefix}-spacing-3xl: ${theme.spacing['3xl']}px;`);

  variables.push(`--${prefix}-depth-base: ${theme.depth.base};`);
  variables.push(`--${prefix}-depth-overlay: ${theme.depth.overlay};`);
  variables.push(`--${prefix}-depth-modal: ${theme.depth.modal};`);
  variables.push(`--${prefix}-depth-popup: ${theme.depth.popup};`);
  variables.push(`--${prefix}-depth-notification: ${theme.depth.notification};`);

  // 字体
  variables.push(`--${prefix}-font-mono: ${theme.typography.fontFamily.mono};`);
  variables.push(`--${prefix}-font-sans: ${theme.typography.fontFamily.sans};`);
  variables.push(`--${prefix}-font-size-xs: ${theme.typography.fontSize.xs};`);
  variables.push(`--${prefix}-font-size-sm: ${theme.typography.fontSize.sm};`);
  variables.push(`--${prefix}-font-size-md: ${theme.typography.fontSize.md};`);
  variables.push(`--${prefix}-font-size-lg: ${theme.typography.fontSize.lg};`);
  variables.push(`--${prefix}-font-size-xl: ${theme.typography.fontSize.xl};`);
  variables.push(`--${prefix}-font-size-2xl: ${theme.typography.fontSize['2xl']};`);
  variables.push(`--${prefix}-font-weight-normal: ${theme.typography.fontWeight.normal};`);
  variables.push(`--${prefix}-font-weight-medium: ${theme.typography.fontWeight.medium};`);
  variables.push(`--${prefix}-font-weight-semibold: ${theme.typography.fontWeight.semibold};`);
  variables.push(`--${prefix}-font-weight-bold: ${theme.typography.fontWeight.bold};`);
  variables.push(`--${prefix}-line-height-tight: ${theme.typography.lineHeight.tight};`);
  variables.push(`--${prefix}-line-height-normal: ${theme.typography.lineHeight.normal};`);
  variables.push(`--${prefix}-line-height-relaxed: ${theme.typography.lineHeight.relaxed};`);

  // 动画 Token
  variables.push(`--${prefix}-animation-duration-instant: ${theme.animation.duration.instant}ms;`);
  variables.push(`--${prefix}-animation-duration-fast: ${theme.animation.duration.fast}ms;`);
  variables.push(`--${prefix}-animation-duration-normal: ${theme.animation.duration.normal}ms;`);
  variables.push(`--${prefix}-animation-duration-slow: ${theme.animation.duration.slow}ms;`);
  variables.push(`--${prefix}-animation-duration-deliberate: ${theme.animation.duration.deliberate}ms;`);
  variables.push(`--${prefix}-animation-easing-linear: ${theme.animation.easing.linear};`);
  variables.push(`--${prefix}-animation-easing-ease: ${theme.animation.easing.ease};`);
  variables.push(`--${prefix}-animation-easing-ease-in: ${theme.animation.easing.easeIn};`);
  variables.push(`--${prefix}-animation-easing-ease-out: ${theme.animation.easing.easeOut};`);
  variables.push(`--${prefix}-animation-easing-ease-in-out: ${theme.animation.easing.easeInOut};`);
  if (theme.animation.easing.spring) variables.push(`--${prefix}-animation-easing-spring: ${theme.animation.easing.spring};`);

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
    setTheme(saved as keyof typeof DesignSystemConfig.themes, { persist: false });
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

export function injectGlobalStyles(): void {
  if (typeof document === 'undefined') return;

  const styleId = 'stratix-global-styles';
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;

  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = `
    ::-webkit-scrollbar { width: var(--ds-scrollbar-width); }
    ::-webkit-scrollbar-track { background: var(--ds-scrollbar-track); }
    ::-webkit-scrollbar-thumb { background: var(--ds-scrollbar-thumb); border-radius: var(--ds-scrollbar-radius); }
    ::-webkit-scrollbar-thumb:hover { background: var(--ds-scrollbar-thumb-hover); }
    ::selection { background: var(--ds-color-primary); color: var(--ds-text-inverse); }
    *:focus-visible { outline: 2px solid var(--ds-border-focus); outline-offset: 2px; }
    body { font-family: var(--ds-font-sans); }
    code, pre, kbd { font-family: var(--ds-font-mono); }
  `.replace(/\s+/g, ' ').trim();
}

export function initDesignSystem(): void {
  restoreThemeFromStorage();
  injectThemeCSSVariables();
  injectGlobalStyles();
  injectAnimationStyles();
}

export function injectAnimationStyles(): void {
  if (typeof document === 'undefined') return;

  // 动画预设已由 main.ts 导入 animations.css 提供
  // 此处作为运行时后备：若 CSS 文件未被加载（如 SSR 或特殊环境），则注入基础动画
  const styleId = 'stratix-animation-styles';
  if (document.getElementById(styleId)) return;

  // 简单检测：检查是否有任何样式表已定义 ds-fade-in
  const hasAnimations = Array.from(document.styleSheets).some(sheet => {
    try {
      return Array.from(sheet.cssRules).some(rule =>
        rule instanceof CSSKeyframesRule && rule.name === 'ds-fade-in'
      );
    } catch {
      return false;
    }
  });

  if (hasAnimations) return;

  const styleEl = document.createElement('style');
  styleEl.id = styleId;
  styleEl.textContent = `
    @keyframes ds-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes ds-fade-out { from { opacity: 1; } to { opacity: 0; } }
    @keyframes ds-slide-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes ds-slide-down { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes ds-slide-right { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes ds-scale-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
    @keyframes ds-scale-out { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.95); } }
    @keyframes ds-glow-pulse { 0%, 100% { box-shadow: 0 0 10px var(--ds-color-primary)40; } 50% { box-shadow: 0 0 20px var(--ds-color-primary)80; } }
    .ds-animate-fade-in { animation: ds-fade-in 150ms ease-out; }
    .ds-animate-fade-out { animation: ds-fade-out 150ms ease-in forwards; }
    .ds-animate-slide-up { animation: ds-slide-up 250ms ease-out; }
    .ds-animate-slide-down { animation: ds-slide-down 250ms ease-out; }
    .ds-animate-slide-right { animation: ds-slide-right 250ms ease-out; }
    .ds-animate-scale-in { animation: ds-scale-in 150ms ease-out; }
    .ds-animate-scale-out { animation: ds-scale-out 150ms ease-in forwards; }
    .ds-animate-glow-pulse { animation: ds-glow-pulse 2s linear infinite; }
  `.replace(/\s+/g, ' ').trim();
  document.head.appendChild(styleEl);
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
