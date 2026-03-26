/**
 * StratixButton 组件测试
 *
 * 测试 Button 组件的共享逻辑和配置
 */

import { describe, it, expect } from '@jest/globals';
import {
  ButtonBaseConfig,
  ButtonSizes,
  getButtonToken,
  type ButtonVariant
} from '@/design-system/components/shared/button';

describe('StratixButton', () => {
  describe('ButtonBaseConfig', () => {
    it('should have correct base configuration', () => {
      expect(ButtonBaseConfig).toBeDefined();
      expect(ButtonBaseConfig.size).toBeDefined();
      expect(ButtonBaseConfig.style).toBeDefined();
    });

    it('should have correct layout defaults', () => {
      expect(ButtonBaseConfig.layout).toBeDefined();
      expect(ButtonBaseConfig.layout!.padding).toBe('md');
      expect(ButtonBaseConfig.layout!.gap).toBe('sm');
    });

    it('should have animation configuration', () => {
      expect(ButtonBaseConfig.animation).toBeDefined();
      expect(ButtonBaseConfig.animation!.enter!.duration).toBe(200);
      expect(ButtonBaseConfig.animation!.exit!.duration).toBe(150);
    });
  });

  describe('ButtonSizes', () => {
    it('should define small size', () => {
      expect(ButtonSizes.sm).toBeDefined();
      expect(ButtonSizes.sm.padding).toBe('4px 8px');
      expect(ButtonSizes.sm.fontSize).toBe('12px');
    });

    it('should define medium size', () => {
      expect(ButtonSizes.md).toBeDefined();
      expect(ButtonSizes.md.padding).toBe('8px 16px');
      expect(ButtonSizes.md.fontSize).toBe('14px');
    });

    it('should define large size', () => {
      expect(ButtonSizes.lg).toBeDefined();
      expect(ButtonSizes.lg.padding).toBe('12px 24px');
      expect(ButtonSizes.lg.fontSize).toBe('16px');
    });

    it('should have all three sizes', () => {
      const sizeKeys = Object.keys(ButtonSizes);
      expect(sizeKeys).toHaveLength(3);
      expect(sizeKeys).toContain('sm');
      expect(sizeKeys).toContain('md');
      expect(sizeKeys).toContain('lg');
    });
  });

  describe('getButtonToken', () => {
    const variants: ButtonVariant[] = ['primary', 'secondary', 'success', 'danger', 'warning'];

    variants.forEach(variant => {
      it(`should return valid token for ${variant} variant`, () => {
        const token = getButtonToken(variant);

        expect(token).toBeDefined();
        expect(token.style).toBeDefined();
        expect(token.style.background).toBeDefined();
        expect(token.style.border).toBeDefined();
        expect(token.style.text).toBeDefined();
      });

      it(`should have hover state for ${variant} variant`, () => {
        const token = getButtonToken(variant);

        expect(token.hover).toBeDefined();
        expect(token.hover.background).toBeDefined();
      });
    });

    it('should include base config in returned token', () => {
      const token = getButtonToken('primary');

      expect(token.size).toEqual(ButtonBaseConfig.size);
      expect(token.layout).toEqual(ButtonBaseConfig.layout);
      expect(token.animation).toEqual(ButtonBaseConfig.animation);
    });

    it('should have proper CSS variable format for primary', () => {
      const token = getButtonToken('primary');

      expect(token.style.background).toContain('var(--ds-btn-primary-bg');
      expect(token.style.text).toContain('var(--ds-btn-primary-text');
    });

    it('should have solid background for success variant', () => {
      const token = getButtonToken('success');

      expect(token.style.background).toContain('var(--ds-status-success)');
      expect(token.style.border).toBe('none');
    });

    it('should have solid background for danger variant', () => {
      const token = getButtonToken('danger');

      expect(token.style.background).toContain('var(--ds-status-danger)');
      expect(token.style.border).toBe('none');
    });

    it('should have border for secondary variant', () => {
      const token = getButtonToken('secondary');

      expect(token.style.border).toContain('var(--ds-border)');
    });
  });

  describe('Button props interface', () => {
    it('should support all variant types', () => {
      const variants: ButtonVariant[] = ['primary', 'secondary', 'success', 'danger', 'warning'];

      variants.forEach(variant => {
        const token = getButtonToken(variant);
        expect(token.style.background).toBeTruthy();
      });
    });
  });
});
