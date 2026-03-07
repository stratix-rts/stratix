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

const sizeConfig = {
  sm: { height: '32px', padding: '4px 8px', fontSize: '12px' },
  md: { height: '40px', padding: '8px 12px', fontSize: '14px' },
  lg: { height: '48px', padding: '12px 16px', fontSize: '16px' },
};

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
};

const toggleDropdown = () => {
  if (props.disabled) return;
  isOpen.value = !isOpen.value;
};

const handleClickOutside = (event: MouseEvent) => {
  if (selectRef.value && !selectRef.value.contains(event.target as Node)) {
    isOpen.value = false;
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
        <div
          v-for="option in options"
          :key="option.value"
          class="stratix-select__option"
          :class="{
            'stratix-select__option--selected': option.value === modelValue,
            'stratix-select__option--disabled': option.disabled,
          }"
          @click="handleOptionClick(option)"
        >
          {{ option.label }}
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
  gap: 8px;
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: v-bind('getToken("radii.md")');
  cursor: pointer;
  transition: all 0.15s ease;
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
  border-color: v-bind('getToken("colors.info")');
  box-shadow: 0 0 0 2px v-bind('getToken("colors.info") + "1A"');
}

.stratix-select--error .stratix-select__trigger {
  border-color: v-bind('getToken("colors.semantic.danger")');
}

.stratix-select--disabled .stratix-select__trigger {
  opacity: 0.5;
  cursor: not-allowed;
  background: v-bind('getToken("colors.background.secondary")');
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
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: v-bind('getToken("radii.md")');
  box-shadow: v-bind('getToken("shadows.md")');
  z-index: 1000;
  max-height: 240px;
  overflow-y: auto;
}

.stratix-select__option {
  padding: v-bind('sizeConfig[size].padding');
  color: v-bind('getToken("colors.text.primary")');
  font-size: v-bind('sizeConfig[size].fontSize');
  cursor: pointer;
  transition: background 0.15s ease;
}

.stratix-select__option:hover:not(.stratix-select__option--disabled) {
  background: v-bind('getToken("colors.background.primary")');
}

.stratix-select__option--selected {
  background: v-bind('getToken("colors.info") + "1A"');
  color: v-bind('getToken("colors.info")');
}

.stratix-select__option--disabled {
  opacity: 0.5;
  cursor: not-allowed;
  color: v-bind('getToken("colors.text.muted")');
}

.stratix-select-dropdown-enter-active,
.stratix-select-dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.stratix-select-dropdown-enter-from,
.stratix-select-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
