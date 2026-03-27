<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { StratixModal, StratixButton, SvgIcon } from '@/components/ui';
import { StratixConfirmDialog } from '@/components/ui/StratixConfirmDialog';
import { getToken } from '@/design-system/config';
import { createCharacterCreator } from '../stratix-character-creator';
import type { SavedCharacter } from '../stratix-character-creator/types';
import { StratixEventBus } from '../stratix-core';

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

const containerRef = ref<HTMLElement | null>(null);
const game = ref<Phaser.Game | null>(null);
const eventBus = StratixEventBus.getInstance();

// Dialog state
const confirmDialogVisible = ref(false);
const confirmDialogMessage = ref('');
const confirmDialogResolve = ref<((value: boolean) => void) | null>(null);

const promptDialogVisible = ref(false);
const promptDialogMessage = ref('');
const promptDialogDefaultValue = ref('');
const promptDialogResolve = ref<((value: string | null) => void) | null>(null);

const initGame = () => {
  if (!containerRef.value || game.value) return;

  game.value = createCharacterCreator({
    parent: containerRef.value,
    width: containerRef.value.clientWidth || 1200,
    height: containerRef.value.clientHeight || 800,
    targetCharacterId: props.editCharacterId,
    onCharacterCreated: (character: SavedCharacter) => {
      emit('created', character);
    },
    onCharacterUpdated: (character: SavedCharacter) => {
      emit('updated', character);
    },
    onCharacterDeleted: (characterId: string) => {
      emit('deleted', characterId);
    },
    onRequestConfirm: (message: string): Promise<boolean> => {
      return new Promise((resolve) => {
        confirmDialogMessage.value = message;
        confirmDialogResolve.value = resolve;
        confirmDialogVisible.value = true;
      });
    },
    onRequestPrompt: (message: string, defaultValue?: string): Promise<string | null> => {
      return new Promise((resolve) => {
        promptDialogMessage.value = message;
        promptDialogDefaultValue.value = defaultValue || '';
        promptDialogResolve.value = resolve;
        promptDialogVisible.value = true;
      });
    },
  });
};

const destroyGame = () => {
  if (game.value) {
    game.value.destroy(true);
    game.value = null;
  }
};

watch(() => props.visible, (visible) => {
  if (visible) {
    setTimeout(initGame, 100);
  } else {
    destroyGame();
  }
});

onMounted(() => {
  if (props.visible) {
    setTimeout(initGame, 100);
  }
});

onUnmounted(() => {
  destroyGame();
});

const handleClose = () => {
  emit('close');
};

// Confirm dialog handlers
const handleConfirmOk = () => {
  confirmDialogResolve.value?.(true);
  confirmDialogVisible.value = false;
};

const handleConfirmCancel = () => {
  confirmDialogResolve.value?.(false);
  confirmDialogVisible.value = false;
};

// Prompt dialog handlers
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
    <div ref="containerRef" class="game-container"></div>
  </StratixModal>

  <!-- Confirm Dialog -->
  <StratixConfirmDialog
    v-model:visible="confirmDialogVisible"
    type="confirm"
    :title="'确认'"
    :content="confirmDialogMessage"
    ok-text="确定"
    cancel-text="取消"
    @ok="handleConfirmOk"
    @cancel="handleConfirmCancel"
  />

  <!-- Prompt Dialog (using StratixModal) -->
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
.game-container {
  width: 100%;
  height: calc(100vh - 48px);
  background: #0d0d14;
  position: relative;
}
</style>
