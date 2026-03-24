import Phaser from 'phaser';
import { getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';
import { DOMContainer } from '@/stratix-core/ui/DOMContainer';
import { unifiedOpenClawConnectionManager } from '@/stratix-core/UnifiedOpenClawConnectionManager';
import { loadApiKey } from '../config/providerConfig';
import type { ChatMessage, SavedCharacter } from '../types';
import { marked } from 'marked';

const THEME = {
  bg: 'var(--ds-bg-secondary)',
  panelBg: 'var(--ds-bg-secondary)',
  panelBorder: 'var(--ds-border)',
  accent: 'var(--ds-brand-primary)',
  accentDim: 'var(--ds-brand-secondary)',
  text: 'var(--ds-text-primary)',
  textMuted: 'var(--ds-text-muted)',
  success: 'var(--ds-status-success)',
  error: 'var(--ds-status-danger)',
  userBg: 'var(--ds-bg-tertiary)',
  aiBg: 'var(--ds-bg-tertiary)',
};

export interface AgentChatPanelConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  character: SavedCharacter;
  backendType?: 'openclaw' | 'stratix';
  stratixConfig?: any;
  onComplete: () => void;
  onBack: () => void;
}

export class AgentChatPanel {
  private scene: Phaser.Scene;
  private config: AgentChatPanelConfig;
  private container: DOMContainer | null = null;
  private messages: ChatMessage[] = [];
  private systemPrompt: string = '';

  constructor(scene: Phaser.Scene, config: AgentChatPanelConfig) {
    this.scene = scene;
    this.config = config;
    this.buildSystemPrompt();
  }

  private buildSystemPrompt(): void {
    const char = this.config.character;

    this.systemPrompt = `你是 Stratix Agent（星策代理），一个智能助手，负责帮助用户完成各种任务。

你的核心职责：
- 理解用户需求，提供精准有效的帮助
- 回答问题简洁专业，避免冗余
- 主动思考，提供建设性的建议和方案
- 遇到不确定的问题，诚实告知而非臆测

请始终保持专业、友好、有帮助的态度。`;
  }

  create(): Phaser.GameObjects.DOMElement {
    const html = this.generateHTML();

    this.container = new DOMContainer(this.scene, {
      x: this.config.x,
      y: this.config.y,
      width: this.config.width,
      height: this.config.height,
      html: html,
      depth: Depth.UI_MODAL_CONTENT
    });

    const element = this.container.open();
    this.setupEventListeners();

    return element;
  }

  private generateHTML(): string {
    const char = this.config.character;

    return `
      <div class="agent-chat" style="
        width: ${this.config.width}px;
        height: ${this.config.height}px;
        background: ${THEME.panelBg};
        border: 1px solid ${THEME.panelBorder};
        border-radius: 4px;
        overflow: hidden;
        font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
        color: ${THEME.text};
        display: flex;
        flex-direction: column;
      ">
        <div class="header" style="
          padding: 16px;
          border-bottom: 1px solid ${THEME.panelBorder};
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <div>
            <div style="font-size: 11px; color: ${THEME.textMuted}; letter-spacing: 1px; margin-bottom: 4px;">第三步 STEP 3</div>
            <div style="font-size: 14px; color: ${THEME.accent};">Agent 对话测试</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 12px; color: ${THEME.text};">${char.name}</div>
            <div style="font-size: 10px; color: ${THEME.textMuted};">${char.bodyType}</div>
          </div>
        </div>

        <div id="chat-messages" style="
          flex: 1;
          padding: 16px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        ">
          <div class="welcome-message" style="
            padding: 12px;
            background: ${THEME.accentDim};
            border-radius: 4px;
            font-size: 11px;
            color: ${THEME.accent};
            text-align: center;
          ">
            已连接到 ${char.name} 的 Agent，开始对话测试
          </div>
        </div>

        <div class="input-area" style="
          padding: 16px;
          border-top: 1px solid ${THEME.panelBorder};
        ">
          <div style="display: flex; gap: 8px; align-items: flex-end;">
            <textarea id="chat-input" rows="1" placeholder="输入消息..." style="
              flex: 1;
              padding: 10px 12px;
              background: ${THEME.bg};
              border: 1px solid ${THEME.panelBorder};
              border-radius: 4px;
              color: ${THEME.text};
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
            "></textarea>
            <button id="send-btn" style="
              padding: 10px 16px;
              background: ${THEME.accent};
              border: none;
              border-radius: 4px;
              color: ${THEME.bg};
              font-family: inherit;
              font-size: 12px;
              cursor: pointer;
              flex-shrink: 0;
            ">发送</button>
          </div>
        </div>

        <div class="actions" style="
          padding: 12px 16px;
          border-top: 1px solid ${THEME.panelBorder};
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <div style="display: flex; gap: 8px;">
            <button id="reset-btn" style="
              padding: 8px 12px;
              background: transparent;
              border: 1px solid ${THEME.panelBorder};
              border-radius: 4px;
              color: ${THEME.textMuted};
              font-family: inherit;
              font-size: 11px;
              cursor: pointer;
            ">重置对话</button>
            <button id="back-btn" style="
              padding: 8px 12px;
              background: transparent;
              border: 1px solid ${THEME.panelBorder};
              border-radius: 4px;
              color: ${THEME.textMuted};
              font-family: inherit;
              font-size: 11px;
              cursor: pointer;
            ">返回</button>
          </div>
          <button id="complete-btn" style="
            padding: 8px 16px;
            background: ${THEME.success};
            border: none;
            border-radius: 4px;
            color: ${THEME.bg};
            font-family: inherit;
            font-size: 11px;
            cursor: pointer;
          ">完成创建</button>
        </div>
      </div>
    `;
  }

  private setupEventListeners(): void {
    const node = this.container?.getNode();
    if (!node) return;

    const chatInput = node.querySelector('#chat-input') as HTMLTextAreaElement;
    const sendBtn = node.querySelector('#send-btn') as HTMLButtonElement;
    const messagesContainer = node.querySelector('#chat-messages') as HTMLElement;
    const resetBtn = node.querySelector('#reset-btn') as HTMLButtonElement;
    const backBtn = node.querySelector('#back-btn') as HTMLButtonElement;
    const completeBtn = node.querySelector('#complete-btn') as HTMLButtonElement;

    const sendMessage = async () => {
      const content = chatInput.value.trim();
      if (!content) return;

      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content,
        timestamp: Date.now()
      };
      this.messages.push(userMessage);

      this.renderMessage(messagesContainer, userMessage);
      chatInput.value = '';
      this.adjustTextareaHeight(chatInput);

      sendBtn.disabled = true;
      chatInput.disabled = true;
      sendBtn.textContent = '...';

      const loadingId = this.renderLoadingMessage(messagesContainer);

      try {
        let responseContent = '';

        const backendType = this.config.backendType || this.config.character?.backendType || 'stratix';

        if (backendType === 'openclaw') {
          if (!unifiedOpenClawConnectionManager.isConnected()) {
            throw new Error('未连接到 OpenClaw');
          }
          const response = await unifiedOpenClawConnectionManager.sendMessage(content);
          responseContent = response?.content || '';
        } else if (backendType === 'stratix') {
          const config = this.config.stratixConfig || this.config.character?.stratixConfig;
          if (!config?.provider || !config?.model) {
            throw new Error('请先配置 StratixAgent');
          }
          const response = await this.callStratixAgent(config, content);
          responseContent = response;
        }

        this.removeLoadingMessage(loadingId);

        if (responseContent) {
          const aiMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: responseContent,
            timestamp: Date.now()
          };
          this.messages.push(aiMessage);
          this.renderMessage(messagesContainer, aiMessage);
        } else {
          this.removeLoadingMessage(loadingId);
          this.renderError(messagesContainer, 'Empty response');
        }
      } catch (error: any) {
        this.removeLoadingMessage(loadingId);
        this.renderError(messagesContainer, error.message || 'Request failed');
      }

      sendBtn.disabled = false;
      chatInput.disabled = false;
      sendBtn.textContent = '发送';
      chatInput.focus();
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    sendBtn?.addEventListener('click', sendMessage);

    chatInput?.addEventListener('input', () => {
      this.adjustTextareaHeight(chatInput);
    });

    chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !sendBtn.disabled) {
        e.preventDefault();
        sendMessage();
      }
    });

    resetBtn?.addEventListener('click', () => {
      this.messages = [];
      messagesContainer.innerHTML = `
        <div class="welcome-message" style="
          padding: 12px;
          background: ${THEME.accentDim};
          border-radius: 4px;
          font-size: 11px;
          color: ${THEME.accent};
          text-align: center;
        ">
          对话已重置，开始新的测试
        </div>
      `;
    });

    backBtn?.addEventListener('click', () => {
      this.config.onBack();
    });

    completeBtn?.addEventListener('click', () => {
      this.config.onComplete();
    });
  }

  private renderMessage(container: HTMLElement, message: ChatMessage): void {
    const isUser = message.role === 'user';
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isUser ? 'user' : 'ai'}`;
    msgDiv.style.cssText = `
      padding: 10px 12px;
      background: ${isUser ? THEME.userBg : THEME.aiBg};
      border-radius: 4px;
      max-width: 85%;
      align-self: ${isUser ? 'flex-end' : 'flex-start'};
      font-size: 12px;
      line-height: 1.5;
    `;

    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = marked.parse(message.content, { async: false }) as string;
    msgDiv.appendChild(contentDiv);

    const timeDiv = document.createElement('div');
    timeDiv.style.cssText = `
      font-size: 10px;
      color: ${THEME.textMuted};
      margin-top: 4px;
      text-align: right;
    `;
    timeDiv.textContent = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    msgDiv.appendChild(timeDiv);

    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
  }

  private renderLoadingMessage(container: HTMLElement): string {
    const id = `loading-${Date.now()}`;
    const msgDiv = document.createElement('div');
    msgDiv.id = id;
    msgDiv.style.cssText = `
      padding: 10px 12px;
      background: ${THEME.aiBg};
      border-radius: 4px;
      max-width: 85%;
      align-self: flex-start;
      font-size: 12px;
      line-height: 1.5;
      margin-top: 8px;
    `;
    msgDiv.innerHTML = '<span style="color: ' + THEME.textMuted + ';">思考中...</span>';
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return id;
  }

  private removeLoadingMessage(id: string): void {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  private renderError(container: HTMLElement, message: string): void {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      padding: 10px 12px;
      background: ${THEME.error};
      border-radius: 4px;
      color: ${THEME.bg};
      font-size: 11px;
      margin-top: 8px;
    `;
    errorDiv.textContent = message;
    container.appendChild(errorDiv);
    container.scrollTop = container.scrollHeight;
  }

  private adjustTextareaHeight(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }

  private async callStratixAgent(config: any, userMessage: string): Promise<string> {
    // Load API key from secure storage if missing
    let chatConfig = { ...config };
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
        systemPrompt: this.systemPrompt
      })
    });
    const result = await response.json();
    if (result.code === 200 && result.data) {
      return result.data.content;
    }
    throw new Error(result.message || 'StratixAgent 请求失败');
  }

  destroy(): void {
    this.container?.destroy();
    this.container = null;
  }
}
