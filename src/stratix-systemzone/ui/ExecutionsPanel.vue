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
      <StratixButton variant="secondary" size="sm" @click="retry">重试</StratixButton>
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
        :key="exec.proposalId"
        class="execution-card"
      >
        <div class="exec-header">
          <div class="exec-id">
            <span class="label">Proposal</span>
            <code>{{ exec.proposalId.slice(0, 8) }}</code>
          </div>
          <StatusBadge :status="exec.success ? 'completed' : 'failed'" />
        </div>

        <div class="exec-stats">
          <div class="stat">
            <span class="stat-value">{{ exec.phase }}</span>
            <span class="stat-label">阶段</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ formatDuration(exec.duration) }}</span>
            <span class="stat-label">耗时</span>
          </div>
          <div class="stat">
            <span class="stat-value" :class="exec.success ? 'pass' : 'fail'">
              {{ exec.success ? '成功' : '失败' }}
            </span>
            <span class="stat-label">结果</span>
          </div>
        </div>

        <div class="exec-footer">
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
import StratixButton from '@/components/ui/StratixButton.vue';
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
  { label: '成功', value: 'success' },
  { label: '失败', value: 'failed' },
];

const filteredExecutions = computed(() => {
  if (activeTab.value === 'all') return store.executions;
  if (activeTab.value === 'success') return store.executions.filter(e => e.success);
  return store.executions.filter(e => !e.success);
});

function getTabCount(status: string): number {
  if (status === 'all') return store.executions.length;
  if (status === 'success') return store.executions.filter(e => e.success).length;
  return store.executions.filter(e => !e.success).length;
}

function formatDuration(ms: number): string {
  if (!ms && ms !== 0) return '--';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
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
  border-bottom: 1px solid var(--ds-border-subtle);
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
  color: var(--ds-text-secondary);
  font-size: var(--ds-typography-fontSize-sm, 12px);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.tab:hover { color: var(--ds-text-primary); }
.tab.active {
  color: var(--ds-color-primary);
  background: color-mix(in srgb, var(--ds-color-primary) 10%, transparent);
}
.count {
  font-size: 11px;
  background: color-mix(in srgb, var(--ds-text-secondary) 10%, transparent);
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
  color: var(--ds-text-muted);
  text-align: center;
}
.state-text { font-size: var(--ds-typography-fontSize-sm, 12px); color: var(--ds-text-secondary); }
.state-icon { font-size: 40px; }

.state-error .state-icon { color: var(--ds-status-danger); }

/* Spinner */
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--ds-border-subtle);
  border-top-color: var(--ds-color-primary);
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
  background: var(--ds-bg-elevated);
  border: 1px solid var(--ds-border-subtle);
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
  color: var(--ds-text-muted);
  text-transform: uppercase;
}
.exec-id code {
  font-size: var(--ds-typography-fontSize-sm, 12px);
  color: var(--ds-text-primary);
  background: color-mix(in srgb, var(--ds-text-secondary) 6%, transparent);
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
  color: var(--ds-text-primary);
}
.stat-value.pass { color: var(--ds-status-success); }
.stat-value.fail { color: var(--ds-status-danger); }
.stat-label {
  font-size: 11px;
  color: var(--ds-text-muted);
}

.exec-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--ds-spacing-sm, 8px);
}

.exec-hashes {
  display: flex;
  gap: 6px;
}
.hash {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: var(--ds-radius-sm, 2px);
  background: color-mix(in srgb, var(--ds-text-secondary) 6%, transparent);
  color: var(--ds-text-secondary);
  font-family: var(--ds-typography-fontFamily-mono, monospace);
}
.hash.rollback {
  background: color-mix(in srgb, var(--ds-color-accent) 10%, transparent);
  color: var(--ds-color-accent);
}

.exec-error {
  margin-top: 10px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--ds-status-danger) 10%, transparent);
  border-radius: var(--ds-radius-md, 4px);
  color: var(--ds-status-danger);
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
