import { useListAnimation, listTransitionProps } from '@/stratix-project/ui/composables/useListAnimation';

describe('useListAnimation', () => {
  describe('useListAnimation', () => {
    it('should return listTransitionProps', () => {
      const result = useListAnimation();
      expect(result).toHaveProperty('listTransitionProps');
      expect(result.listTransitionProps).toBe(listTransitionProps);
    });
  });

  describe('listTransitionProps', () => {
    it('should have correct transition names', () => {
      expect(listTransitionProps.name).toBe('list');
      expect(listTransitionProps.enterActiveClass).toBe('list-enter-active');
      expect(listTransitionProps.leaveActiveClass).toBe('list-leave-active');
      expect(listTransitionProps.moveClass).toBe('list-move');
      expect(listTransitionProps.enterFromClass).toBe('list-enter-from');
      expect(listTransitionProps.leaveToClass).toBe('list-leave-to');
    });
  });
});