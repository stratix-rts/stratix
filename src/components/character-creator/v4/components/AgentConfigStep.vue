<script setup lang="ts">
/**
 * AgentConfigStep.vue — Agent 配置容器 (V4)
 *
 * 整合 BackendSelector + SoulEditor + RulesEditor + SkillTreePanel。
 * 使用 Tab 导航切换四个子面板，通过 modelValue / change 双向绑定。
 *
 * Props:
 *   modelValue?: AgentConfig
 *
 * Emits:
 *   update:modelValue: [value: AgentConfig]
 *   change: [value: AgentConfig]
 *
 * 美学约束: A1-A8，全部使用 var(--ds-*) tokens
 */

import { ref, computed, watch, shallowRef } from 'vue';
import BackendSelector from './BackendSelector.vue';
import SoulEditor from './SoulEditor.vue';
import RulesEditor from './RulesEditor.vue';
import SkillTreePanel from './SkillTreePanel.vue';
import { SkillTree } from '@/stratix-character-creator/core/SkillTree';
import { SKILL_TREE_CONFIG } from '@/stratix-character-creator/config/skillTreeConfig';
import type { StratixDirectConfig } from '@/stratix-core/stratix-protocol';
import type { OpenClawConfigLocal, SkillTreeState } from '@/stratix-character-creator/types';
import type { AgentBackendType, DirectConfig } from './BackendSelector.vue';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Props / Emits
// ============================================================================

const props = defineProps<{
  modelValue?: AgentConfig;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: AgentConfig];
  change: [value: AgentConfig];
}>();

// ============================================================================
// Tab State
// ============================================================================

type TabKey = 'connection' | 'soul' | 'rules' | 'skills';

const activeTab = ref<TabKey>('connection');

const tabs: { key: TabKey; icon: string; label: string }[] = [
  { key: 'connection', icon: '⚡', label: '连接' },
  { key: 'soul', icon: '🧠', label: '身份' },
  { key: 'rules', icon: '📋', label: '规则' },
  { key: 'skills', icon: '🌳', label: '技能' },
];

// ============================================================================
// Backend Config State
// ============================================================================

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

// ============================================================================
// Soul State
// ============================================================================

const soulValue = ref<SoulValue>({
  identity: props.modelValue?.soul?.identity ?? '',
  goals: props.modelValue?.soul?.goals ?? [],
  personality: props.modelValue?.soul?.personality ?? '',
});

// ============================================================================
// Rules State
// ============================================================================

const rulesValue = ref<string[]>(props.modelValue?.rules ? [...props.modelValue.rules] : []);

// ============================================================================
// SkillTree State
// ============================================================================

const skillTree = shallowRef(new SkillTree(SKILL_TREE_CONFIG));

if (props.modelValue?.skillTreeState) {
  skillTree.value.setState(props.modelValue.skillTreeState);
}

const skillTreeState = computed<SkillTreeState>(() => skillTree.value.getState());

/** 用于强制重创 SkillTree 实例 */
const skillTreeKey = ref(0);

// ============================================================================
// Full Config Computation
// ============================================================================

const currentConfig = computed<AgentConfig>(() => ({
  backendType: backendConfig.value.backendType,
  openClawConfig: backendConfig.value.backendType === 'openclaw'
    ? backendConfig.value.openClawConfig
    : undefined,
  stratixConfig: backendConfig.value.backendType === 'stratix'
    ? backendConfig.value.stratixConfig
    : undefined,
  directConfig: backendConfig.value.backendType === 'direct'
    ? backendConfig.value.directConfig
    : undefined,
  soul: { ...soulValue.value },
  rules: [...rulesValue.value],
  skillTreeState: skillTreeState.value,
}));

// ============================================================================
// Watchers — 外部 modelValue 变化时同步本地状态
// ============================================================================

watch(
  () => props.modelValue,
  (newVal) => {
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

    if (newVal.skillTreeState) {
      skillTree.value = new SkillTree(SKILL_TREE_CONFIG);
      skillTree.value.setState(newVal.skillTreeState);
      skillTreeKey.value++;
    }
  },
  { immediate: true, deep: true },
);

// ============================================================================
// Emit Helper
// ============================================================================

function emitUpdate(): void {
  const config = currentConfig.value;
  emit('update:modelValue', { ...config });
  emit('change', { ...config });
}

// ============================================================================
// Child Component Handlers
// ============================================================================

function handleBackendChange(config: typeof backendConfig.value): void {
  backendConfig.value = { ...config };
  emitUpdate();
}

function handleSoulChange(soul: SoulValue): void {
  soulValue.value = { ...soul };
  emitUpdate();
}

function handleRulesChange(rules: string[]): void {
  rulesValue.value = [...rules];
  emitUpdate();
}

function handleSkillTreeSelectNode(): void {
  emitUpdate();
}

function handleSkillTreeDeselectNode(): void {
  emitUpdate();
}

function handleSkillTreeReset(): void {
  emitUpdate();
}

// ============================================================================
// Tab Badge — 显示子面板的计数
// ============================================================================

function getTabBadge(key: TabKey): number {
  switch (key) {
    case 'rules':
      return rulesValue.value.length;
    case 'skills':
      return skillTreeState.value.selectedNodes.length;
    default:
      return 0;
  }
}

// ============================================================================
// Validation — 供父组件调用
// ============================================================================

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
    if (
      !backendConfig.value.stratixConfig?.apiKey &&
      backendConfig.value.stratixConfig?.provider !== 'ollama'
    ) {
      errors.push('API Key 不能为空');
    }
  } else {
    if (!backendConfig.value.directConfig?.model) {
      errors.push('请选择模型');
    }
    if (
      !backendConfig.value.directConfig?.apiKey &&
      backendConfig.value.directConfig?.provider !== 'ollama'
    ) {
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

defineExpose({ validate });
</script>

<template>
  <div class="acs">
    <!-- ================================================================
         Tab 导航 — A2: flex 等宽对齐, A8: 对称
    ================================================================ -->
    <div class="acs-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="acs-tab"
        :class="{ 'acs-tab--active': activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        <span class="acs-tab__icon">{{ tab.icon }}</span>
        <span class="acs-tab__label">{{ tab.label }}</span>
        <span
          v-if="getTabBadge(tab.key) > 0"
          class="acs-tab__badge"
        >
          {{ getTabBadge(tab.key) }}
        </span>
      </button>
    </div>

    <!-- ================================================================
         Tab 内容 — A1: 间距一致, A7: 留白
    ================================================================ -->
    <div class="acs-content">
      <!-- Connection -->
      <div v-show="activeTab === 'connection'" class="acs-panel">
        <BackendSelector
          :model-value="backendConfig"
          @change="handleBackendChange"
        />
      </div>

      <!-- Soul -->
      <div v-show="activeTab === 'soul'" class="acs-panel">
        <SoulEditor
          :model-value="soulValue"
          @change="handleSoulChange"
        />
      </div>

      <!-- Rules -->
      <div v-show="activeTab === 'rules'" class="acs-panel">
        <RulesEditor
          :model-value="rulesValue"
          @update:model-value="handleRulesChange"
        />
      </div>

      <!-- Skills -->
      <div v-show="activeTab === 'skills'" class="acs-panel">
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
/* ==========================================================================
   Root Container — A2: flex column, A3: ds tokens, A6: ≤ 15 props
========================================================================== */
.acs {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radii-lg, 8px);
  overflow: hidden;
}

/* ==========================================================================
   Tab 导航 — A2: flex 等宽, A4: 等尺寸, A8: 对称
========================================================================== */
.acs-tabs {
  display: flex;
  border-bottom: 1px solid var(--ds-border);
  background: var(--ds-bg-base);
  flex-shrink: 0;
}

.acs-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--ds-spacing-xs, 4px);
  padding: var(--ds-spacing-md, 12px) var(--ds-spacing-sm, 8px);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-sm, 12px);
  font-family: inherit;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.acs-tab:hover {
  color: var(--ds-text-secondary);
  background: var(--ds-bg-tertiary);
}

.acs-tab--active {
  color: var(--ds-color-primary);
  border-bottom-color: var(--ds-color-primary);
}

.acs-tab__icon {
  font-size: var(--ds-font-size-lg, 16px);
  line-height: 1;
}

.acs-tab__label {
  font-size: var(--ds-font-size-sm, 12px);
}

.acs-tab__badge {
  font-size: var(--ds-font-size-xs, 10px);
  padding: 1px var(--ds-spacing-xs, 4px);
  background: var(--ds-color-primary);
  color: var(--ds-text-inverse);
  border-radius: 10px;
  min-width: 16px;
  text-align: center;
  line-height: 1.4;
}

/* ==========================================================================
   Tab 内容 — A1: 间距, A7: 留白
========================================================================== */
.acs-content {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.acs-panel {
  height: 100%;
  overflow-y: auto;
}

/* ==========================================================================
   Scrollbar — 轻量
========================================================================== */
.acs-panel::-webkit-scrollbar {
  width: 6px;
}

.acs-panel::-webkit-scrollbar-track {
  background: var(--ds-bg-base);
}

.acs-panel::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: 3px;
}

.acs-panel::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary);
}
</style>
