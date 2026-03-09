<script setup lang="ts">
import { computed, toRef } from 'vue';
import { getIconPath } from '@/design-system/icons/registry';
import { useIconSize } from '@/design-system/composables/useSizeContext';

interface Props {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

const props = withDefaults(defineProps<Props>(), {
  color: 'currentColor',
  strokeWidth: 2,
});

const resolvedSize = useIconSize(toRef(props, 'size'));
const iconPath = computed(() => getIconPath(props.name) || '');
</script>

<template>
  <svg
    class="svg-icon"
    viewBox="0 0 24 24"
    :width="resolvedSize"
    :height="resolvedSize"
    fill="none"
    :stroke="color"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    v-html="iconPath"
  />
</template>

<style scoped>
.svg-icon {
  display: inline-flex;
  vertical-align: middle;
  flex-shrink: 0;
  overflow: visible;
}
</style>
