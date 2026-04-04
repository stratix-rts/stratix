<script setup lang="ts">
import { computed } from 'vue';
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
}

const props = withDefaults(defineProps<Props>(), {
  type: 'confirm',
  showCancel: true,
  okDanger: false,
});

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'ok': [];
  'cancel': [];
}>();

const TYPE_CONFIG = {
  info: { icon: 'info', color: 'var(--ds-status-info)' },
  success: { icon: 'check-circle', color: 'var(--ds-status-success)' },
  warning: { icon: 'alert-triangle', color: 'var(--ds-status-warning)' },
  error: { icon: 'x-circle', color: 'var(--ds-status-danger)' },
  confirm: { icon: 'help-circle', color: 'var(--ds-status-info)' },
};

const config = computed(() => TYPE_CONFIG[props.type]);

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
    @update:visible="$emit('update:visible', $event)"
    :title="title"
    width="420px"
    :closable="false"
    :mask-closable="false"
    size="sm"
  >
    <div class="confirm-content">
      <div class="confirm-icon" :style="{ color: config.color }">
        <SvgIcon :name="icon || config.icon" :size="48" />
      </div>
      <div v-if="content" class="confirm-text">{{ content }}</div>
      <slot />
    </div>
    
    <template #footer>
      <StratixButton
        v-if="showCancel"
        size="sm"
        variant="secondary"
        @click="handleCancel"
      >
        {{ cancelText || '取消' }}
      </StratixButton>
      <StratixButton
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
  font-size: 14px;
  color: var(--ds-text-secondary);
  line-height: 1.6;
  max-width: 320px;
}
</style>
