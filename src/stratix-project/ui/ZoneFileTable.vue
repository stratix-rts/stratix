<template>
  <div
    class="zone-file-table"
    :class="{ 'is-dragging': isDragging }"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <!-- 拖拽上传遮罩 -->
    <div v-if="isDragging" class="drag-overlay">
      <div class="drag-overlay-content">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
        <span>拖放图片到此处上传</span>
      </div>
    </div>
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
        <span v-if="selectCount > 0" class="select-count">已选择 {{ selectCount }} 项</span>
        <StratixButton
          v-if="selectCount > 0"
          size="small"
          variant="ghost"
          danger
          @click="handleBatchDelete"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3,6 5,6 21,6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          批量删除
        </StratixButton>
        <StratixButton size="small" @click="handleRefresh">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          刷新
        </StratixButton>
      </div>
    </div>

    <!-- 上传错误提示 -->
    <div v-if="uploadError" class="upload-error">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      {{ uploadError }}
    </div>

    <!-- 表格 -->
    <vxe-grid
      ref="tableRef"
      :data="filteredFiles"
      :columns="columns"
      stripe
      border
      show-overflow
      height="450"
      :sort-config="{ trigger: 'cell', remote: false, orders: ['asc', 'desc', 'null'] }"
      :scroll-y="{ enabled: true, gt: 20 }"
      :edit-config="{ mode: 'cell', showIcon: false, keyboard: true }"
      :checkbox-config="{ checkMethod: allowCheckbox }"
      highlight-hover-row
      @checkbox-change="handleCheckboxChange"
      @keydown="handleGridKeydown"
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
          :class="{ 'is-url': row.sourceType === 'url' }"
          :title="row.metadata?.title || row.source"
          @click="row.sourceType === 'url' && openUrl(row.source)"
        >
          <template v-if="row.sourceType === 'url'">
            <img
              v-if="row.metadata?.favicon"
              :src="row.metadata.favicon"
              class="url-favicon"
              @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
            />
            <svg v-else viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
            </svg>
            <span v-if="row.metadata?.title" class="url-title">{{ row.metadata.title }}</span>
            <span v-else class="url-source">{{ row.source }}</span>
          </template>
          <template v-else>
            {{ row.source }}
          </template>
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
            v-if="isTextFile(row.fileType)"
            size="tiny"
            variant="ghost"
            @click="handleShowVersionHistory(row)"
          >
            历史
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

    <!-- 版本历史弹窗 -->
    <StratixModal
      :visible="versionHistoryVisible"
      title="版本历史"
      width="70vw"
      max-width="900px"
      @update:visible="versionHistoryVisible = false"
    >
      <div class="version-history-container">
        <div v-if="versionHistoryLoading" class="version-loading">
          加载中...
        </div>
        <div v-else-if="versionHistory.length === 0" class="version-empty">
          暂无版本记录
        </div>
        <div v-else class="version-list">
          <div
            v-for="(version, index) in versionHistory"
            :key="version.id"
            class="version-item"
            :class="{ 'is-current': index === 0 }"
          >
            <div class="version-info">
              <div class="version-header">
                <span class="version-label">{{ index === 0 ? '当前版本' : `版本 ${versionHistory.length - index}` }}</span>
                <span class="version-date">{{ formatDate(version.createdAt) }}</span>
              </div>
              <div v-if="version.description" class="version-desc">{{ version.description }}</div>
              <div class="version-preview">{{ getVersionPreview(version.content) }}</div>
            </div>
            <div class="version-actions">
              <StratixButton size="small" variant="ghost" @click="handlePreviewVersion(version)">
                预览
              </StratixButton>
              <StratixButton
                v-if="index !== 0"
                size="small"
                variant="ghost"
                @click="handleRollbackToVersion(version)"
              >
                回滚
              </StratixButton>
            </div>
          </div>
        </div>
      </div>
    </StratixModal>

    <!-- 版本内容预览弹窗 -->
    <StratixModal
      :visible="showVersionPreview"
      :title="`版本预览 - ${previewVersion?.createdAt ? formatDate(previewVersion.createdAt) : ''}`"
      width="80vw"
      max-width="1000px"
      @update:visible="showVersionPreview = false"
    >
      <div class="version-content-container">
        <pre class="version-content">{{ previewVersion?.content || '' }}</pre>
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
import type { ZoneFile, FileType, FileVersion } from '../types';

// 支持版本历史的文件类型
const TEXT_FILE_TYPES: FileType[] = ['md', 'txt', 'ts', 'js', 'fig', 'link'];

// 判断是否为文本文件（支持版本历史）
const isTextFile = (fileType?: FileType | string): boolean => {
  if (!fileType) return false;
  return TEXT_FILE_TYPES.includes(fileType as FileType);
};

interface Props {
  files: ZoneFile[];
  zoneName?: string;
  zoneId?: string;
}

const props = withDefaults(defineProps<Props>(), {
  zoneName: '',
  zoneId: '',
});

// 搜索结果（用于存储 API 返回的搜索结果）
const searchResults = ref<ZoneFile[] | null>(null);
const isSearching = ref(false);

const emit = defineEmits<{
  refresh: [];
  'file-select': [file: ZoneFile];
  'file-delete': [file: ZoneFile];
  'file-refresh': [file: ZoneFile];
  'file-update': [file: ZoneFile];
  'file-batch-delete': [files: ZoneFile[]];
}>();

const tableRef = ref<VxeGridInstance | null>(null);
const searchKeyword = ref('');
const filterType = ref('');
const filterSource = ref('');
const showPreview = ref(false);
const previewFile = ref<ZoneFile | null>(null);
const selectedFiles = ref<ZoneFile[]>([]);

// 版本历史相关
const versionHistoryVisible = ref(false);
const versionHistoryLoading = ref(false);
const selectedFileForHistory = ref<ZoneFile | null>(null);
const versionHistory = ref<FileVersion[]>([]);
const showVersionPreview = ref(false);
const previewVersion = ref<FileVersion | null>(null);

// 选中数量
const selectCount = computed(() => selectedFiles.value.length);

// 拖拽状态
const isDragging = ref(false);
const dragCounter = ref(0);
const uploadProgress = ref<Map<string, number>>(new Map());
const uploadError = ref<string | null>(null);

// 列定义 - 使用 slots 属性指定插槽名称
const columns: VxeGridPropTypes.Columns = [
  { type: 'checkbox', width: 60 },
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
  // 如果有搜索结果（来自 API），直接使用
  if (searchResults.value !== null) {
    let result = searchResults.value;

    // 搜索结果仍然应用类型和来源筛选
    if (filterType.value) {
      result = result.filter((file) => file.fileType === filterType.value);
    }
    if (filterSource.value) {
      result = result.filter((file) => file.sourceType === filterSource.value);
    }
    return result;
  }

  let result = props.files;

  // 按类型筛选
  if (filterType.value) {
    result = result.filter((file) => file.fileType === filterType.value);
  }

  // 按来源筛选
  if (filterSource.value) {
    result = result.filter((file) => file.sourceType === filterSource.value);
  }

  // 按关键词搜索（前端过滤，仅匹配名称和来源）
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

// 搜索（支持全文搜索）
const handleSearch = async () => {
  if (!searchKeyword.value.trim()) {
    // 空搜索词，显示所有文件
    searchResults.value = null;
    return;
  }

  // 如果有 zoneId，调用后端 API 进行全文搜索
  if (props.zoneId) {
    isSearching.value = true;
    try {
      const response = await fetch(`/api/zones/${props.zoneId}/files/search?keyword=${encodeURIComponent(searchKeyword.value)}`);
      const result = await response.json();
      if (result.success) {
        searchResults.value = result.files;
      }
    } catch (error) {
      console.error('[ZoneFileTable] Search failed:', error);
    } finally {
      isSearching.value = false;
    }
  }
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

// 获取 URL 文件元信息（title, favicon）
const fetchUrlMeta = async (file: ZoneFile) => {
  if (file.sourceType !== 'url' || !props.zoneId) return;

  try {
    const response = await fetch(`/api/zones/${props.zoneId}/files/${file.id}/metadata`);
    const result = await response.json();

    if (result.success && (result.title || result.favicon)) {
      // 更新文件的 metadata
      file.metadata = { ...file.metadata, ...result };
      // 触发更新以刷新 UI
      emit('file-update', file);
    }
  } catch (error) {
    console.warn('[ZoneFileTable] Failed to fetch URL metadata:', error);
  }
};

// Checkbox 变化处理
const handleCheckboxChange = ({ records }: { records: ZoneFile[] }) => {
  selectedFiles.value = records;
};

// 允许 Checkbox（可根据条件禁用某些行）
const allowCheckbox = ({ row }: { row: ZoneFile }) => {
  return true;
};

// 批量删除
const handleBatchDelete = () => {
  if (selectedFiles.value.length === 0) return;
  if (confirm(`确定要删除选中的 ${selectedFiles.value.length} 个文件吗？`)) {
    emit('file-batch-delete', selectedFiles.value);
    selectedFiles.value = [];
  }
};

// 键盘导航处理
const handleGridKeydown = (e: KeyboardEvent) => {
  const table = tableRef.value;
  if (!table) return;

  const selectRow = table.getSelectedIndexRow();
  const visibleData = table.getData();

  if (e.key === 'ArrowDown' && visibleData.length > 0) {
    e.preventDefault();
    const nextIndex = selectRow ? visibleData.indexOf(selectRow) + 1 : 0;
    if (nextIndex < visibleData.length) {
      table.scrollToRow(visibleData[nextIndex]);
      table.setCurrentRow(visibleData[nextIndex]);
    }
  } else if (e.key === 'ArrowUp' && visibleData.length > 0) {
    e.preventDefault();
    const currIndex = selectRow ? visibleData.indexOf(selectRow) : 0;
    if (currIndex > 0) {
      table.scrollToRow(visibleData[currIndex - 1]);
      table.setCurrentRow(visibleData[currIndex - 1]);
    }
  } else if (e.key === 'Enter' || e.key === 'F2') {
    e.preventDefault();
    // Enter/F2 on a row could open the file or show preview
    if (selectRow) {
      handleOpenFile(selectRow);
    }
  }
};

// 打开 URL
const openUrl = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

// 拖拽处理
const handleDragOver = (e: DragEvent) => {
  e.preventDefault();
  if (!isDragging.value) {
    isDragging.value = true;
  }
  dragCounter.value++;
};

const handleDragLeave = (e: DragEvent) => {
  e.preventDefault();
  dragCounter.value--;
  if (dragCounter.value === 0) {
    isDragging.value = false;
  }
};

const handleDrop = async (e: DragEvent) => {
  e.preventDefault();
  isDragging.value = false;
  dragCounter.value = 0;
  uploadError.value = null;

  const files = e.dataTransfer?.files;
  if (!files?.length) return;

  // 只支持图片文件
  const imageFiles = Array.from(files).filter((file) =>
    file.type.startsWith('image/')
  );

  if (imageFiles.length === 0) {
    uploadError.value = '只支持图片文件上传';
    setTimeout(() => { uploadError.value = null; }, 3000);
    return;
  }

  if (!props.zoneId) {
    uploadError.value = '无法获取 Zone ID';
    setTimeout(() => { uploadError.value = null; }, 3000);
    return;
  }

  // 上传文件
  for (const file of imageFiles) {
    await uploadFile(file);
  }

  // 刷新列表
  emit('refresh');
};

// ============================================
// 版本历史相关方法
// ============================================

// 显示版本历史
const handleShowVersionHistory = async (file: ZoneFile) => {
  if (!props.zoneId) return;

  selectedFileForHistory.value = file;
  versionHistoryVisible.value = true;
  versionHistoryLoading.value = true;
  versionHistory.value = [];

  try {
    const response = await fetch(`/api/zones/${props.zoneId}/files/${file.id}/versions`);
    const data = await response.json();

    if (data.success) {
      versionHistory.value = data.versions || [];
    } else {
      console.error('[ZoneFileTable] Failed to get versions:', data.error);
    }
  } catch (error) {
    console.error('[ZoneFileTable] Failed to fetch versions:', error);
  } finally {
    versionHistoryLoading.value = false;
  }
};

// 预览版本内容
const handlePreviewVersion = (version: FileVersion) => {
  previewVersion.value = version;
  showVersionPreview.value = true;
};

// 回滚到指定版本
const handleRollbackToVersion = async (version: FileVersion) => {
  if (!props.zoneId || !selectedFileForHistory.value) return;

  if (!confirm(`确定要回滚到 ${formatDate(version.createdAt)} 的版本吗？`)) {
    return;
  }

  try {
    const response = await fetch(`/api/zones/${props.zoneId}/files/${selectedFileForHistory.value.id}/rollback/${version.id}`, {
      method: 'POST'
    });
    const data = await response.json();

    if (data.success) {
      // 刷新版本列表
      await handleShowVersionHistory(selectedFileForHistory.value);
      // 通知父组件刷新文件列表
      emit('refresh');
    } else {
      alert(`回滚失败: ${data.error}`);
    }
  } catch (error) {
    console.error('[ZoneFileTable] Failed to rollback:', error);
    alert('回滚失败');
  }
};

// 获取版本预览（前100字符）
const getVersionPreview = (content: string): string => {
  if (!content) return '-';
  const preview = content.substring(0, 100);
  return preview.length < content.length ? `${preview}...` : preview;
};

const uploadFile = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', file.name);
  formData.append('sourceType', 'local');

  try {
    const response = await fetch(`/api/zones/${props.zoneId}/files`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `上传失败: ${response.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '上传失败';
    uploadError.value = message;
    console.error('[ZoneFileTable] Upload error:', error);
    throw error;
  }
};
</script>

<style scoped>
.zone-file-table {
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
}

.zone-file-table.is-dragging {
  background-color: rgba(59, 130, 246, 0.05);
  border-radius: 8px;
}

.drag-overlay {
  position: absolute;
  inset: 0;
  background-color: rgba(59, 130, 246, 0.1);
  border: 2px dashed #3b82f6;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(2px);
}

.drag-overlay-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #3b82f6;
  font-weight: 500;
  font-size: 16px;
}

.upload-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background-color: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border-radius: 6px;
  font-size: 14px;
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
  align-items: center;
}

.select-count {
  font-size: 13px;
  color: var(--ds-text-secondary, #6b7280);
  white-space: nowrap;
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

.file-source.is-url {
  cursor: pointer;
}

.file-source.is-url:hover {
  color: var(--ds-primary, #3b82f6);
}

.url-favicon {
  width: 14px;
  height: 14px;
  object-fit: contain;
  flex-shrink: 0;
}

.url-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.url-source {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.7;
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

/* 版本历史样式 */
.version-history-container {
  max-height: 60vh;
  overflow-y: auto;
}

.version-loading,
.version-empty {
  text-align: center;
  padding: 40px;
  color: var(--ds-text-secondary, #6b7280);
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.version-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px;
  border: 1px solid var(--ds-border, #e5e7eb);
  border-radius: 8px;
  transition: all 0.15s ease;
}

.version-item:hover {
  background-color: var(--ds-bg-hover, #f9fafb);
}

.version-item.is-current {
  border-color: var(--ds-primary, #3b82f6);
  background-color: rgba(59, 130, 246, 0.05);
}

.version-info {
  flex: 1;
  min-width: 0;
}

.version-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}

.version-label {
  font-weight: 500;
  color: var(--ds-text-primary, #111827);
}

.version-date {
  font-size: 13px;
  color: var(--ds-text-secondary, #6b7280);
}

.version-desc {
  font-size: 13px;
  color: var(--ds-text-secondary, #6b7280);
  margin-bottom: 8px;
}

.version-preview {
  font-size: 13px;
  color: var(--ds-text-tertiary, #9ca3af);
  font-family: monospace;
  background-color: var(--ds-bg-secondary, #f3f4f6);
  padding: 8px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  margin-left: 16px;
}

.version-content-container {
  max-height: 70vh;
  overflow: auto;
}

.version-content {
  font-family: monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  background-color: var(--ds-bg-secondary, #f3f4f6);
  padding: 16px;
  border-radius: 8px;
  margin: 0;
}
</style>
