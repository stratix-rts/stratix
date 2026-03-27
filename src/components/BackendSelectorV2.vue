<script setup lang="ts">
/**
 * BackendSelectorV2 - Vue 版本的后端选择器
 * 用于 CharacterCreatorModalV2 的 openclaw 步骤
 */
import { ref, watch } from 'vue';
import { StratixButton } from '@/components/ui';
import type { AgentBackendType } from '@/stratix-core/stratix-protocol';
import type { OpenClawConfigLocal, StratixDirectConfig } from '../stratix-character-creator/types';

const props = defineProps<{
  initialBackendType?: AgentBackendType;
  initialOpenClawConfig?: OpenClawConfigLocal;
  initialStratixConfig?: StratixDirectConfig;
}>();

const emit = defineEmits<{
  (e: 'change', backendType: AgentBackendType, config: OpenClawConfigLocal | StratixDirectConfig): void;
  (e: 'next'): void;
  (e: 'prev'): void;
}>();

// Backend type selection
const backendType = ref<AgentBackendType>(props.initialBackendType || 'stratix');

// OpenClaw config
const ocEndpoint = ref(props.initialOpenClawConfig?.endpoint || '');
const ocAccountId = ref(props.initialOpenClawConfig?.accountId || '');
const ocApiKey = ref(props.initialOpenClawConfig?.apiKey || '');

// Stratix config
const stratixProvider = ref<StratixDirectConfig['provider']>(props.initialStratixConfig?.provider || 'openai');
const stratixModel = ref(props.initialStratixConfig?.model || 'gpt-4o');
const stratixApiKey = ref(props.initialStratixConfig?.apiKey || '');
const stratixEndpoint = ref(props.initialStratixConfig?.endpoint || '');
const stratixTemperature = ref(props.initialStratixConfig?.temperature || 0.7);
const stratixMaxTokens = ref(props.initialStratixConfig?.maxTokens || 4096);

// Validation
const validationErrors = ref<string[]>([]);
const isTesting = ref(false);
const testStatus = ref<{ success: boolean; message: string } | null>(null);

const providers = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'azure', label: 'Azure OpenAI' },
];

const modelsByProvider: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  ollama: ['llama2', 'mistral', 'codellama'],
  azure: ['gpt-4', 'gpt-4-turbo', 'gpt-35-turbo'],
};

const selectBackendType = (type: AgentBackendType) => {
  backendType.value = type;
  validationErrors.value = [];
  emitBackendChange();
};

const emitBackendChange = () => {
  if (backendType.value === 'openclaw') {
    emit('change', backendType.value, {
      endpoint: ocEndpoint.value,
      accountId: ocAccountId.value,
      apiKey: ocApiKey.value,
    });
  } else {
    emit('change', backendType.value, {
      provider: stratixProvider.value,
      model: stratixModel.value,
      apiKey: stratixApiKey.value,
      endpoint: stratixEndpoint.value,
      temperature: stratixTemperature.value,
      maxTokens: stratixMaxTokens.value,
      maxShortTerm: 20,
      enableLongTerm: true,
    });
  }
};

watch([backendType, ocEndpoint, ocAccountId, ocApiKey, stratixProvider, stratixModel, stratixApiKey, stratixEndpoint, stratixTemperature, stratixMaxTokens], () => {
  emitBackendChange();
});

const validate = (): boolean => {
  validationErrors.value = [];

  if (backendType.value === 'openclaw') {
    if (!ocEndpoint.value.trim()) {
      validationErrors.value.push('Endpoint 不能为空');
    }
    if (!ocAccountId.value.trim()) {
      validationErrors.value.push('Account ID 不能为空');
    }
  } else {
    if (!stratixApiKey.value.trim() && stratixProvider.value !== 'ollama') {
      validationErrors.value.push('API Key 不能为空');
    }
    if (!stratixModel.value.trim()) {
      validationErrors.value.push('请选择模型');
    }
  }

  return validationErrors.value.length === 0;
};

const handleTestConnection = async () => {
  if (!validate()) return;

  isTesting.value = true;
  testStatus.value = null;

  try {
    if (backendType.value === 'openclaw') {
      // Test OpenClaw connection
      const response = await fetch('/api/openclaw/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: ocEndpoint.value,
          accountId: ocAccountId.value,
          apiKey: ocApiKey.value,
        }),
      });
      const result = await response.json();
      testStatus.value = {
        success: result.connected || result.success,
        message: result.connected ? '连接成功' : (result.message || '连接失败'),
      };
    } else {
      // Test Stratix connection
      const response = await fetch('/api/stratix/config/agent/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backendType: 'stratix',
          config: {
            provider: stratixProvider.value,
            model: stratixModel.value,
            apiKey: stratixApiKey.value,
            endpoint: stratixEndpoint.value,
            temperature: stratixTemperature.value,
            maxTokens: stratixMaxTokens.value,
          },
        }),
      });
      const result = await response.json();
      testStatus.value = {
        success: result.success,
        message: result.success ? '连接成功' : (result.message || '连接失败'),
      };
    }
  } catch (error: any) {
    testStatus.value = {
      success: false,
      message: error.message || '连接失败',
    };
  } finally {
    isTesting.value = false;
  }
};

const handleNext = () => {
  if (validate()) {
    emit('next');
  }
};
</script>

<template>
  <div class="backend-selector">
    <!-- Backend Type Selection -->
    <div class="section">
      <label class="section-label">后端类型 BACKEND TYPE</label>
      <div class="backend-buttons">
        <button
          class="backend-btn"
          :class="{ active: backendType === 'openclaw' }"
          @click="selectBackendType('openclaw')"
        >
          <span class="backend-icon">⚡</span>
          <span>OpenClaw</span>
        </button>
        <button
          class="backend-btn"
          :class="{ active: backendType === 'stratix' }"
          @click="selectBackendType('stratix')"
        >
          <span class="backend-icon">🤖</span>
          <span>StratixAgent</span>
        </button>
      </div>
    </div>

    <!-- Config Area -->
    <div class="config-area">
      <!-- OpenClaw Config -->
      <div v-if="backendType === 'openclaw'" class="config-panel">
        <div class="form-group">
          <label class="form-label">Endpoint URL</label>
          <input
            v-model="ocEndpoint"
            type="text"
            class="form-input"
            placeholder="http://127.0.0.1:18789"
          />
        </div>
        <div class="form-group">
          <label class="form-label">Account ID</label>
          <input
            v-model="ocAccountId"
            type="text"
            class="form-input"
            placeholder="your-account-id"
          />
        </div>
        <div class="form-group">
          <label class="form-label">API Key (可选)</label>
          <input
            v-model="ocApiKey"
            type="password"
            class="form-input"
            placeholder="Enter API Key"
          />
        </div>
      </div>

      <!-- Stratix Config -->
      <div v-else class="config-panel">
        <div class="form-group">
          <label class="form-label">Provider</label>
          <select v-model="stratixProvider" class="form-select">
            <option v-for="p in providers" :key="p.value" :value="p.value">
              {{ p.label }}
            </option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Model</label>
          <select v-model="stratixModel" class="form-select">
            <option v-for="m in modelsByProvider[stratixProvider]" :key="m" :value="m">
              {{ m }}
            </option>
          </select>
        </div>
        <div v-if="stratixProvider !== 'ollama'" class="form-group">
          <label class="form-label">API Key</label>
          <input
            v-model="stratixApiKey"
            type="password"
            class="form-input"
            placeholder="Enter API Key"
          />
        </div>
        <div class="form-group">
          <label class="form-label">Endpoint (可选)</label>
          <input
            v-model="stratixEndpoint"
            type="text"
            class="form-input"
            placeholder="https://api.openai.com/v1"
          />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Temperature</label>
            <input
              v-model.number="stratixTemperature"
              type="number"
              min="0"
              max="2"
              step="0.1"
              class="form-input"
            />
          </div>
          <div class="form-group">
            <label class="form-label">Max Tokens</label>
            <input
              v-model.number="stratixMaxTokens"
              type="number"
              min="100"
              max="100000"
              class="form-input"
            />
          </div>
        </div>
      </div>

      <!-- Validation Errors -->
      <div v-if="validationErrors.length > 0" class="validation-errors">
        <div v-for="error in validationErrors" :key="error" class="error-item">
          ✗ {{ error }}
        </div>
      </div>

      <!-- Test Status -->
      <div v-if="testStatus" class="test-status" :class="{ success: testStatus.success, error: !testStatus.success }">
        {{ testStatus.success ? '✓' : '✗' }} {{ testStatus.message }}
      </div>

      <!-- Test Connection Button -->
      <div class="test-section">
        <StratixButton variant="secondary" size="sm" @click="handleTestConnection" :disabled="isTesting">
          {{ isTesting ? '测试中...' : '测试连接 Test Connection' }}
        </StratixButton>
      </div>
    </div>

    <!-- Navigation -->
    <div class="nav-buttons">
      <StratixButton variant="secondary" size="sm" @click="$emit('prev')">
        上一步
      </StratixButton>
      <StratixButton variant="primary" size="sm" @click="handleNext">
        下一步：配置AI
      </StratixButton>
    </div>
  </div>
</template>

<style scoped>
.backend-selector {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.section {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--ds-border);
}

.section-label {
  display: block;
  font-size: 11px;
  color: var(--ds-text-muted);
  margin-bottom: 10px;
}

.backend-buttons {
  display: flex;
  gap: 8px;
}

.backend-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 8px;
  background: transparent;
  border: 1px solid var(--ds-border);
  border-radius: 8px;
  color: var(--ds-text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.backend-btn:hover {
  border-color: var(--ds-brand-primary);
  color: var(--ds-brand-primary);
}

.backend-btn.active {
  background: var(--ds-brand-primary);
  border-color: var(--ds-brand-primary);
  color: var(--ds-text-inverse);
}

.backend-icon {
  font-size: 18px;
}

.config-area {
  flex: 1;
  overflow-y: auto;
}

.config-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-row {
  display: flex;
  gap: 12px;
}

.form-row .form-group {
  flex: 1;
}

.form-label {
  font-size: 11px;
  color: var(--ds-text-muted);
}

.form-input,
.form-select {
  width: 100%;
  padding: 8px 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  color: var(--ds-text-primary);
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
}

.form-input:focus,
.form-select:focus {
  border-color: var(--ds-brand-primary);
}

.validation-errors {
  padding: 12px;
  background: rgba(255, 102, 102, 0.1);
  border: 1px solid rgba(255, 102, 102, 0.3);
  border-radius: 6px;
}

.error-item {
  font-size: 12px;
  color: var(--ds-status-danger);
  margin-bottom: 4px;
}

.error-item:last-child {
  margin-bottom: 0;
}

.test-status {
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 12px;
}

.test-status.success {
  background: rgba(0, 255, 136, 0.1);
  color: var(--ds-status-success);
}

.test-status.error {
  background: rgba(255, 102, 102, 0.1);
  color: var(--ds-status-danger);
}

.test-section {
  margin-top: 12px;
}

.nav-buttons {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--ds-border);
}
</style>
