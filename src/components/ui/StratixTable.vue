<script setup lang="ts" generic="T extends Record<string, any>">
import { computed } from 'vue';
import { getToken } from '@/design-system/config';
import SvgIcon from './SvgIcon.vue';
import StratixEmpty from './StratixEmpty.vue';

export interface TableColumn {
  key: string;
  title: string;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

interface Props {
  columns: TableColumn[];
  data: T[];
  emptyText?: string;
  stickyHeader?: boolean;
  rowHover?: boolean;
  sortKey?: string;
  sortOrder?: 'asc' | 'desc' | null;
}

const props = withDefaults(defineProps<Props>(), {
  emptyText: '暂无数据',
  stickyHeader: true,
  rowHover: true,
});

const emit = defineEmits<{
  'sort': [key: string, order: 'asc' | 'desc' | null];
  'row-click': [row: T, index: number];
}>();

const handleSort = (column: TableColumn) => {
  if (!column.sortable) return;
  let order: 'asc' | 'desc' | null = 'asc';
  if (props.sortKey === column.key) {
    if (props.sortOrder === 'asc') order = 'desc';
    else if (props.sortOrder === 'desc') order = null;
  }
  emit('sort', column.key, order);
};

const getSortIcon = (column: TableColumn) => {
  if (!column.sortable) return '';
  if (props.sortKey !== column.key) return 'arrow-up-down';
  if (props.sortOrder === 'asc') return 'arrow-up';
  if (props.sortOrder === 'desc') return 'arrow-down';
  return 'arrow-up-down';
};
</script>

<template>
  <div class="stratix-table-wrapper">
    <table
      class="stratix-table"
      :class="{
        'stratix-table--sticky-header': stickyHeader,
        'stratix-table--row-hover': rowHover,
      }"
    >
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            :style="{ width: column.width, textAlign: column.align || 'left' }"
            :class="{ 'stratix-table__th--sortable': column.sortable }"
            @click="handleSort(column)"
          >
            <span class="stratix-table__th-content">
              {{ column.title }}
              <SvgIcon
                v-if="column.sortable"
                :name="getSortIcon(column)"
                :size="12"
                class="stratix-table__sort-icon"
                :class="{ 'stratix-table__sort-icon--active': sortKey === column.key }"
              />
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, index) in data"
          :key="index"
          class="stratix-table__row"
          @click="emit('row-click', row, index)"
        >
          <td
            v-for="column in columns"
            :key="column.key"
            :style="{ textAlign: column.align || 'left' }"
          >
            <slot :name="column.key" :row="row" :index="index">
              {{ row[column.key] }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="data.length === 0" class="stratix-table__empty">
      <StratixEmpty scenario="no-data" :title="emptyText" />
    </div>
  </div>
</template>

<style scoped>
.stratix-table-wrapper {
  width: 100%;
  overflow-x: auto;
  border-radius: var(--ds-radius-md);
  border: 1px solid v-bind('getToken("colors.border.default")');
}

.stratix-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--ds-font-size-sm);
}

.stratix-table thead {
  background: v-bind('getToken("colors.background.elevated")');
}

.stratix-table th {
  padding: 10px 12px;
  font-weight: 600;
  color: v-bind('getToken("colors.text.secondary")');
  text-align: left;
  border-bottom: 1px solid v-bind('getToken("colors.border.default")');
  white-space: nowrap;
  user-select: none;
}

.stratix-table__th--sortable {
  cursor: pointer;
  transition: color var(--ds-animation-duration-fast) ease;
}

.stratix-table__th--sortable:hover {
  color: v-bind('getToken("colors.text.primary")');
}

.stratix-table__th-content {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.stratix-table__sort-icon {
  color: v-bind('getToken("colors.text.muted")');
  transition: transform var(--ds-animation-duration-fast) ease, color var(--ds-animation-duration-fast) ease;
  opacity: 0.6;
}

.stratix-table__sort-icon--active {
  color: v-bind('getToken("colors.status.info")');
  opacity: 1;
  transform: rotate(0deg);
}

.stratix-table__th--sortable:hover .stratix-table__sort-icon {
  opacity: 1;
  transform: translateY(-1px);
}

.stratix-table td {
  padding: 10px 12px;
  color: v-bind('getToken("colors.text.primary")');
  border-bottom: 1px solid v-bind('getToken("colors.border.default")');
  transition: background var(--ds-animation-duration-fast) ease;
}

.stratix-table tbody tr:last-child td {
  border-bottom: none;
}

.stratix-table--row-hover tbody tr:hover td {
  background: color-mix(in srgb, v-bind('getToken("colors.status.info")') 5%, transparent);
}

.stratix-table--sticky-header thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

.stratix-table__empty {
  padding: 24px;
}

@media (prefers-reduced-motion: reduce) {
  .stratix-table__sort-icon,
  .stratix-table td,
  .stratix-table__th--sortable {
    transition: none;
  }
}
</style>
