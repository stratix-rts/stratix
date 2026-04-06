<template>
  <StratixPanel>
    <div class="panel-header">
      <h3 class="panel-title">外部源</h3>
      <StratixButton variant="secondary" size="sm" @click="showForm = !showForm">
        {{ showForm ? '收起' : '添加源' }}
      </StratixButton>
    </div>

    <!-- Add Source Form -->
    <div v-if="showForm" class="add-form">
      <div class="form-row">
        <label>名称</label>
        <input v-model="form.name" type="text" placeholder="数据源名称" />
      </div>
      <div class="form-row">
        <label>类型</label>
        <select v-model="form.type">
          <option value="rss">RSS</option>
          <option value="webhook">Webhook</option>
          <option value="api_polling">API Polling</option>
        </select>
      </div>
      <div class="form-row">
        <label>URL</label>
        <input v-model="form.url" type="text" placeholder="https://..." />
      </div>
      <div class="form-row">
        <label>配置 JSON</label>
        <textarea v-model="form.configJson" placeholder='{"key": "value"}' rows="3"></textarea>
      </div>
      <div class="form-actions">
        <StratixButton variant="primary" size="sm" @click="handleAdd" :disabled="store.loading">添加</StratixButton>
        <StratixButton variant="secondary" size="sm" @click="showForm = false">取消</StratixButton>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading && store.sources.length === 0" class="panel-state loading">
      <span class="spinner"></span>
      <span>加载中...</span>
    </div>

    <!-- Error -->
    <div v-else-if="panelError" class="panel-state error">
      <span class="error-icon">⚠️</span>
      <span class="error-msg">{{ panelError }}</span>
      <StratixButton variant="secondary" size="sm" @click="retry">重试</StratixButton>
    </div>

    <!-- Empty State -->
    <div v-else-if="isEmpty" class="panel-state empty">
      <span class="empty-icon">◎</span>
      <span class="empty-text">暂无外部源</span>
    </div>

    <!-- Sources List -->
    <div v-else class="sources-list">
      <div v-for="source in store.sources" :key="source.id" class="source-item">
        <div class="source-main">
          <div class="source-header">
            <span class="source-name">{{ source.name }}</span>
            <span class="source-type">{{ source.type }}</span>
            <span class="status-dot" :class="statusClass(source.status)"></span>
          </div>
          <div class="source-url">{{ source.url }}</div>
          <div class="source-meta">
            <span v-if="source.lastFetchedAt">最后抓取: {{ formatTime(source.lastFetchedAt) }}</span>
            <span v-if="source.fetchCount">抓取次数: {{ source.fetchCount }}</span>
            <span v-if="source.errorCount">错误: {{ source.errorCount }}</span>
          </div>
        </div>
        <div class="source-actions">
          <StratixButton variant="danger" size="sm" @click="deleteSource(source.id)" title="删除">✕</StratixButton>
        </div>
      </div>
    </div>
  </StratixPanel>
</template>

<script setup lang="ts">
import { ref, reactive, computed, type Ref, onMounted } from 'vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import StratixPanel from '@/components/ui/StratixPanel.vue';
import { useSystemZoneStore } from '../../stores/systemzone';
import { usePanelState } from './composables/usePanelState';
import { useAutoRefresh } from './composables/useAutoRefresh';

const store = useSystemZoneStore();

const showForm = ref(false);
const form = reactive({
  name: '',
  type: 'rss' as 'rss' | 'webhook' | 'api_polling',
  url: '',
  configJson: '{}',
});

const sourcesRef = computed(() => store.sources) as Ref<any[]>;
const { isLoading, panelError, isEmpty, retry } = usePanelState('sources', sourcesRef);
useAutoRefresh(() => store.fetchSources(), { interval: 60000 });

function statusClass(status: string): string {
  switch (status) {
    case 'active': return 'dot-active';
    case 'error': return 'dot-error';
    case 'disabled': return 'dot-disabled';
    default: return 'dot-idle';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function handleAdd() {
  if (!form.name || !form.url) return;
  let config: Record<string, any> = {};
  try {
    config = JSON.parse(form.configJson || '{}');
  } catch {
    config = {};
  }
  await store.addSource({
    name: form.name,
    type: form.type,
    url: form.url,
    config,
  });
  form.name = '';
  form.type = 'rss';
  form.url = '';
  form.configJson = '{}';
  showForm.value = false;
}

async function deleteSource(id: string) {
  await store.removeSource(id);
}

onMounted(() => {
  store.fetchSources();
});
</script>

<style scoped>
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ds-border-subtle);
}

.panel-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--ds-text-primary);
}

/* Form */
.add-form {
  padding: 16px;
  background: color-mix(in srgb, var(--ds-text-secondary) 3%, transparent);
  border-bottom: 1px solid var(--ds-border-subtle);
}

.form-row { margin-bottom: 12px; }
.form-row label {
  display: block;
  font-size: 12px;
  color: var(--ds-text-secondary);
  margin-bottom: 4px;
}
.form-row input,
.form-row select,
.form-row textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--ds-bg-sunken);
  border: 1px solid var(--ds-border-default);
  border-radius: var(--ds-radius-sm, 4px);
  padding: 6px 10px;
  color: var(--ds-text-primary);
  font-size: 13px;
  font-family: inherit;
}
.form-row textarea { resize: vertical; }
.form-row input:focus,
.form-row select:focus,
.form-row textarea:focus {
  outline: none;
  border-color: var(--ds-status-info);
}

.form-actions { display: flex; gap: 8px; justify-content: flex-end; }

/* Shared panel states */
.panel-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 8px;
}
.panel-state.loading { flex-direction: row; }

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--ds-border-subtle);
  border-top-color: var(--ds-status-info);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.error-icon { font-size: 28px; }
.error-msg { color: var(--ds-status-danger); font-size: 13px; }
.empty-icon { font-size: 32px; color: var(--ds-text-muted); }
.empty-text { color: var(--ds-text-muted); font-size: 13px; }

/* List */
.sources-list { padding: 8px; }

.source-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-radius: var(--ds-radius-sm, 6px);
  transition: background 0.15s;
}
.source-item:hover {
  background: color-mix(in srgb, var(--ds-text-secondary) 5%, transparent);
}

.source-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.source-name { font-size: 13px; font-weight: 500; color: var(--ds-text-primary); }
.source-type {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: var(--ds-radius-sm, 3px);
  background: color-mix(in srgb, var(--ds-text-secondary) 10%, transparent);
  color: var(--ds-text-secondary);
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.dot-active { background: var(--ds-status-success); }
.dot-error { background: var(--ds-status-danger); }
.dot-disabled { background: var(--ds-text-muted); }
.dot-idle { background: var(--ds-text-muted); }

.source-url {
  font-size: 12px;
  color: var(--ds-text-muted);
  word-break: break-all;
  margin-bottom: 4px;
}
.source-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--ds-text-muted);
}

.source-actions { display: flex; align-items: center; gap: 12px; }

/* Toggle */
.toggle {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  cursor: pointer;
}
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--ds-border-strong);
  border-radius: 20px;
  transition: background 0.2s;
}
.toggle-slider::before {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  left: 3px;
  top: 3px;
  background: var(--ds-text-muted);
  border-radius: 50%;
  transition: transform 0.2s, background 0.2s;
}
.toggle input:checked + .toggle-slider {
  background: color-mix(in srgb, var(--ds-status-success) 30%, transparent);
}
.toggle input:checked + .toggle-slider::before {
  transform: translateX(16px);
  background: var(--ds-status-success);
}
</style>
