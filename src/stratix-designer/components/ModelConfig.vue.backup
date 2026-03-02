<script setup lang="ts">
import { computed } from 'vue';
import { StratixModelConfig } from '@/stratix-core/stratix-protocol';

const props = defineProps<{
  modelValue: StratixModelConfig;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: StratixModelConfig): void;
}>();

const modelName = computed({
  get: () => props.modelValue.name,
  set: (value) => emit('update:modelValue', { ...props.modelValue, name: value }),
});

const updateParam = (key: string, value: number) => {
  emit('update:modelValue', {
    ...props.modelValue,
    params: {
      ...props.modelValue.params,
      [key]: value,
    },
  });
};

const temperature = computed({
  get: () => props.modelValue.params?.temperature ?? 0.7,
  set: (value) => updateParam('temperature', value),
});

const topP = computed({
  get: () => props.modelValue.params?.topP ?? 0.9,
  set: (value) => updateParam('topP', value),
});

const maxTokens = computed({
  get: () => props.modelValue.params?.maxTokens ?? 4096,
  set: (value) => updateParam('maxTokens', value),
});

const modelOptions = [
  { group: 'Claude', options: [
    { value: 'claude-3-opus', label: 'Claude 3 Opus', desc: '最强能力' },
    { value: 'claude-3-sonnet', label: 'Claude 3 Sonnet', desc: '平衡性能' },
    { value: 'claude-3-haiku', label: 'Claude 3 Haiku', desc: '快速响应' },
  ]},
  { group: 'GPT', options: [
    { value: 'gpt-4o', label: 'GPT-4o', desc: '最新版本' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo', desc: '快速版' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', desc: '经济版' },
  ]},
];
</script>

<template>
  <div class="model-config">
    <div class="section-header">
      <svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
      </svg>
      <span class="section-title">模型配置 Model</span>
    </div>

    <div class="form-group">
      <label class="label label-required">选择模型</label>
      <div class="model-grid">
        <template v-for="group in modelOptions" :key="group.group">
          <div class="model-group-label">{{ group.group }}</div>
          <button
            v-for="opt in group.options"
            :key="opt.value"
            :class="['model-option', { selected: modelName === opt.value }]"
            @click="modelName = opt.value"
          >
            <div class="model-option-name">{{ opt.label }}</div>
            <div class="model-option-desc">{{ opt.desc }}</div>
          </button>
        </template>
      </div>
    </div>

    <div class="divider"></div>

    <div class="params-section">
      <div class="params-header">
        <svg class="params-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/>
        </svg>
        <span class="params-title">模型参数</span>
      </div>

      <div class="param-item">
        <div class="param-header">
          <label class="param-label">Temperature</label>
          <span class="param-value">{{ temperature.toFixed(1) }}</span>
        </div>
        <input
          type="range"
          v-model.number="temperature"
          min="0"
          max="2"
          step="0.1"
          class="slider"
        />
        <div class="param-hints">
          <span>确定性</span>
          <span>创造性</span>
        </div>
      </div>

      <div class="param-item">
        <div class="param-header">
          <label class="param-label">Top P</label>
          <span class="param-value">{{ topP.toFixed(1) }}</span>
        </div>
        <input
          type="range"
          v-model.number="topP"
          min="0"
          max="1"
          step="0.1"
          class="slider"
        />
        <div class="param-hints">
          <span>保守</span>
          <span>多样</span>
        </div>
      </div>

      <div class="param-item">
        <div class="param-header">
          <label class="param-label">最大 Tokens</label>
          <span class="param-value">{{ maxTokens.toLocaleString() }}</span>
        </div>
        <div class="tokens-input-row">
          <input
            type="number"
            v-model.number="maxTokens"
            min="100"
            max="128000"
            step="100"
            class="input-field"
          />
          <span class="tokens-unit">tokens</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap');

.model-config {
  font-family: 'Fira Sans', sans-serif;
  padding: 20px;
  animation: fadeIn 200ms ease;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid #1E293B;
}

.section-icon {
  width: 20px;
  height: 20px;
  color: #22C55E;
}

.section-title {
  font-family: 'Fira Code', monospace;
  font-size: 14px;
  font-weight: 600;
  color: #F8FAFC;
}

.form-group {
  margin-bottom: 20px;
}

.label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #94A3B8;
  margin-bottom: 10px;
}

.label-required::after {
  content: ' *';
  color: #EF4444;
}

.model-grid {
  display: grid;
  grid-template-columns: auto repeat(3, 1fr);
  gap: 8px;
}

.model-group-label {
  grid-column: 1 / -1;
  font-size: 11px;
  font-weight: 600;
  color: #64748B;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding-top: 8px;
}

.model-group-label:first-child {
  padding-top: 0;
}

.model-option {
  padding: 12px;
  background: #0F172A;
  border: 1px solid #1E293B;
  border-radius: 8px;
  cursor: pointer;
  transition: all 200ms ease;
  text-align: left;
}

.model-option:hover {
  background: #1E293B;
  border-color: #334155;
}

.model-option.selected {
  border-color: #22C55E;
  background: rgba(34, 197, 94, 0.1);
}

.model-option-name {
  font-size: 13px;
  font-weight: 600;
  color: #F8FAFC;
  margin-bottom: 4px;
}

.model-option-desc {
  font-size: 11px;
  color: #64748B;
}

.divider {
  height: 1px;
  background: #1E293B;
  margin: 20px 0;
}

.params-section {
  background: #0F172A;
  border: 1px solid #1E293B;
  border-radius: 8px;
  padding: 16px;
}

.params-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.params-icon {
  width: 16px;
  height: 16px;
  color: #64748B;
}

.params-title {
  font-size: 13px;
  font-weight: 600;
  color: #F8FAFC;
}

.param-item {
  margin-bottom: 20px;
}

.param-item:last-child {
  margin-bottom: 0;
}

.param-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.param-label {
  font-size: 13px;
  color: #94A3B8;
}

.param-value {
  font-family: 'Fira Code', monospace;
  font-size: 13px;
  font-weight: 600;
  color: #22C55E;
  background: rgba(34, 197, 94, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}

.slider {
  width: 100%;
  height: 6px;
  background: #1E293B;
  border-radius: 3px;
  appearance: none;
  cursor: pointer;
}

.slider::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  background: #22C55E;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 200ms ease;
}

.slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: #22C55E;
  border: none;
  border-radius: 50%;
  cursor: pointer;
}

.param-hints {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 11px;
  color: #475569;
}

.tokens-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.input-field {
  width: 150px;
  padding: 8px 12px;
  background: #020617;
  border: 1px solid #1E293B;
  border-radius: 6px;
  color: #F8FAFC;
  font-size: 14px;
  font-family: 'Fira Code', monospace;
}

.input-field:focus {
  outline: none;
  border-color: #22C55E;
}

.tokens-unit {
  font-size: 12px;
  color: #64748B;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .model-config { animation: none; }
}

@media (max-width: 600px) {
  .model-grid {
    grid-template-columns: 1fr;
  }
  
  .model-group-label {
    grid-column: 1;
  }
}
</style>
