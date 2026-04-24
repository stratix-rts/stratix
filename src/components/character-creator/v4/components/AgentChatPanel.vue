<script setup lang="ts">
/**
 * AgentChatPanel.vue — Agent 对话测试面板 (V4)
 *
 * 对照 V3 AgentChatPanel.vue，全面升级至 ds-token 美学体系。
 * 支持双后端（OpenClaw / Stratix）实时对话测试。
 *
 * Props:
 *   visible: boolean
 *   agentConfig: { backendType, openClawConfig?, stratixConfig?, soul?, rules? }
 *   characterName?: string
 *
 * Emits:
 *   complete: []
 *   back: []
 *
 * 美学约束: A1-A8，全部使用 var(--ds-*) tokens
 */

import { ref, nextTick, onMounted } from 'vue';
import { StratixButton } from '@/components/ui';
import { unifiedOpenClawConnectionManager } from '@/stratix-core/UnifiedOpenClawConnectionManager';
import { renderMarkdown } from '@/stratix-core/utils/MarkdownRenderer';
import { loadApiKey } from '@/stratix-character-creator/config/providerConfig';
import type { ChatMessage } from '@/stratix-character-creator/types';

// =============================================================================
// Types
// =============================================================================

interface AgentConfig {
  backendType: string;
  openClawConfig?: {
    endpoint: string;
    accountId: string;
    apiKey?: string;
  };
  stratixConfig?: {
    provider?: string;
    model?: string;
    apiKey?: string;
    endpoint?: string;
  };
  soul?: {
    identity: string;
    goals: string[];
    personality: string;
  };
  rules?: string[];
}

// =============================================================================
// Props & Emits
// =============================================================================

const props = defineProps<{
  visible: boolean;
  agentConfig: AgentConfig;
  characterName?: string;
}>();

const emit = defineEmits<{
  complete: [];
  back: [];
}>();

// =============================================================================
// State
// =============================================================================

const messages = ref<ChatMessage[]>([]);
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

// =============================================================================
// Methods
// =============================================================================

function scrollToBottom(): void {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function addMessage(message: ChatMessage): void {
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

  const userMessage: ChatMessage = {
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

  const loadingId = `${Date.now()}-loading`;
  const loadingMessage: ChatMessage = {
    id: loadingId,
    role: 'assistant',
    content: '思考中...',
    timestamp: Date.now(),
  };
  addMessage(loadingMessage);

  try {
    let responseContent = '';

    if (props.agentConfig.backendType === 'openclaw') {
      if (!unifiedOpenClawConnectionManager.isConnected()) {
        throw new Error('未连接到 OpenClaw');
      }
      const response = await unifiedOpenClawConnectionManager.sendMessage(content);
      responseContent = response?.content || '';
    } else {
      const config = props.agentConfig.stratixConfig;
      if (!config?.provider || !config?.model) {
        throw new Error('请先配置 StratixAgent');
      }
      responseContent = await callStratixAgent(config, content);
    }

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
  } catch (error: unknown) {
    const loadingIndex = messages.value.findIndex((m) => m.id === loadingId);
    if (loadingIndex !== -1) {
      messages.value.splice(loadingIndex, 1);
    }
    errorMessage.value = error instanceof Error ? error.message : '请求失败';
  }

  isLoading.value = false;
  scrollToBottom();
}

async function callStratixAgent(
  config: NonNullable<AgentConfig['stratixConfig']>,
  userMessage: string,
): Promise<string> {
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
      soul: props.agentConfig.soul,
      rules: props.agentConfig.rules,
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
  if (chatInput.value) {
    chatInput.value.value = (event.target as HTMLTextAreaElement).value;
  }
}

function handleInput(): void {
  adjustTextareaHeight();
}

// =============================================================================
// Lifecycle
// =============================================================================

onMounted(() => {
  scrollToBottom();
});
</script>

<template>
  <div class="acp">
    <!-- Header -->
    <header class="acp-header">
      <div class="acp-header__left">
        <span class="acp-header__step">STEP 3 · 第三步</span>
        <h2 class="acp-header__title">Agent 对话测试</h2>
      </div>
      <div class="acp-header__right">
        <span class="acp-header__name">{{ characterName || '新角色' }}</span>
        <span class="acp-header__type">AI Agent</span>
      </div>
    </header>

    <!-- Messages -->
    <div ref="messagesContainer" class="acp-messages">
      <div class="acp-welcome">
        已连接到 {{ characterName || '新角色' }} 的 Agent，开始对话测试
      </div>

      <template v-for="msg in messages" :key="msg.id">
        <!-- Loading indicator -->
        <div v-if="msg.content === '思考中...'" class="acp-bubble acp-bubble--loading">
          <span class="acp-bubble__loading-text">思考中…</span>
        </div>

        <!-- Regular message -->
        <div
          v-else
          :class="['acp-bubble', `acp-bubble--${msg.role}`]"
        >
          <div
            class="acp-bubble__content"
            v-html="renderMarkdown(msg.content)"
          />
          <time class="acp-bubble__time">{{ formatTime(msg.timestamp) }}</time>
        </div>
      </template>

      <!-- Error -->
      <div v-if="errorMessage" class="acp-bubble acp-bubble--error">
        {{ errorMessage }}
      </div>
    </div>

    <!-- Input -->
    <div class="acp-input">
      <div class="acp-input__row">
        <textarea
          ref="chatInput"
          v-model="inputValue"
          class="acp-input__textarea"
          placeholder="输入消息…"
          rows="1"
          :disabled="isLoading"
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
    <div class="acp-actions">
      <div class="acp-actions__left">
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
/* ==========================================================================
   Root — A1 spacing, A2 flex-col, A3 ds-tokens, A4 full-height
========================================================================== */
.acp {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md, 4px);
  overflow: hidden;
}

/* ==========================================================================
   Header — A2 space-between, A5 visual hierarchy
========================================================================== */
.acp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--ds-spacing-md, 12px) var(--ds-spacing-lg, 16px);
  border-bottom: 1px solid var(--ds-border);
  flex-shrink: 0;
}

.acp-header__left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.acp-header__step {
  font-size: var(--ds-typography-fontSize-xs, 10px);
  color: var(--ds-text-muted);
  letter-spacing: 1px;
}

.acp-header__title {
  font-size: var(--ds-typography-fontSize-md, 14px);
  font-weight: var(--ds-typography-fontWeight-semibold, 600);
  color: var(--ds-color-primary);
  margin: 0;
}

.acp-header__right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.acp-header__name {
  font-size: var(--ds-typography-fontSize-sm, 12px);
  color: var(--ds-text-primary);
}

.acp-header__type {
  font-size: var(--ds-typography-fontSize-xs, 10px);
  color: var(--ds-text-muted);
}

/* ==========================================================================
   Messages — A1 padding, A7 line-height ≥ 1.5×
========================================================================== */
.acp-messages {
  flex: 1;
  padding: var(--ds-spacing-lg, 16px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-md, 12px);
}

.acp-welcome {
  padding: var(--ds-spacing-md, 12px);
  background: var(--ds-bg-tertiary);
  border-radius: var(--ds-radius-md, 4px);
  font-size: var(--ds-typography-fontSize-xs, 10px);
  color: var(--ds-color-primary);
  text-align: center;
}

/* ==========================================================================
   Bubble — A3 ds-tokens, A4 max-width 85%, A7 line-height
========================================================================== */
.acp-bubble {
  padding: var(--ds-spacing-xs, 8px) var(--ds-spacing-md, 12px);
  background: var(--ds-bg-tertiary);
  border-radius: var(--ds-radius-md, 4px);
  max-width: 85%;
  font-size: var(--ds-typography-fontSize-sm, 12px);
  line-height: 1.6;
}

.acp-bubble--user {
  align-self: flex-end;
}

.acp-bubble--assistant {
  align-self: flex-start;
}

.acp-bubble--loading {
  align-self: flex-start;
}

.acp-bubble--error {
  background: var(--ds-status-danger);
  color: var(--ds-bg-base);
  font-size: var(--ds-typography-fontSize-xs, 10px);
  align-self: center;
}

.acp-bubble__loading-text {
  color: var(--ds-text-muted);
}

.acp-bubble__content {
  word-break: break-word;
}

.acp-bubble__content :deep(p) {
  margin: 0 0 var(--ds-spacing-xs, 8px) 0;
}

.acp-bubble__content :deep(p:last-child) {
  margin-bottom: 0;
}

.acp-bubble__content :deep(code) {
  background: var(--ds-bg-overlay);
  padding: 2px 6px;
  border-radius: var(--ds-radius-sm, 2px);
  font-size: var(--ds-typography-fontSize-xs, 10px);
}

.acp-bubble__content :deep(pre) {
  background: var(--ds-bg-overlay);
  padding: var(--ds-spacing-xs, 8px);
  border-radius: var(--ds-radius-md, 4px);
  overflow-x: auto;
  margin: var(--ds-spacing-xs, 8px) 0;
}

.acp-bubble__content :deep(pre code) {
  background: none;
  padding: 0;
}

.acp-bubble__time {
  display: block;
  font-size: var(--ds-typography-fontSize-xs, 10px);
  color: var(--ds-text-muted);
  margin-top: 4px;
  text-align: right;
}

/* ==========================================================================
   Input — A2 flex, A1 padding
========================================================================== */
.acp-input {
  padding: var(--ds-spacing-lg, 16px);
  border-top: 1px solid var(--ds-border);
  flex-shrink: 0;
}

.acp-input__row {
  display: flex;
  gap: var(--ds-spacing-xs, 8px);
  align-items: flex-end;
}

.acp-input__textarea {
  flex: 1;
  padding: var(--ds-spacing-xs, 8px) var(--ds-spacing-md, 12px);
  background: var(--ds-bg-base);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md, 4px);
  color: var(--ds-text-primary);
  font-family: inherit;
  font-size: var(--ds-typography-fontSize-sm, 12px);
  line-height: 1.5;
  resize: none;
  overflow: hidden;
  min-height: 40px;
  max-height: 120px;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s ease;
}

.acp-input__textarea:focus {
  border-color: var(--ds-color-primary);
}

.acp-input__textarea::placeholder {
  color: var(--ds-text-muted);
}

/* ==========================================================================
   Actions — A2 space-between, A1 padding
========================================================================== */
.acp-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--ds-spacing-md, 12px) var(--ds-spacing-lg, 16px);
  border-top: 1px solid var(--ds-border);
  flex-shrink: 0;
}

.acp-actions__left {
  display: flex;
  gap: var(--ds-spacing-xs, 8px);
}

/* ==========================================================================
   Scrollbar — minimal style
========================================================================== */
.acp-messages::-webkit-scrollbar {
  width: 6px;
}

.acp-messages::-webkit-scrollbar-track {
  background: var(--ds-bg-base);
}

.acp-messages::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: 3px;
}

.acp-messages::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary);
}
</style>
