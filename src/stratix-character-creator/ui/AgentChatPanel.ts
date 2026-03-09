import Phaser from 'phaser';
import { getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';
import { unifiedOpenClawConnectionManager } from '@/stratix-core/UnifiedOpenClawConnectionManager';
import type { ChatMessage, SavedCharacter } from '../types';
import { marked } from 'marked';

const THEME = {
  bg: getToken('colors.background.secondary'),
  panelBg: getToken('colors.background.secondary'),
  panelBorder: getToken('colors.border.default'),
  accent: getToken('colors.primary'),
  accentDim: getToken('colors.secondary'),
  text: getToken('colors.text.primary'),
  textMuted: getToken('colors.text.muted'),
  success: getToken('colors.semantic.success'),
  error: getToken('colors.semantic.danger'),
  userBg: getToken('colors.background.tertiary'),
  aiBg: getToken('colors.background.tertiary'),
};

export interface AgentChatPanelConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  character: SavedCharacter;
  onComplete: () => void;
  onBack: () => void;
}

export class AgentChatPanel {
  private scene: Phaser.Scene;
  private config: AgentChatPanelConfig;
  private container: Phaser.GameObjects.DOMElement | null = null;
  private messages: ChatMessage[] = [];
  private systemPrompt: string = '';

  constructor(scene: Phaser.Scene, config: AgentChatPanelConfig) {
    this.scene = scene;
    this.config = config;
    this.buildSystemPrompt();
  }

  private buildSystemPrompt(): void {
    const char = this.config.character;
    const parts = Object.entries(char.parts)
      .map(([category, selection]) => `${category}: ${selection.itemId}`)
      .join(', ');
    
    this.systemPrompt = `你是游戏中的一个角色，名叫"${char.name}"。

角色信息：
- 体型: ${char.bodyType}
- 装备配置: ${parts}

请以这个角色的身份与玩家对话。保持角色一致性，用符合角色身份的语气和方式回应。
回答要简洁有性格，不要过度解释自己是AI。`;
  }

  create(): Phaser.GameObjects.DOMElement {
    const html = this.generateHTML();
    this.container = this.scene.add.dom(
      this.config.x,
      this.config.y
    ).createFromHTML(html).setOrigin(0, 0);

    this.setupEventListeners();
    return this.container;
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
        
        <div class="footer" style="
          padding: 12px 16px;
          border-top: 1px solid ${THEME.panelBorder};
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <button id="reset-btn" style="
            padding: 8px 16px;
            background: transparent;
            border: 1px solid ${THEME.panelBorder};
            border-radius: 4px;
            color: ${THEME.textMuted};
            font-family: inherit;
            font-size: 11px;
            cursor: pointer;
          ">重置对话</button>
          <div style="display: flex; gap: 8px;">
            <button id="back-btn" style="
              padding: 10px 20px;
              background: transparent;
              border: 1px solid ${THEME.panelBorder};
              border-radius: 4px;
              color: ${THEME.textMuted};
              font-family: inherit;
              font-size: 12px;
              cursor: pointer;
            ">← 返回</button>
            <button id="complete-btn" style="
              padding: 10px 24px;
              background: ${THEME.success};
              border: none;
              border-radius: 4px;
              color: ${THEME.bg};
              font-family: inherit;
              font-size: 12px;
              cursor: pointer;
            ">完成创建 ✓</button>
          </div>
        </div>
      </div>
    `;
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;

    const chatInput = node.querySelector('#chat-input') as HTMLTextAreaElement;
    const sendBtn = node.querySelector('#send-btn') as HTMLButtonElement;
    const resetBtn = node.querySelector('#reset-btn') as HTMLButtonElement;
    const backBtn = node.querySelector('#back-btn') as HTMLButtonElement;
    const completeBtn = node.querySelector('#complete-btn') as HTMLButtonElement;
    const messagesContainer = node.querySelector('#chat-messages') as HTMLElement;

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
      this.resetTextareaHeight(chatInput);

      // 禁用输入
      sendBtn.disabled = true;
      chatInput.disabled = true;
      sendBtn.textContent = '...';

      // 立即显示 AI 回复占位符（带动画）
      const loadingId = `loading-${Date.now()}`;
      this.renderLoadingMessage(messagesContainer, loadingId);

      try {
        // 尝试使用流式 API
        const conn = unifiedOpenClawConnectionManager.getConnection();
        let accumulatedText = '';
        
        if (conn && typeof conn.sendMessage === 'function') {
          // 流式发送
          await conn.sendMessage(content, {
            onDelta: (text: string) => {
              accumulatedText = text;
              this.updateLoadingMessage(loadingId, text);
            },
            onFinal: (msg: { content: string; role: string; timestamp: number }) => {
              this.finalizeLoadingMessage(loadingId, msg.content);
            },
            onError: (err: string) => {
              console.error('[AgentChat] Stream error:', err);
            }
          }, { sessionId: 'main' });
          
          // 如果有累积的文本，添加到消息列表
          if (accumulatedText) {
            const aiMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: accumulatedText,
              timestamp: Date.now()
            };
            this.messages.push(aiMessage);
          }
        } else {
          // 降级：使用非流式 API
          const response = await unifiedOpenClawConnectionManager.sendMessage(content);

          if (response.content) {
            this.updateLoadingMessage(loadingId, response.content);
            this.finalizeLoadingMessage(loadingId, response.content);
            
            const aiMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: response.content,
              timestamp: Date.now()
            };
            this.messages.push(aiMessage);
          } else {
            this.removeLoadingMessage(loadingId);
            this.renderError(messagesContainer, 'Empty response');
          }
        }
      } catch (error: any) {
        this.removeLoadingMessage(loadingId);
        this.renderError(messagesContainer, error.message || 'Request failed');
      }

      // 恢复输入
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

  /**
   * 渲染加载中的消息（带动画）
   */
  private renderLoadingMessage(container: HTMLElement, id: string): void {
    const msgDiv = document.createElement('div');
    msgDiv.id = id;
    msgDiv.className = 'ai-message-loading';
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
    msgDiv.innerHTML = `
      <div style="font-size: 10px; color: ${THEME.textMuted}; margin-bottom: 4px;">
        ${this.config.character.name}
      </div>
      <div class="loading-content" style="min-height: 20px; color: ${THEME.text};">
        <span class="typing-indicator" style="display: inline-flex; gap: 4px;">
          <span style="width: 6px; height: 6px; background: ${THEME.accent}; border-radius: 50%; animation: blink 1.4s infinite 0s; opacity: 0.3;"></span>
          <span style="width: 6px; height: 6px; background: ${THEME.accent}; border-radius: 50%; animation: blink 1.4s infinite 0.2s; opacity: 0.3;"></span>
          <span style="width: 6px; height: 6px; background: ${THEME.accent}; border-radius: 50%; animation: blink 1.4s infinite 0.4s; opacity: 0.3;"></span>
        </span>
      </div>
    `;
    
    // 添加动画样式（只添加一次）
    if (!document.getElementById('typing-animation-style')) {
      const style = document.createElement('style');
      style.id = 'typing-animation-style';
      style.textContent = `
        @keyframes blink {
          0%, 60%, 100% { opacity: 0.3; }
          30% { opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
    
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
  }

  /**
   * 更新加载中的消息内容（流式更新）
   */
  private updateLoadingMessage(id: string, text: string): void {
    const msgDiv = document.getElementById(id);
    if (!msgDiv) return;

    const contentDiv = msgDiv.querySelector('.loading-content') as HTMLElement;
    if (contentDiv) {
      // 流式更新时也渲染 Markdown
      contentDiv.innerHTML = `<div class="markdown-content">${this.renderMarkdown(text)}</div>`;
    }
    
    // 滚动到底部
    const container = msgDiv.parentElement;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  /**
   * 完成加载中的消息
   */
  private finalizeLoadingMessage(id: string, text: string): void {
    const msgDiv = document.getElementById(id);
    if (!msgDiv) return;

    msgDiv.classList.remove('ai-message-loading');
    msgDiv.classList.add('ai-message');
    
    const contentDiv = msgDiv.querySelector('.loading-content') as HTMLElement;
    if (contentDiv) {
      contentDiv.innerHTML = `<div class="markdown-content">${this.renderMarkdown(text)}</div>`;
    }
  }

  /**
   * 移除加载中的消息
   */
  private removeLoadingMessage(id: string): void {
    const msgDiv = document.getElementById(id);
    if (msgDiv) {
      msgDiv.remove();
    }
  }

  private renderMessage(container: HTMLElement, message: ChatMessage): void {
    const isUser = message.role === 'user';
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = `
      padding: 10px 12px;
      background: ${isUser ? THEME.userBg : THEME.aiBg};
      border-radius: 4px;
      max-width: 85%;
      align-self: ${isUser ? 'flex-end' : 'flex-start'};
      font-size: 12px;
      line-height: 1.5;
    `;
    
    // 用户消息：纯文本（安全转义）
    // AI 消息：Markdown 渲染
    const content = isUser 
      ? this.escapeHtml(message.content)
      : `<div class="markdown-content">${this.renderMarkdown(message.content)}</div>`;
    
    msgDiv.innerHTML = `
      <div style="font-size: 10px; color: ${THEME.textMuted}; margin-bottom: 4px;">
        ${isUser ? '你' : this.config.character.name}
      </div>
      ${content}
    `;
    
    // 添加 Markdown 样式（只添加一次）
    if (!container.querySelector('.markdown-styles')) {
      container.insertAdjacentHTML('beforeend', this.getMarkdownStyles());
    }
    
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
  }

  private renderError(container: HTMLElement, error: string): void {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      padding: 10px 12px;
      background: #2a1a1a;
      border-radius: 4px;
      border-left: 3px solid ${THEME.error};
      font-size: 11px;
      color: ${THEME.error};
    `;
    errorDiv.textContent = `Error: ${error}`;
    container.appendChild(errorDiv);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 渲染 Markdown 内容
   */
  private renderMarkdown(text: string): string {
    if (!text) return '';
    
    try {
      // 使用 marked 的同步解析
      const html = marked.parse(text, { 
        breaks: true,
        gfm: true,
        async: false
      }) as string;
      
      console.log('[AgentChat] Markdown parsed:', { input: text.slice(0, 50), output: html?.slice(0, 100) });
      
      return html || this.escapeHtml(text);
    } catch (error) {
      console.error('[AgentChat] Markdown parse error:', error);
      return this.escapeHtml(text);
    }
  }

  /**
   * 获取 Markdown 样式
   */
  private getMarkdownStyles(): string {
    return `
      <style class="markdown-styles">
        .markdown-content { line-height: 1.6; }
        .markdown-content p { margin: 0 0 8px 0; }
        .markdown-content p:last-child { margin-bottom: 0; }
        .markdown-content code {
          background: rgba(255,255,255,0.1);
          padding: 2px 6px;
          border-radius: 3px;
          font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
          font-size: 11px;
          color: ${THEME.accent};
        }
        .markdown-content pre {
          background: #0a0a12;
          padding: 12px;
          border-radius: 4px;
          overflow-x: auto;
          margin: 8px 0;
          border: 1px solid ${THEME.panelBorder};
        }
        .markdown-content pre code {
          background: none;
          padding: 0;
          color: ${THEME.text};
        }
        .markdown-content strong { color: ${THEME.accent}; }
        .markdown-content em { color: ${THEME.textMuted}; }
        .markdown-content a {
          color: ${THEME.accent};
          text-decoration: underline;
        }
        .markdown-content ul, .markdown-content ol {
          margin: 8px 0;
          padding-left: 20px;
        }
        .markdown-content li { margin: 4px 0; }
        .markdown-content blockquote {
          border-left: 3px solid ${THEME.accent};
          padding-left: 12px;
          margin: 8px 0;
          color: ${THEME.textMuted};
        }
        .markdown-content h1, .markdown-content h2, .markdown-content h3 {
          color: ${THEME.accent};
          margin: 12px 0 8px 0;
          font-weight: bold;
        }
        .markdown-content h1 { font-size: 16px; }
        .markdown-content h2 { font-size: 14px; }
        .markdown-content h3 { font-size: 12px; }
        .markdown-content hr {
          border: none;
          border-top: 1px solid ${THEME.panelBorder};
          margin: 12px 0;
        }
      </style>
    `;
  }

  destroy(): void {
    this.container?.destroy();
  }

  private adjustTextareaHeight(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 120);
    textarea.style.height = `${newHeight}px`;
    
    if (textarea.scrollHeight > 120) {
      textarea.style.overflowY = 'auto';
    } else {
      textarea.style.overflowY = 'hidden';
    }
  }

  private resetTextareaHeight(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    textarea.style.height = '40px';
    textarea.style.overflowY = 'hidden';
  }
}

export default AgentChatPanel;
