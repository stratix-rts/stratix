/**
 * usePanelState — 面板通用状态 composable
 *
 * 提供统一的 loading / error / empty / retry 逻辑
 */
import { computed, type Ref } from 'vue';
import type { PanelKey } from '../../../stores/systemzone';
import { useSystemZoneStore } from '../../../stores/systemzone';

export function usePanelState(panelKey: PanelKey, dataRef: Ref<any[] | null | undefined>) {
  const store = useSystemZoneStore();

  const isLoading = computed(() => store.panelLoading[panelKey]);
  const panelError = computed(() => store.panelError[panelKey]);
  const isEmpty = computed(() => {
    const data = dataRef.value;
    if (Array.isArray(data)) return data.length === 0;
    return data == null;
  });

  async function retry() {
    await store.retryPanel(panelKey);
  }

  return { isLoading, panelError, isEmpty, retry };
}
