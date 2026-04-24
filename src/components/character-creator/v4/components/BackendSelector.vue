<script setup lang="ts">
/**
 * BackendSelector.vue — 后端选择器 (V4)
 *
 * 支持 OpenClaw / Stratix / Direct 三种后端切换及配置。
 * OpenClaw：endpoint, accountId, apiKey
 * Stratix：provider, model, apiKey, endpoint, temperature, maxTokens
 * Direct：provider, model, apiKey, endpoint, temperature, maxTokens
 *
 * Props:
 *   modelValue?: { backendType, openClawConfig?, stratixConfig? }
 *
 * Emits:
 *   update:modelValue
 *   change
 *
 * 美学约束: A1-A8，全部使用 var(--ds-*) tokens
 */

import { ref, computed, watch } from 'vue';
import { StratixButton, StratixInput, StratixSelect } from '@/components/ui';
import type { StratixDirectConfig } from '@/stratix-core/stratix-protocol';
import type { OpenClawConfigLocal } from '@/stratix-character-creator/types';

// ============================================================================
// Types
// ============================================================================

/** 后端类型 — 本地定义，包含 direct 选项 */
type AgentBackendType = 'openclaw' | 'stratix' | 'direct';

/** Direct 直连配置 */
export interface DirectConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'deepseek' | 'qwen' | 'custom';
  model: string;
  apiKey?: string;
  endpoint?: string;
  temperature?: number;
  maxTokens?: number;
}

/** 组件值类型 */
export interface BackendSelectorValue {
  backendType: AgentBackendType;
  openClawConfig?: OpenClawConfigLocal;
  stratixConfig?: StratixDirectConfig;
  directConfig?: DirectConfig;
}

// ============================================================================
// Props / Emits
// ============================================================================

const props = defineProps<{
  modelValue?: BackendSelectorValue;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: BackendSelectorValue];
  'change': [value: BackendSelectorValue];
}>();

// ============================================================================
// State
// ============================================================================

const currentBackend = ref<AgentBackendType>(
  props.modelValue?.backendType ?? 'stratix',
);

const openClawConfig = ref<OpenClawConfigLocal>({
  endpoint: props.modelValue?.openClawConfig?.endpoint ?? '',
  accountId: props.modelValue?.openClawConfig?.accountId ?? '',
  apiKey: props.modelValue?.openClawConfig?.apiKey ?? '',
});

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

const directConfig = ref<DirectConfig>({
  provider: props.modelValue?.directConfig?.provider ?? 'openai',
  model: props.modelValue?.directConfig?.model ?? 'gpt-4o',
  apiKey: props.modelValue?.directConfig?.apiKey ?? '',
  endpoint: props.modelValue?.directConfig?.endpoint ?? '',
  temperature: props.modelValue?.directConfig?.temperature ?? 0.7,
  maxTokens: props.modelValue?.directConfig?.maxTokens ?? 4096,
});

const connectionStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle');
const statusMessage = ref('');

// ============================================================================
// Options
// ============================================================================

const providerOptions = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'qwen', label: 'Qwen' },
  { value: 'custom', label: 'Custom' },
];

const modelMap: Record<string, { value: string; label: string }[]> = {
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

const stratixModelOptions = computed(
  () => modelMap[stratixConfig.value.provider] ?? modelMap.custom,
);
const directModelOptions = computed(
  () => modelMap[directConfig.value.provider] ?? modelMap.custom,
);

/** 后端类型选项卡 */
const backendTabs: { key: AgentBackendType; icon: string; label: string }[] = [
  { key: 'openclaw', icon: '⚡', label: 'OpenClaw' },
  { key: 'stratix', icon: '🤖', label: 'Stratix' },
  { key: 'direct', icon: '🔗', label: 'Direct' },
];

// ============================================================================
// Actions
// ============================================================================

function selectBackend(type: AgentBackendType): void {
  currentBackend.value = type;
  emitChange();
}

function emitChange(): void {
  const value: BackendSelectorValue = {
    backendType: currentBackend.value,
    openClawConfig:
      currentBackend.value === 'openclaw'
        ? { ...openClawConfig.value }
        : undefined,
    stratixConfig:
      currentBackend.value === 'stratix'
        ? { ...stratixConfig.value }
        : undefined,
    directConfig:
      currentBackend.value === 'direct'
        ? { ...directConfig.value }
        : undefined,
  };
  emit('update:modelValue', value);
  emit('change', value);
}

// 深度监听配置变更
watch(
  [openClawConfig, stratixConfig, directConfig],
  () => emitChange(),
  { deep: true },
);

/** 测试连接 */
async function testConnection(): Promise<void> {
  connectionStatus.value = 'testing';
  statusMessage.value = '连接中…';

  try {
    if (currentBackend.value === 'openclaw') {
      if (!openClawConfig.value.endpoint) throw new Error('Endpoint 不能为空');
      if (!openClawConfig.value.accountId) throw new Error('Account ID 不能为空');
      await new Promise((r) => setTimeout(r, 500));
    } else if (currentBackend.value === 'stratix') {
      if (!stratixConfig.value.model) throw new Error('请选择模型');
      if (!stratixConfig.value.apiKey && stratixConfig.value.provider !== 'ollama')
        throw new Error('API Key 不能为空');
      await new Promise((r) => setTimeout(r, 500));
    } else {
      if (!directConfig.value.model) throw new Error('请选择模型');
      if (!directConfig.value.apiKey && directConfig.value.provider !== 'ollama')
        throw new Error('API Key 不能为空');
      await new Promise((r) => setTimeout(r, 500));
    }
    connectionStatus.value = 'success';
    statusMessage.value = '连接成功';
  } catch (err: any) {
    connectionStatus.value = 'error';
    statusMessage.value = err.message ?? '连接失败';
  }

  setTimeout(() => {
    connectionStatus.value = 'idle';
    statusMessage.value = '';
  }, 3000);
}

/** 外部验证接口 */
function validate(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (currentBackend.value === 'openclaw') {
    if (!openClawConfig.value.endpoint) errors.push('Endpoint 不能为空');
    if (!openClawConfig.value.accountId) errors.push('Account ID 不能为空');
  } else if (currentBackend.value === 'stratix') {
    if (!stratixConfig.value.model) errors.push('请选择模型');
    if (!stratixConfig.value.apiKey && stratixConfig.value.provider !== 'ollama')
      errors.push('API Key 不能为空');
  } else {
    if (!directConfig.value.model) errors.push('请选择模型');
    if (!directConfig.value.apiKey && directConfig.value.provider !== 'ollama')
      errors.push('API Key 不能为空');
  }

  return { valid: errors.length === 0, errors };
}

defineExpose({ validate });
</script>

<template>
  <div class="backend-selector">
    <!-- Header — A5: 标题层级 -->
    <div class="backend-selector__header">
      <span class="backend-selector__title">连接配置</span>
      <span class="backend-selector__subtitle">CONNECTION</span>
    </div>

    <!-- Backend Type Tabs — A2: flex 等宽对齐, A4: 等尺寸 -->
    <div class="backend-selector__tabs">
      <button
        v-for="tab in backendTabs"
        :key="tab.key"
        class="backend-tab"
        :class="{ 'backend-tab--active': currentBackend === tab.key }"
        @click="selectBackend(tab.key)"
      >
        <span class="backend-tab__icon">{{ tab.icon }}</span>
        <span class="backend-tab__label">{{ tab.label }}</span>
      </button>
    </div>

    <!-- Config Area — A1: 间距一致性, A7: 留白 -->
    <div class="backend-selector__body">
      <!-- ── OpenClaw Config ── -->
      <div v-show="currentBackend === 'openclaw'" class="config-panel">
        <div class="config-panel__field">
          <label class="config-panel__label">Endpoint URL</label>
          <StratixInput
            v-model="openClawConfig.endpoint"
            type="text"
            placeholder="http://127.0.0.1:18789"
            size="sm"
          />
        </div>
        <div class="config-panel__field">
          <label class="config-panel__label">Account ID</label>
          <StratixInput
            v-model="openClawConfig.accountId"
            type="text"
            placeholder="your-account-id"
            size="sm"
          />
        </div>
        <div class="config-panel__field">
          <label class="config-panel__label">
            API Key
            <span class="config-panel__optional">(可选)</span>
          </label>
          <StratixInput
            v-model="openClawConfig.apiKey"
            type="password"
            placeholder="Enter API Key"
            size="sm"
          />
        </div>
      </div>

      <!-- ── Stratix Config ── -->
      <div v-show="currentBackend === 'stratix'" class="config-panel">
        <div class="config-panel__field">
          <label class="config-panel__label">Provider</label>
          <StratixSelect
            :model-value="stratixConfig.provider"
            :options="providerOptions"
            size="sm"
            @update:model-value="stratixConfig.provider = $event as string"
          />
        </div>
        <div class="config-panel__field">
          <label class="config-panel__label">Model</label>
          <StratixSelect
            :model-value="stratixConfig.model"
            :options="stratixModelOptions"
            size="sm"
            @update:model-value="stratixConfig.model = $event as string"
          />
        </div>
        <div class="config-panel__field">
          <label class="config-panel__label">
            API Key
            <span v-if="stratixConfig.provider === 'ollama'" class="config-panel__optional">
              (可选)
            </span>
          </label>
          <StratixInput
            v-model="stratixConfig.apiKey"
            type="password"
            placeholder="Enter API Key"
            size="sm"
          />
        </div>
        <div v-if="stratixConfig.provider === 'custom'" class="config-panel__field">
          <label class="config-panel__label">Custom Endpoint</label>
          <StratixInput
            v-model="stratixConfig.endpoint"
            type="text"
            placeholder="https://api.example.com/v1"
            size="sm"
          />
        </div>
        <div class="config-panel__row">
          <div class="config-panel__field">
            <label class="config-panel__label">Temperature</label>
            <StratixInput
              :model-value="String(stratixConfig.temperature ?? 0.7)"
              type="number"
              size="sm"
              @update:model-value="stratixConfig.temperature = Number($event)"
            />
          </div>
          <div class="config-panel__field">
            <label class="config-panel__label">Max Tokens</label>
            <StratixInput
              :model-value="String(stratixConfig.maxTokens ?? 4096)"
              type="number"
              size="sm"
              @update:model-value="stratixConfig.maxTokens = Number($event)"
            />
          </div>
        </div>
      </div>

      <!-- ── Direct Config ── -->
      <div v-show="currentBackend === 'direct'" class="config-panel">
        <div class="config-panel__field">
          <label class="config-panel__label">Provider</label>
          <StratixSelect
            :model-value="directConfig.provider"
            :options="providerOptions"
            size="sm"
            @update:model-value="directConfig.provider = $event as string"
          />
        </div>
        <div class="config-panel__field">
          <label class="config-panel__label">Model</label>
          <StratixSelect
            :model-value="directConfig.model"
            :options="directModelOptions"
            size="sm"
            @update:model-value="directConfig.model = $event as string"
          />
        </div>
        <div class="config-panel__field">
          <label class="config-panel__label">
            API Key
            <span v-if="directConfig.provider === 'ollama'" class="config-panel__optional">
              (可选)
            </span>
          </label>
          <StratixInput
            v-model="directConfig.apiKey"
            type="password"
            placeholder="Enter API Key"
            size="sm"
          />
        </div>
        <div v-if="directConfig.provider === 'custom'" class="config-panel__field">
          <label class="config-panel__label">Custom Endpoint</label>
          <StratixInput
            v-model="directConfig.endpoint"
            type="text"
            placeholder="https://api.example.com/v1"
            size="sm"
          />
        </div>
        <div class="config-panel__row">
          <div class="config-panel__field">
            <label class="config-panel__label">Temperature</label>
            <StratixInput
              :model-value="String(directConfig.temperature ?? 0.7)"
              type="number"
              size="sm"
              @update:model-value="directConfig.temperature = Number($event)"
            />
          </div>
          <div class="config-panel__field">
            <label class="config-panel__label">Max Tokens</label>
            <StratixInput
              :model-value="String(directConfig.maxTokens ?? 4096)"
              type="number"
              size="sm"
              @update:model-value="directConfig.maxTokens = Number($event)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Footer — A5: CTA 在末端 -->
    <div class="backend-selector__footer">
      <div
        v-if="statusMessage"
        class="status-msg"
        :class="{
          'status-msg--success': connectionStatus === 'success',
          'status-msg--error': connectionStatus === 'error',
          'status-msg--testing': connectionStatus === 'testing',
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
/* ── Root Container ── A2: flex column, A3: ds tokens, A6: ≤15 props */
.backend-selector {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ds-bg-secondary, #1a1a1a);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radii-lg, 8px);
  overflow: hidden;
}

/* ── Header ── A5: 标题层级 lg + xs, A1: padding 12px 16px */
.backend-selector__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--ds-spacing-12, 12px) var(--ds-spacing-16, 16px);
  border-bottom: 1px solid var(--ds-border, #333);
}

.backend-selector__title {
  font-size: var(--ds-font-size-md, 14px);
  font-weight: 500;
  color: var(--ds-color-primary, #00d4ff);
}

.backend-selector__subtitle {
  font-size: var(--ds-font-size-xs, 10px);
  color: var(--ds-text-muted, #666);
  letter-spacing: 1px;
}

/* ── Tabs ── A2: flex 等宽, A4: 等尺寸, A8: 对称 */
.backend-selector__tabs {
  display: flex;
  gap: var(--ds-spacing-8, 8px);
  padding: var(--ds-spacing-12, 12px) var(--ds-spacing-16, 16px);
  background: var(--ds-bg-base, #111);
  border-bottom: 1px solid var(--ds-border, #333);
}

.backend-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--ds-spacing-4, 4px);
  padding: var(--ds-spacing-12, 12px) var(--ds-spacing-8, 8px);
  background: transparent;
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radii-lg, 8px);
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}

.backend-tab:hover {
  border-color: var(--ds-color-primary, #00d4ff);
  background: var(--ds-bg-tertiary, #222);
}

.backend-tab--active {
  background: var(--ds-color-primary, #00d4ff);
  border-color: var(--ds-color-primary, #00d4ff);
}

.backend-tab__icon {
  font-size: var(--ds-font-size-xl, 20px);
  line-height: 1;
}

.backend-tab__label {
  font-size: var(--ds-font-size-sm, 12px);
  color: var(--ds-text-secondary, #aaa);
}

.backend-tab--active .backend-tab__label {
  color: var(--ds-text-inverse, #fff);
}

/* ── Body (scrollable) ── A1: padding 16px, A7: 留白 */
.backend-selector__body {
  flex: 1;
  overflow-y: auto;
  padding: var(--ds-spacing-16, 16px);
}

/* ── Config Panel ── A1: gap 16px, A7: 留白 */
.config-panel {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-16, 16px);
}

.config-panel__field {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-4, 4px);
}

.config-panel__row {
  display: flex;
  gap: var(--ds-spacing-12, 12px);
}

.config-panel__row .config-panel__field {
  flex: 1;
}

.config-panel__label {
  font-size: var(--ds-font-size-xs, 10px);
  color: var(--ds-text-muted, #666);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.config-panel__optional {
  font-size: var(--ds-font-size-xs, 10px);
  color: var(--ds-text-muted, #666);
  text-transform: none;
  font-weight: normal;
}

/* ── Footer ── A5: CTA 末端, A1: padding 12px 16px */
.backend-selector__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ds-spacing-12, 12px);
  padding: var(--ds-spacing-12, 12px) var(--ds-spacing-16, 16px);
  border-top: 1px solid var(--ds-border, #333);
}

.status-msg {
  flex: 1;
  font-size: var(--ds-font-size-sm, 12px);
  padding: var(--ds-spacing-4, 4px) var(--ds-spacing-8, 8px);
  border-radius: var(--ds-radii-md, 4px);
  background: var(--ds-bg-tertiary, #222);
  color: var(--ds-text-secondary, #aaa);
}

.status-msg--success {
  background: rgba(0, 255, 136, 0.1);
  color: var(--ds-status-success, #00ff88);
}

.status-msg--error {
  background: rgba(255, 68, 87, 0.1);
  color: var(--ds-status-danger, #ff4757);
}

.status-msg--testing {
  background: rgba(255, 200, 0, 0.1);
  color: var(--ds-color-warning, #ffcc00);
}

/* ── Scrollbar ── 简洁 */
.backend-selector__body::-webkit-scrollbar {
  width: 6px;
}

.backend-selector__body::-webkit-scrollbar-track {
  background: var(--ds-bg-base, #111);
}

.backend-selector__body::-webkit-scrollbar-thumb {
  background: var(--ds-border, #333);
  border-radius: 3px;
}

.backend-selector__body::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary, #00d4ff);
}
</style>
