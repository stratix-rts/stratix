<script setup lang="ts">
import { SvgIcon, StratixButton } from '@/components/ui';
import { computed, ref } from 'vue';
import { StratixAgentConfig, StratixSkillConfig } from '../stratix-core';
import { StratixPanel } from '@/components/ui';
import { getToken } from '@/design-system/config';
import AgentChatModal from './AgentChatModal.vue';

interface Props {
  selectedAgents: StratixAgentConfig[];
  commandLogs: any[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'execute', skill: StratixSkillConfig, params: Record<string, any>): void;
  (e: 'chat', agentIds: string[]): void;
  (e: 'configure', agent: StratixAgentConfig): void;
  (e: 'tasks', agent: StratixAgentConfig): void;
  (e: 'stop', agent: StratixAgentConfig): void;
  (e: 'deselect', agentId: string): void;
}>();

const panelStyle = computed(() => getToken('panel.default'));
const selectedCount = computed(() => props.selectedAgents.length);
const settingsIcon = 'settings';

// Chat modal state
const showChatModal = ref(false);
const chatAgentIds = ref<string[]>([]);

// Open chat modal with selected agents
const openChat = () => {
  chatAgentIds.value = props.selectedAgents.map(a => a.agentId);
  showChatModal.value = true;
};

// Open chat with specific agent (for avatar click in multi-select)
const openChatWithAgent = (agentId: string) => {
  chatAgentIds.value = [agentId];
  showChatModal.value = true;
};

// Handle avatar click to deselect
const handleAvatarClick = (agentId: string) => {
  emit('deselect', agentId);
};

// Handle configure
const handleConfigure = (agent: StratixAgentConfig) => {
  emit('configure', agent);
};

// Handle tasks
const handleTasks = (agent: StratixAgentConfig) => {
  emit('tasks', agent);
};

// Handle stop
const handleStop = (agent: StratixAgentConfig) => {
  emit('stop', agent);
};

// Get agent initials for avatar
const getAgentInitials = (name: string): string => {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

// Get avatar color based on agent name
const getAvatarColor = (name: string): string => {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
    '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};
</script>

<template>
  <StratixPanel variant="default" class="command-panel">
    <div class="header">
      <h3>指令面板</h3>
      <div class="actions">
        <button class="header-action-btn" title="设置">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <SvgIcon :name="settingsIcon" size="16" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Multi-select avatar list -->
    <div v-if="selectedCount > 1" class="avatar-list">
      <div
        v-for="agent in selectedAgents"
        :key="agent.agentId"
        class="avatar-item"
        :title="`${agent.name} - 点击取消选中`"
        @click="handleAvatarClick(agent.agentId)"
      >
        <div
          class="avatar"
          :style="{ backgroundColor: getAvatarColor(agent.name) }"
        >
          {{ getAgentInitials(agent.name) }}
        </div>
        <span class="avatar-name">{{ agent.name }}</span>
      </div>
    </div>

    <div v-if="selectedCount === 0" class="empty-state">
      <p>请先在地图中选择英雄</p>
    </div>

    <div v-else class="selected-info">
      <p>已选中 {{ selectedCount }} 个英雄</p>

      <!-- Action buttons -->
      <div class="action-buttons">
        <button class="action-btn primary" @click="openChat" title="聊天">
          <span class="btn-icon">💬</span>
          <span class="btn-text">聊天</span>
        </button>
        <button
          v-if="selectedCount === 1"
          class="action-btn"
          @click="handleConfigure(selectedAgents[0])"
          title="配置"
        >
          <span class="btn-icon">⚙️</span>
          <span class="btn-text">配置</span>
        </button>
        <button
          v-if="selectedCount === 1"
          class="action-btn"
          @click="handleTasks(selectedAgents[0])"
          title="任务"
        >
          <span class="btn-icon">📋</span>
          <span class="btn-text">任务</span>
        </button>
        <button
          v-if="selectedCount === 1"
          class="action-btn danger"
          @click="handleStop(selectedAgents[0])"
          title="停止"
        >
          <span class="btn-icon">⏹</span>
          <span class="btn-text">停止</span>
        </button>
      </div>

      <!-- Agent list for single select -->
      <div v-if="selectedCount === 1" class="agent-list">
        <div
          v-for="agent in selectedAgents"
          :key="agent.agentId"
          class="agent-item"
        >
          <span class="agent-name">{{ agent.name }}</span>
          <span class="agent-type">{{ agent.type }}</span>
        </div>
      </div>
    </div>
  </StratixPanel>

  <!-- Chat Modal -->
  <AgentChatModal
    :visible="showChatModal"
    :agent-ids="chatAgentIds"
    :mode="chatAgentIds.length > 1 ? 'group' : 'single'"
    @close="showChatModal = false"
  />
</template>

<style scoped>
.command-panel {
  padding: v-bind('panelStyle.padding');
  background: v-bind('panelStyle.background');
  border: v-bind('panelStyle.border');
  border-radius: v-bind('panelStyle.borderRadius');
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--ds-spacing-md);
}

.header h3 {
  margin: 0;
  font-size: var(--ds-font-size-lg);
  font-weight: 600;
  color: var(--ds-text);
}

.actions {
  display: flex;
  gap: var(--ds-spacing-sm);
}

.header-action-btn {
  width: calc(var(--ds-spacing-lg) + var(--ds-spacing-xs));
  height: calc(var(--ds-spacing-lg) + var(--ds-spacing-xs));
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-sm);
  color: var(--ds-text-secondary);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
}

.header-action-btn:hover {
  background: var(--ds-brand-primary);
  border-color: var(--ds-brand-primary);
  color: var(--ds-bg-primary);
}

.empty-state {
  text-align: center;
  padding: var(--ds-spacing-xl) var(--ds-spacing-lg);
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-md);
}

.selected-info {
  padding: var(--ds-spacing-md);
  background: color-mix(in srgb, var(--ds-status-info) 10%, transparent);
  border-radius: var(--ds-radius-sm);
  color: var(--ds-info);
}

.selected-info p {
  margin: 0 0 var(--ds-spacing-sm) 0;
  font-size: var(--ds-font-size-md);
  font-weight: 500;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm);
}

.agent-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  background: var(--ds-bg-tertiary);
  border-radius: var(--ds-radius-sm);
  font-size: var(--ds-font-size-sm);
}

.agent-name {
  font-weight: 500;
}

.agent-type {
  color: var(--ds-text-secondary);
  font-size: var(--ds-font-size-sm);
}

/* Avatar list for multi-select */
.avatar-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-spacing-sm);
  padding: var(--ds-spacing-md);
  background: var(--ds-bg-tertiary);
  border-radius: var(--ds-radius-md);
  margin-bottom: var(--ds-spacing-md);
}

.avatar-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ds-spacing-xs);
  cursor: pointer;
  padding: var(--ds-spacing-xs);
  border-radius: var(--ds-radius-sm);
  transition: all var(--ds-animation-duration-fast) ease;
}

.avatar-item:hover {
  background: var(--ds-bg-primary);
}

.avatar-item:hover .avatar {
  transform: scale(1.1);
}

.avatar {
  width: calc(var(--ds-spacing-xl) + var(--ds-spacing-md));
  height: calc(var(--ds-spacing-xl) + var(--ds-spacing-md));
  border-radius: var(--ds-radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 600;
  font-size: var(--ds-font-size-md);
  box-shadow: var(--ds-shadow-sm);
  transition: transform var(--ds-animation-duration-fast) ease;
}

.avatar-name {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-secondary);
  max-width: calc(var(--ds-spacing-2xl) + var(--ds-spacing-sm));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Action buttons */
.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-spacing-sm);
  margin-bottom: var(--ds-spacing-md);
}

.action-btn {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-xs);
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-sm);
  color: var(--ds-text-primary);
  cursor: pointer;
  font-size: var(--ds-font-size-sm);
  transition: all var(--ds-animation-duration-fast) ease;
}

.action-btn:hover {
  background: var(--ds-bg-secondary);
  border-color: var(--ds-brand-primary);
}

.action-btn.primary {
  background: var(--ds-brand-primary);
  border-color: var(--ds-brand-primary);
  color: white;
}

.action-btn.primary:hover {
  opacity: 0.9;
}

.action-btn.danger {
  color: var(--ds-status-danger);
}

.action-btn.danger:hover {
  background: var(--ds-status-danger);
  border-color: var(--ds-status-danger);
  color: white;
}

.btn-icon {
  font-size: var(--ds-font-size-md);
}

.btn-text {
  font-weight: 500;
}
</style>
