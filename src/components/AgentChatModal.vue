<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { StratixModal, StratixButton } from '@/components/ui';
import ProviderSettingsModal from '@/components/ProviderSettingsModal.vue';
import { agentStore } from '@/stores/agentStore';
import { useChat } from '@/composables/useChat';

const props = defineProps<{
  visible: boolean;
  agentIds: string[];
  mode?: 'single' | 'group';
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const chatMessagesRef = ref<HTMLElement | null>(null);
const showProviderSettings = ref(false);
const useToolUse = ref(false);
const showSkillHistory = ref(false);
const skillHistory = ref<any[]>([]);
const loadingSkillHistory = ref(false);

// Provider settings modal
const showProviderSettingsRef = ref(false);

const scrollToBottom = async () => {
  await nextTick();
  if (chatMessagesRef.value) {
    chatMessagesRef.value.scrollTop = chatMessagesRef.value.scrollHeight;
  }
};

const selectedAgents = computed(() => {
  const agents = Array.isArray(agentStore.agents)
    ? agentStore.agents
    : (agentStore.agents.value || []);

  return agents.filter(agent => props.agentIds.includes(agent.agentId));
});

const chatTitle = computed(() => {
  if (props.mode === 'group' || props.agentIds.length > 1) {
    return `群聊 (${selectedAgents.value.length} 人)`;
  }
  const agent = selectedAgents.value[0];
  return agent?.name || '聊天';
});

const agent = computed(() => selectedAgents.value[0]);

// 使用 useChat
const {
  messages,
  isLoading,
  isLoadingHistory,
  isComposing,
  hasMoreHistory,
  inputText,
  loadHistory,
  sendMessage,
  retryMessage,
  clearHistory,
  handleKeyDown,
  handleCompositionStart,
  handleCompositionEnd
} = useChat({
  agentId: computed(() => props.agentIds[0] || '').value,
  backendType: 'stratix',
  config: computed(() => agent.value?.stratixConfig || {}).value,
  systemPrompt: '你是 Stratix Agent（星策代理），一个智能助手，负责帮助用户完成各种任务。请简洁专业地回答问题。',
  persistMessages: true,
  maxHistory: 20,
  agentName: computed(() => agent.value?.name || 'Agent').value,
  useToolUse: useToolUse.value,
  onMessageRender: () => {
    scrollToBottom();
  }
});

// 监听 agentId 变化，重新加载历史
watch(
  () => props.agentIds[0],
  (newAgentId, oldAgentId) => {
    if (newAgentId && newAgentId !== oldAgentId) {
      clearHistory();
      loadHistory();
    }
  }
);

onMounted(() => {
  if (props.agentIds[0]) {
    loadHistory();
  }
});

const handleClose = () => {
  emit('close');
};

const loadMoreHistory = () => {
  if (hasMoreHistory.value && !isLoadingHistory.value) {
    loadHistory(true);
  }
};

const loadSkillHistory = async () => {
  if (!agent.value?.agentId) return;
  loadingSkillHistory.value = true;
  try {
    const response = await fetch(`/api/skills/audit/${agent.value.agentId}?limit=20`);
    const result = await response.json();
    if (result.success) {
      skillHistory.value = result.data || [];
    }
  } catch (error) {
    console.error('Failed to load skill history:', error);
  } finally {
    loadingSkillHistory.value = false;
  }
};

const toggleSkillHistory = () => {
  showSkillHistory.value = !showSkillHistory.value;
  if (showSkillHistory.value && skillHistory.value.length === 0) {
    loadSkillHistory();
  }
};

const formatTime = (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};
</script>

<template>
  <StratixModal
    :visible="visible"
    :title="chatTitle"
    :width="600"
    :height="500"
    position="center"
    @update:visible="$emit('close')"
  >
    <template #header>
      <h3 class="stratix-modal__title">{{ chatTitle }}</h3>
      <div class="header-actions">
        <label class="tool-use-toggle" title="启用工具调用 (Tool Use)">
          <input type="checkbox" v-model="useToolUse" />
          <span class="toggle-label">🔧</span>
        </label>
        <div class="skill-history-wrapper">
          <button class="settings-btn" @click="toggleSkillHistory" title="技能历史">
            📋
          </button>
          <div v-if="showSkillHistory" class="skill-history-dropdown">
            <div class="skill-history-header">
              <span>技能执行历史</span>
              <button class="close-btn" @click="showSkillHistory = false">✕</button>
            </div>
            <div class="skill-history-content">
              <div v-if="loadingSkillHistory" class="loading">加载中...</div>
              <div v-else-if="skillHistory.length === 0" class="empty">暂无历史记录</div>
              <div v-else class="skill-list">
                <div v-for="log in skillHistory" :key="log.id" class="skill-history-item">
                  <span class="skill-icon">{{ log.error ? '❌' : '✅' }}</span>
                  <span class="skill-name">{{ log.skillId }}</span>
                  <span class="skill-time">{{ formatTime(log.executionTime) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <button class="settings-btn" @click="showProviderSettings = true" title="Provider Settings">
          ⚙️
        </button>
        <button
          class="stratix-modal__close"
          type="button"
          @click="$emit('close')"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>
    </template>

    <div class="chat-container">
      <div class="chat-messages" ref="chatMessagesRef">
        <div v-if="hasMoreHistory && !isLoadingHistory" class="load-more" @click="loadMoreHistory">
          加载更多
        </div>
        <div v-if="isLoadingHistory" class="loading-more">
          加载中...
        </div>

        <div v-if="messages.length === 0 && !isLoading" class="chat-empty">
          开始与 {{ selectedAgents.map(a => a.name).join(', ') }} 聊天
        </div>
        <div
          v-for="msg in messages"
          :key="msg.id"
          class="message"
          :class="{
            'message-user': msg.isUser,
            'message-agent': !msg.isUser,
            'message-pending': msg.status === 'pending',
            'message-failed': msg.status === 'failed'
          }"
        >
          <div class="message-avatar">
            {{ msg.isUser ? '👤' : '🤖' }}
          </div>
          <div class="message-content">
            <div class="message-header">
              <span class="message-name">{{ msg.agentName }}</span>
              <span class="message-time">{{ msg.timestamp.toLocaleTimeString() }}</span>
              <span v-if="msg.status === 'pending'" class="message-status">发送中...</span>
              <span v-if="msg.status === 'failed'" class="message-status failed" @click="retryMessage(msg.id)">
                重试
              </span>
            </div>
            <div v-if="msg.error" class="message-error">{{ msg.error }}</div>
            <div class="message-text" v-html="msg.content"></div>
            <div v-if="msg.skillExecutions && msg.skillExecutions.length > 0" class="skill-executions">
              <div class="skill-executions-title">🔧 使用的工具：</div>
              <div
                v-for="skill in msg.skillExecutions"
                :key="skill.id"
                class="skill-execution-item"
                :class="`skill-${skill.status}`"
              >
                <span class="skill-icon">{{ skill.status === 'success' ? '✅' : skill.status === 'error' ? '❌' : '⏳' }}</span>
                <span class="skill-name">{{ skill.skillName }}</span>
                <span class="skill-time" v-if="skill.executionTime">({{ skill.executionTime }}ms)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="chat-input">
        <textarea
          v-model="inputText"
          placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
          rows="3"
          :disabled="isLoading"
          @keydown="handleKeyDown"
          @compositionstart="handleCompositionStart"
          @compositionend="handleCompositionEnd"
        />
        <StratixButton
          size="sm"
          variant="primary"
          :loading="isLoading"
          :disabled="!inputText.trim()"
          @click="sendMessage"
        >
          发送
        </StratixButton>
      </div>
    </div>
  </StratixModal>

  <!-- Provider Settings Modal -->
  <ProviderSettingsModal
    :visible="showProviderSettings"
    @update:visible="showProviderSettings = $event"
    @saved="showProviderSettings = false"
  />
</template>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--ds-border-default);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s ease;
}

.settings-btn:hover {
  background: var(--ds-bg-tertiary);
}

.skill-history-wrapper {
  position: relative;
}

.skill-history-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  width: 280px;
  max-height: 400px;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border-default);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  margin-top: 4px;
  overflow: hidden;
}

.skill-history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--ds-border-default);
  font-size: 13px;
  font-weight: 600;
  color: var(--ds-text-primary);
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--ds-text-muted);
  padding: 4px;
}

.close-btn:hover {
  color: var(--ds-text-primary);
}

.skill-history-content {
  max-height: 340px;
  overflow-y: auto;
}

.loading, .empty {
  padding: 20px;
  text-align: center;
  color: var(--ds-text-muted);
  font-size: 13px;
}

.skill-list {
  padding: 8px;
}

.skill-history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
}

.skill-history-item:hover {
  background: var(--ds-bg-tertiary);
}

.skill-history-item .skill-icon {
  font-size: 12px;
}

.skill-history-item .skill-name {
  flex: 1;
  color: var(--ds-text-primary);
}

.skill-history-item .skill-time {
  color: var(--ds-text-muted);
  font-size: 11px;
}

.tool-use-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s ease;
}

.tool-use-toggle:hover {
  background: var(--ds-bg-tertiary);
}

.tool-use-toggle input {
  display: none;
}

.toggle-label {
  font-size: 16px;
  opacity: 0.5;
  transition: all 0.15s ease;
  filter: grayscale(100%);
}

.tool-use-toggle:has(input:checked) {
  background: var(--ds-accent);
}

.tool-use-toggle:has(input:checked) .toggle-label {
  opacity: 1;
  filter: grayscale(0%);
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.chat-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--ds-text-muted);
}

.load-more {
  text-align: center;
  color: var(--ds-accent);
  cursor: pointer;
  padding: 8px;
  margin-bottom: 8px;
}

.load-more:hover {
  text-decoration: underline;
}

.loading-more {
  text-align: center;
  color: var(--ds-text-muted);
  padding: 8px;
  margin-bottom: 8px;
}

.message {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.message-pending {
  opacity: 0.7;
}

.message-failed .message-text {
  border: 1px solid var(--ds-status-danger);
}

.message-user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-bg-tertiary);
  border-radius: 50%;
  font-size: 18px;
  flex-shrink: 0;
}

.message-content {
  max-width: 70%;
}

/* Responsive: narrow screens */
@media (max-width: 1024px) {
  .message-content {
    max-width: 85%;
  }

  .message-avatar {
    width: 28px;
    height: 28px;
    font-size: 14px;
  }

  .message-text {
    font-size: 13px;
    padding: 6px 10px;
  }

  .skill-history-dropdown {
    width: 240px;
    right: -60px;
  }
}

.message-user .message-content {
  text-align: right;
}

.message-header {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
}

.message-user .message-header {
  flex-direction: row-reverse;
}

.message-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--ds-text-primary);
}

.message-time {
  font-size: 11px;
  color: var(--ds-text-muted);
}

.message-status {
  font-size: 11px;
  color: var(--ds-text-muted);
}

.message-status.failed {
  color: var(--ds-status-danger);
  cursor: pointer;
}

.message-error {
  font-size: 11px;
  color: var(--ds-status-danger);
  margin-top: 4px;
}

.message-status.failed:hover {
  text-decoration: underline;
}

.message-text {
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--ds-bg-tertiary);
  color: var(--ds-text-primary);
  font-size: 14px;
  line-height: 1.5;
}

.message-user .message-text {
  background: var(--ds-accent);
  color: white;
}

.skill-executions {
  margin-top: 8px;
  padding: 8px;
  background: var(--ds-bg-primary);
  border-radius: 6px;
  border: 1px solid var(--ds-border-default);
}

.skill-executions-title {
  font-size: 11px;
  color: var(--ds-text-muted);
  margin-bottom: 6px;
}

.skill-execution-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 12px;
}

.skill-icon {
  font-size: 12px;
}

.skill-name {
  color: var(--ds-text-primary);
  font-weight: 500;
}

.skill-time {
  color: var(--ds-text-muted);
  font-size: 11px;
}

.skill-success {
  color: var(--ds-success);
}

.skill-error {
  color: var(--ds-status-danger);
}

.chat-input {
  display: flex;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid var(--ds-border-default);
}

.chat-input textarea {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--ds-border-default);
  border-radius: 6px;
  background: var(--ds-bg-primary);
  color: var(--ds-text-primary);
  resize: none;
  font-family: inherit;
  font-size: 14px;
}

.chat-input textarea:focus {
  outline: none;
  border-color: var(--ds-accent);
}

.chat-input textarea:disabled {
  opacity: 0.5;
}
</style>
