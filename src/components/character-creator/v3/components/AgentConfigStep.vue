<script setup lang="ts">
/**
 * AgentConfigStep.vue - Agent 配置步骤组件 (V3)
 *
 * 整合 BackendSelector + SoulEditor + RulesEditor + SkillTreePanel
 *
 * Props:
 *   modelValue?: AgentConfig
 *
 * Emits:
 *   'update:modelValue': [value: AgentConfig]
 *   change: [value: AgentConfig]
 */

import { ref, computed, watch, shallowRef } from 'vue';
import BackendSelector from './BackendSelector.vue';
import SoulEditor from './SoulEditor.vue';
import RulesEditor from './RulesEditor.vue';
import SkillTreePanel from './SkillTreePanel.vue';
import { SkillTree } from '@/stratix-character-creator/core/SkillTree';
import { SKILL_TREE_CONFIG } from '@/stratix-character-creator/config/skillTreeConfig';
import type { StratixDirectConfig } from '@/stratix-core/stratix-protocol';
import type { OpenClawConfigLocal } from '@/stratix-character-creator/types';
import type { AgentBackendType, DirectConfig } from './BackendSelector.vue';
import type { SkillTreeState } from '@/stratix-character-creator/types';

// =============================================================================
// Types
// =============================================================================

export interface AgentConfig {
  backendType: AgentBackendType;
  openClawConfig?: OpenClawConfigLocal;
  stratixConfig?: StratixDirectConfig;
  directConfig?: DirectConfig;
  soul?: SoulValue;
  rules?: string[];
  skillTreeState?: SkillTreeState;
}

type SoulValue = { identity: string; goals: string[]; personality: string };

// =============================================================================
// Props / Emits
// =============================================================================

const props = defineProps<{
  modelValue?: AgentConfig;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: AgentConfig];
  change: [value: AgentConfig];
}>();

// =============================================================================
// Tab State
// =============================================================================

type TabKey = 'connection' | 'soul' | 'rules' | 'skills';
const activeTab = ref<TabKey>('connection');

// =============================================================================
// Backend Config State
// =============================================================================

const backendConfig = ref<{
  backendType: AgentBackendType;
  openClawConfig?: OpenClawConfigLocal;
  stratixConfig?: StratixDirectConfig;
  directConfig?: DirectConfig;
}>({
  backendType: props.modelValue?.backendType ?? 'stratix',
  openClawConfig: props.modelValue?.openClawConfig,
  stratixConfig: props.modelValue?.stratixConfig,
  directConfig: props.modelValue?.directConfig,
});

// =============================================================================
// Soul State
// =============================================================================

const soulValue = ref<SoulValue>({
  identity: props.modelValue?.soul?.identity ?? '',
  goals: props.modelValue?.soul?.goals ?? [],
  personality: props.modelValue?.soul?.personality ?? '',
});

// =============================================================================
// Rules State
// =============================================================================

const rulesValue = ref<string[]>(props.modelValue?.rules ?? []);

// =============================================================================
// SkillTree State
// =============================================================================

// Create SkillTree instance
const skillTree = shallowRef(new SkillTree(SKILL_TREE_CONFIG));

// Initialize from modelValue
if (props.modelValue?.skillTreeState) {
  skillTree.value.setState(props.modelValue.skillTreeState);
}

// Computed skillTreeState for emitting
const skillTreeState = computed<SkillTreeState>(() => skillTree.value.getState());

// Track skillTree key for forcing re-creation when modelValue changes
const skillTreeKey = ref(0);

// =============================================================================
// Full Config Computation
// =============================================================================

const currentConfig = computed<AgentConfig>(() => ({
  backendType: backendConfig.value.backendType,
  openClawConfig: backendConfig.value.backendType === 'openclaw' ? backendConfig.value.openClawConfig : undefined,
  stratixConfig: backendConfig.value.backendType === 'stratix' ? backendConfig.value.stratixConfig : undefined,
  directConfig: backendConfig.value.backendType === 'direct' ? backendConfig.value.directConfig : undefined,
  soul: { ...soulValue.value },
  rules: [...rulesValue.value],
  skillTreeState: skillTreeState.value,
}));

// =============================================================================
// Watchers
// =============================================================================

watch(() => props.modelValue, (newVal) => {
  if (!newVal) return;

  backendConfig.value = {
    backendType: newVal.backendType ?? 'stratix',
    openClawConfig: newVal.openClawConfig,
    stratixConfig: newVal.stratixConfig,
    directConfig: newVal.directConfig,
  };

  soulValue.value = {
    identity: newVal.soul?.identity ?? '',
    goals: newVal.soul?.goals ? [...newVal.soul.goals] : [],
    personality: newVal.soul?.personality ?? '',
  };

  rulesValue.value = newVal.rules ? [...newVal.rules] : [];

  // Recreate SkillTree if state changed
  if (newVal.skillTreeState) {
    skillTree.value = new SkillTree(SKILL_TREE_CONFIG);
    skillTree.value.setState(newVal.skillTreeState);
    skillTreeKey.value++;
  }
}, { immediate: true, deep: true });

// =============================================================================
// Emit Helpers
// =============================================================================

function emitUpdate(): void {
  const config = currentConfig.value;
  emit('update:modelValue', { ...config });
  emit('change', { ...config });
}

// =============================================================================
// Backend Handler
// =============================================================================

function handleBackendChange(config: typeof backendConfig.value): void {
  backendConfig.value = { ...config };
  emitUpdate();
}

// =============================================================================
// Soul Handler
// =============================================================================

function handleSoulChange(soul: SoulValue): void {
  soulValue.value = { ...soul };
  emitUpdate();
}

// =============================================================================
// Rules Handler
// =============================================================================

function handleRulesChange(rules: string[]): void {
  rulesValue.value = [...rules];
  emitUpdate();
}

// =============================================================================
// SkillTree Handlers
// =============================================================================

function handleSkillTreeSelectNode(_nodeId: string): void {
  emitUpdate();
}

function handleSkillTreeDeselectNode(_nodeId: string): void {
  emitUpdate();
}

function handleSkillTreeReset(): void {
  emitUpdate();
}

// =============================================================================
// Validation
// =============================================================================

function validate(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Backend validation
  if (backendConfig.value.backendType === 'openclaw') {
    if (!backendConfig.value.openClawConfig?.endpoint) {
      errors.push('OpenClaw Endpoint 不能为空');
    }
    if (!backendConfig.value.openClawConfig?.accountId) {
      errors.push('OpenClaw Account ID 不能为空');
    }
  } else if (backendConfig.value.backendType === 'stratix') {
    if (!backendConfig.value.stratixConfig?.model) {
      errors.push('请选择模型');
    }
    if (!backendConfig.value.stratixConfig?.apiKey && backendConfig.value.stratixConfig?.provider !== 'ollama') {
      errors.push('API Key 不能为空');
    }
  } else {
    // Direct
    if (!backendConfig.value.directConfig?.model) {
      errors.push('请选择模型');
    }
    if (!backendConfig.value.directConfig?.apiKey && backendConfig.value.directConfig?.provider !== 'ollama') {
      errors.push('API Key 不能为空');
    }
  }

  // Soul validation
  if (!soulValue.value.identity.trim()) {
    errors.push('身份描述不能为空');
  }
  if (soulValue.value.goals.length === 0) {
    errors.push('至少需要添加一个目标');
  }

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// Expose
// =============================================================================

defineExpose({
  validate,
});
</script>

<template>
  <div class="agent-config-step">
    <!-- Tab Navigation -->
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
        规则
        <span v-if="rulesValue.length > 0" class="tab-badge">{{ rulesValue.length }}</span>
      </button>
      <button
        class="config-tab"
        :class="{ 'config-tab--active': activeTab === 'skills' }"
        @click="activeTab = 'skills'"
      >
        技能
        <span v-if="skillTreeState.selectedNodes.length > 0" class="tab-badge">{{ skillTreeState.selectedNodes.length }}</span>
      </button>
    </div>

    <!-- Tab Content -->
    <div class="config-content">
      <!-- Connection Tab -->
      <div v-show="activeTab === 'connection'" class="config-panel">
        <BackendSelector
          :model-value="backendConfig"
          @change="handleBackendChange"
        />
      </div>

      <!-- Soul Tab -->
      <div v-show="activeTab === 'soul'" class="config-panel">
        <SoulEditor
          :model-value="soulValue"
          @change="handleSoulChange"
        />
      </div>

      <!-- Rules Tab -->
      <div v-show="activeTab === 'rules'" class="config-panel">
        <RulesEditor
          :model-value="rulesValue"
          @update:model-value="handleRulesChange"
        />
      </div>

      <!-- Skills Tab -->
      <div v-show="activeTab === 'skills'" class="config-panel">
        <SkillTreePanel
          :key="skillTreeKey"
          :skill-tree="skillTree"
          @select-node="handleSkillTreeSelectNode"
          @deselect-node="handleSkillTreeDeselectNode"
          @reset="handleSkillTreeReset"
        />
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
  border-radius: 8px;
  overflow: hidden;
  font-family: 'SF Mono', 'Monaco', monospace;
}

.config-tabs {
  display: flex;
  border-bottom: 1px solid var(--ds-border);
  background: var(--ds-bg-base);
}

.config-tab {
  flex: 1;
  padding: 12px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--ds-text-muted);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
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
  font-size: 10px;
  padding: 2px 6px;
  background: var(--ds-color-primary);
  color: var(--ds-text-inverse);
  border-radius: 10px;
}

.config-content {
  flex: 1;
  overflow: hidden;
}

.config-panel {
  height: 100%;
  overflow-y: auto;
}

/* Scrollbar styles */
.config-panel::-webkit-scrollbar {
  width: 6px;
}

.config-panel::-webkit-scrollbar-track {
  background: var(--ds-bg-base);
}

.config-panel::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: 3px;
}

.config-panel::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary);
}
</style>
