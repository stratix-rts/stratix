<script setup lang="ts">
import { computed } from 'vue';
import { getToken } from '@/design-system/config';
import SvgIcon from './SvgIcon.vue';

export interface BreadcrumbItem {
  label: string;
  to?: string;
  icon?: string;
}

interface Props {
  items: BreadcrumbItem[];
  separator?: string;
}

const props = withDefaults(defineProps<Props>(), {
  separator: 'chevron-right',
});

const emit = defineEmits<{
  click: [item: BreadcrumbItem, index: number];
}>();

const isLast = (index: number) => index === props.items.length - 1;

const handleClick = (item: BreadcrumbItem, index: number) => {
  if (isLast(index)) return;
  emit('click', item, index);
};
</script>

<template>
  <nav class="stratix-breadcrumb" aria-label="面包屑">
    <ol class="stratix-breadcrumb__list">
      <li
        v-for="(item, index) in items"
        :key="index"
        class="stratix-breadcrumb__item"
        :class="{ 'stratix-breadcrumb__item--active': isLast(index) }"
      >
        <a
          v-if="item.to && !isLast(index)"
          class="stratix-breadcrumb__link"
          :href="item.to"
          @click.prevent="handleClick(item, index)"
        >
          <SvgIcon v-if="item.icon" :name="item.icon" :size="14" />
          <span>{{ item.label }}</span>
        </a>
        <span
          v-else
          class="stratix-breadcrumb__text"
        >
          <SvgIcon v-if="item.icon" :name="item.icon" :size="14" />
          <span>{{ item.label }}</span>
        </span>
        <span v-if="!isLast(index)" class="stratix-breadcrumb__separator">
          <SvgIcon :name="separator" :size="14" />
        </span>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.stratix-breadcrumb {
  font-size: var(--ds-font-size-sm);
}

.stratix-breadcrumb__list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  list-style: none;
  margin: 0;
  padding: 0;
  gap: 4px;
}

.stratix-breadcrumb__item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.stratix-breadcrumb__link,
.stratix-breadcrumb__text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  border-radius: var(--ds-radius-xs);
  transition: all var(--ds-animation-duration-fast) ease;
}

.stratix-breadcrumb__link {
  color: v-bind('getToken("colors.text.muted")');
  text-decoration: none;
  cursor: pointer;
}

.stratix-breadcrumb__link:hover {
  color: v-bind('getToken("colors.status.info")');
  background: color-mix(in srgb, v-bind('getToken("colors.status.info")') 8%, transparent);
}

.stratix-breadcrumb__link:hover .stratix-breadcrumb__separator svg {
  transform: translateX(2px);
}

.stratix-breadcrumb__text {
  color: v-bind('getToken("colors.text.primary")');
  font-weight: 500;
}

.stratix-breadcrumb__separator {
  display: inline-flex;
  align-items: center;
  color: v-bind('getToken("colors.text.muted")');
  opacity: 0.5;
  transition: transform var(--ds-animation-duration-fast) ease;
}

.stratix-breadcrumb__separator svg {
  transition: transform var(--ds-animation-duration-fast) ease;
}

@media (prefers-reduced-motion: reduce) {
  .stratix-breadcrumb__link,
  .stratix-breadcrumb__text,
  .stratix-breadcrumb__separator,
  .stratix-breadcrumb__separator svg {
    transition: none;
  }
}
</style>
