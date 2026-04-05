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
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.risk-low { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.risk-medium { background: rgba(234, 179, 8, 0.15); color: #eab308; }
.risk-high { background: rgba(249, 115, 22, 0.15); color: #f97316; }
.risk-critical { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
</style>
