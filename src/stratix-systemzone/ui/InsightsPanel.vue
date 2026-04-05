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
        <div class="insight-main">
          <div class="insight-header">
            <span class="insight-type">{{ insight.type }}</span>
            <span class="insight-time">{{ formatTime(insight.createdAt) }}</span>
          </div>
          <p class="insight-content">{{ insight.content }}</p>
          <div class="insight-footer">
            <ConfidenceBar :confidence="insight.confidence" />
            <button
              class="btn-link"
              @click="toggleArchive(insight)"
            >
              {{ insight.archived ? '取消归档' : '归档' }}
            </button>
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

const filteredInsights = computed(() => {
  return store.insights.filter(i => filter.value === 'archived' ? i.archived : !i.archived);
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

.insight-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
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
</style>
