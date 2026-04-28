<script setup lang="ts">
import { ref, computed } from 'vue';
import { getToken } from '@/design-system/config';
import SvgIcon from './SvgIcon.vue';

export interface AccordionItem {
  key: string;
  title: string;
  content?: string;
  disabled?: boolean;
}

interface Props {
  items: AccordionItem[];
  modelValue?: string[];
  multiple?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  multiple: false,
});

const emit = defineEmits<{
  'update:modelValue': [keys: string[]];
}>();

const localOpen = ref<string[]>(props.modelValue || []);

const openKeys = computed({
  get: () => props.modelValue ?? localOpen.value,
  set: (val) => {
    localOpen.value = val;
    emit('update:modelValue', val);
  }
});

const isOpen = (key: string) => openKeys.value.includes(key);

const toggle = (item: AccordionItem) => {
  if (item.disabled) return;
  if (props.multiple) {
    const set = new Set(openKeys.value);
    if (set.has(item.key)) {
      set.delete(item.key);
    } else {
      set.add(item.key);
    }
    openKeys.value = Array.from(set);
  } else {
    openKeys.value = isOpen(item.key) ? [] : [item.key];
  }
};

const onEnter = (el: Element) => {
  const htmlEl = el as HTMLElement;
  htmlEl.style.height = htmlEl.scrollHeight + 'px';
};

const onAfterEnter = (el: Element) => {
  (el as HTMLElement).style.height = 'auto';
};

const onLeave = (el: Element) => {
  const htmlEl = el as HTMLElement;
  htmlEl.style.height = htmlEl.scrollHeight + 'px';
  requestAnimationFrame(() => {
    htmlEl.style.height = '0px';
  });
};
</script>

<template>
  <div class="stratix-accordion">
    <div
      v-for="item in items"
      :key="item.key"
      class="stratix-accordion__item"
      :class="{
        'stratix-accordion__item--open': isOpen(item.key),
        'stratix-accordion__item--disabled': item.disabled,
      }"
    >
      <div
        class="stratix-accordion__header"
        @click="toggle(item)"
      >
        <span class="stratix-accordion__title">{{ item.title }}</span>
        <SvgIcon
          name="chevron-down"
          :size="16"
          class="stratix-accordion__arrow"
        />
      </div>
      <transition
        name="stratix-accordion"
        @enter="onEnter"
        @after-enter="onAfterEnter"
        @leave="onLeave"
      >
        <div v-show="isOpen(item.key)" class="stratix-accordion__content">
          <div class="stratix-accordion__inner">
            <slot :name="item.key" :item="item">
              {{ item.content }}
            </slot>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.stratix-accordion {
  display: flex;
  flex-direction: column;
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: var(--ds-radius-md);
  overflow: hidden;
}

.stratix-accordion__item {
  border-bottom: 1px solid v-bind('getToken("colors.border.default")');
}

.stratix-accordion__item:last-child {
  border-bottom: none;
}

.stratix-accordion__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
  transition: background var(--ds-animation-duration-fast) ease;
}

.stratix-accordion__header:hover {
  background: color-mix(in srgb, v-bind('getToken("colors.status.info")') 5%, transparent);
}

.stratix-accordion__item--disabled .stratix-accordion__header {
  opacity: 0.4;
  cursor: not-allowed;
}

.stratix-accordion__title {
  font-size: var(--ds-font-size-sm);
  font-weight: 500;
  color: v-bind('getToken("colors.text.primary")');
}

.stratix-accordion__arrow {
  color: v-bind('getToken("colors.text.muted")');
  transition: transform var(--ds-animation-duration-fast) ease;
}

.stratix-accordion__item--open .stratix-accordion__arrow {
  transform: rotate(180deg);
}

.stratix-accordion__content {
  overflow: hidden;
  transition: height var(--ds-animation-duration-normal) ease;
}

.stratix-accordion__inner {
  padding: 0 16px 12px;
  font-size: var(--ds-font-size-sm);
  color: v-bind('getToken("colors.text.secondary")');
  line-height: 1.6;
}

@media (prefers-reduced-motion: reduce) {
  .stratix-accordion__header,
  .stratix-accordion__arrow,
  .stratix-accordion__content {
    transition: none;
  }
}
</style>
