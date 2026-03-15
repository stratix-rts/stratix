/**
 * StratixAgentConfigPanel - StratixAgent 后端配置面板
 * 
 * 轻量级 Agent 配置，与 StratixAgent 核心模块对应
 */

import Phaser from 'phaser';
import { Depth } from '@/design-system/tokens/depth';
import type { StratixDirectConfig } from '@/stratix-core/stratix-protocol';

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

export interface StratixAgentConfigPanelConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  initialConfig?: Partial<StratixDirectConfig>;
  onChange?: (config: StratixDirectConfig) => void;
}

const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
  deepseek: ['deepseek-chat', 'deepseek-coder'],
  qwen: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
  ollama: ['llama2', 'mistral', 'codellama', 'phi'],
  custom: ['custom'],
};

export class StratixAgentConfigPanel {
  private scene: Phaser.Scene;
  private config: StratixAgentConfigPanelConfig;
  private container: Phaser.GameObjects.DOMElement | null = null;
  private currentConfig: StratixDirectConfig;
  private onChange?: (config: StratixDirectConfig) => void;

  constructor(scene: Phaser.Scene, config: StratixAgentConfigPanelConfig) {
    this.scene = scene;
    this.config = config;
    this.onChange = config.onChange;
    this.currentConfig = {
      provider: config.initialConfig?.provider || 'openai',
      model: config.initialConfig?.model || 'gpt-4o',
      apiKey: config.initialConfig?.apiKey || '',
      endpoint: config.initialConfig?.endpoint || '',
      temperature: config.initialConfig?.temperature ?? 0.7,
      maxTokens: config.initialConfig?.maxTokens ?? 4096,
      maxShortTerm: config.initialConfig?.maxShortTerm ?? 20,
      enableLongTerm: config.initialConfig?.enableLongTerm ?? true,
    };
  }

  create(): Phaser.GameObjects.DOMElement {
    const html = this.generateHTML();
    this.container = this.scene.add.dom(this.config.x, this.config.y).createFromHTML(html).setOrigin(0, 0).setDepth(Depth.UI_MODAL_CONTENT);
    this.setupEventListeners();
    return this.container;
  }

  private generateHTML(): string {
    return `
      <div class="stratix-config-panel" style="
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
      ">
        <div style="padding: 16px; border-bottom: 1px solid ${THEME.border};">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 10px;">
            PROVIDER
          </label>
          <select id="stratix-provider" style="
            width: 100%;
            padding: 10px 12px;
            background: ${THEME.inputBg};
            border: 1px solid ${THEME.border};
            border-radius: 6px;
            color: ${THEME.text};
            font-size: 12px;
            box-sizing: border-box;
          ">
            <option value="openai" ${this.currentConfig.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
            <option value="anthropic" ${this.currentConfig.provider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option>
            <option value="deepseek" ${this.currentConfig.provider === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
            <option value="qwen" ${this.currentConfig.provider === 'qwen' ? 'selected' : ''}>阿里 Qwen</option>
            <option value="ollama" ${this.currentConfig.provider === 'ollama' ? 'selected' : ''}>Ollama (本地)</option>
            <option value="custom" ${this.currentConfig.provider === 'custom' ? 'selected' : ''}>自定义</option>
          </select>
        </div>

        <div style="padding: 16px; border-bottom: 1px solid ${THEME.border};">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
            MODEL
          </label>
          <select id="stratix-model" style="
            width: 100%;
            padding: 10px 12px;
            background: ${THEME.inputBg};
            border: 1px solid ${THEME.border};
            border-radius: 6px;
            color: ${THEME.text};
            font-size: 12px;
            box-sizing: border-box;
          ">
            ${this.generateModelOptions()}
          </select>
        </div>

        <div style="padding: 16px; border-bottom: 1px solid ${THEME.border};">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
            API KEY ${this.currentConfig.provider === 'ollama' ? '(可选)' : ''}
          </label>
          <input type="password" id="stratix-api-key" value="${this.currentConfig.apiKey || ''}" placeholder="${this.currentConfig.provider === 'ollama' ? '可选' : '必填'}" style="
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

        <div id="stratix-endpoint-row" style="padding: 16px; border-bottom: 1px solid ${THEME.border}; ${this.currentConfig.provider === 'ollama' || this.currentConfig.provider === 'custom' ? '' : 'display: none;'}">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
            ENDPOINT URL
          </label>
          <input type="text" id="stratix-endpoint" value="${this.currentConfig.endpoint || ''}" placeholder="${this.getEndpointPlaceholder()}" style="
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

        <div style="padding: 16px; border-bottom: 1px solid ${THEME.border}; display: flex; gap: 16px;">
          <div style="flex: 1;">
            <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
              TEMPERATURE
            </label>
            <input type="number" id="stratix-temperature" value="${this.currentConfig.temperature}" min="0" max="2" step="0.1" style="
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
          <div style="flex: 1;">
            <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
              MAX TOKENS
            </label>
            <input type="number" id="stratix-max-tokens" value="${this.currentConfig.maxTokens}" min="100" max="128000" step="100" style="
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
        </div>

        <div style="padding: 16px; border-bottom: 1px solid ${THEME.border}; display: flex; gap: 16px;">
          <div style="flex: 1;">
            <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
              短期记忆条数
            </label>
            <input type="number" id="stratix-short-term" value="${this.currentConfig.maxShortTerm}" min="0" max="100" style="
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
          <div style="flex: 1; display: flex; align-items: center; padding-top: 24px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="stratix-long-term" ${this.currentConfig.enableLongTerm ? 'checked' : ''} style="width: 16px; height: 16px;" />
              <span style="font-size: 12px;">启用长期记忆</span>
            </label>
          </div>
        </div>

        <div style="padding: 16px;">
          <button id="stratix-test-btn" style="
            width: 100%;
            padding: 12px;
            background: ${THEME.accentDim};
            border: 1px solid ${THEME.accent};
            border-radius: 6px;
            color: ${THEME.accent};
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
          ">测试连接 Test Connection</button>
          <div id="stratix-status" style="
            margin-top: 12px;
            padding: 10px;
            border-radius: 6px;
            font-size: 11px;
            display: none;
          "></div>
        </div>
      </div>
    `;
  }

  private generateModelOptions(): string {
    const models = PROVIDER_MODELS[this.currentConfig.provider] || [];
    return models.map(m => `<option value="${m}" ${this.currentConfig.model === m ? 'selected' : ''}>${m}</option>`).join('');
  }

  private getEndpointPlaceholder(): string {
    switch (this.currentConfig.provider) {
      case 'ollama': return 'http://localhost:11434';
      case 'custom': return 'https://your-api.com/v1';
      default: return '';
    }
  }

  private setupEventListeners(): void {
    if (!this.container) return;
    const node = this.container.node as HTMLElement;

    const providerSelect = node.querySelector('#stratix-provider') as HTMLSelectElement;
    providerSelect?.addEventListener('change', () => {
      this.currentConfig.provider = providerSelect.value as any;
      this.currentConfig.model = PROVIDER_MODELS[this.currentConfig.provider]?.[0] || 'gpt-4o';
      
      const modelSelect = node.querySelector('#stratix-model') as HTMLSelectElement;
      modelSelect.innerHTML = this.generateModelOptions();
      
      const endpointRow = node.querySelector('#stratix-endpoint-row') as HTMLElement;
      if (this.currentConfig.provider === 'ollama' || this.currentConfig.provider === 'custom') {
        endpointRow.style.display = 'block';
      } else {
        endpointRow.style.display = 'none';
      }
      
      this.notifyChange();
    });

    const modelSelect = node.querySelector('#stratix-model') as HTMLSelectElement;
    modelSelect?.addEventListener('change', () => {
      this.currentConfig.model = modelSelect.value;
      this.notifyChange();
    });

    const apiKeyInput = node.querySelector('#stratix-api-key') as HTMLInputElement;
    apiKeyInput?.addEventListener('change', () => {
      this.currentConfig.apiKey = apiKeyInput.value;
      this.notifyChange();
    });

    const endpointInput = node.querySelector('#stratix-endpoint') as HTMLInputElement;
    endpointInput?.addEventListener('change', () => {
      this.currentConfig.endpoint = endpointInput.value;
      this.notifyChange();
    });

    const temperatureInput = node.querySelector('#stratix-temperature') as HTMLInputElement;
    temperatureInput?.addEventListener('change', () => {
      this.currentConfig.temperature = parseFloat(temperatureInput.value) || 0.7;
      this.notifyChange();
    });

    const maxTokensInput = node.querySelector('#stratix-max-tokens') as HTMLInputElement;
    maxTokensInput?.addEventListener('change', () => {
      this.currentConfig.maxTokens = parseInt(maxTokensInput.value) || 4096;
      this.notifyChange();
    });

    const shortTermInput = node.querySelector('#stratix-short-term') as HTMLInputElement;
    shortTermInput?.addEventListener('change', () => {
      this.currentConfig.maxShortTerm = parseInt(shortTermInput.value) || 20;
      this.notifyChange();
    });

    const longTermCheckbox = node.querySelector('#stratix-long-term') as HTMLInputElement;
    longTermCheckbox?.addEventListener('change', () => {
      this.currentConfig.enableLongTerm = longTermCheckbox.checked;
      this.notifyChange();
    });
  }

  private notifyChange(): void {
    this.onChange?.(this.currentConfig);
  }

  getConfig(): StratixDirectConfig {
    return { ...this.currentConfig };
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.currentConfig.provider) {
      errors.push('Provider 不能为空');
    }
    if (!this.currentConfig.model) {
      errors.push('Model 不能为空');
    }
    if (this.currentConfig.provider !== 'ollama' && !this.currentConfig.apiKey) {
      errors.push('API Key 不能为空');
    }

    return { valid: errors.length === 0, errors };
  }

  destroy(): void {
    this.container?.destroy();
  }
}

export default StratixAgentConfigPanel;
