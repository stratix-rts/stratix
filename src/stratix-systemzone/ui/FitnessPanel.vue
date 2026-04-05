<template>
  <div class="fitness-panel">
    <div class="panel-header">
      <h3 class="panel-title">健康评估</h3>
      <button class="btn-refresh" @click="handleRefresh" :disabled="isLoading">
        ↻ 刷新
      </button>
    </div>

    <!-- Loading -->
    <div v-if="isLoading && !store.fitnessReport" class="panel-state">
      <span class="spinner"></span>
      <span class="state-text">加载中...</span>
    </div>

    <!-- Error -->
    <div v-else-if="panelError" class="panel-state state-error">
      <span class="state-icon">⚠️</span>
      <span class="state-text">{{ panelError }}</span>
      <button class="btn-retry" @click="handleRefresh">重试</button>
    </div>

    <!-- Empty / No Report -->
    <div v-else-if="!store.fitnessReport" class="panel-state">
      <span class="state-icon">◎</span>
      <span class="state-text">暂无健康报告</span>
    </div>

    <!-- Report Content -->
    <template v-else>
      <!-- Overall Score -->
      <div class="score-section">
        <div class="score-circle">
          <span class="score-value">{{ store.fitnessReport.scores.overall }}</span>
          <span class="score-max">/ 100</span>
        </div>
        <span class="score-label">健康总分</span>
        <span class="passed-tag" :class="store.fitnessReport.passed ? 'passed' : 'failed'">
          {{ store.fitnessReport.passed ? '✓ 通过' : '✗ 未通过' }}
        </span>
      </div>

      <!-- Scores -->
      <div class="scores-section">
        <h4 class="section-title">维度评分</h4>
        <div class="scores-list">
          <div class="score-item">
            <div class="score-header">
              <span class="score-name">代码质量</span>
              <span class="score-val">{{ store.fitnessReport.scores.codeQuality }}/100</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: store.fitnessReport.scores.codeQuality + '%' }" :class="scoreClass(store.fitnessReport.scores.codeQuality)"></div>
            </div>
          </div>
          <div class="score-item">
            <div class="score-header">
              <span class="score-name">性能</span>
              <span class="score-val">{{ store.fitnessReport.scores.performance }}/100</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: store.fitnessReport.scores.performance + '%' }" :class="scoreClass(store.fitnessReport.scores.performance)"></div>
            </div>
          </div>
          <div class="score-item">
            <div class="score-header">
              <span class="score-name">系统健康</span>
              <span class="score-val">{{ store.fitnessReport.scores.systemHealth }}/100</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: store.fitnessReport.scores.systemHealth + '%' }" :class="scoreClass(store.fitnessReport.scores.systemHealth)"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Metrics -->
      <div class="metrics-section">
        <h4 class="section-title">关键指标</h4>
        <div class="metrics-grid">
          <div class="metric-item">
            <span class="metric-label">测试覆盖率</span>
            <span class="metric-value">{{ (store.fitnessReport.metrics.testCoverage * 100).toFixed(1) }}%</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">圈复杂度</span>
            <span class="metric-value">{{ store.fitnessReport.metrics.cyclomaticComplexity }}</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">重复率</span>
            <span class="metric-value">{{ (store.fitnessReport.metrics.duplicationRate * 100).toFixed(1) }}%</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">响应时间</span>
            <span class="metric-value">{{ store.fitnessReport.metrics.responseTime }}ms</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">错误率</span>
            <span class="metric-value">{{ (store.fitnessReport.metrics.errorRate * 100).toFixed(1) }}%</span>
          </div>
        </div>
      </div>

      <!-- Violations -->
      <div class="violations-section">
        <h4 class="section-title">违规项 ({{ store.fitnessReport.violations.length }})</h4>
        <div v-if="store.fitnessReport.violations.length === 0" class="empty-violations">
          <span class="ok-icon">✓</span>
          <span>无违规项</span>
        </div>
        <div v-else class="violations-list">
          <div
            v-for="(violation, idx) in store.fitnessReport.violations"
            :key="idx"
            class="violation-item"
          >
            <p class="violation-message">{{ violation }}</p>
          </div>
        </div>
      </div>

      <div class="checked-at">
        检查时间: {{ formatTime(store.fitnessReport.timestamp) }}
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
const fitnessDataRef = computed(() => store.fitnessReport ? [store.fitnessReport] : null);
const { isLoading, panelError, retry } = usePanelState('fitness', fitnessDataRef);

const { refresh } = useAutoRefresh(() => store.fetchFitness(), { immediate: false });

async function handleRefresh() {
  await retry();
}

function scoreClass(score: number): string {
  if (score >= 80) return 'fill-good';
  if (score >= 50) return 'fill-warn';
  return 'fill-bad';
}

function formatTime(ts: string | Date): string {
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
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

/* Score Section */
.score-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--ds-spacing-lg, 24px);
  border-bottom: 1px solid var(--ds-border-subtle, #1e1e2e);
}

.score-circle {
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.score-value {
  font-size: 48px;
  font-weight: var(--ds-typography-fontWeight-bold, 700);
  color: var(--ds-text-primary, #ffffff);
  line-height: 1;
}

.score-max {
  font-size: 18px;
  color: var(--ds-text-muted, #6a6a8a);
}

.score-label {
  margin-top: 6px;
  font-size: 11px;
  color: var(--ds-text-muted, #6a6a8a);
}

.passed-tag {
  margin-top: 8px;
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 10px;
  font-weight: 500;
}
.passed-tag.passed {
  background: color-mix(in srgb, var(--ds-status-success, #00ff88) 15%, transparent);
  color: var(--ds-status-success, #00ff88);
}
.passed-tag.failed {
  background: color-mix(in srgb, var(--ds-status-danger, #ff4444) 15%, transparent);
  color: var(--ds-status-danger, #ff4444);
}

/* Scores */
.scores-section {
  padding: var(--ds-spacing-md, 16px);
  border-bottom: 1px solid var(--ds-border-subtle, #1e1e2e);
}

.section-title {
  margin: 0 0 12px;
  font-size: var(--ds-typography-fontSize-sm, 12px);
  font-weight: var(--ds-typography-fontWeight-semibold, 600);
  color: var(--ds-text-primary, #ffffff);
}

.scores-list { display: flex; flex-direction: column; gap: 10px; }

.score-item { }
.score-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}
.score-name { font-size: 12px; color: var(--ds-text-primary, #ffffff); }
.score-val { font-size: 12px; color: var(--ds-text-secondary, #a0a0b0); }

.progress-bar {
  height: 6px;
  background: color-mix(in srgb, var(--ds-text-muted, #94a3b8) 10%, transparent);
  border-radius: 3px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.fill-good { background: var(--ds-status-success, #00ff88); }
.fill-warn { background: var(--ds-status-warning, #fbbf24); }
.fill-bad { background: var(--ds-status-danger, #ff4444); }

/* Metrics */
.metrics-section {
  padding: var(--ds-spacing-md, 16px);
  border-bottom: 1px solid var(--ds-border-subtle, #1e1e2e);
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.metric-label { font-size: 11px; color: var(--ds-text-muted, #6a6a8a); }
.metric-value { font-size: 14px; font-weight: 600; color: var(--ds-text-primary, #ffffff); }

/* Violations */
.violations-section { padding: var(--ds-spacing-md, 16px); }

.empty-violations {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm, 8px);
  justify-content: center;
  padding: 20px;
  color: var(--ds-status-success, #00ff88);
  font-size: var(--ds-typography-fontSize-sm, 12px);
}
.ok-icon { font-size: 16px; }

.violations-list { display: flex; flex-direction: column; gap: 8px; }

.violation-item {
  background: var(--ds-bg-sunken, rgba(148, 163, 184, 0.03));
  border: 1px solid var(--ds-border-subtle, #1e1e2e);
  border-radius: var(--ds-radius-md, 4px);
  padding: 8px 12px;
}

.violation-message {
  font-size: 12px;
  color: var(--ds-text-secondary, #a0a0b0);
  margin: 0;
  line-height: 1.4;
}

/* Footer */
.checked-at {
  padding: 10px var(--ds-spacing-md, 16px);
  font-size: 11px;
  color: var(--ds-text-muted, #6a6a8a);
  border-top: 1px solid var(--ds-border-subtle, #1e1e2e);
  text-align: right;
}

/* Responsive */
@media (max-width: 640px) {
  .score-value { font-size: 36px; }
  .scores-section, .violations-section { padding: 12px; }
}
</style>
