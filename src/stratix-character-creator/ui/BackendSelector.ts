/**
 * BackendSelector - 后端选择器
 *
 * 支持 OpenClaw 和 StratixAgent 两种后端
 * OpenClaw 部分使用统一连接管理器
 */

import Phaser from 'phaser';

import { Depth } from '@/design-system/tokens/depth';

import { unifiedOpenClawConnectionManager } from '@/stratix-core/UnifiedOpenClawConnectionManager';
import type { AgentBackendType, OpenClawConfig, UnifiedOpenClawConfig, StratixDirectConfig } from '@/stratix-core/stratix-protocol';

import { StratixAgentConfigPanel } from './StratixAgentConfigPanel';
import { getButtonInlineStyles } from './_buttonStyles';


const THEME = {
  bg: 'var(--ds-bg-secondary)',
  border: 'var(--ds-border)',
  accent: 'var(--ds-brand-primary)',
  accentDim: 'var(--ds-brand-secondary)',
  text: 'var(--ds-text-primary)',
  textMuted: 'var(--ds-text-muted)',
  inputBg: 'var(--ds-bg-tertiary)',
  success: 'var(--ds-status-success)',
  error: 'var(--ds-status-danger)',
};

export interface BackendSelectorConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  initialBackendType?: AgentBackendType;
  initialOpenClawConfig?: OpenClawConfig;
  initialStratixConfig?: StratixDirectConfig;
  onChange?: (backendType: AgentBackendType, config: OpenClawConfig | StratixDirectConfig) => void;
  onNext?: () => void;
}

export class BackendSelector {
  private scene: Phaser.Scene;
  private config: BackendSelectorConfig;
  private container: Phaser.GameObjects.DOMElement | null = null;
  private currentBackendType: AgentBackendType;
  private openClawConfig: OpenClawConfig;
  private stratixConfig: StratixDirectConfig;
  private stratixPanel: StratixAgentConfigPanel | null = null;
  private onChange?: (backendType: AgentBackendType, config: OpenClawConfig | StratixDirectConfig) => void;
  private onNext?: () => void;
  private isElectron: boolean = false;

  constructor(scene: Phaser.Scene, config: BackendSelectorConfig) {
    this.scene = scene;
    this.config = config;
    this.currentBackendType = config.initialBackendType || 'stratix';
    this.openClawConfig = config.initialOpenClawConfig || {
      endpoint: '',
      accountId: '',
    };
    this.stratixConfig = config.initialStratixConfig || {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.7,
      maxTokens: 4096,
      maxShortTerm: 20,
      enableLongTerm: true,
    };
    this.onChange = config.onChange;
    this.onNext = config.onNext;
    this.detectEnvironment();
  }

  private detectEnvironment(): void {
    this.isElectron = !!(typeof window !== 'undefined' && (window as any).electronAPI);
  }

  async create(): Promise<Phaser.GameObjects.DOMElement> {
    const html = this.generateHTML();
    console.log('[BackendSelector] Creating with HTML length:', html.length);
    this.container = this.scene.add.dom(this.config.x, this.config.y).createFromHTML(html).setOrigin(0, 0).setDepth(Depth.UI_MODAL_CONTENT);
    console.log('[BackendSelector] Container created, node:', this.container?.node);
    console.log('[BackendSelector] Container node children:', this.container?.node?.children?.length);
    
    this.setupEventListeners();
    await this.showBackendConfig(this.currentBackendType);
    return this.container;
  }

  private generateHTML(): string {
    return `
      <div class="backend-selector" style="
        width: ${this.config.width}px;
        height: ${this.config.height}px;
        background: ${THEME.bg};
        border: 1px solid ${THEME.border};
        border-radius: 8px;
        font-family: system-ui, -apple-system, sans-serif;
        color: ${THEME.text};
        display: flex;
        flex-direction: column;
        overflow: hidden;
        pointer-events: auto;
      ">
        <div class="section" style="padding: 16px; border-bottom: 1px solid ${THEME.border};">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 10px;">
            后端类型 BACKEND TYPE
          </label>
          <div style="display: flex; gap: 8px;">
            <button class="backend-btn" data-backend="openclaw" style="
              flex: 1;
              padding: 12px 8px;
              background: ${this.currentBackendType === 'openclaw' ? THEME.accent : 'transparent'};
              border: 1px solid ${this.currentBackendType === 'openclaw' ? THEME.accent : THEME.border};
              border-radius: 8px;
              color: ${this.currentBackendType === 'openclaw' ? THEME.bg : THEME.text};
              font-size: 11px;
              cursor: pointer;
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 4px;
            ">
              <span style="font-size: 18px;">⚡</span>
              <span>OpenClaw</span>
            </button>
            <button class="backend-btn" data-backend="stratix" style="
              flex: 1;
              padding: 12px 8px;
              background: ${this.currentBackendType === 'stratix' ? THEME.accent : 'transparent'};
              border: 1px solid ${this.currentBackendType === 'stratix' ? THEME.accent : THEME.border};
              border-radius: 8px;
              color: ${this.currentBackendType === 'stratix' ? THEME.bg : THEME.text};
              font-size: 11px;
              cursor: pointer;
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 4px;
            ">
              <span style="font-size: 18px;">🤖</span>
              <span>StratixAgent</span>
            </button>
          </div>
        </div>

        <div class="config-area" style="flex: 1; overflow: hidden; position: relative;">
          <div id="openclaw-config" class="config-panel" style="
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            padding: 16px;
            overflow-y: auto;
            display: none;
          ">
            <div class="section" style="margin-bottom: 16px;">
              <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
                连接模式 CONNECTION MODE
              </label>
              <select id="oc-mode" style="
                width: 100%;
                padding: 10px 12px;
                background: ${THEME.inputBg};
                border: 1px solid ${THEME.border};
                border-radius: 6px;
                color: ${THEME.text};
                font-size: 12px;
                box-sizing: border-box;
              ">
                <option value="auto" ${this.getModeSelectedAttribute('auto')}>自动 Auto ⚡</option>
                <option value="local" ${this.getModeSelectedAttribute('local')}>本地 Local 🔌</option>
                <option value="remote" ${this.getModeSelectedAttribute('remote')}>远程 Remote 🌐</option>
                ${this.isElectron ? `<option value="tailscale" ${this.getModeSelectedAttribute('tailscale')}>Tailscale 🕸️</option>` : ''}
              </select>
            </div>

            ${this.isElectron ? `
            <div class="section" style="margin-bottom: 16px; padding: 12px; background: ${THEME.inputBg}; border-radius: 6px;">
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" id="oc-tailscale-enabled" ${this.isElectron ? 'checked' : ''} ${this.isElectron ? 'disabled' : ''} style="
                  width: 16px;
                  height: 16px;
                  cursor: pointer;
                " />
                <span style="font-size: 12px; color: ${THEME.text};">启用 Tailscale 节点发现</span>
              </label>
              ${this.isElectron ? '<div style="font-size: 10px; color: ' + THEME.textMuted + '; margin-top: 6px;">Electron 环境下必需启用</div>' : ''}
            </div>
            ` : ''}

            <div class="section" style="margin-bottom: 16px;">
              <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
                Endpoint URL
              </label>
              <input type="text" id="oc-endpoint" value="${this.openClawConfig.endpoint}" placeholder="http://127.0.0.1:18789" style="
                width: 100%;
                padding: 10px 12px;
                background: ${THEME.inputBg};
                border: 1px solid ${THEME.border};
                border-radius: 6px;
                color: ${THEME.text};
                font-size: 12px;
                box-sizing: border-box;
              " />
            </div>
            <div class="section" style="margin-bottom: 16px;">
              <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
                Account ID
              </label>
              <input type="text" id="oc-account-id" value="${this.openClawConfig.accountId}" placeholder="your-account-id" style="
                width: 100%;
                padding: 10px 12px;
                background: ${THEME.inputBg};
                border: 1px solid ${THEME.border};
                border-radius: 6px;
                color: ${THEME.text};
                font-size: 12px;
                box-sizing: border-box;
              " />
            </div>
            <div class="section" style="margin-bottom: 16px;">
              <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
                API Key (可选)
              </label>
              <input type="password" id="oc-api-key" value="${this.openClawConfig.apiKey || ''}" placeholder="Enter API Key" style="
                width: 100%;
                padding: 10px 12px;
                background: ${THEME.inputBg};
                border: 1px solid ${THEME.border};
                border-radius: 6px;
                color: ${THEME.text};
                font-size: 12px;
                box-sizing: border-box;
              " />
            </div>
            <div class="section">
              <button id="oc-test-btn" style="${getButtonInlineStyles('secondary')}">测试连接 Test Connection</button>
              <div id="oc-status" style="
                margin-top: 12px;
                padding: 10px;
                border-radius: 6px;
                font-size: 11px;
                display: none;
              "></div>
            </div>
          </div>

          <div id="stratix-config" class="config-panel" style="
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 60px;
            padding: 16px;
            overflow-y: auto;
            display: none;
          ">
            <div id="stratix-panel-content"></div>
            <button id="stratix-test-btn-static" style="${getButtonInlineStyles('secondary')}">测试连接 Test Connection</button>
            <div id="stratix-status-static" style="
              margin-top: 12px;
              padding: 10px;
              border-radius: 6px;
              font-size: 11px;
              display: none;
            "></div>
          </div>
          
          <div class="next-btn-container" style="
            position: absolute;
            bottom: 16px;
            left: 16px;
            right: 16px;
            display: flex;
            gap: 8px;
          ">
            <button id="backend-next-btn" class="backend-next-btn" style="${getButtonInlineStyles('primary')}">下一步 Next</button>
            <style>
              .backend-next-btn:hover {
                filter: brightness(1.1);
                transform: translateY(-1px);
              }
              .backend-next-btn:active {
                transform: translateY(0) scale(0.98);
              }
            </style>
          </div>
        </div>
      </div>
    `;
  }

  private getModeSelectedAttribute(mode: string): string {
    const savedMode = localStorage.getItem('stratix_openclaw_mode');
    return savedMode === mode ? 'selected' : '';
  }

  private setupEventListeners(): void {
    if (!this.container) {
      console.log('[BackendSelector] No container');
      return;
    }

    const node = this.container.node as HTMLElement;
    console.log('[BackendSelector] Setting up event listeners, node:', node);

    // 阻止所有点击事件冒泡到 canvas
    node.addEventListener('click', (e) => e.stopPropagation());
    node.addEventListener('pointerdown', (e) => e.stopPropagation());
    node.addEventListener('pointerup', (e) => e.stopPropagation());
    node.addEventListener('pointermove', (e) => e.stopPropagation());

    const backendBtns = node.querySelectorAll('.backend-btn');
    console.log('[BackendSelector] Found backend buttons:', backendBtns.length);
    backendBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        console.log('[BackendSelector] Backend button clicked');
        const backendType = (btn as HTMLElement).dataset.backend as AgentBackendType;
        console.log('[BackendSelector] Selected backend type:', backendType);
        this.currentBackendType = backendType;
        void this.showBackendConfig(backendType);
        this.updateBackendButtons(node);
      });
    });

    // OpenClaw 测试按钮
    const testBtn = node.querySelector('#oc-test-btn') as HTMLButtonElement;
    console.log('[BackendSelector] OpenClaw test button:', testBtn);
    testBtn?.addEventListener('click', (e) => {
      console.log('[BackendSelector] OpenClaw test clicked');
      e.stopPropagation();
      this.testConnection();
    });

    // 下一步按钮
    const nextBtn = node.querySelector('#backend-next-btn') as HTMLButtonElement;
    console.log('[BackendSelector] Next button:', nextBtn);
    nextBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const validation = this.validate();
      if (!validation.valid) {
        this.showValidationErrors(validation.errors);
        return;
      }
      this.onNext?.();
    });

    const modeSelect = node.querySelector('#oc-mode') as HTMLSelectElement;
    modeSelect?.addEventListener('change', () => {
      const mode = modeSelect.value;
      localStorage.setItem('stratix_openclaw_mode', mode);
    });

    // Stratix 测试按钮
    const stratixTestBtnStatic = node.querySelector('#stratix-test-btn-static') as HTMLButtonElement;
    console.log('[BackendSelector] Stratix test button element:', stratixTestBtnStatic);
    if (stratixTestBtnStatic) {
      stratixTestBtnStatic.addEventListener('click', (e) => {
        console.log('[BackendSelector] Stratix test button clicked');
        e.stopPropagation();
        e.preventDefault();
        this.testStratixConnectionFromPanelStatic(node);
      });
    }

    // 全局点击调试
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.id?.includes('test-btn') || target.id?.includes('test-connection')) {
        console.log('[Global] Test button clicked:', target.id);
      }
    }, true);
  }

  private updateBackendButtons(node: HTMLElement): void {
    const backendBtns = node.querySelectorAll('.backend-btn');
    backendBtns.forEach(btn => {
      const btnBackend = (btn as HTMLElement).dataset.backend as AgentBackendType;
      const isSelected = btnBackend === this.currentBackendType;
      (btn as HTMLElement).style.background = isSelected ? THEME.accent : 'transparent';
      (btn as HTMLElement).style.borderColor = isSelected ? THEME.accent : THEME.border;
      (btn as HTMLElement).style.color = isSelected ? THEME.bg : THEME.text;
    });
  }

  private async showBackendConfig(backendType: AgentBackendType): Promise<void> {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;
    const openclawPanel = node.querySelector('#openclaw-config') as HTMLElement;
    const stratixPanel = node.querySelector('#stratix-config') as HTMLElement;

    openclawPanel.style.display = 'none';
    stratixPanel.style.display = 'none';

    if (backendType === 'openclaw') {
      openclawPanel.style.display = 'block';
      this.onChange?.(backendType, this.openClawConfig);
    } else if (backendType === 'stratix') {
      console.log('[BackendSelector] Showing stratix config panel');
      stratixPanel.style.display = 'block';

      if (!this.stratixPanel && stratixPanel) {
        const panelContent = stratixPanel.querySelector('#stratix-panel-content') as HTMLElement;
        this.stratixPanel = new StratixAgentConfigPanel(this.scene, {
          x: 0,
          y: 0,
          width: this.config.width - 32,
          height: this.config.height - 160,
          initialConfig: this.stratixConfig,
          onChange: (config) => {
            this.stratixConfig = config;
            this.onChange?.('stratix', config);
          },
        });
        panelContent.appendChild((await this.stratixPanel.create()).node as HTMLElement);
      }
      this.onChange?.(backendType, this.stratixConfig);
    }
  }

  private async testConnection(): Promise<void> {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;
    const statusDiv = node.querySelector('#oc-status') as HTMLDivElement;

    statusDiv.style.display = 'block';
    statusDiv.style.background = THEME.accentDim;
    statusDiv.style.color = THEME.accent;
    statusDiv.textContent = '连接中 Connecting...';

    if (this.currentBackendType === 'openclaw') {
      await this.testOpenClawConnection(node, statusDiv);
    } else if (this.currentBackendType === 'stratix') {
      await this.testStratixConnection(node, statusDiv);
    }
  }

  private async testOpenClawConnection(node: HTMLElement, statusDiv: HTMLDivElement): Promise<void> {
    const endpoint = (node.querySelector('#oc-endpoint') as HTMLInputElement).value;
    const accountId = (node.querySelector('#oc-account-id') as HTMLInputElement).value;
    const apiKey = (node.querySelector('#oc-api-key') as HTMLInputElement).value;
    const mode = (node.querySelector('#oc-mode') as HTMLSelectElement).value as UnifiedOpenClawConfig['mode'];

    const config: UnifiedOpenClawConfig = {
      mode,
      localEndpoint: endpoint,
      credentials: { accountId, apiKey, token: apiKey },
    };

    statusDiv.style.display = 'block';
    statusDiv.style.background = 'rgba(255, 200, 0, 0.1)';
    statusDiv.style.color = '#ffcc00';
    statusDiv.textContent = '连接中 Connecting...';

    try {
      const connected = await unifiedOpenClawConnectionManager.initialize(config);
      if (connected) {
        statusDiv.style.background = 'rgba(0, 255, 136, 0.1)';
        statusDiv.style.color = THEME.success;
        statusDiv.textContent = '✓ 连接成功 Connected';
        this.openClawConfig = { endpoint, accountId, apiKey };
        this.onChange?.('openclaw', this.openClawConfig);
      } else {
        throw new Error('Connection failed');
      }
    } catch (error: any) {
      statusDiv.style.background = 'rgba(255, 102, 102, 0.1)';
      statusDiv.style.color = THEME.error;
      statusDiv.textContent = `✗ 连接失败：${error.message}`;
    }
  }

  private async testStratixConnection(node: HTMLElement, statusDiv: HTMLDivElement): Promise<void> {
    try {
      let config: StratixDirectConfig;
      
      if (this.stratixPanel) {
        config = this.stratixPanel.getConfig();
      } else {
        const provider = ((node.querySelector('#stratix-provider') as HTMLSelectElement)?.value || this.stratixConfig.provider) as StratixDirectConfig['provider'];
        const model = (node.querySelector('#stratix-model') as HTMLSelectElement)?.value || this.stratixConfig.model;
        const apiKey = (node.querySelector('#stratix-api-key') as HTMLInputElement)?.value || this.stratixConfig.apiKey;
        const endpoint = (node.querySelector('#stratix-endpoint') as HTMLInputElement)?.value || this.stratixConfig.endpoint;
        const temperature = parseFloat((node.querySelector('#stratix-temperature') as HTMLInputElement)?.value) || 0.7;
        const maxTokens = parseInt((node.querySelector('#stratix-max-tokens') as HTMLInputElement)?.value) || 4096;
        const maxShortTerm = parseInt((node.querySelector('#stratix-short-term') as HTMLInputElement)?.value) || 20;
        const enableLongTerm = (node.querySelector('#stratix-long-term') as HTMLInputElement)?.checked ?? true;
        
        config = { provider, model, apiKey, endpoint, temperature, maxTokens, maxShortTerm, enableLongTerm };
      }

      statusDiv.style.display = 'block';
      statusDiv.style.background = 'rgba(255, 200, 0, 0.1)';
      statusDiv.style.color = '#ffcc00';
      statusDiv.textContent = '连接中 Connecting...';

      const response = await fetch('/api/stratix/config/agent/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backendType: 'stratix', config })
      });

      const result = await response.json();

      if (result.success) {
        statusDiv.style.background = 'rgba(0, 255, 136, 0.1)';
        statusDiv.style.color = THEME.success;
        statusDiv.textContent = '✓ 连接成功 Connected';
        this.stratixConfig = { ...this.stratixConfig, ...config };
        this.onChange?.('stratix', this.stratixConfig);
      } else {
        throw new Error(result.message || 'Connection failed');
      }
    } catch (error: any) {
      statusDiv.style.background = 'rgba(255, 102, 102, 0.1)';
      statusDiv.style.color = THEME.error;
      statusDiv.textContent = `✗ 连接失败：${error.message}`;
    }
  }

  getConfig(): OpenClawConfig | StratixDirectConfig {
    if (this.currentBackendType === 'openclaw') return this.openClawConfig;
    return this.stratixConfig;
  }

  getOpenClawConfig(): OpenClawConfig {
    return this.openClawConfig;
  }

  getStratixConfig(): StratixDirectConfig {
    return this.stratixConfig;
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (this.currentBackendType === 'openclaw') {
      if (!this.openClawConfig.endpoint) {
        errors.push('OpenClaw Endpoint 不能为空');
      }
      if (!this.openClawConfig.accountId) {
        errors.push('OpenClaw Account ID 不能为空');
      }
    } else if (this.currentBackendType === 'stratix') {
      if (!this.stratixConfig.apiKey && this.stratixConfig.provider !== 'ollama') {
        errors.push('StratixAgent API Key 不能为空');
      }
      if (!this.stratixConfig.model) {
        errors.push('请选择模型');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  isConfigured(): boolean {
    const validation = this.validate();
    return validation.valid;
  }

  private async testStratixConnectionFromPanel(node: HTMLElement): Promise<void> {
    const statusDiv = node.querySelector('#stratix-status') as HTMLDivElement;
    await this.testStratixConnection(node, statusDiv);
  }

  private async testStratixConnectionFromPanelStatic(node: HTMLElement): Promise<void> {
    console.log('[BackendSelector] testStratixConnectionFromPanelStatic called');
    const statusDiv = node.querySelector('#stratix-status-static') as HTMLDivElement;
    await this.testStratixConnection(node, statusDiv);
  }

  private showValidationErrors(errors: string[]): void {
    if (!this.container) return;
    const node = this.container.node as HTMLElement;

    // 首先尝试显示在对应状态div
    let statusDiv: HTMLDivElement | null = null;
    if (this.currentBackendType === 'openclaw') {
      statusDiv = node.querySelector('#oc-status') as HTMLDivElement;
    } else if (this.currentBackendType === 'stratix') {
      statusDiv = node.querySelector('#stratix-status-static') as HTMLDivElement;
    }

    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.style.background = 'rgba(255, 102, 102, 0.15)';
      statusDiv.style.color = THEME.error;
      statusDiv.style.padding = '12px';
      statusDiv.style.borderRadius = '6px';
      statusDiv.style.marginBottom = '12px';
      statusDiv.textContent = '✗ ' + errors.join('; ');
    }

    // 如果状态div不存在，在next按钮上方显示错误
    const nextBtnContainer = node.querySelector('.next-btn-container');
    if (nextBtnContainer) {
      let errorDiv = node.querySelector('.validation-error-display') as HTMLElement;
      if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.className = 'validation-error-display';
        errorDiv.style.cssText = `
          background: rgba(255, 102, 102, 0.15);
          color: ${THEME.error};
          padding: 10px 12px;
          border-radius: 6px;
          font-size: 12px;
          margin-bottom: 8px;
          border: 1px solid rgba(255, 102, 102, 0.3);
        `;
        nextBtnContainer.parentNode?.insertBefore(errorDiv, nextBtnContainer);
      }
      errorDiv.textContent = '✗ ' + errors.join('; ');
    }
  }

  destroy(): void {
    this.container?.destroy();
    this.stratixPanel = null;
  }
}

export default BackendSelector;
