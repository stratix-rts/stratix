import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import type { Ref } from 'vue';

const FOCUSABLE_SELECTORS = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface UseFocusTrapOptions {
  autoFocus?: boolean;
}

export function useFocusTrap(
  containerRef: Ref<HTMLElement | null>,
  active: Ref<boolean> | boolean = true,
  options: UseFocusTrapOptions = {}
) {
  const { autoFocus = true } = options;
  let previousFocus: Element | null = null;
  let observer: MutationObserver | null = null;

  const getFocusableElements = (): HTMLElement[] => {
    if (!containerRef.value) return [];
    return Array.from(containerRef.value.querySelectorAll(FOCUSABLE_SELECTORS));
  };

  const focusFirst = () => {
    const elements = getFocusableElements();
    if (elements.length > 0) {
      elements[0].focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !containerRef.value) return;

    const focusable = getFocusableElements();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const activate = () => {
    previousFocus = document.activeElement;

    if (autoFocus) {
      nextTick(() => {
        focusFirst();
      });
    }

    document.addEventListener('keydown', handleKeyDown);

    observer = new MutationObserver(() => {
      if (
        containerRef.value &&
        !containerRef.value.contains(document.activeElement)
      ) {
        focusFirst();
      }
    });

    if (containerRef.value) {
      observer.observe(containerRef.value, { childList: true, subtree: true });
    }
  };

  const deactivate = () => {
    document.removeEventListener('keydown', handleKeyDown);
    observer?.disconnect();
    observer = null;

    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus();
    }
    previousFocus = null;
  };

  onMounted(() => {
    const isActive = typeof active === 'boolean' ? active : active.value;
    if (isActive) activate();
  });

  onUnmounted(() => {
    deactivate();
  });

  if (typeof active !== 'boolean') {
    watch(active, (val) => {
      if (val) activate();
      else deactivate();
    });
  }

  return { activate, deactivate };
}
