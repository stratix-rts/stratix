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

    <div v-if="store.loading" class="loading">
      <span class="spinner"></span>
      加载中...
    </div>

    <div v-else-if="filteredExecutions.length === 0" class="empty-state">
      <span class="empty-icon">⚡</span>
      <p>暂无执行记录</p>
    </div>

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

const store = useSystemZoneStore();
const activeTab = ref('all');

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
  gap: 16px;
  height: 100%;
}

.panel-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 8px;
}

.tabs {
  display: flex;
  gap: 4px;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: transparent;
  border: none;
  border-radius: 4px 4px 0 0;
  color: #94a3b8;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.tab:hover {
  color: #e2e8f0;
}
.tab.active {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
}
.count {
  font-size: 11px;
  background: rgba(255, 255, 255, 0.1);
  padding: 1px 6px;
  border-radius: 10px;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px;
  color: #94a3b8;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #64748b;
  text-align: center;
}
.empty-icon {
  font-size: 40px;
  margin-bottom: 12px;
}

.executions-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}

.execution-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 14px 16px;
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
  gap: 8px;
}
.exec-id .label {
  font-size: 11px;
  color: #64748b;
  text-transform: uppercase;
}
.exec-id code {
  font-size: 13px;
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 8px;
  border-radius: 4px;
}

.exec-stats {
  display: flex;
  gap: 24px;
  margin-bottom: 12px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat-value {
  font-size: 18px;
  font-weight: 600;
  color: #e2e8f0;
}
.stat-value.pass {
  color: #22c55e;
}
.stat-value.fail {
  color: #ef4444;
}
.stat-label {
  font-size: 11px;
  color: #64748b;
}

.exec-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.exec-time {
  font-size: 12px;
  color: #64748b;
}

.exec-hashes {
  display: flex;
  gap: 6px;
}
.hash {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  color: #94a3b8;
}
.hash.rollback {
  background: rgba(168, 85, 247, 0.1);
  color: #a855f7;
}

.exec-error {
  margin-top: 10px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 6px;
  color: #ef4444;
  font-size: 13px;
}
</style>
