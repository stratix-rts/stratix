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
  if (props.confidence >= 0.8) return '#22c55e';
  if (props.confidence >= 0.5) return '#eab308';
  return '#ef4444';
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
  background: rgba(148, 163, 184, 0.2);
  border-radius: 2px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}
.value {
  font-size: 12px;
  color: var(--ds-text-secondary, #94a3b8);
  min-width: 36px;
  text-align: right;
}
</style>
