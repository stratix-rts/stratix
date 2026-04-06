<script setup lang="ts">
/**
 * AgentChatPanel.vue - V2 聊天测试面板
 *
 * 基于 V1 AgentChatPanel.ts 重写为 Vue 组件
 * 支持 openclaw 和 stratix 两种后端
 */

import { ref, nextTick, onMounted } from 'vue';
import { StratixButton } from '@/components/ui';
import { unifiedOpenClawConnectionManager } from '@/stratix-core/UnifiedOpenClawConnectionManager';
import { renderMarkdown } from '@/stratix-core/utils/MarkdownRenderer';
import { loadApiKey } from '@/stratix-character-creator/config/providerConfig';
import type { SavedCharacter } from '@/stratix-character-creator/types';
import type { ChatMessage } from '@/stratix-character-creator/types';

// ============================================================================
// Props & Emits
// ============================================================================

interface Props {
  character: SavedCharacter;
  backendType: 'openclaw' | 'stratix';
  stratixConfig?: {
    provider?: string;
    model?: string;
    apiKey?: string;
    endpoint?: string;
  };
  openClawConfig?: {
    endpoint: string;
    accountId: string;
    apiKey?: string;
  };
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'complete'): void;
  (e: 'back'): void;
}>();

// ============================================================================
// State
// ============================================================================

interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const messages = ref<ChatMessageData[]>([]);
const inputValue = ref('');
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);
const isComposing = ref(false);
const messagesContainer = ref<HTMLElement | null>(null);
const chatInput = ref<HTMLTextAreaElement | null>(null);

const SYSTEM_PROMPT = `你是 Stratix Agent（星策代理），一个智能助手，负责帮助用户完成各种任务。

你的核心职责：
- 理解用户需求，提供精准有效的帮助
- 回答问题简洁专业，避免冗余
- 主动思考，提供建设性的建议和方案
- 遇到不确定的问题，诚实告知而非臆测

请始终保持专业、友好、有帮助的态度。`;

// ============================================================================
// Methods
// ============================================================================

function scrollToBottom(): void {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
}

function renderMessageContent(content: string): string {
  return renderMarkdown(content);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function addMessage(message: ChatMessageData): void {
  messages.value.push(message);
  scrollToBottom();
}

function adjustTextareaHeight(): void {
  if (chatInput.value) {
    chatInput.value.style.height = 'auto';
    chatInput.value.style.height = `${Math.min(chatInput.value.scrollHeight, 120)}px`;
  }
}

async function handleSend(): Promise<void> {
  const content = inputValue.value.trim();
  if (!content || isLoading.value) return;

  // Add user message
  const userMessage: ChatMessageData = {
    id: Date.now().toString(),
    role: 'user',
    content,
    timestamp: Date.now(),
  };
  addMessage(userMessage);

  inputValue.value = '';
  adjustTextareaHeight();
  isLoading.value = true;
  errorMessage.value = null;

  // Add loading indicator
  const loadingId = `${Date.now()}-loading`;
  const loadingMessage: ChatMessageData = {
    id: loadingId,
    role: 'assistant',
    content: '思考中...',
    timestamp: Date.now(),
  };
  addMessage(loadingMessage);

  try {
    let responseContent = '';

    if (props.backendType === 'openclaw') {
      if (!unifiedOpenClawConnectionManager.isConnected()) {
        throw new Error('未连接到 OpenClaw');
      }
      const response = await unifiedOpenClawConnectionManager.sendMessage(content);
      responseContent = response?.content || '';
    } else {
      // stratix backend
      const config = props.stratixConfig;
      if (!config?.provider || !config?.model) {
        throw new Error('请先配置 StratixAgent');
      }
      responseContent = await callStratixAgent(config, content);
    }

    // Replace loading message with response
    const loadingIndex = messages.value.findIndex((m) => m.id === loadingId);
    if (loadingIndex !== -1) {
      if (responseContent) {
        messages.value[loadingIndex] = {
          id: loadingId,
          role: 'assistant',
          content: responseContent,
          timestamp: Date.now(),
        };
      } else {
        messages.value.splice(loadingIndex, 1);
        throw new Error('Empty response');
      }
    }
  } catch (error: any) {
    // Remove loading message
    const loadingIndex = messages.value.findIndex((m) => m.id === loadingId);
    if (loadingIndex !== -1) {
      messages.value.splice(loadingIndex, 1);
    }
    errorMessage.value = error.message || '请求失败';
  }

  isLoading.value = false;
  scrollToBottom();
}

async function callStratixAgent(
  config: NonNullable<Props['stratixConfig']>,
  userMessage: string
): Promise<string> {
  // Load API key from secure storage if missing
  const chatConfig = { ...config };
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
      message: userMessage,
      systemPrompt: SYSTEM_PROMPT,
      soul: props.character.soul,
      rules: props.character.rules,
      skillTree: props.character.skillTree,
    }),
  });

  const result = await response.json();
  if (result.code === 200 && result.data) {
    return result.data.content;
  }
  throw new Error(result.message || 'StratixAgent 请求失败');
}

function handleReset(): void {
  messages.value = [];
  errorMessage.value = null;
}

function handleKeydown(event: KeyboardEvent): void {
  // IME composition handling - don't send on Enter during composition
  if (isComposing.value) return;

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
}

function handleCompositionStart(): void {
  isComposing.value = true;
}

function handleCompositionEnd(event: CompositionEvent): void {
  isComposing.value = false;
  // Sync value after IME commit
  if (chatInput.value) {
    chatInput.value.value = (event.target as HTMLTextAreaElement).value;
  }
}

function handleInput(): void {
  adjustTextareaHeight();
}

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(() => {
  scrollToBottom();
});
</script>

<template>
  <div class="agent-chat-panel">
    <!-- Header -->
    <div class="chat-header">
      <div class="header-left">
        <div class="step-label">第三步 STEP 3</div>
        <div class="title">Agent 对话测试</div>
      </div>
      <div class="header-right">
        <div class="character-name">{{ character.name }}</div>
        <div class="character-type">{{ character.bodyType }}</div>
      </div>
    </div>

    <!-- Messages -->
    <div ref="messagesContainer" class="chat-messages">
      <div class="welcome-message">
        已连接到 {{ character.name }} 的 Agent，开始对话测试
      </div>

      <template v-for="msg in messages" :key="msg.id">
        <!-- Loading message -->
        <div v-if="msg.content === '思考中...'" class="message loading">
          <span class="loading-text">思考中...</span>
        </div>

        <!-- Regular message -->
        <div
          v-else
          :class="['message', msg.role]"
        >
          <div class="message-content" v-html="renderMessageContent(msg.content)" />
          <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
        </div>
      </template>

      <!-- Error message -->
      <div v-if="errorMessage" class="message error">
        {{ errorMessage }}
      </div>
    </div>

    <!-- Input Area -->
    <div class="chat-input-area">
      <div class="input-row">
        <textarea
          ref="chatInput"
          v-model="inputValue"
          class="chat-textarea"
          placeholder="输入消息..."
          rows="1"
          @keydown="handleKeydown"
          @compositionstart="handleCompositionStart"
          @compositionend="handleCompositionEnd"
          @input="handleInput"
        />
        <StratixButton
          variant="primary"
          size="sm"
          :disabled="isLoading || !inputValue.trim()"
          @click="handleSend"
        >
          发送
        </StratixButton>
      </div>
    </div>

    <!-- Actions -->
    <div class="chat-actions">
      <div class="actions-left">
        <StratixButton variant="ghost" size="sm" @click="handleReset">
          重置对话
        </StratixButton>
        <StratixButton variant="ghost" size="sm" @click="emit('back')">
          返回
        </StratixButton>
      </div>
      <StratixButton variant="success" size="sm" @click="emit('complete')">
        完成创建
      </StratixButton>
    </div>
  </div>
</template>

<style scoped>
.agent-chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  overflow: hidden;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
}

/* Header */
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--ds-border);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.step-label {
  font-size: 11px;
  color: var(--ds-text-muted);
  letter-spacing: 1px;
}

.title {
  font-size: 14px;
  color: var(--ds-brand-primary);
}

.header-right {
  text-align: right;
}

.character-name {
  font-size: 12px;
  color: var(--ds-text-primary);
}

.character-type {
  font-size: 10px;
  color: var(--ds-text-muted);
}

/* Messages */
.chat-messages {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.welcome-message {
  padding: 12px;
  background: var(--ds-brand-secondary);
  border-radius: 4px;
  font-size: 11px;
  color: var(--ds-brand-primary);
  text-align: center;
}

.message {
  padding: 10px 12px;
  background: var(--ds-bg-tertiary);
  border-radius: 4px;
  max-width: 85%;
  font-size: 12px;
  line-height: 1.5;
}

.message.user {
  align-self: flex-end;
}

.message.assistant {
  align-self: flex-start;
}

.message.loading {
  align-self: flex-start;
}

.loading-text {
  color: var(--ds-text-muted);
}

.message.error {
  background: var(--ds-status-danger);
  color: var(--ds-bg-base);
  font-size: 11px;
  margin-top: 8px;
}

.message-content {
  word-break: break-word;
}

.message-content :deep(p) {
  margin: 0 0 8px 0;
}

.message-content :deep(p:last-child) {
  margin-bottom: 0;
}

.message-content :deep(code) {
  background: rgba(0, 0, 0, 0.2);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
}

.message-content :deep(pre) {
  background: rgba(0, 0, 0, 0.2);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 8px 0;
}

.message-content :deep(pre code) {
  background: none;
  padding: 0;
}

.message-time {
  font-size: 10px;
  color: var(--ds-text-muted);
  margin-top: 4px;
  text-align: right;
}

/* Input Area */
.chat-input-area {
  padding: 16px;
  border-top: 1px solid var(--ds-border);
  flex-shrink: 0;
}

.input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.chat-textarea {
  flex: 1;
  padding: 10px 12px;
  background: var(--ds-bg-base);
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-primary);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  resize: none;
  overflow: hidden;
  min-height: 40px;
  max-height: 120px;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.2s;
}

.chat-textarea:focus {
  border-color: var(--ds-brand-primary);
}

.chat-textarea::placeholder {
  color: var(--ds-text-muted);
}

/* Actions */
.chat-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid var(--ds-border);
  flex-shrink: 0;
}

.actions-left {
  display: flex;
  gap: 8px;
}

/* Scrollbar */
.chat-messages::-webkit-scrollbar {
  width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
  background: var(--ds-bg-base);
}

.chat-messages::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: 3px;
}

.chat-messages::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary);
}
</style>
