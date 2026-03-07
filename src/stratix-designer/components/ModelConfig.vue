<script setup lang="ts">
import { SvgIcon } from '@/components/ui';
import { computed } from 'vue';
import { StratixModelConfig } from '@/stratix-core/stratix-protocol';
import { getToken } from '@/design-system/config';
const props = defineProps<{ modelValue: StratixModelConfig }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: StratixModelConfig): void }>();

const modelName = computed({
  get: () => props.modelValue.name,
  set: (value) => emit('update:modelValue', { ...props.modelValue, name: value }),
});

const updateParam = (key: string, value: number) => {
  emit('update:modelValue', {
    ...props.modelValue,
    params: { ...props.modelValue.params, [key]: value },
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
      <svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <SvgIcon name="cpu" size="16" />
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
        <svg class="params-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <SvgIcon name="sliders-horizontal" size="16" />
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
.model-config {
  font-family: v-bind('getToken("typography.fontFamily.sans")');
  padding: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid v-bind('getToken("colors.border.default")');
}

.section-icon {
  width: 20px;
  height: 20px;
  color: v-bind('getToken("colors.info")');
}

.section-title {
  font-family: v-bind('getToken("typography.fontFamily.mono")');
  font-size: 14px;
  font-weight: 600;
  color: v-bind('getToken("colors.text.primary")');
}

.form-group {
  margin-bottom: 20px;
}

.label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: v-bind('getToken("colors.text.secondary")');
  margin-bottom: 8px;
}

.label-required::after {
  content: '*';
  color: v-bind('getToken("colors.semantic.danger")');
  margin-left: 4px;
}

.model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.model-group-label {
  grid-column: 1 / -1;
  font-size: 12px;
  font-weight: 600;
  color: v-bind('getToken("colors.text.muted")');
  margin-top: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.model-option {
  padding: 12px;
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.model-option:hover {
  background: v-bind('getToken("colors.background.primary")');
  border-color: v-bind('getToken("colors.border.strong")');
}

.model-option.selected {
  background: v-bind('getToken("colors.info") + "1A"');
  border-color: v-bind('getToken("colors.info")');
}

.model-option-name {
  font-size: 14px;
  font-weight: 600;
  color: v-bind('getToken("colors.text.primary")');
  margin-bottom: 4px;
}

.model-option-desc {
  font-size: 12px;
  color: v-bind('getToken("colors.text.muted")');
}

.divider {
  height: 1px;
  background: v-bind('getToken("colors.border.default")');
  margin: 24px 0;
}

.params-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.params-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.params-icon {
  width: 20px;
  height: 20px;
  color: v-bind('getToken("colors.warning")');
}

.params-title {
  font-family: v-bind('getToken("typography.fontFamily.mono")');
  font-size: 14px;
  font-weight: 600;
  color: v-bind('getToken("colors.text.primary")');
}

.param-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.param-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.param-label {
  font-size: 13px;
  font-weight: 500;
  color: v-bind('getToken("colors.text.secondary")');
}

.param-value {
  font-size: 13px;
  font-weight: 600;
  color: v-bind('getToken("colors.info")');
  font-family: v-bind('getToken("typography.fontFamily.mono")');
}

.slider {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: v-bind('getToken("colors.background.tertiary")');
  outline: none;
  -webkit-appearance: none;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: v-bind('getToken("colors.info")');
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.param-hints {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: v-bind('getToken("colors.text.muted")');
}

.tokens-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.input-field {
  flex: 1;
  padding: 8px 12px;
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: 6px;
  color: v-bind('getToken("colors.text.primary")');
  font-size: 14px;
  outline: none;
}

.input-field:focus {
  border-color: v-bind('getToken("colors.info")');
}

.tokens-unit {
  font-size: 13px;
  color: v-bind('getToken("colors.text.muted")');
  white-space: nowrap;
}
</style>
