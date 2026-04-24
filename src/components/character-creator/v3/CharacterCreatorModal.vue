<script setup lang="ts">
/**
 * CharacterCreatorModal.vue — V3 主容器
 *
 * 三栏布局 + 三步骤切换（appearance / openclaw / agent）
 * 完整集成 EventBus + composables + 所有子组件
 */

import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { StratixModal, StratixButton } from '@/components/ui';
import type { SavedCharacter } from '@/stratix-character-creator/types';
import type { CreatorStep } from '@/stratix-character-creator/types';
import type { BodyType } from '@/stratix-character-creator/constants';
import type { PartCategory } from '@/stratix-character-creator/constants';
import type { PartSelection } from '@/stratix-character-creator/types';
import type { AnimationName } from '@/stratix-character-creator/constants';
import { useCharacterState } from './composables/useCharacterState';
import { usePartSelection } from './composables/usePartSelection';
import { usePreviewControl } from './composables/usePreviewControl';
import { characterCreatorEvents } from '@/stratix-character-creator/core/EventEmitter';

// Sub-components
import CanvasPreview from './components/CanvasPreview.vue';
import PartSelector from './components/PartSelector.vue';
import AnimationControls from './components/AnimationControls.vue';
import CharacterList from './components/CharacterList.vue';
import BackendSelector from './components/BackendSelector.vue';
import AgentConfigStep from './components/AgentConfigStep.vue';
import SoulEditor from './components/SoulEditor.vue';
import RulesEditor from './components/RulesEditor.vue';
import SkillTreePanel from './components/SkillTreePanel.vue';
import AgentChatPanel from './components/AgentChatPanel.vue';
import JsonEditor from './components/JsonEditor.vue';

// ============================================================================
// Props & Emits（与 App.vue 完全一致）
// ============================================================================

const props = defineProps<{
  visible: boolean;
  editCharacterId?: string;
}>();

const emit = defineEmits<{
  close: [];
  created: [character: SavedCharacter];
  updated: [character: SavedCharacter];
  deleted: [characterId: string];
}>();

// ============================================================================
// Composables
// ============================================================================

const charState = useCharacterState();
const partSelection = usePartSelection(charState.currentCharacter);
const previewCtrl = usePreviewControl();

// Derived from charState for sub-components
const currentChar = computed(() => charState.currentCharacter.value);

// ============================================================================
// 步骤系统
// ============================================================================

const currentStep = ref<CreatorStep>('appearance');
const completedSteps = ref<CreatorStep[]>([]);

const steps: { key: CreatorStep; label: string }[] = [
  { key: 'appearance', label: '外观' },
  { key: 'openclaw', label: '服务' },
  { key: 'agent', label: 'AI' },
];

function goToStep(step: CreatorStep): void {
  if (!canNavigateToStep(step)) return;
  if (!completedSteps.value.includes(currentStep.value)) {
    completedSteps.value.push(currentStep.value);
  }
  currentStep.value = step;
}

function canNavigateToStep(_step: CreatorStep): boolean {
  return true;
}

// ============================================================================
// Toast 系统（内嵌）
// ============================================================================

interface ToastItem { id: number; message: string; type: 'info' | 'success' | 'error'; }
const toasts = ref<ToastItem[]>([]);
let toastSeq = 0;

function showToast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
  const id = ++toastSeq;
  toasts.value.push({ id, message, type });
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id); }, 3000);
}

// ============================================================================
// 名称编辑
// ============================================================================

const isEditingName = ref(false);
const editedName = ref('');
const nameInputRef = ref<HTMLInputElement | null>(null);

function startEditName(): void {
  editedName.value = charState.currentCharacter.value?.name ?? '';
  isEditingName.value = true;
  setTimeout(() => nameInputRef.value?.focus(), 50);
}

function confirmEditName(): void {
  if (charState.currentCharacter.value && editedName.value.trim()) {
    charState.updateName(editedName.value.trim());
  }
  isEditingName.value = false;
}

function cancelEditName(): void {
  isEditingName.value = false;
}

// ============================================================================
// JSON Editor
// ============================================================================

const showJsonEditor = ref(false);

function openJsonEditor(): void {
  showJsonEditor.value = true;
}

function closeJsonEditor(): void {
  showJsonEditor.value = false;
}

function onJsonSave(parts: Record<string, PartSelection>): void {
  // Sync parts from JSON editor into currentCharacter
  for (const [category, selection] of Object.entries(parts)) {
    charState.updatePart(category, selection);
  }
  partSelection.loadFromCharacter(parts);
  closeJsonEditor();
}

// ============================================================================
// PartSelection → currentCharacter 同步
// ============================================================================

function onPartSelect(category: PartCategory, selection: PartSelection): void {
  charState.updatePart(category, selection);
}

function onPartDeselect(category: PartCategory): void {
  charState.updatePart(category, null);
}

function onBodyTypeUpdate(value: BodyType): void {
  charState.updateBodyType(value);
  partSelection.setBodyType(value);
}

function onRandomize(): void {
  partSelection.randomize();
  // Sync back to currentCharacter
  const parts = partSelection.selectedParts.value;
  for (const [category, selection] of Object.entries(parts)) {
    charState.updatePart(category, selection);
  }
}

// ============================================================================
// AgentConfig → currentCharacter 同步
// ============================================================================

function buildAgentConfig() {
  const char = charState.currentCharacter.value;
  if (!char) return undefined;
  return {
    backendType: (char.backendType ?? 'stratix') as 'openclaw' | 'stratix' | 'direct',
    openClawConfig: char.openClawConfig,
    stratixConfig: char.stratixConfig,
    soul: char.soul,
    rules: char.rules,
    skillTreeState: char.skillTree,
  };
}

function onAgentConfigChange(config: ReturnType<typeof buildAgentConfig>): void {
  if (!config || !charState.currentCharacter.value) return;
  charState.currentCharacter.value.backendType = config.backendType;
  charState.currentCharacter.value.openClawConfig = config.openClawConfig;
  charState.currentCharacter.value.stratixConfig = config.stratixConfig;
  charState.currentCharacter.value.soul = config.soul;
  charState.currentCharacter.value.rules = config.rules;
  if (config.skillTreeState) {
    charState.currentCharacter.value.skillTree = config.skillTreeState;
  }
}

// ============================================================================
// handleSave / handleDelete / handleClose
// ============================================================================

async function handleSave(): Promise<void> {
  const isNew = !props.editCharacterId;
  const success = await charState.saveCharacter();
  if (success) {
    showToast('角色已保存', 'success');
    const char = charState.currentCharacter.value!;
    if (isNew) {
      emit('created', char);
    } else {
      emit('updated', char);
    }
  } else {
    showToast('保存失败', 'error');
  }
}

async function handleDelete(characterId: string): Promise<void> {
  const success = await charState.deleteCharacter(characterId);
  if (success) {
    showToast('角色已删除', 'success');
    emit('deleted', characterId);
  } else {
    showToast('删除失败', 'error');
  }
}

function handleClose(): void {
  emit('close');
}

// ============================================================================
// 已保存角色列表 → 加载/删除
// ============================================================================

async function onLoadCharacter(characterId: string): Promise<void> {
  await charState.loadCharacter(characterId);
}

async function onSetDefault(characterId: string): Promise<void> {
  await charState.setDefaultCharacter(characterId);
}

// ============================================================================
// 生命周期 + EventBus 外部事件监听
// ============================================================================

let unsubscribeOpenCreator: (() => void) | null = null;
let unsubscribeCharacterCreated: (() => void) | null = null;
let unsubscribeCharacterUpdated: (() => void) | null = null;
let unsubscribeCharacterDeleted: (() => void) | null = null;

onMounted(async () => {
  await charState.loadSavedCharacters();
  if (props.editCharacterId) {
    await charState.loadCharacter(props.editCharacterId);
  } else {
    charState.createNew('male');
  }

  // Listen for external open-creator events
  unsubscribeOpenCreator = characterCreatorEvents.onOpenCreator(async (data) => {
    if (data.targetCharacterId) {
      await charState.loadCharacter(data.targetCharacterId);
    } else {
      charState.createNew('male');
    }
  });

  unsubscribeCharacterCreated = characterCreatorEvents.onCharacterCreated(() => {
    charState.loadSavedCharacters();
  });

  unsubscribeCharacterUpdated = characterCreatorEvents.onCharacterUpdated(() => {
    charState.loadSavedCharacters();
  });

  unsubscribeCharacterDeleted = characterCreatorEvents.onCharacterDeleted(() => {
    charState.loadSavedCharacters();
  });
});

onUnmounted(() => {
  unsubscribeOpenCreator?.();
  unsubscribeCharacterCreated?.();
  unsubscribeCharacterUpdated?.();
  unsubscribeCharacterDeleted?.();
});

watch(() => props.visible, async (visible) => {
  if (visible) {
    await charState.loadSavedCharacters();
    if (props.editCharacterId) {
      await charState.loadCharacter(props.editCharacterId);
    } else {
      charState.createNew('male');
    }
  }
});

// Sync partSelection.selectedParts → currentCharacter when parts change
watch(
  () => partSelection.selectedParts.value,
  (parts) => {
    if (!charState.currentCharacter.value) return;
    for (const [category, selection] of Object.entries(parts)) {
      charState.currentCharacter.value.parts[category] = selection;
    }
  },
  { deep: true }
);

// ============================================================================
// AgentConfig computed for AgentConfigStep
// ============================================================================

const agentConfig = computed(() => buildAgentConfig());
</script>

<template>
  <StratixModal
    :visible="visible"
    :title="editCharacterId ? '编辑角色' : '创建角色'"
    size="fullscreen"
    :closable="true"
    @close="handleClose"
  >
    <div class="cc-root">
      <!-- ================================================================
           顶部栏：名称编辑 + 步骤导航
      ================================================================ -->
      <header class="cc-header">
        <!-- 名称编辑 -->
        <div class="cc-name">
          <template v-if="!isEditingName">
            <span class="cc-name__text">{{ charState.currentCharacter.value?.name ?? '新角色' }}</span>
            <button class="cc-name__edit" @click="startEditName" title="编辑名称">✎</button>
          </template>
          <template v-else>
            <input
              ref="nameInputRef"
              v-model="editedName"
              class="cc-name__input"
              @keyup.enter="confirmEditName"
              @keyup.escape="cancelEditName"
              @blur="confirmEditName"
            />
          </template>
        </div>

        <!-- 步骤导航 -->
        <nav class="cc-steps">
          <button
            v-for="(step, i) in steps"
            :key="step.key"
            :class="['cc-steps__btn', { active: currentStep === step.key }]"
            @click="goToStep(step.key)"
          >
            {{ i + 1 }}. {{ step.label }}
          </button>
        </nav>

        <!-- 头部操作 -->
        <div class="cc-header__actions">
          <StratixButton size="sm" variant="primary" @click="handleSave">
            保存
          </StratixButton>
          <StratixButton size="sm" variant="ghost" @click="handleClose">
            返回
          </StratixButton>
        </div>
      </header>

      <!-- ================================================================
           三栏布局
      ================================================================ -->
      <div class="cc-body">
        <!-- 左栏 280px: 仅在 appearance 步骤显示 -->
        <aside v-if="currentStep === 'appearance'" class="cc-left">
          <!-- CanvasPreview: Phaser 渲染区 -->
          <CanvasPreview
            v-if="currentChar"
            :body-type="currentChar.bodyType"
            :parts="currentChar.parts"
            :animation="previewCtrl.animation.value"
            :direction="previewCtrl.direction.value"
            :scale="previewCtrl.scale.value"
          />

          <!-- PartSelector: 部件选择（体型 + 分类标签 + 部件网格） -->
          <PartSelector
            :body-type="partSelection.bodyType.value"
            :parts="partSelection.selectedParts.value"
            @select="onPartSelect"
            @deselect="onPartDeselect"
            @randomize="onRandomize"
            @update:body-type="onBodyTypeUpdate"
          />

          <!-- AnimationControls: 动画 + 方向 + 缩放 + 播放控制 -->
          <AnimationControls
            :animation="previewCtrl.animation.value"
            :direction="previewCtrl.direction.value"
            :scale="previewCtrl.scale.value"
            :is-playing="previewCtrl.isPlaying.value"
            @set-animation="previewCtrl.setAnimation"
            @set-direction="previewCtrl.setDirection"
            @set-scale="previewCtrl.setScale"
            @toggle-play="previewCtrl.togglePlay"
          />
        </aside>

        <!-- 中栏 flex-1: 按 currentStep 切换 -->
        <main class="cc-center">
          <!-- Step 1: appearance -->
          <div v-if="currentStep === 'appearance'" class="cc-step-panel">
            <div class="cc-appearance-actions">
              <StratixButton size="sm" variant="secondary" @click="openJsonEditor">
                编辑 JSON
              </StratixButton>
            </div>
          </div>

          <!-- Step 2: openclaw — BackendSelector + AgentConfigStep -->
          <div v-else-if="currentStep === 'openclaw'" class="cc-step-panel">
            <AgentConfigStep
              v-if="agentConfig"
              :model-value="agentConfig"
              @change="onAgentConfigChange"
            />
          </div>

          <!-- Step 3: agent — AgentChatPanel -->
          <div v-else-if="currentStep === 'agent'" class="cc-step-panel">
            <AgentChatPanel
              :visible="currentStep === 'agent'"
              :agent-config="agentConfig"
              :character-name="charState.currentCharacter.value?.name"
              @complete="() => {}"
              @back="goToStep('openclaw')"
            />
          </div>

          <!-- 底部步骤导航（所有步骤通用，始终可见） -->
          <div class="cc-step-nav">
            <StratixButton
              v-if="currentStep !== 'appearance'"
              size="sm"
              variant="ghost"
              @click="goToStep(currentStep === 'agent' ? 'openclaw' : 'appearance')"
            >
              ← 上一步
            </StratixButton>
            <span v-else />
            <StratixButton
              v-if="currentStep !== 'agent'"
              size="sm"
              variant="primary"
              @click="goToStep(currentStep === 'appearance' ? 'openclaw' : 'agent')"
            >
              下一步 →
            </StratixButton>
          </div>
        </main>

        <!-- 右栏 280px: 已保存角色列表 -->
        <aside class="cc-right">
          <CharacterList
            :characters="charState.savedCharacters.value"
            :current-character-id="charState.currentCharacter.value?.characterId"
            :is-loading="charState.isLoading.value"
            @load="onLoadCharacter"
            @delete="handleDelete"
            @set-default="onSetDefault"
          />
        </aside>
      </div>

      <!-- ================================================================
           Toast（内嵌）
      ================================================================ -->
      <div class="cc-toast-container">
        <TransitionGroup name="toast">
          <div
            v-for="toast in toasts"
            :key="toast.id"
            :class="['cc-toast', `cc-toast--${toast.type}`]"
          >
            {{ toast.message }}
          </div>
        </TransitionGroup>
      </div>

      <!-- ================================================================
           JSON Editor Modal
      ================================================================ -->
      <JsonEditor
        v-if="currentChar"
        :visible="showJsonEditor"
        :parts="currentChar.parts"
        @close="closeJsonEditor"
        @save="onJsonSave"
      />
    </div>
  </StratixModal>
</template>

<style scoped>
/* -------------------------------------------------------------------------
   根容器
------------------------------------------------------------------------- */
.cc-root {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  background: var(--ds-bg-base);
  overflow: hidden;
}

/* -------------------------------------------------------------------------
   顶部栏
------------------------------------------------------------------------- */
.cc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--ds-bg-secondary);
  border-bottom: 1px solid var(--ds-border);
  gap: 16px;
  flex-shrink: 0;
}

/* 名称编辑 */
.cc-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
}

.cc-name__text {
  font-size: 16px;
  font-weight: 600;
  color: var(--ds-text-primary);
}

.cc-name__edit {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cc-name__edit:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

.cc-name__input {
  padding: 6px 10px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-color-primary);
  border-radius: 4px;
  color: var(--ds-text-primary);
  font-size: 14px;
  font-family: inherit;
  text-align: center;
  outline: none;
  min-width: 120px;
}

/* 步骤导航 */
.cc-steps {
  display: flex;
  gap: 4px;
}

.cc-steps__btn {
  padding: 6px 14px;
  background: transparent;
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-muted);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cc-steps__btn:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-text-secondary);
}

.cc-steps__btn.active {
  background: var(--ds-bg-tertiary);
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

/* 头部操作 */
.cc-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
  justify-content: flex-end;
}

/* -------------------------------------------------------------------------
   三栏布局
------------------------------------------------------------------------- */
.cc-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 左栏 280px */
.cc-left {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--ds-bg-secondary);
  border-right: 1px solid var(--ds-border);
  overflow-y: auto;
}

/* 中栏 flex-1 */
.cc-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px;
  gap: 12px;
}

.cc-step-panel {
  flex: 1 1 0;
  overflow: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.cc-appearance-actions {
  display: flex;
  gap: 8px;
  padding: 8px 0;
}

.cc-step-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  flex-shrink: 0;
  border-top: 1px solid var(--ds-border);
}

/* 右栏 280px */
.cc-right {
  width: 280px;
  flex-shrink: 0;
  padding: 12px;
  background: var(--ds-bg-secondary);
  border-left: 1px solid var(--ds-border);
  overflow-y: auto;
}

/* -------------------------------------------------------------------------
   Toast（内嵌）
------------------------------------------------------------------------- */
.cc-toast-container {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  z-index: 9999;
}

.cc-toast {
  padding: 10px 20px;
  background: rgba(0, 0, 0, 0.85);
  border-radius: 6px;
  font-size: 13px;
  font-family: 'SF Mono', 'Monaco', monospace;
  font-weight: 500;
  letter-spacing: 0.02em;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.cc-toast--success { color: var(--ds-status-success, #34c759); }
.cc-toast--error   { color: var(--ds-status-danger, #ff3b30); }
.cc-toast--info    { color: var(--ds-color-primary, #007aff); }

/* Toast 动画 */
.toast-enter-active { animation: toast-in 0.3s ease-out; }
.toast-leave-active { animation: toast-out 0.3s ease-in; }

@keyframes toast-in {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes toast-out {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-20px); }
}

/* -------------------------------------------------------------------------
   滚动条
------------------------------------------------------------------------- */
.cc-left::-webkit-scrollbar,
.cc-right::-webkit-scrollbar {
  width: 6px;
}

.cc-left::-webkit-scrollbar-track,
.cc-right::-webkit-scrollbar-track {
  background: var(--ds-bg-base);
}

.cc-left::-webkit-scrollbar-thumb,
.cc-right::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: 3px;
}

.cc-left::-webkit-scrollbar-thumb:hover,
.cc-right::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary);
}
</style>
