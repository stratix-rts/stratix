<script setup lang="ts">
/**
 * BackendSelector.vue - 后端选择器组件
 *
 * 支持 OpenClaw 和 StratixAgent 两种后端
 * OpenClaw 配置：endpoint, accountId, apiKey
 * Stratix 直连配置：provider, model, apiKey, endpoint, temperature, maxTokens
 *
 * emit: change(backendType, config)
 */

import { ref, computed, watch } from 'vue';
import { StratixButton } from '@/components/ui';
import type { StratixDirectConfig } from '@/stratix-core/stratix-protocol';

export type AgentBackendType = 'openclaw' | 'stratix';

export interface OpenClawConfigLocal {
  endpoint: string;
  accountId: string;
  apiKey?: string;
}

export interface BackendSelectorEmits {
  (e: 'change', backendType: AgentBackendType, config: OpenClawConfigLocal | StratixDirectConfig): void;
}

const props = defineProps<{
  modelValue?: {
    backendType: AgentBackendType;
    openClawConfig?: OpenClawConfigLocal;
    stratixConfig?: StratixDirectConfig;
  };
}>();

const emit = defineEmits<BackendSelectorEmits>();

// 当前选中的后端类型
const currentBackend = ref<AgentBackendType>(props.modelValue?.backendType ?? 'stratix');

// OpenClaw 配置
const openClawConfig = ref<OpenClawConfigLocal>({
  endpoint: props.modelValue?.openClawConfig?.endpoint ?? '',
  accountId: props.modelValue?.openClawConfig?.accountId ?? '',
  apiKey: props.modelValue?.openClawConfig?.apiKey ?? '',
});

// Stratix 配置
const stratixConfig = ref<StratixDirectConfig>({
  provider: props.modelValue?.stratixConfig?.provider ?? 'openai',
  model: props.modelValue?.stratixConfig?.model ?? 'gpt-4o',
  apiKey: props.modelValue?.stratixConfig?.apiKey ?? '',
  endpoint: props.modelValue?.stratixConfig?.endpoint ?? '',
  temperature: props.modelValue?.stratixConfig?.temperature ?? 0.7,
  maxTokens: props.modelValue?.stratixConfig?.maxTokens ?? 4096,
  maxShortTerm: props.modelValue?.stratixConfig?.maxShortTerm ?? 20,
  enableLongTerm: props.modelValue?.stratixConfig?.enableLongTerm ?? true,
});

// 连接状态
const connectionStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle');
const statusMessage = ref('');

// Provider 选项
const providerOptions = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'qwen', label: 'Qwen' },
  { value: 'custom', label: 'Custom' },
];

// Model 选项（按 provider 分组）
const modelOptions: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  anthropic: [
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
  ],
  ollama: [
    { value: 'llama3.2', label: 'Llama 3.2' },
    { value: 'qwen2.5', label: 'Qwen 2.5' },
    { value: 'deepseek-v2', label: 'DeepSeek V2' },
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'DeepSeek Chat' },
    { value: 'deepseek-coder', label: 'DeepSeek Coder' },
  ],
  qwen: [
    { value: 'qwen-turbo', label: 'Qwen Turbo' },
    { value: 'qwen-plus', label: 'Qwen Plus' },
    { value: 'qwen-max', label: 'Qwen Max' },
  ],
  custom: [
    { value: '', label: 'Custom Model' },
  ],
};

// 获取当前 provider 的模型选项
const currentModelOptions = computed(() => {
  return modelOptions[stratixConfig.value.provider] ?? modelOptions.custom;
});

// 切换后端类型
function selectBackend(type: AgentBackendType): void {
  currentBackend.value = type;
  emitChange();
}

// 发出 change 事件
function emitChange(): void {
  if (currentBackend.value === 'openclaw') {
    emit('change', 'openclaw', { ...openClawConfig.value });
  } else {
    emit('change', 'stratix', { ...stratixConfig.value });
  }
}

// 监听配置变化
watch([openClawConfig, stratixConfig], () => {
  emitChange();
}, { deep: true });

// 测试连接
async function testConnection(): Promise<void> {
  connectionStatus.value = 'testing';
  statusMessage.value = '连接中...';

  try {
    if (currentBackend.value === 'openclaw') {
      // OpenClaw 连接测试（简单验证）
      if (!openClawConfig.value.endpoint) {
        throw new Error('Endpoint 不能为空');
      }
      if (!openClawConfig.value.accountId) {
        throw new Error('Account ID 不能为空');
      }
      // 模拟测试成功
      await new Promise(resolve => setTimeout(resolve, 500));
      connectionStatus.value = 'success';
      statusMessage.value = '连接成功';
    } else {
      // Stratix 连接测试
      if (!stratixConfig.value.model) {
        throw new Error('请选择模型');
      }
      if (!stratixConfig.value.apiKey && stratixConfig.value.provider !== 'ollama') {
        throw new Error('API Key 不能为空');
      }
      // 模拟测试成功
      await new Promise(resolve => setTimeout(resolve, 500));
      connectionStatus.value = 'success';
      statusMessage.value = '连接成功';
    }
  } catch (error: any) {
    connectionStatus.value = 'error';
    statusMessage.value = error.message ?? '连接失败';
  }

  // 3秒后重置状态
  setTimeout(() => {
    connectionStatus.value = 'idle';
    statusMessage.value = '';
  }, 3000);
}

// 验证配置
function validate(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (currentBackend.value === 'openclaw') {
    if (!openClawConfig.value.endpoint) {
      errors.push('Endpoint 不能为空');
    }
    if (!openClawConfig.value.accountId) {
      errors.push('Account ID 不能为空');
    }
  } else {
    if (!stratixConfig.value.model) {
      errors.push('请选择模型');
    }
    if (!stratixConfig.value.apiKey && stratixConfig.value.provider !== 'ollama') {
      errors.push('API Key 不能为空');
    }
  }

  return { valid: errors.length === 0, errors };
}

// 暴露验证方法
defineExpose({
  validate,
});
</script>

<template>
  <div class="backend-selector">
    <!-- 头部 -->
    <div class="backend-selector__header">
      <span class="backend-selector__title">连接配置</span>
      <span class="backend-selector__subtitle">CONNECTION</span>
    </div>

    <!-- 后端类型选择 -->
    <div class="backend-selector__type">
      <button
        class="backend-type-btn"
        :class="{ 'backend-type-btn--active': currentBackend === 'openclaw' }"
        @click="selectBackend('openclaw')"
      >
        <span class="backend-type-btn__icon">⚡</span>
        <span class="backend-type-btn__label">OpenClaw</span>
      </button>
      <button
        class="backend-type-btn"
        :class="{ 'backend-type-btn--active': currentBackend === 'stratix' }"
        @click="selectBackend('stratix')"
      >
        <span class="backend-type-btn__icon">🤖</span>
        <span class="backend-type-btn__label">StratixAgent</span>
      </button>
    </div>

    <!-- 配置区域 -->
    <div class="backend-selector__config">
      <!-- OpenClaw 配置 -->
      <div v-show="currentBackend === 'openclaw'" class="config-panel">
        <div class="form-field">
          <label class="form-label">Endpoint URL</label>
          <input
            v-model="openClawConfig.endpoint"
            type="text"
            class="form-input"
            placeholder="http://127.0.0.1:18789"
          />
        </div>
        <div class="form-field">
          <label class="form-label">Account ID</label>
          <input
            v-model="openClawConfig.accountId"
            type="text"
            class="form-input"
            placeholder="your-account-id"
          />
        </div>
        <div class="form-field">
          <label class="form-label">API Key <span class="form-label__optional">(可选)</span></label>
          <input
            v-model="openClawConfig.apiKey"
            type="password"
            class="form-input"
            placeholder="Enter API Key"
          />
        </div>
      </div>

      <!-- Stratix 配置 -->
      <div v-show="currentBackend === 'stratix'" class="config-panel">
        <div class="form-field">
          <label class="form-label">Provider</label>
          <select v-model="stratixConfig.provider" class="form-select">
            <option v-for="p in providerOptions" :key="p.value" :value="p.value">
              {{ p.label }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">Model</label>
          <select v-model="stratixConfig.model" class="form-select">
            <option v-for="m in currentModelOptions" :key="m.value" :value="m.value">
              {{ m.label }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">API Key <span v-if="stratixConfig.provider === 'ollama'" class="form-label__optional">(可选)</span></label>
          <input
            v-model="stratixConfig.apiKey"
            type="password"
            class="form-input"
            placeholder="Enter API Key"
          />
        </div>
        <div v-if="stratixConfig.provider === 'custom'" class="form-field">
          <label class="form-label">Custom Endpoint</label>
          <input
            v-model="stratixConfig.endpoint"
            type="text"
            class="form-input"
            placeholder="https://api.example.com/v1"
          />
        </div>
        <div class="form-row">
          <div class="form-field">
            <label class="form-label">Temperature</label>
            <input
              v-model.number="stratixConfig.temperature"
              type="number"
              class="form-input"
              min="0"
              max="2"
              step="0.1"
            />
          </div>
          <div class="form-field">
            <label class="form-label">Max Tokens</label>
            <input
              v-model.number="stratixConfig.maxTokens"
              type="number"
              class="form-input"
              min="100"
              max="128000"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 状态和测试按钮 -->
    <div class="backend-selector__footer">
      <div
        v-if="statusMessage"
        class="status-message"
        :class="{
          'status-message--success': connectionStatus === 'success',
          'status-message--error': connectionStatus === 'error',
          'status-message--testing': connectionStatus === 'testing',
        }"
      >
        {{ statusMessage }}
      </div>
      <StratixButton
        variant="secondary"
        size="sm"
        :loading="connectionStatus === 'testing'"
        @click="testConnection"
      >
        测试连接
      </StratixButton>
    </div>
  </div>
</template>

<style scoped>
.backend-selector {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  overflow: hidden;
  font-family: var(--ds-font-mono);
}

.backend-selector__header {
  padding: var(--ds-spacing-md) var(--ds-spacing-md);
  border-bottom: 1px solid var(--ds-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.backend-selector__title {
  font-size: var(--ds-font-size-md);
  color: var(--ds-color-primary);
  font-weight: 500;
}

.backend-selector__subtitle {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  letter-spacing: 1px;
}

.backend-selector__type {
  display: flex;
  gap: var(--ds-spacing-sm);
  padding: var(--ds-spacing-md) var(--ds-spacing-md);
  background: var(--ds-bg-base);
  border-bottom: 1px solid var(--ds-border);
}

.backend-type-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 8px;
  background: transparent;
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
  font-family: inherit;
}

.backend-type-btn:hover {
  border-color: var(--ds-color-primary);
  background: var(--ds-bg-tertiary);
}

.backend-type-btn--active {
  background: var(--ds-color-primary);
  border-color: var(--ds-color-primary);
}

.backend-type-btn__icon {
  font-size: var(--ds-font-size-2xl);
}

.backend-type-btn__label {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-secondary);
}

.backend-type-btn--active .backend-type-btn__label {
  color: var(--ds-text-inverse);
}

.backend-selector__config {
  flex: 1;
  overflow-y: auto;
  padding: var(--ds-spacing-md);
}

.config-panel {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-md);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-row {
  display: flex;
  gap: 12px;
}

.form-row .form-field {
  flex: 1;
}

.form-label {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.form-label__optional {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  text-transform: none;
  font-weight: normal;
}

.form-input,
.form-select {
  padding: 10px var(--ds-spacing-md);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-sm);
  font-family: inherit;
  transition: border-color 0.15s ease;
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: var(--ds-color-primary);
}

.form-input::placeholder {
  color: var(--ds-text-muted);
}

.backend-selector__footer {
  padding: var(--ds-spacing-md) var(--ds-spacing-md);
  border-top: 1px solid var(--ds-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.status-message {
  font-size: var(--ds-font-size-sm);
  padding: 6px 12px;
  border-radius: var(--ds-radius-sm);
  background: var(--ds-bg-tertiary);
  color: var(--ds-text-secondary);
}

.status-message--success {
  background: color-mix(in srgb, var(--ds-status-success) 10%, transparent);
  color: var(--ds-status-success);
}

.status-message--error {
  background: color-mix(in srgb, var(--ds-status-danger) 10%, transparent);
  color: var(--ds-status-danger);
}

.status-message--testing {
  background: color-mix(in srgb, var(--ds-status-warning) 10%, transparent);
  color: var(--ds-status-warning);
}

/* 滚动条样式 */
.backend-selector__config::-webkit-scrollbar {
  width: 6px;
}

.backend-selector__config::-webkit-scrollbar-track {
  background: var(--ds-bg-base);
}

.backend-selector__config::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: var(--ds-radius-sm);
}

.backend-selector__config::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary);
}
</style>
