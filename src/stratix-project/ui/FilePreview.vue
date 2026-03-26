<template>
  <StratixModal
    :visible="visible"
    :title="file?.name || '文件预览'"
    :width="modalWidth"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="file-preview">
      <!-- 图片预览 -->
      <template v-if="file?.fileType === 'image'">
        <div class="image-preview">
          <img :src="file.source" :alt="file.name" class="preview-image" @error="handleImageError" />
        </div>
      </template>

      <!-- Markdown 预览 -->
      <template v-else-if="file?.fileType === 'md'">
        <div class="markdown-preview" v-html="renderedContent"></div>
      </template>

      <!-- URL 链接预览 -->
      <template v-else-if="file?.sourceType === 'url'">
        <div class="url-preview">
          <div class="url-header">
            <img v-if="favicon" :src="favicon" alt="favicon" class="url-favicon" @error="favicon = null" />
            <span class="url-title">{{ pageTitle || file.name }}</span>
          </div>
          <div class="url-meta">
            <span class="url-domain">{{ domain }}</span>
            <a :href="file.source" target="_blank" rel="noopener noreferrer" class="url-link">
              打开链接
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
              </svg>
            </a>
          </div>
          <div v-if="pageDescription" class="url-description">
            {{ pageDescription }}
          </div>
        </div>
      </template>

      <!-- 本地文件夹 -->
      <template v-else-if="file?.fileType === 'folder'">
        <div class="folder-preview">
          <div class="folder-icon">📁</div>
          <div class="folder-info">
            <span class="folder-name">{{ file.name }}</span>
            <span class="folder-path">{{ file.source }}</span>
          </div>
          <StratixButton size="small" @click="openInExplorer">
            在文件管理器中显示
          </StratixButton>
        </div>
      </template>

      <!-- 文本文件预览 -->
      <template v-else-if="['txt', 'ts', 'js', 'other'].includes(file?.fileType || '')">
        <div class="code-preview">
          <pre><code>{{ content || '无法加载内容' }}</code></pre>
        </div>
      </template>

      <!-- 未知类型 -->
      <template v-else>
        <div class="unknown-preview">
          <span class="unknown-icon">📎</span>
          <span class="unknown-message">暂不支持预览此类型文件</span>
          <span class="unknown-path">{{ file?.source }}</span>
        </div>
      </template>
    </div>

    <!-- 文件信息 -->
    <template #footer>
      <div class="preview-footer">
        <div class="file-meta">
          <span v-if="file?.metadata?.size" class="meta-item">
            {{ formatFileSize(file.metadata.size) }}
          </span>
          <span v-if="file?.metadata?.mimeType" class="meta-item">
            {{ file.metadata.mimeType }}
          </span>
          <span v-if="file?.lastFetched" class="meta-item">
            最后刷新: {{ formatDate(file.lastFetched) }}
          </span>
        </div>
        <div class="footer-actions">
          <StratixButton variant="secondary" size="small" @click="$emit('update:visible', false)">
            关闭
          </StratixButton>
          <StratixButton
            v-if="file?.sourceType === 'url'"
            size="small"
            @click="openInBrowser"
          >
            在浏览器中打开
          </StratixButton>
        </div>
      </div>
    </template>
  </StratixModal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import StratixModal from '@/components/ui/StratixModal.vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import type { ZoneFile } from '../types';

interface Props {
  visible: boolean;
  file: ZoneFile | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
}>();

// 状态
const content = ref<string | null>(null);
const favicon = ref<string | null>(null);
const pageTitle = ref<string | null>(null);
const pageDescription = ref<string | null>(null);
const imageError = ref(false);

// 计算属性
const modalWidth = computed(() => {
  if (props.file?.fileType === 'image') return '90vw';
  return '70vw';
});

const domain = computed(() => {
  if (!props.file?.source) return '';
  try {
    const url = new URL(props.file.source);
    return url.hostname;
  } catch {
    return '';
  }
});

const renderedContent = computed(() => {
  // 简单的 Markdown 渲染（实际项目中可以使用 marked 或其他库）
  if (!content.value) return '';
  return content.value
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*)\*/gim, '<em>$1</em>')
    .replace(/\n/gim, '<br />');
});

// 格式化文件大小
const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// 格式化日期
const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// 图片加载错误
const handleImageError = () => {
  imageError.value = true;
};

// 在浏览器中打开
const openInBrowser = () => {
  if (props.file?.source) {
    window.open(props.file.source, '_blank', 'noopener,noreferrer');
  }
};

// 在文件管理器中显示
const openInExplorer = () => {
  // TODO: 实现跨平台打开文件管理器
  console.log('[FilePreview] Open in explorer:', props.file?.source);
};

// 加载内容
const loadContent = async () => {
  if (!props.file) return;

  if (props.file.fileType === 'image') {
    // 图片不需要加载内容
    return;
  }

  if (props.file.sourceType === 'url' && props.file.fileType === 'md') {
    // URL Markdown 文件
    try {
      const response = await fetch(props.file.source);
      content.value = await response.text();
      favicon.value = `https://www.google.com/s2/favicons?domain=${domain.value}&sz=64`;
    } catch (error) {
      console.error('[FilePreview] Failed to load URL content:', error);
    }
  } else if (props.file.content) {
    // 直接使用缓存的内容
    content.value = props.file.content;
  } else if (props.file.sourceType === 'local') {
    // 本地文件 - 需要通过 API 读取
    // TODO: 实现本地文件读取
  }
};

// 监听 file 变化
watch(
  () => props.file,
  () => {
    content.value = null;
    favicon.value = null;
    pageTitle.value = null;
    pageDescription.value = null;
    imageError.value = false;
    loadContent();
  },
  { immediate: true }
);
</script>

<style scoped>
.file-preview {
  min-height: 200px;
  max-height: 60vh;
  overflow: auto;
}

/* 图片预览 */
.image-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.preview-image {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

/* Markdown 预览 */
.markdown-preview {
  padding: 16px;
  line-height: 1.6;
  font-size: 14px;
  color: var(--ds-text-primary, #111827);
}

.markdown-preview :deep(h1) {
  font-size: 24px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--ds-border, #e5e7eb);
  padding-bottom: 8px;
}

.markdown-preview :deep(h2) {
  font-size: 20px;
  margin: 20px 0 12px;
}

.markdown-preview :deep(h3) {
  font-size: 16px;
  margin: 16px 0 8px;
}

.markdown-preview :deep(code) {
  background-color: var(--ds-bg-secondary, #f3f4f6);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 13px;
}

/* URL 预览 */
.url-preview {
  padding: 16px;
}

.url-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.url-favicon {
  width: 32px;
  height: 32px;
  border-radius: 4px;
}

.url-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--ds-text-primary, #111827);
}

.url-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 13px;
}

.url-domain {
  color: var(--ds-text-secondary, #6b7280);
}

.url-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ds-primary, #3b82f6);
  text-decoration: none;
}

.url-link:hover {
  text-decoration: underline;
}

.url-description {
  padding: 12px;
  background-color: var(--ds-bg-secondary, #f9fafb);
  border-radius: 8px;
  font-size: 13px;
  color: var(--ds-text-secondary, #6b7280);
  line-height: 1.5;
}

/* 文件夹预览 */
.folder-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 40px;
}

.folder-icon {
  font-size: 64px;
}

.folder-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.folder-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--ds-text-primary, #111827);
}

.folder-path {
  font-size: 12px;
  color: var(--ds-text-tertiary, #9ca3af);
  font-family: monospace;
}

/* 代码预览 */
.code-preview {
  padding: 16px;
  background-color: #1e1e1e;
  border-radius: 8px;
  overflow: auto;
}

.code-preview pre {
  margin: 0;
}

.code-preview code {
  font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  color: #d4d4d4;
}

/* 未知类型 */
.unknown-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px;
}

.unknown-icon {
  font-size: 48px;
  opacity: 0.5;
}

.unknown-message {
  font-size: 14px;
  color: var(--ds-text-secondary, #6b7280);
}

.unknown-path {
  font-size: 12px;
  color: var(--ds-text-tertiary, #9ca3af);
  font-family: monospace;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Footer */
.preview-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.file-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--ds-text-tertiary, #9ca3af);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.footer-actions {
  display: flex;
  gap: 8px;
}
</style>
