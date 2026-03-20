/**
 * StratixAgentConfigPanel - StratixAgent 后端配置面板
 * 
 * 轻量级 Agent 配置，与 StratixAgent 核心模块对应
 */

import Phaser from 'phaser';
import { getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';
import { ContainerComponentBase } from '@/stratix-core/ui/ContainerComponent.base';
import type { StratixDirectConfig } from '@/stratix-core/stratix-protocol';
import { 
  PROVIDER_CONFIGS, 
  PROVIDER_LIST, 
  type ProviderConfig,
  getCachedProviderConfigs,
  getCachedProviderList,
  initProviderConfig,
  saveApiKey,
  loadApiKey,
  addCustomProvider,
} from '../config/providerConfig';

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

const ALL_PROVIDER_LIST = PROVIDER_LIST;

function getModelsForProvider(provider: string): string[] {
  const configs = getCachedProviderConfigs();
  return configs[provider]?.models || [];
}

function getProviderLabel(provider: string): string {
  const configs = getCachedProviderConfigs();
  return configs[provider]?.name || provider;
}

function getProviderIcon(provider: string): string {
  const configs = getCachedProviderConfigs();
  return configs[provider]?.icon || '🤖';
}

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

  async create(): Promise<Phaser.GameObjects.DOMElement> {
    await initProviderConfig();
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
            ${this.generateProviderOptions()}
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
            ${!this.showCustomModelInput() ? this.generateModelOptions() : ''}
            ${!this.showCustomModelInput() ? '<option value="__custom__">+ 输入自定义模型...</option>' : ''}
          </select>
        </div>

        <div id="stratix-custom-model-row" style="padding: 16px; border-bottom: 1px solid ${THEME.border}; ${this.showCustomModelInput() ? '' : 'display: none;'}">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
            自定义模型名称
          </label>
          <input type="text" id="stratix-custom-model" value="${this.showCustomModelInput() ? this.currentConfig.model : ''}" placeholder="输入模型名称，如: gpt-4o, claude-3-sonnet" style="
            width: 100%;
            padding: 10px 12px;
            background: ${THEME.inputBg};
            border: 1px solid ${THEME.accent};
            border-radius: 6px;
            color: ${THEME.text};
            font-size: 12px;
            box-sizing: border-box;
          " />
        </div>

        <div id="stratix-api-key-row" style="padding: 16px; border-bottom: 1px solid ${THEME.border};">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
            API KEY ${!this.requiresApiKey() ? '(可选)' : ''}
          </label>
          <div style="display: flex; gap: 8px;">
            <input type="password" id="stratix-api-key" value="${this.currentConfig.apiKey || ''}" placeholder="${!this.requiresApiKey() ? '可选' : '必填'}" style="
              flex: 1;
              padding: 10px 12px;
              background: ${THEME.inputBg};
              border: 1px solid ${THEME.border};
              border-radius: 6px;
              color: ${THEME.text};
              font-size: 12px;
              box-sizing: border-box;
            " />
            <button id="stratix-toggle-api-key" style="
              padding: 10px 12px;
              background: transparent;
              border: 1px solid ${THEME.border};
              border-radius: 6px;
              color: ${THEME.textMuted};
              cursor: pointer;
              font-size: 12px;
            ">👁</button>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
            <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: ${THEME.textMuted}; cursor: pointer;">
              <input type="checkbox" id="stratix-save-api-key" style="cursor: pointer;" />
              Save API Key (encrypted)
            </label>
            <button id="stratix-load-saved-key" style="
              padding: 4px 8px;
              background: transparent;
              border: 1px solid ${THEME.border};
              border-radius: 4px;
              color: ${THEME.textMuted};
              cursor: pointer;
              font-size: 10px;
            ">Load saved</button>
          </div>
        </div>

        <div id="stratix-endpoint-row" style="padding: 16px; border-bottom: 1px solid ${THEME.border}; ${this.showEndpointRow() ? '' : 'display: none;'}">
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

      </div>
    `;
  }

  private generateProviderOptions(): string {
    const list = getCachedProviderList();
    const configs = getCachedProviderConfigs();
    return list.map(p => {
      const cfg = configs[p];
      if (!cfg) return '';
      const isSelected = p === this.currentConfig.provider;
      return `<option value="${p}" ${isSelected ? 'selected' : ''}>${cfg.icon} ${cfg.name}</option>`;
    }).join('') + '<option value="__add_custom__">+ Add Custom Provider...</option>';
  }

  private generateModelOptions(): string {
    const models = getModelsForProvider(this.currentConfig.provider);
    if (models.length === 0) return '';
    
    const currentModel = this.currentConfig.model;
    const isCustomModel = !models.includes(currentModel);
    
    let options = models.map(m => `<option value="${m}" ${currentModel === m && !isCustomModel ? 'selected' : ''}>${m}</option>`).join('');
    
    if (isCustomModel) {
      options += `<option value="${currentModel}" selected>${currentModel} (自定义)</option>`;
    }
    
    return options;
  }

  private getEndpointPlaceholder(): string {
    const configs = getCachedProviderConfigs();
    return configs[this.currentConfig.provider]?.defaultEndpoint || '';
  }

  private showEndpointRow(): boolean {
    const provider = this.currentConfig.provider;
    return provider === 'ollama' || provider === 'custom';
  }

  private requiresApiKey(): boolean {
    const provider = this.currentConfig.provider;
    if (provider === 'ollama') return false;
    if (provider === 'custom') return false;
    return true;
  }

  private showCustomModelInput(): boolean {
    const provider = this.currentConfig.provider;
    const models = getModelsForProvider(provider);
    return provider === 'custom' || models.length === 0;
  }

  private setupEventListeners(): void {
    if (!this.container) return;
    const node = this.container.node as HTMLElement;

    const providerSelect = node.querySelector('#stratix-provider') as HTMLSelectElement;
    providerSelect?.addEventListener('change', () => {
      const newProvider = providerSelect.value;
      
      if (newProvider === '__add_custom__') {
        this.showAddCustomProviderDialog().then((customProviderId) => {
          if (customProviderId) {
            this.currentConfig.provider = customProviderId as any;
            providerSelect.innerHTML = this.generateProviderOptions();
            providerSelect.value = customProviderId;
            
            const models = getModelsForProvider(customProviderId);
            this.currentConfig.model = models[0] || '';
            
            const modelSelect = node.querySelector('#stratix-model') as HTMLSelectElement;
            if (modelSelect) {
              modelSelect.innerHTML = this.generateModelOptions();
            }
          } else {
            providerSelect.value = this.currentConfig.provider;
          }
        });
        return;
      }
      
      this.currentConfig.provider = newProvider as any;
      
      const models = getModelsForProvider(newProvider);
      this.currentConfig.model = models[0] || '';
      
      const modelSelect = node.querySelector('#stratix-model') as HTMLSelectElement;
      if (modelSelect) {
        modelSelect.innerHTML = this.generateModelOptions();
        modelSelect.style.display = this.showCustomModelInput() ? 'none' : 'block';
      }
      
      const customModelRow = node.querySelector('#stratix-custom-model-row') as HTMLElement;
      if (customModelRow) {
        customModelRow.style.display = this.showCustomModelInput() ? 'block' : 'none';
      }
      
      const endpointRow = node.querySelector('#stratix-endpoint-row') as HTMLElement;
      if (endpointRow) {
        endpointRow.style.display = this.showEndpointRow() ? 'block' : 'none';
      }
      
      const apiKeyRow = node.querySelector('#stratix-api-key-row') as HTMLElement;
      if (apiKeyRow) {
        apiKeyRow.style.display = this.requiresApiKey() ? 'block' : 'none';
      }
      
      const apiKeyInput = node.querySelector('#stratix-api-key') as HTMLInputElement;
      if (apiKeyInput) {
        apiKeyInput.placeholder = this.requiresApiKey() ? '必填' : '可选';
      }
      
      const endpointInput = node.querySelector('#stratix-endpoint') as HTMLInputElement;
      if (endpointInput) {
        endpointInput.placeholder = this.getEndpointPlaceholder();
      }
      
      this.notifyChange();
    });

    const modelSelect = node.querySelector('#stratix-model') as HTMLSelectElement;
    modelSelect?.addEventListener('change', () => {
      if (modelSelect.value === '__custom__') {
        const customInput = node.querySelector('#stratix-custom-model-row') as HTMLElement;
        if (customInput) customInput.style.display = 'block';
        customInput?.querySelector('input')?.focus();
      } else {
        const customInput = node.querySelector('#stratix-custom-model-row') as HTMLElement;
        if (customInput) customInput.style.display = 'none';
        this.currentConfig.model = modelSelect.value;
        this.notifyChange();
      }
    });

    const customModelInput = node.querySelector('#stratix-custom-model') as HTMLInputElement;
    customModelInput?.addEventListener('input', () => {
      if (customModelInput.value.trim()) {
        this.currentConfig.model = customModelInput.value.trim();
        this.notifyChange();
      }
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

    const toggleApiKeyBtn = node.querySelector('#stratix-toggle-api-key') as HTMLButtonElement;
    toggleApiKeyBtn?.addEventListener('click', () => {
      if (apiKeyInput) {
        apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
      }
    });

    const loadSavedKeyBtn = node.querySelector('#stratix-load-saved-key') as HTMLButtonElement;
    loadSavedKeyBtn?.addEventListener('click', async () => {
      const provider = this.currentConfig.provider;
      const result = await loadApiKey(provider);
      if (result.success && result.data) {
        this.currentConfig.apiKey = result.data;
        (apiKeyInput as HTMLInputElement).value = result.data;
        this.notifyChange();
      }
    });
  }

  private notifyChange(): void {
    this.onChange?.(this.currentConfig);
  }

  refreshUI(): void {
    if (!this.container) return;

    const oldContainer = this.container;
    const parent = oldContainer.node.parentNode;
    if (!parent) return;

    oldContainer.destroy();

    const html = this.generateHTML();
    this.container = this.scene.add.dom(this.config.x, this.config.y).createFromHTML(html).setOrigin(0, 0).setDepth(Depth.UI_MODAL_CONTENT);
    this.setupEventListeners();

    parent.appendChild(this.container.node);
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

  async saveApiKeyIfNeeded(): Promise<void> {
    const node = this.container?.node as HTMLElement;
    if (!node) return;

    const saveCheckbox = node.querySelector('#stratix-save-api-key') as HTMLInputElement;
    const apiKey = this.currentConfig.apiKey;

    if (saveCheckbox?.checked && apiKey) {
      await saveApiKey(this.currentConfig.provider, apiKey);
    }
  }

  private async showAddCustomProviderDialog(): Promise<string | null> {
    return new Promise((resolve) => {
      const dialogHtml = `
        <div class="custom-provider-dialog" style="
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        ">
          <div style="
            background: ${THEME.bg};
            border: 1px solid ${THEME.border};
            border-radius: 12px;
            padding: 24px;
            width: 400px;
            max-width: 90vw;
          ">
            <h3 style="margin: 0 0 16px 0; color: ${THEME.text}; font-size: 16px;">Add Custom Provider</h3>
            
            <div style="margin-bottom: 12px;">
              <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 4px;">Provider ID (unique)</label>
              <input type="text" id="custom-provider-id" placeholder="e.g., my-company" style="
                width: 100%; padding: 8px 12px;
                background: ${THEME.inputBg};
                border: 1px solid ${THEME.border};
                border-radius: 6px;
                color: ${THEME.text};
                font-size: 12px;
                box-sizing: border-box;
              " />
            </div>
            
            <div style="margin-bottom: 12px;">
              <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 4px;">Display Name</label>
              <input type="text" id="custom-provider-name" placeholder="e.g., My Company API" style="
                width: 100%; padding: 8px 12px;
                background: ${THEME.inputBg};
                border: 1px solid ${THEME.border};
                border-radius: 6px;
                color: ${THEME.text};
                font-size: 12px;
                box-sizing: border-box;
              " />
            </div>
            
            <div style="margin-bottom: 12px;">
              <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 4px;">Endpoint URL</label>
              <input type="text" id="custom-provider-endpoint" placeholder="https://api.example.com/v1" style="
                width: 100%; padding: 8px 12px;
                background: ${THEME.inputBg};
                border: 1px solid ${THEME.border};
                border-radius: 6px;
                color: ${THEME.text};
                font-size: 12px;
                box-sizing: border-box;
              " />
            </div>
            
            <div style="margin-bottom: 12px;">
              <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 4px;">Models (comma separated)</label>
              <input type="text" id="custom-provider-models" placeholder="gpt-4, gpt-3.5-turbo" style="
                width: 100%; padding: 8px 12px;
                background: ${THEME.inputBg};
                border: 1px solid ${THEME.border};
                border-radius: 6px;
                color: ${THEME.text};
                font-size: 12px;
                box-sizing: border-box;
              " />
            </div>
            
            <div style="margin-bottom: 16px;">
              <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: ${THEME.textMuted};">
                <input type="checkbox" id="custom-provider-requires-key" checked />
                Requires API Key
              </label>
            </div>
            
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
              <button id="cancel-add-custom" style="
                padding: 8px 16px;
                background: transparent;
                border: 1px solid ${THEME.border};
                border-radius: 6px;
                color: ${THEME.text};
                cursor: pointer;
                font-size: 12px;
              ">Cancel</button>
              <button id="confirm-add-custom" style="
                padding: 8px 16px;
                background: ${THEME.accent};
                border: none;
                border-radius: 6px;
                color: ${THEME.bg};
                cursor: pointer;
                font-size: 12px;
              ">Add Provider</button>
            </div>
          </div>
        </div>
      `;

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = dialogHtml;
      document.body.appendChild(tempDiv);

      const dialog = tempDiv.querySelector('.custom-provider-dialog') as HTMLElement;
      const cancelBtn = dialog.querySelector('#cancel-add-custom') as HTMLButtonElement;
      const confirmBtn = dialog.querySelector('#confirm-add-custom') as HTMLButtonElement;

      cancelBtn.addEventListener('click', () => {
        document.body.removeChild(dialog);
        resolve(null);
      });

      confirmBtn.addEventListener('click', async () => {
        const providerId = (dialog.querySelector('#custom-provider-id') as HTMLInputElement).value.trim();
        const providerName = (dialog.querySelector('#custom-provider-name') as HTMLInputElement).value.trim();
        const endpoint = (dialog.querySelector('#custom-provider-endpoint') as HTMLInputElement).value.trim();
        const modelsStr = (dialog.querySelector('#custom-provider-models') as HTMLInputElement).value.trim();
        const requiresKey = (dialog.querySelector('#custom-provider-requires-key') as HTMLInputElement).checked;

        if (!providerId || !providerName || !endpoint) {
          alert('Please fill in all required fields');
          return;
        }

        const models = modelsStr ? modelsStr.split(',').map(m => m.trim()).filter(m => m) : [];

        const result = await addCustomProvider(providerId, {
          name: providerName,
          icon: '🏢',
          requiresApiKey: requiresKey,
          defaultEndpoint: endpoint,
          models: models,
          envKey: null,
        });

        if (result.success) {
          document.body.removeChild(dialog);
          this.refreshUI();
          resolve(providerId);
        } else {
          alert(result.message);
        }
      });
    });
  }

  destroy(): void {
    this.container?.destroy();
  }
}

export default StratixAgentConfigPanel;
