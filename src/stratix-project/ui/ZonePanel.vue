<script setup lang="ts">
import { ref, watch, defineAsyncComponent } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import StratixModal from '@/components/ui/StratixModal.vue';
import ZoneDetail from './ZoneDetail.vue';
import type { Zone, ZoneFile, ZoneUpdateRequest, ZoneFileAddRequest } from '../types';

const ZoneFilePicker = defineAsyncComponent(() => import('./ZoneFilePicker.vue'));

interface Props {
  visible: boolean;
  zone: Zone | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'close': [];
  'open-data-explorer': [zoneId: string];
}>();

const currentZone = ref<Zone | null>(null);
const loading = ref(false);
const showFilePicker = ref(false);
const filePickerRef = ref<ComponentPublicInstance | null>(null);
const notification = ref<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
const showAgentPicker = ref(false);
const availableAgentsForPicker = ref<Array<{ agentId: string; name: string }>>([]);

watch(() => props.zone, (newZone) => {
  currentZone.value = newZone ? { ...newZone } : null;
}, { immediate: true });

const showNotification = (type: 'success' | 'error' | 'info', message: string, duration = 3000) => {
  notification.value = { type, message };
  setTimeout(() => {
    notification.value = null;
  }, duration);
};

const handleClose = () => {
  emit('update:visible', false);
  emit('close');
};

const handleUpdateZone = async (updates: Partial<Zone> & { id: string }) => {
  if (!currentZone.value) return;

  loading.value = true;
  try {
    const response = await fetch(
      `/api/zones/${updates.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: updates.title,
          prompt: updates.prompt
        } as ZoneUpdateRequest)
      }
    );

    const result = await response.json();
    if (result.success && result.zone) {
      currentZone.value = result.zone;
      showNotification('success', 'Zone 已保存');
    } else {
      showNotification('error', '保存失败，请重试');
    }
  } catch (error) {
    console.error('[ZonePanel] Failed to update zone:', error);
    showNotification('error', '保存失败：网络错误');
  } finally {
    loading.value = false;
  }
};

const handleDeleteZone = async (zoneId: string) => {
  if (!currentZone.value) return;

  loading.value = true;
  try {
    const response = await fetch(
      `/api/zones/${zoneId}`,
      {
        method: 'DELETE'
      }
    );

    const result = await response.json();
    if (result.success) {
      showNotification('success', 'Zone 已删除');
      handleClose();
    } else {
      showNotification('error', '删除失败，请重试');
    }
  } catch (error) {
    console.error('[ZonePanel] Failed to delete zone:', error);
    showNotification('error', '删除失败：网络错误');
  } finally {
    loading.value = false;
  }
};

const handleCloneZone = async (clonedZone: Zone) => {
  showNotification('success', `Zone "${clonedZone.title}" 已克隆`);
};

const handleAddFile = async (zoneId: string) => {
  if (!currentZone.value) return;
  showFilePicker.value = true;
};

const handleFilePickerClose = () => {
  showFilePicker.value = false;
};

const handleScanFolder = async (data: { folderPath: string; recursive?: boolean; extensions?: string[] }) => {
  if (!currentZone.value) return;

  try {
    const extensions = data.extensions
      ? data.extensions.split(',').map(e => e.trim()).filter(Boolean)
      : undefined;

    const response = await fetch(
      `/api/zones/${currentZone.value.id}/files/scan-folder`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: data.folderPath,
          recursive: data.recursive ?? true,
          extensions
        })
      }
    );

    const result = await response.json();
    if (result.success && result.files && filePickerRef.value) {
      const scannedFiles = result.files.map((f: any) => ({
        name: f.name,
        source: f.source,
        sourceType: 'local' as const,
        icon: getFileIcon(f.name)
      }));
      filePickerRef.value.addScannedFiles(scannedFiles);
    }
  } catch (error) {
    console.error('[ZonePanel] Failed to scan folder:', error);
  }
};

const handleAddFiles = async (files: Array<{ name: string; sourceType: 'local' | 'url'; source: string }>) => {
  if (!currentZone.value) return;

  loading.value = true;
  try {
    const results = await Promise.all(
      files.map(file =>
        fetch(`/api/zones/${currentZone.value.id}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(file)
        }).then(response => response.json())
      )
    );

    const newFiles: ZoneFile[] = results
      .filter((result): result is { success: boolean; file: ZoneFile } =>
        result.success && result.file
      )
      .map(result => result.file);

    if (newFiles.length > 0 && currentZone.value) {
      currentZone.value.files = [...currentZone.value.files, ...newFiles];
    }

    showFilePicker.value = false;
  } catch (error) {
    console.error('[ZonePanel] Failed to add files:', error);
    showNotification('error', '添加文件失败，请重试');
  } finally {
    loading.value = false;
  }
};

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, string> = {
    md: '📝', txt: '📄', ts: '📘', tsx: '📘', js: '📒', jsx: '📒',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️',
    pdf: '📕', fig: '🎨', link: '🔗'
  };
  return iconMap[ext] || '📄';
}

const handleRemoveFile = async (zoneId: string, fileId: string) => {
  if (!currentZone.value) return;

  loading.value = true;
  try {
    const response = await fetch(
      `/api/zones/${zoneId}/files/${fileId}`,
      {
        method: 'DELETE'
      }
    );

    const result = await response.json();
    if (result.success && currentZone.value) {
      currentZone.value.files = currentZone.value.files.filter(f => f.id !== fileId);
    } else {
      showNotification('error', '删除文件失败');
    }
  } catch (error) {
    console.error('[ZonePanel] Failed to remove file:', error);
    showNotification('error', '删除文件失败，请重试');
  } finally {
    loading.value = false;
  }
};

const handleRefreshFile = async (zoneId: string, fileId: string) => {
  if (!currentZone.value) return;

  loading.value = true;
  try {
    const response = await fetch(
      `/api/zones/${zoneId}/files/${fileId}/refresh`,
      {
        method: 'POST'
      }
    );

    const result = await response.json();
    if (result.success && result.file && currentZone.value) {
      const index = currentZone.value.files.findIndex(f => f.id === fileId);
      if (index !== -1) {
        currentZone.value.files[index] = result.file;
      }
    } else {
      showNotification('error', '刷新文件失败');
    }
  } catch (error) {
    console.error('[ZonePanel] Failed to refresh file:', error);
    showNotification('error', '刷新文件失败，请重试');
  } finally {
    loading.value = false;
  }
};

const handleAddMember = async (zoneId: string) => {
  if (!currentZone.value) return;

  const availableAgents = await fetchAvailableAgents();
  const existingMemberIds = currentZone.value.members || [];
  const eligibleAgents = availableAgents.filter(a => !existingMemberIds.includes(a.agentId));

  if (eligibleAgents.length === 0) {
    showNotification('info', '没有可添加的 Agent，所有 Agent 已在当前 Zone 中');
    return;
  }

  availableAgentsForPicker.value = eligibleAgents;
  showAgentPicker.value = true;
};

const handleAgentPickerSelect = async (agentId: string) => {
  if (!currentZone.value) return;
  showAgentPicker.value = false;
  await addMemberToZone(currentZone.value.id, agentId);
};

const handleAgentPickerCancel = () => {
  showAgentPicker.value = false;
};

const fetchAvailableAgents = async () => {
  try {
    const response = await fetch('/api/agents');
    const result = await response.json();
    return result.agents || [];
  } catch (error) {
    console.error('[ZonePanel] Failed to fetch agents:', error);
    showNotification('error', '获取 Agent 列表失败');
    return [];
  }
};

const addMemberToZone = async (zoneId: string, agentId: string) => {
  if (!currentZone.value) return;

  loading.value = true;
  try {
    const response = await fetch(
      `/api/zones/${zoneId}/members/${agentId}`,
      { method: 'POST' }
    );

    const result = await response.json();
    if (result.success && currentZone.value) {
      if (!currentZone.value.members.includes(agentId)) {
        currentZone.value.members = [...currentZone.value.members, agentId];
      }
      showNotification('success', 'Agent 已添加');
    } else {
      showNotification('error', '添加 Agent 失败');
    }
  } catch (error) {
    console.error('[ZonePanel] Failed to add member:', error);
    showNotification('error', '添加 Agent 失败：网络错误');
  } finally {
    loading.value = false;
  }
};

const handleRemoveMember = async (zoneId: string, memberId: string) => {
  if (!currentZone.value) return;

  loading.value = true;
  try {
    const response = await fetch(
      `/api/zones/${zoneId}/members/${memberId}`,
      {
        method: 'DELETE'
      }
    );

    const result = await response.json();
    if (result.success && currentZone.value) {
      currentZone.value.members = currentZone.value.members.filter(m => m !== memberId);
    } else {
      showNotification('error', '移除 Agent 失败');
    }
  } catch (error) {
    console.error('[ZonePanel] Failed to remove member:', error);
    showNotification('error', '移除 Agent 失败，请重试');
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <StratixModal
    :visible="visible"
    :title="currentZone ? `Zone: ${currentZone.title}` : 'Zone 详情'"
    width="520px"
    position="right"
    :maskClosable="true"
    :footer="false"
    @update:visible="emit('update:visible', $event)"
    @close="handleClose"
  >
    <!-- Notification toast -->
    <Transition name="notification">
      <div v-if="notification" class="zone-panel-notification" :class="`zone-panel-notification--${notification.type}`">
        {{ notification.message }}
      </div>
    </Transition>

    <div class="zone-panel-content">
      <ZoneDetail
        v-if="currentZone"
        :zone="currentZone"
        @close="handleClose"
        @update-zone="handleUpdateZone"
        @delete-zone="handleDeleteZone"
        @clone-zone="handleCloneZone"
        @add-file="handleAddFile"
        @remove-file="handleRemoveFile"
        @refresh-file="handleRefreshFile"
        @add-member="handleAddMember"
        @remove-member="handleRemoveMember"
        @open-data-explorer="(zoneId) => emit('open-data-explorer', zoneId)"
      />
      
      <!-- Empty state with glassmorphism -->
      <div v-else class="zone-empty">
        <div class="zone-empty-card">
          <span class="zone-empty-icon">🎯</span>
          <h4>未选择 Zone</h4>
          <p>请从地图上选择一个 Zone 查看详情</p>
        </div>
      </div>
    </div>
  </StratixModal>

  <!-- Agent Picker Modal -->
  <StratixModal
    :visible="showAgentPicker"
    title="添加 Agent"
    width="400px"
    :maskClosable="true"
    :footer="false"
    @update:visible="showAgentPicker = $event"
    @close="handleAgentPickerCancel"
  >
    <div class="agent-picker">
      <p class="agent-picker__desc">选择要添加的 Agent：</p>
      <div class="agent-picker__list">
        <button
          v-for="agent in availableAgentsForPicker"
          :key="agent.agentId"
          class="agent-picker__item"
          @click="handleAgentPickerSelect(agent.agentId)"
        >
          <div class="agent-picker__avatar">
            <span>{{ agent.name?.charAt(0) || 'A' }}</span>
            <div class="picker-status online"></div>
          </div>
          <div class="agent-picker__info">
            <span class="agent-picker__name">{{ agent.name || 'Unnamed Agent' }}</span>
            <span class="agent-picker__id">{{ agent.agentId.slice(0, 8) }}...</span>
          </div>
        </button>
      </div>
      <button class="agent-picker__cancel" @click="handleAgentPickerCancel">取消</button>
    </div>
  </StratixModal>

  <ZoneFilePicker
    ref="filePickerRef"
    :visible="showFilePicker"
    :zoneId="currentZone?.id"
    @close="handleFilePickerClose"
    @add-files="handleAddFiles"
    @scan-folder="handleScanFolder"
  />
</template>

<style scoped>
.zone-panel-content {
  position: relative;
}

.zone-panel-notification {
  position: absolute;
  top: var(--ds-spacing-lg);
  left: 50%;
  transform: translateX(-50%);
  padding: calc(var(--ds-spacing-sm) + var(--ds-spacing-xs)) var(--ds-spacing-lg);
  border-radius: var(--ds-radius-md);
  font-size: var(--ds-font-size-md);
  font-weight: 500;
  z-index: var(--ds-depth-ui-notification, 9999);
  box-shadow: var(--ds-shadow-lg);
}

.notification-enter-active,
.notification-leave-active {
  transition: all 0.3s var(--ds-animation-easing-ease-out);
}

.notification-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px);
}

.notification-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}

.zone-panel-notification--success {
  background: var(--ds-status-success);
  color: var(--ds-text-inverse);
}

.zone-panel-notification--error {
  background: var(--ds-status-danger);
  color: var(--ds-text-inverse);
}

.zone-panel-notification--info {
  background: var(--ds-brand-primary);
  color: var(--ds-text-inverse);
}

.zone-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  padding: var(--ds-spacing-xl);
}

.zone-empty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ds-spacing-md);
  padding: var(--ds-spacing-xl);
  background: var(--ds-glass-bg, var(--ds-bg-secondary));
  border: var(--ds-glass-border, 1px solid var(--ds-border));
  border-radius: var(--ds-radius-lg);
  backdrop-filter: blur(var(--ds-glass-blur));
  -webkit-backdrop-filter: blur(var(--ds-glass-blur));
  box-shadow: var(--ds-glass-shadow, var(--ds-shadow-md));
  text-align: center;
  max-width: 280px;
  animation: ds-scale-in 0.3s var(--ds-animation-easing-ease-out);
}

.zone-empty-icon {
  font-size: var(--ds-font-size-4xl);
  filter: drop-shadow(0 var(--ds-spacing-sm) var(--ds-spacing-lg) rgba(0, 0, 0, 0.1));
}

.zone-empty-card h4 {
  margin: 0;
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-lg);
}

.zone-empty-card p {
  margin: 0;
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-sm);
}

.agent-picker {
  padding: var(--ds-spacing-sm) 0;
}

.agent-picker__desc {
  margin: 0 0 var(--ds-spacing-md) 0;
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-md);
}

.agent-picker__list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm);
  max-height: 300px;
  overflow-y: auto;
}

.agent-picker__item {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-md);
  padding: var(--ds-spacing-md);
  background: var(--ds-bg-elevated);
  border: 1px solid var(--ds-border-default);
  border-radius: var(--ds-radius-md);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
  text-align: left;
  width: 100%;
}

.agent-picker__item:hover {
  background: var(--ds-bg-overlay);
  border-color: var(--ds-color-primary);
  transform: translateX(4px);
  box-shadow: var(--ds-shadow-sm);
}

.agent-picker__avatar {
  position: relative;
  width: calc(var(--ds-spacing-xl) + var(--ds-spacing-xs));
  height: calc(var(--ds-spacing-xl) + var(--ds-spacing-xs));
  border-radius: var(--ds-radius-md);
  background: var(--ds-brand-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-inverse);
  font-weight: 600;
  font-size: var(--ds-font-size-sm);
  flex-shrink: 0;
}

.picker-status {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: var(--ds-radius-full);
  border: 2px solid var(--ds-bg-secondary);
}

.picker-status.online {
  background: var(--ds-status-success);
  box-shadow: 0 0 var(--ds-spacing-xs) var(--ds-status-success);
}

.agent-picker__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: calc(var(--ds-spacing-xs) / 2);
}

.agent-picker__name {
  font-weight: 500;
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-sm);
}

.agent-picker__id {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  font-family: var(--ds-font-mono);
}

.agent-picker__cancel {
  width: 100%;
  margin-top: var(--ds-spacing-sm);
  padding: calc(var(--ds-spacing-sm) + var(--ds-spacing-xs));
  background: transparent;
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  color: var(--ds-text-muted);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
}

.agent-picker__cancel:hover {
  background: var(--ds-bg-elevated);
  border-color: var(--ds-text-muted);
}

/* Prefers reduced motion */
@media (prefers-reduced-motion: reduce) {
  .zone-panel-notification,
  .zone-empty-card,
  .agent-picker__item {
    transition: none !important;
    animation: none !important;
    transform: none !important;
  }
}
</style>
