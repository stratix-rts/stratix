<template>
  <div class="proposals-panel">
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
    <div v-if="isLoading" class="panel-state loading">
      <span class="spinner"></span>
      <span>加载中...</span>
    </div>

    <!-- Error -->
    <div v-else-if="panelError" class="panel-state error">
      <span class="error-icon">⚠️</span>
      <span class="error-msg">{{ panelError }}</span>
      <button class="btn btn-retry" @click="retry">重试</button>
    </div>

    <!-- Empty -->
    <div v-else-if="isEmpty" class="panel-state empty">
      <span class="empty-icon">📋</span>
      <p>暂无提案</p>
    </div>

    <!-- Content -->
    <div v-else class="proposals-list">
      <div
        v-for="proposal in filteredProposals"
        :key="proposal.id"
        class="proposal-card"
        :class="{ expanded: expandedId === proposal.id }"
      >
        <div class="card-main" @click="toggleExpand(proposal.id)">
          <div class="card-header">
            <h3 class="card-title">{{ proposal.title }}</h3>
            <div class="card-tags">
              <RiskTag :level="proposal.riskLevel" />
              <span class="type-tag">{{ proposal.type }}</span>
            </div>
          </div>
          <p class="card-desc">{{ truncate(proposal.description, 120) }}</p>
          <div class="card-footer">
            <span class="file-count">{{ proposal.targetFiles.length }} 个目标文件</span>
            <span class="card-time">{{ formatTime(proposal.createdAt) }}</span>
          </div>
          <div class="card-actions" @click.stop>
            <template v-if="proposal.status === 'pending'">
              <button class="btn btn-approve" @click="handleApprove(proposal.id)" :disabled="store.loading">
                批准
              </button>
              <button class="btn btn-reject" @click="handleReject(proposal.id)" :disabled="store.loading">
                拒绝
              </button>
            </template>
            <template v-else-if="proposal.status === 'approved'">
              <button class="btn btn-execute" @click="handleExecute(proposal.id)" :disabled="store.loading">
                执行
              </button>
            </template>
            <template v-else-if="proposal.status === 'executing'">
              <span class="executing-indicator">
                <span class="spinner small"></span>
                执行中...
              </span>
            </template>
          </div>
        </div>

        <div v-if="expandedId === proposal.id" class="card-detail">
          <div class="detail-section">
            <h4>完整描述</h4>
            <p>{{ proposal.description }}</p>
          </div>
          <div class="detail-section">
            <h4>目标文件</h4>
            <ul class="file-list">
              <li v-for="f in proposal.targetFiles" :key="f">{{ f }}</li>
            </ul>
          </div>
          <div v-if="proposal.guardianValidation" class="detail-section">
            <h4>Guardian 验证</h4>
            <div class="guardian-result" :class="proposal.guardianValidation.valid ? 'valid' : 'invalid'">
              <span class="guardian-status">
                {{ proposal.guardianValidation.valid ? '通过' : '拒绝' }}
              </span>
              <ul v-if="proposal.guardianValidation.reasons.length">
                <li v-for="r in proposal.guardianValidation.reasons" :key="r">{{ r }}</li>
              </ul>
            </div>
          </div>
          <div v-if="proposal.executionResult" class="detail-section">
            <h4>执行结果</h4>
            <p>状态: {{ proposal.executionResult.status }}</p>
            <p v-if="proposal.executionResult.commitHash">Commit: {{ proposal.executionResult.commitHash }}</p>
            <p v-if="proposal.executionResult.error" class="error-text">{{ proposal.executionResult.error }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, type Ref } from 'vue';
import { useSystemZoneStore } from '../../stores/systemzone';
import { usePanelState } from './composables/usePanelState';
import { useAutoRefresh } from './composables/useAutoRefresh';
import RiskTag from './components/RiskTag.vue';

const store = useSystemZoneStore();
const activeTab = ref('all');
const expandedId = ref<string | null>(null);

const tabs = [
  { label: '全部', value: 'all' },
  { label: '待审批', value: 'pending' },
  { label: '已批准', value: 'approved' },
  { label: '已拒绝', value: 'rejected' },
  { label: '已完成', value: 'completed' },
];

const filteredProposals = computed(() => {
  if (activeTab.value === 'all') return store.proposals;
  return store.proposals.filter(p => p.status === activeTab.value);
});
const proposalsRef = computed(() => store.proposals) as Ref<any[]>;

const { isLoading, panelError, isEmpty, retry } = usePanelState('proposals', proposalsRef);
useAutoRefresh(() => store.fetchProposals(), { interval: 60000 });

function getTabCount(status: string): number {
  if (status === 'all') return store.proposals.length;
  return store.proposals.filter(p => p.status === status).length;
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
}

async function handleApprove(id: string) {
  await store.approveProposal(id, 'approve');
}

async function handleReject(id: string) {
  await store.approveProposal(id, 'reject');
}

async function handleExecute(id: string) {
  await store.executeProposal(id);
}

function truncate(text: string, len: number): string {
  if (!text || text.length <= len) return text;
  return text.slice(0, len) + '...';
}

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
</script>

<style scoped>
.proposals-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.panel-header {
  border-bottom: 1px solid var(--ds-border-subtle, rgba(255, 255, 255, 0.1));
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
  border-radius: var(--ds-radius-sm, 4px) var(--ds-radius-sm, 4px) 0 0;
  color: var(--ds-text-secondary, #94a3b8);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.tab:hover {
  color: var(--ds-text-primary, #e2e8f0);
}
.tab.active {
  color: var(--ds-status-info, #3b82f6);
  background: color-mix(in srgb, var(--ds-status-info, #3b82f6) 10%, transparent);
}
.count {
  font-size: 11px;
  background: var(--ds-bg-overlay, rgba(255, 255, 255, 0.1));
  padding: 1px 6px;
  border-radius: 10px;
}

/* Shared panel states */
.panel-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  color: var(--ds-text-muted, #64748b);
  gap: 10px;
}
.panel-state.loading {
  flex-direction: row;
  padding: 40px;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--ds-border-subtle, rgba(255, 255, 255, 0.1));
  border-top-color: var(--ds-status-info, #3b82f6);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.spinner.small { width: 14px; height: 14px; }
@keyframes spin { to { transform: rotate(360deg); } }

.error-icon { font-size: 28px; }
.error-msg { color: var(--ds-status-danger, #ef4444); font-size: 13px; }
.empty-icon { font-size: 40px; margin-bottom: 4px; }

.btn {
  padding: 6px 14px;
  border-radius: var(--ds-radius-sm, 5px);
  font-size: 13px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-retry {
  background: var(--ds-bg-overlay, rgba(255, 255, 255, 0.08));
  color: var(--ds-text-secondary, #94a3b8);
  padding: 4px 12px;
  font-size: 12px;
}
.btn-approve {
  background: color-mix(in srgb, var(--ds-status-success, #22c55e) 15%, transparent);
  color: var(--ds-status-success, #22c55e);
}
.btn-approve:hover:not(:disabled) { opacity: 0.85; }
.btn-reject {
  background: color-mix(in srgb, var(--ds-status-danger, #ef4444) 15%, transparent);
  color: var(--ds-status-danger, #ef4444);
}
.btn-reject:hover:not(:disabled) { opacity: 0.85; }
.btn-execute {
  background: var(--ds-status-info, #3b82f6);
  color: var(--ds-bg-base, #fff);
}
.btn-execute:hover:not(:disabled) { opacity: 0.9; }

.executing-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ds-status-info, #3b82f6);
  font-size: 13px;
}

.proposals-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}

.proposal-card {
  background: var(--ds-bg-sunken, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--ds-border-subtle, rgba(255, 255, 255, 0.06));
  border-radius: var(--ds-radius-md, 8px);
  overflow: hidden;
  transition: border-color 0.2s;
}
.proposal-card.expanded {
  border-color: color-mix(in srgb, var(--ds-status-info, #3b82f6) 30%, transparent);
}

.card-main { padding: 14px 16px; cursor: pointer; }

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
  gap: 12px;
}

.card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ds-text-primary, #e2e8f0);
  flex: 1;
}

.card-tags { display: flex; gap: 6px; flex-shrink: 0; }

.type-tag {
  font-size: 11px;
  color: var(--ds-text-secondary, #94a3b8);
  background: var(--ds-bg-overlay, rgba(255, 255, 255, 0.06));
  padding: 2px 8px;
  border-radius: var(--ds-radius-sm, 4px);
}

.card-desc {
  color: var(--ds-text-secondary, #94a3b8);
  font-size: 13px;
  line-height: 1.5;
  margin: 0 0 10px;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--ds-text-muted, #64748b);
  margin-bottom: 10px;
}

.card-actions { display: flex; gap: 8px; }

.card-detail {
  border-top: 1px solid var(--ds-border-subtle, rgba(255, 255, 255, 0.06));
  padding: 16px;
  background: var(--ds-bg-sunken, rgba(0, 0, 0, 0.2));
}

.detail-section { margin-bottom: 16px; }
.detail-section:last-child { margin-bottom: 0; }

.detail-section h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ds-text-secondary, #94a3b8);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-section p {
  margin: 0;
  color: var(--ds-text-primary, #e2e8f0);
  font-size: 13px;
  line-height: 1.6;
}

.file-list {
  margin: 0;
  padding-left: 20px;
  color: var(--ds-text-primary, #e2e8f0);
  font-size: 13px;
}

.guardian-result {
  padding: 10px 12px;
  border-radius: var(--ds-radius-sm, 6px);
  font-size: 13px;
}
.guardian-result.valid {
  background: color-mix(in srgb, var(--ds-status-success, #22c55e) 10%, transparent);
  color: var(--ds-status-success, #22c55e);
}
.guardian-result.invalid {
  background: color-mix(in srgb, var(--ds-status-danger, #ef4444) 10%, transparent);
  color: var(--ds-status-danger, #ef4444);
}
.guardian-status { font-weight: 600; display: block; margin-bottom: 4px; }
.guardian-result ul { margin: 4px 0 0; padding-left: 16px; }

.error-text { color: var(--ds-status-danger, #ef4444) !important; }
</style>
