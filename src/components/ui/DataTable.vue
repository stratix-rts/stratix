<template>
  <vxe-grid
    v-bind="$attrs"
    :columns="columns"
    :data="data"
    :edit-config="mergedEditConfig"
    :pagination="paginationConfig"
    :sort-config="sortConfigComputed"
    :filter-config="filterConfigComputed"
    stripe
    border
    show-overflow
    :height="height"
    :max-height="maxHeight"
    keep-source
    sync-resize
    @edit-closed="handleEditClosed"
    @sort-change="handleSortChange"
    @filter-change="handleFilterChange"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { VxeGridPropTypes } from 'vxe-table';

interface Props {
  /** 列配置 */
  columns: VxeGridPropTypes.Columns;
  /** 数据 */
  data: any[];
  /** 高度 */
  height?: string | number;
  /** 最大高度 */
  maxHeight?: string | number;
  /** 编辑配置 */
  editConfig?: boolean | object;
  /** 分页配置 */
  pagination?: boolean | object;
  /** 排序配置 */
  sortConfig?: boolean | object;
  /** 筛选配置 */
  filterConfig?: boolean | object;
}

const props = withDefaults(defineProps<Props>(), {
  height: 'auto',
  maxHeight: undefined,
  editConfig: false,
  pagination: false,
  sortConfig: true,
  filterConfig: false,
});

const emit = defineEmits<{
  /** 单元格编辑关闭 */
  'cell-edit': [params: any];
  /** 排序变化 */
  'sort-change': [params: any];
  /** 筛选变化 */
  'filter-change': [params: any];
}>();

// 合并编辑配置
const mergedEditConfig = computed(() => {
  if (!props.editConfig) return null;
  return {
    trigger: 'click',
    mode: 'cell',
    showStatus: true,
    ...(typeof props.editConfig === 'object' ? props.editConfig : {}),
  };
});

// 分页配置
const paginationConfig = computed(() => {
  if (!props.pagination) return null;
  if (typeof props.pagination === 'object') return props.pagination;
  return {
    currentPage: 1,
    pageSize: 20,
    pageSizes: [10, 20, 50, 100],
    layouts: ['PrevPage', 'JumpNumber', 'NextPage', 'FullJump', 'Sizes', 'Total'],
  };
});

// 排序配置
const sortConfigComputed = computed(() => {
  if (!props.sortConfig) return null;
  if (typeof props.sortConfig === 'object') return props.sortConfig;
  return {
    trigger: 'cell',
    remote: false,
    orders: ['asc', 'desc', 'null'],
  };
});

// 筛选配置
const filterConfigComputed = computed(() => {
  if (!props.filterConfig) return null;
  if (typeof props.filterConfig === 'object') return props.filterConfig;
  return {
    remote: false,
  };
});

// 处理编辑关闭
const handleEditClosed = (params: any) => {
  emit('cell-edit', params);
};

// 处理排序变化
const handleSortChange = (params: any) => {
  emit('sort-change', params);
};

// 处理筛选变化
const handleFilterChange = (params: any) => {
  emit('filter-change', params);
};
</script>

<style>
/* Vxe Table 样式适配 */
.vxe-grid {
  font-size: 13px;
}

.vxe-grid .vxe-header--column {
  background-color: var(--ds-bg-secondary, #f9fafb);
}

.vxe-grid .vxe-body--row {
  transition: background-color 0.15s ease;
}

.vxe-grid .vxe-body--row:hover {
  background-color: var(--ds-bg-hover, #f3f4f6);
}

/* 编辑状态样式 */
.vxe-grid .vxe-edit-input,
.vxe-grid .vxe-edit-textarea {
  width: 100%;
}

.vxe-grid .vxe-cell--edit {
  padding: 4px 8px;
}
</style>
