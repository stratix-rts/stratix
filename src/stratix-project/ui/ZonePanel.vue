<script setup lang="ts">
import { ref, watch } from 'vue';
import StratixModal from '@/components/ui/StratixModal.vue';
import ZoneDetail from './ZoneDetail.vue';
import ZoneFilePicker from './ZoneFilePicker.vue';
import type { Zone, ZoneFile, ZoneUpdateRequest, ZoneFileAddRequest } from '../types';

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
const filePickerRef = ref<InstanceType<typeof ZoneFilePicker> | null>(null);
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
      // Add scanned files to the picker's selected list
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
    const newFiles: ZoneFile[] = [];
    for (const file of files) {
      const response = await fetch(
        `/api/zones/${currentZone.value.id}/files`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(file)
        }
      );

      const result = await response.json();
      if (result.success && result.file) {
        newFiles.push(result.file);
      }
    }

    if (newFiles.length > 0 && currentZone.value) {
      currentZone.value.files = [...currentZone.value.files, ...newFiles];
    }

    showFilePicker.value = false;
  } catch (error) {
    console.error('[ZonePanel] Failed to add files:', error);
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
    }
  } catch (error) {
    console.error('[ZonePanel] Failed to remove file:', error);
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
    }
  } catch (error) {
    console.error('[ZonePanel] Failed to refresh file:', error);
  } finally {
    loading.value = false;
  }
};

const handleAddMember = async (zoneId: string) => {
  if (!currentZone.value) return;

  // Get available agents (not already in this zone)
  const availableAgents = await fetchAvailableAgents();
  const existingMemberIds = currentZone.value.members || [];
  const eligibleAgents = availableAgents.filter(a => !existingMemberIds.includes(a.agentId));

  if (eligibleAgents.length === 0) {
    showNotification('info', '没有可添加的 Agent，所有 Agent 已在当前 Zone 中');
    return;
  }

  // Show agent picker UI
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
    }
  } catch (error) {
    console.error('[ZonePanel] Failed to remove member:', error);
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
    :maskClosable="true"
    :footer="false"
    @update:visible="emit('update:visible', $event)"
    @close="handleClose"
  >
    <!-- Notification toast -->
    <div v-if="notification" class="zone-panel-notification" :class="`zone-panel-notification--${notification.type}`">
      {{ notification.message }}
    </div>

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
          <span class="agent-picker__name">{{ agent.name || 'Unnamed Agent' }}</span>
          <span class="agent-picker__id">{{ agent.agentId.slice(0, 8) }}...</span>
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
.zone-panel-notification {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  z-index: 9999;
  animation: slideDown 0.3s ease;
}

.zone-panel-notification--success {
  background: var(--ds-status-success);
  color: var(--ds-text-primary);
}

.zone-panel-notification--error {
  background: var(--ds-status-danger);
  color: var(--ds-text-primary);
}

.zone-panel-notification--info {
  background: var(--ds-color-primary);
  color: var(--ds-text-primary);
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.agent-picker {
  padding: 8px 0;
}

.agent-picker__desc {
  margin: 0 0 16px 0;
  color: var(--ds-text-muted);
  font-size: 14px;
}

.agent-picker__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.agent-picker__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--ds-bg-elevated);
  border: 1px solid var(--ds-border-default);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.agent-picker__item:hover {
  background: var(--ds-bg-overlay);
  border-color: var(--ds-color-primary);
}

.agent-picker__name {
  font-weight: 500;
  color: var(--ds-text-primary);
}

.agent-picker__id {
  font-size: 12px;
  color: var(--ds-text-muted);
  font-family: monospace;
}

.agent-picker__cancel {
  width: 100%;
  margin-top: 12px;
  padding: 10px;
  background: transparent;
  border: 1px solid var(--ds-border-strong);
  border-radius: 6px;
  color: var(--ds-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.agent-picker__cancel:hover {
  background: var(--ds-bg-elevated);
  border-color: var(--ds-text-muted);
}
</style>
