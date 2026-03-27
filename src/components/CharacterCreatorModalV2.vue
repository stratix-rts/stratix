<script setup lang="ts">
/**
 * CharacterCreatorModalV2 - 新版角色创建弹窗
 * 纯Vue为主架构，局部使用Phaser Canvas渲染角色预览
 */
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import { StratixModal, StratixButton, StratixConfirmDialog } from '@/components/ui';
import type { SavedCharacter, CreatorStep, AnimationName, PartCategory, PartSelection } from '../stratix-character-creator/types';
import { characterStorage, partRegistry, characterComposer } from '../stratix-character-creator';
import { DEFAULT_BODY_TYPE } from '../stratix-character-creator/constants';
import { CanvasPreviewScene } from './CanvasPreviewScene';
import PartSelectorV2 from './PartSelectorV2.vue';

// ==================== Types ====================
interface PreviewState {
  animation: AnimationName;
  direction: number;
  scale: number;
}

interface CharacterState {
  character: SavedCharacter | null;
  isDirty: boolean;
  isLoading: boolean;
}

// ==================== Props & Emits ====================
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

// ==================== Refs ====================
const canvasContainerRef = ref<HTMLElement | null>(null);
const phaserGame = ref<Phaser.Game | null>(null);
const previewScene = ref<CanvasPreviewScene | null>(null);

// ==================== State ====================
const currentStep = ref<CreatorStep>('appearance');
const previewState = reactive<PreviewState>({
  animation: 'idle',
  direction: 2, // 默认朝下
  scale: 2,
});

const characterState = reactive<CharacterState>({
  character: null,
  isDirty: false,
  isLoading: true,
});

const characterName = ref('');
const selectedBodyType = ref<typeof DEFAULT_BODY_TYPE>(DEFAULT_BODY_TYPE);

// Steps
const steps = [
  { key: 'appearance', label: '外观' },
  { key: 'openclaw', label: '服务' },
  { key: 'agent', label: 'AI' },
] as const;

const currentStepIndex = computed(() => steps.findIndex(s => s.key === currentStep.value));

// ==================== Dialog State ====================
const confirmDialogVisible = ref(false);
const confirmDialogMessage = ref('');
const confirmDialogResolve = ref<((value: boolean) => void) | null>(null);

const promptDialogVisible = ref(false);
const promptDialogMessage = ref('');
const promptDialogDefaultValue = ref('');
const promptDialogResolve = ref<((value: string | null) => void) | null>(null);

// ==================== Character Operations ====================
const loadCharacter = async (characterId: string) => {
  try {
    await characterStorage.init();
    const loaded = await characterStorage.load(characterId);
    if (loaded) {
      characterState.character = loaded;
      characterName.value = loaded.name;
      selectedBodyType.value = loaded.bodyType;
    }
  } catch (error) {
    console.error('[V2] Failed to load character:', error);
  }
};

const createNewCharacter = async () => {
  try {
    await characterStorage.init();
    await partRegistry.loadMetadata();
    const newChar = characterStorage.createNew(DEFAULT_BODY_TYPE);
    characterState.character = newChar;
    characterName.value = newChar.name;
  } catch (error) {
    console.error('[V2] Failed to create character:', error);
  }
};

const updateCharacterName = (name: string) => {
  characterName.value = name;
  if (characterState.character) {
    characterState.character.name = name;
    characterState.isDirty = true;
  }
};

const updatePreviewTexture = async () => {
  if (!characterState.character || !previewScene.value) return;
  try {
    const canvas = await characterComposer.compose(
      characterState.character.bodyType,
      characterState.character.parts
    );
    previewScene.value.updateTextureFromCanvas(canvas);
  } catch (error) {
    console.error('[V2] Failed to update preview:', error);
  }
};

// ==================== Step Navigation ====================
const goToNextStep = () => {
  const idx = currentStepIndex.value;
  if (idx < steps.length - 1) {
    currentStep.value = steps[idx + 1].key;
  }
};

const goToPrevStep = () => {
  const idx = currentStepIndex.value;
  if (idx > 0) {
    currentStep.value = steps[idx - 1].key;
  }
};

const goToStep = (step: CreatorStep) => {
  currentStep.value = step;
};

// ==================== Preview Controls ====================
const cycleDirection = () => {
  previewState.direction = (previewState.direction + 1) % 4;
  previewScene.value?.setDirection(previewState.direction);
};

const cycleAnimation = () => {
  const animations: AnimationName[] = ['idle', 'walk', 'run', 'attack'];
  const idx = animations.indexOf(previewState.animation);
  previewState.animation = animations[(idx + 1) % animations.length];
  previewScene.value?.setAnimation(previewState.animation);
};

const handleZoomIn = () => {
  previewState.scale = Math.min(4, previewState.scale + 0.5);
  previewScene.value?.setScale(previewState.scale);
};

const handleZoomOut = () => {
  previewState.scale = Math.max(0.5, previewState.scale - 0.5);
  previewScene.value?.setScale(previewState.scale);
};

// ==================== Complete ====================
const handleComplete = async () => {
  if (!characterState.character) return;

  characterState.character.name = characterName.value;
  characterState.character.bodyType = selectedBodyType.value;
  characterState.character.updatedAt = Date.now();

  try {
    await characterStorage.save(characterState.character);
    emit('created', characterState.character);
    emit('close');
  } catch (error) {
    console.error('[V2] Failed to save character:', error);
  }
};

// ==================== Dialog Handlers ====================
const showConfirm = (message: string): Promise<boolean> => {
  return new Promise((resolve) => {
    confirmDialogMessage.value = message;
    confirmDialogResolve.value = resolve;
    confirmDialogVisible.value = true;
  });
};

const showPrompt = (message: string, defaultValue?: string): Promise<string | null> => {
  return new Promise((resolve) => {
    promptDialogMessage.value = message;
    promptDialogDefaultValue.value = defaultValue || '';
    promptDialogResolve.value = resolve;
    promptDialogVisible.value = true;
  });
};

const handleConfirmOk = () => {
  confirmDialogResolve.value?.(true);
  confirmDialogVisible.value = false;
};

const handleConfirmCancel = () => {
  confirmDialogResolve.value?.(false);
  confirmDialogVisible.value = false;
};

const promptInputValue = ref('');
const handlePromptOk = () => {
  promptDialogResolve.value?.(promptInputValue.value);
  promptDialogVisible.value = false;
  promptInputValue.value = '';
};

const handlePromptCancel = () => {
  promptDialogResolve.value?.(null);
  promptDialogVisible.value = false;
  promptInputValue.value = '';
};

watch(promptDialogVisible, (visible) => {
  if (visible) {
    promptInputValue.value = promptDialogDefaultValue.value;
  }
});

// ==================== Lifecycle ====================
const initPhaserCanvas = () => {
  if (!canvasContainerRef.value || phaserGame.value) return;

  import('phaser').then(({ default: Phaser }) => {
    const width = canvasContainerRef.value?.clientWidth || 280;
    const height = canvasContainerRef.value?.clientHeight || 320;

    const gameConfig: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: canvasContainerRef.value!,
      width,
      height,
      backgroundColor: 0x1a1a2e,
      pixelArt: true,
      scene: [CanvasPreviewScene],
    };

    phaserGame.value = new Phaser.Game(gameConfig);

    // Get scene reference after game is ready
    phaserGame.value.events.once('ready', () => {
      const scene = phaserGame.value?.scene.getScene('CanvasPreviewScene') as CanvasPreviewScene;
      if (scene) {
        previewScene.value = scene;
        // Initialize with current preview state
        scene.setAnimation(previewState.animation);
        scene.setDirection(previewState.direction);
        scene.setScale(previewState.scale);
        // Update texture if character is loaded
        if (characterState.character) {
          updatePreviewTexture();
        }
      }
    });
  });
};

const destroyPhaserCanvas = () => {
  if (phaserGame.value) {
    phaserGame.value.destroy(true);
    phaserGame.value = null;
    previewScene.value = null;
  }
};

watch(() => props.visible, async (visible) => {
  if (visible) {
    characterState.isLoading = true;
    if (props.editCharacterId) {
      await loadCharacter(props.editCharacterId);
    } else {
      await createNewCharacter();
    }
    characterState.isLoading = false;
    // Init Phaser after DOM is ready
    setTimeout(initPhaserCanvas, 100);
  } else {
    destroyPhaserCanvas();
  }
});

onMounted(() => {
  if (props.visible) {
    setTimeout(initPhaserCanvas, 100);
  }
});

onUnmounted(() => {
  destroyPhaserCanvas();
});

const handleClose = () => {
  emit('close');
};

// ==================== PartSelectorV2 Event Handlers ====================
const handlePartSelected = (category: PartCategory, itemId: string, variant: string) => {
  if (!characterState.character) return;
  characterState.character.parts = {
    ...characterState.character.parts,
    [category]: { itemId, variant }
  };
  characterState.isDirty = true;
  updatePreviewTexture();
};

const handleRandomize = async () => {
  if (!characterState.character) return;
  try {
    await partRegistry.loadMetadata();
    const allParts = partRegistry.getAllParts();
    const randomParts: Record<string, PartSelection> = {};

    // Get unique categories from available parts
    const categories = [...new Set(allParts.map(p => p.category))];

    for (const cat of categories) {
      const catParts = allParts.filter(p => p.category === cat && p.required.includes(selectedBodyType.value));
      if (catParts.length > 0) {
        const randomPart = catParts[Math.floor(Math.random() * catParts.length)];
        const variant = randomPart.variants?.[0] || 'default';
        randomParts[cat] = { itemId: randomPart.itemId, variant };
      }
    }

    characterState.character.parts = randomParts;
    characterState.isDirty = true;
    updatePreviewTexture();
  } catch (error) {
    console.error('[V2] Failed to randomize:', error);
  }
};
</script>

<template>
  <StratixModal
    :visible="visible"
    @update:visible="$emit('close')"
    :title="editCharacterId ? '编辑角色' : '创建角色'"
    size="fullscreen"
    :closable="true"
    @close="handleClose"
  >
    <!-- Loading State -->
    <div v-if="characterState.isLoading" class="loading-container">
      <div class="loading-spinner"></div>
      <span>加载中...</span>
    </div>

    <!-- Main Content -->
    <div v-else class="creator-layout">
      <!-- Left Panel: Preview -->
      <div class="left-panel">
        <!-- Step Indicator -->
        <div class="step-indicator">
          <div
            v-for="(step, idx) in steps"
            :key="step.key"
            class="step-item"
            :class="{ active: idx === currentStepIndex, completed: idx < currentStepIndex }"
            @click="goToStep(step.key)"
          >
            <span class="step-number">{{ idx + 1 }}</span>
            <span class="step-label">{{ step.label }}</span>
          </div>
        </div>

        <!-- Canvas Preview -->
        <div ref="canvasContainerRef" class="canvas-container">
          <!-- Phaser Canvas renders here -->
        </div>

        <!-- Preview Controls -->
        <div class="preview-controls">
          <StratixButton variant="ghost" size="sm" @click="cycleDirection">
            方向 {{ ['下', '左', '上', '右'][previewState.direction] }}
          </StratixButton>
          <StratixButton variant="ghost" size="sm" @click="cycleAnimation">
            {{ previewState.animation }}
          </StratixButton>
          <StratixButton variant="ghost" size="sm" @click="handleZoomOut">-</StratixButton>
          <span class="scale-label">{{ previewState.scale }}x</span>
          <StratixButton variant="ghost" size="sm" @click="handleZoomIn">+</StratixButton>
        </div>

        <!-- Name Input -->
        <div class="name-input-section">
          <label class="input-label">角色名称</label>
          <input
            type="text"
            class="name-input"
            :value="characterName"
            @input="updateCharacterName(($event.target as HTMLInputElement).value)"
            placeholder="输入角色名称..."
          />
        </div>

        <!-- Body Type Selector -->
        <div class="body-type-section">
          <label class="input-label">体型</label>
          <div class="body-type-buttons">
            <StratixButton
              v-for="bodyType in ['male', 'female', 'teen']"
              :key="bodyType"
              :variant="selectedBodyType === bodyType ? 'primary' : 'secondary'"
              size="sm"
              @click="selectedBodyType = bodyType as any"
            >
              {{ bodyType }}
            </StratixButton>
          </div>
        </div>
      </div>

      <!-- Right Panel: Content -->
      <div class="right-panel">
        <!-- Appearance Step -->
        <div v-if="currentStep === 'appearance'" class="step-content">
          <h3 class="step-title">选择外观</h3>
          <p class="step-desc">选择角色的身体部件和外观</p>
          <div class="part-selector-wrapper">
            <PartSelectorV2
              :body-type="selectedBodyType"
              :selections="characterState.character?.parts || {}"
              @part-selected="handlePartSelected"
              @randomize="handleRandomize"
              @next="goToNextStep"
            />
          </div>
        </div>

        <!-- OpenClaw Step -->
        <div v-if="currentStep === 'openclaw'" class="step-content">
          <h3 class="step-title">选择服务</h3>
          <p class="step-desc">选择AI后端服务</p>
          <!-- BackendSelector will go here -->
          <div class="placeholder-content">
            <StratixButton variant="secondary" @click="goToPrevStep">
              上一步
            </StratixButton>
            <StratixButton variant="primary" @click="goToNextStep">
              下一步：配置AI
            </StratixButton>
          </div>
        </div>

        <!-- Agent Step -->
        <div v-if="currentStep === 'agent'" class="step-content">
          <h3 class="step-title">配置AI</h3>
          <p class="step-desc">配置角色的灵魂、规则和技能</p>
          <!-- AgentConfigPanel will go here -->
          <div class="placeholder-content">
            <StratixButton variant="secondary" @click="goToPrevStep">
              上一步
            </StratixButton>
            <StratixButton variant="primary" @click="handleComplete">
              完成创建
            </StratixButton>
          </div>
        </div>
      </div>
    </div>
  </StratixModal>

  <!-- Confirm Dialog -->
  <StratixConfirmDialog
    v-model:visible="confirmDialogVisible"
    type="confirm"
    title="确认"
    :content="confirmDialogMessage"
    ok-text="确定"
    cancel-text="取消"
    @ok="handleConfirmOk"
    @cancel="handleConfirmCancel"
  />

  <!-- Prompt Dialog -->
  <StratixModal
    v-model:visible="promptDialogVisible"
    :title="promptDialogMessage"
    size="sm"
    :mask-closable="false"
    @close="handlePromptCancel"
  >
    <div style="padding: 16px;">
      <input
        v-model="promptInputValue"
        type="text"
        style="
          width: 100%;
          padding: 8px 12px;
          background: var(--ds-bg-tertiary);
          border: 1px solid var(--ds-border);
          border-radius: 6px;
          color: var(--ds-text-primary);
          font-size: 14px;
          outline: none;
        "
        @keyup.enter="handlePromptOk"
      />
    </div>
    <template #footer>
      <StratixButton variant="secondary" size="sm" @click="handlePromptCancel">
        取消
      </StratixButton>
      <StratixButton variant="primary" size="sm" @click="handlePromptOk">
        确定
      </StratixButton>
    </template>
  </StratixModal>
</template>

<style scoped>
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: var(--ds-text-muted);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--ds-border);
  border-top-color: var(--ds-brand-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.creator-layout {
  display: flex;
  width: 100%;
  height: calc(100vh - 48px);
  background: var(--ds-bg-secondary);
}

.left-panel {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 12px;
  border-right: 1px solid var(--ds-border);
}

.step-indicator {
  display: flex;
  gap: 8px;
}

.step-item {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.step-item:hover {
  border-color: var(--ds-brand-primary);
}

.step-item.active {
  background: var(--ds-brand-primary);
  border-color: var(--ds-brand-primary);
  color: var(--ds-text-inverse);
}

.step-item.completed {
  background: var(--ds-status-success);
  border-color: var(--ds-status-success);
  color: white;
}

.step-number {
  font-size: 12px;
  font-weight: 600;
}

.step-label {
  font-size: 12px;
}

.canvas-container {
  flex: 1;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 8px;
  overflow: hidden;
  min-height: 200px;
}

.preview-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: center;
}

.scale-label {
  font-size: 12px;
  color: var(--ds-text-muted);
  min-width: 32px;
  text-align: center;
}

.name-input-section,
.body-type-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-label {
  font-size: 11px;
  color: var(--ds-text-muted);
  font-weight: 500;
}

.name-input {
  width: 100%;
  padding: 8px 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  color: var(--ds-text-primary);
  font-size: 14px;
  outline: none;
}

.name-input:focus {
  border-color: var(--ds-brand-primary);
}

.body-type-buttons {
  display: flex;
  gap: 4px;
}

.right-panel {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.step-content {
  max-width: 600px;
}

.step-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--ds-text-primary);
  margin: 0 0 8px 0;
}

.step-desc {
  font-size: 14px;
  color: var(--ds-text-muted);
  margin: 0 0 24px 0;
}

.placeholder-content {
  display: flex;
  gap: 12px;
  padding: 48px;
  background: var(--ds-bg-tertiary);
  border: 1px dashed var(--ds-border);
  border-radius: 8px;
  justify-content: center;
  align-items: center;
}

.part-selector-wrapper {
  flex: 1;
  min-height: 400px;
  display: flex;
  flex-direction: column;
}
</style>
