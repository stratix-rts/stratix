<script setup lang="ts">
import { computed } from 'vue';
import { getToken } from '@/design-system/config';
import SvgIcon from './SvgIcon.vue';

interface Props {
  /** 警告类型 */
  type?: 'warning' | 'danger' | 'info' | 'success';
  /** 警告文本 */
  text?: string;
  /** 是否显示图标 */
  showIcon?: boolean;
  /** 自定义图标名称 */
  icon?: string;
}

const props = withDefaults(defineProps<Props>(), {
  type: 'warning',
  showIcon: true,
});

const colorMap: Record<string, string> = {
  warning: getToken('colors.warning'),
  danger: getToken('colors.semantic.danger'),
  info: getToken('colors.info'),
  success: getToken('colors.semantic.success'),
};

const iconMap: Record<string, string> = {
  warning: 'alert-triangle',
  danger: 'x-circle',
  info: 'info',
  success: 'check-circle',
};

const color = computed(() => colorMap[props.type]);
const bgColor = computed(() => color.value + '1A');
const borderColor = computed(() => color.value + '33');
const iconName = computed(() => props.icon || iconMap[props.type]);
</script>

<template>
  <div
    class="warning-box"
    :style="{
      color: color,
      background: bgColor,
      borderColor: borderColor,
    }"
  >
    <SvgIcon v-if="showIcon" :name="iconName" class="warning-icon" />
    <span class="warning-text">
      <slot>{{ text }}</slot>
    </span>
  </div>
</template>

<style scoped>
.warning-box {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
}

.warning-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.warning-text {
  flex: 1;
  min-width: 0;
}
</style>
