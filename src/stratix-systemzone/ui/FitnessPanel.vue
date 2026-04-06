<template>
  <div class="fitness-panel">
    <div class="panel-header">
      <h3 class="panel-title">健康评估</h3>
      <button class="btn-refresh" @click="handleRefresh" :disabled="isLoading">
        ↻ 刷新
      </button>
    </div>

    <!-- Loading -->
    <div v-if="isLoading && !store.fitness" class="panel-state">
      <span class="spinner"></span>
      <span class="state-text">加载中...</span>
    </div>

    <!-- Error -->
    <div v-else-if="panelError" class="panel-state state-error">
      <span class="state-icon">⚠️</span>
      <span class="state-text">{{ panelError }}</span>
      <button class="btn-retry" @click="handleRefresh">重试</button>
    </div>

    <!-- Empty / No Data -->
    <div v-else-if="!store.fitness" class="panel-state">
      <span class="state-icon">◎</span>
      <span class="state-text">暂无健康报告</span>
    </div>

    <!-- Fitness Content -->
    <template v-else>
      <!-- Overall Score (center) -->
      <div class="score-center">
        <div class="overall-score" :class="overallScoreClass">
          {{ store.fitness.overall }}
        </div>
        <span class="overall-label">综合评分</span>
      </div>

      <!-- Three rows: typeSafety, lint, codeSize -->
      <div class="scores-rows">
        <ScoreRow label="类型安全" :score="store.fitness.typeSafety" :color-class="overallScoreClass" />
        <ScoreRow label="Lint" :score="store.fitness.lint" :color-class="overallScoreClass" />
        <ScoreRow label="代码体积" :score="store.fitness.codeSize" :color-class="overallScoreClass" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSystemZoneStore } from '../../stores/systemzone';
import { useAutoRefresh } from './composables/useAutoRefresh';
import { usePanelState } from './composables/usePanelState';

const store = useSystemZoneStore();
const fitnessDataRef = computed(() => store.fitness ? [store.fitness] : null);
const { isLoading, panelError, retry } = usePanelState('fitness', fitnessDataRef);

const { refresh } = useAutoRefresh(() => store.fetchFitness(), { immediate: false });

async function handleRefresh() {
  await retry();
}

function overallScoreClass(): string {
  const s = store.fitness?.overall ?? 0;
  if (s > 80) return 'score-green';
  if (s > 50) return 'score-yellow';
  return 'score-red';
}
</script>

<script lang="ts">
import { defineComponent, h } from 'vue';

const ScoreRow = defineComponent({
  props: {
    label: { type: String, required: true },
    score: { type: Number, required: true },
    colorClass: { type: String, required: true },
  },
  setup(props) {
    return () =>
      h('div', { class: 'score-row' }, [
        h('span', { class: 'row-label' }, props.label),
        h('div', { class: 'row-bar' }, [
          h('div', {
            class: ['row-fill', props.colorClass],
            style: { width: `${props.score}%` },
          }),
        ]),
        h('span', { class: 'row-val' }, props.score),
      ]);
  },
});
</script>

<style scoped>
.fitness-panel {
  background: var(--ds-bg-elevated, #12121a);
  border-radius: var(--ds-radius-lg, 8px);
  border: 1px solid var(--ds-border-subtle, #1e1e2e);
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px var(--ds-spacing-md, 16px);
  border-bottom: 1px solid var(--ds-border-subtle, #1e1e2e);
}

.panel-title {
  margin: 0;
  font-size: var(--ds-typography-fontSize-md, 14px);
  font-weight: var(--ds-typography-fontWeight-semibold, 600);
  color: var(--ds-text-primary, #ffffff);
}

.btn-refresh {
  background: transparent;
  border: 1px solid var(--ds-border-default, #2a2a3e);
  color: var(--ds-text-secondary, #a0a0b0);
  padding: 4px 10px;
  border-radius: var(--ds-radius-sm, 2px);
  font-size: 11px;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}
.btn-refresh:hover:not(:disabled) { border-color: var(--ds-status-info, #00cccc); color: var(--ds-status-info, #00cccc); }
.btn-refresh:disabled { opacity: 0.5; cursor: not-allowed; }

/* Panel states */
.panel-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: var(--ds-spacing-sm, 8px);
}
.state-text { color: var(--ds-text-secondary, #a0a0b0); font-size: var(--ds-typography-fontSize-sm, 12px); }
.state-icon { font-size: 32px; color: var(--ds-text-muted, #6a6a8a); }

.state-error .state-icon { color: var(--ds-status-danger, #ff4444); }
.btn-retry {
  margin-top: var(--ds-spacing-xs, 4px);
  padding: 4px 12px;
  background: transparent;
  border: 1px solid var(--ds-border-default, #2a2a3e);
  border-radius: var(--ds-radius-sm, 2px);
  color: var(--ds-text-secondary, #a0a0b0);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-retry:hover { border-color: var(--ds-status-info, #00cccc); color: var(--ds-status-info, #00cccc); }

/* Spinner */
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--ds-border-subtle, #1e1e2e);
  border-top-color: var(--ds-status-info, #00cccc);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Overall score (center) */
.score-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--ds-spacing-lg, 24px);
  border-bottom: 1px solid var(--ds-border-subtle, #1e1e2e);
}

.overall-score {
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
}

.score-green { color: var(--ds-status-success); }
.score-yellow { color: var(--ds-status-warning); }
.score-red { color: var(--ds-status-danger); }

.overall-label {
  margin-top: 6px;
  font-size: 11px;
  color: var(--ds-text-muted, #6a6a8a);
}

/* Three rows */
.scores-rows {
  padding: var(--ds-spacing-md, 16px);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.score-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.row-label {
  font-size: 12px;
  color: var(--ds-text-primary, #ffffff);
  width: 72px;
  flex-shrink: 0;
}

.row-bar {
  flex: 1;
  height: 8px;
  background: color-mix(in srgb, var(--ds-text-muted, #94a3b8) 10%, transparent);
  border-radius: 4px;
  overflow: hidden;
}

.row-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.row-val {
  font-size: 12px;
  color: var(--ds-text-secondary, #a0a0b0);
  width: 28px;
  text-align: right;
  flex-shrink: 0;
}
</style>
