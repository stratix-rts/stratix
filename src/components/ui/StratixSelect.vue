<script setup lang="ts">
import { SvgIcon } from '@/components/ui';
import { computed, ref, toRef, onMounted, onUnmounted } from 'vue';
import { getToken } from '@/design-system/config';
import { provideSizeContext } from '@/design-system/composables/useSizeContext';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

interface Props {
  modelValue?: string | number;
  options?: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  size?: SizeVariant;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  options: () => [],
  placeholder: '请选择',
  disabled: false,
  error: false,
  size: 'md',
});

provideSizeContext(toRef(props, 'size'));

const emit = defineEmits<{
  'update:modelValue': [value: string | number];
  change: [value: string | number];
  focus: [];
  blur: [];
}>();

const isOpen = ref(false);
const selectRef = ref<HTMLElement | null>(null);
const searchQuery = ref('');

const sizeConfig = {
  sm: { height: '32px', padding: '4px 8px', fontSize: '12px' },
  md: { height: '40px', padding: '8px 12px', fontSize: '14px' },
  lg: { height: '48px', padding: '12px 16px', fontSize: '16px' },
};

const showSearch = computed(() => props.options.length > 7);

const filteredOptions = computed(() => {
  if (!showSearch.value || !searchQuery.value) return props.options;
  const query = searchQuery.value.toLowerCase();
  return props.options.filter(o => o.label.toLowerCase().includes(query));
});

const selectedLabel = computed(() => {
  const option = props.options.find(o => o.value === props.modelValue);
  return option?.label || '';
});

const hasValue = computed(() => {
  return props.modelValue !== undefined && props.modelValue !== null && props.modelValue !== '';
});

const handleOptionClick = (option: SelectOption) => {
  if (option.disabled) return;
  emit('update:modelValue', option.value);
  emit('change', option.value);
  isOpen.value = false;
  searchQuery.value = '';
};

const toggleDropdown = () => {
  if (props.disabled) return;
  isOpen.value = !isOpen.value;
};

const handleClickOutside = (event: MouseEvent) => {
  if (selectRef.value && !selectRef.value.contains(event.target as Node)) {
    isOpen.value = false;
    searchQuery.value = '';
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div 
    ref="selectRef"
    class="stratix-select"
    :class="{
      'stratix-select--open': isOpen,
      'stratix-select--disabled': disabled,
      'stratix-select--error': error,
    }"
  >
    <div 
      class="stratix-select__trigger"
      :class="[`stratix-select__trigger--${size}`]"
      @click="toggleDropdown"
    >
      <span 
        v-if="!hasValue" 
        class="stratix-select__placeholder"
      >
        {{ placeholder }}
      </span>
      <span v-else class="stratix-select__value">
        {{ selectedLabel }}
      </span>
      <SvgIcon class="stratix-select__icon" name="chevron-down" />
    </div>

    <transition name="stratix-select-dropdown">
      <div v-if="isOpen" class="stratix-select__dropdown">
        <div v-if="showSearch" class="stratix-select__search">
          <SvgIcon name="search" :size="14" class="stratix-select__search-icon" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索..."
            class="stratix-select__search-input"
            @click.stop
          />
        </div>
        <div class="stratix-select__options">
          <div
            v-for="option in filteredOptions"
            :key="option.value"
            class="stratix-select__option"
            :class="{
              'stratix-select__option--selected': option.value === modelValue,
              'stratix-select__option--disabled': option.disabled,
            }"
            @click="handleOptionClick(option)"
          >
            <span class="stratix-select__option-glow" v-if="option.value === modelValue"></span>
            {{ option.label }}
          </div>
          <div v-if="filteredOptions.length === 0" class="stratix-select__empty">
            <SvgIcon name="search-x" :size="20" />
            <span>无匹配选项</span>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.stratix-select {
  position: relative;
  width: 100%;
}

.stratix-select__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-spacing-sm);
  background: v-bind('getToken("colors.background.overlay")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: v-bind('getToken("radii.md")');
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
  user-select: none;
}

.stratix-select__trigger--sm {
  padding: v-bind('sizeConfig.sm.padding');
  height: v-bind('sizeConfig.sm.height');
  font-size: v-bind('sizeConfig.sm.fontSize');
}

.stratix-select__trigger--md {
  padding: v-bind('sizeConfig.md.padding');
  height: v-bind('sizeConfig.md.height');
  font-size: v-bind('sizeConfig.md.fontSize');
}

.stratix-select__trigger--lg {
  padding: v-bind('sizeConfig.lg.padding');
  height: v-bind('sizeConfig.lg.height');
  font-size: v-bind('sizeConfig.lg.fontSize');
}

.stratix-select__trigger:hover:not(.stratix-select__trigger--disabled) {
  border-color: v-bind('getToken("colors.border.strong")');
}

.stratix-select--open .stratix-select__trigger {
  border-color: v-bind('getToken("colors.status.info")');
  box-shadow: 0 0 0 3px color-mix(in srgb, v-bind('getToken("colors.status.info")') 20%, transparent);
}

.stratix-select--error .stratix-select__trigger {
  border-color: v-bind('getToken("colors.status.danger")');
}

.stratix-select--disabled .stratix-select__trigger {
  opacity: 0.5;
  cursor: not-allowed;
  background: v-bind('getToken("colors.background.elevated")');
}

.stratix-select__placeholder {
  color: v-bind('getToken("colors.text.muted")');
}

.stratix-select__value {
  flex: 1;
  color: v-bind('getToken("colors.text.primary")');
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stratix-select__icon {
  flex-shrink: 0;
  color: v-bind('getToken("colors.text.muted")');
  transition: transform 0.2s ease;
}

.stratix-select--open .stratix-select__icon {
  transform: rotate(180deg);
}

.stratix-select__dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: v-bind('getToken("colors.background.overlay")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: v-bind('getToken("radii.md")');
  box-shadow: v-bind('getToken("shadows.md")');
  z-index: 1000;
  max-height: 280px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.stratix-select__search {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  border-bottom: 1px solid v-bind('getToken("colors.border.default")');
}

.stratix-select__search-icon {
  flex-shrink: 0;
  color: v-bind('getToken("colors.text.muted")');
}

.stratix-select__search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: v-bind('getToken("colors.text.primary")');
  font-size: var(--ds-font-size-sm);
}

.stratix-select__search-input::placeholder {
  color: v-bind('getToken("colors.text.muted")');
}

.stratix-select__options {
  overflow-y: auto;
  max-height: 240px;
  padding: var(--ds-spacing-xs);
}

.stratix-select__option {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  padding: v-bind('sizeConfig[size].padding');
  padding-left: calc(v-bind('sizeConfig[size].padding') + 4px);
  color: v-bind('getToken("colors.text.primary")');
  font-size: v-bind('sizeConfig[size].fontSize');
  cursor: pointer;
  transition: background 0.15s ease;
  border-radius: var(--ds-radius-sm);
  overflow: hidden;
}

.stratix-select__option-glow {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 60%;
  background: v-bind('getToken("colors.status.info")');
  border-radius: 0 2px 2px 0;
  box-shadow: 0 0 6px color-mix(in srgb, v-bind('getToken("colors.status.info")') 50%, transparent);
}

.stratix-select__option:hover:not(.stratix-select__option--disabled) {
  background: v-bind('getToken("colors.background.primary")');
}

.stratix-select__option--selected {
  background: color-mix(in srgb, v-bind('getToken("colors.status.info")') 10%, transparent);
  color: v-bind('getToken("colors.status.info")');
}

.stratix-select__option--disabled {
  opacity: 0.5;
  cursor: not-allowed;
  color: v-bind('getToken("colors.text.muted")');
}

.stratix-select__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ds-spacing-sm);
  padding: var(--ds-spacing-lg);
  color: v-bind('getToken("colors.text.muted")');
  font-size: var(--ds-font-size-sm);
}

/* Scale + fade animation */
.stratix-select-dropdown-enter-active,
.stratix-select-dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
  transform-origin: top center;
}

.stratix-select-dropdown-enter-from,
.stratix-select-dropdown-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .stratix-select__trigger,
  .stratix-select__icon,
  .stratix-select__option,
  .stratix-select-dropdown-enter-active,
  .stratix-select-dropdown-leave-active {
    transition: none;
    animation: none;
  }
  .stratix-select-dropdown-enter-from,
  .stratix-select-dropdown-leave-to {
    transform: none;
  }
}
</style>
