<template>
  <div class="zone-file-table">
    <!-- 工具栏 -->
    <div class="file-table-toolbar">
      <div class="toolbar-left">
        <!-- 文件类型筛选 -->
        <StratixSelect
          v-model="filterType"
          placeholder="筛选类型"
          clearable
          @update:model-value="handleFilterChange"
        >
          <option value="">全部</option>
          <option value="image">🖼️ 图片</option>
          <option value="md">📄 Markdown</option>
          <option value="txt">📝 文本</option>
          <option value="ts">📘 TypeScript</option>
          <option value="js">📒 JavaScript</option>
          <option value="folder">📁 文件夹</option>
          <option value="link">🔗 链接</option>
          <option value="other">📎 其他</option>
        </StratixSelect>

        <!-- 来源类型筛选 -->
        <StratixSelect
          v-model="filterSource"
          placeholder="筛选来源"
          clearable
          @update:model-value="handleFilterChange"
        >
          <option value="">全部</option>
          <option value="local">💾 本地</option>
          <option value="url">🌐 URL</option>
        </StratixSelect>

        <StratixInput
          v-model="searchKeyword"
          placeholder="搜索文件..."
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

    <!-- 表格 -->
    <vxe-grid
      ref="tableRef"
      :data="filteredFiles"
      :columns="columns"
      stripe
      border
      show-overflow
      :max-height="450"
      :sort-config="{ trigger: 'cell', remote: false, orders: ['asc', 'desc', 'null'] }"
    >
      <!-- 文件类型列 -->
      <template #fileTypeSlot="{ row }">
        <span class="file-type-icon" :title="row.fileType">
          {{ getFileTypeIcon(row.fileType) }}
        </span>
      </template>

      <template #sourceTypeSlot="{ row }">
        <span class="source-type" :class="row.sourceType">
          {{ row.sourceType === 'local' ? '💾 本地' : '🌐 URL' }}
        </span>
      </template>

      <template #nameSlot="{ row }">
        <span class="file-name" :title="row.name">
          {{ row.name }}
        </span>
      </template>

      <template #sourceSlot="{ row }">
        <span
          class="file-source"
          :title="row.source"
          @click="row.sourceType === 'url' && openUrl(row.source)"
        >
          <template v-if="row.sourceType === 'url'">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
            </svg>
          </template>
          {{ row.source }}
        </span>
      </template>

      <template #thumbnailSlot="{ row }">
        <template v-if="row.fileType === 'image'">
          <img
            v-if="row.thumbnailUrl || row.metadata?.thumbnailUrl"
            :src="row.thumbnailUrl || row.metadata?.thumbnailUrl"
            class="file-thumbnail"
            @click="handlePreview(row)"
          />
          <span v-else class="thumbnail-placeholder" @click="handlePreview(row)">
            🖼️
          </span>
        </template>
        <span v-else class="no-preview">-</span>
      </template>

      <template #lastFetchedSlot="{ row }">
        {{ row.lastFetched ? formatDate(row.lastFetched) : '从未' }}
      </template>

      <template #actionSlot="{ row }">
        <div class="action-cell">
          <StratixButton
            v-if="row.fileType === 'image'"
            size="tiny"
            variant="ghost"
            @click="handlePreview(row)"
          >
            预览
          </StratixButton>
          <StratixButton
            v-if="row.sourceType === 'url'"
            size="tiny"
            variant="ghost"
            @click="handleRefreshFile(row)"
          >
            刷新
          </StratixButton>
          <StratixButton
            size="tiny"
            variant="ghost"
            @click="handleOpenFile(row)"
          >
            打开
          </StratixButton>
          <StratixButton size="tiny" variant="ghost" danger @click="handleDelete(row)">
            删除
          </StratixButton>
        </div>
      </template>
    </vxe-grid>

    <!-- 图片预览弹窗 -->
    <StratixModal
      :visible="showPreview"
      title="图片预览"
      width="80vw"
      max-width="1200px"
      @update:visible="showPreview = false"
    >
      <div class="preview-container">
        <img v-if="previewFile" :src="previewFile.source" :alt="previewFile.name" class="preview-image" />
      </div>
    </StratixModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { VxeGridInstance, VxeGridPropTypes } from 'vxe-table';
import StratixInput from '@/components/ui/StratixInput.vue';
import StratixSelect from '@/components/ui/StratixSelect.vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import StratixModal from '@/components/ui/StratixModal.vue';
import type { ZoneFile, FileType } from '../types';

interface Props {
  files: ZoneFile[];
  zoneName?: string;
}

const props = withDefaults(defineProps<Props>(), {
  zoneName: '',
});

const emit = defineEmits<{
  refresh: [];
  'file-select': [file: ZoneFile];
  'file-delete': [file: ZoneFile];
  'file-refresh': [file: ZoneFile];
}>();

const tableRef = ref<VxeGridInstance | null>(null);
const searchKeyword = ref('');
const filterType = ref('');
const filterSource = ref('');
const showPreview = ref(false);
const previewFile = ref<ZoneFile | null>(null);

// 列定义 - 使用 slots 属性指定插槽名称
const columns: VxeGridPropTypes.Columns = [
  { type: 'seq', width: 60, title: '#' },
  { field: 'name', title: '文件名', width: 200, sortable: true, slots: { default: 'nameSlot' } },
  { field: 'fileType', title: '类型', width: 80, slots: { default: 'fileTypeSlot' } },
  { field: 'sourceType', title: '来源', width: 90, slots: { default: 'sourceTypeSlot' } },
  { field: 'source', title: '路径/URL', minWidth: 250, showOverflow: true, slots: { default: 'sourceSlot' } },
  { field: 'thumbnail', title: '预览', width: 80, slots: { default: 'thumbnailSlot' } },
  { field: 'lastFetched', title: '最后刷新', width: 140, slots: { default: 'lastFetchedSlot' } },
  { field: 'action', title: '操作', width: 200, fixed: 'right', slots: { default: 'actionSlot' } },
];

// 文件类型图标映射
const fileTypeIcons: Record<string, string> = {
  md: '📄',
  txt: '📝',
  ts: '📘',
  js: '📒',
  fig: '🎨',
  image: '🖼️',
  folder: '📁',
  link: '🔗',
  other: '📎',
};

const getFileTypeIcon = (fileType?: FileType | string) => {
  if (!fileType) return fileTypeIcons.other;
  return fileTypeIcons[fileType] || fileTypeIcons.other;
};

// 过滤后的文件
const filteredFiles = computed(() => {
  let result = props.files;

  // 按类型筛选
  if (filterType.value) {
    result = result.filter((file) => file.fileType === filterType.value);
  }

  // 按来源筛选
  if (filterSource.value) {
    result = result.filter((file) => file.sourceType === filterSource.value);
  }

  // 按关键词搜索
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(
      (file) =>
        file.name?.toLowerCase().includes(keyword) ||
        file.source?.toLowerCase().includes(keyword)
    );
  }

  return result;
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
const handleSearch = () => {
  // 搜索通过 computed 属性自动处理
};

// 筛选变化
const handleFilterChange = () => {
  // 筛选通过 computed 属性自动处理
};

// 刷新
const handleRefresh = () => {
  emit('refresh');
};

// 预览文件
const handlePreview = (file: ZoneFile) => {
  previewFile.value = file;
  showPreview.value = true;
};

// 刷新文件
const handleRefreshFile = (file: ZoneFile) => {
  emit('file-refresh', file);
};

// 打开文件
const handleOpenFile = (file: ZoneFile) => {
  if (file.sourceType === 'url') {
    openUrl(file.source);
  } else {
    // 本地文件可以通过 shell 打开
    // TODO: 实现本地文件打开
    console.log('[ZoneFileTable] Open local file:', file.source);
  }
};

// 删除文件
const handleDelete = (file: ZoneFile) => {
  emit('file-delete', file);
};

// 打开 URL
const openUrl = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};
</script>

<style scoped>
.zone-file-table {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.file-table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-left {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
}

.toolbar-left > * {
  min-width: 120px;
  max-width: 200px;
}

.toolbar-right {
  display: flex;
  gap: 8px;
}

.file-type-icon {
  font-size: 16px;
  cursor: default;
}

.source-type {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.source-type.local {
  background-color: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.source-type.url {
  background-color: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.file-name {
  font-weight: 500;
}

.file-source {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ds-text-secondary, #6b7280);
  cursor: default;
}

.file-source:hover {
  color: var(--ds-primary, #3b82f6);
  cursor: pointer;
}

.file-thumbnail {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.file-thumbnail:hover {
  transform: scale(1.1);
}

.thumbnail-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  background-color: var(--ds-bg-secondary, #f3f4f6);
  border-radius: 4px;
  cursor: pointer;
  font-size: 20px;
}

.no-preview {
  color: var(--ds-text-tertiary, #9ca3af);
}

.action-cell {
  display: flex;
  gap: 4px;
}

.preview-container {
  display: flex;
  align-items: center;
  justify-content: center;
  max-height: 70vh;
  overflow: auto;
}

.preview-image {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
}
</style>
