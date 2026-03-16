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

// 使用设计系统的 popup 层级 (4000)
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

/**
 * 阻止事件冒泡到 Phaser Canvas，防止点击穿透
 */
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
          <template v-for="(option, index) in options" :key="option.value">
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
            </div>
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
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border-default);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  min-width: 140px;
  overflow: hidden;
}

.stratix-dropdown__menu {
  padding: 4px;
}

.stratix-dropdown__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--ds-text-primary);
  transition: all 0.15s ease;
}

.stratix-dropdown__item:hover:not(.stratix-dropdown__item--disabled) {
  background: var(--ds-bg-tertiary);
}

.stratix-dropdown__item--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stratix-dropdown__indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.stratix-dropdown__icon {
  flex-shrink: 0;
  color: var(--ds-text-muted);
}

.stratix-dropdown__label {
  flex: 1;
  white-space: nowrap;
}

.stratix-dropdown__divider {
  height: 1px;
  background: var(--ds-border-default);
  margin: 4px 0;
}

/* 动画 */
.stratix-dropdown-enter-active,
.stratix-dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.stratix-dropdown-enter-from,
.stratix-dropdown-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
