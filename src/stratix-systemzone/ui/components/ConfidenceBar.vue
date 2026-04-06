<template>
  <div class="confidence-bar">
    <div class="bar-track">
      <div
        class="bar-fill"
        :style="{
          width: `${Math.round(confidence * 100)}%`,
          backgroundColor: barColor
        }"
      ></div>
    </div>
    <span class="value">{{ Math.round(confidence * 100) }}%</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  confidence: number; // 0-1
}>();

const barColor = computed(() => {
  if (props.confidence >= 0.8) return 'var(--ds-status-success)';
  if (props.confidence >= 0.5) return 'var(--ds-status-warning)';
  return 'var(--ds-status-danger)';
});
</script>

<style scoped>
.confidence-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bar-track {
  flex: 1;
  height: 4px;
  background: color-mix(in srgb, var(--ds-text-muted) 20%, transparent);
  border-radius: var(--ds-radius-sm, 2px);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: var(--ds-radius-sm, 2px);
  transition: width 0.3s ease;
}
.value {
  font-size: 12px;
  color: var(--ds-text-secondary);
  min-width: 36px;
  text-align: right;
}
</style>
