<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { StratixModal, StratixButton } from '@/components/ui';
import ProviderSettingsModal from '@/components/ProviderSettingsModal.vue';
import { useAgentStore } from '@/stores/agent';

const agentStore = useAgentStore();
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
const isTyping = ref(false);
const inputRef = ref<HTMLTextAreaElement | null>(null);

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

const formatMessageTime = (date: Date) => {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
};

// Simulate typing indicator when agent is loading
watch(isLoading, (val) => {
  if (val && !messages.value[messages.value.length - 1]?.isUser) {
    isTyping.value = true;
    setTimeout(() => { isTyping.value = false; }, 1500);
  } else {
    isTyping.value = false;
  }
});

const getMessageStatus = (msg: any) => {
  if (msg.status === 'pending') return 'sending';
  if (msg.status === 'failed') return 'failed';
  if (msg.isUser) return 'sent';
  return 'read';
};

const getSkillIcon = (skillId: string) => {
  const iconMap: Record<string, string> = {
    search: '🔍', file: '📄', code: '💻', web: '🌐', db: '🗄️',
    api: '🔌', image: '🖼️', chart: '📊', mail: '✉️', calendar: '📅'
  };
  const key = skillId?.split('.')[0] || '';
  return iconMap[key] || '🔧';
};

// Parse @mentions in input for highlighting
const parsedInput = computed(() => {
  return inputText.value.replace(/(@\w+)/g, '<span class="mention-highlight">$1</span>');
});
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
          <Transition name="skill-history">
            <div v-if="showSkillHistory" class="skill-history-dropdown">
              <div class="skill-history-header">
                <span>技能执行历史</span>
                <button class="close-btn" @click="showSkillHistory = false">✕</button>
              </div>
              <div class="skill-history-content">
                <div v-if="loadingSkillHistory" class="loading">加载中...</div>
                <div v-else-if="skillHistory.length === 0" class="empty">暂无历史记录</div>
                <div v-else class="skill-list">
                  <div v-for="(log, idx) in skillHistory" :key="log.id" class="skill-history-item" :style="{ animationDelay: `${idx * 50}ms` }">
                    <span class="skill-icon">{{ log.error ? '❌' : getSkillIcon(log.skillId) }}</span>
                    <span class="skill-name">{{ log.skillId }}</span>
                    <span class="skill-time">{{ formatTime(log.executionTime) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </Transition>
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
          <span class="loading-dots">加载中</span>
        </div>

        <div v-if="messages.length === 0 && !isLoading" class="chat-empty">
          开始与 {{ selectedAgents.map(a => a.name).join(', ') }} 聊天
        </div>
        <TransitionGroup name="message-enter">
          <div
            v-for="(msg, idx) in messages"
            :key="msg.id"
            class="message"
            :class="{
              'message-user': msg.isUser,
              'message-agent': !msg.isUser,
              'message-pending': msg.status === 'pending',
              'message-failed': msg.status === 'failed'
            }"
            :style="{ animationDelay: `${idx * 50}ms` }"
          >
            <div class="message-avatar-wrapper">
              <div class="message-avatar">
                {{ msg.isUser ? '👤' : '🤖' }}
              </div>
              <div v-if="!msg.isUser" class="online-indicator"></div>
            </div>
            <div class="message-content">
              <div class="message-header">
                <span class="message-name">{{ msg.agentName }}</span>
                <span class="message-time-hover" :title="msg.timestamp.toLocaleString()">{{ formatMessageTime(msg.timestamp) }}</span>
                <span class="message-status-icon" :class="getMessageStatus(msg)">
                  <template v-if="getMessageStatus(msg) === 'sent'">✓</template>
                  <template v-else-if="getMessageStatus(msg) === 'read'">✓✓</template>
                  <template v-else-if="getMessageStatus(msg) === 'sending'">⏳</template>
                  <template v-else-if="getMessageStatus(msg) === 'failed'">✕</template>
                </span>
              </div>
              <div class="message-bubble">
                <div v-if="msg.error" class="message-error">{{ msg.error }}</div>
                <div class="message-text" v-html="msg.content"></div>
              </div>
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
        </TransitionGroup>

        <!-- Typing indicator -->
        <Transition name="typing">
          <div v-if="isTyping" class="typing-indicator">
            <div class="message-avatar-wrapper">
              <div class="message-avatar">🤖</div>
              <div class="online-indicator"></div>
            </div>
            <div class="typing-bubble">
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
            </div>
          </div>
        </Transition>
      </div>

      <div class="chat-input">
        <div class="input-wrapper">
          <textarea
            ref="inputRef"
            v-model="inputText"
            placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
            rows="3"
            :disabled="isLoading"
            @keydown="handleKeyDown"
            @compositionstart="handleCompositionStart"
            @compositionend="handleCompositionEnd"
          />
          <div v-if="inputText.includes('@')" class="mention-overlay" v-html="parsedInput"></div>
        </div>
        <StratixButton
          size="sm"
          variant="primary"
          :loading="isLoading"
          :disabled="!inputText.trim()"
          @click="sendMessage"
          class="send-btn"
        >
          <span class="send-btn-text">发送</span>
          <span class="send-btn-icon">→</span>
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
  gap: var(--ds-spacing-sm);
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
  border-radius: var(--ds-radius-sm);
  cursor: pointer;
  font-size: var(--ds-font-size-md);
  transition: all var(--ds-animation-duration-fast) ease;
}

.settings-btn:hover {
  background: var(--ds-bg-tertiary);
  transform: scale(1.05);
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
  border-radius: var(--ds-radius-md);
  box-shadow: var(--ds-shadow-md);
  z-index: 1000;
  margin-top: 4px;
  overflow: hidden;
  transform-origin: top right;
}

.skill-history-enter-active,
.skill-history-leave-active {
  transition: transform 0.2s var(--ds-animation-easing-ease-out),
              opacity 0.2s var(--ds-animation-easing-ease-out);
}

.skill-history-enter-from,
.skill-history-leave-to {
  transform: scale(0.95);
  opacity: 0;
}

.skill-history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--ds-border-default);
  font-size: var(--ds-font-size-sm);
  font-weight: 600;
  color: var(--ds-text-primary);
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-muted);
  padding: var(--ds-spacing-xs);
  transition: color 0.15s ease;
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
  font-size: var(--ds-font-size-sm);
}

.loading-dots::after {
  content: '';
  animation: dots 1.5s infinite;
}

@keyframes dots {
  0%, 20% { content: '.'; }
  40% { content: '..'; }
  60%, 100% { content: '...'; }
}

.skill-list {
  padding: var(--ds-spacing-sm);
}

.skill-history-item {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  padding: var(--ds-spacing-sm);
  border-radius: var(--ds-radius-sm);
  font-size: var(--ds-font-size-sm);
  opacity: 0;
  animation: ds-slide-up 0.3s var(--ds-animation-easing-ease-out) forwards;
}

.skill-history-item:hover {
  background: var(--ds-bg-tertiary);
}

.skill-history-item .skill-icon {
  font-size: var(--ds-font-size-sm);
  width: 20px;
  text-align: center;
}

.skill-history-item .skill-name {
  flex: 1;
  color: var(--ds-text-primary);
}

.skill-history-item .skill-time {
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-xs);
}

.tool-use-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  cursor: pointer;
  border-radius: var(--ds-radius-sm);
  transition: background 0.15s ease;
}

.tool-use-toggle:hover {
  background: var(--ds-bg-tertiary);
}

.tool-use-toggle input {
  display: none;
}

.toggle-label {
  font-size: var(--ds-font-size-lg);
  opacity: 0.5;
  transition: all var(--ds-animation-duration-fast) ease;
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
  padding: var(--ds-spacing-md);
}

.chat-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--ds-text-muted);
  animation: ds-fade-in 0.5s ease;
}

.load-more {
  text-align: center;
  color: var(--ds-accent);
  cursor: pointer;
  padding: var(--ds-spacing-sm);
  margin-bottom: 8px;
  border-radius: var(--ds-radius-sm);
  transition: background 0.15s ease;
}

.load-more:hover {
  text-decoration: underline;
  background: var(--ds-bg-tertiary);
}

.loading-more {
  text-align: center;
  color: var(--ds-text-muted);
  padding: var(--ds-spacing-sm);
  margin-bottom: 8px;
}

.message {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  opacity: 0;
  animation: ds-slide-up 0.35s var(--ds-animation-easing-ease-out) forwards;
}

.message-enter-move {
  transition: transform 0.3s ease;
}

.message-enter-enter-active,
.message-enter-leave-active {
  transition: all 0.3s var(--ds-animation-easing-ease-out);
}

.message-enter-enter-from,
.message-enter-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

.message-pending {
  opacity: 0.7;
}

.message-failed .message-bubble {
  border: 1px solid var(--ds-status-danger);
}

.message-user {
  flex-direction: row-reverse;
}

.message-avatar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.message-avatar {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-bg-tertiary);
  border-radius: var(--ds-radius-full);
  font-size: var(--ds-font-size-xl);
  transition: transform 0.2s var(--ds-animation-easing-ease-out);
  cursor: default;
}

.message-avatar:hover {
  transform: scale(1.15);
}

.online-indicator {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  background: var(--ds-status-success);
  border-radius: var(--ds-radius-full);
  border: 2px solid var(--ds-bg-secondary);
  box-shadow: 0 0 6px var(--ds-status-success);
  animation: glow-pulse 2s infinite;
}

@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 4px var(--ds-status-success); }
  50% { box-shadow: 0 0 10px var(--ds-status-success), 0 0 4px var(--ds-status-success); }
}

.message-content {
  max-width: 70%;
  display: flex;
  flex-direction: column;
}

/* Responsive: narrow screens */
@media (max-width: 1024px) {
  .message-content {
    max-width: 85%;
  }

  .message-avatar {
    width: 28px;
    height: 28px;
    font-size: var(--ds-font-size-md);
  }

  .message-text {
    font-size: var(--ds-font-size-sm);
    padding: 6px 10px;
  }

  .skill-history-dropdown {
    width: 240px;
    right: -60px;
  }
}

.message-user .message-content {
  align-items: flex-end;
}

.message-header {
  display: flex;
  gap: var(--ds-spacing-sm);
  align-items: center;
  margin-bottom: 4px;
  padding: 0 4px;
}

.message-user .message-header {
  flex-direction: row-reverse;
}

.message-name {
  font-weight: 600;
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-primary);
}

.message-time-hover {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.message:hover .message-time-hover {
  opacity: 1;
}

.message-status-icon {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  transition: color 0.2s ease;
}

.message-status-icon.read {
  color: var(--ds-status-info);
}

.message-status-icon.failed {
  color: var(--ds-status-danger);
  cursor: pointer;
}

.message-error {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-status-danger);
  margin-bottom: 4px;
}

.message-bubble {
  position: relative;
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  border-radius: var(--ds-radius-md);
  background: var(--ds-bg-tertiary);
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-md);
  line-height: 1.5;
}

/* Message tail */
.message-agent .message-bubble::before {
  content: '';
  position: absolute;
  top: 8px;
  left: -6px;
  width: 0;
  height: 0;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  border-right: 6px solid var(--ds-bg-tertiary);
}

.message-user .message-bubble {
  background: var(--ds-accent);
  color: white;
}

.message-user .message-bubble::before {
  content: '';
  position: absolute;
  top: 8px;
  right: -6px;
  width: 0;
  height: 0;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  border-left: 6px solid var(--ds-accent);
}

.skill-executions {
  margin-top: 8px;
  padding: var(--ds-spacing-sm);
  background: var(--ds-bg-primary);
  border-radius: var(--ds-radius-md);
  border: 1px solid var(--ds-border-default);
}

.skill-executions-title {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  margin-bottom: 6px;
}

.skill-execution-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--ds-spacing-xs) 0;
  font-size: var(--ds-font-size-sm);
}

.skill-icon {
  font-size: var(--ds-font-size-sm);
}

.skill-name {
  color: var(--ds-text-primary);
  font-weight: 500;
}

.skill-time {
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-xs);
}

.skill-success {
  color: var(--ds-success);
}

.skill-error {
  color: var(--ds-status-danger);
}

/* Typing indicator */
.typing-indicator {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  align-items: flex-end;
}

.typing-enter-active,
.typing-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.typing-enter-from,
.typing-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.typing-bubble {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 16px;
  background: var(--ds-bg-tertiary);
  border-radius: var(--ds-radius-md);
  min-width: 50px;
}

.typing-dot {
  width: 6px;
  height: 6px;
  background: var(--ds-text-muted);
  border-radius: var(--ds-radius-full);
  animation: typing-bounce 1.4s ease-in-out infinite;
}

.typing-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing-bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px); }
}

.chat-input {
  display: flex;
  gap: var(--ds-spacing-sm);
  padding: var(--ds-spacing-md);
  border-top: 1px solid var(--ds-border-default);
}

.input-wrapper {
  flex: 1;
  position: relative;
}

.chat-input textarea {
  flex: 1;
  width: 100%;
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  border: 1px solid var(--ds-border-default);
  border-radius: var(--ds-radius-md);
  background: var(--ds-bg-primary);
  color: var(--ds-text-primary);
  resize: none;
  font-family: inherit;
  font-size: var(--ds-font-size-md);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  box-sizing: border-box;
}

.chat-input textarea:focus {
  outline: none;
  border-color: var(--ds-accent);
  box-shadow: 0 0 0 3px var(--ds-border-focus, rgba(59, 130, 246, 0.15));
}

.chat-input textarea:disabled {
  opacity: 0.5;
}

.mention-overlay {
  position: absolute;
  top: 0;
  left: 0;
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  pointer-events: none;
  opacity: 0;
  font-family: inherit;
  font-size: var(--ds-font-size-md);
  white-space: pre-wrap;
  word-wrap: break-word;
}

:deep(.mention-highlight) {
  background: rgba(59, 130, 246, 0.15);
  color: var(--ds-brand-primary);
  border-radius: var(--ds-radius-sm);
  padding: 0 2px;
}

.send-btn {
  position: relative;
  overflow: hidden;
}

.send-btn-text {
  transition: transform 0.2s ease;
}

.send-btn-icon {
  position: absolute;
  right: -20px;
  opacity: 0;
  transition: all 0.2s ease;
}

.send-btn:hover .send-btn-text {
  transform: translateX(-8px);
}

.send-btn:hover .send-btn-icon {
  right: 8px;
  opacity: 1;
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
  top: 8px;
  left: 12px;
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  background: var(--ds-bg-tertiary);
  padding: 2px var(--ds-spacing-xs);
  border-radius: var(--ds-radius-sm);
  z-index: 1;
}

:deep(.code-block-wrapper) .copy-button {
  position: absolute;
  top: 8px;
  right: 8px;
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
  padding: 12px;
  padding-top: 36px;
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

/* Prefers reduced motion */
@media (prefers-reduced-motion: reduce) {
  .message,
  .skill-history-item,
  .message-avatar,
  .typing-bubble,
  .online-indicator {
    animation: none !important;
    transition: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
</style>
