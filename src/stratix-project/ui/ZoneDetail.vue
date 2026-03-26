<template>
  <div class="zone-detail">
    <div class="zone-detail__header">
      <div class="zone-detail__title-row">
        <input
          v-if="isEditingTitle"
          ref="titleInputRef"
          v-model="editingTitle"
          class="zone-detail__title-input"
          @blur="saveTitle"
          @keydown.enter="saveTitle"
          @keydown.escape="cancelEditTitle"
        />
        <h3 v-else class="zone-detail__title" @click="startEditTitle">
          {{ zone.title }}
          <span class="zone-detail__edit-hint">click to edit</span>
        </h3>
      </div>
      <div class="zone-detail__header-actions">
        <StratixButton size="sm" variant="secondary" @click="handleExportZone">
          Export
        </StratixButton>
        <StratixButton size="sm" variant="secondary" @click="handleEditZone">
          Edit
        </StratixButton>
      </div>
    </div>

    <div class="zone-detail__section">
      <div class="zone-detail__section-header">
        <h4 class="zone-detail__section-title">Prompt (KR)</h4>
      </div>
      <textarea
        v-model="editingPrompt"
        class="zone-detail__prompt-textarea"
        placeholder="Zone prompt / role definition..."
        :rows="4"
        @blur="savePrompt"
      />
    </div>

    <!-- Tasks Section -->
    <div class="zone-detail__section">
      <div class="zone-detail__section-header">
        <h4 class="zone-detail__section-title">Tasks</h4>
        <StratixButton size="sm" variant="secondary" @click="showCreateTask = true">
          + New Task
        </StratixButton>
      </div>

      <!-- Create Task Form -->
      <div v-if="showCreateTask" class="zone-detail__task-create">
        <input
          v-model="newTaskTitle"
          class="zone-detail__task-input"
          placeholder="Task title..."
          @keydown.enter="handleCreateTask"
          @keydown.escape="showCreateTask = false"
        />
        <div class="zone-detail__task-create-actions">
          <StratixButton size="sm" variant="primary" @click="handleCreateTask" :disabled="!newTaskTitle.trim()">
            Create
          </StratixButton>
          <StratixButton size="sm" variant="secondary" @click="showCreateTask = false; newTaskTitle = ''">
            Cancel
          </StratixButton>
        </div>
      </div>

      <div v-if="tasks.length === 0 && !showCreateTask" class="zone-detail__empty-list">
        No tasks yet. Create one to get started.
      </div>
      <div v-else class="zone-detail__task-list">
        <div
          v-for="task in tasks"
          :key="task.id"
          class="zone-detail__task-item"
        >
          <div class="zone-detail__task-info">
            <select
              class="zone-detail__task-status"
              :class="`zone-detail__task-status--${task.status}`"
              :value="task.status"
              @change="handleTaskStatusChange(task, $event)"
            >
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
            </select>
            <span class="zone-detail__task-title" :class="{ 'zone-detail__task-title--done': task.status === 'done' }">
              {{ task.title }}
            </span>
          </div>
          <div class="zone-detail__task-meta">
            <span v-if="task.assignee" class="zone-detail__task-assignee">
              👤 {{ task.assignee.slice(0, 8) }}
            </span>
            <button
              v-if="!task.assignee && task.status !== 'done'"
              class="zone-detail__task-action"
              title="Claim task"
              @click="handleClaimTask(task.id)"
            >
              Claim
            </button>
            <button
              class="zone-detail__task-action zone-detail__task-action--danger"
              title="Delete"
              @click="handleDeleteTask(task.id)"
            >
              ×
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="zone-detail__section">
      <div class="zone-detail__section-header">
        <h4 class="zone-detail__section-title">Files</h4>
        <StratixButton size="sm" variant="secondary" @click="handleAddFile">
          + Add File
        </StratixButton>
      </div>
      <div v-if="zone.files?.length === 0" class="zone-detail__empty-list">
        No files added yet
      </div>
      <div v-else class="zone-detail__file-list">
        <div
          v-for="file in zone.files"
          :key="file.id"
          class="zone-detail__file-item"
        >
          <div class="zone-detail__file-info">
            <span class="zone-detail__file-icon">{{ getFileIcon(file.fileType) }}</span>
            <span class="zone-detail__file-name">{{ file.name }}</span>
            <span class="zone-detail__file-source">{{ file.sourceType === 'local' ? '📁' : '🔗' }}</span>
          </div>
          <div class="zone-detail__file-actions">
            <button
              class="zone-detail__file-action"
              title="Refresh"
              @click="handleRefreshFile(file)"
            >
              ↻
            </button>
            <button
              class="zone-detail__file-action zone-detail__file-action--danger"
              title="Remove"
              @click="handleRemoveFile(file)"
            >
              ×
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="zone-detail__section">
      <div class="zone-detail__section-header">
        <h4 class="zone-detail__section-title">Members</h4>
        <StratixButton size="sm" variant="secondary" @click="handleAddMember">
          + Add Agent
        </StratixButton>
      </div>
      <div v-if="zone.members?.length === 0" class="zone-detail__empty-list">
        No agents in this zone
      </div>
      <div v-else class="zone-detail__member-list">
        <div
          v-for="memberId in zone.members"
          :key="memberId"
          class="zone-detail__member-item"
        >
          <span class="zone-detail__member-avatar">🤖</span>
          <span class="zone-detail__member-name">{{ memberId }}</span>
          <button
            class="zone-detail__file-action zone-detail__file-action--danger"
            title="Remove"
            @click="handleRemoveMember(memberId)"
          >
            ×
          </button>
        </div>
      </div>
    </div>

    <!-- Messages Section -->
    <div class="zone-detail__section">
      <div class="zone-detail__section-header">
        <h4 class="zone-detail__section-title">Messages</h4>
        <span v-if="messages.length > 0" class="zone-detail__message-count">{{ messages.length }}</span>
      </div>

      <!-- Messages Timeline -->
      <div class="zone-detail__messages">
        <div v-if="messages.length === 0" class="zone-detail__empty-list">
          No messages yet
        </div>
        <template v-else>
          <div
            v-for="(group, date) in groupedMessages"
            :key="date"
            class="zone-detail__message-group"
          >
            <div class="zone-detail__message-date">{{ formatDateHeader(date as string) }}</div>
            <div
              v-for="message in group"
              :key="message.id"
              class="zone-detail__message"
              :class="`zone-detail__message--${message.senderType}`"
            >
              <div class="zone-detail__message-header">
                <span class="zone-detail__message-sender">{{ message.senderType === 'agent' ? '🤖' : '👤' }} {{ message.senderId.slice(0, 8) }}</span>
                <span class="zone-detail__message-time">{{ formatRelativeTime(message.createdAt) }}</span>
              </div>
              <div class="zone-detail__message-content">{{ message.content }}</div>
            </div>
          </div>
        </template>
      </div>

      <!-- Send Message Form -->
      <div class="zone-detail__message-form">
        <input
          v-model="newMessage"
          class="zone-detail__message-input"
          placeholder="Type a message..."
          @keydown.enter="handleSendMessage"
        />
        <StratixButton size="sm" variant="primary" @click="handleSendMessage" :disabled="!newMessage.trim()">
          Send
        </StratixButton>
      </div>
    </div>

    <div class="zone-detail__footer">
      <StratixButton variant="secondary" @click="handleOpenDataExplorer">
        📊 打开数据浏览器
      </StratixButton>
      <StratixButton variant="secondary" @click="handleClose">
        Close
      </StratixButton>
      <StratixButton variant="danger" @click="handleDeleteZone">
        Delete Zone
      </StratixButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, computed } from 'vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import type { Zone, ZoneFile, FileType, ZoneTask, ZoneTaskStatus, ZoneMessage } from '../types';

interface Props {
  zone: Zone;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'close': [];
  'update-zone': [zone: Partial<Zone> & { id: string }];
  'delete-zone': [zoneId: string];
  'add-file': [zoneId: string];
  'remove-file': [zoneId: string, fileId: string];
  'refresh-file': [zoneId: string, fileId: string];
  'add-member': [zoneId: string];
  'remove-member': [zoneId: string, memberId: string];
  'edit-zone': [zone: Zone];
  'open-data-explorer': [zoneId: string];
}>();

const isEditingTitle = ref(false);
const editingTitle = ref('');
const editingPrompt = ref('');
const titleInputRef = ref<HTMLInputElement | null>(null);

// Task state
const tasks = ref<ZoneTask[]>([]);
const showCreateTask = ref(false);
const newTaskTitle = ref('');
const currentAgentId = ref('agent_default'); // TODO: Get from actual agent context

// Messages state
const messages = ref<ZoneMessage[]>([]);
const newMessage = ref('');

watch(
  () => props.zone,
  (newZone) => {
    editingTitle.value = newZone.title;
    editingPrompt.value = newZone.prompt || '';
    if (newZone.id) {
      fetchTasks(newZone.id);
      fetchMessages(newZone.id);
    }
  },
  { immediate: true }
);

onMounted(() => {
  if (props.zone.id) {
    fetchTasks(props.zone.id);
  }
});

const fetchTasks = async (zoneId: string) => {
  try {
    const response = await fetch(`/api/zones/${zoneId}/tasks`);
    const result = await response.json();
    if (result.success) {
      tasks.value = result.tasks || [];
    }
  } catch (error) {
    console.error('[ZoneDetail] Failed to fetch tasks:', error);
  }
};

const fetchMessages = async (zoneId: string) => {
  try {
    const response = await fetch(`/api/zones/${zoneId}/messages?limit=50`);
    const result = await response.json();
    if (result.success) {
      messages.value = result.messages || [];
    }
  } catch (error) {
    console.error('[ZoneDetail] Failed to fetch messages:', error);
  }
};

const handleSendMessage = async () => {
  if (!newMessage.value.trim() || !props.zone.id) return;

  try {
    const response = await fetch(`/api/zones/${props.zone.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderId: 'user_default', // TODO: Get from actual user context
        senderType: 'user',
        content: newMessage.value.trim()
      })
    });

    const result = await response.json();
    if (result.success && result.message) {
      messages.value = [...messages.value, result.message];
      newMessage.value = '';
    } else if (result.error) {
      alert(result.error);
    }
  } catch (error) {
    console.error('[ZoneDetail] Failed to send message:', error);
  }
};

const handleCreateTask = async () => {
  if (!newTaskTitle.value.trim() || !props.zone.id) return;

  try {
    const response = await fetch(`/api/zones/${props.zone.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: currentAgentId.value,
        title: newTaskTitle.value.trim()
      })
    });

    const result = await response.json();
    if (result.success && result.task) {
      tasks.value = [result.task, ...tasks.value];
      showCreateTask.value = false;
      newTaskTitle.value = '';
    } else if (result.error) {
      alert(result.error);
    }
  } catch (error) {
    console.error('[ZoneDetail] Failed to create task:', error);
  }
};

const handleTaskStatusChange = async (task: ZoneTask, event: Event) => {
  const select = event.target as HTMLSelectElement;
  const newStatus = select.value as ZoneTaskStatus;

  try {
    const response = await fetch(`/api/zones/${props.zone.id}/tasks/${task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: task.assignee || currentAgentId.value,
        status: newStatus
      })
    });

    const result = await response.json();
    if (result.success && result.task) {
      const index = tasks.value.findIndex(t => t.id === task.id);
      if (index !== -1) {
        tasks.value[index] = result.task;
      }
    } else if (result.error) {
      alert(result.error);
      fetchTasks(props.zone.id); // Refresh to get actual state
    }
  } catch (error) {
    console.error('[ZoneDetail] Failed to update task:', error);
  }
};

const handleClaimTask = async (taskId: string) => {
  if (!props.zone.id) return;

  try {
    const response = await fetch(`/api/zones/${props.zone.id}/tasks/${taskId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: currentAgentId.value
      })
    });

    const result = await response.json();
    if (result.success && result.task) {
      const index = tasks.value.findIndex(t => t.id === taskId);
      if (index !== -1) {
        tasks.value[index] = result.task;
      }
    } else if (result.error) {
      alert(result.error);
    }
  } catch (error) {
    console.error('[ZoneDetail] Failed to claim task:', error);
  }
};

const handleDeleteTask = async (taskId: string) => {
  if (!props.zone.id) return;

  try {
    const response = await fetch(`/api/zones/${props.zone.id}/tasks/${taskId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: currentAgentId.value
      })
    });

    const result = await response.json();
    if (result.success) {
      tasks.value = tasks.value.filter(t => t.id !== taskId);
    } else if (result.error) {
      alert(result.error);
    }
  } catch (error) {
    console.error('[ZoneDetail] Failed to delete task:', error);
  }
};

const startEditTitle = () => {
  isEditingTitle.value = true;
  editingTitle.value = props.zone.title;
  nextTick(() => {
    titleInputRef.value?.focus();
    titleInputRef.value?.select();
  });
};

const saveTitle = () => {
  if (editingTitle.value.trim() && editingTitle.value !== props.zone.title) {
    emit('update-zone', { id: props.zone.id, title: editingTitle.value.trim() });
  }
  isEditingTitle.value = false;
};

const cancelEditTitle = () => {
  editingTitle.value = props.zone.title;
  isEditingTitle.value = false;
};

const savePrompt = () => {
  if (editingPrompt.value !== props.zone.prompt) {
    emit('update-zone', { id: props.zone.id, prompt: editingPrompt.value });
  }
};

const handleClose = () => {
  emit('close');
};

const handleEditZone = () => {
  emit('edit-zone', props.zone);
};

const handleExportZone = async () => {
  try {
    const response = await fetch(`/api/zones/${props.zone.id}/export`);
    if (!response.ok) {
      throw new Error('Failed to export zone');
    }
    const data = await response.json();
    if (data.success && data.template) {
      // Download as JSON file
      const blob = new Blob([JSON.stringify(data.template, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zone-template-${props.zone.title || props.zone.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log('[ZoneDetail] Zone exported successfully');
    }
  } catch (error) {
    console.error('[ZoneDetail] Failed to export zone:', error);
  }
};

const handleDeleteZone = () => {
  emit('delete-zone', props.zone.id);
};

const handleAddFile = () => {
  emit('add-file', props.zone.id);
};

const handleRemoveFile = (file: ZoneFile) => {
  emit('remove-file', props.zone.id, file.id);
};

const handleRefreshFile = (file: ZoneFile) => {
  emit('refresh-file', props.zone.id, file.id);
};

const handleAddMember = () => {
  emit('add-member', props.zone.id);
};

const handleRemoveMember = (memberId: string) => {
  emit('remove-member', props.zone.id, memberId);
};

const handleOpenDataExplorer = () => {
  emit('open-data-explorer', props.zone.id);
};

const getFileIcon = (fileType?: FileType): string => {
  const iconMap: Record<FileType, string> = {
    md: '📝',
    txt: '📄',
    ts: '💻',
    js: '💻',
    fig: '🎨',
    image: '🖼️',
    link: '🔗',
    folder: '📁',
    other: '📎',
  };
  return iconMap[fileType || 'other'];
};

// Group messages by date
const groupedMessages = computed(() => {
  const groups: Record<string, ZoneMessage[]> = {};
  for (const msg of messages.value) {
    const date = new Date(msg.createdAt).toDateString();
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(msg);
  }
  return groups;
});

// Format date header
const formatDateHeader = (dateStr: string): string => {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
  }
};

// Format relative time
const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return 'just now';
  } else if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else if (days < 7) {
    return `${days}d ago`;
  } else {
    return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
};
</script>

<style scoped>
.zone-detail {
  display: flex;
  flex-direction: column;
  gap: 20px;
  height: 100%;
}

.zone-detail__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.zone-detail__header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.zone-detail__title-row {
  flex: 1;
  min-width: 0;
}

.zone-detail__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--ds-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}

.zone-detail__edit-hint {
  font-size: 11px;
  font-weight: 400;
  color: var(--ds-text-muted);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.zone-detail__title:hover .zone-detail__edit-hint {
  opacity: 1;
}

.zone-detail__title-input {
  width: 100%;
  padding: 4px 8px;
  font-size: 18px;
  font-weight: 600;
  color: var(--ds-text-primary);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-info);
  border-radius: 4px;
  outline: none;
}

.zone-detail__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.zone-detail__section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.zone-detail__section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ds-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.zone-detail__prompt-textarea {
  width: 100%;
  padding: 12px;
  font-size: 13px;
  color: var(--ds-text-primary);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 6px;
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
  transition: border-color 0.15s ease;
}

.zone-detail__prompt-textarea:focus {
  outline: none;
  border-color: var(--ds-info);
}

.zone-detail__prompt-textarea::placeholder {
  color: var(--ds-text-muted);
}

.zone-detail__empty-list {
  padding: 20px;
  text-align: center;
  font-size: 13px;
  color: var(--ds-text-muted);
  background: var(--ds-bg-tertiary);
  border: 1px dashed var(--ds-border-default);
  border-radius: 6px;
}

.zone-detail__file-list,
.zone-detail__member-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.zone-detail__file-item,
.zone-detail__member-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 6px;
  transition: border-color 0.15s ease;
}

.zone-detail__file-item:hover,
.zone-detail__member-item:hover {
  border-color: var(--ds-border-strong);
}

.zone-detail__file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.zone-detail__file-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.zone-detail__file-name {
  font-size: 13px;
  color: var(--ds-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-detail__file-source {
  font-size: 12px;
  flex-shrink: 0;
}

.zone-detail__file-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.zone-detail__file-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 16px;
  color: var(--ds-text-muted);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.zone-detail__file-action:hover {
  color: var(--ds-text-primary);
  background: var(--ds-bg-secondary);
}

.zone-detail__file-action--danger:hover {
  color: var(--ds-semantic-danger);
  background: rgba(255, 68, 68, 0.1);
}

.zone-detail__member-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.zone-detail__member-avatar {
  font-size: 16px;
  flex-shrink: 0;
}

.zone-detail__member-name {
  flex: 1;
  font-size: 13px;
  color: var(--ds-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-detail__footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--ds-border-default);
}

/* Task styles */
.zone-detail__task-create {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 6px;
}

.zone-detail__task-input {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--ds-text-primary);
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border-default);
  border-radius: 4px;
  outline: none;
  transition: border-color 0.15s ease;
}

.zone-detail__task-input:focus {
  border-color: var(--ds-info);
}

.zone-detail__task-create-actions {
  display: flex;
  gap: 8px;
}

.zone-detail__task-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.zone-detail__task-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 6px;
  transition: border-color 0.15s ease;
}

.zone-detail__task-item:hover {
  border-color: var(--ds-border-strong);
}

.zone-detail__task-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.zone-detail__task-status {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--ds-border-default);
  border-radius: 4px;
  background: var(--ds-bg-primary);
  cursor: pointer;
  flex-shrink: 0;
}

.zone-detail__task-status--pending {
  color: var(--ds-text-muted);
}

.zone-detail__task-status--in_progress {
  color: var(--ds-warning);
  border-color: var(--ds-warning);
}

.zone-detail__task-status--done {
  color: var(--ds-success);
  border-color: var(--ds-success);
}

.zone-detail__task-title {
  font-size: 13px;
  color: var(--ds-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-detail__task-title--done {
  text-decoration: line-through;
  color: var(--ds-text-muted);
}

.zone-detail__task-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.zone-detail__task-assignee {
  font-size: 11px;
  color: var(--ds-text-muted);
}

.zone-detail__task-action {
  padding: 2px 6px;
  font-size: 11px;
  color: var(--ds-text-muted);
  background: transparent;
  border: 1px solid var(--ds-border-default);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.zone-detail__task-action:hover {
  color: var(--ds-text-primary);
  border-color: var(--ds-border-strong);
}

.zone-detail__task-action--danger:hover {
  color: var(--ds-semantic-danger);
  border-color: var(--ds-semantic-danger);
}

/* Messages Section */
.zone-detail__message-count {
  font-size: 11px;
  color: var(--ds-text-muted);
  background: var(--ds-bg-tertiary);
  padding: 2px 6px;
  border-radius: 10px;
}

.zone-detail__messages {
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.zone-detail__message-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.zone-detail__message-date {
  font-size: 11px;
  font-weight: 600;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 0;
  border-bottom: 1px solid var(--ds-border-default);
  margin-bottom: 4px;
}

.zone-detail__message {
  padding: 8px 12px;
  background: var(--ds-bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--ds-border-default);
}

.zone-detail__message--agent {
  background: var(--ds-bg-secondary);
}

.zone-detail__message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.zone-detail__message-sender {
  font-size: 11px;
  font-weight: 600;
  color: var(--ds-text-secondary);
}

.zone-detail__message-time {
  font-size: 10px;
  color: var(--ds-text-muted);
}

.zone-detail__message-content {
  font-size: 13px;
  color: var(--ds-text-primary);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.zone-detail__message-form {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.zone-detail__message-input {
  flex: 1;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--ds-text-primary);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s ease;
}

.zone-detail__message-input:focus {
  border-color: var(--ds-info);
}

.zone-detail__message-input::placeholder {
  color: var(--ds-text-muted);
}
</style>
