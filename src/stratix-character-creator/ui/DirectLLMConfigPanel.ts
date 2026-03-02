import Phaser from 'phaser';
import { getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';
import { ContainerComponentBase } from '@/stratix-core/ui/ContainerComponent.base';
import type { DirectLLMConfig, LLMProvider } from '@/stratix-core/stratix-protocol';
import { PROVIDER_CONFIGS, PROVIDER_LIST, type ProviderConfig } from '../config/providerConfig';

export interface DirectLLMConfigPanelConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  initialConfig?: DirectLLMConfig;
  onChange?: (config: DirectLLMConfig) => void;
}

const THEME = {
  bg: getToken('colors.background.secondary'),
  border: getToken('colors.border.default'),
  accent: getToken('colors.primary'),
  text: getToken('colors.text.primary'),
  textMuted: getToken('colors.text.muted'),
  inputBg: getToken('colors.background.tertiary'),
  success: getToken('colors.semantic.success'),
  error: getToken('colors.semantic.danger'),
};

export class DirectLLMConfigPanel {
  private scene: Phaser.Scene;
  private config: DirectLLMConfigPanelConfig;
  private container: Phaser.GameObjects.DOMElement | null = null;
  private currentConfig: DirectLLMConfig;
  private onChange?: (config: DirectLLMConfig) => void;

  constructor(scene: Phaser.Scene, config: DirectLLMConfigPanelConfig) {
    this.scene = scene;
    this.config = config;
    this.currentConfig = config.initialConfig || {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 4096,
    };
    this.onChange = config.onChange;
  }

  create(): Phaser.GameObjects.DOMElement {
    const html = this.generateHTML();
    this.container = this.scene.add.dom(this.config.x, this.config.y).createFromHTML(html).setOrigin(0, 0).setDepth(Depth.UI_MODAL_CONTENT);
    this.setupEventListeners();
    return this.container;
  }

  private generateHTML(): string {
    const providerButtons = PROVIDER_LIST.map((p) => {
      const cfg = PROVIDER_CONFIGS[p];
      const isActive = p === this.currentConfig.provider;
      return `
        <button class="provider-btn" data-provider="${p}" style="
          padding: 10px 14px;
          background: ${isActive ? THEME.accent : 'transparent'};
          border: 1px solid ${isActive ? THEME.accent : THEME.border};
          border-radius: 8px;
          color: ${isActive ? THEME.bg : THEME.text};
          font-size: 12px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          min-width: 80px;
        ">
          <span style="font-size: 18px;">${cfg.icon}</span>
          <span>${cfg.name}</span>
        </button>
      `;
    }).join('');

    const currentProvider = PROVIDER_CONFIGS[this.currentConfig.provider];
    const modelOptions = currentProvider.models.map(
      (m) => `<option value="${m}" ${m === this.currentConfig.model ? 'selected' : ''}>${m}</option>`
    ).join('');

    const showApiKey = currentProvider.requiresApiKey;
    const showEndpoint = this.currentConfig.provider === 'ollama' || this.currentConfig.provider === 'custom';

    return `
      <div class="direct-llm-panel" style="
        width: ${this.config.width}px;
        height: ${this.config.height}px;
        background: ${THEME.bg};
        border: 1px solid ${THEME.border};
        border-radius: 8px;
        padding: 16px;
        font-family: system-ui, -apple-system, sans-serif;
        color: ${THEME.text};
        overflow-y: auto;
        box-sizing: border-box;
      ">
        <div class="section" style="margin-bottom: 16px;">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 8px;">
            LLM Provider
          </label>
          <div class="provider-buttons" style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${providerButtons}
          </div>
        </div>

        <div class="section" style="margin-bottom: 16px;">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
            Model
          </label>
          <div style="display: flex; gap: 8px;">
            <select id="model-select" style="
              flex: 1;
              padding: 10px 12px;
              background: ${THEME.inputBg};
              border: 1px solid ${THEME.border};
              border-radius: 6px;
              color: ${THEME.text};
              font-size: 12px;
            ">
              ${modelOptions}
            </select>
            ${this.currentConfig.provider === 'custom' ? `
              <input type="text" id="custom-model" placeholder="自定义模型名" value="${this.currentConfig.model}" style="
                flex: 1;
                padding: 10px 12px;
                background: ${THEME.inputBg};
                border: 1px solid ${THEME.border};
                border-radius: 6px;
                color: ${THEME.text};
                font-size: 12px;
              " />
            ` : ''}
          </div>
        </div>

        <div class="section api-key-section" style="margin-bottom: 16px; ${showApiKey ? '' : 'display: none;'}">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
            API Key
          </label>
          <div style="display: flex; gap: 8px;">
            <input type="password" id="api-key-input" value="${this.currentConfig.apiKey || ''}" placeholder="sk-..." style="
              flex: 1;
              padding: 10px 12px;
              background: ${THEME.inputBg};
              border: 1px solid ${THEME.border};
              border-radius: 6px;
              color: ${THEME.text};
              font-size: 12px;
            " />
            <button id="toggle-api-key" style="
              padding: 10px 12px;
              background: transparent;
              border: 1px solid ${THEME.border};
              border-radius: 6px;
              color: ${THEME.textMuted};
              cursor: pointer;
              font-size: 12px;
            ">👁</button>
          </div>
        </div>

        <div class="section endpoint-section" style="margin-bottom: 16px; ${showEndpoint ? '' : 'display: none;'}">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
            Endpoint URL ${this.currentConfig.provider === 'custom' ? '(必填)' : ''}
          </label>
          <input type="text" id="endpoint-input" value="${this.currentConfig.endpoint || currentProvider.defaultEndpoint}" placeholder="${currentProvider.defaultEndpoint}" style="
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
          <div style="display: flex; gap: 24px;">
            <div style="flex: 1;">
              <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
                Temperature: <span id="temp-value">${this.currentConfig.temperature ?? 0.7}</span>
              </label>
              <input type="range" id="temperature-slider" min="0" max="1" step="0.1" value="${this.currentConfig.temperature ?? 0.7}" style="
                width: 100%;
                accent-color: ${THEME.accent};
              " />
            </div>
            <div style="flex: 1;">
              <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
                Max Tokens
              </label>
              <input type="number" id="max-tokens-input" value="${this.currentConfig.maxTokens ?? 4096}" min="1" max="128000" style="
                width: 100%;
                padding: 8px 12px;
                background: ${THEME.inputBg};
                border: 1px solid ${THEME.border};
                border-radius: 6px;
                color: ${THEME.text};
                font-size: 12px;
                box-sizing: border-box;
              " />
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;

    node.querySelectorAll('.provider-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const provider = (e.currentTarget as HTMLElement).dataset.provider as LLMProvider;
        if (provider) {
          this.setProvider(provider);
        }
      });
    });

    const modelSelect = node.querySelector('#model-select') as HTMLSelectElement;
    const customModel = node.querySelector('#custom-model') as HTMLInputElement;
    const apiKeyInput = node.querySelector('#api-key-input') as HTMLInputElement;
    const endpointInput = node.querySelector('#endpoint-input') as HTMLInputElement;
    const temperatureSlider = node.querySelector('#temperature-slider') as HTMLInputElement;
    const tempValue = node.querySelector('#temp-value') as HTMLElement;
    const maxTokensInput = node.querySelector('#max-tokens-input') as HTMLInputElement;
    const toggleApiKey = node.querySelector('#toggle-api-key') as HTMLButtonElement;

    modelSelect?.addEventListener('change', (e) => {
      this.currentConfig.model = (e.target as HTMLSelectElement).value;
      this.notifyChange();
    });

    customModel?.addEventListener('input', (e) => {
      this.currentConfig.model = (e.target as HTMLInputElement).value;
      this.notifyChange();
    });

    apiKeyInput?.addEventListener('input', (e) => {
      this.currentConfig.apiKey = (e.target as HTMLInputElement).value;
      this.notifyChange();
    });

    endpointInput?.addEventListener('input', (e) => {
      this.currentConfig.endpoint = (e.target as HTMLInputElement).value;
      this.notifyChange();
    });

    temperatureSlider?.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      this.currentConfig.temperature = value;
      if (tempValue) tempValue.textContent = value.toString();
      this.notifyChange();
    });

    maxTokensInput?.addEventListener('input', (e) => {
      this.currentConfig.maxTokens = parseInt((e.target as HTMLInputElement).value, 10);
      this.notifyChange();
    });

    toggleApiKey?.addEventListener('click', () => {
      if (apiKeyInput) {
        apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
      }
    });
  }

  private setProvider(provider: LLMProvider): void {
    this.currentConfig.provider = provider;

    const cfg = PROVIDER_CONFIGS[provider];
    if (cfg.models.length > 0 && !cfg.models.includes(this.currentConfig.model)) {
      this.currentConfig.model = cfg.models[0];
    }

    if (provider !== 'custom') {
      this.currentConfig.endpoint = cfg.defaultEndpoint || undefined;
    }

    this.refreshUI();
    this.notifyChange();
  }

  private refreshUI(): void {
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

  private notifyChange(): void {
    this.onChange?.(this.getConfig());
  }

  getConfig(): DirectLLMConfig {
    return {
      provider: this.currentConfig.provider,
      model: this.currentConfig.model,
      endpoint: this.currentConfig.endpoint,
      apiKey: this.currentConfig.apiKey,
      temperature: this.currentConfig.temperature,
      maxTokens: this.currentConfig.maxTokens,
    };
  }

  setConfig(config: DirectLLMConfig): void {
    this.currentConfig = { ...config };
    this.refreshUI();
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const provider = PROVIDER_CONFIGS[this.currentConfig.provider];

    if (!this.currentConfig.model.trim()) {
      errors.push('请选择或输入模型名称');
    }

    if (provider.requiresApiKey && !this.currentConfig.apiKey?.trim()) {
      errors.push(`${provider.name} 需要 API Key`);
    }

    if (this.currentConfig.provider === 'custom' && !this.currentConfig.endpoint?.trim()) {
      errors.push('Custom 模式需要输入 Endpoint URL');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  destroy(): void {
    this.container?.destroy();
  }
}

export default DirectLLMConfigPanel;
