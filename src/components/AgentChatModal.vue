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
  border: 1px solid #ff4d4f;
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
  color: #ff4d4f;
  cursor: pointer;
}

.message-error {
  font-size: 11px;
  color: #ff4d4f;
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
