<template>
  <span class="risk-tag" :class="`risk-${level}`">
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  level: 'low' | 'medium' | 'high' | 'critical';
}>();

const LABELS: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '极高风险',
};

const label = computed(() => LABELS[props.level] || props.level);
</script>

<style scoped>
.risk-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--ds-radius-sm, 4px);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.risk-low {
  background: color-mix(in srgb, var(--ds-status-success) 15%, transparent);
  color: var(--ds-status-success);
}
.risk-medium {
  background: color-mix(in srgb, var(--ds-status-warning) 15%, transparent);
  color: var(--ds-status-warning);
}
.risk-high {
  background: color-mix(in srgb, var(--ds-status-danger) 60%, transparent);
  color: var(--ds-status-danger);
}
.risk-critical {
  background: color-mix(in srgb, var(--ds-status-danger) 15%, transparent);
  color: var(--ds-status-danger);
}
</style>
