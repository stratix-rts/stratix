import { ref, computed } from 'vue';

import { rtsEventBus } from '@/stratix-rts/events/core/RTSEventBus';

const openModalCount = ref(0);

export function useModalState() {
  const hasOpenModal = computed(() => openModalCount.value > 0);

  const openModal = () => {
    openModalCount.value++;
    rtsEventBus.emit('vue:modal:state_changed' as any, {
      hasOpenModal: hasOpenModal.value,
      count: openModalCount.value
    });
  };

  const closeModal = () => {
    openModalCount.value = Math.max(0, openModalCount.value - 1);
    rtsEventBus.emit('vue:modal:state_changed' as any, {
      hasOpenModal: hasOpenModal.value,
      count: openModalCount.value
    });
  };

  return {
    openModalCount,
    hasOpenModal,
    openModal,
    closeModal
  };
}
