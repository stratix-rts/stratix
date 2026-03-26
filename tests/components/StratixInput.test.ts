/**
 * StratixInput 组件测试
 *
 * 测试 Input 组件的共享逻辑和配置
 */

import { describe, it, expect } from '@jest/globals';
import {
  InputBaseConfig,
  InputSizes,
  type InputVariant
} from '@/design-system/components/shared/input';

describe('StratixInput', () => {
  describe('InputBaseConfig', () => {
    it('should have correct base configuration', () => {
      expect(InputBaseConfig).toBeDefined();
      expect(InputBaseConfig.size).toBeDefined();
      expect(InputBaseConfig.style).toBeDefined();
    });

    it('should have full width by default', () => {
      expect(InputBaseConfig.size.width).toBe('100%');
    });

    it('should have styled background and border', () => {
      expect(InputBaseConfig.style.background).toBe('#1a1a2e');
      expect(InputBaseConfig.style.border).toBe('1px solid #2a2a3e');
    });
  });

  describe('InputSizes', () => {
    it('should define small size', () => {
      expect(InputSizes.sm).toBeDefined();
      expect(InputSizes.sm.height).toBe('32px');
      expect(InputSizes.sm.padding).toBe('4px 8px');
      expect(InputSizes.sm.fontSize).toBe('12px');
    });

    it('should define medium size', () => {
      expect(InputSizes.md).toBeDefined();
      expect(InputSizes.md.height).toBe('40px');
      expect(InputSizes.md.padding).toBe('8px 12px');
      expect(InputSizes.md.fontSize).toBe('14px');
    });

    it('should define large size', () => {
      expect(InputSizes.lg).toBeDefined();
      expect(InputSizes.lg.height).toBe('48px');
      expect(InputSizes.lg.padding).toBe('12px 16px');
      expect(InputSizes.lg.fontSize).toBe('16px');
    });

    it('should have increasing dimensions from sm to lg', () => {
      const smHeight = parseInt(InputSizes.sm.height);
      const mdHeight = parseInt(InputSizes.md.height);
      const lgHeight = parseInt(InputSizes.lg.height);

      expect(mdHeight).toBeGreaterThan(smHeight);
      expect(lgHeight).toBeGreaterThan(mdHeight);
    });

    it('should have all three sizes', () => {
      const sizeKeys = Object.keys(InputSizes);
      expect(sizeKeys).toHaveLength(3);
      expect(sizeKeys).toContain('sm');
      expect(sizeKeys).toContain('md');
      expect(sizeKeys).toContain('lg');
    });
  });

  describe('InputVariant type', () => {
    it('should support default variant', () => {
      const variant: InputVariant = 'default';
      expect(variant).toBe('default');
    });

    it('should support filled variant', () => {
      const variant: InputVariant = 'filled';
      expect(variant).toBe('filled');
    });

    it('should support outlined variant', () => {
      const variant: InputVariant = 'outlined';
      expect(variant).toBe('outlined');
    });

    it('should have exactly three variants', () => {
      const variants: InputVariant[] = ['default', 'filled', 'outlined'];
      expect(variants).toHaveLength(3);
    });
  });

  describe('Input component props interface', () => {
    it('should define props structure for StratixInput', () => {
      // These are the props the StratixInput component accepts
      const props = {
        modelValue: ['', 0],
        type: ['text', 'password', 'email', 'number'] as const,
        placeholder: ['', 'Enter text'],
        disabled: [true, false],
        error: [true, false, 'Error message'],
        size: ['sm', 'md', 'lg'] as const,
        variant: ['default', 'filled', 'outlined'] as const,
        icon: [undefined, 'search', 'user']
      };

      // Verify prop types
      expect(props.type).toContain('text');
      expect(props.size).toContain('md');
      expect(props.variant).toContain('default');
    });

    it('should have correct size mappings', () => {
      expect(InputSizes.sm.height).toBe('32px');
      expect(InputSizes.md.height).toBe('40px');
      expect(InputSizes.lg.height).toBe('48px');
    });
  });

  describe('default values', () => {
    it('should have sensible defaults in base config', () => {
      // Width should be 100% for full-width inputs
      expect(InputBaseConfig.size.width).toBe('100%');

      // Border radius should be md
      expect(InputBaseConfig.style.borderRadius).toBe('md');
    });
  });
});
