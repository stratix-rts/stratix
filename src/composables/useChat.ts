import { ref, type Ref, isRef } from 'vue';
import { loadApiKey } from '@/stratix-character-creator/config/providerConfig';
import { renderMarkdown } from '@/stratix-core/utils/MarkdownRenderer';

export type MessageStatus = 'pending' | 'confirmed' | 'failed';

export interface SkillExecution {
  id: string;
  skillId: string;
  skillName: string;
  status: 'pending' | 'success' | 'error';
  result?: any;
  error?: string;
  executionTime: number;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ChatMessage {
  id: string;
  agentId: string;
  agentName: string;
  content: string;
  timestamp: Date;
  isUser?: boolean;
  status: MessageStatus;
  retryCount?: number;
  error?: string;
  skillExecutions?: SkillExecution[];
}

export interface UseChatOptions {
  agentId: string;
  backendType: 'stratix' | 'openclaw';
  config: any;
  systemPrompt?: string;
  persistMessages?: boolean;
  maxHistory?: number;
  agentName?: string;
  useToolUse?: Ref<boolean> | boolean;
  onMessageRender?: (msg: ChatMessage, isNew: boolean) => void;
  onSkillExecuting?: (skillId: string, skillName: string) => void;
}

export interface UseChatReturn {
  messages: Ref<ChatMessage[]>;
  isLoading: Ref<boolean>;
  isLoadingHistory: Ref<boolean>;
  isComposing: Ref<boolean>;
  hasMoreHistory: Ref<boolean>;
  inputText: Ref<string>;
  sendMessage: (content?: string, retryMessageId?: string) => Promise<void>;
  loadHistory: (append?: boolean) => Promise<void>;
  retryMessage: (msgId: string) => Promise<void>;
  clearHistory: () => void;
  handleKeyDown: (e: KeyboardEvent) => void;
  handleCompositionStart: () => void;
  handleCompositionEnd: (e: CompositionEvent) => void;
}

const MAX_RETRIES = 2;

export function useChat(options: UseChatOptions): UseChatReturn {
  const {
    agentId,
    backendType,
    config,
    systemPrompt = '你是 Stratix Agent（星策代理），一个智能助手，负责帮助用户完成各种任务。请简洁专业地回答问题。',
    persistMessages = true,
    maxHistory = 20,
    agentName = 'Agent',
    useToolUse = false,
    onMessageRender,
    onSkillExecuting
  } = options;

  const messages = ref<ChatMessage[]>([]);
  const loadedMessageIds = ref(new Set<string>());
  const inputText = ref('');
  const isLoading = ref(false);
  const isLoadingHistory = ref(false);
  const isComposing = ref(false);
  const hasMoreHistory = ref(false);
  const historyOffset = ref(0);

  const updateMessageStatus = (id: string, status: MessageStatus, newId?: string) => {
    const msg = messages.value.find(m => m.id === id);
    if (msg) {
      msg.status = status;
      if (newId && newId !== id) {
        loadedMessageIds.value.delete(id);
        loadedMessageIds.value.add(newId);
        msg.id = newId;
      }
    }
  };

  const loadHistory = async (append = false) => {
    if (!agentId) return;
    if (isLoadingHistory.value) return;

    isLoadingHistory.value = true;
    isLoading.value = true;
    try {
      const limit = maxHistory;
      const offset = append ? historyOffset.value : 0;
      const response = await fetch(`/api/stratix/agent/${agentId}/messages?limit=${limit}&offset=${offset}`);
      const result = await response.json();

      if (result.code === 200 && result.data.messages) {
        const msgs = result.data.messages;

        if (!append) {
          messages.value = [];
          loadedMessageIds.value.clear();
        }

        for (const msg of msgs) {
          if (loadedMessageIds.value.has(msg.messageId)) continue;
          loadedMessageIds.value.add(msg.messageId);

          const chatMsg: ChatMessage = {
            id: msg.messageId,
            agentId: msg.agentId,
            agentName: msg.role === 'user' ? '你' : agentName,
            content: renderMarkdown(msg.content),
            timestamp: new Date(msg.timestamp),
            isUser: msg.role === 'user',
            status: 'confirmed'
          };

          messages.value.push(chatMsg);
          onMessageRender?.(chatMsg, false);
        }

        hasMoreHistory.value = msgs.length === limit;
        historyOffset.value = append ? offset + msgs.length : msgs.length;
      }
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      isLoading.value = false;
      isLoadingHistory.value = false;
    }
  };

  const sendMessage = async (content?: string, retryMessageId?: string) => {
    let messageText: string;
    let userMessage: ChatMessage | undefined;

    if (retryMessageId) {
      const retryMsg = messages.value.find(m => m.id === retryMessageId);
      if (!retryMsg) return;
      messageText = retryMsg.content;
      userMessage = retryMsg;
      updateMessageStatus(retryMessageId, 'pending');
    } else {
      messageText = content || inputText.value.trim();
      if (!messageText) return;

      userMessage = {
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        agentId: 'user',
        agentName: '你',
        content: messageText,
        timestamp: new Date(),
        isUser: true,
        status: 'pending',
        retryCount: 0
      };

      messages.value.push(userMessage);
      onMessageRender?.(userMessage, true);
      inputText.value = '';
    }

    isLoading.value = true;

    try {
      let chatConfig = { ...config };
      if (!chatConfig.apiKey && chatConfig.provider) {
        const apiKeyResult = await loadApiKey(chatConfig.provider);
        if (apiKeyResult.success && apiKeyResult.data) {
          chatConfig.apiKey = apiKeyResult.data;
        }
      }

      const timestamp = Date.now();

      // 1. 保存用户消息到后端
      if (persistMessages) {
        const saveResponse = await fetch(`/api/stratix/agent/${agentId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'user',
            content: messageText,
            timestamp
          })
        });

        if (!saveResponse.ok) throw new Error('保存消息失败');
        const saveResult = await saveResponse.json();
        if (saveResult.code !== 200) throw new Error(saveResult.message || '保存消息失败');

        if (userMessage && saveResult.data?.messageId) {
          updateMessageStatus(userMessage.id, 'confirmed', saveResult.data.messageId);
        }
      } else {
        updateMessageStatus(userMessage.id, 'confirmed', userMessage.id);
      }

      // 2. 构建 history context
      const history = messages.value
        .filter(m => m.status === 'confirmed' && m.id !== userMessage?.id)
        .map(m => ({
          role: m.isUser ? 'user' : 'assistant',
          content: m.content.replace(/<[^>]*>/g, '')
        }));

      // 3. 调用 chat API
      // useToolUse 可以是 Ref 或 boolean，需要在调用时解析
      const toolUseEnabled = isRef(useToolUse) ? useToolUse.value : useToolUse;
      const response = await fetch('/api/stratix/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backendType,
          config: chatConfig,
          message: messageText,
          systemPrompt,
          history,
          useToolUse: toolUseEnabled
        }),
      });

      const result = await response.json();

      if (result.code === 200 && result.data?.content) {
        // 处理技能执行状态
        const skillExecutions: SkillExecution[] = [];
        if (result.data.skillExecutions && result.data.skillExecutions.length > 0) {
          for (const se of result.data.skillExecutions) {
            const execution: SkillExecution = {
              id: se.id || `skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              skillId: se.skillId,
              skillName: se.skillId,
              status: se.error ? 'error' : 'success',
              result: se.result,
              error: se.error,
              executionTime: se.executionTime || 0,
              completedAt: new Date()
            };
            skillExecutions.push(execution);
          }
        }

        // 保存 AI 回复到后端
        let aiMessageId = `agent-${Date.now()}`;

        if (persistMessages) {
          const aiSaveResponse = await fetch(`/api/stratix/agent/${agentId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              role: 'assistant',
              content: result.data.content,
              timestamp: Date.now()
            })
          });

          const aiSaveResult = await aiSaveResponse.json();
          aiMessageId = aiSaveResult.data?.messageId || aiMessageId;
        }

        const aiMessage: ChatMessage = {
          id: aiMessageId,
          agentId: agentId,
          agentName: agentName,
          content: renderMarkdown(result.data.content),
          timestamp: new Date(),
          isUser: false,
          status: 'confirmed',
          skillExecutions: skillExecutions.length > 0 ? skillExecutions : undefined
        };

        messages.value.push(aiMessage);
        onMessageRender?.(aiMessage, true);
      } else {
        throw new Error(result.message || 'Request failed');
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      if (userMessage) {
        userMessage.retryCount = (userMessage.retryCount || 0) + 1;
        userMessage.error = error instanceof Error ? error.message : '发送失败';
        updateMessageStatus(userMessage.id, 'failed');
      }
    } finally {
      isLoading.value = false;
    }
  };

  const retryMessage = async (msgId: string) => {
    const msg = messages.value.find(m => m.id === msgId);
    if (msg && msg.status === 'failed' && (msg.retryCount || 0) < MAX_RETRIES) {
      await sendMessage(undefined, msgId);
    }
  };

  const clearHistory = () => {
    messages.value = [];
    loadedMessageIds.value.clear();
    hasMoreHistory.value = false;
    historyOffset.value = 0;
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isComposing.value) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleCompositionStart = () => {
    isComposing.value = true;
  };

  const handleCompositionEnd = (e: CompositionEvent) => {
    isComposing.value = false;
    inputText.value = (e.target as HTMLTextAreaElement).value;
  };

  return {
    messages,
    isLoading,
    isLoadingHistory,
    isComposing,
    hasMoreHistory,
    inputText,
    sendMessage,
    loadHistory,
    retryMessage,
    clearHistory,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd
  };
}

export default useChat;
