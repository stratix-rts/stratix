<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { StratixModal, StratixButton } from '@/components/ui';
import { agentStore } from '@/stores/agentStore';
import { loadApiKey } from '@/stratix-character-creator/config/providerConfig';

interface AgentMessage {
  id: string;
  agentId: string;
  agentName: string;
  content: string;
  timestamp: Date;
  isUser?: boolean;
}

const props = defineProps<{
  visible: boolean;
  agentIds: string[];
  mode?: 'single' | 'group';
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const messages = ref<AgentMessage[]>([]);
const inputText = ref('');
const isLoading = ref(false);

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

const sendMessage = async () => {
  if (!inputText.value.trim() || isLoading.value) return;

  const userMessage: AgentMessage = {
    id: `user-${Date.now()}`,
    agentId: 'user',
    agentName: '你',
    content: inputText.value.trim(),
    timestamp: new Date(),
    isUser: true,
  };

  messages.value.push(userMessage);

  const messageText = inputText.value.trim();
  inputText.value = '';
  isLoading.value = true;

  try {
    // Get agent config for the first agent (single chat)
    const agent = selectedAgents.value[0];

    if (!agent) {
      throw new Error(`未找到 Agent，agentIds: ${JSON.stringify(props.agentIds)}`);
    }

    if (!agent.stratixConfig) {
      throw new Error(`Agent "${agent.name}" 未配置 stratixConfig`);
    }

    // Load API key from secure storage if missing
    let chatConfig = { ...agent.stratixConfig };
    if (!chatConfig.apiKey && chatConfig.provider) {
      const apiKeyResult = await loadApiKey(chatConfig.provider);
      if (apiKeyResult.success && apiKeyResult.data) {
        chatConfig.apiKey = apiKeyResult.data;
      }
    }

    const response = await fetch('/api/stratix/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backendType: 'stratix',
        config: chatConfig,
        message: messageText,
        systemPrompt: '你是 Stratix Agent（星策代理），一个智能助手，负责帮助用户完成各种任务。请简洁专业地回答问题。',
      }),
    });

    const result = await response.json();

    if (result.code === 200 && result.data?.content) {
      messages.value.push({
        id: `agent-${Date.now()}`,
        agentId: agent.agentId,
        agentName: agent.name || 'Agent',
        content: result.data.content,
        timestamp: new Date(),
      });
    } else {
      throw new Error(result.message || 'Request failed');
    }
  } catch (error) {
    console.error('Failed to send message:', error);
    messages.value.push({
      id: `error-${Date.now()}`,
      agentId: 'system',
      agentName: '系统',
      content: error instanceof Error ? error.message : '发送失败',
      timestamp: new Date(),
    });
  } finally {
    isLoading.value = false;
  }
};

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
};

const handleClose = () => {
  emit('close');
};

watch(() => props.visible, (visible) => {
  if (visible) {
    messages.value = [];
  }
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
    <div class="chat-container">
      <div class="chat-messages">
        <div v-if="messages.length === 0" class="chat-empty">
          开始与 {{ selectedAgents.map(a => a.name).join(', ') }} 聊天
        </div>
        <div
          v-for="msg in messages"
          :key="msg.id"
          class="message"
          :class="{ 'message-user': msg.isUser, 'message-agent': !msg.isUser }"
        >
          <div class="message-avatar">
            {{ msg.isUser ? '👤' : '🤖' }}
          </div>
          <div class="message-content">
            <div class="message-header">
              <span class="message-name">{{ msg.agentName }}</span>
              <span class="message-time">{{ msg.timestamp.toLocaleTimeString() }}</span>
            </div>
            <div class="message-text">{{ msg.content }}</div>
          </div>
        </div>
      </div>
      
      <div class="chat-input">
        <textarea
          v-model="inputText"
          placeholder="输入消息..."
          rows="2"
          :disabled="isLoading"
          @keydown="handleKeyDown"
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
</template>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
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

.message {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
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
