<template>
  <div class="insights-panel">
    <div class="panel-header">
      <div class="input-row">
        <input
          v-model="inputText"
          type="text"
          class="input"
          placeholder="输入洞察内容..."
          @keyup.enter="handleAdd"
        />
        <button class="btn btn-primary" @click="handleAdd" :disabled="store.loading">
          添加
        </button>
        <button class="btn btn-secondary" @click="handleTrigger" :disabled="store.loading">
          触发观察
        </button>
      </div>
      <div class="category-filters">
        <button
          v-for="cat in categories"
          :key="cat"
          class="category-btn"
          :class="{ active: filteredCategory === cat }"
          @click="filteredCategory = cat"
        >
          {{ cat }}
        </button>
      </div>
      <div class="tabs">
        <button
          class="tab"
          :class="{ active: filter === 'unarchived' }"
          @click="filter = 'unarchived'"
        >
          未归档 ({{ unarchivedCount }})
        </button>
        <button
          class="tab"
          :class="{ active: filter === 'archived' }"
          @click="filter = 'archived'"
        >
          已归档 ({{ archivedCount }})
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
      <span class="empty-icon">📭</span>
      <p>暂无洞察数据</p>
    </div>

    <!-- Content -->
    <div v-else class="insights-list">
      <div
        v-for="insight in filteredInsights"
        :key="insight.id"
        class="insight-card"
      >
        <div class="insight-main" :class="`severity-${insight.severity || 'none'}`" @click="toggleExpand(insight.id)">
          <div class="insight-header">
            <div class="insight-header-left">
              <span class="expand-icon" :class="{ rotated: expandedIds.has(insight.id) }">▶</span>
              <span class="insight-type">{{ insight.type }}</span>
              <span v-if="insight.severity" class="severity-badge" :class="`badge-${insight.severity}`">
                {{ insight.severity }}
              </span>
            </div>
            <div class="insight-header-right">
              <span class="insight-time">{{ formatTime(insight.createdAt) }}</span>
            </div>
          </div>
          <p class="insight-content">{{ insight.content }}</p>
          <div class="insight-footer">
            <ConfidenceBar :confidence="insight.confidence" />
            <button
              class="btn-link"
              @click.stop="toggleArchive(insight)"
            >
              {{ insight.archived ? '取消归档' : '归档' }}
            </button>
          </div>
        </div>
        <div class="insight-details" :class="{ expanded: expandedIds.has(insight.id) }">
          <div class="details-inner">
            <div v-if="insight.details" class="detail-section">
              <h4 class="detail-title">详细分析</h4>
              <p class="detail-text">{{ insight.details }}</p>
            </div>
            <div v-if="insight.suggestion" class="detail-section">
              <h4 class="detail-title">建议</h4>
              <p class="detail-text">{{ insight.suggestion }}</p>
            </div>
            <div v-if="insight.affectedFiles && insight.affectedFiles.length" class="detail-section">
              <h4 class="detail-title">受影响文件</h4>
              <ul class="affected-files">
                <li v-for="file in insight.affectedFiles" :key="file" class="affected-file">{{ file }}</li>
              </ul>
            </div>
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
import ConfidenceBar from './components/ConfidenceBar.vue';

const store = useSystemZoneStore();
const inputText = ref('');
const filter = ref<'archived' | 'unarchived'>('unarchived');
const filteredCategory = ref('All');
const expandedIds = ref(new Set<string>());

const categories = ['All', 'Architecture', 'Security', 'Performance', 'Quality', 'Dependency'] as const;

const filteredInsights = computed(() => {
  return store.insights.filter(i => {
    const archiveMatch = filter.value === 'archived' ? i.archived : !i.archived;
    const catMatch = filteredCategory.value === 'All' || i.type === filteredCategory.value;
    return archiveMatch && catMatch;
  });
});
const insightsRef = computed(() => store.insights) as Ref<any[]>;

const { isLoading, panelError, isEmpty, retry } = usePanelState('insights', insightsRef);
useAutoRefresh(() => store.fetchInsights(), { interval: 60000 });

const unarchivedCount = computed(() => store.insights.filter(i => !i.archived).length);
const archivedCount = computed(() => store.insights.filter(i => i.archived).length);

async function handleAdd() {
  const text = inputText.value.trim();
  if (!text) return;
  const ok = await store.addInput(text);
  if (ok) {
    inputText.value = '';
    await store.fetchInsights();
  }
}

async function handleTrigger() {
  await store.triggerObserve();
}

async function toggleArchive(insight: any) {
  insight.archived = !insight.archived;
  // TODO: call archive API when available
}

function toggleExpand(id: string) {
  if (expandedIds.value.has(id)) {
    expandedIds.value.delete(id);
  } else {
    expandedIds.value.add(id);
  }
}

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
</script>

<style scoped>
.insights-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.panel-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.input-row {
  display: flex;
  gap: 8px;
}

.input {
  flex: 1;
  background: var(--ds-bg-sunken, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--ds-border-subtle, rgba(255, 255, 255, 0.1));
  border-radius: var(--ds-radius-sm, 6px);
  padding: 8px 12px;
  color: var(--ds-text-primary, #e2e8f0);
  font-size: 14px;
}
.input:focus {
  outline: none;
  border-color: var(--ds-status-info, #3b82f6);
}
.input::placeholder {
  color: var(--ds-text-muted, #64748b);
}

.btn {
  padding: 8px 16px;
  border-radius: var(--ds-radius-sm, 6px);
  font-size: 14px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: opacity 0.2s;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-primary {
  background: var(--ds-status-info, #3b82f6);
  color: var(--ds-bg-base, #fff);
}
.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}
.btn-secondary {
  background: var(--ds-bg-overlay, rgba(255, 255, 255, 0.08));
  color: var(--ds-text-primary, #e2e8f0);
}
.btn-secondary:hover:not(:disabled) {
  opacity: 0.9;
}
.btn-retry {
  background: var(--ds-bg-overlay, rgba(255, 255, 255, 0.08));
  color: var(--ds-text-secondary, #94a3b8);
  padding: 4px 12px;
  font-size: 12px;
}
.btn-retry:hover {
  color: var(--ds-text-primary, #e2e8f0);
}

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--ds-border-subtle, rgba(255, 255, 255, 0.1));
  padding-bottom: 8px;
}

.tab {
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

.category-filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.category-btn {
  padding: 5px 12px;
  background: transparent;
  border: 1px solid var(--ds-border-subtle, rgba(255, 255, 255, 0.1));
  border-radius: var(--ds-radius-sm, 4px);
  color: var(--ds-text-secondary, #94a3b8);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.category-btn:hover {
  color: var(--ds-text-primary, #e2e8f0);
  border-color: var(--ds-border-default, rgba(255, 255, 255, 0.15));
}
.category-btn.active {
  color: var(--ds-status-info, #3b82f6);
  border-color: var(--ds-status-info, #3b82f6);
  background: color-mix(in srgb, var(--ds-status-info, #3b82f6) 10%, transparent);
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
@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-icon { font-size: 28px; }
.error-msg {
  color: var(--ds-status-danger, #ef4444);
  font-size: 13px;
}

.empty-icon {
  font-size: 40px;
  margin-bottom: 4px;
}

.insights-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}

.insight-card {
  background: var(--ds-bg-sunken, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--ds-border-subtle, rgba(255, 255, 255, 0.06));
  border-radius: var(--ds-radius-md, 8px);
  padding: 14px 16px;
}

.insight-main {
  border-left: 3px solid #64748b;
  padding-left: 12px;
  border-radius: 4px;
  cursor: pointer;
}
.insight-main.severity-critical {
  border-left-color: #ef4444;
}
.insight-main.severity-warning {
  border-left-color: #f59e0b;
}
.insight-main.severity-info {
  border-left-color: #3b82f6;
}

.severity-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.badge-critical {
  background: color-mix(in srgb, #ef4444 15%, transparent);
  color: #ef4444;
}
.badge-warning {
  background: color-mix(in srgb, #f59e0b 15%, transparent);
  color: #f59e0b;
}
.badge-info {
  background: color-mix(in srgb, #3b82f6 15%, transparent);
  color: #3b82f6;
}

.insight-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.insight-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.insight-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.expand-icon {
  font-size: 10px;
  color: var(--ds-text-muted, #64748b);
  transition: transform 0.25s ease;
  display: inline-block;
}
.expand-icon.rotated {
  transform: rotate(90deg);
}

.insight-type {
  font-size: 11px;
  font-weight: 600;
  color: var(--ds-status-info, #3b82f6);
  background: color-mix(in srgb, var(--ds-status-info, #3b82f6) 10%, transparent);
  padding: 2px 8px;
  border-radius: var(--ds-radius-sm, 4px);
  text-transform: uppercase;
}

.insight-time {
  font-size: 12px;
  color: var(--ds-text-muted, #64748b);
}

.insight-content {
  color: var(--ds-text-primary, #e2e8f0);
  font-size: 14px;
  line-height: 1.5;
  margin: 0 0 10px;
}

.insight-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.btn-link {
  background: none;
  border: none;
  color: var(--ds-text-secondary, #94a3b8);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--ds-radius-sm, 4px);
}
.btn-link:hover {
  color: var(--ds-text-primary, #e2e8f0);
  background: var(--ds-bg-overlay, rgba(255, 255, 255, 0.05));
}

.insight-details {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease;
}
.insight-details.expanded {
  max-height: 500px;
}

.details-inner {
  padding-top: 12px;
  margin-top: 12px;
  border-top: 1px solid var(--ds-border-subtle, rgba(255, 255, 255, 0.06));
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--ds-text-secondary, #94a3b8);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
}

.detail-text {
  font-size: 13px;
  color: var(--ds-text-primary, #e2e8f0);
  line-height: 1.5;
  margin: 0;
}

.affected-files {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.affected-file {
  font-size: 12px;
  color: var(--ds-text-secondary, #94a3b8);
  font-family: 'SF Mono', Monaco, 'Courier New', monospace;
  padding: 2px 0;
}
</style>
