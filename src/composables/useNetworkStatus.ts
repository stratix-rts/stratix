import { ref, onMounted, onUnmounted } from 'vue';
import type { Ref } from 'vue';

export interface NetworkStatus {
  isOnline: Ref<boolean>;
  wasOffline: Ref<boolean>;
}

export function useNetworkStatus(
  onChange?: (online: boolean) => void
): NetworkStatus {
  const isOnline = ref(true);
  const wasOffline = ref(false);

  const handleOnline = () => {
    isOnline.value = true;
    wasOffline.value = true;
    onChange?.(true);
  };

  const handleOffline = () => {
    isOnline.value = false;
    onChange?.(false);
  };

  onMounted(() => {
    isOnline.value = navigator.onLine;
    wasOffline.value = !navigator.onLine;
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  });

  onUnmounted(() => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  });

  return { isOnline, wasOffline };
}
