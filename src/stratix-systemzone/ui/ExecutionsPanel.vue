<template>
  <div class="executions-panel">
    <div class="panel-header">
      <div class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          class="tab"
          :class="{ active: activeTab === tab.value }"
          @click="activeTab = tab.value"
        >
          {{ tab.label }}
          <span class="count">{{ getTabCount(tab.value) }}</span>
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading && store.executions.length === 0" class="panel-state">
      <span class="spinner"></span>
      <span class="state-text">加载中...</span>
    </div>

    <!-- Error -->
    <div v-else-if="panelError && store.executions.length === 0" class="panel-state state-error">
      <span class="state-icon">⚠️</span>
      <span class="state-text">{{ panelError }}</span>
      <button class="btn-retry" @click="retry">重试</button>
    </div>

    <!-- Empty -->
    <div v-else-if="filteredExecutions.length === 0" class="panel-state">
      <span class="state-icon">⚡</span>
      <p class="state-text">暂无执行记录</p>
    </div>

    <!-- List -->
    <div v-else class="executions-list">
      <div
        v-for="exec in filteredExecutions"
        :key="exec.proposalId + exec.startedAt"
        class="execution-card"
      >
        <div class="exec-header">
          <div class="exec-id">
            <span class="label">Proposal</span>
            <code>{{ exec.proposalId.slice(0, 8) }}</code>
          </div>
          <StatusBadge :status="exec.status" />
        </div>

        <div class="exec-stats">
          <div class="stat">
            <span class="stat-value">{{ exec.changes.length }}</span>
            <span class="stat-label">修改文件</span>
          </div>
          <div class="stat" v-if="exec.testResults">
            <span class="stat-value" :class="testClass(exec.testResults)">
              {{ exec.testResults.passed }}/{{ exec.testResults.total }}
            </span>
            <span class="stat-label">测试结果</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ formatDuration(exec) }}</span>
            <span class="stat-label">耗时</span>
          </div>
        </div>

        <div class="exec-footer">
          <div class="exec-time">
            <span>{{ formatTime(exec.startedAt) }}</span>
            <span v-if="exec.completedAt"> → {{ formatTime(exec.completedAt) }}</span>
          </div>
          <div class="exec-hashes">
            <code v-if="exec.commitHash" class="hash" title="Commit">
              {{ exec.commitHash.slice(0, 8) }}
            </code>
            <code v-if="exec.rollbackHash" class="hash rollback" title="Rollback">
              {{ exec.rollbackHash.slice(0, 8) }}
            </code>
          </div>
        </div>

        <div v-if="exec.error" class="exec-error">
          {{ exec.error }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSystemZoneStore } from '../../stores/systemzone';
import StatusBadge from './components/StatusBadge.vue';
import { useAutoRefresh } from './composables/useAutoRefresh';
import { usePanelState } from './composables/usePanelState';

const store = useSystemZoneStore();
const activeTab = ref('all');

const executionsRef = computed(() => store.executions);
const { isLoading, panelError, retry } = usePanelState('executions', executionsRef);

useAutoRefresh(() => store.fetchExecutions(), { immediate: false });

const tabs = [
  { label: '全部', value: 'all' },
  { label: '运行中', value: 'running' },
  { label: '完成', value: 'completed' },
  { label: '失败', value: 'failed' },
];

const filteredExecutions = computed(() => {
  if (activeTab.value === 'all') return store.executions;
  return store.executions.filter(e => e.status === activeTab.value);
});

function getTabCount(status: string): number {
  if (status === 'all') return store.executions.length;
  return store.executions.filter(e => e.status === status).length;
}

function testClass(results: { passed: number; total: number }): string {
  if (results.failed > 0) return 'fail';
  if (results.passed === results.total) return 'pass';
  return '';
}

function formatDuration(exec: any): string {
  if (!exec.completedAt || !exec.startedAt) return '--';
  const ms = new Date(exec.completedAt).getTime() - new Date(exec.startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
</script>

<style scoped>
.executions-panel {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-md, 16px);
  height: 100%;
}

.panel-header {
  border-bottom: 1px solid var(--ds-border-subtle, #1e1e2e);
  padding-bottom: 8px;
}

.tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: transparent;
  border: none;
  border-radius: var(--ds-radius-sm, 2px) var(--ds-radius-sm, 2px) 0 0;
  color: var(--ds-text-secondary, #a0a0b0);
  font-size: var(--ds-typography-fontSize-sm, 12px);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.tab:hover { color: var(--ds-text-primary, #ffffff); }
.tab.active {
  color: var(--ds-color-primary, #00cccc);
  background: rgba(0, 204, 204, 0.1);
}
.count {
  font-size: 11px;
  background: rgba(148, 163, 184, 0.1);
  padding: 1px 6px;
  border-radius: 10px;
}

/* Panel states */
.panel-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px 20px;
  color: var(--ds-text-muted, #6a6a8a);
  text-align: center;
}
.state-text { font-size: var(--ds-typography-fontSize-sm, 12px); color: var(--ds-text-secondary, #a0a0b0); }
.state-icon { font-size: 40px; }

.state-error .state-icon { color: var(--ds-status-danger, #ff4444); }
.btn-retry {
  padding: 4px 12px;
  background: transparent;
  border: 1px solid var(--ds-border-default, #2a2a3e);
  border-radius: var(--ds-radius-sm, 2px);
  color: var(--ds-text-secondary, #a0a0b0);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-retry:hover { border-color: var(--ds-color-primary, #00cccc); color: var(--ds-color-primary, #00cccc); }

/* Spinner */
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--ds-border-subtle, #1e1e2e);
  border-top-color: var(--ds-color-primary, #00cccc);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.executions-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}

.execution-card {
  background: var(--ds-bg-elevated, #12121a);
  border: 1px solid var(--ds-border-subtle, #1e1e2e);
  border-radius: var(--ds-radius-lg, 8px);
  padding: 14px var(--ds-spacing-md, 16px);
}

.exec-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.exec-id {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm, 8px);
}
.exec-id .label {
  font-size: 11px;
  color: var(--ds-text-muted, #6a6a8a);
  text-transform: uppercase;
}
.exec-id code {
  font-size: var(--ds-typography-fontSize-sm, 12px);
  color: var(--ds-text-primary, #ffffff);
  background: rgba(148, 163, 184, 0.06);
  padding: 2px 8px;
  border-radius: var(--ds-radius-sm, 2px);
  font-family: var(--ds-typography-fontFamily-mono, monospace);
}

.exec-stats {
  display: flex;
  gap: var(--ds-spacing-lg, 24px);
  margin-bottom: 12px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat-value {
  font-size: 18px;
  font-weight: var(--ds-typography-fontWeight-semibold, 600);
  color: var(--ds-text-primary, #ffffff);
}
.stat-value.pass { color: var(--ds-status-success, #00ff88); }
.stat-value.fail { color: var(--ds-status-danger, #ff4444); }
.stat-label {
  font-size: 11px;
  color: var(--ds-text-muted, #6a6a8a);
}

.exec-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--ds-spacing-sm, 8px);
}

.exec-time {
  font-size: 12px;
  color: var(--ds-text-muted, #6a6a8a);
}

.exec-hashes {
  display: flex;
  gap: 6px;
}
.hash {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: var(--ds-radius-sm, 2px);
  background: rgba(148, 163, 184, 0.06);
  color: var(--ds-text-secondary, #a0a0b0);
  font-family: var(--ds-typography-fontFamily-mono, monospace);
}
.hash.rollback {
  background: rgba(168, 85, 247, 0.1);
  color: #a855f7;
}

.exec-error {
  margin-top: 10px;
  padding: 10px 12px;
  background: rgba(255, 68, 68, 0.1);
  border-radius: var(--ds-radius-md, 4px);
  color: var(--ds-status-danger, #ff4444);
  font-size: var(--ds-typography-fontSize-sm, 12px);
}

/* Responsive */
@media (max-width: 640px) {
  .exec-stats {
    flex-wrap: wrap;
    gap: var(--ds-spacing-md, 16px);
  }
  .stat-value { font-size: 16px; }
  .execution-card { padding: 10px 12px; }
}
</style>
