<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { StratixModal, StratixButton, SvgIcon } from '@/components/ui';
import { getToken } from '@/design-system/config';
import { createCharacterCreator } from '../stratix-character-creator';
import type { SavedCharacter } from '../stratix-character-creator/types';
import { StratixEventBus } from '../stratix-core';

const x = 'x';

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
    }
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
</template>

<style scoped>
.game-container {
  width: 100%;
  height: calc(100vh - 48px);
  background: #0d0d14;
  position: relative;
}
</style>
