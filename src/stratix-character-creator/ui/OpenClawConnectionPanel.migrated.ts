/**
 * (Migrated)
 * OpenClawConnectionPanel - OpenClaw 连接管理面板
 * 
 * 支持多种连接模式：
 * - 本地 Gateway
 * - 远程直连
 * - Tailscale 节点 (Electron)
 */

import Phaser from 'phaser';
import { Depth } from '@/design-system/tokens/depth';
import type { UnifiedOpenClawConfig, OpenClawConnectionMode } from '@/stratix-core/stratix-protocol';
import { unifiedOpenClawConnectionManager, type TailscaleNode } from '@/stratix-core/UnifiedOpenClawConnectionManager';

const THEME = {
  bg: '#1a1a2e',
  bgSecondary: '#16213e',
  accent: '#0f3460',
  text: '#e0e0e0',
  textMuted: '#a0a0a0',
  border: '#2a2a4e',
  success: '#4ade80',
  error: '#f87171',
  warning: '#fbbf24',
};

export interface OpenClawConnectionPanelConfig {
  scene: Phaser.Scene;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  defaultMode?: OpenClawConnectionMode;
  defaultEndpoint?: string;
  onSave?: (config: UnifiedOpenClawConfig) => void;
}

export class OpenClawConnectionPanel {
  private scene: Phaser.Scene;
  private config: OpenClawConnectionPanelConfig;
  private container: Phaser.GameObjects.Container;
  private currentMode: OpenClawConnectionMode;
  private isElectron: boolean = false;
  private tailscaleNodes: TailscaleNode[] = [];
  private selectedNode: TailscaleNode | null = null;
  private connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';

  constructor(scene: Phaser.Scene, config: OpenClawConnectionPanelConfig) {
    this.scene = scene;
    this.config = config;
    this.currentMode = config.defaultMode || 'auto';
    this.isElectron = !!(typeof window !== 'undefined' && (window as any).electronAPI);
    
    const width = config.width || 400;
    const height = config.height || 500;
    this.container = scene.add.container(config.x || 0, config.y || 0).setDepth(Depth.UI_MODAL_CONTENT);
    this.createPanel(width, height);
    this.loadSavedConfig();
  }

  private createPanel(width?: number, height?: number): void {
    const panelWidth = width ?? (this.config.width || 400);
    const panelHeight = height ?? (this.config.height || 500);

    // Background
    const bg = this.scene.add.rectangle(0, 0, panelWidth, panelHeight, 0x1a1a2e, 0.95);
    bg.setOrigin(0.5);
    bg.setStrokeStyle(2, 0x0f3460);
    this.container.add(bg);

    // Title
    const title = this.scene.add.text(0, -panelHeight / 2 + 20, 'OpenClaw 连接配置', {
      fontFamily: 'Arial',
      fontSize: '18px',
      color: '#e0e0e0',
    });
    title.setOrigin(0.5, 0);
    this.container.add(title);

    // Mode selector
    this.createModeSelector(panelWidth, -panelHeight / 2 + 60);

    // Config inputs (created based on mode)
    this.createConfigInputs(panelWidth, -panelHeight / 2 + 100);

    // Connect button
    this.createConnectButton(panelWidth, panelHeight / 2 - 40);

    // Status indicator
    this.createStatusIndicator(panelWidth, panelHeight / 2 - 80);

    this.container.setDepth(1000);
  }

  private createModeSelector(width: number, y: number): void {
    const modes: Array<{ mode: OpenClawConnectionMode; label: string }> = [
      { mode: 'auto', label: '自动' },
      { mode: 'local', label: '本地' },
      { mode: 'remote', label: '远程' },
    ];

    if (this.isElectron) {
      modes.push({ mode: 'tailscale', label: 'Tailscale' });
    }

    const buttonWidth = (width - 40) / modes.length;
    const buttonHeight = 36;

    modes.forEach((mode, index) => {
      const x = -width / 2 + 20 + index * (buttonWidth + 5);
      
      const bg = this.scene.add.rectangle(x, y, buttonWidth, buttonHeight, 0x16213e);
      bg.setOrigin(0.5);
      bg.setStrokeStyle(1, this.currentMode === mode.mode ? 0x0f3460 : 0x2a2a4e);
      bg.setInteractive({ useHandCursor: true });
      
      const label = this.scene.add.text(x, y, mode.label, {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: this.currentMode === mode.mode ? '#e0e0e0' : '#a0a0a0',
      });
      label.setOrigin(0.5);

      bg.on('pointerdown', () => {
        this.currentMode = mode.mode;
        this.updateModeSelector(modes);
        this.updateConfigInputs();
      });

      this.container.add([bg, label]);
    });
  }

  private updateModeSelector(modes: Array<{ mode: OpenClawConnectionMode; label: string }>): void {
    this.container.removeAll(true);
    const width = this.config.width || 400;
    const height = this.config.height || 500;
    this.createPanel(width, height);
  }

  private createConfigInputs(width: number, y: number): void {
    // Inputs will be recreated based on mode
    this.updateConfigInputs();
  }

  private updateConfigInputs(): void {
    // Clear existing inputs
    const existingInputs = this.container.list.filter(child => {
      return child instanceof Phaser.GameObjects.DOMElement || 
             (child instanceof Phaser.GameObjects.Text && child.text.includes(':'));
    });
    existingInputs.forEach(child => child.destroy());

    switch (this.currentMode) {
      case 'local':
        this.createLocalInputs();
        break;
      case 'remote':
        this.createRemoteInputs();
        break;
      case 'tailscale':
        this.createTailscaleInputs();
        break;
      case 'auto':
      default:
        this.createAutoInputs();
        break;
    }
  }

  private createLocalInputs(): void {
    const input = this.createInputField(
      0, 0, 300, 36,
      'localEndpoint',
      'http://127.0.0.1:18789',
      '本地 Endpoint'
    );
    this.container.add(input);
  }

  private createRemoteInputs(): void {
    const input = this.createInputField(
      0, 0, 300, 36,
      'remoteEndpoint',
      '',
      '远程 Endpoint (ws://...)'
    );
    this.container.add(input);
  }

  private createTailscaleInputs(): void {
    if (!this.isElectron) return;

    const text = this.scene.add.text(0, 0, '点击扫描可用节点...', {
      fontFamily: 'Arial',
      fontSize: '12px',
      color: '#a0a0a0',
    });
    text.setOrigin(0.5);
    this.container.add(text);

    const scanButton = this.createButton(0, 40, 200, 36, '扫描节点', () => {
      this.scanTailscaleNodes();
    });
    this.container.add(scanButton);

    // Node list container
    const nodeListBg = this.scene.add.rectangle(0, 100, 300, 150, 0x16213e, 0.8);
    nodeListBg.setOrigin(0.5);
    this.container.add(nodeListBg);
  }

  private createAutoInputs(): void {
    const text = this.scene.add.text(0, 0, '自动选择最佳连接方式\n(本地 > Tailscale > 远程)', {
      fontFamily: 'Arial',
      fontSize: '12px',
      color: '#a0a0a0',
      align: 'center',
    });
    text.setOrigin(0.5);
    this.container.add(text);
  }

  private createInputField(x: number, y: number, width: number, height: number, 
                           id: string, value: string, placeholder: string): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y).setDepth(Depth.UI_MODAL_CONTENT);
    
    const bg = this.scene.add.rectangle(0, 0, width, height, 0x16213e);
    bg.setOrigin(0.5);
    bg.setStrokeStyle(1, 0x2a2a4e);
    container.add(bg);

    const input = this.scene.add.dom(0, 0, 'input', {
      width: `${width - 20}px`,
      height: `${height - 10}px`,
      backgroundColor: 'transparent',
      border: 'none',
      color: '#e0e0e0',
      fontSize: '14px',
      padding: '5px 10px',
      placeholder,
      value,
    });
    container.add(input);

    return container;
  }

  private createButton(x: number, y: number, width: number, height: number,
                       label: string, onClick: () => void): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y).setDepth(Depth.UI_MODAL_CONTENT);
    
    const bg = this.scene.add.rectangle(0, 0, width, height, 0x0f3460);
    bg.setOrigin(0.5);
    bg.setInteractive({ useHandCursor: true });
    container.add(bg);

    const text = this.scene.add.text(0, 0, label, {
      fontFamily: 'Arial',
      fontSize: '14px',
      color: '#e0e0e0',
    });
    text.setOrigin(0.5);
    container.add(text);

    bg.on('pointerdown', onClick);
    bg.on('pointerover', () => bg.setFillStyle(0x1a4a8a));
    bg.on('pointerout', () => bg.setFillStyle(0x0f3460));

    return container;
  }

  private createConnectButton(width: number, y: number): void {
    const button = this.createButton(0, y, 200, 44, '连接', () => {
      this.handleConnect();
    });
    this.container.add(button);
  }

  private createStatusIndicator(width: number, y: number): void {
    const statusContainer = this.scene.add.container(0, y).setDepth(Depth.UI_MODAL_CONTENT);
    
    const indicator = this.scene.add.graphics();
    indicator.fillStyle(0xa0a0a0);
    indicator.fillCircle(-150, 0, 4);
    statusContainer.add(indicator);
    
    const text = this.scene.add.text(-130, 0, '未连接', {
      fontFamily: 'Arial',
      fontSize: '12px',
      color: '#a0a0a0',
    });
    text.setOrigin(0, 0.5);

    statusContainer.add(text);
    this.container.add(statusContainer);

    // Store reference for updates
    (statusContainer as any).indicator = indicator;
    (statusContainer as any).text = text;
  }

  private updateStatus(status: 'disconnected' | 'connecting' | 'connected' | 'error', message?: string): void {
    const statusContainer = this.container.list.find(c => 
      c instanceof Phaser.GameObjects.Container && (c as any).indicator
    ) as Phaser.GameObjects.Container & { indicator: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text };

    if (!statusContainer) return;

    this.connectionStatus = status;
    
    const colors = {
      disconnected: 0xa0a0a0,
      connecting: 0xfbbf24,
      connected: 0x4ade80,
      error: 0xf87171,
    };

    const messages = {
      disconnected: '未连接',
      connecting: '连接中...',
      connected: '已连接',
      error: message || '连接失败',
    };

    statusContainer.indicator.clear();
    statusContainer.indicator.fillStyle(colors[status]);
    statusContainer.indicator.fillCircle(-150, 0, 4);
    statusContainer.text.setText(messages[status]);
  }

  private async handleConnect(): Promise<void> {
    this.updateStatus('connecting');

    const config: UnifiedOpenClawConfig = {
      mode: this.currentMode,
      credentials: {},
    };

    try {
      const connected = await unifiedOpenClawConnectionManager.initialize(config);
      
      if (connected) {
        this.updateStatus('connected');
        this.saveConfig(config);
        this.config.onSave?.(config);
      } else {
        this.updateStatus('error', '连接失败');
      }
    } catch (error) {
      console.error('[ConnectionPanel] Connect failed:', error);
      this.updateStatus('error', error instanceof Error ? error.message : '连接失败');
    }
  }

  private async scanTailscaleNodes(): Promise<void> {
    if (!this.isElectron) return;

    const nodes = await unifiedOpenClawConnectionManager.discoverTailscaleNodes();
    this.tailscaleNodes = nodes;

    console.log('[ConnectionPanel] Discovered nodes:', nodes);
  }

  private saveConfig(config: UnifiedOpenClawConfig): void {
    try {
      localStorage.setItem('stratix_openclaw_config', JSON.stringify(config));
    } catch (e) {
      console.warn('[ConnectionPanel] Failed to save config:', e);
    }
  }

  private loadSavedConfig(): void {
    try {
      const saved = localStorage.getItem('stratix_openclaw_config');
      if (saved) {
        const config = JSON.parse(saved) as UnifiedOpenClawConfig;
        this.currentMode = config.mode || 'auto';
      }
    } catch (e) {
      console.warn('[ConnectionPanel] Failed to load config:', e);
    }
  }

  get isConnected(): boolean {
    return this.connectionStatus === 'connected';
  }

  destroy(): void {
    this.container.destroy();
  }
}

export default OpenClawConnectionPanel;
