import { ref, computed } from 'vue';
import type { Ref } from 'vue';

const counter = ref(0);
const delayedShow = ref(false);
let timeoutId: ReturnType<typeof setTimeout> | null = null;
const DELAY_MS = 200;

export interface GlobalLoadingState {
  isLoading: Ref<boolean>;
  show: () => void;
  hide: () => void;
}

export function useGlobalLoading(): GlobalLoadingState {
  const isLoading = computed(() => counter.value > 0 && delayedShow.value);

  const show = () => {
    counter.value++;

    if (counter.value === 1) {
      timeoutId = setTimeout(() => {
        if (counter.value > 0) {
          delayedShow.value = true;
        }
      }, DELAY_MS);
    }
  };

  const hide = () => {
    counter.value = Math.max(0, counter.value - 1);

    if (counter.value === 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      delayedShow.value = false;
    }
  };

  return {
    show,
    hide,
    isLoading,
  };
}
