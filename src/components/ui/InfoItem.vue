<script setup lang="ts">
import { computed } from 'vue';
import { getToken } from '@/design-system/config';

interface Props {
  /** 标签文本 */
  label?: string;
  /** 值文本 */
  value?: string;
  /** 布局方向 */
  direction?: 'vertical' | 'horizontal';
  /** 是否显示边框分隔线（仅水平模式） */
  bordered?: boolean;
  /** 是否为内联样式（无背景） */
  plain?: boolean;
  /** 是否为等宽字体值 */
  mono?: boolean;
  /** 值颜色（可选） */
  valueColor?: string;
}

const props = withDefaults(defineProps<Props>(), {
  direction: 'vertical',
  bordered: true,
  plain: false,
  mono: false,
});

const styles = computed(() => ({
  container: {
    display: props.direction === 'horizontal' ? 'flex' : 'flex',
    flexDirection: props.direction === 'horizontal' ? 'row' : 'column',
    justifyContent: props.direction === 'horizontal' ? 'space-between' : 'flex-start',
    alignItems: props.direction === 'horizontal' ? 'center' : 'flex-start',
    padding: props.plain ? '0' : '10px 12px',
    background: props.plain ? 'transparent' : getToken('colors.background.tertiary'),
    borderRadius: props.plain ? '0' : '6px',
    borderBottom: props.direction === 'horizontal' && props.bordered
      ? `1px solid ${getToken('colors.border.default')}`
      : 'none',
    gap: props.direction === 'vertical' ? '4px' : '0',
  },
  label: {
    fontSize: '12px',
    fontWeight: '500',
    color: getToken('colors.text.muted'),
    textTransform: props.plain ? 'none' : 'uppercase',
    letterSpacing: props.plain ? 'normal' : '0.3px',
  },
  value: {
    fontSize: props.mono ? '11px' : '13px',
    color: props.valueColor || getToken('colors.text.primary'),
    fontFamily: props.mono ? "'SF Mono', 'Monaco', monospace" : 'inherit',
    wordBreak: 'break-all',
  },
}));
</script>

<template>
  <div class="info-item" :style="styles.container">
    <span v-if="label" class="info-label" :style="styles.label">{{ label }}</span>
    <span class="info-value" :style="styles.value">
      <slot>{{ value }}</slot>
    </span>
  </div>
</template>

<style scoped>
.info-item {
  box-sizing: border-box;
}

.info-item[style*="flex-direction: column"] {
  flex-direction: column;
}

.info-label {
  flex-shrink: 0;
}

.info-value {
  flex: 1;
  min-width: 0;
}
</style>
