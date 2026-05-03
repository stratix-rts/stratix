import { ref, computed } from 'vue';

import { rtsEventBus } from '@/stratix-rts/events/core/RTSEventBus';

const MODAL_STATE_EVENT = 'vue:modal:state_changed';

interface ModalStatePayload {
  hasOpenModal: boolean;
  count: number;
}

export function useModalState() {
  const openModalCount = ref(0);
  const hasOpenModal = computed(() => openModalCount.value > 0);

  const openModal = () => {
    openModalCount.value++;
    (rtsEventBus.emit as (event: string, payload: ModalStatePayload) => void)(MODAL_STATE_EVENT, {
      hasOpenModal: hasOpenModal.value,
      count: openModalCount.value
    });
  };

  const closeModal = () => {
    openModalCount.value = Math.max(0, openModalCount.value - 1);
    (rtsEventBus.emit as (event: string, payload: ModalStatePayload) => void)(MODAL_STATE_EVENT, {
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
