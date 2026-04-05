<template>
  <div class="fitness-panel">
    <div class="panel-header">
      <h3 class="panel-title">健康评估</h3>
      <button class="btn-refresh" @click="store.fetchFitness()" :disabled="store.loading">
        ↻ 刷新
      </button>
    </div>

    <!-- Loading -->
    <div v-if="store.loading && !store.fitnessReport" class="loading-state">
      <span class="loading-text">加载中...</span>
    </div>

    <!-- Empty / No Report -->
    <div v-else-if="!store.fitnessReport" class="empty-state">
      <span class="empty-icon">◎</span>
      <span class="empty-text">暂无健康报告</span>
    </div>

    <!-- Report Content -->
    <template v-else>
      <!-- Overall Score -->
      <div class="score-section">
        <div class="score-circle">
          <span class="score-value">{{ store.fitnessReport.overallScore }}</span>
          <span class="score-max">/ 100</span>
        </div>
        <span class="score-label">健康总分</span>
      </div>

      <!-- Dimensions -->
      <div class="dimensions-section">
        <h4 class="section-title">维度评分</h4>
        <div class="dimensions-list">
          <div v-for="dim in store.fitnessReport.dimensions" :key="dim.name" class="dimension-item">
            <div class="dim-header">
              <span class="dim-name">{{ dim.name }}</span>
              <span class="dim-score">{{ dim.score }}/{{ dim.maxScore }}</span>
            </div>
            <div class="progress-bar">
              <div
                class="progress-fill"
                :style="{ width: `${(dim.score / dim.maxScore) * 100}%` }"
                :class="scoreClass(dim.score, dim.maxScore)"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Violations -->
      <div class="violations-section">
        <h4 class="section-title">违规项</h4>
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
            <div class="violation-header">
              <span class="severity-tag" :class="`severity-${violation.severity}`">
                {{ severityLabel(violation.severity) }}
              </span>
              <span class="violation-rule">{{ violation.rule }}</span>
            </div>
            <p class="violation-message">{{ violation.message }}</p>
            <span v-if="violation.file" class="violation-file">{{ violation.file }}</span>
          </div>
        </div>
      </div>

      <div class="checked-at">
        检查时间: {{ formatTime(store.fitnessReport.checkedAt) }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useSystemZoneStore } from '../../stores/systemzone';

const store = useSystemZoneStore();

function severityLabel(severity: string): string {
  switch (severity) {
    case 'info': return '提示';
    case 'warning': return '警告';
    case 'error': return '错误';
    default: return severity;
  }
}

function scoreClass(score: number, max: number): string {
  const ratio = score / max;
  if (ratio >= 0.8) return 'fill-good';
  if (ratio >= 0.5) return 'fill-warn';
  return 'fill-bad';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

onMounted(() => {
  store.fetchFitness();
});
</script>

<style scoped>
.fitness-panel {
  background: #0f1117;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.1);
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.panel-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #e2e8f0;
}

.btn-refresh {
  background: transparent;
  border: 1px solid rgba(148, 163, 184, 0.2);
  color: #94a3b8;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}
.btn-refresh:hover:not(:disabled) { border-color: #3b82f6; color: #3b82f6; }
.btn-refresh:disabled { opacity: 0.5; cursor: not-allowed; }

/* States */
.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 8px;
}
.loading-text { color: #94a3b8; font-size: 13px; }
.empty-icon { font-size: 32px; color: #94a3b8; }
.empty-text { color: #94a3b8; font-size: 13px; }

/* Score Section */
.score-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.score-circle {
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.score-value {
  font-size: 48px;
  font-weight: 700;
  color: #e2e8f0;
  line-height: 1;
}

.score-max {
  font-size: 18px;
  color: #64748b;
}

.score-label {
  margin-top: 6px;
  font-size: 12px;
  color: #64748b;
}

/* Dimensions */
.dimensions-section {
  padding: 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.section-title {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: #e2e8f0;
}

.dimensions-list { display: flex; flex-direction: column; gap: 10px; }

.dimension-item {}

.dim-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}
.dim-name { font-size: 12px; color: #e2e8f0; }
.dim-score { font-size: 12px; color: #94a3b8; }

.progress-bar {
  height: 6px;
  background: rgba(148, 163, 184, 0.1);
  border-radius: 3px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.fill-good { background: #22c55e; }
.fill-warn { background: #eab308; }
.fill-bad { background: #ef4444; }

/* Violations */
.violations-section { padding: 16px; }

.empty-violations {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  padding: 20px;
  color: #22c55e;
  font-size: 13px;
}
.ok-icon { font-size: 16px; }

.violations-list { display: flex; flex-direction: column; gap: 10px; }

.violation-item {
  background: rgba(148, 163, 184, 0.03);
  border: 1px solid rgba(148, 163, 184, 0.08);
  border-radius: 6px;
  padding: 10px 12px;
}

.violation-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.severity-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 500;
  text-transform: uppercase;
}
.severity-info { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
.severity-warning { background: rgba(234, 179, 8, 0.15); color: #eab308; }
.severity-error { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

.violation-rule { font-size: 12px; font-weight: 500; color: #e2e8f0; }

.violation-message {
  font-size: 12px;
  color: #94a3b8;
  margin: 0 0 4px;
  line-height: 1.4;
}

.violation-file {
  font-size: 11px;
  color: #64748b;
  font-family: monospace;
}

/* Footer */
.checked-at {
  padding: 10px 16px;
  font-size: 11px;
  color: #64748b;
  border-top: 1px solid rgba(148, 163, 184, 0.1);
  text-align: right;
}
</style>
