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
      <StratixButton variant="secondary" size="sm" @click="retry">重试</StratixButton>
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
        :class="{ expanded: expandedId === proposal.id, flash: flashId === proposal.id }"
      >
        <div class="card-main" @click="toggleExpand(proposal.id)">
          <div class="card-header">
            <h3 class="card-title">{{ proposal.title }}</h3>
            <div class="card-tags">
              <StatusTag :status="proposal.status" />
              <span class="type-tag">{{ proposal.type }}</span>
              <span
                class="risk-badge"
                :class="'risk-' + (proposal.riskLevelStr || 'none')"
              >{{ proposal.riskLevelStr || 'unknown' }}</span>
              <span class="effort-dots" :title="'effort: ' + (proposal.effortEstimate || 'small')">
                <span
                  v-for="n in getEffortDots(proposal.effortEstimate)"
                  :key="n"
                  class="dot"
                ></span>
              </span>
            </div>
          </div>
          <p class="card-desc">{{ truncate(proposal.description, 120) }}</p>
          <div class="card-footer">
            <span class="target-info">{{ targetLabel(proposal.target) }}</span>
            <span class="card-time">{{ formatTime(proposal.timestamp) }}</span>
          </div>
          <div class="card-actions" @click.stop>
            <template v-if="proposal.status === 'pending'">
              <StratixButton variant="success" size="sm" @click="handleApprove(proposal.id)" :disabled="store.loading">
                批准
              </StratixButton>
              <StratixButton variant="danger" size="sm" @click="handleReject(proposal.id)" :disabled="store.loading">
                拒绝
              </StratixButton>
            </template>
            <template v-else-if="proposal.status === 'approved'">
              <StratixButton variant="primary" size="sm" @click="handleExecute(proposal.id)" :disabled="store.loading">
                执行
              </StratixButton>
            </template>
            <template v-else-if="proposal.status === 'executing'">
              <span class="executing-indicator">
                <span class="spinner small"></span>
                执行中...
              </span>
            </template>
          </div>
        </div>

        <div class="card-detail" :class="{ 'is-open': expandedId === proposal.id }">
          <div class="detail-section">
            <h4>完整描述</h4>
            <p>{{ proposal.description }}</p>
          </div>
          <div v-if="proposal.codeSuggestion" class="detail-section">
            <h4>代码建议</h4>
            <pre><code>{{ proposal.codeSuggestion }}</code></pre>
          </div>
          <div v-if="proposal.reasoning" class="detail-section">
            <h4>推理过程</h4>
            <p>{{ proposal.reasoning }}</p>
          </div>
          <div class="detail-section">
            <h4>目标</h4>
            <p>{{ JSON.stringify(proposal.target, null, 2) }}</p>
          </div>
          <div class="detail-section">
            <h4>选择策略</h4>
            <p>{{ JSON.stringify(proposal.selection, null, 2) }}</p>
          </div>
          <div v-if="proposal.approvedBy" class="detail-section">
            <h4>审批人</h4>
            <p>{{ proposal.approvedBy }}</p>
          </div>
          <div v-if="proposal.executedAt" class="detail-section">
            <h4>执行时间</h4>
            <p>{{ formatTime(proposal.executedAt) }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, type Ref } from 'vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import { useSystemZoneStore } from '../../stores/systemzone';
import { usePanelState } from './composables/usePanelState';
import { useAutoRefresh } from './composables/useAutoRefresh';
import StatusTag from './components/StatusTag.vue';

const store = useSystemZoneStore();
const activeTab = ref('all');
const expandedId = ref<string | null>(null);
const flashId = ref<string | null>(null);

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

function targetLabel(target: any): string {
  if (!target) return '无目标';
  if (target.path) return target.path;
  if (target.files && Array.isArray(target.files)) return `${target.files.length} 个文件`;
  return '自定义目标';
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
}

async function handleApprove(id: string) {
  if (!confirm('确定要批准这个提案吗？')) return;
  await store.approveProposal(id, 'approve');
  flashId.value = id;
  setTimeout(() => { flashId.value = null; }, 1500);
}

async function handleReject(id: string) {
  if (!confirm('确定要拒绝这个提案吗？')) return;
  await store.approveProposal(id, 'reject');
  flashId.value = id;
  setTimeout(() => { flashId.value = null; }, 1500);
}

async function handleExecute(id: string) {
  await store.executeProposal(id);
}

function truncate(text: string, len: number): string {
  if (!text || text.length <= len) return text;
  return text.slice(0, len) + '...';
}

function getEffortDots(estimate?: string): number {
  switch (estimate) {
    case 'large': return 3;
    case 'medium': return 2;
    case 'small':
    default: return 1;
  }
}

function formatTime(ts: string | Date): string {
  if (!ts) return '';
  const d = new Date(ts);
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
  border-bottom: 1px solid var(--ds-border-subtle);
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
  color: var(--ds-text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.tab:hover {
  color: var(--ds-text-primary);
}
.tab.active {
  color: var(--ds-status-info);
  background: color-mix(in srgb, var(--ds-status-info) 10%, transparent);
}
.count {
  font-size: 11px;
  background: color-mix(in srgb, var(--ds-text-secondary) 10%, transparent);
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
  color: var(--ds-text-muted);
  gap: 10px;
}
.panel-state.loading {
  flex-direction: row;
  padding: 40px;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--ds-border-subtle);
  border-top-color: var(--ds-status-info);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.spinner.small { width: 14px; height: 14px; }
@keyframes spin { to { transform: rotate(360deg); } }

.error-icon { font-size: 28px; }
.error-msg { color: var(--ds-status-danger); font-size: 13px; }
.empty-icon { font-size: 40px; margin-bottom: 4px; }

.executing-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ds-status-info);
  font-size: 13px;
}

.proposals-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}

.proposal-card {
  background: var(--ds-bg-sunken);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-md, 8px);
  overflow: hidden;
  transition: border-color 0.2s;
}
.proposal-card.expanded {
  border-color: color-mix(in srgb, var(--ds-status-info) 30%, transparent);
}
@keyframes flash-border {
  0%, 100% { border-color: var(--ds-border-subtle); }
  50% { border-color: var(--ds-status-success); box-shadow: 0 0 12px color-mix(in srgb, var(--ds-status-success) 30%, transparent); }
}
.proposal-card.flash { animation: flash-border 0.5s ease 2; }

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
  color: var(--ds-text-primary);
  flex: 1;
}

.card-tags { display: flex; gap: 6px; flex-shrink: 0; align-items: center; }

.type-tag {
  font-size: 11px;
  color: var(--ds-text-secondary);
  background: color-mix(in srgb, var(--ds-text-secondary) 6%, transparent);
  padding: 2px 8px;
  border-radius: var(--ds-radius-sm, 4px);
}

.risk-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--ds-radius-sm, 4px);
  font-weight: 500;
}
.risk-high { background: color-mix(in srgb, var(--ds-status-danger) 15%, transparent); color: var(--ds-status-danger); }
.risk-medium { background: color-mix(in srgb, var(--ds-status-warning) 15%, transparent); color: var(--ds-status-warning); }
.risk-low { background: color-mix(in srgb, var(--ds-status-success) 15%, transparent); color: var(--ds-status-success); }
.risk-none { background: color-mix(in srgb, var(--ds-text-muted) 15%, transparent); color: var(--ds-text-muted); }

.effort-dots { display: flex; gap: 3px; align-items: center; }
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ds-text-muted);
}

.card-desc {
  color: var(--ds-text-secondary);
  font-size: 13px;
  line-height: 1.5;
  margin: 0 0 10px;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--ds-text-muted);
  margin-bottom: 10px;
}

.target-info { font-family: var(--ds-typography-fontFamily-mono, monospace); }

.card-actions { display: flex; gap: 8px; }

.card-detail {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease;
  border-top: 1px solid transparent;
}
.card-detail.is-open {
  max-height: 800px;
  overflow: hidden;
  border-top-color: var(--ds-border-subtle);
  padding: 16px;
  background: color-mix(in srgb, var(--ds-bg-base) 20%, transparent);
}

.card-detail pre {
  margin: 0;
  padding: 12px;
  background: color-mix(in srgb, var(--ds-bg-base) 30%, transparent);
  border-radius: var(--ds-radius-sm, 4px);
  overflow-x: auto;
}
.card-detail code {
  font-family: var(--ds-typography-fontFamily-mono, 'SF Mono', Consolas, monospace);
  font-size: 12px;
  color: var(--ds-text-primary);
  white-space: pre;
}

.detail-section { margin-bottom: 16px; }
.detail-section:last-child { margin-bottom: 0; }

.detail-section h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ds-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-section p {
  margin: 0;
  color: var(--ds-text-primary);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}
</style>
