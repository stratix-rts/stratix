<script setup lang="ts">
/**
 * CharacterCreatorModal.vue — V4 主容器
 *
 * 三栏布局（280px / flex-1 / 280px）+ 三步骤切换（appearance / openclaw / agent）
 * Props/Emits 与 App.vue 完全一致
 *
 * 内嵌系统：
 * - 步骤导航（非独立组件）
 * - Toast 通知（非独立组件）
 * - 名称编辑（非独立组件）
 */

import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { StratixModal, StratixButton } from '@/components/ui';
import type { SavedCharacter } from '@/stratix-character-creator/types';
import type { CreatorStep } from '@/stratix-character-creator/types';
import type { BodyType } from '@/stratix-character-creator/constants';
import type { PartCategory } from '@/stratix-character-creator/constants';
import type { PartSelection } from '@/stratix-character-creator/types';
import { useCharacterState } from "./composables/useCharacterState";
import { usePartSelection } from "./composables/usePartSelection";
import { usePreviewControl } from "./composables/usePreviewControl";
import { characterCreatorEvents } from '@/stratix-character-creator/core/EventEmitter';

// Sub-components
import CanvasPreview from "./components/CanvasPreview.vue";
import PartSelector from "./components/PartSelector.vue";
import AnimationControls from "./components/AnimationControls.vue";
import CharacterList from "./components/CharacterList.vue";
import BackendSelector from "./components/BackendSelector.vue";
import AgentConfigStep from "./components/AgentConfigStep.vue";
import SoulEditor from "./components/SoulEditor.vue";
import RulesEditor from "./components/RulesEditor.vue";
import SkillTreePanel from "./components/SkillTreePanel.vue";
import AgentChatPanel from "./components/AgentChatPanel.vue";
import JsonEditor from "./components/JsonEditor.vue";

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

// Derived from charState for template binding
const currentChar = computed(() => charState.currentCharacter.value);

// ============================================================================
// 步骤系统
// ============================================================================

const currentStep = ref<CreatorStep>('appearance');

const steps: { key: CreatorStep; label: string }[] = [
  { key: 'appearance', label: '外观' },
  { key: 'openclaw', label: '服务' },
  { key: 'agent', label: 'AI' },
];

function goToStep(step: CreatorStep): void {
  currentStep.value = step;
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

const agentConfig = computed(() => buildAgentConfig());

// ============================================================================
// Toast 系统（内嵌）
// ============================================================================

interface ToastItem {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error';
}

const toasts = ref<ToastItem[]>([]);
let toastSeq = 0;

function showToast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
  const id = ++toastSeq;
  toasts.value.push({ id, message, type });
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id);
  }, 3000);
}

// ============================================================================
// 名称编辑（内嵌）
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
// handleSave / handleDelete / handleClose
// ============================================================================

async function handleSave(): Promise<void> {
  // 判断新建 vs 更新：检查已保存列表中是否已存在该 characterId
  const charId = charState.currentCharacter.value?.characterId;
  const isNew = !charId
    || !charState.savedCharacters.value.some(c => c.characterId === charId);
  const success = await charState.saveCharacter();
  if (success) {
    showToast('角色已保存', 'success');
    const char = charState.currentCharacter.value!;
    // EventBus 广播：通知其他模块
    if (isNew) {
      characterCreatorEvents.emitCharacterCreated(char);
      emit('created', char);
    } else {
      characterCreatorEvents.emitCharacterUpdated(char);
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
    // EventBus 广播：通知其他模块
    characterCreatorEvents.emitCharacterDeleted(characterId);
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
  // EventBus 广播：通知其他模块当前选中角色
  const char = charState.currentCharacter.value;
  if (char) {
    characterCreatorEvents.emitCharacterSelected(char);
  }
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

// 监听 editCharacterId 变化，支持 App.vue 动态切换编辑目标
watch(() => props.editCharacterId, async (newId) => {
  if (props.visible) {
    if (newId) {
      await charState.loadCharacter(newId);
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
           顶部栏：名称编辑 + 步骤导航 + 操作按钮
      ================================================================ -->
      <header class="cc-header">
        <!-- 名称编辑 -->
        <div class="cc-name">
          <template v-if="!isEditingName">
            <span class="cc-name__text">{{ currentChar?.name ?? '新角色' }}</span>
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
            :class="['cc-steps__btn', { 'cc-steps__btn--active': currentStep === step.key }]"
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
           三栏布局：左 280px / 中 flex-1 / 右 280px
      ================================================================ -->
      <div class="cc-body">
        <!-- 左栏 280px: 仅在 appearance 步骤显示 -->
        <aside v-if="currentStep === 'appearance'" class="cc-left">
          <CanvasPreview
            v-if="currentChar"
            :body-type="currentChar.bodyType"
            :parts="currentChar.parts"
            :animation="previewCtrl.animation.value"
            :direction="previewCtrl.direction.value"
            :scale="previewCtrl.scale.value"
          />

          <PartSelector
            :body-type="partSelection.bodyType.value"
            :selected-parts="partSelection.selectedParts.value"
            @select="onPartSelect"
            @deselect="onPartDeselect"
            @randomize="onRandomize"
            @update:body-type="onBodyTypeUpdate"
          />

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

        <!-- 中栏 flex-1 -->
        <main class="cc-center">
          <!-- Step 1: appearance -->
          <div v-if="currentStep === 'appearance'" class="cc-step-panel">
            <div class="cc-appearance-actions">
              <StratixButton size="sm" variant="secondary" @click="openJsonEditor">
                编辑 JSON
              </StratixButton>
            </div>
          </div>

          <!-- Step 2: openclaw — AgentConfigStep -->
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

          <!-- 底部步骤导航 -->
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

        <!-- 右栏 280px -->
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
        <TransitionGroup name="cc-toast-anim">
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
/* ==========================================================================
   根容器
========================================================================== */
.cc-root {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--ds-spacing-lg, 48px));
  background: var(--ds-bg-base);
  overflow: hidden;
}

/* ==========================================================================
   顶部栏 — 名称编辑 + 步骤导航 + 操作按钮
========================================================================== */
.cc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ds-spacing-md, 12px) var(--ds-spacing-lg, 16px);
  background: var(--ds-bg-secondary);
  border-bottom: 1px solid var(--ds-border);
  gap: var(--ds-spacing-lg, 16px);
  flex-shrink: 0;
}

/* 名称编辑 */
.cc-name {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-xs, 8px);
  min-width: 120px;
}

.cc-name__text {
  font-size: var(--ds-typography-fontSize-lg, 16px);
  font-weight: var(--ds-typography-fontWeight-semibold, 600);
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
  border-radius: var(--ds-radius-sm, 2px);
  color: var(--ds-text-muted);
  font-size: var(--ds-typography-fontSize-sm, 12px);
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.cc-name__edit:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

.cc-name__input {
  padding: var(--ds-spacing-xs, 8px);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-color-primary);
  border-radius: var(--ds-radius-sm, 2px);
  color: var(--ds-text-primary);
  font-size: var(--ds-typography-fontSize-md, 14px);
  font-family: inherit;
  outline: none;
  min-width: 120px;
}

/* 步骤导航 */
.cc-steps {
  display: flex;
  gap: var(--ds-spacing-xs, 4px);
}

.cc-steps__btn {
  padding: var(--ds-spacing-xs, 8px) 14px;
  background: transparent;
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-sm, 2px);
  color: var(--ds-text-muted);
  font-size: var(--ds-typography-fontSize-sm, 12px);
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.cc-steps__btn:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-text-secondary);
}

.cc-steps__btn--active {
  background: var(--ds-bg-tertiary);
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

/* 头部操作 */
.cc-header__actions {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-xs, 8px);
  min-width: 120px;
  justify-content: flex-end;
}

/* ==========================================================================
   三栏布局 — 左 280px / 中 flex-1 / 右 280px
========================================================================== */
.cc-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 左栏 */
.cc-left {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-xs, 8px);
  padding: var(--ds-spacing-md, 12px);
  background: var(--ds-bg-secondary);
  border-right: 1px solid var(--ds-border);
  overflow-y: auto;
}

/* 中栏 */
.cc-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: var(--ds-spacing-md, 12px);
  gap: var(--ds-spacing-md, 12px);
}

.cc-step-panel {
  flex: 1 1 0;
  overflow: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 底部步骤导航 */
.cc-step-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ds-spacing-xs, 8px);
  padding: var(--ds-spacing-md, 12px) 0;
  flex-shrink: 0;
  border-top: 1px solid var(--ds-border);
}

/* 右栏 */
.cc-right {
  width: 280px;
  flex-shrink: 0;
  padding: var(--ds-spacing-md, 12px);
  background: var(--ds-bg-secondary);
  border-left: 1px solid var(--ds-border);
  overflow-y: auto;
}

/* ==========================================================================
   appearance 步骤操作栏
========================================================================== */
.cc-appearance-actions {
  display: flex;
  gap: var(--ds-spacing-xs, 8px);
  padding: var(--ds-spacing-xs, 8px) 0;
}

/* ==========================================================================
   Toast（内嵌）
========================================================================== */
.cc-toast-container {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ds-spacing-xs, 8px);
  pointer-events: none;
  z-index: 9999;
}

.cc-toast {
  padding: var(--ds-spacing-xs, 8px) 20px;
  background: var(--ds-bg-overlay);
  border-radius: var(--ds-radius-md, 4px);
  font-size: var(--ds-typography-fontSize-sm, 12px);
  font-weight: var(--ds-typography-fontWeight-medium, 500);
  white-space: nowrap;
  box-shadow: var(--ds-shadow-md);
}

.cc-toast--success { color: var(--ds-status-success); }
.cc-toast--error   { color: var(--ds-status-danger); }
.cc-toast--info    { color: var(--ds-color-primary); }

/* Toast 动画 */
.cc-toast-anim-enter-active { animation: cc-toast-in 0.3s ease-out; }
.cc-toast-anim-leave-active { animation: cc-toast-out 0.3s ease-in; }

@keyframes cc-toast-in {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes cc-toast-out {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-20px); }
}

/* ==========================================================================
   滚动条
========================================================================== */
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
