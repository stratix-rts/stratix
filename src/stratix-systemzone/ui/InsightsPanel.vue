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
        <StratixButton variant="primary" size="sm" @click="handleAdd" :disabled="store.loading">
          添加
        </StratixButton>
        <StratixButton variant="secondary" size="sm" @click="handleTrigger" :disabled="store.loading">
          触发观察
        </StratixButton>
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
      <StratixButton variant="secondary" size="sm" @click="retry">重试</StratixButton>
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
import StratixButton from '@/components/ui/StratixButton.vue';
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
  background: var(--ds-bg-sunken);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-sm, 6px);
  padding: 8px 12px;
  color: var(--ds-text-primary);
  font-size: 14px;
}
.input:focus {
  outline: none;
  border-color: var(--ds-status-info);
}
.input::placeholder {
  color: var(--ds-text-muted);
}

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--ds-border-subtle);
  padding-bottom: 8px;
}

.tab {
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

.category-filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.category-btn {
  padding: 5px 12px;
  background: transparent;
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-sm, 4px);
  color: var(--ds-text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.category-btn:hover {
  color: var(--ds-text-primary);
  border-color: var(--ds-border-default);
}
.category-btn.active {
  color: var(--ds-status-info);
  border-color: var(--ds-status-info);
  background: color-mix(in srgb, var(--ds-status-info) 10%, transparent);
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
@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-icon { font-size: 28px; }
.error-msg {
  color: var(--ds-status-danger);
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
  background: var(--ds-bg-sunken);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-md, 8px);
  padding: 14px 16px;
}

.insight-main {
  border-left: 3px solid var(--ds-text-muted);
  padding-left: 12px;
  border-radius: 4px;
  cursor: pointer;
}
.insight-main.severity-critical {
  border-left-color: var(--ds-status-danger);
}
.insight-main.severity-warning {
  border-left-color: var(--ds-status-warning);
}
.insight-main.severity-info {
  border-left-color: var(--ds-status-info);
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
  background: color-mix(in srgb, var(--ds-status-danger) 15%, transparent);
  color: var(--ds-status-danger);
}
.badge-warning {
  background: color-mix(in srgb, var(--ds-status-warning) 15%, transparent);
  color: var(--ds-status-warning);
}
.badge-info {
  background: color-mix(in srgb, var(--ds-status-info) 15%, transparent);
  color: var(--ds-status-info);
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
  color: var(--ds-text-muted);
  transition: transform 0.25s ease;
  display: inline-block;
}
.expand-icon.rotated {
  transform: rotate(90deg);
}

.insight-type {
  font-size: 11px;
  font-weight: 600;
  color: var(--ds-status-info);
  background: color-mix(in srgb, var(--ds-status-info) 10%, transparent);
  padding: 2px 8px;
  border-radius: var(--ds-radius-sm, 4px);
  text-transform: uppercase;
}

.insight-time {
  font-size: 12px;
  color: var(--ds-text-muted);
}

.insight-content {
  color: var(--ds-text-primary);
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
  color: var(--ds-text-secondary);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--ds-radius-sm, 4px);
}
.btn-link:hover {
  color: var(--ds-text-primary);
  background: color-mix(in srgb, var(--ds-text-secondary) 5%, transparent);
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
  border-top: 1px solid var(--ds-border-subtle);
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
  color: var(--ds-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
}

.detail-text {
  font-size: 13px;
  color: var(--ds-text-primary);
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
  color: var(--ds-text-secondary);
  font-family: var(--ds-typography-fontFamily-mono, 'SF Mono', Monaco, 'Courier New', monospace);
  padding: 2px 0;
}
</style>
