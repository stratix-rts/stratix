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

// New refs for enhanced UX
const showScrollToBottom = ref(false);
const isDraggingFile = ref(false);
const unreadCounts = ref<Record<string, number>>({});
const messageListRef = ref<HTMLElement | null>(null);

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
            showScrollToBottom.value = true;
            setTimeout(() => { showScrollToBottom.value = false; }, 3000);
          }
        } else if (msg.projectId === props.projectId) {
          // Increment unread for other channels
          unreadCounts.value[msg.channelId] = (unreadCounts.value[msg.channelId] || 0) + 1;
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

const handleScroll = () => {
  if (!messageListRef.value) return;
  const { scrollTop, scrollHeight, clientHeight } = messageListRef.value;
  showScrollToBottom.value = scrollHeight - scrollTop - clientHeight > 100;
};

const scrollToBottom = () => {
  if (messageListRef.value) {
    messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
    showScrollToBottom.value = false;
  }
};

const getChannelCategory = (channel: ProjectChannel): string => {
  const type = channel.type || 'general';
  if (type === 'agent_dm') return 'Agent';
  if (type === 'tasks') return 'System';
  return 'Group';
};

const groupedChannels = computed(() => {
  const groups: Record<string, ProjectChannel[]> = { Agent: [], Group: [], System: [] };
  channels.value.forEach(ch => {
    const cat = getChannelCategory(ch);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(ch);
  });
  return groups;
});

// Date grouping for messages
const groupedMessages = computed(() => {
  const groups: { date: string; messages: ProjectChannelMessage[] }[] = [];
  let currentGroup: { date: string; messages: ProjectChannelMessage[] } | null = null;
  
  messages.value.forEach(msg => {
    const msgDate = new Date(msg.timestamp).toLocaleDateString('zh-CN');
    if (!currentGroup || currentGroup.date !== msgDate) {
      currentGroup = { date: msgDate, messages: [] };
      groups.push(currentGroup);
    }
    currentGroup.messages.push(msg);
  });
  
  return groups;
});

// File drag handlers
const handleDragOver = (e: DragEvent) => {
  e.preventDefault();
  isDraggingFile.value = true;
};

const handleDragLeave = (e: DragEvent) => {
  e.preventDefault();
  isDraggingFile.value = false;
};

const handleDrop = (e: DragEvent) => {
  e.preventDefault();
  isDraggingFile.value = false;
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    console.log('[ChatPanel] Dropped files:', files);
    // TODO: implement file upload
  }
};

const selectChannel = (channelId: string) => {
  selectedChannelId.value = channelId;
  unreadCounts.value[channelId] = 0;
};

const copyToClipboard = (text: string) => {
  window.navigator.clipboard?.writeText(text);
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
        <div class="channel-categories">
          <div v-for="(groupChannels, category) in groupedChannels" :key="category" class="channel-category">
            <div v-if="groupChannels.length > 0" class="category-label">{{ category }}</div>
            <div class="channel-list">
              <div
                v-for="channel in groupChannels"
                :key="channel.id"
                class="channel-item"
                :class="{ active: selectedChannelId === channel.id }"
                @click="selectChannel(channel.id)"
              >
                <div class="channel-glow-bar" v-if="selectedChannelId === channel.id"></div>
                <span class="channel-icon">#</span>
                <span class="channel-name">{{ channel.name }}</span>
                <span v-if="unreadCounts[channel.id]" class="unread-badge">
                  {{ unreadCounts[channel.id] }}
                </span>
              </div>
            </div>
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

      <div class="message-list" ref="messageListRef" v-if="selectedChannel" @scroll="handleScroll">
        <StratixLoading v-if="loading" mode="skeleton" :skeleton-lines="4" />

        <StratixEmpty
          v-else-if="messages.length === 0"
          scenario="no-messages"
          title="暂无消息"
          description="发送消息开始对话"
        />

        <div v-else class="messages">
          <div v-for="group in groupedMessages" :key="group.date" class="message-group">
            <div class="date-divider">
              <span>{{ group.date }}</span>
            </div>
            <div
              v-for="message in group.messages"
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
              
              <!-- Message actions -->
              <div class="message-actions">
                <button class="action-btn" title="复制" @click="copyToClipboard(message.content)">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
                <button class="action-btn" title="回复">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 17 4 12 9 7"/>
                    <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
                  </svg>
                </button>
                <button class="action-btn reaction-btn" title="反应">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                    <line x1="9" y1="9" x2="9.01" y2="9"/>
                    <line x1="15" y1="9" x2="15.01" y2="9"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Scroll to bottom button -->
        <Transition name="scroll-btn">
          <button
            v-if="showScrollToBottom"
            class="scroll-to-bottom"
            @click="scrollToBottom"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
            <span class="scroll-pulse"></span>
          </button>
        </Transition>
      </div>

      <div
        class="message-input"
        v-if="selectedChannel"
        :class="{ 'drag-over': isDraggingFile }"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      >
        <div class="drag-overlay" v-if="isDraggingFile">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <span>释放以上传文件</span>
        </div>
        
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
            <div class="popup-header">命令</div>
            <div 
              v-for="(cmd, idx) in commandList" 
              :key="cmd.id"
              class="popup-item"
              :class="{ selected: idx === selectedListIndex }"
              @click="selectCommand(cmd)"
            >
              <span class="item-icon">⌨️</span>
              <span class="item-label">/{{ cmd.label }}</span>
              <span class="item-desc">{{ cmd.description }}</span>
            </div>
          </div>
          
          <div v-if="showMentionList" class="popup-list mention-list">
            <div class="popup-header">提及 Agent</div>
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
    gap: var(--ds-spacing-sm);
  }

  .agent-item,
  .channel-item {
    flex-shrink: 0;
    min-width: 100px;
  }
}

.sidebar-section {
  padding: var(--ds-spacing-md);
  border-bottom: 1px solid var(--ds-border);
}

.section-title {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: var(--ds-spacing-sm);
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm);
}

.agent-item {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  padding: var(--ds-spacing-sm);
  border-radius: var(--ds-radius-md);
  cursor: pointer;
  transition: background 0.2s;
}

.agent-item:hover {
  background: var(--ds-bg-tertiary);
}

.agent-avatar {
  width: var(--ds-spacing-xl);
  height: var(--ds-spacing-xl);
  border-radius: var(--ds-radius-full);
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
  font-size: var(--ds-font-size-md);
  font-weight: bold;
}

.agent-info {
  flex: 1;
  min-width: 0;
}

.agent-name {
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-role {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
}

.agent-status {
  width: var(--ds-spacing-sm);
  height: var(--ds-spacing-sm);
  border-radius: var(--ds-radius-full);
}

.agent-status.online {
  background: var(--ds-status-success);
  box-shadow: 0 0 var(--ds-spacing-xs) var(--ds-status-success);
}

.agent-status.offline {
  background: var(--ds-text-muted);
}

.agent-status.busy {
  background: var(--ds-status-warning);
}

.channel-categories {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm);
}

.channel-category {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-xs);
}

.category-label {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding-left: var(--ds-spacing-sm);
}

.channel-list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-xs);
}

.channel-item {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  border-radius: var(--ds-radius-md);
  cursor: pointer;
  color: var(--ds-text-muted);
  transition: all 0.2s var(--ds-animation-easing-ease-out);
  position: relative;
  overflow: hidden;
}

.channel-item:hover {
  background: var(--ds-bg-tertiary);
  color: var(--ds-text-secondary);
  transform: translateX(2px) scale(1.01);
}

.channel-item.active {
  background: var(--ds-bg-tertiary);
  color: var(--ds-brand-primary);
}

.channel-glow-bar {
  position: absolute;
  left: 0;
  top: var(--ds-spacing-xs);
  bottom: var(--ds-spacing-xs);
  width: var(--ds-border-width-md, 3px);
  background: var(--ds-brand-primary);
  border-radius: 0 2px 2px 0;
  box-shadow: 0 0 8px var(--ds-brand-primary);
}

.channel-icon {
  font-size: var(--ds-font-size-md);
}

.channel-name {
  font-size: var(--ds-font-size-sm);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.unread-badge {
  min-width: calc(var(--ds-spacing-md) + var(--ds-spacing-xs));
  height: calc(var(--ds-spacing-md) + var(--ds-spacing-xs));
  padding: 0 var(--ds-spacing-xs);
  background: var(--ds-status-danger);
  color: white;
  border-radius: var(--ds-radius-full);
  font-size: var(--ds-font-size-xs);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: badge-pulse 2s infinite;
}

@keyframes badge-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ds-status-danger) 40%, transparent); }
  50% { box-shadow: 0 0 0 var(--ds-spacing-sm) color-mix(in srgb, var(--ds-status-danger) 0%, transparent); }
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-header {
  padding: var(--ds-spacing-md) var(--ds-spacing-lg);
  border-bottom: 1px solid var(--ds-border);
  background: var(--ds-bg-secondary);
}

.channel-info {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
}

.channel-info .channel-icon {
  font-size: var(--ds-font-size-xl);
  color: var(--ds-text-muted);
}

.channel-info .channel-name {
  font-size: var(--ds-font-size-lg);
  font-weight: bold;
  color: var(--ds-text-primary);
}

.channel-description {
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-muted);
  margin-top: var(--ds-spacing-xs);
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--ds-spacing-md);
  position: relative;
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
  width: var(--ds-spacing-xl);
  height: var(--ds-spacing-xl);
  border: var(--ds-border-width-md, 3px) solid var(--ds-border);
  border-top-color: var(--ds-brand-primary);
  border-radius: var(--ds-radius-full);
  animation: spin 0.8s linear infinite;
  margin-bottom: var(--ds-spacing-sm);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty-icon {
  font-size: var(--ds-font-size-4xl);
  margin-bottom: var(--ds-spacing-sm);
}

.empty-hint {
  font-size: var(--ds-font-size-sm);
  margin-top: var(--ds-spacing-sm);
}

.messages {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-md);
}

.message-group {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm);
}

.date-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: var(--ds-spacing-md) 0;
}

.date-divider::before,
.date-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--ds-border);
}

.date-divider span {
  padding: 0 var(--ds-spacing-md);
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  background: var(--ds-bg-secondary);
}

.message-item {
  padding: calc(var(--ds-spacing-sm) + var(--ds-spacing-xs));
  background: var(--ds-bg-secondary);
  border-radius: var(--ds-radius-md);
  transition: all 0.2s ease;
  position: relative;
}

.message-item:hover {
  background: var(--ds-bg-tertiary);
}

.message-item:hover .message-actions {
  opacity: 1;
}

.message-item.own-message {
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
}

.message-sender {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  margin-bottom: var(--ds-spacing-sm);
}

.sender-avatar {
  width: calc(var(--ds-spacing-lg) + var(--ds-spacing-xs));
  height: calc(var(--ds-spacing-lg) + var(--ds-spacing-xs));
  border-radius: var(--ds-radius-full);
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
  gap: var(--ds-spacing-sm);
}

.sender-name {
  font-size: var(--ds-font-size-sm);
  font-weight: bold;
  color: var(--ds-text-primary);
}

.sender-role {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
}

.message-time {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
}

.message-content {
  font-size: var(--ds-font-size-md);
  color: var(--ds-text-secondary);
  line-height: 1.5;
}

.message-content .mention {
  color: var(--ds-brand-primary);
  font-weight: bold;
  background: color-mix(in srgb, var(--ds-brand-primary) 10%, transparent);
  padding: 0 var(--ds-spacing-xs);
  border-radius: var(--ds-radius-sm);
}

.message-actions {
  display: flex;
  gap: var(--ds-spacing-xs);
  margin-top: var(--ds-spacing-sm);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--ds-spacing-lg) + var(--ds-spacing-xs));
  height: calc(var(--ds-spacing-lg) + var(--ds-spacing-xs));
  padding: 0;
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-sm);
  color: var(--ds-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn:hover {
  background: var(--ds-brand-primary);
  color: white;
  border-color: var(--ds-brand-primary);
}

.scroll-to-bottom {
  position: absolute;
  bottom: var(--ds-spacing-md);
  right: var(--ds-spacing-lg);
  width: var(--ds-spacing-2xl);
  height: var(--ds-spacing-2xl);
  border-radius: var(--ds-radius-full);
  background: var(--ds-brand-primary);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--ds-shadow-md);
  z-index: 10;
  transition: transform 0.2s ease;
}

.scroll-to-bottom:hover {
  transform: scale(1.1);
}

.scroll-pulse {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: var(--ds-radius-full);
  background: var(--ds-brand-primary);
  animation: scroll-pulse 2s infinite;
  z-index: -1;
}

@keyframes scroll-pulse {
  0%, 100% { transform: scale(1); opacity: 0.5; }
  50% { transform: scale(1.4); opacity: 0; }
}

.scroll-btn-enter-active,
.scroll-btn-leave-active {
  transition: all 0.3s var(--ds-animation-easing-ease-out);
}

.scroll-btn-enter-from,
.scroll-btn-leave-to {
  opacity: 0;
  transform: translateY(var(--ds-spacing-sm));
}

.message-input {
  padding: var(--ds-spacing-md);
  border-top: 1px solid var(--ds-border);
  background: var(--ds-bg-secondary);
  display: flex;
  gap: calc(var(--ds-spacing-sm) + var(--ds-spacing-xs));
  align-items: flex-start;
  position: relative;
  transition: all 0.2s ease;
}

.message-input.drag-over {
  background: var(--ds-bg-tertiary);
  border: 2px dashed var(--ds-brand-primary);
  border-radius: var(--ds-radius-md);
  margin: var(--ds-spacing-sm);
}

.drag-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--ds-bg-overlay);
  border-radius: var(--ds-radius-md);
  z-index: 20;
  gap: var(--ds-spacing-sm);
  color: var(--ds-brand-primary);
  font-weight: 500;
}

.message-input .input-wrapper {
  flex: 1;
  position: relative;
}

.message-input .stratix-textarea {
  background: var(--ds-bg-primary);
  border-color: var(--ds-border);
  color: var(--ds-text-primary);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.message-input .stratix-textarea:focus {
  border-color: var(--ds-brand-primary);
  box-shadow: 0 0 0 var(--ds-spacing-xs) var(--ds-border-focus, color-mix(in srgb, var(--ds-brand-primary) 15%, transparent));
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
  border-radius: var(--ds-radius-md);
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: var(--ds-spacing-sm);
  box-shadow: var(--ds-shadow-md);
  z-index: 100;
}

.popup-header {
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--ds-border);
}

.popup-item {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  padding: calc(var(--ds-spacing-sm) + var(--ds-spacing-xs)) var(--ds-spacing-md);
  cursor: pointer;
  transition: background 0.15s;
}

.popup-item:first-of-type {
  border-radius: var(--ds-radius-lg) var(--ds-radius-lg) 0 0;
}

.popup-item:last-child {
  border-radius: 0 0 var(--ds-radius-lg) var(--ds-radius-lg);
}

.popup-item:hover,
.popup-item.selected {
  background: var(--ds-bg-tertiary);
}

.popup-item .item-icon {
  font-size: var(--ds-font-size-md);
}

.popup-item .item-label {
  font-weight: 500;
  color: var(--ds-text-primary);
  min-width: 80px;
}

.popup-item .item-desc {
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-sm);
}

.agent-avatar-small {
  width: var(--ds-spacing-lg);
  height: var(--ds-spacing-lg);
  border-radius: var(--ds-radius-full);
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
  font-size: var(--ds-font-size-xs);
  font-weight: bold;
  border-radius: var(--ds-radius-full);
}

/* Code block styling for message content */
:deep(.code-block-wrapper) {
  position: relative;
  margin: var(--ds-spacing-sm) 0;
  border-radius: var(--ds-radius-md);
  overflow: hidden;
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border-default);
}

:deep(.code-block-wrapper) .code-lang {
  position: absolute;
  top: var(--ds-spacing-sm);
  left: calc(var(--ds-spacing-sm) + var(--ds-spacing-xs));
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  background: var(--ds-bg-tertiary);
  padding: 2px var(--ds-spacing-xs);
  border-radius: var(--ds-radius-sm);
  z-index: 1;
}

:deep(.code-block-wrapper) .copy-button {
  position: absolute;
  top: var(--ds-spacing-sm);
  right: var(--ds-spacing-sm);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: var(--ds-radius-sm);
  padding: var(--ds-spacing-xs) var(--ds-spacing-sm);
  font-size: var(--ds-font-size-sm);
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
  padding: calc(var(--ds-spacing-sm) + var(--ds-spacing-xs));
  padding-top: calc(var(--ds-spacing-xl) + var(--ds-spacing-xs));
  overflow-x: auto;
  background: transparent;
}

:deep(.code-block-wrapper) code {
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
  font-size: var(--ds-font-size-sm);
  line-height: 1.5;
  background: transparent;
}

/* Inline code styling */
:deep(.message-text code:not(.hljs)) {
  background: var(--ds-bg-tertiary);
  padding: 2px var(--ds-spacing-xs);
  border-radius: var(--ds-radius-sm);
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
  font-size: 0.9em;
}

.message-agent :deep(pre),
.message-agent :deep(.code-block-wrapper pre) {
  background: color-mix(in srgb, var(--ds-bg-base) 20%, transparent);
}

/* Prefers reduced motion */
@media (prefers-reduced-motion: reduce) {
  .channel-item,
  .message-item,
  .scroll-to-bottom,
  .unread-badge,
  .action-btn {
    transition: none !important;
    animation: none !important;
    transform: none !important;
  }
}
</style>
