<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import StratixModal from './StratixModal.vue';
import StratixButton from './StratixButton.vue';
import SvgIcon from './SvgIcon.vue';

type ConfirmType = 'info' | 'success' | 'warning' | 'error' | 'confirm';

interface Props {
  visible: boolean;
  type?: ConfirmType;
  title?: string;
  content?: string;
  icon?: string;
  okText?: string;
  cancelText?: string;
  showCancel?: boolean;
  okDanger?: boolean;
  autofocus?: 'ok' | 'cancel';
}

const props = withDefaults(defineProps<Props>(), {
  type: 'confirm',
  showCancel: true,
  okDanger: false,
  autofocus: 'ok',
});

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'ok': [];
  'cancel': [];
}>();

const okRef = ref<any>(null);
const cancelRef = ref<any>(null);

const TYPE_CONFIG = {
  info: { icon: 'info', color: 'var(--ds-status-info)', iconAnim: 'ds-toast-icon-slide' },
  success: { icon: 'check-circle', color: 'var(--ds-status-success)', iconAnim: 'ds-toast-icon-bounce' },
  warning: { icon: 'alert-triangle', color: 'var(--ds-status-warning)', iconAnim: 'ds-toast-icon-pulse' },
  error: { icon: 'x-circle', color: 'var(--ds-status-danger)', iconAnim: 'ds-toast-icon-shake' },
  confirm: { icon: 'help-circle', color: 'var(--ds-status-info)', iconAnim: 'ds-toast-icon-slide' },
};

const config = computed(() => TYPE_CONFIG[props.type]);

watch(() => props.visible, async (val) => {
  if (val) {
    await nextTick();
    if (props.autofocus === 'ok') {
      okRef.value?.$el?.focus();
    } else if (props.autofocus === 'cancel') {
      cancelRef.value?.$el?.focus();
    }
  }
});

const handleOk = () => {
  emit('ok');
  emit('update:visible', false);
};

const handleCancel = () => {
  emit('cancel');
  emit('update:visible', false);
};
</script>

<template>
  <StratixModal
    :visible="visible"
    @update:visible="(v) => emit('update:visible', v)"
    :title="title"
    width="420px"
    :closable="false"
    :mask-closable="false"
    size="sm"
  >
    <div class="confirm-content">
      <div class="confirm-icon" :class="config.iconAnim" :style="{ color: config.color }">
        <SvgIcon :name="icon || config.icon" :size="48" />
      </div>
      <div v-if="content" class="confirm-text">{{ content }}</div>
      <slot />
    </div>
    
    <template #footer>
      <StratixButton
        v-if="showCancel"
        ref="cancelRef"
        size="sm"
        variant="secondary"
        @click="handleCancel"
      >
        {{ cancelText || '取消' }}
      </StratixButton>
      <StratixButton
        ref="okRef"
        size="sm"
        :variant="okDanger ? 'danger' : 'primary'"
        @click="handleOk"
      >
        {{ okText || '确定' }}
      </StratixButton>
    </template>
  </StratixModal>
</template>

<style scoped>
.confirm-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 16px;
}

.confirm-icon {
  margin-bottom: 16px;
  opacity: 0.9;
}

.confirm-text {
  font-size: var(--ds-font-size-md);
  color: var(--ds-text-secondary);
  line-height: 1.6;
  max-width: 320px;
}

@keyframes ds-toast-icon-bounce {
  0% { transform: scale(0); }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); }
}

@keyframes ds-toast-icon-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-2px); }
  80% { transform: translateX(2px); }
}

@keyframes ds-toast-icon-pulse {
  0% { transform: scale(1); opacity: 0.7; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes ds-toast-icon-slide {
  0% { transform: translateX(-8px); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .confirm-icon {
    animation: none !important;
  }
}
</style>
