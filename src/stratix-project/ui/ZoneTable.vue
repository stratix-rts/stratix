<template>
  <div class="zone-table">
    <!-- 工具栏 -->
    <div class="zone-table-toolbar">
      <div class="toolbar-left">
        <StratixInput
          v-model="searchKeyword"
          placeholder="搜索 Zone..."
          clearable
          @update:model-value="handleSearch"
        >
          <template #prefix>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </template>
        </StratixInput>
      </div>
      <div class="toolbar-right">
        <StratixButton size="small" @click="handleRefresh">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          刷新
        </StratixButton>
      </div>
    </div>

    <!-- 表格 - 使用 vxe-grid 直接 -->
    <vxe-grid
      ref="tableRef"
      :data="filteredZones"
      :columns="columns"
      stripe
      border
      show-overflow
      :max-height="500"
      :sort-config="{ trigger: 'cell', remote: false, orders: ['asc', 'desc', 'null'] }"
      :filter-config="{ remote: false }"
      @cell-click="handleCellClick"
    >
      <!-- 自定义单元格插槽 -->
      <template #titleSlot="{ row }">
        <span class="cell-text title-cell" @dblclick="startEdit(row, 'title')">
          {{ row.title || '(未命名)' }}
        </span>
      </template>

      <template #promptSlot="{ row }">
        <span class="cell-text prompt-cell" :title="row.prompt" @dblclick="startEdit(row, 'prompt')">
          {{ row.prompt || '(无描述)' }}
        </span>
      </template>

      <template #membersSlot="{ row }">
        <span class="count-cell">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          {{ row.members?.length || 0 }}
        </span>
      </template>

      <template #filesSlot="{ row }">
        <span class="count-cell">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
          </svg>
          {{ row.files?.length || 0 }}
        </span>
      </template>

      <template #createdAtSlot="{ row }">
        {{ formatDate(row.createdAt) }}
      </template>

      <template #updatedAtSlot="{ row }">
        {{ formatDate(row.updatedAt) }}
      </template>

      <template #actionSlot="{ row }">
        <div class="action-cell">
          <StratixButton size="tiny" variant="ghost" @click="handleViewFiles(row)">
            文件
          </StratixButton>
          <StratixButton size="tiny" variant="ghost" @click="handleEdit(row)">
            编辑
          </StratixButton>
          <StratixButton size="tiny" variant="ghost" danger @click="handleDelete(row)">
            删除
          </StratixButton>
        </div>
      </template>

      <!-- 编辑模式插槽 -->
      <template #titleEditSlot="{ row }">
        <StratixInput
          v-model="editingCell.value"
          size="small"
          @blur="finishEdit(row, 'title')"
          @keydown.enter="finishEdit(row, 'title')"
          @keydown.esc="cancelEdit"
        />
      </template>

      <template #promptEditSlot="{ row }">
        <StratixInput
          v-model="editingCell.value"
          type="textarea"
          size="small"
          @blur="finishEdit(row, 'prompt')"
          @keydown.enter.ctrl="finishEdit(row, 'prompt')"
          @keydown.esc="cancelEdit"
        />
      </template>
    </vxe-grid>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { VxeGridInstance, VxeGridPropTypes } from 'vxe-table';
import StratixInput from '@/components/ui/StratixInput.vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import type { Zone } from '../types';

interface Props {
  zones: Zone[];
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
});

const emit = defineEmits<{
  refresh: [];
  'zone-select': [zone: Zone];
  'zone-edit': [zone: Zone];
  'zone-delete': [zone: Zone];
  'zone-update': [zone: Zone, updates: { title?: string; prompt?: string }];
}>();

const tableRef = ref<VxeGridInstance | null>(null);
const searchKeyword = ref('');
const editingCell = ref<{ row: any; field: string; value: any } | null>(null);

// 列定义 - 使用 slots 属性指定插槽名称
const columns: VxeGridPropTypes.Columns = [
  { type: 'seq', width: 60, title: '#' },
  { field: 'title', title: 'Zone (O)', width: 200, sortable: true, slots: { default: 'titleSlot', edit: 'titleEditSlot' } },
  { field: 'prompt', title: 'Prompt (KR)', minWidth: 300, sortable: true, showOverflow: true, slots: { default: 'promptSlot', edit: 'promptEditSlot' } },
  { field: 'members', title: '成员', width: 80, slots: { default: 'membersSlot' } },
  { field: 'files', title: '文件', width: 70, slots: { default: 'filesSlot' } },
  { field: 'createdAt', title: '创建时间', width: 160, sortable: true, slots: { default: 'createdAtSlot' } },
  { field: 'updatedAt', title: '更新时间', width: 160, sortable: true, slots: { default: 'updatedAtSlot' } },
  { field: 'action', title: '操作', width: 180, fixed: 'right', slots: { default: 'actionSlot' } },
];

// 过滤后的 Zones
const filteredZones = computed(() => {
  if (!searchKeyword.value) return props.zones;
  const keyword = searchKeyword.value.toLowerCase();
  return props.zones.filter(
    (zone) =>
      zone.title?.toLowerCase().includes(keyword) ||
      zone.prompt?.toLowerCase().includes(keyword)
  );
});

// 格式化日期
const formatDate = (timestamp: number | undefined) => {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// 搜索
const handleSearch = (value: string) => {
  searchKeyword.value = value;
};

// 刷新
const handleRefresh = () => {
  emit('refresh');
};

// 开始编辑
const startEdit = (row: any, field: string) => {
  editingCell.value = {
    row,
    field,
    value: row[field],
  };
};

// 取消编辑
const cancelEdit = () => {
  editingCell.value = null;
};

// 完成编辑
const finishEdit = (row: any, field: string) => {
  if (!editingCell.value) return;

  const { value } = editingCell.value;
  const oldValue = row[field];

  if (value !== oldValue) {
    emit('zone-update', row, { [field]: value });
  }

  editingCell.value = null;
};

// 单元格点击处理
const handleCellClick = ({ row, column }: any) => {
  // 双击已经在模板中通过 startEdit 处理
};

// 查看文件
const handleViewFiles = (zone: Zone) => {
  emit('zone-select', zone);
};

// 编辑 Zone
const handleEdit = (zone: Zone) => {
  emit('zone-edit', zone);
};

// 删除 Zone
const handleDelete = (zone: Zone) => {
  emit('zone-delete', zone);
};
</script>

<style scoped>
.zone-table {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.zone-table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.toolbar-left {
  flex: 1;
  max-width: 300px;
}

.toolbar-right {
  display: flex;
  gap: 8px;
}

.cell-text {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-cell {
  font-weight: 500;
  cursor: pointer;
}

.title-cell:hover {
  color: var(--ds-primary, #3b82f6);
}

.prompt-cell {
  color: var(--ds-text-secondary, #6b7280);
  cursor: pointer;
}

.prompt-cell:hover {
  color: var(--ds-primary, #3b82f6);
}

.count-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--ds-text-secondary, #6b7280);
}

.action-cell {
  display: flex;
  gap: 4px;
}

.seq-cell {
  color: var(--ds-text-tertiary, #9ca3af);
}
</style>
