/**
 * Design System Tokens 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DesignSystemConfig, getToken, getCurrentTheme, setTheme, getSemanticTokens, invalidateSemanticTokenCache } from '@/design-system/config';
import { CyberpunkTheme } from '@/design-system/themes/cyberpunk';
import { MinimalTheme } from '@/design-system/themes/minimal';
import { ProfessionalTheme } from '@/design-system/themes/professional';

describe('DesignSystemConfig', () => {
  it('should have three themes', () => {
    expect(Object.keys(DesignSystemConfig.themes)).toHaveLength(3);
    expect(DesignSystemConfig.themes).toHaveProperty('cyberpunk');
    expect(DesignSystemConfig.themes).toHaveProperty('minimal');
    expect(DesignSystemConfig.themes).toHaveProperty('professional');
  });

  it('should have cyberpunk as default theme', () => {
    expect(DesignSystemConfig.activeTheme).toBe('cyberpunk');
  });
});

describe('Token System', () => {
  beforeEach(() => {
    setTheme('cyberpunk');
  });

  it('should get primary color from cyberpunk theme', () => {
    const color = getToken('colors.primary');
    // maps to colors.brand.primary which is Cyan[500] = #00CCCC in CyberpunkPrimitives
    expect(color).toBe('#00CCCC');
  });

  it('should get background color', () => {
    const bg = getToken('colors.background.primary');
    expect(bg).toBe('#0d0d14');
  });

  it('should get spacing value', () => {
    const spacing = getToken('spacing.md');
    expect(spacing).toBe(16);
  });

  it('should get animation duration', () => {
    const duration = getToken('animation.duration.fast');
    expect(duration).toBe(150);
  });

  it('should get depth layer', () => {
    const depth = getToken('depth.UI_MODAL_CONTENT');
    expect(depth).toBe(3100);
  });

  it('should map old token paths to new paths', () => {
    expect(getToken('colors.background.primary')).toBe('#0d0d14');
    expect(getToken('colors.background.secondary')).toBe('#12121a');
    expect(getToken('colors.semantic.success')).toBe('#00ff88');
  });

  it('should get semantic tokens via path', () => {
    const btnBg = getToken('semantic.button.primary.background');
    expect(typeof btnBg).toBe('string');
    expect(btnBg).toBeTruthy();
  });
});

describe('Theme Switching', () => {
  it('should switch to minimal theme', () => {
    setTheme('minimal');
    const theme = getCurrentTheme();
    expect(theme).toEqual(MinimalTheme);
  });

  it('should switch to professional theme', () => {
    setTheme('professional');
    const theme = getCurrentTheme();
    expect(theme).toEqual(ProfessionalTheme);
  });

  it('should switch back to cyberpunk', () => {
    setTheme('cyberpunk');
    const theme = getCurrentTheme();
    expect(theme).toEqual(CyberpunkTheme);
  });
});

describe('Semantic Tokens', () => {
  beforeEach(() => {
    setTheme('cyberpunk');
    invalidateSemanticTokenCache();
  });

  it('should have button semantic tokens', async () => {
    const { ButtonSemantic } = await import('@/design-system/semantic/buttons');
    expect(ButtonSemantic).toHaveProperty('primary');
    expect(ButtonSemantic.primary).toHaveProperty('background');
  });

  it('should have panel semantic tokens', async () => {
    const { PanelSemantic } = await import('@/design-system/semantic/panels');
    expect(PanelSemantic).toHaveProperty('default');
    expect(PanelSemantic).toHaveProperty('elevated');
  });

  it('should generate complete semantic tokens', () => {
    const semantic = getSemanticTokens();
    expect(semantic).toHaveProperty('button');
    expect(semantic).toHaveProperty('panel');
    expect(semantic).toHaveProperty('input');
    expect(semantic).toHaveProperty('status');
    expect(semantic).toHaveProperty('form');
    expect(semantic).toHaveProperty('navigation');
    expect(semantic).toHaveProperty('tooltip');
    expect(semantic).toHaveProperty('table');
    expect(semantic).toHaveProperty('card');
    expect(semantic).toHaveProperty('divider');
    expect(semantic).toHaveProperty('scrollbar');
    expect(semantic).toHaveProperty('badge');
    expect(semantic).toHaveProperty('avatar');
    expect(semantic).toHaveProperty('progress');
    expect(semantic).toHaveProperty('skeleton');
  });

  it('should have tooltip variants', () => {
    const semantic = getSemanticTokens();
    expect(semantic.tooltip).toHaveProperty('default');
    expect(semantic.tooltip).toHaveProperty('dark');
    expect(semantic.tooltip).toHaveProperty('light');
    expect(semantic.tooltip.default).toHaveProperty('background');
    expect(semantic.tooltip.default).toHaveProperty('arrowColor');
  });

  it('should have card variants', () => {
    const semantic = getSemanticTokens();
    expect(semantic.card).toHaveProperty('default');
    expect(semantic.card).toHaveProperty('elevated');
    expect(semantic.card).toHaveProperty('outlined');
    expect(semantic.card).toHaveProperty('compact');
  });

  it('should have badge variants', () => {
    const semantic = getSemanticTokens();
    expect(semantic.badge).toHaveProperty('success');
    expect(semantic.badge).toHaveProperty('warning');
    expect(semantic.badge).toHaveProperty('danger');
    expect(semantic.badge).toHaveProperty('info');
    expect(semantic.badge).toHaveProperty('neutral');
    expect(semantic.badge).toHaveProperty('primary');
  });

  it('should have table tokens', () => {
    const semantic = getSemanticTokens();
    expect(semantic.table).toHaveProperty('headerBackground');
    expect(semantic.table).toHaveProperty('rowHover');
    expect(semantic.table).toHaveProperty('selectedBackground');
  });

  it('should have scrollbar tokens', () => {
    const semantic = getSemanticTokens();
    expect(semantic.scrollbar).toHaveProperty('track');
    expect(semantic.scrollbar).toHaveProperty('thumb');
    expect(semantic.scrollbar).toHaveProperty('thumbHover');
  });

  it('should have progress tokens', () => {
    const semantic = getSemanticTokens();
    expect(semantic.progress).toHaveProperty('track');
    expect(semantic.progress).toHaveProperty('fill');
    expect(semantic.progress).toHaveProperty('fillSuccess');
    expect(semantic.progress).toHaveProperty('fillDanger');
  });

  it('should have skeleton tokens', () => {
    const semantic = getSemanticTokens();
    expect(semantic.skeleton).toHaveProperty('base');
    expect(semantic.skeleton).toHaveProperty('highlight');
    expect(typeof semantic.skeleton.shimmerDuration).toBe('number');
  });
});

describe('Semantic Token Cache', () => {
  beforeEach(() => {
    invalidateSemanticTokenCache();
  });

  it('should cache semantic tokens for the same theme', () => {
    setTheme('cyberpunk');
    const first = getSemanticTokens();
    const second = getSemanticTokens();
    expect(first).toBe(second);
  });

  it('should invalidate cache when theme changes', () => {
    setTheme('cyberpunk');
    const first = getSemanticTokens();
    setTheme('minimal');
    const second = getSemanticTokens();
    expect(first).not.toBe(second);
    expect(second.button.primary.background).toBe(MinimalTheme.colors.brand.primary);
  });
});

describe('Theme Consistency', () => {
  const themes = ['cyberpunk', 'minimal', 'professional'] as const;

  themes.forEach((themeName) => {
    it(`should have all semantic categories in ${themeName} theme`, () => {
      setTheme(themeName);
      invalidateSemanticTokenCache();
      const semantic = getSemanticTokens();

      const categories = [
        'button', 'panel', 'input', 'status', 'form', 'navigation',
        'tooltip', 'table', 'card', 'divider', 'scrollbar',
        'badge', 'avatar', 'progress', 'skeleton',
      ];

      categories.forEach((cat) => {
        expect(semantic).toHaveProperty(cat);
      });
    });
  });
});

describe('CSS Variable Generation', () => {
  beforeEach(() => {
    setTheme('cyberpunk');
    invalidateSemanticTokenCache();
  });

  it('should generate CSS variables for new semantic tokens', async () => {
    const { generateTooltipCSSVariables } = await import('@/design-system/semantic/tooltip');
    const theme = getCurrentTheme();
    const css = generateTooltipCSSVariables(theme);
    expect(css).toContain('--tooltip-default-bg');
    expect(css).toContain('--tooltip-dark-bg');
  });

  it('should generate CSS variables for badge tokens', async () => {
    const { generateBadgeCSSVariables } = await import('@/design-system/semantic/badge');
    const theme = getCurrentTheme();
    const css = generateBadgeCSSVariables(theme);
    expect(css).toContain('--badge-success-bg');
    expect(css).toContain('--badge-primary-bg');
  });
});
