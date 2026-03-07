/**
 * Icon System 测试
 */

import { describe, it, expect } from 'vitest';
import { getIconPath, getCustomIcon, createSVGIcon, IconSizes } from '@/design-system/icons/registry';

describe('Icon Registry', () => {
  it('should have SVG icons', () => {
    const closeIcon = getIconPath('close');
    expect(closeIcon).toBeTruthy();
    expect(typeof closeIcon).toBe('string');
  });

  it('should have specific icons', () => {
    const icons = ['close', 'check', 'settings', 'user', 'search'];
    icons.forEach(iconName => {
      const icon = getIconPath(iconName);
      expect(icon).toBeTruthy();
    });
  });

  it('should return null for non-existent icon', () => {
    const icon = getIconPath('non-existent-icon');
    expect(icon).toBeNull();
  });
});

describe('Custom Icons', () => {
  it('should have custom graphics icons', () => {
    const agentWriter = getCustomIcon('agent-writer');
    expect(agentWriter).toBeTruthy();
    expect(typeof agentWriter).toBe('function');
  });

  it('should have all custom icons', () => {
    const icons = ['agent-writer', 'agent-dev', 'agent-analyst', 'zone-gather', 'zone-process'];
    icons.forEach(iconName => {
      const icon = getCustomIcon(iconName);
      expect(icon).toBeTruthy();
    });
  });
});

describe('Icon Utilities', () => {
  it('should create SVG HTML string', () => {
    const svg = createSVGIcon('close', 24, '#ffffff');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('width="24"');
    expect(svg).toContain('height="24"');
  });

  it('should use default size', () => {
    const svg = createSVGIcon('close');
    expect(svg).toContain('width="24"');
  });

  it('should use custom color', () => {
    const svg = createSVGIcon('close', 24, '#00ffff');
    expect(svg).toContain('#00ffff');
  });
});

describe('Icon Sizes', () => {
  it('should have predefined sizes', () => {
    expect(IconSizes).toHaveProperty('xs');
    expect(IconSizes).toHaveProperty('sm');
    expect(IconSizes).toHaveProperty('md');
    expect(IconSizes).toHaveProperty('lg');
    expect(IconSizes).toHaveProperty('xl');
  });

  it('should have correct size values', () => {
    expect(IconSizes.xs).toBe(12);
    expect(IconSizes.sm).toBe(16);
    expect(IconSizes.md).toBe(20);
    expect(IconSizes.lg).toBe(24);
    expect(IconSizes.xl).toBe(32);
  });
});
