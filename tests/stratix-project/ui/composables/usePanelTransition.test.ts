// Mock Vue module to avoid needing @vue/test-utils
jest.mock('vue', () => ({}));

import { usePanelTransition, panelTransitionProps, panelTransitionStyles } from '@/stratix-project/ui/composables/usePanelTransition';

describe('usePanelTransition', () => {
  describe('usePanelTransition', () => {
    it('should return panelTransitionProps and panelTransitionStyles', () => {
      const result = usePanelTransition();
      expect(result).toHaveProperty('panelTransitionProps');
      expect(result).toHaveProperty('panelTransitionStyles');
      expect(result.panelTransitionProps).toBe(panelTransitionProps);
      expect(result.panelTransitionStyles).toBe(panelTransitionStyles);
    });
  });

  describe('panelTransitionProps', () => {
    it('should have correct transition names', () => {
      expect(panelTransitionProps.name).toBe('panel');
      expect(panelTransitionProps.enterActiveClass).toBe('panel-enter-active');
      expect(panelTransitionProps.leaveActiveClass).toBe('panel-leave-active');
      expect(panelTransitionProps.enterFromClass).toBe('panel-enter-from');
      expect(panelTransitionProps.leaveToClass).toBe('panel-leave-to');
    });
  });

  describe('panelTransitionStyles', () => {
    it('should have correct CSS properties', () => {
      expect(panelTransitionStyles).toHaveProperty('--panel-duration');
      expect(panelTransitionStyles).toHaveProperty('--panel-easing');
      expect(panelTransitionStyles['--panel-duration']).toBe('200ms');
      expect(panelTransitionStyles['--panel-easing']).toBe('ease');
    });
  });
});