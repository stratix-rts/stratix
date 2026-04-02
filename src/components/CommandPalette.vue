<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useCommandPalette } from '@/composables/useCommandPalette';
import SvgIcon from '@/components/ui/SvgIcon.vue';

const {
  isOpen,
  query,
  selectedIndex,
  groupedCommands,
  close,
  selectCommand,
  resetSelection,
} = useCommandPalette();

const inputRef = ref<HTMLInputElement | null>(null);

watch(isOpen, async (open) => {
  if (open) {
    await nextTick();
    inputRef.value?.focus();
    resetSelection();
  }
});

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    close();
  }
}

function getFlatIndex(category: string, localIndex: number): number {
  let flat = 0;
  for (const cat of ['Navigation', 'Actions', 'View'] as const) {
    if (cat === category) {
      return flat + localIndex;
    }
    flat += groupedCommands.value[cat].length;
  }
  return flat;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="command-palette">
      <div
        v-if="isOpen"
        class="command-palette-backdrop"
        @click="handleBackdropClick"
      >
        <div class="command-palette" role="dialog" aria-label="Command Palette">
          <div class="command-palette__search">
            <SvgIcon name="search" class="command-palette__search-icon" />
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              class="command-palette__input"
              placeholder="Type a command or search..."
              autocomplete="off"
              spellcheck="false"
            />
            <kbd class="command-palette__esc-hint">ESC</kbd>
          </div>

          <div class="command-palette__body">
            <template v-for="category in ['Navigation', 'Actions', 'View'] as const" :key="category">
              <div
                v-if="groupedCommands[category].length > 0"
                class="command-palette__group"
              >
                <div class="command-palette__category">{{ category }}</div>
                <div class="command-palette__list">
                  <button
                    v-for="(cmd, localIdx) in groupedCommands[category]"
                    :key="cmd.id"
                    class="command-palette__item"
                    :class="{ 'command-palette__item--selected': selectedIndex === getFlatIndex(category, localIdx) }"
                    @click="selectCommand(cmd)"
                    @mouseenter="selectedIndex = getFlatIndex(category, localIdx)"
                  >
                    <span class="command-palette__item-icon">
                      <SvgIcon v-if="cmd.icon" :name="cmd.icon" />
                    </span>
                    <span class="command-palette__item-name">{{ cmd.name }}</span>
                    <kbd v-if="cmd.shortcut" class="command-palette__item-shortcut">
                      {{ cmd.shortcut }}
                    </kbd>
                  </button>
                </div>
              </div>
            </template>

            <div v-if="Object.values(groupedCommands).every(g => g.length === 0)" class="command-palette__empty">
              No commands found
            </div>
          </div>

          <div class="command-palette__footer">
            <span class="command-palette__hint"><kbd>↑↓</kbd> navigate</span>
            <span class="command-palette__hint"><kbd>↵</kbd> select</span>
            <span class="command-palette__hint"><kbd>esc</kbd> close</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
@import '@/styles/command-palette.css';
</style>
