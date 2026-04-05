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

    <div v-if="store.loading" class="loading">
      <span class="spinner"></span>
      加载中...
    </div>

    <div v-else-if="filteredProposals.length === 0" class="empty-state">
      <span class="empty-icon">📋</span>
      <p>暂无提案</p>
    </div>

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
import { ref, computed } from 'vue';
import { useSystemZoneStore } from '../../stores/systemzone';
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
.spinner.small {
  width: 14px;
  height: 14px;
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

.proposals-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}

.proposal-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.2s;
}
.proposal-card.expanded {
  border-color: rgba(59, 130, 246, 0.3);
}

.card-main {
  padding: 14px 16px;
  cursor: pointer;
}

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
  color: #e2e8f0;
  flex: 1;
}

.card-tags {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.type-tag {
  font-size: 11px;
  color: #94a3b8;
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 8px;
  border-radius: 4px;
}

.card-desc {
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.5;
  margin: 0 0 10px;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #64748b;
  margin-bottom: 10px;
}

.card-actions {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 6px 14px;
  border-radius: 5px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-approve {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}
.btn-approve:hover:not(:disabled) {
  background: rgba(34, 197, 94, 0.25);
}
.btn-reject {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}
.btn-reject:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.25);
}
.btn-execute {
  background: #3b82f6;
  color: #fff;
}
.btn-execute:hover:not(:disabled) {
  background: #2563eb;
}

.executing-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #3b82f6;
  font-size: 13px;
}

.card-detail {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding: 16px;
  background: rgba(0, 0, 0, 0.2);
}

.detail-section {
  margin-bottom: 16px;
}
.detail-section:last-child {
  margin-bottom: 0;
}

.detail-section h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-section p {
  margin: 0;
  color: #e2e8f0;
  font-size: 13px;
  line-height: 1.6;
}

.file-list {
  margin: 0;
  padding-left: 20px;
  color: #e2e8f0;
  font-size: 13px;
}

.guardian-result {
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 13px;
}
.guardian-result.valid {
  background: rgba(34, 197, 94, 0.1);
  color: #22c55e;
}
.guardian-result.invalid {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}
.guardian-status {
  font-weight: 600;
  display: block;
  margin-bottom: 4px;
}
.guardian-result ul {
  margin: 4px 0 0;
  padding-left: 16px;
}

.error-text {
  color: #ef4444 !important;
}
</style>
