/**
 * Design System Tokens 测试
 */

import { describe, it, expect } from 'vitest';
import { DesignSystemConfig, getToken, getCurrentTheme, setTheme } from '@/design-system/config';
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
  it('should get primary color from cyberpunk theme', () => {
    DesignSystemConfig.activeTheme = 'cyberpunk';
    const color = getToken('colors.primary');
    expect(color).toBe('#00ffff');
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
});
