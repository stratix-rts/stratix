<script setup lang="ts">
import { StratixModal } from '@/components/ui';
import CommandLog from '../stratix-command-panel/components/CommandLog.vue';

const props = defineProps<{
  visible: boolean;
  logs: any[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:visible', value: boolean): void;
}>();

const handleClose = () => {
  emit('update:visible', false);
};
</script>

<template>
  <StratixModal
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    title="指令日志"
    size="lg"
    @close="handleClose"
  >
    <CommandLog :logs="logs" />
  </StratixModal>
</template>
