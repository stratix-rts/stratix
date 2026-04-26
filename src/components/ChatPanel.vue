<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { StratixButton, StratixTextarea, StratixLoading, StratixEmpty } from '@/components/ui';
import type { ProjectChannel, ProjectChannelMessage, AgentBadge, Project } from '../stratix-project/types';
import { useAgentStore } from '@/stores/agent';

const agentStore = useAgentStore();
import { CHAT_COMMANDS, filterCommands, type ChatCommand } from './chat-commands';

const props = defineProps<{
  projectId: string | null;
  projectPath: string | null;
}>();

const channels = ref<ProjectChannel[]>([]);
const messages = ref<ProjectChannelMessage[]>([]);
const selectedChannelId = ref<string | null>(null);
const loading = ref(false);
const projectInfo = ref<Project | null>(null);
const ws = ref<WebSocket | null>(null);
const lastSyncTime = ref<number>(0);
const inputText = ref('');

const showCommandList = ref(false);
const showMentionList = ref(false);
const commandList = ref<ChatCommand[]>([]);
const mentionList = ref<AgentBadge[]>([]);
const selectedListIndex = ref(0);
const inputQuery = ref('');

const selectedChannel = computed(() => {
  return channels.value.find(c => c.id === selectedChannelId.value);
});

const projectAgents = computed((): AgentBadge[] => {
  if (!props.projectId) return [];
  
  const presentIds = projectInfo.value?.presentAgentIds || [];
  
  const agents = agentStore.agents;
  const agentsArray = Array.isArray(agents) ? agents : (agents.value || []);
  
  if (presentIds.length === 0) return [];
  if (agentsArray.length === 0) return [];
  
  return agentsArray
    .filter(agent => presentIds.includes(agent.agentId))
    .map(agent => ({
      agentId: agent.agentId,
      name: agent.name,
      avatar: agent.profile?.thumbnail,
      role: agent.soul?.identity || agent.profile?.name || agent.name,
      status: 'online' as const,
      roleDefinition: agent.soul ? {
        personality: agent.soul.personality,
        responsibilities: agent.rules,
        communicationStyle: undefined
      } : undefined
    }));
});

const messageInput = ref<any>(null);

// XSS protection: escape HTML special characters
const escapeHtml = (str: string): string => {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

// Render message content with mention highlighting (safely)
const renderMessageContent = (content: string): string => {
  const escaped = escapeHtml(content);
  return escaped.split(/(@\w+)/g).map(part =>
    part.startsWith('@') ? `<span class="mention">${part}</span>` : part
  ).join('');
};

const hideAllLists = () => {
  showCommandList.value = false;
  showMentionList.value = false;
  selectedListIndex.value = 0;
};

const handleInputInput = () => {
  const value = inputText.value;
  const textareaEl = messageInput.value?.$el as HTMLTextAreaElement;
  const cursorPos = textareaEl?.selectionStart || value.length;
  
  const textBeforeCursor = value.slice(0, cursorPos);
  const lastAtPos = textBeforeCursor.lastIndexOf('@');
  const lastSlashPos = textBeforeCursor.lastIndexOf('/');
  
  if (lastAtPos > lastSlashPos && lastAtPos !== -1) {
    const query = textBeforeCursor.slice(lastAtPos + 1);
    inputQuery.value = query;
    const filtered = projectAgents.value.filter(a => 
      a.name.toLowerCase().includes(query.toLowerCase()) ||
      a.agentId.toLowerCase().includes(query.toLowerCase())
    );
    mentionList.value = filtered;
    showMentionList.value = filtered.length > 0;
    showCommandList.value = false;
    selectedListIndex.value = 0;
  } else if (lastSlashPos !== -1 && (lastSlashPos === 0 || textBeforeCursor[lastSlashPos - 1] === ' ')) {
    const query = textBeforeCursor.slice(lastSlashPos + 1);
    inputQuery.value = query;
    commandList.value = filterCommands(query);
    showCommandList.value = commandList.value.length > 0;
    showMentionList.value = false;
    selectedListIndex.value = 0;
  } else {
    hideAllLists();
  }
};

const handleInputKeyDown = (e: KeyboardEvent) => {
  const isListVisible = showCommandList.value || showMentionList.value;
  const currentList = showCommandList.value ? commandList.value : mentionList.value;
  
  if (isListVisible && currentList.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedListIndex.value = (selectedListIndex.value + 1) % currentList.length;
      return;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedListIndex.value = (selectedListIndex.value - 1 + currentList.length) % currentList.length;
      return;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showCommandList.value) {
        selectCommand(commandList.value[selectedListIndex.value]);
      } else if (showMentionList.value) {
        selectMention(mentionList.value[selectedListIndex.value]);
      }
      return;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideAllLists();
      return;
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const nextIndex = (selectedListIndex.value + 1) % currentList.length;
      selectedListIndex.value = nextIndex;
      return;
    }
  }
  
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendMessage();
  }
};

const selectCommand = (cmd: ChatCommand) => {
  const value = inputText.value;
  const textareaEl = messageInput.value?.$el as HTMLTextAreaElement;
  const cursorPos = textareaEl?.selectionStart || value.length;
  const textBeforeCursor = value.slice(0, cursorPos);
  const slashPos = textBeforeCursor.lastIndexOf('/');
  
  let newText: string;
  if (slashPos === 0) {
    newText = '/' + cmd.label + ' ';
  } else {
    newText = value.slice(0, slashPos) + '/' + cmd.label + ' ';
  }
  
  inputText.value = newText;
  hideAllLists();
  nextTick(() => {
    textareaEl?.focus();
    textareaEl?.setSelectionRange(newText.length, newText.length);
  });
  
  if (cmd.id === 'clear') {
    messages.value = [];
  }
};

const selectMention = (agent: AgentBadge) => {
  const value = inputText.value;
  const textareaEl = messageInput.value?.$el as HTMLTextAreaElement;
  const cursorPos = textareaEl?.selectionStart || value.length;
  const textBeforeCursor = value.slice(0, cursorPos);
  const atPos = textBeforeCursor.lastIndexOf('@');
  
  const newText = value.slice(0, atPos) + '@' + agent.name + ' ';
  inputText.value = newText;
  hideAllLists();
  nextTick(() => {
    textareaEl?.focus();
    textareaEl?.setSelectionRange(newText.length, newText.length);
  });
};

const handleSendMessage = () => {
  const content = inputText.value;
  if (!content.trim()) return;
  
  sendMessage(content, { id: 'user', type: 'user', name: '用户' });
  inputText.value = '';
};

const loadProjectInfo = async () => {
  if (!props.projectId) return;
  
  try {
    const response = await fetch(`/api/projects/${props.projectId}`);
    const result = await response.json();
    
    if (result.success) {
      projectInfo.value = result.project;
    }
  } catch (err) {
    console.error('[ChatPanel] Failed to load project info:', err);
  }
};

const loadChannels = async () => {
  if (!props.projectId) return;

  try {
    const response = await fetch(`/api/projects/${props.projectId}/channels`);
    const result = await response.json();
    
    if (result.success) {
      channels.value = result.channels;
      
      if (channels.value.length > 0 && !selectedChannelId.value) {
        selectedChannelId.value = channels.value[0].id;
      }
    }
  } catch (err) {
    console.error('[ChatPanel] Failed to load channels:', err);
  }
};

const loadMessages = async () => {
  if (!props.projectId || !selectedChannelId.value) return;

  loading.value = true;

  try {
    const response = await fetch(
      `/api/projects/${props.projectId}/messages?channelId=${selectedChannelId.value}&since=${lastSyncTime.value}`
    );
    const result = await response.json();
    
    if (result.success) {
      messages.value = result.messages;
      if (messages.value.length > 0) {
        lastSyncTime.value = Math.max(...messages.value.map(m => m.timestamp));
      }
    }
  } catch (err) {
    console.error('[ChatPanel] Failed to load messages:', err);
  } finally {
    loading.value = false;
  }
};

const sendMessage = async (content: string, sender: { id: string; type: 'agent' | 'user'; name: string; role?: string }) => {
  if (!props.projectId || !selectedChannelId.value || !content.trim()) return;

  try {
    const response = await fetch(`/api/projects/${props.projectId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: selectedChannelId.value,
        sender,
        content: content.trim(),
        source: sender.type === 'user' ? 'user' : 'local'
      })
    });

    const result = await response.json();
    
    if (!result.success) {
      console.error('[ChatPanel] Failed to send message:', result.error);
    }
    // 不在这里添加消息到列表，等待 WebSocket 广播
    // 这样可以确保所有客户端（包括发送者）通过同一渠道接收消息
  } catch (err) {
    console.error('[ChatPanel] Failed to send message:', err);
  }
};

const createDefaultChannel = async () => {
  if (!props.projectId) return;

  try {
    await fetch(`/api/projects/${props.projectId}/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'general',
        type: 'general',
        description: 'General discussion channel'
      })
    });

    await loadChannels();
  } catch (err) {
    console.error('[ChatPanel] Failed to create default channel:', err);
  }
};

const connectWebSocket = () => {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = window.location.host;
  const wsUrl = `${wsProtocol}//${wsHost}/ws`;
  ws.value = new WebSocket(wsUrl);

  ws.value.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.eventType === 'stratix:project_message_new') {
        const msg = data.payload.message;
        
        if (msg.projectId === props.projectId && msg.channelId === selectedChannelId.value) {
          const exists = messages.value.some(m => m.id === msg.id);
          if (!exists) {
            messages.value.push(msg);
          }
        }
      }
    } catch (err) {
      console.error('[ChatPanel] WebSocket message parse error:', err);
    }
  };

  ws.value.onerror = (err) => {
    console.error('[ChatPanel] WebSocket error:', err);
  };
};

watch(() => props.projectId, async (newId) => {
  if (newId) {
    await loadProjectInfo();
    await loadChannels();
    
    if (channels.value.length === 0) {
      await createDefaultChannel();
    }
    
    await loadMessages();
    
    if (ws.value) {
      ws.value.close();
    }
    connectWebSocket();
  }
});

watch(selectedChannelId, () => {
  loadMessages();
});

onMounted(async () => {
  if (props.projectId) {
    await loadProjectInfo();
    await loadChannels();
    
    if (channels.value.length === 0) {
      await createDefaultChannel();
    }
    
    await loadMessages();
    connectWebSocket();
  }
});

onUnmounted(() => {
  if (ws.value) {
    ws.value.close();
  }
});

defineExpose({
  sendMessage,
  loadMessages
});
</script>

<template>
  <div class="chat-panel">
    <div class="chat-sidebar">
      <div class="sidebar-section">
        <div class="section-title">Agent 列表</div>
        <div class="agent-list">
          <div
            v-for="agent in projectAgents"
            :key="agent.agentId"
            class="agent-item"
          >
            <div class="agent-avatar">
              <img v-if="agent.avatar" :src="agent.avatar" :alt="agent.name" />
              <div v-else class="avatar-placeholder">{{ agent.name.charAt(0) }}</div>
            </div>
            <div class="agent-info">
              <div class="agent-name">{{ agent.name }}</div>
              <div class="agent-role">{{ agent.role }}</div>
            </div>
            <div class="agent-status" :class="agent.status"></div>
          </div>
        </div>
      </div>

      <div class="sidebar-section">
        <div class="section-title">Channel</div>
        <div class="channel-list">
          <div
            v-for="channel in channels"
            :key="channel.id"
            class="channel-item"
            :class="{ active: selectedChannelId === channel.id }"
            @click="selectedChannelId = channel.id"
          >
            <span class="channel-icon">#</span>
            <span class="channel-name">{{ channel.name }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="chat-main">
      <div class="chat-header" v-if="selectedChannel">
        <div class="channel-info">
          <span class="channel-icon">#</span>
          <span class="channel-name">{{ selectedChannel.name }}</span>
        </div>
        <div class="channel-description" v-if="selectedChannel.description">
          {{ selectedChannel.description }}
        </div>
      </div>

      <div class="message-list" v-if="selectedChannel">
        <StratixLoading v-if="loading" mode="skeleton" :skeleton-lines="4" />

        <StratixEmpty
          v-else-if="messages.length === 0"
          scenario="no-messages"
          title="暂无消息"
          description="发送消息开始对话"
        />

        <div v-else class="messages">
          <div
            v-for="message in messages"
            :key="message.id"
            class="message-item"
            :class="{ 'own-message': message.sender.type === 'user' }"
          >
            <div class="message-sender">
              <div class="sender-avatar">
                <img v-if="message.sender.avatar" :src="message.sender.avatar" :alt="message.sender.name" />
                <div v-else class="avatar-placeholder">{{ message.sender.name.charAt(0) }}</div>
              </div>
              <div class="sender-info">
                <span class="sender-name">{{ message.sender.name }}</span>
                <span class="sender-role" v-if="message.sender.role">{{ message.sender.role }}</span>
              </div>
              <div class="message-time">
                {{ new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}
              </div>
            </div>
            <div class="message-content" v-html="renderMessageContent(message.content)"></div>
          </div>
        </div>
      </div>

      <div class="message-input" v-if="selectedChannel">
        <div class="input-wrapper">
          <StratixTextarea
            ref="messageInput"
            v-model="inputText"
            placeholder="输入消息... (使用 @ 提及 Agent, / 唤起命令)"
            :rows="1"
            resize="none"
            @input="handleInputInput"
            @keydown="handleInputKeyDown"
          />
          
          <div v-if="showCommandList" class="popup-list command-list">
            <div 
              v-for="(cmd, idx) in commandList" 
              :key="cmd.id"
              class="popup-item"
              :class="{ selected: idx === selectedListIndex }"
              @click="selectCommand(cmd)"
            >
              <span class="item-label">/{{ cmd.label }}</span>
              <span class="item-desc">{{ cmd.description }}</span>
            </div>
          </div>
          
          <div v-if="showMentionList" class="popup-list mention-list">
            <div 
              v-for="(agent, idx) in mentionList" 
              :key="agent.agentId"
              class="popup-item"
              :class="{ selected: idx === selectedListIndex }"
              @click="selectMention(agent)"
            >
              <div class="agent-avatar-small">
                <img v-if="agent.avatar" :src="agent.avatar" :alt="agent.name" />
                <div v-else class="avatar-placeholder-small">{{ agent.name.charAt(0) }}</div>
              </div>
              <span class="item-label">@{{ agent.name }}</span>
              <span class="item-desc">{{ agent.role }}</span>
            </div>
          </div>
        </div>
        <StratixButton @click="handleSendMessage">
          发送
        </StratixButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  display: flex;
  height: 100%;
  min-height: 400px;
}

.chat-sidebar {
  width: 240px;
  background: var(--ds-bg-secondary);
  border-right: 1px solid var(--ds-border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex-shrink: 0;
  transition: width 0.2s ease;
}

/* Responsive: narrow screens - collapse sidebar */
@media (max-width: 1024px) {
  .chat-panel {
    flex-direction: column;
  }

  .chat-sidebar {
    width: 100%;
    max-height: 200px;
    border-right: none;
    border-bottom: 1px solid var(--ds-border);
  }

  .sidebar-section {
    flex: 1;
    min-width: 0;
  }

  .agent-list,
  .channel-list {
    flex-direction: row;
    overflow-x: auto;
    gap: 8px;
  }

  .agent-item,
  .channel-item {
    flex-shrink: 0;
    min-width: 100px;
  }
}

.sidebar-section {
  padding: 16px;
  border-bottom: 1px solid var(--ds-border);
}

.section-title {
  font-size: 11px;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 12px;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.agent-item:hover {
  background: var(--ds-bg-tertiary);
}

.agent-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
}

.agent-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  background: var(--ds-brand-primary);
  color: var(--ds-text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: bold;
}

.agent-info {
  flex: 1;
  min-width: 0;
}

.agent-name {
  font-size: 13px;
  color: var(--ds-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-role {
  font-size: 11px;
  color: var(--ds-text-muted);
}

.agent-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.agent-status.online {
  background: var(--ds-status-success);
}

.agent-status.offline {
  background: var(--ds-text-muted);
}

.agent-status.busy {
  background: var(--ds-status-warning);
}

.channel-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.channel-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--ds-text-muted);
  transition: all 0.2s;
}

.channel-item:hover {
  background: var(--ds-bg-tertiary);
  color: var(--ds-text-secondary);
}

.channel-item.active {
  background: var(--ds-bg-tertiary);
  color: var(--ds-brand-primary);
}

.channel-icon {
  font-size: 14px;
}

.channel-name {
  font-size: 13px;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--ds-border);
  background: var(--ds-bg-secondary);
}

.channel-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.channel-info .channel-icon {
  font-size: 18px;
  color: var(--ds-text-muted);
}

.channel-info .channel-name {
  font-size: 16px;
  font-weight: bold;
  color: var(--ds-text-primary);
}

.channel-description {
  font-size: 12px;
  color: var(--ds-text-muted);
  margin-top: 4px;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.loading,
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--ds-text-muted);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--ds-border);
  border-top-color: var(--ds-brand-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 12px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-hint {
  font-size: 12px;
  margin-top: 8px;
}

.messages {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message-item {
  padding: 12px;
  background: var(--ds-bg-secondary);
  border-radius: 8px;
}

.message-item.own-message {
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
}

.message-sender {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.sender-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  overflow: hidden;
}

.sender-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.sender-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sender-name {
  font-size: 13px;
  font-weight: bold;
  color: var(--ds-text-primary);
}

.sender-role {
  font-size: 11px;
  color: var(--ds-text-muted);
}

.message-time {
  font-size: 11px;
  color: var(--ds-text-muted);
}

.message-content {
  font-size: 14px;
  color: var(--ds-text-secondary);
  line-height: 1.5;
}

.message-content .mention {
  color: var(--ds-brand-primary);
  font-weight: bold;
}

.message-input {
  padding: 16px;
  border-top: 1px solid var(--ds-border);
  background: var(--ds-bg-secondary);
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.message-input .input-wrapper {
  flex: 1;
  position: relative;
}

.message-input .stratix-textarea {
  background: var(--ds-bg-primary);
  border-color: var(--ds-border);
  color: var(--ds-text-primary);
}

.message-input .stratix-textarea:focus {
  border-color: var(--ds-brand-primary);
}

.message-input .stratix-textarea::placeholder {
  color: var(--ds-text-muted);
}

.input-wrapper {
  flex: 1;
  position: relative;
}

.popup-list {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: 8px;
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 8px;
  box-shadow: var(--ds-shadow-md);
}

.popup-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.popup-item:first-child {
  border-radius: 8px 8px 0 0;
}

.popup-item:last-child {
  border-radius: 0 0 8px 8px;
}

.popup-item:hover,
.popup-item.selected {
  background: var(--ds-bg-tertiary);
}

.popup-item .item-label {
  font-weight: 500;
  color: var(--ds-text-primary);
  min-width: 80px;
}

.popup-item .item-desc {
  color: var(--ds-text-muted);
  font-size: 12px;
}

.agent-avatar-small {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
}

.agent-avatar-small img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder-small {
  width: 100%;
  height: 100%;
  background: var(--ds-brand-primary);
  color: var(--ds-text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: bold;
  border-radius: 50%;
}

/* Code block styling for message content */
:deep(.code-block-wrapper) {
  position: relative;
  margin: 8px 0;
  border-radius: 8px;
  overflow: hidden;
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border-default);
}

:deep(.code-block-wrapper) .code-lang {
  position: absolute;
  top: 8px;
  left: 12px;
  font-size: 11px;
  color: var(--ds-text-muted);
  background: var(--ds-bg-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
  z-index: 1;
}

:deep(.code-block-wrapper) .copy-button {
  position: absolute;
  top: 8px;
  right: 8px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
  z-index: 1;
}

:deep(.code-block-wrapper):hover .copy-button {
  opacity: 1;
}

:deep(.code-block-wrapper) .copy-button:hover {
  background: var(--ds-bg-secondary);
}

:deep(.code-block-wrapper) pre {
  margin: 0;
  padding: 12px;
  padding-top: 36px;
  overflow-x: auto;
  background: transparent;
}

:deep(.code-block-wrapper) code {
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.5;
  background: transparent;
}

/* Inline code styling */
:deep(.message-text code:not(.hljs)) {
  background: var(--ds-bg-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
  font-size: 0.9em;
}

.message-agent :deep(pre),
.message-agent :deep(.code-block-wrapper pre) {
  background: rgba(0, 0, 0, 0.2);
}
</style>
