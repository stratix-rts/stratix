<template>
  <div class="llm-config-panel">
    <div class="panel-header">
      <h3 class="panel-title">LLM 配置</h3>
      <button class="btn-refresh" @click="handleRefresh" :disabled="isLoading">
        ↻ 刷新
      </button>
    </div>

    <!-- Loading -->
    <div v-if="isLoading && !store.llmConfig" class="panel-state">
      <span class="spinner"></span>
      <span class="state-text">加载中...</span>
    </div>

    <!-- Error -->
    <div v-else-if="saveError" class="panel-state state-error">
      <span class="state-icon">⚠️</span>
      <span class="state-text">{{ saveError }}</span>
    </div>

    <!-- Form -->
    <div v-else class="config-form">
      <div class="form-group">
        <label class="form-label">Provider</label>
        <select v-model="form.provider" class="form-select">
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI (GPT)</option>
          <option value="deepseek">DeepSeek</option>
          <option value="qwen">通义千问 (Qwen)</option>
          <option value="ollama">Ollama (本地)</option>
          <option value="custom">自定义</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Model</label>
        <input
          v-model="form.model"
          type="text"
          class="form-input"
          placeholder="e.g. claude-sonnet-4-20250514"
        />
      </div>

      <div class="form-group">
        <label class="form-label">API Key</label>
        <input
          v-model="form.apiKey"
          :type="showApiKey ? 'text' : 'password'"
          class="form-input"
          placeholder="sk-..."
        />
        <button class="btn-toggle-visibility" @click="showApiKey = !showApiKey">
          {{ showApiKey ? '🙈 隐藏' : '👁 显示' }}
        </button>
      </div>

      <div class="form-group">
        <label class="form-label">Base URL <span class="optional">(可选)</span></label>
        <input
          v-model="form.baseUrl"
          type="text"
          class="form-input"
          placeholder="https://api.anthropic.com"
        />
      </div>

      <!-- Status Indicator -->
      <div v-if="store.llmConfig" class="config-status">
        <span class="status-dot" :class="hasConfig ? 'dot-ok' : 'dot-error'"></span>
        <span class="status-text">
          {{ hasConfig ? `已配置: ${store.llmConfig.provider} / ${store.llmConfig.model}` : '未配置 LLM' }}
        </span>
      </div>

      <button
        class="btn btn-primary"
        @click="handleSave"
        :disabled="isSaving"
      >
        {{ isSaving ? '保存中...' : '💾 保存配置' }}
      </button>

      <div v-if="saveSuccess" class="save-success">
        ✓ 配置已保存，将在下次 LLM 调用时生效
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useSystemZoneStore } from '../../stores/systemzone';

const store = useSystemZoneStore();
const isLoading = ref(false);
const isSaving = ref(false);
const saveError = ref<string | null>(null);
const saveSuccess = ref(false);
const showApiKey = ref(false);

const form = reactive({
  provider: 'anthropic',
  model: '',
  apiKey: '',
  baseUrl: '',
});

const hasConfig = computed(() => {
  return store.llmConfig && store.llmConfig.provider;
});

async function handleRefresh() {
  isLoading.value = true;
  saveError.value = null;
  try {
    await store.fetchLLMConfig();
    if (store.llmConfig) {
      form.provider = store.llmConfig.provider || 'anthropic';
      form.model = store.llmConfig.model || '';
      form.apiKey = store.llmConfig.apiKey || '';
      form.baseUrl = store.llmConfig.baseUrl || '';
    }
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    isLoading.value = false;
  }
}

async function handleSave() {
  isSaving.value = true;
  saveError.value = null;
  saveSuccess.value = false;
  try {
    const ok = await store.updateLLMConfig({
      provider: form.provider,
      model: form.model,
      apiKey: form.apiKey || undefined,
      baseUrl: form.baseUrl || undefined,
    });
    if (ok) {
      saveSuccess.value = true;
      setTimeout(() => { saveSuccess.value = false; }, 3000);
    } else {
      saveError.value = '保存失败';
    }
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : '保存失败';
  } finally {
    isSaving.value = false;
  }
}

onMounted(() => {
  handleRefresh();
});
</script>

<style scoped>
.llm-config-panel {
  padding: 16px;
  font-family: var(--ds-typography-fontFamily-sans, system-ui, sans-serif);
  color: var(--ds-text-primary, #ffffff);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ds-border-subtle, #1e1e2e);
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: var(--ds-text-primary, #ffffff);
}

.btn-refresh {
  background: none;
  border: 1px solid var(--ds-border-default, #333);
  color: var(--ds-text-secondary, #aaa);
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.btn-refresh:hover {
  background: var(--ds-background-tertiary, #1a1a2e);
}

.btn-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.config-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 480px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
}

.form-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--ds-text-secondary, #aaa);
}

.optional {
  color: var(--ds-text-muted, #666);
  font-weight: 400;
}

.form-input,
.form-select {
  padding: 8px 12px;
  background: var(--ds-background-tertiary, #111);
  border: 1px solid var(--ds-border-default, #333);
  border-radius: 6px;
  color: var(--ds-text-primary, #fff);
  font-size: 13px;
  font-family: var(--ds-typography-fontFamily-mono, monospace);
  outline: none;
}

.form-input:focus,
.form-select:focus {
  border-color: var(--ds-border-strong, #555);
}

.form-select {
  cursor: pointer;
}

.btn-toggle-visibility {
  position: absolute;
  right: 8px;
  top: 28px;
  background: none;
  border: none;
  color: var(--ds-text-muted, #666);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
}

.btn-toggle-visibility:hover {
  color: var(--ds-text-secondary, #aaa);
}

.config-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--ds-background-tertiary, #111);
  border-radius: 6px;
  font-size: 12px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-ok { background: var(--ds-status-success, #00ff88); }
.dot-error { background: var(--ds-status-danger, #ff4444); }

.status-text {
  color: var(--ds-text-secondary, #aaa);
}

.btn-primary {
  padding: 10px 20px;
  background: var(--ds-status-info, #00d4ff);
  color: #000;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.save-success {
  font-size: 12px;
  color: var(--ds-status-success, #00ff88);
  text-align: center;
}

.panel-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  color: var(--ds-text-muted, #666);
  font-size: 13px;
}

.state-error {
  color: var(--ds-status-danger, #ff4444);
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--ds-border-default, #333);
  border-top-color: var(--ds-status-info, #00d4ff);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
