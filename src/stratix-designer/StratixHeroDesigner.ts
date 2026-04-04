import StratixEventBus from '@/stratix-core/StratixEventBus';
import {
  StratixAgentConfig,
  StratixApiResponse,
  StratixStateSyncEvent,
} from '@/stratix-core/stratix-protocol';

import { WriterHeroTemplate, DevHeroTemplate, AnalystHeroTemplate, HeroType } from './templates';
import { ConfigValidator, ConfigConverter } from './utils';


export interface HeroDesignerOptions {
  onSaveConfig?: (config: StratixAgentConfig) => Promise<StratixApiResponse>;
  onLoadConfig?: (agentId: string) => Promise<StratixAgentConfig | null>;
  onDeleteConfig?: (agentId: string) => Promise<StratixApiResponse>;
}

export class StratixHeroDesigner {
  private eventBus: StratixEventBus;
  private currentConfig: StratixAgentConfig | null = null;
  private presetTemplates: StratixAgentConfig[];
  private options: HeroDesignerOptions;

  constructor(options: HeroDesignerOptions = {}) {
    this.eventBus = StratixEventBus.getInstance();
    this.options = options;
    this.presetTemplates = [
      new WriterHeroTemplate().getTemplate(),
      new DevHeroTemplate().getTemplate(),
      new AnalystHeroTemplate().getTemplate(),
    ];
  }

  createNewHero(heroType: HeroType): StratixAgentConfig {
    let template: StratixAgentConfig;

    switch (heroType) {
      case 'writer':
        template = new WriterHeroTemplate().getTemplate();
        break;
      case 'dev':
        template = new DevHeroTemplate().getTemplate();
        break;
      case 'analyst':
        template = new AnalystHeroTemplate().getTemplate();
        break;
      default:
        template = new WriterHeroTemplate().getTemplate();
    }

    this.currentConfig = template;
    return template;
  }

  async saveHeroConfig(config: StratixAgentConfig): Promise<StratixApiResponse> {
    const validateResult = ConfigValidator.validate(config);
    if (!validateResult.valid) {
      return {
        code: 400,
        message: validateResult.message,
        data: null,
        requestId: `stratix-req-${Date.now()}`,
      };
    }

    if (this.options.onSaveConfig) {
      const response = await this.options.onSaveConfig(config);
      if (response.code === 200) {
        this.currentConfig = config;
        this.emitConfigUpdated(config);
      }
      return response;
    }

    this.currentConfig = config;
    this.emitConfigUpdated(config);

    return {
      code: 200,
      message: '配置保存成功',
      data: config,
      requestId: `stratix-req-${Date.now()}`,
    };
  }

  async loadHeroConfig(agentId: string): Promise<StratixAgentConfig | null> {
    if (this.options.onLoadConfig) {
      const config = await this.options.onLoadConfig(agentId);
      if (config) {
        this.currentConfig = config;
      }
      return config;
    }

    const template = this.presetTemplates.find((t) => t.agentId === agentId);
    if (template) {
      this.currentConfig = template;
      return template;
    }

    if (this.currentConfig?.agentId === agentId) {
      return this.currentConfig;
    }

    return null;
  }

  async deleteHeroConfig(agentId: string): Promise<StratixApiResponse> {
    if (this.options.onDeleteConfig) {
      const response = await this.options.onDeleteConfig(agentId);
      if (response.code === 200) {
        this.emitConfigDeleted(agentId);
        if (this.currentConfig?.agentId === agentId) {
          this.currentConfig = null;
        }
      }
      return response;
    }

    if (this.currentConfig?.agentId === agentId) {
      this.currentConfig = null;
    }
    this.emitConfigDeleted(agentId);

    return {
      code: 200,
      message: '配置删除成功',
      data: null,
      requestId: `stratix-req-${Date.now()}`,
    };
  }

  importHeroConfig(configJson: string): StratixAgentConfig {
    try {
      const stratixConfig = ConfigConverter.fromJson(configJson);
      const validateResult = ConfigValidator.validate(stratixConfig);
      if (!validateResult.valid) {
        throw new Error(validateResult.message);
      }
      this.currentConfig = stratixConfig;
      return stratixConfig;
    } catch (error) {
      throw new Error(`配置导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  exportHeroConfig(agentId?: string): string {
    let exportConfig: StratixAgentConfig | undefined;

    if (agentId) {
      if (this.currentConfig?.agentId === agentId) {
        exportConfig = this.currentConfig;
      } else {
        exportConfig = this.presetTemplates.find((t) => t.agentId === agentId);
      }
    } else {
      exportConfig = this.currentConfig || undefined;
    }

    if (!exportConfig) {
      throw new Error('无当前配置可导出');
    }

    return ConfigConverter.toJson(exportConfig);
  }

  downloadHeroConfig(agentId?: string): void {
    const globalScope = globalThis as any;
    if (!globalScope.document) {
      throw new Error('downloadHeroConfig 仅在浏览器环境中可用，请使用 exportHeroConfig 获取 JSON 字符串');
    }

    const json = this.exportHeroConfig(agentId);
    let config: StratixAgentConfig;

    if (agentId) {
      config = this.currentConfig?.agentId === agentId
        ? this.currentConfig
        : this.presetTemplates.find((t) => t.agentId === agentId)!;
    } else {
      config = this.currentConfig!;
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = globalScope.document.createElement('a');
    link.href = url;
    link.download = `${config.name}-${config.agentId}.json`;
    globalScope.document.body.appendChild(link);
    link.click();
    globalScope.document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  getPresetTemplates(): StratixAgentConfig[] {
    return [...this.presetTemplates];
  }

  getCurrentConfig(): StratixAgentConfig | null {
    return this.currentConfig;
  }

  setCurrentConfig(config: StratixAgentConfig): void {
    this.currentConfig = config;
  }

  validateConfig(config: StratixAgentConfig): { valid: boolean; message: string } {
    return ConfigValidator.validate(config);
  }

  private emitConfigUpdated(config: StratixAgentConfig): void {
    const event: StratixStateSyncEvent = {
      eventType: 'stratix:config_updated',
      payload: {
        agentId: config.agentId,
        data: config,
      },
      timestamp: Date.now(),
      requestId: `stratix-req-${Date.now()}`,
    };
    this.eventBus.emit(event);
  }

  private emitConfigDeleted(agentId: string): void {
    const event: StratixStateSyncEvent = {
      eventType: 'stratix:config_updated',
      payload: {
        agentId,
        data: { deleted: true },
      },
      timestamp: Date.now(),
      requestId: `stratix-req-${Date.now()}`,
    };
    this.eventBus.emit(event);
  }
}
