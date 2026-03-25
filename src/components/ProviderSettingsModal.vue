<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import StratixModal from './ui/StratixModal.vue';
import StratixButton from './ui/StratixButton.vue';
import StratixInput from './ui/StratixInput.vue';
import StratixSelect from './ui/StratixSelect.vue';
import SvgIcon from './ui/SvgIcon.vue';
import GlobalProviderSettings, { type ProviderEntrySafe } from '@/stratix-core/config/GlobalProviderSettings';
import { LLMConnector } from '@/stratix-agent/core/LLMConnector';
import type { LLMConfig } from '@/stratix-agent/types';
import builtInProviders from '@/config/providers.config.json';

interface Props {
  visible: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'saved': [providerId: string];
}>();

const globalSettings = GlobalProviderSettings.getInstance();

// Provider options from config
const providerOptions = builtInProviders.providerOrder.map(id => ({
  value: id,
  label: `${(builtInProviders.providers as any)[id]?.icon || ''} ${(builtInProviders.providers as any)[id]?.name || id}`,
}));

// Form state - reordered: Endpoint → API Key → Model → Provider (optional)
const newProvider = ref({
  name: '',
  provider: 'deepseek',
  model: '',
  apiKey: '',
  baseUrl: '',
  temperature: 0.7,
  maxTokens: 4096,
});

// Direct config mode (without selecting a provider)
const directConfigMode = ref(false);

// Edit mode
const editingId = ref<string | null>(null);

// Test state
const testStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle');
const testMessage = ref('');

// Saved providers list
const savedProviders = ref<ProviderEntrySafe[]>([]);

// Model options based on selected provider
const modelOptions = computed(() => {
  const provider = builtInProviders.providers as any;
  const models = provider[newProvider.value.provider]?.models || [];
  return models.map((m: string) => ({ value: m, label: m }));
});

// Endpoint placeholder
const endpointPlaceholder = computed(() => {
  const provider = builtInProviders.providers as any;
  return provider[newProvider.value.provider]?.defaultEndpoint || '';
});

// Load saved providers when modal opens
watch(() => props.visible, async (visible) => {
  if (visible) {
    await loadProviders();
    resetForm();
  }
});

async function loadProviders() {
  await globalSettings.ensureLoaded();
  savedProviders.value = globalSettings.getProvidersSafe();
}

function resetForm() {
  newProvider.value = {
    name: '',
    provider: 'deepseek',
    model: '',
    apiKey: '',
    baseUrl: '',
    temperature: 0.7,
    maxTokens: 4096,
  };
  editingId.value = null;
  testStatus.value = 'idle';
  testMessage.value = '';
}

function selectProvider(provider: string) {
  newProvider.value.provider = provider;
  newProvider.value.model = '';
  newProvider.value.baseUrl = '';

  // Auto-fill name
  const providerConfig = (builtInProviders.providers as any)[provider];
  if (providerConfig) {
    newProvider.value.name = providerConfig.name;
  }
}

function toggleDirectConfig() {
  directConfigMode.value = !directConfigMode.value;
  if (directConfigMode.value) {
    newProvider.value.provider = 'custom';
    newProvider.value.name = '';
  } else {
    newProvider.value.provider = 'deepseek';
  }
}

async function testConnection() {
  if (!newProvider.value.apiKey && newProvider.value.provider !== 'ollama') {
    testStatus.value = 'error';
    testMessage.value = 'Please enter an API key';
    return;
  }

  testStatus.value = 'testing';
  testMessage.value = 'Testing connection...';

  try {
    const config: LLMConfig = {
      provider: newProvider.value.provider as LLMConfig['provider'],
      model: newProvider.value.model || 'default',
      apiKey: newProvider.value.apiKey || undefined,
      baseUrl: newProvider.value.baseUrl || undefined,
    };

    const llm = new LLMConnector(config);
    await llm.generate([
      { role: 'user', content: 'Hi, please respond with "OK" if you receive this.' }
    ]);

    testStatus.value = 'success';
    testMessage.value = 'Connection successful!';
  } catch (error: any) {
    testStatus.value = 'error';
    testMessage.value = error?.message || 'Connection failed';
  }
}

async function saveProvider() {
  if (!newProvider.value.name) {
    alert('Please enter a name for this configuration');
    return;
  }

  if (!newProvider.value.model) {
    alert('Please select or enter a model');
    return;
  }

  // Check for duplicate name
  if (globalSettings.hasDuplicateName(newProvider.value.name, editingId.value)) {
    const confirmed = confirm(`Configuration "${newProvider.value.name}" already exists. Do you want to overwrite it?`);
    if (!confirmed) return;
  }

  const entry = {
    name: newProvider.value.name,
    provider: newProvider.value.provider as ProviderEntrySafe['provider'],
    model: newProvider.value.model,
    apiKey: newProvider.value.apiKey || undefined,
    baseUrl: newProvider.value.baseUrl || undefined,
    temperature: newProvider.value.temperature,
    maxTokens: newProvider.value.maxTokens,
    isDefault: false,
  };

  if (editingId.value) {
    await globalSettings.updateProvider(editingId.value, entry);
  } else {
    await globalSettings.addProvider(entry);
  }

  loadProviders();
  resetForm();
  emit('saved', editingId.value || '');
}

function editProvider(provider: ProviderEntrySafe) {
  editingId.value = provider.id;
  newProvider.value = {
    name: provider.name,
    provider: provider.provider,
    model: provider.model,
    apiKey: '', // Don't show existing API key
    baseUrl: provider.baseUrl || '',
    temperature: provider.temperature || 0.7,
    maxTokens: provider.maxTokens || 4096,
  };
}

async function deleteProvider(id: string) {
  if (confirm('Are you sure you want to delete this provider configuration?')) {
    await globalSettings.deleteProvider(id);
    loadProviders();
  }
}

async function setDefault(id: string) {
  await globalSettings.setDefault(id);
  loadProviders();
}

function closeModal() {
  emit('update:visible', false);
}
</script>

<template>
  <StratixModal
    :visible="visible"
    title="Provider Settings"
    size="lg"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="provider-settings">
      <!-- Add/Edit Provider Form -->
      <div class="provider-form">
        <h4 class="form-title">{{ editingId ? 'Edit Configuration' : 'Add New Configuration' }}</h4>

        <!-- Direct Config Mode Toggle -->
        <div class="direct-config-toggle">
          <label class="toggle-label">
            <input
              type="checkbox"
              v-model="directConfigMode"
              @change="toggleDirectConfig"
            />
            <span>Direct configuration (custom endpoint + API key + model)</span>
          </label>
        </div>

        <div class="form-row">
          <div class="form-field">
            <label class="field-label">Endpoint URL {{ directConfigMode ? '' : '(optional)' }}</label>
            <StratixInput
              v-model="newProvider.baseUrl"
              :placeholder="directConfigMode ? 'https://api.example.com/v1' : endpointPlaceholder"
            />
          </div>

          <div class="form-field">
            <label class="field-label">API Key {{ newProvider.provider === 'ollama' || directConfigMode ? '(optional)' : '' }}</label>
            <StratixInput
              v-model="newProvider.apiKey"
              type="password"
              :placeholder="newProvider.provider === 'ollama' ? 'Not required for Ollama' : 'Enter API key'"
            />
          </div>
        </div>

        <div class="form-row">
          <div class="form-field">
            <label class="field-label">Model {{ directConfigMode ? '(e.g., gpt-4o, claude-3-sonnet)' : '' }}</label>
            <template v-if="!directConfigMode">
              <StratixSelect
                v-model="newProvider.model"
                :options="modelOptions"
                placeholder="Select model"
              />
            </template>
            <template v-else>
              <StratixInput
                v-model="newProvider.model"
                placeholder="Enter model name"
              />
            </template>
          </div>

          <div class="form-field">
            <label class="field-label">Provider {{ directConfigMode ? '(auto)' : '(optional)' }}</label>
            <StratixSelect
              v-model="newProvider.provider"
              :options="providerOptions"
              placeholder="Select provider"
              :disabled="directConfigMode"
              @update:modelValue="selectProvider"
            />
          </div>
        </div>

        <div class="form-row">
          <div class="form-field">
            <label class="field-label">Configuration Name</label>
            <StratixInput
              v-model="newProvider.name"
              placeholder="e.g., My Custom Config"
            />
          </div>
        </div>

        <div class="form-row">
          <div class="form-field">
            <label class="field-label">Temperature: {{ newProvider.temperature }}</label>
            <input
              type="range"
              v-model.number="newProvider.temperature"
              min="0"
              max="1"
              step="0.1"
              class="range-input"
            />
          </div>

          <div class="form-field">
            <label class="field-label">Max Tokens: {{ newProvider.maxTokens }}</label>
            <StratixInput
              v-model.number="newProvider.maxTokens"
              type="number"
              placeholder="4096"
            />
          </div>
        </div>

        <div class="form-actions">
          <StratixButton
            variant="secondary"
            size="sm"
            :loading="testStatus === 'testing'"
            @click="testConnection"
          >
            <SvgIcon name="plug" class="btn-icon" />
            Test Connection
          </StratixButton>

          <StratixButton
            variant="primary"
            size="sm"
            @click="saveProvider"
          >
            {{ editingId ? 'Update' : 'Save' }}
          </StratixButton>

          <StratixButton
            v-if="editingId"
            variant="secondary"
            size="sm"
            @click="resetForm"
          >
            Cancel
          </StratixButton>
        </div>

        <!-- Test Result -->
        <div
          v-if="testStatus !== 'idle'"
          class="test-result"
          :class="[`test-result--${testStatus}`]"
        >
          {{ testMessage }}
        </div>
      </div>

      <!-- Saved Providers List -->
      <div class="saved-providers">
        <h4 class="list-title">Saved Configurations</h4>

        <div v-if="savedProviders.length === 0" class="empty-state">
          No saved configurations yet. Add one above.
        </div>

        <div
          v-for="provider in savedProviders"
          :key="provider.id"
          class="provider-item"
          :class="{ 'provider-item--default': provider.isDefault }"
        >
          <div class="provider-info">
            <div class="provider-header">
              <span class="provider-name">{{ provider.name }}</span>
              <span v-if="provider.isDefault" class="default-badge">Default</span>
            </div>
            <div class="provider-details">
              <span class="provider-type">
                {{ providerOptions.find(o => o.value === provider.provider)?.label || provider.provider }}
              </span>
              <span class="provider-model">{{ provider.model }}</span>
            </div>
            <div v-if="provider.baseUrl" class="provider-endpoint">
              {{ provider.baseUrl }}
            </div>
          </div>

          <div class="provider-actions">
            <StratixButton
              v-if="!provider.isDefault"
              variant="ghost"
              size="sm"
              @click="setDefault(provider.id)"
            >
              Set Default
            </StratixButton>
            <StratixButton
              variant="ghost"
              size="sm"
              @click="editProvider(provider)"
            >
              <SvgIcon name="edit-2" class="btn-icon" />
            </StratixButton>
            <StratixButton
              variant="ghost"
              size="sm"
              @click="deleteProvider(provider.id)"
            >
              <SvgIcon name="trash-2" class="btn-icon" />
            </StratixButton>
          </div>
        </div>
      </div>
    </div>
  </StratixModal>
</template>

<style scoped>
.provider-settings {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.provider-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  background: var(--ds-bg-tertiary);
  border-radius: 8px;
}

.form-title,
.list-title {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--ds-text-primary);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.direct-config-toggle {
  margin-bottom: 8px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ds-text-secondary);
  cursor: pointer;
}

.toggle-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--ds-text-secondary);
}

.range-input {
  width: 100%;
  height: 32px;
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border-default);
  border-radius: 4px;
  padding: 0 8px;
  cursor: pointer;
}

.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}

.btn-icon {
  width: 14px;
  height: 14px;
  margin-right: 4px;
}

.test-result {
  padding: 10px 12px;
  border-radius: 4px;
  font-size: 12px;
  margin-top: 8px;
}

.test-result--success {
  background: rgba(34, 197, 94, 0.1);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.test-result--error {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.saved-providers {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty-state {
  padding: 24px;
  text-align: center;
  color: var(--ds-text-muted);
  font-size: 13px;
}

.provider-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 8px;
  transition: border-color 0.15s ease;
}

.provider-item:hover {
  border-color: var(--ds-border-strong);
}

.provider-item--default {
  border-color: var(--ds-primary);
  background: rgba(59, 130, 246, 0.05);
}

.provider-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.provider-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.provider-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ds-text-primary);
}

.default-badge {
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--ds-primary);
  background: rgba(59, 130, 246, 0.1);
  border-radius: 4px;
}

.provider-details {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--ds-text-muted);
}

.provider-type {
  display: flex;
  align-items: center;
  gap: 4px;
}

.provider-model {
  color: var(--ds-text-secondary);
}

.provider-endpoint {
  font-size: 11px;
  color: var(--ds-text-muted);
  font-family: monospace;
}

.provider-actions {
  display: flex;
  gap: 4px;
}
</style>
