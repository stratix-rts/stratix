<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { getToken } from '@/design-system/config';
import SvgIcon from './SvgIcon.vue';

export interface TabItem {
  key: string;
  label: string;
  icon?: string;
  disabled?: boolean;
}

interface Props {
  modelValue?: string;
  tabs: TabItem[];
  type?: 'line' | 'card';
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  type: 'line',
});

const emit = defineEmits<{
  'update:modelValue': [key: string];
  change: [key: string];
}>();

const activeKey = computed(() => props.modelValue || props.tabs[0]?.key);
const indicatorRef = ref<HTMLElement | null>(null);
const tabsRef = ref<HTMLElement | null>(null);

const activeTab = computed(() => props.tabs.find(t => t.key === activeKey.value));

const updateIndicator = () => {
  if (!tabsRef.value || !indicatorRef.value || props.type !== 'line') return;
  const activeEl = tabsRef.value.querySelector(`[data-tab="${activeKey.value}"]`) as HTMLElement;
  if (!activeEl) return;
  indicatorRef.value.style.width = `${activeEl.offsetWidth}px`;
  indicatorRef.value.style.transform = `translateX(${activeEl.offsetLeft}px)`;
};

watch(() => activeKey.value, () => {
  requestAnimationFrame(updateIndicator);
});

onMounted(() => {
  requestAnimationFrame(updateIndicator);
});

const handleTabClick = (tab: TabItem) => {
  if (tab.disabled) return;
  emit('update:modelValue', tab.key);
  emit('change', tab.key);
};
</script>

<template>
  <div class="stratix-tabs" :class="`stratix-tabs--${type}`">
    <div ref="tabsRef" class="stratix-tabs__nav">
      <div
        v-for="tab in tabs"
        :key="tab.key"
        :data-tab="tab.key"
        class="stratix-tabs__tab"
        :class="{
          'stratix-tabs__tab--active': tab.key === activeKey,
          'stratix-tabs__tab--disabled': tab.disabled,
        }"
        @click="handleTabClick(tab)"
      >
        <SvgIcon v-if="tab.icon" :name="tab.icon" :size="14" />
        <span>{{ tab.label }}</span>
      </div>
      <div
        v-if="type === 'line'"
        ref="indicatorRef"
        class="stratix-tabs__indicator"
      ></div>
    </div>
    <div class="stratix-tabs__content">
      <slot :active="activeKey" :tab="activeTab" />
    </div>
  </div>
</template>

<style scoped>
.stratix-tabs {
  width: 100%;
}

.stratix-tabs__nav {
  position: relative;
  display: flex;
  gap: 4px;
  border-bottom: 1px solid v-bind('getToken("colors.border.default")');
}

.stratix-tabs__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: var(--ds-font-size-sm);
  font-weight: 500;
  color: v-bind('getToken("colors.text.muted")');
  cursor: pointer;
  user-select: none;
  transition: color var(--ds-animation-duration-fast) ease;
  white-space: nowrap;
  position: relative;
}

.stratix-tabs__tab:hover:not(.stratix-tabs__tab--disabled) {
  color: v-bind('getToken("colors.text.primary")');
}

.stratix-tabs__tab--active {
  color: v-bind('getToken("colors.status.info")');
}

.stratix-tabs__tab--disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.stratix-tabs__indicator {
  position: absolute;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: v-bind('getToken("colors.status.info")');
  border-radius: 2px 2px 0 0;
  transition: transform var(--ds-animation-duration-normal) ease, width var(--ds-animation-duration-normal) ease;
  box-shadow: 0 -2px 8px color-mix(in srgb, v-bind('getToken("colors.status.info")') 40%, transparent);
}

.stratix-tabs--card .stratix-tabs__nav {
  border-bottom: none;
  gap: 2px;
  background: v-bind('getToken("colors.background.elevated")');
  padding: 4px;
  border-radius: var(--ds-radius-md);
}

.stratix-tabs--card .stratix-tabs__tab {
  border-radius: var(--ds-radius-sm);
  padding: 6px 14px;
  transition: all var(--ds-animation-duration-fast) ease;
}

.stratix-tabs--card .stratix-tabs__tab--active {
  background: v-bind('getToken("colors.background.overlay")');
  color: v-bind('getToken("colors.text.primary")');
  box-shadow: var(--ds-shadow-sm);
}

.stratix-tabs__content {
  padding-top: var(--ds-spacing-md);
}

@media (prefers-reduced-motion: reduce) {
  .stratix-tabs__tab,
  .stratix-tabs__indicator {
    transition: none;
  }
}
</style>
