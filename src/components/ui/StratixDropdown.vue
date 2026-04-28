<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { Depth } from '@/design-system/tokens/depth';
import SvgIcon from './SvgIcon.vue';

export interface DropdownOption {
  label: string;
  value: string | number;
  icon?: string;
  color?: string;
  disabled?: boolean;
  divided?: boolean;
  shortcut?: string;
  group?: string;
}

interface Props {
  options: DropdownOption[];
  trigger?: 'click' | 'hover';
  placement?: 'bottom' | 'top' | 'left' | 'right';
  size?: SizeVariant;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  trigger: 'click',
  placement: 'bottom',
  size: 'md',
  disabled: false,
});

const emit = defineEmits<{
  select: [value: string | number, option: DropdownOption];
}>();

const visible = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const dropdownRef = ref<HTMLElement | null>(null);

const zIndex = Depth.popup;

const dropdownStyle = computed(() => {
  if (!triggerRef.value) return {};
  
  const rect = triggerRef.value.getBoundingClientRect();
  const style: Record<string, string> = {
    zIndex: String(zIndex),
  };
  
  switch (props.placement) {
    case 'bottom':
      style.top = `${rect.bottom + 4}px`;
      style.left = `${rect.left}px`;
      break;
    case 'top':
      style.bottom = `${window.innerHeight - rect.top + 4}px`;
      style.left = `${rect.left}px`;
      break;
    case 'left':
      style.top = `${rect.top}px`;
      style.right = `${window.innerWidth - rect.left + 4}px`;
      break;
    case 'right':
      style.top = `${rect.top}px`;
      style.left = `${rect.right + 4}px`;
      break;
  }
  
  return style;
});

const sizeClass = computed(() => `stratix-dropdown--${props.size}`);

const groupedOptions = computed(() => {
  const groups: Record<string, DropdownOption[]> = {};
  const ungrouped: DropdownOption[] = [];
  props.options.forEach(opt => {
    if (opt.group) {
      groups[opt.group] = groups[opt.group] || [];
      groups[opt.group].push(opt);
    } else {
      ungrouped.push(opt);
    }
  });
  return { groups, ungrouped };
});

const handleToggle = () => {
  if (props.disabled) return;
  visible.value = !visible.value;
};

const handleSelect = (option: DropdownOption) => {
  if (option.disabled) return;
  emit('select', option.value, option);
  visible.value = false;
};

const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  if (
    triggerRef.value?.contains(target) ||
    dropdownRef.value?.contains(target)
  ) {
    return;
  }
  visible.value = false;
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    visible.value = false;
  }
};

const stopPropagation = (e: Event) => {
  e.stopPropagation();
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside, true);
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside, true);
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div 
    ref="triggerRef"
    class="stratix-dropdown-trigger"
    :class="{ 'stratix-dropdown-trigger--disabled': disabled }"
    @click="handleToggle"
  >
    <slot />
  </div>
  
  <Teleport to="body">
    <Transition name="stratix-dropdown">
      <div
        v-if="visible"
        ref="dropdownRef"
        class="stratix-dropdown"
        :class="[sizeClass]"
        :style="dropdownStyle"
        @click.stop="stopPropagation"
      >
        <div class="stratix-dropdown__menu">
          <!-- Ungrouped items -->
          <template v-for="(option, index) in groupedOptions.ungrouped" :key="option.value">
            <div 
              v-if="option.divided && index > 0" 
              class="stratix-dropdown__divider"
            />
            <div
              class="stratix-dropdown__item"
              :class="{ 
                'stratix-dropdown__item--disabled': option.disabled 
              }"
              @click="handleSelect(option)"
            >
              <span 
                v-if="option.color" 
                class="stratix-dropdown__indicator"
                :style="{ background: option.color }"
              />
              <SvgIcon 
                v-else-if="option.icon" 
                :name="option.icon" 
                :size="14"
                class="stratix-dropdown__icon"
              />
              <span class="stratix-dropdown__label">{{ option.label }}</span>
              <span v-if="option.shortcut" class="stratix-dropdown__shortcut">{{ option.shortcut }}</span>
            </div>
          </template>

          <!-- Grouped items -->
          <template v-for="(items, groupName) in groupedOptions.groups" :key="groupName">
            <div class="stratix-dropdown__group-header">{{ groupName }}</div>
            <template v-for="option in items" :key="option.value">
              <div
                class="stratix-dropdown__item"
                :class="{ 
                  'stratix-dropdown__item--disabled': option.disabled 
                }"
                @click="handleSelect(option)"
              >
                <span 
                  v-if="option.color" 
                  class="stratix-dropdown__indicator"
                  :style="{ background: option.color }"
                />
                <SvgIcon 
                  v-else-if="option.icon" 
                  :name="option.icon" 
                  :size="14"
                  class="stratix-dropdown__icon"
                />
                <span class="stratix-dropdown__label">{{ option.label }}</span>
                <span v-if="option.shortcut" class="stratix-dropdown__shortcut">{{ option.shortcut }}</span>
              </div>
            </template>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.stratix-dropdown-trigger {
  display: inline-flex;
  cursor: pointer;
}

.stratix-dropdown-trigger--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stratix-dropdown {
  position: fixed;
  background: var(--ds-glass-bg, var(--ds-bg-secondary));
  border: var(--ds-glass-border, 1px solid var(--ds-border-default));
  border-radius: var(--ds-radius-md);
  box-shadow: var(--ds-glass-shadow, var(--ds-shadow-md));
  backdrop-filter: blur(var(--ds-glass-blur)) saturate(var(--ds-glass-saturate));
  -webkit-backdrop-filter: blur(var(--ds-glass-blur)) saturate(var(--ds-glass-saturate));
  min-width: 140px;
  overflow: hidden;
}

.stratix-dropdown__menu {
  padding: var(--ds-spacing-xs);
  max-height: 320px;
  overflow-y: auto;
}

.stratix-dropdown__group-header {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: var(--ds-spacing-xs) var(--ds-spacing-md);
  font-size: var(--ds-font-size-xs);
  font-weight: 600;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: var(--ds-glass-bg, var(--ds-bg-secondary));
  backdrop-filter: blur(4px);
}

.stratix-dropdown__item {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  border-radius: var(--ds-radius-sm);
  cursor: pointer;
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-primary);
  transition: all var(--ds-animation-duration-fast) ease;
}

.stratix-dropdown__item:hover:not(.stratix-dropdown__item--disabled) {
  background: var(--ds-bg-tertiary);
}

.stratix-dropdown__item:hover:not(.stratix-dropdown__item--disabled) .stratix-dropdown__icon {
  transform: translateX(2px);
}

.stratix-dropdown__item--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stratix-dropdown__indicator {
  width: 8px;
  height: 8px;
  border-radius: var(--ds-radius-full);
  flex-shrink: 0;
}

.stratix-dropdown__icon {
  flex-shrink: 0;
  color: var(--ds-text-muted);
  transition: transform var(--ds-animation-duration-fast) ease;
}

.stratix-dropdown__label {
  flex: 1;
  white-space: nowrap;
}

.stratix-dropdown__shortcut {
  flex-shrink: 0;
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  background: var(--ds-bg-tertiary);
  padding: 2px 6px;
  border-radius: var(--ds-radius-xs);
  margin-left: var(--ds-spacing-md);
}

.stratix-dropdown__divider {
  height: 1px;
  background: var(--ds-border-default);
  margin: var(--ds-spacing-xs) 0;
}

/* 动画 */
.stratix-dropdown-enter-active,
.stratix-dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.stratix-dropdown-enter-from,
.stratix-dropdown-leave-to {
  opacity: 0;
  transform: translateY(calc(-1 * var(--ds-spacing-sm, 8px)));
}

.stratix-dropdown-enter-active .stratix-dropdown__menu {
  animation: ds-slide-down var(--ds-animation-duration-normal) var(--ds-animation-easing-ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .stratix-dropdown-enter-active,
  .stratix-dropdown-leave-active,
  .stratix-dropdown__item,
  .stratix-dropdown__icon {
    transition: none;
    animation: none;
  }
}
</style>
