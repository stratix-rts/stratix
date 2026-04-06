<script setup lang="ts">
/**
 * CharacterCreatorModal.vue - V2 主容器
 *
 * 整合所有 V2 子组件，使用 3 个 composables 管理状态
 * 保持与 V1 完全相同的 props/emits 接口
 */

import { ref, watch, computed, onMounted } from 'vue';
import { StratixModal, StratixButton, StratixConfirmDialog } from '@/components/ui';
import type { SavedCharacter } from '@/stratix-character-creator/types';
import type { BodyType } from '@/stratix-character-creator/constants';
import type { PartCategory } from '@/stratix-character-creator/constants';
import type { AnimationName } from '@/stratix-character-creator/constants';
import type { PartSelection } from '@/stratix-character-creator/types';
import type { StratixSoulConfig } from '@/stratix-core/stratix-protocol';

import { useCharacterState } from './composables/useCharacterState';
import { usePartSelection } from './composables/usePartSelection';
import { usePreviewControl } from './composables/usePreviewControl';

import CanvasPreview from './components/CanvasPreview.vue';
import PartSelector from './components/PartSelector.vue';
import CharacterList from './components/CharacterList.vue';
import BodyTypeSelector from './components/BodyTypeSelector.vue';
import AnimationControls from './components/AnimationControls.vue';
import StepNavigator from './components/StepNavigator.vue';
import AgentConfigStep from './components/AgentConfigStep.vue';
import CreditsPanel from './components/CreditsPanel.vue';
import JsonEditor from './components/JsonEditor.vue';

import type { CreatorStep } from './components/StepNavigator.vue';

// ============================================================================
// Props & Emits (V1 兼容接口)
// ============================================================================

const props = defineProps<{
  visible: boolean;
  editCharacterId?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'created', character: SavedCharacter): void;
  (e: 'updated', character: SavedCharacter): void;
  (e: 'deleted', characterId: string): void;
}>();

// ============================================================================
// Composables
// ============================================================================

const {
  currentCharacter,
  isDirty,
  savedCharacters,
  isLoading: isLoadingCharacters,
  hasCharacter,
  loadSavedCharacters,
  createNew,
  loadCharacter,
  saveCharacter,
  deleteCharacter,
  setDefaultCharacter,
  updateBodyType,
  updatePart,
} = useCharacterState();

const {
  bodyType,
  randomizeMode,
  selectedParts,
  selectPart,
  deselectPart,
  randomize,
  randomizeMinimal,
  randomizeNormal,
  randomizeFull,
  setBodyType,
  loadFromCharacter,
} = usePartSelection({ bodyType: 'male' });

const {
  animation,
  direction,
  scale,
  isPlaying,
  setAnimation,
  setDirection,
  setScale,
  togglePlay,
  cycleDirection,
  zoomIn,
  zoomOut,
} = usePreviewControl();

// ============================================================================
// 步骤状态
// ============================================================================

const currentStep = ref<CreatorStep>('appearance');
const completedSteps = ref<CreatorStep[]>([]);

// ============================================================================
// AgentConfig 状态 (Step 3)
// ============================================================================

interface AgentConfigData {
  backendType: 'openclaw' | 'stratix';
  openClawConfig?: {
    endpoint: string;
    accountId: string;
    apiKey?: string;
  };
  stratixConfig?: any;
  soul?: StratixSoulConfig;
  rules?: string[];
}

const agentConfig = ref<AgentConfigData>({
  backendType: 'stratix',
});

// ============================================================================
// Toast 消息系统
// ============================================================================

interface ToastMessage {
  id: number;
  text: string;
  type: 'success' | 'error' | 'info';
}

const toasts = ref<ToastMessage[]>([]);
let toastId = 0;

function showToast(text: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const id = ++toastId;
  toasts.value.push({ id, text, type });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, 3000);
}

// ============================================================================
// 角色名称编辑
// ============================================================================

const isEditingName = ref(false);
const editedName = ref('');
const nameInputRef = ref<HTMLInputElement | null>(null);

const displayName = computed(() => {
  return currentCharacter.value?.name || '新角色';
});

function startEditName(): void {
  editedName.value = currentCharacter.value?.name || '';
  isEditingName.value = true;
  setTimeout(() => nameInputRef.value?.focus(), 50);
}

function confirmEditName(): void {
  if (currentCharacter.value && editedName.value.trim()) {
    currentCharacter.value.name = editedName.value.trim();
  }
  isEditingName.value = false;
}

function cancelEditName(): void {
  isEditingName.value = false;
}

// ============================================================================
// 删除确认弹窗
// ============================================================================

const showDeleteConfirm = ref(false);
const pendingDeleteId = ref<string | null>(null);

// ============================================================================
// JSON 编辑器
// ============================================================================

const showJsonEditor = ref(false);

function handleJsonSave(newParts: Record<string, PartSelection>): void {
  if (currentCharacter.value) {
    currentCharacter.value.parts = newParts;
    loadFromCharacter(newParts);
    showToast('JSON 已更新', 'success');
  }
}

// ============================================================================
// 角色操作
// ============================================================================

async function handleLoadCharacter(characterId: string): Promise<void> {
  const character = await loadCharacter(characterId);
  if (character) {
    // 同步到 part selection
    loadFromCharacter(character.parts);
    // 同步体型
    setBodyType(character.bodyType);
    // 同步 agent config
    if (character.backendType) {
      agentConfig.value.backendType = character.backendType;
    }
    if (character.openClawConfig) {
      agentConfig.value.openClawConfig = character.openClawConfig;
    }
    if (character.stratixConfig) {
      agentConfig.value.stratixConfig = character.stratixConfig;
    }
    if (character.soul) {
      agentConfig.value.soul = character.soul;
    }
    if (character.rules) {
      agentConfig.value.rules = character.rules;
    }
    // 重置步骤
    currentStep.value = 'appearance';
    completedSteps.value = [];
    showToast(`已加载: ${character.name}`, 'info');
  }
}

function handleCreateNew(): void {
  const newChar = createNew('male');
  loadFromCharacter(newChar.parts);
  currentStep.value = 'appearance';
  completedSteps.value = [];
}

async function handleSave(): Promise<void> {
  if (!currentCharacter.value) return;

  // 同步部件数据
  currentCharacter.value.parts = { ...selectedParts.value };
  currentCharacter.value.bodyType = bodyType.value;

  // 同步 agent config
  currentCharacter.value.backendType = agentConfig.value.backendType;
  currentCharacter.value.openClawConfig = agentConfig.value.openClawConfig;
  currentCharacter.value.stratixConfig = agentConfig.value.stratixConfig;
  currentCharacter.value.soul = agentConfig.value.soul;
  currentCharacter.value.rules = agentConfig.value.rules;

  const isNew = !props.editCharacterId;
  const success = await saveCharacter();

  if (success) {
    showToast('角色已保存', 'success');
    const saved = currentCharacter.value;
    if (isNew) {
      emit('created', saved);
    } else {
      emit('updated', saved);
    }
  } else {
    showToast('保存失败', 'error');
  }
}

function handleDeleteClick(characterId: string): void {
  pendingDeleteId.value = characterId;
  showDeleteConfirm.value = true;
}

async function confirmDelete(): Promise<void> {
  if (pendingDeleteId.value) {
    const success = await deleteCharacter(pendingDeleteId.value);
    if (success) {
      showToast('角色已删除', 'success');
      emit('deleted', pendingDeleteId.value);
    }
  }
  showDeleteConfirm.value = false;
  pendingDeleteId.value = null;
}

async function handleSetDefault(characterId: string): Promise<void> {
  await setDefaultCharacter(characterId);
}

// ============================================================================
// 步骤导航
// ============================================================================

function handleStepNavigate(step: CreatorStep): void {
  // 标记当前步骤为完成
  if (!completedSteps.value.includes(currentStep.value)) {
    completedSteps.value.push(currentStep.value);
  }
  currentStep.value = step;
}

function goToNextStep(): void {
  const stepOrder: CreatorStep[] = ['appearance', 'openclaw', 'agent'];
  const currentIndex = stepOrder.indexOf(currentStep.value);
  if (currentIndex < stepOrder.length - 1) {
    // 标记当前步骤为完成
    if (!completedSteps.value.includes(currentStep.value)) {
      completedSteps.value.push(currentStep.value);
    }
    currentStep.value = stepOrder[currentIndex + 1];
  }
}

// ============================================================================
// PartSelector 事件
// ============================================================================

function handlePartSelect(category: PartCategory, selection: PartSelection): void {
  selectPart(category, selection.itemId, selection.variant);
  updatePart(category, selection);
}

function handlePartDeselect(category: PartCategory): void {
  deselectPart(category);
  updatePart(category, null);
}

function handleRandomize(): void {
  const modeNames = { minimal: '精简', normal: '普通', full: '完全' };
  switch (randomizeMode.value) {
    case 'minimal':
      randomizeMinimal();
      break;
    case 'normal':
      randomizeNormal();
      break;
    case 'full':
      randomizeFull();
      break;
  }
  // 同步回 currentCharacter
  if (currentCharacter.value) {
    currentCharacter.value.parts = { ...selectedParts.value };
  }
  showToast(`角色已随机 (${modeNames[randomizeMode.value]}模式)`, 'success');
}

function cycleRandomMode(): void {
  const modes: Array<'minimal' | 'normal' | 'full'> = ['minimal', 'normal', 'full'];
  const currentIndex = modes.indexOf(randomizeMode.value);
  randomizeMode.value = modes[(currentIndex + 1) % modes.length];
  handleRandomize();
}

// ============================================================================
// BodyType 变化
// ============================================================================

function handleBodyTypeChange(newBodyType: BodyType): void {
  setBodyType(newBodyType);
  updateBodyType(newBodyType);
}

// ============================================================================
// PreviewControl 事件
// ============================================================================

function handleSetAnimation(anim: AnimationName): void {
  setAnimation(anim);
}

function handleSetDirection(dir: number): void {
  setDirection(dir);
}

function handleSetScale(s: number): void {
  setScale(s);
}

function handleTogglePlay(): void {
  togglePlay();
}

function handleCycleDirection(): void {
  cycleDirection();
}

function handleZoomIn(): void {
  zoomIn();
}

function handleZoomOut(): void {
  zoomOut();
}

// ============================================================================
// AgentConfig 变化
// ============================================================================

function handleAgentConfigChange(config: AgentConfigData): void {
  agentConfig.value = { ...config };
}

// ============================================================================
// 关闭
// ============================================================================

function handleClose(): void {
  emit('close');
}

// ============================================================================
// 初始化 & 监听
// ============================================================================

// 监听 visible 变化
watch(() => props.visible, async (visible) => {
  if (visible) {
    // 加载保存的角色列表
    await loadSavedCharacters();

    if (props.editCharacterId) {
      // 编辑模式：加载指定角色
      await handleLoadCharacter(props.editCharacterId);
    } else {
      // 新建模式：创建新角色
      handleCreateNew();
    }
  }
});

// 监听 editCharacterId 变化（编辑已有角色）
watch(() => props.editCharacterId, async (newId) => {
  if (props.visible && newId) {
    await handleLoadCharacter(newId);
  }
});

// 当 selectedParts 变化时，同步到 currentCharacter
watch(selectedParts, (parts) => {
  if (currentCharacter.value) {
    currentCharacter.value.parts = { ...parts };
  }
}, { deep: true });
</script>

<template>
  <StratixModal
    :visible="visible"
    :title="editCharacterId ? '编辑角色' : '创建角色'"
    size="fullscreen"
    :closable="true"
    @close="handleClose"
  >
    <div class="creator-container">
      <!-- 顶部栏 -->
      <header class="creator-header">
        <div class="header-left">
          <!-- 体型选择 -->
          <BodyTypeSelector
            :model-value="bodyType"
            @change="handleBodyTypeChange"
          />
        </div>

        <div class="header-center">
          <!-- 角色名称 -->
          <div class="character-name">
            <template v-if="!isEditingName">
              <span class="name-text">{{ displayName }}</span>
              <button class="name-edit-btn" @click="startEditName" title="编辑名称">
                ✎
              </button>
            </template>
            <template v-else>
              <input
                ref="nameInputRef"
                v-model="editedName"
                class="name-input"
                @keyup.enter="confirmEditName"
                @keyup.escape="cancelEditName"
                @blur="confirmEditName"
              />
            </template>
          </div>
        </div>

        <div class="header-right">
          <StratixButton size="sm" variant="secondary" @click="cycleRandomMode" :title="`当前: ${randomizeMode}`">
            🎲 {{ randomizeMode === 'minimal' ? '精简' : randomizeMode === 'normal' ? '普通' : '完全' }}
          </StratixButton>
          <StratixButton
            size="sm"
            variant="primary"
            :disabled="!hasCharacter"
            @click="handleSave"
          >
            保存
          </StratixButton>
          <StratixButton size="sm" variant="ghost" @click="handleClose">
            返回
          </StratixButton>
        </div>
      </header>

      <!-- 主内容区 -->
      <div class="creator-main">
        <!-- 左侧面板：Canvas 预览 + 动画控制 -->
        <aside class="left-panel">
          <div class="canvas-area">
            <CanvasPreview
              :body-type="bodyType"
              :parts="selectedParts"
              :animation="animation"
              :direction="direction"
              :scale="scale"
            />
          </div>
          <div class="controls-area">
            <AnimationControls
              :animation="animation"
              :direction="direction"
              :scale="scale"
              :is-playing="isPlaying"
              @update:animation="handleSetAnimation"
              @update:direction="handleSetDirection"
              @update:scale="handleSetScale"
              @update:is-playing="(v) => { if (v !== isPlaying) handleTogglePlay(); }"
              @set-animation="handleSetAnimation"
              @set-direction="handleSetDirection"
              @set-scale="handleSetScale"
              @toggle-play="handleTogglePlay"
              @cycle-direction="handleCycleDirection"
              @zoom-in="handleZoomIn"
              @zoom-out="handleZoomOut"
            />
          </div>
          <CreditsPanel :parts="selectedParts" />

          <!-- JSON 编辑器入口 -->
          <div class="json-editor-entry">
            <div class="json-divider"></div>
            <button class="json-editor-btn" @click="showJsonEditor = true">
              打开 JSON 编辑器
            </button>
          </div>
        </aside>

        <!-- 中间工作区 -->
        <main class="center-panel">
          <!-- 步骤导航 -->
          <div class="step-navigator-area">
            <StepNavigator
              :current-step="currentStep"
              :completed-steps="completedSteps"
              @navigate="handleStepNavigate"
            />
          </div>

          <!-- 步骤内容 -->
          <div class="step-content">
            <!-- Step 1: 外观 -->
            <div v-show="currentStep === 'appearance'" class="step-panel">
              <PartSelector
                :body-type="bodyType"
                :selected-parts="selectedParts"
                @select="handlePartSelect"
                @deselect="handlePartDeselect"
                @randomize="handleRandomize"
              />
            </div>

            <!-- Step 2 & 3: Agent 配置 -->
            <div v-show="currentStep === 'openclaw' || currentStep === 'agent'" class="step-panel">
              <AgentConfigStep
                v-model="agentConfig"
                @change="handleAgentConfigChange"
              />
            </div>
          </div>

          <!-- 步骤切换按钮 -->
          <div class="step-actions">
            <StratixButton
              v-if="currentStep !== 'appearance'"
              size="sm"
              variant="secondary"
              @click="() => {
                const steps: CreatorStep[] = ['appearance', 'openclaw', 'agent'];
                const idx = steps.indexOf(currentStep);
                if (idx > 0) handleStepNavigate(steps[idx - 1]);
              }"
            >
              ← 上一步
            </StratixButton>
            <StratixButton
              v-if="currentStep !== 'agent'"
              size="sm"
              variant="primary"
              @click="goToNextStep"
            >
              下一步 →
            </StratixButton>
          </div>
        </main>

        <!-- 右侧面板：已保存角色 -->
        <aside class="right-panel">
          <CharacterList
            :characters="savedCharacters"
            :current-character-id="currentCharacter?.characterId"
            :is-loading="isLoadingCharacters"
            @load="handleLoadCharacter"
            @delete="handleDeleteClick"
            @set-default="handleSetDefault"
          />
        </aside>
      </div>

      <!-- Toast 消息 -->
      <div class="toast-container">
        <TransitionGroup name="toast">
          <div
            v-for="toast in toasts"
            :key="toast.id"
            :class="['toast', `toast-${toast.type}`]"
          >
            {{ toast.text }}
          </div>
        </TransitionGroup>
      </div>
    </div>
  </StratixModal>

  <!-- 删除确认弹窗 -->
  <StratixConfirmDialog
    :visible="showDeleteConfirm"
    type="warning"
    title="删除角色"
    content="确定删除这个角色吗？此操作不可恢复。"
    ok-text="删除"
    cancel-text="取消"
    :ok-danger="true"
    @update:visible="showDeleteConfirm = $event"
    @ok="confirmDelete"
    @cancel="showDeleteConfirm = false"
  />

  <!-- JSON 编辑器弹窗 -->
  <JsonEditor
    :visible="showJsonEditor"
    :parts="selectedParts"
    @close="showJsonEditor = false"
    @save="handleJsonSave"
  />
</template>

<style scoped>
.creator-container {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  background: var(--ds-bg-base);
  overflow: hidden;
}

/* 顶部栏 */
.creator-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--ds-bg-secondary);
  border-bottom: 1px solid var(--ds-border);
  gap: 16px;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 角色名称 */
.character-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'SF Mono', 'Monaco', monospace;
}

.name-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--ds-text-primary);
}

.name-edit-btn {
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

.name-edit-btn:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

.name-input {
  padding: 6px 10px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-color-primary);
  border-radius: 4px;
  color: var(--ds-text-primary);
  font-size: 14px;
  font-family: inherit;
  text-align: center;
  outline: none;
  min-width: 160px;
}

/* 主内容区 */
.creator-main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 左侧面板 */
.left-panel {
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

.canvas-area {
  flex: 1;
  min-height: 200px;
  border-radius: 8px;
  overflow: hidden;
}

.controls-area {
  flex-shrink: 0;
}

/* JSON 编辑器入口 */
.json-editor-entry {
  flex-shrink: 0;
}

.json-divider {
  height: 1px;
  background: var(--ds-border);
  opacity: 0.5;
  margin-bottom: 8px;
}

.json-editor-btn {
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  color: var(--ds-text-secondary);
  font-family: 'SF Mono', 'Monaco', monospace;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;
}

.json-editor-btn:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

/* 中间工作区 */
.center-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px;
  gap: 12px;
}

.step-navigator-area {
  flex-shrink: 0;
}

.step-content {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.step-panel {
  height: 100%;
  overflow: hidden;
}

.step-panel > * {
  height: 100%;
}

.step-actions {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-top: 8px;
}

/* 右侧面板 */
.right-panel {
  width: 280px;
  flex-shrink: 0;
  padding: 12px;
  background: var(--ds-bg-secondary);
  border-left: 1px solid var(--ds-border);
  overflow: hidden;
}

/* 滚动条 */
.left-panel::-webkit-scrollbar,
.right-panel::-webkit-scrollbar,
.step-content::-webkit-scrollbar {
  width: 6px;
}

.left-panel::-webkit-scrollbar-track,
.right-panel::-webkit-scrollbar-track,
.step-content::-webkit-scrollbar-track {
  background: var(--ds-bg-base);
}

.left-panel::-webkit-scrollbar-thumb,
.right-panel::-webkit-scrollbar-thumb,
.step-content::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: 3px;
}

.left-panel::-webkit-scrollbar-thumb:hover,
.right-panel::-webkit-scrollbar-thumb:hover,
.step-content::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary);
}

/* Toast 消息系统 */
.toast-container {
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

.toast {
  padding: 10px 20px;
  background: rgba(0, 0, 0, 0.85);
  border-radius: 6px;
  font-size: 13px;
  font-family: 'SF Mono', 'Monaco', monospace;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.toast-success {
  color: var(--ds-status-success, #34c759);
}

.toast-error {
  color: var(--ds-status-danger, #ff3b30);
}

.toast-info {
  color: var(--ds-color-primary, #007aff);
}

/* Toast 动画 */
.toast-enter-active {
  animation: toast-in 0.3s ease-out;
}

.toast-leave-active {
  animation: toast-out 0.3s ease-in;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes toast-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-20px);
  }
}
</style>
