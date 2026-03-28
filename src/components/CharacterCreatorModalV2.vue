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
import BackendSelectorV2 from './BackendSelectorV2.vue';
import AgentConfigV2 from './AgentConfigV2.vue';
import type { AgentBackendType } from '@/stratix-core/stratix-protocol';
import type { OpenClawConfigLocal, StratixDirectConfig } from '../stratix-character-creator/types';
import type { PartMetadata } from '../stratix-character-creator/types';

// ==================== 常量：随机化配置 ====================
// 与旧版 CharacterCreatorScene 保持一致
const MINIMAL_SKIP_CATEGORIES = [
  'wings', 'wings_dots', 'wings_edge', 'tail',
  'weapon', 'weapon_magic_crystal', 'shield', 'shield_paint', 'shield_pattern', 'shield_trim',
  'backpack', 'backpack_straps', 'cargo', 'cape', 'cape_trim', 'quiver',
  'hat', 'hat_accessory', 'hat_buckle', 'hat_overlay', 'hat_trim',
  'bandana', 'bandana_overlay', 'headcover', 'headcover_rune', 'visor',
  'shoulders', 'neck', 'necklace', 'earrings', 'earring_left', 'earring_right',
  'charm', 'ring', 'sash', 'sash_tie', 'belt', 'buckles',
  'horns', 'fins', 'furry_ears', 'furry_ears_skin',
];

const OPTIONAL_CATEGORIES = ['quiver', 'shoulders', 'neck', 'backpack', 'cape', 'hat'];

const ALLOWED_SHIELDS = ['shield_heater_revised_wood', 'shield_heater_wood'];

const MINIMAL_HEAD_PREFIX = 'Human';

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

// Backend config state
const backendType = ref<AgentBackendType>('stratix');
const openClawConfig = ref<OpenClawConfigLocal>({ endpoint: '', accountId: '' });
const stratixConfig = ref<StratixDirectConfig>({
  provider: 'openai',
  model: 'gpt-4o',
  temperature: 0.7,
  maxTokens: 4096,
  maxShortTerm: 20,
  enableLongTerm: true,
});

// Agent config state
const agentSoul = ref({
  identity: '',
  goals: [] as string[],
  personality: '',
});
const agentRules = ref<string[]>([]);

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
    await partRegistry.loadMetadata();
    const loaded = await characterStorage.load(characterId);
    if (loaded) {
      characterState.character = loaded;
      characterName.value = loaded.name;
      selectedBodyType.value = loaded.bodyType;
      // Also load backend and agent configs if they exist
      if (loaded.backendType) backendType.value = loaded.backendType;
      if (loaded.openClawConfig) openClawConfig.value = loaded.openClawConfig;
      if (loaded.stratixConfig) stratixConfig.value = loaded.stratixConfig;
      if (loaded.soul) agentSoul.value = loaded.soul;
      if (loaded.rules) agentRules.value = loaded.rules;
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
    // 旧版会在创建时调用 randomizeCharacter('minimal')
    await randomizeCharacter('minimal');
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

// ==================== Backend Config Handlers ====================
const handleBackendChange = (type: AgentBackendType, config: OpenClawConfigLocal | StratixDirectConfig) => {
  backendType.value = type;
  if (type === 'openclaw') {
    openClawConfig.value = config as OpenClawConfigLocal;
  } else {
    stratixConfig.value = config as StratixDirectConfig;
  }
  if (characterState.character) {
    characterState.character.backendType = type;
    if (type === 'openclaw') {
      characterState.character.openClawConfig = config as OpenClawConfigLocal;
    } else {
      characterState.character.stratixConfig = config as StratixDirectConfig;
    }
    characterState.isDirty = true;
  }
};

// ==================== Agent Config Handlers ====================
const handleAgentChange = (config: { soul: { identity: string; goals: string[]; personality: string }; rules: string[] }) => {
  agentSoul.value = config.soul;
  agentRules.value = config.rules;
  if (characterState.character) {
    characterState.character.soul = config.soul;
    characterState.character.rules = config.rules;
    characterState.isDirty = true;
  }
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

  // Update all character fields before saving
  characterState.character.name = characterName.value;
  characterState.character.bodyType = selectedBodyType.value;
  characterState.character.backendType = backendType.value;
  characterState.character.openClawConfig = openClawConfig.value;
  characterState.character.stratixConfig = stratixConfig.value;
  characterState.character.soul = agentSoul.value;
  characterState.character.rules = agentRules.value;
  characterState.character.updatedAt = Date.now();

  try {
    await characterStorage.save(characterState.character);
    // Emit appropriate event based on mode
    if (props.editCharacterId) {
      emit('updated', characterState.character);
    } else {
      emit('created', characterState.character);
    }
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

const handlePartsChange = (parts: Record<string, PartSelection>) => {
  if (!characterState.character) return;
  characterState.character.parts = parts;
  characterState.isDirty = true;
  updatePreviewTexture();
};

// ==================== 随机化（与旧版 CharacterCreatorScene 保持一致）====================
type RandomizationMode = 'minimal' | 'normal' | 'full';

const randomizeCharacter = async (mode: RandomizationMode = 'normal') => {
  if (!characterState.character) return;

  const config = (() => {
    switch (mode) {
      case 'minimal':
        return {
          skipCategories: MINIMAL_SKIP_CATEGORIES,
          shieldMode: 'empty' as const,
          optionalEmptyChance: 1,
        };
      case 'normal':
        return {
          skipCategories: [] as string[],
          shieldMode: 'limited' as const,
          optionalEmptyChance: 0.5,
        };
      case 'full':
        return {
          skipCategories: [] as string[],
          shieldMode: 'all' as const,
          optionalEmptyChance: 0,
        };
    }
  })();

  const allParts = partRegistry.getAllParts();
  const allCategories = partRegistry.getAllCategories();
  const newParts: Record<string, PartSelection> = {};

  for (const category of allCategories) {
    // 跳过指定类别
    if (config.skipCategories.includes(category)) {
      continue;
    }

    // Shield 特殊处理
    if (category === 'shield') {
      if (config.shieldMode === 'empty') {
        delete newParts[category];
        continue;
      }
      if (config.shieldMode === 'limited') {
        if (Math.random() < 0.3) {
          delete newParts[category];
          continue;
        }
        const shieldId = ALLOWED_SHIELDS[Math.floor(Math.random() * ALLOWED_SHIELDS.length)];
        const shieldPart = allParts.find(p => p.itemId === shieldId);
        if (shieldPart) {
          const variant = shieldPart.variants?.[0] || 'default';
          newParts[category] = { itemId: shieldId, variant };
        }
        continue;
      }
      // shieldMode === 'all' 时走下面通用逻辑
    }

    // 可选类别随机空
    if (OPTIONAL_CATEGORIES.includes(category)) {
      if (Math.random() < config.optionalEmptyChance) {
        delete newParts[category];
        continue;
      }
    }

    // 获取当前体型可用的部件
    const catParts = allParts.filter(
      p => p.category === category && p.required.includes(selectedBodyType.value)
    );

    if (catParts.length === 0) continue;

    // Minimal 模式：head 类别优先选 Human 前缀的
    if (mode === 'minimal' && category === 'head') {
      const humanHeads = catParts.filter(p => p.itemId.startsWith(MINIMAL_HEAD_PREFIX));
      const sourceParts = humanHeads.length > 0 ? humanHeads : catParts;
      const selected = sourceParts[Math.floor(Math.random() * sourceParts.length)];
      const variant = selected.variants?.[0] || 'default';
      newParts[category] = { itemId: selected.itemId, variant };
      continue;
    }

    // 通用随机选择
    const selected = catParts[Math.floor(Math.random() * catParts.length)];
    const variant = selected.variants?.[0] || 'default';
    newParts[category] = { itemId: selected.itemId, variant };
  }

  characterState.character.parts = newParts;
  characterState.isDirty = true;
  await updatePreviewTexture();
};

const handleRandomize = async () => {
  await randomizeCharacter('normal');
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
              @parts-change="handlePartsChange"
              @randomize="handleRandomize"
              @next="goToNextStep"
            />
          </div>
        </div>

        <!-- OpenClaw Step -->
        <div v-if="currentStep === 'openclaw'" class="step-content">
          <h3 class="step-title">选择服务</h3>
          <p class="step-desc">选择AI后端服务</p>
          <div class="backend-selector-wrapper">
            <BackendSelectorV2
              :initial-backend-type="characterState.character?.backendType || 'stratix'"
              :initial-open-claw-config="characterState.character?.openClawConfig"
              :initial-stratix-config="characterState.character?.stratixConfig"
              @change="handleBackendChange"
              @prev="goToPrevStep"
              @next="goToNextStep"
            />
          </div>
        </div>

        <!-- Agent Step -->
        <div v-if="currentStep === 'agent'" class="step-content">
          <h3 class="step-title">配置AI</h3>
          <p class="step-desc">配置角色的灵魂、规则和技能</p>
          <div class="agent-config-wrapper">
            <AgentConfigV2
              :character="characterState.character"
              @change="handleAgentChange"
              @prev="goToPrevStep"
              @complete="handleComplete"
            />
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
  border: 2px solid var(--ds-border);
  border-top-color: var(--ds-brand-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  box-shadow: 0 0 10px var(--ds-brand-primary);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.creator-layout {
  display: flex;
  width: 100%;
  height: calc(100vh - 48px);
  background: linear-gradient(135deg, var(--ds-bg-primary) 0%, var(--ds-bg-secondary) 100%);
}

.left-panel {
  width: 340px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 20px;
  gap: 16px;
  border-right: 1px solid var(--ds-border);
  background: linear-gradient(180deg, var(--ds-bg-elevated) 0%, var(--ds-bg-primary) 100%);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.3);
}

.step-indicator {
  display: flex;
  gap: 6px;
  padding: 4px;
  background: var(--ds-bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--ds-border);
}

.step-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  font-size: 11px;
  font-weight: 500;
  color: var(--ds-text-muted);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.step-item:hover {
  background: var(--ds-bg-hover);
  color: var(--ds-text-secondary);
  border-color: var(--ds-border);
}

.step-item.active {
  background: linear-gradient(135deg, var(--ds-brand-primary) 0%, var(--ds-brand-secondary) 100%);
  border-color: var(--ds-brand-primary);
  color: var(--ds-text-inverse);
  box-shadow: 0 0 20px rgba(0, 204, 204, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.step-item.completed {
  background: linear-gradient(135deg, var(--ds-status-success) 0%, #00cc6a 100%);
  border-color: var(--ds-status-success);
  color: var(--ds-text-inverse);
  box-shadow: 0 0 15px rgba(0, 255, 136, 0.2);
}

.step-number {
  font-size: 10px;
  font-weight: 700;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 50%;
}

.step-label {
  font-size: 11px;
}

.canvas-container {
  flex: 1;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 12px;
  overflow: hidden;
  min-height: 240px;
  position: relative;
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.3), 0 0 1px var(--ds-border);
}

.canvas-container::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(0, 204, 204, 0.03) 0%, transparent 50%);
  pointer-events: none;
}

.preview-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  padding: 8px 12px;
  background: var(--ds-bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--ds-border);
}

.scale-label {
  font-size: 11px;
  color: var(--ds-brand-primary);
  min-width: 36px;
  text-align: center;
  font-weight: 600;
  font-family: 'SF Mono', monospace;
}

.name-input-section,
.body-type-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-label {
  font-size: 10px;
  color: var(--ds-text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.name-input {
  width: 100%;
  padding: 12px 14px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 8px;
  color: var(--ds-text-primary);
  font-size: 14px;
  outline: none;
  transition: all 0.2s;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
}

.name-input:focus {
  border-color: var(--ds-brand-primary);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2), 0 0 0 2px rgba(0, 204, 204, 0.15);
}

.body-type-buttons {
  display: flex;
  gap: 8px;
}

.right-panel {
  flex: 1;
  padding: 32px 40px;
  overflow-y: auto;
  background: var(--ds-bg-primary);
}

.step-content {
  max-width: 640px;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.step-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--ds-text-primary);
  margin: 0 0 8px 0;
  letter-spacing: -0.5px;
  background: linear-gradient(135deg, var(--ds-text-primary) 0%, var(--ds-brand-primary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.step-desc {
  font-size: 14px;
  color: var(--ds-text-muted);
  margin: 0 0 32px 0;
  font-weight: 400;
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
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--ds-border);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}

.part-selector-wrapper :deep(.part-selector) {
  overflow-y: auto;
}

.backend-selector-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--ds-border);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}

.backend-selector-wrapper :deep(.backend-selector) {
  overflow-y: auto;
  padding: 16px;
}

.agent-config-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--ds-border);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}
</style>
