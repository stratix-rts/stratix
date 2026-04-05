<template>
  <div class="sources-panel">
    <div class="panel-header">
      <h3 class="panel-title">外部源</h3>
      <button class="btn-add" @click="showForm = !showForm">
        {{ showForm ? '收起' : '添加源' }}
      </button>
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
        <button class="btn-submit" @click="handleAdd" :disabled="store.loading">添加</button>
        <button class="btn-cancel" @click="showForm = false">取消</button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="store.loading && store.sources.length === 0" class="loading-state">
      <span class="loading-text">加载中...</span>
    </div>

    <!-- Empty State -->
    <div v-else-if="store.sources.length === 0" class="empty-state">
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
            <span v-if="source.lastFetchAt">最后抓取: {{ formatTime(source.lastFetchAt) }}</span>
            <span v-if="source.itemCount !== undefined">条目数: {{ source.itemCount }}</span>
          </div>
        </div>
        <div class="source-actions">
          <label class="toggle">
            <input type="checkbox" :checked="source.enabled" @change="toggleSource(source)" />
            <span class="toggle-slider"></span>
          </label>
          <button class="btn-delete" @click="deleteSource(source.id)" title="删除">✕</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useSystemZoneStore } from '../../stores/systemzone';

const store = useSystemZoneStore();

const showForm = ref(false);
const form = reactive({
  name: '',
  type: 'rss' as 'rss' | 'webhook' | 'api_polling',
  url: '',
  configJson: '{}',
});

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
    enabled: true,
    config,
  });
  form.name = '';
  form.type = 'rss';
  form.url = '';
  form.configJson = '{}';
  showForm.value = false;
}

async function toggleSource(source: any) {
  // Optimistic toggle would need API support; for now just refresh
  await store.fetchSources();
}

async function deleteSource(id: string) {
  await store.removeSource(id);
}

onMounted(() => {
  store.fetchSources();
});
</script>

<style scoped>
.sources-panel {
  background: #0f1117;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.1);
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.panel-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #e2e8f0;
}

.btn-add {
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.3);
  color: #3b82f6;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}
.btn-add:hover { background: rgba(59, 130, 246, 0.25); }

/* Form */
.add-form {
  padding: 16px;
  background: rgba(148, 163, 184, 0.03);
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.form-row {
  margin-bottom: 12px;
}
.form-row label {
  display: block;
  font-size: 12px;
  color: rgba(148, 163, 184, 0.8);
  margin-bottom: 4px;
}
.form-row input,
.form-row select,
.form-row textarea {
  width: 100%;
  box-sizing: border-box;
  background: #0f1117;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 4px;
  padding: 6px 10px;
  color: #e2e8f0;
  font-size: 13px;
  font-family: inherit;
}
.form-row textarea { resize: vertical; }
.form-row input:focus,
.form-row select:focus,
.form-row textarea:focus {
  outline: none;
  border-color: #3b82f6;
}

.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn-submit {
  background: #3b82f6;
  border: none;
  color: #fff;
  padding: 6px 16px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
.btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-cancel {
  background: transparent;
  border: 1px solid rgba(148, 163, 184, 0.2);
  color: #94a3b8;
  padding: 6px 16px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

/* States */
.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 8px;
}
.loading-text { color: #94a3b8; font-size: 13px; }
.empty-icon { font-size: 32px; color: #94a3b8; }
.empty-text { color: #94a3b8; font-size: 13px; }

/* List */
.sources-list { padding: 8px; }

.source-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-radius: 6px;
  transition: background 0.15s;
}
.source-item:hover { background: rgba(148, 163, 184, 0.05); }

.source-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.source-name { font-size: 13px; font-weight: 500; color: #e2e8f0; }
.source-type {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.1);
  color: #94a3b8;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.dot-active { background: #22c55e; }
.dot-error { background: #ef4444; }
.dot-disabled { background: #94a3b8; }
.dot-idle { background: #64748b; }

.source-url {
  font-size: 12px;
  color: #64748b;
  word-break: break-all;
  margin-bottom: 4px;
}
.source-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: #64748b;
}

.source-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

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
  background: #334155;
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
  background: #94a3b8;
  border-radius: 50%;
  transition: transform 0.2s, background 0.2s;
}
.toggle input:checked + .toggle-slider { background: rgba(34, 197, 94, 0.3); }
.toggle input:checked + .toggle-slider::before {
  transform: translateX(16px);
  background: #22c55e;
}

.btn-delete {
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}
.btn-delete:hover { background: rgba(239, 68, 68, 0.1); }
</style>
