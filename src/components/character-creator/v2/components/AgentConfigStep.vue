<script setup lang="ts">
/**
 * AgentConfigStep.vue - Agent 配置步骤组件
 *
 * 整合后端选择和 Agent 设置
 * 包含 BackendSelector 和 SoulEditor
 *
 * emit: change(config)
 */

import { ref, computed, watch } from 'vue';
import BackendSelector from './BackendSelector.vue';
import SoulEditor from './SoulEditor.vue';
import type { StratixSoulConfig } from '@/stratix-core/stratix-protocol';
import type { OpenClawConfigLocal } from './BackendSelector.vue';

export interface AgentConfig {
  backendType: 'openclaw' | 'stratix';
  openClawConfig?: OpenClawConfigLocal;
  stratixConfig?: any;
  soul?: StratixSoulConfig;
  rules?: string[];
}

const props = defineProps<{
  modelValue?: AgentConfig;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: AgentConfig];
  change: [value: AgentConfig];
}>();

// 内部状态
const currentConfig = ref<AgentConfig>({
  backendType: props.modelValue?.backendType ?? 'stratix',
  openClawConfig: props.modelValue?.openClawConfig,
  stratixConfig: props.modelValue?.stratixConfig,
  soul: props.modelValue?.soul,
  rules: props.modelValue?.rules ?? [],
});

// 当前激活的标签页
const activeTab = ref<'connection' | 'soul' | 'rules'>('connection');

// 规则列表
const rules = ref<string[]>(props.modelValue?.rules ?? []);
const newRuleInput = ref('');

// 规则模板
const ruleTemplates = [
  { name: '安全规则', rules: ['禁止执行危险操作', '需要确认才能执行不可逆操作'] },
  { name: '效率规则', rules: ['优先使用缓存', '批量操作替代循环'] },
  { name: '质量规则', rules: ['代码需要测试', '文档必须更新'] },
];

// 监听 props 变化
watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    currentConfig.value = {
      backendType: newVal.backendType ?? 'stratix',
      openClawConfig: newVal.openClawConfig,
      stratixConfig: newVal.stratixConfig,
      soul: newVal.soul,
      rules: newVal.rules ?? [],
    };
    rules.value = newVal.rules ?? [];
  }
}, { immediate: true });

// 发出更新
function emitUpdate(): void {
  emit('update:modelValue', { ...currentConfig.value });
  emit('change', { ...currentConfig.value });
}

// 后端配置变化
function onBackendChange(backendType: 'openclaw' | 'stratix', config: any): void {
  currentConfig.value.backendType = backendType;
  if (backendType === 'openclaw') {
    currentConfig.value.openClawConfig = config as OpenClawConfigLocal;
  } else {
    currentConfig.value.stratixConfig = config;
  }
  emitUpdate();
}

// Soul 变化
function onSoulChange(soul: StratixSoulConfig): void {
  currentConfig.value.soul = soul;
  emitUpdate();
}

// 添加规则
function addRule(): void {
  const rule = newRuleInput.value.trim();
  if (rule && !rules.value.includes(rule)) {
    rules.value.push(rule);
    currentConfig.value.rules = [...rules.value];
    newRuleInput.value = '';
    emitUpdate();
  }
}

// 移除规则
function removeRule(index: number): void {
  rules.value.splice(index, 1);
  currentConfig.value.rules = [...rules.value];
  emitUpdate();
}

// 应用规则模板
function applyRuleTemplate(template: { name: string; rules: string[] }): void {
  for (const rule of template.rules) {
    if (!rules.value.includes(rule)) {
      rules.value.push(rule);
    }
  }
  currentConfig.value.rules = [...rules.value];
  emitUpdate();
}

// 清除所有规则
function clearAllRules(): void {
  rules.value = [];
  currentConfig.value.rules = [];
  emitUpdate();
}

// 验证配置
function validate(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (currentConfig.value.backendType === 'openclaw') {
    if (!currentConfig.value.openClawConfig?.endpoint) {
      errors.push('OpenClaw Endpoint 不能为空');
    }
    if (!currentConfig.value.openClawConfig?.accountId) {
      errors.push('OpenClaw Account ID 不能为空');
    }
  } else {
    if (!currentConfig.value.stratixConfig?.model) {
      errors.push('请选择模型');
    }
    if (!currentConfig.value.stratixConfig?.apiKey && currentConfig.value.stratixConfig?.provider !== 'ollama') {
      errors.push('API Key 不能为空');
    }
  }

  return { valid: errors.length === 0, errors };
}

// 暴露方法
defineExpose({
  validate,
});
</script>

<template>
  <div class="agent-config-step">
    <!-- 标签页 -->
    <div class="config-tabs">
      <button
        class="config-tab"
        :class="{ 'config-tab--active': activeTab === 'connection' }"
        @click="activeTab = 'connection'"
      >
        连接
      </button>
      <button
        class="config-tab"
        :class="{ 'config-tab--active': activeTab === 'soul' }"
        @click="activeTab = 'soul'"
      >
        身份
      </button>
      <button
        class="config-tab"
        :class="{ 'config-tab--active': activeTab === 'rules' }"
        @click="activeTab = 'rules'"
      >
        规则 <span v-if="rules.length > 0" class="tab-badge">{{ rules.length }}</span>
      </button>
    </div>

    <!-- 内容区域 -->
    <div class="config-content">
      <!-- 连接配置 -->
      <div v-show="activeTab === 'connection'" class="config-panel">
        <BackendSelector
          :model-value="{
            backendType: currentConfig.backendType,
            openClawConfig: currentConfig.openClawConfig,
            stratixConfig: currentConfig.stratixConfig,
          }"
          @change="onBackendChange"
        />
      </div>

      <!-- Soul 配置 -->
      <div v-show="activeTab === 'soul'" class="config-panel">
        <SoulEditor
          :model-value="currentConfig.soul"
          @change="onSoulChange"
        />
      </div>

      <!-- 规则配置 -->
      <div v-show="activeTab === 'rules'" class="config-panel">
        <div class="rules-panel">
          <!-- 规则模板 -->
          <div class="rules-templates">
            <div class="section-label">快速添加</div>
            <div class="template-buttons">
              <button
                v-for="template in ruleTemplates"
                :key="template.name"
                class="template-btn"
                @click="applyRuleTemplate(template)"
              >
                {{ template.name }}
              </button>
            </div>
          </div>

          <!-- 当前规则 -->
          <div class="rules-list">
            <div class="section-label">
              当前规则 <span class="rules-count">({{ rules.length }}条)</span>
            </div>
            <div class="rules-items">
              <div
                v-for="(rule, index) in rules"
                :key="index"
                class="rule-item"
              >
                <span class="rule-number">{{ index + 1 }}.</span>
                <span class="rule-text">{{ rule }}</span>
                <button class="rule-remove" @click="removeRule(index)">✕</button>
              </div>
              <div v-if="rules.length === 0" class="rules-empty">
                暂无规则，请添加或从模板选择
              </div>
            </div>
          </div>

          <!-- 添加规则 -->
          <div class="rules-add">
            <input
              v-model="newRuleInput"
              type="text"
              class="rule-input"
              placeholder="输入新规则..."
              @keyup.enter="addRule"
            />
            <button class="add-btn" @click="addRule">添加</button>
          </div>

          <!-- 清除 -->
          <div class="rules-footer">
            <button
              v-if="rules.length > 0"
              class="clear-btn"
              @click="clearAllRules"
            >
              清空所有规则
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-config-step {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  overflow: hidden;
  font-family: var(--ds-font-mono);
}

.config-tabs {
  display: flex;
  border-bottom: 1px solid var(--ds-border);
  background: var(--ds-bg-base);
}

.config-tab {
  flex: 1;
  padding: var(--ds-spacing-md) var(--ds-spacing-md);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-sm);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.config-tab:hover {
  color: var(--ds-text-secondary);
  background: var(--ds-bg-tertiary);
}

.config-tab--active {
  color: var(--ds-color-primary);
  border-bottom-color: var(--ds-color-primary);
}

.tab-badge {
  font-size: var(--ds-font-size-xs);
  padding: 2px var(--ds-spacing-xs);
  background: var(--ds-color-primary);
  color: var(--ds-text-inverse);
  border-radius: var(--ds-radius-lg);
}

.config-content {
  flex: 1;
  overflow: hidden;
}

.config-panel {
  height: 100%;
  overflow-y: auto;
}

.rules-panel {
  padding: var(--ds-spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-md);
}

.section-label {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.rules-count {
  font-size: var(--ds-font-size-xs);
  font-weight: normal;
  color: var(--ds-text-muted);
  text-transform: none;
}

.rules-templates {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ds-border);
}

.template-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-spacing-sm);
}

.template-btn {
  padding: 6px 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-sm);
  color: var(--ds-text-secondary);
  font-size: var(--ds-font-size-xs);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
}

.template-btn:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

.rules-list {
  flex: 1;
}

.rules-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rule-item {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  padding: 10px var(--ds-spacing-md);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
}

.rule-number {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-color-primary);
  font-weight: 600;
  min-width: 20px;
}

.rule-text {
  flex: 1;
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-primary);
  line-height: 1.4;
}

.rule-remove {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-sm);
  cursor: pointer;
  border-radius: var(--ds-radius-sm);
  transition: all var(--ds-animation-duration-fast) ease;
}

.rule-remove:hover {
  background: var(--ds-status-danger);
  color: var(--ds-text-inverse);
}

.rules-empty {
  text-align: center;
  padding: var(--ds-spacing-lg);
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-sm);
}

.rules-add {
  display: flex;
  gap: var(--ds-spacing-sm);
}

.rule-input {
  flex: 1;
  padding: 10px var(--ds-spacing-md);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-sm);
  font-family: inherit;
}

.rule-input:focus {
  outline: none;
  border-color: var(--ds-color-primary);
}

.rule-input::placeholder {
  color: var(--ds-text-muted);
}

.add-btn {
  padding: 10px var(--ds-spacing-md);
  background: var(--ds-color-primary);
  border: none;
  border-radius: var(--ds-radius-md);
  color: var(--ds-text-inverse);
  font-size: var(--ds-font-size-sm);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
}

.add-btn:hover {
  filter: brightness(1.1);
}

.rules-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}

.clear-btn {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--ds-status-danger);
  border-radius: var(--ds-radius-sm);
  color: var(--ds-status-danger);
  font-size: var(--ds-font-size-xs);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
}

.clear-btn:hover {
  background: var(--ds-status-danger);
  color: var(--ds-text-inverse);
}

/* 滚动条样式 */
.config-panel::-webkit-scrollbar {
  width: 6px;
}

.config-panel::-webkit-scrollbar-track {
  background: var(--ds-bg-base);
}

.config-panel::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: var(--ds-radius-sm);
}

.config-panel::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary);
}
</style>
