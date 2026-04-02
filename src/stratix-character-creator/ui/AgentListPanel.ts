/**
 * (Migrated)
 * AgentListPanel - 已有角色列表面板
 * 显示从 OpenClaw 获取的 Agent 列表
 */

import Phaser from 'phaser';

import { getButtonInlineStyles } from './_buttonStyles';

import { getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';
import { unifiedOpenClawConnectionManager } from '@/stratix-core/UnifiedOpenClawConnectionManager';
import { ContainerComponentBase } from '@/stratix-core/ui/ContainerComponent.base';

const THEME = {
  bg: 'var(--ds-bg-secondary)',
  panelBg: 'var(--ds-bg-secondary)',
  panelBorder: 'var(--ds-border)',
  accent: 'var(--ds-brand-primary)',
  accentDim: 'var(--ds-brand-secondary)',
  text: 'var(--ds-text-primary)',
  textMuted: 'var(--ds-text-muted)',
  hoverBg: 'var(--ds-bg-tertiary)',
  success: 'var(--ds-status-success)',
  error: 'var(--ds-status-danger)'
};

export interface AgentListPanelConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  onAgentSelected?: (agent: any) => void;
  onBack?: () => void;
}

export class AgentListPanel {
  private scene: Phaser.Scene;
  private config: AgentListPanelConfig;
  private container: Phaser.GameObjects.DOMElement | null = null;
  private agents: any[] = [];

  constructor(scene: Phaser.Scene, config: AgentListPanelConfig) {
    this.scene = scene;
    this.config = config;
  }

  async create(): Promise<Phaser.GameObjects.DOMElement> {
    const html = this.generateHTML();
    this.container = this.scene.add.dom(
      this.config.x,
      this.config.y
    ).createFromHTML(html).setOrigin(0, 0);

    this.setupEventListeners();
    await this.loadAgents();

    return this.container;
  }

  private generateHTML(): string {
    return `
      <div class="agent-list-panel" style="
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
        pointer-events: auto;
      ">
        <div class="header" style="
          padding: 16px;
          border-bottom: 1px solid ${THEME.panelBorder};
        ">
          <div style="font-size: 11px; color: ${THEME.textMuted}; letter-spacing: 1px; margin-bottom: 4px;">已有角色 EXISTING AGENTS</div>
          <div style="font-size: 14px; color: ${THEME.accent};">选择或创建新角色</div>
        </div>
        <div id="loading-state" style="
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          color: ${THEME.textMuted};
          font-size: 12px;
        ">
          <span>加载中... Loading...</span>
        </div>
        <div id="agent-list" style="
          flex: 1;
          padding: 8px;
          overflow-y: auto;
          background: ${THEME.bg};
          display: none;
        "></div>
        <div id="error-state" style="
          flex: 1;
          display: none;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          color: ${THEME.error};
          font-size: 12px;
          padding: 20px;
          text-align: center;
        "></div>
        <div class="footer" style="
          padding: 16px;
          border-top: 1px solid ${THEME.panelBorder};
          display: flex;
          justify-content: space-between;
          gap: 12px;
        ">
          <button id="back-btn" style="${getButtonInlineStyles('ghost')}">← 上一步 BACK</button>
          <button id="create-new-btn" style="${getButtonInlineStyles('success')}">+ 创建新角色 NEW</button>
        </div>
      </div>
      <style>
        #back-btn:hover {
          background: ${THEME.hoverBg};
          border-color: ${THEME.accent};
          color: ${THEME.text};
        }
        #create-new-btn:hover {
          background: var(--ds-status-success);
        }
        .agent-item {
          display: flex;
          align-items: center;
          padding: 12px;
          margin-bottom: 4px;
          background: ${THEME.panelBg};
          border: 1px solid transparent;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .agent-item:hover {
          background: ${THEME.hoverBg};
          border-color: ${THEME.panelBorder};
        }
        .agent-name {
          flex: 1;
          font-size: 12px;
          color: ${THEME.text};
        }
        .agent-meta {
          font-size: 10px;
          color: ${THEME.textMuted};
        }
        .agent-id {
          font-size: 9px;
          color: ${THEME.textMuted};
          opacity: 0.6;
        }
        #agent-list::-webkit-scrollbar {
          width: 6px;
        }
        #agent-list::-webkit-scrollbar-track {
          background: ${THEME.bg};
        }
        #agent-list::-webkit-scrollbar-thumb {
          background: ${THEME.panelBorder};
          border-radius: 3px;
        }
        #agent-list::-webkit-scrollbar-thumb:hover {
          background: ${THEME.accent};
        }
        .empty-state {
          text-align: center;
          padding: 40px 20px;
          color: ${THEME.textMuted};
          font-size: 12px;
        }
      </style>
    `;
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;

    // 阻止所有点击事件冒泡到 canvas
    node.addEventListener('click', (e) => e.stopPropagation());
    node.addEventListener('pointerdown', (e) => e.stopPropagation());
    node.addEventListener('pointerup', (e) => e.stopPropagation());
    node.addEventListener('pointermove', (e) => e.stopPropagation());

    const backBtn = node.querySelector('#back-btn');
    backBtn?.addEventListener('click', () => {
      this.config.onBack?.();
    });

    const createNewBtn = node.querySelector('#create-new-btn');
    createNewBtn?.addEventListener('click', () => {
      this.config.onAgentSelected?.(null);
    });
  }

  async loadAgents(): Promise<void> {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;
    const loadingState = node.querySelector('#loading-state') as HTMLElement;
    const agentList = node.querySelector('#agent-list') as HTMLElement;
    const errorState = node.querySelector('#error-state') as HTMLElement;

    try {
      const agents = await unifiedOpenClawConnectionManager.listAgents();

      loadingState.style.display = 'none';

      if (!agents || agents.length === 0) {
        agentList.style.display = 'block';
        agentList.innerHTML = `
          <div class="empty-state">
            暂无已有角色<br>No existing agents<br><br>
            点击下方"创建新角色"开始
          </div>
        `;
        return;
      }

      this.agents = agents;
    } catch (error: any) {
      loadingState.style.display = 'none';
      errorState.style.display = 'flex';
      errorState.innerHTML = `
        <div style="margin-bottom: 12px;">加载失败：${error.message || 'Unknown error'}</div>
        <button id="retry-btn" style="${getButtonInlineStyles('secondary')}">重试 RETRY</button>
      `;
      
      const retryBtn = errorState.querySelector('#retry-btn');
      retryBtn?.addEventListener('click', () => {
        errorState.style.display = 'none';
        loadingState.style.display = 'flex';
        this.loadAgents();
      });
      return;
    }
    
    if (this.agents.length === 0) {
      agentList.style.display = 'block';
      agentList.innerHTML = `
        <div class="empty-state">
          暂无已有角色<br>No existing agents<br><br>
          点击下方"创建新角色"开始
        </div>
      `;
      return;
    }

    agentList.style.display = 'block';
    agentList.innerHTML = this.agents.map((agent, index) => `
      <div class="agent-item" data-agent-index="${index}">
        <div style="flex: 1;">
          <div class="agent-name">${agent.name || agent.agentId || 'Unnamed Agent'}</div>
          <div class="agent-id">${agent.agentId || 'No ID'}</div>
        </div>
        <div class="agent-meta">${agent.status || 'idle'}</div>
      </div>
    `).join('');

    agentList.querySelectorAll('.agent-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt((item as HTMLElement).dataset.agentIndex || '0');
        const agent = this.agents[index];
        this.config.onAgentSelected?.(agent);
      });
    });
  }

  setVisible(visible: boolean): void {
    if (this.container) {
      this.container.setVisible(visible);
    }
  }

  destroy(): void {
    this.container?.destroy();
  }
}

export default AgentListPanel;
