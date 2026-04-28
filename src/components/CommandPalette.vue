<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import { useCommandPalette } from '@/composables/useCommandPalette';
import SvgIcon from '@/components/ui/SvgIcon.vue';
import { useUIStore } from '@/stores/ui';

const {
  isOpen,
  query,
  selectedIndex,
  groupedCommands,
  flatCommands,
  selectCommand,
  close,
  resetSelection,
} = useCommandPalette();

const uiStore = useUIStore();
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLDivElement | null>(null);
const itemRefs = ref<Map<number, HTMLElement>>(new Map());

watch(isOpen, async (open) => {
  if (open) {
    await nextTick();
    inputRef.value?.focus();
    resetSelection();
  }
});

// Watch selectedIndex to scroll into view
watch(selectedIndex, (idx) => {
  const el = itemRefs.value.get(idx);
  if (el) {
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
});

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    close();
  }
}

function getFlatIndex(category: string, localIndex: number): number {
  const cats = Object.keys(groupedCommands.value);
  let flat = 0;
  for (const cat of cats) {
    if (cat === category) {
      return flat + localIndex;
    }
    flat += groupedCommands.value[cat].length;
  }
  return flat;
}

function handleSelect(cmd: any) {
  selectCommand(cmd);
  uiStore.addToast({
    type: 'success',
    message: `执行: ${cmd.name}`,
    duration: 1500,
  });
}

function setItemRef(el: HTMLElement | null, index: number) {
  if (el) {
    itemRefs.value.set(index, el);
  }
}

// Compute stagger delay for each item
function getItemStyle(index: number) {
  return {
    animationDelay: `${index * 20}ms`,
  };
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
              placeholder="输入命令或搜索..."
              autocomplete="off"
              spellcheck="false"
            />
            <kbd class="command-palette__esc-hint">ESC</kbd>
          </div>

          <div ref="listRef" class="command-palette__body">
            <template v-for="(commands, category) in groupedCommands" :key="category">
              <div
                v-if="commands.length > 0"
                class="command-palette__group"
              >
                <div class="command-palette__category">{{ category }}</div>
                <div class="command-palette__list">
                  <button
                    v-for="(cmd, localIdx) in commands"
                    :key="cmd.id"
                    class="command-palette__item"
                    :class="{ 'command-palette__item--selected': selectedIndex === getFlatIndex(category, localIdx) }"
                    :style="getItemStyle(getFlatIndex(category, localIdx))"
                    @click="handleSelect(cmd)"
                    @mouseenter="selectedIndex = getFlatIndex(category, localIdx)"
                    :ref="(el) => setItemRef(el as HTMLElement, getFlatIndex(category, localIdx))"
                  >
                    <span class="command-palette__item-icon">
                      <SvgIcon v-if="cmd.icon" :name="cmd.icon" :size="16" />
                      <span v-else class="command-palette__item-bullet"></span>
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
              <SvgIcon name="search" :size="32" :stroke-width="1" />
              <p>未找到命令</p>
            </div>
          </div>

          <div class="command-palette__footer">
            <span class="command-palette__hint"><kbd>↑↓</kbd> 导航</span>
            <span class="command-palette__hint"><kbd>↵</kbd> 执行</span>
            <span class="command-palette__hint"><kbd>esc</kbd> 关闭</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
@import '@/styles/command-palette.css';

/* Override and extend command-palette styles */

.command-palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.command-palette {
  width: 100%;
  max-width: 560px;
  background: var(--ds-glass-bg, var(--ds-bg-secondary, #1a1d27));
  border: var(--ds-glass-border, 1px solid var(--ds-border, rgba(255, 255, 255, 0.08)));
  border-radius: 12px;
  box-shadow: var(--ds-glass-shadow,
    0 0 0 1px rgba(255, 255, 255, 0.05) inset,
    0 8px 32px rgba(0, 0, 0, 0.4),
    0 2px 8px rgba(0, 0, 0, 0.2));
  backdrop-filter: blur(var(--ds-glass-blur, 12px)) saturate(var(--ds-glass-saturate, 120%));
  -webkit-backdrop-filter: blur(var(--ds-glass-blur, 12px)) saturate(var(--ds-glass-saturate, 120%));
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.command-palette__search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ds-border, rgba(255, 255, 255, 0.06));
  background: rgba(255, 255, 255, 0.02);
}

.command-palette__search-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  color: var(--ds-text-muted, #8b8fa3);
}

.command-palette__input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 15px;
  color: var(--ds-text-primary, #e4e4e7);
  caret-color: var(--ds-color-primary, #6366f1);
  transition: box-shadow 0.15s ease;
}

.command-palette__input:focus {
  box-shadow: none;
}

.command-palette__search:focus-within {
  box-shadow: 0 0 0 3px var(--ds-border-focus);
  border-radius: 8px;
  margin: -1px;
  padding: 15px 17px;
}

.command-palette__input::placeholder {
  color: var(--ds-text-muted, #8b8fa3);
}

.command-palette__esc-hint {
  flex-shrink: 0;
  padding: 3px 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  font-size: 11px;
  font-family: inherit;
  color: var(--ds-text-muted, #8b8fa3);
}

.command-palette__body {
  max-height: 340px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px;
}

.command-palette__body::-webkit-scrollbar {
  width: 6px;
}

.command-palette__body::-webkit-scrollbar-track {
  background: transparent;
}

.command-palette__body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

.command-palette__group {
  margin-bottom: 8px;
}

.command-palette__category {
  position: sticky;
  top: 0;
  padding: 6px 10px 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--ds-text-muted, #8b8fa3);
  background: var(--ds-glass-bg, var(--ds-bg-secondary, #1a1d27));
  z-index: 1;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.command-palette__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.command-palette__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-left: 3px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s ease, border-color 0.1s ease, transform 0.1s ease;
  opacity: 0;
  animation: ds-item-stagger 200ms ease forwards;
}

@keyframes ds-item-stagger {
  from {
    opacity: 0;
    transform: translateX(-4px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.command-palette__item:hover,
.command-palette__item--selected {
  background: rgba(99, 102, 241, 0.12);
  border-left-color: var(--ds-color-primary, #6366f1);
}

.command-palette__item--selected {
  background: rgba(99, 102, 241, 0.18);
}

.command-palette__item-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--ds-text-secondary, #a1a1aa);
}

.command-palette__item--selected .command-palette__item-icon {
  color: var(--ds-color-primary, #6366f1);
}

.command-palette__item-bullet {
  width: 6px;
  height: 6px;
  background: var(--ds-text-muted);
  border-radius: 50%;
  opacity: 0.5;
}

.command-palette__item-name {
  flex: 1;
  font-size: 14px;
  color: var(--ds-text-primary, #e4e4e7);
}

.command-palette__item-shortcut {
  flex-shrink: 0;
  padding: 3px 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  font-size: 11px;
  font-family: inherit;
  color: var(--ds-text-muted, #8b8fa3);
}

.command-palette__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  text-align: center;
  font-size: 14px;
  color: var(--ds-text-muted, #8b8fa3);
}

.command-palette__footer {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  border-top: 1px solid var(--ds-border, rgba(255, 255, 255, 0.06));
  background: rgba(255, 255, 255, 0.01);
}

.command-palette__hint {
  font-size: 12px;
  color: var(--ds-text-muted, #8b8fa3);
}

.command-palette__hint kbd {
  padding: 2px 5px;
  margin-right: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  font-family: inherit;
}

/* Transitions */
.command-palette-enter-active,
.command-palette-leave-active {
  transition: opacity 200ms var(--ds-animation-easing-ease-out, ease-out);
}

.command-palette-enter-active .command-palette,
.command-palette-leave-active .command-palette {
  transition: transform 200ms var(--ds-animation-easing-ease-out, ease-out),
              opacity 200ms var(--ds-animation-easing-ease-out, ease-out);
}

.command-palette-enter-from,
.command-palette-leave-to {
  opacity: 0;
}

.command-palette-enter-from .command-palette,
.command-palette-leave-to .command-palette {
  transform: scale(0.95);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .command-palette__item {
    animation: none;
    opacity: 1;
  }

  .command-palette-enter-active,
  .command-palette-leave-active,
  .command-palette-enter-active .command-palette,
  .command-palette-leave-active .command-palette {
    transition-duration: 0.01ms !important;
  }
}
</style>
