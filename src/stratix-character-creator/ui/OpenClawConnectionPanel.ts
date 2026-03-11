/**
 * OpenClawConnectionPanel - OpenClaw 连接管理面板
 * 
 * 支持两种连接方式：
 * - 配对连接（Device Pairing）- 本地/远程
 * - Tailscale 代理 - 无需 token
 */

import Phaser from 'phaser';
import { getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';
import { unifiedOpenClawConnectionManager, type TailscaleNode, type ConnectionResult, type StoredConnection } from '@/stratix-core/UnifiedOpenClawConnectionManager';
import type { OpenClawConnectionMethod } from '@/stratix-core/stratix-protocol';

const THEME = {
  bg: 'var(--ds-bg-secondary)',
  border: 'var(--ds-border)',
  accent: 'var(--ds-brand-primary)',
  accentDim: 'var(--ds-brand-secondary)',
  text: 'var(--ds-text-primary)',
  textMuted: 'var(--ds-text-muted)',
  success: 'var(--ds-status-success)',
  error: 'var(--ds-status-danger)',
  warning: 'var(--ds-status-warning)',
};

type PanelMode = 'pairing' | 'tailscale';
type PairingUIState = 'input' | 'connecting' | 'waiting_approval' | 'connected' | 'error';

export interface OpenClawConnectionPanelConfig {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  onConnected?: (connectionId?: string) => void;
}

export class OpenClawConnectionPanel {
  private scene: Phaser.Scene;
  private config: OpenClawConnectionPanelConfig;
  private container: Phaser.GameObjects.DOMElement | null = null;
  private currentMode: PanelMode = 'pairing';
  private pairingState: PairingUIState = 'input';
  private tailscaleNodes: TailscaleNode[] = [];
  private selectedNode: TailscaleNode | null = null;
  private savedConnections: StoredConnection[] = [];
  private deviceId: string = '';
  private pairingRequestId: string = '';
  private connectionId: string | null = null;
  private existingConnection: { id: string; name: string; status?: string } | null = null;

  constructor(scene: Phaser.Scene, config: OpenClawConnectionPanelConfig) {
    this.scene = scene;
    this.config = config;
    this.loadInitialData();
  }

  private async loadInitialData(): Promise<void> {
    this.deviceId = await unifiedOpenClawConnectionManager.getDeviceId();
    this.savedConnections = unifiedOpenClawConnectionManager.getSavedConnections();
    
    if (this.container) {
      this.updateDeviceIdDisplay();
      this.updateSavedConnectionsDisplay();
    }
  }

  create(): Phaser.GameObjects.DOMElement {
    const html = this.generateHTML();

    this.container = this.scene.add.dom(
      this.config.x || 0,
      this.config.y || 0
    ).createFromHTML(html).setOrigin(0, 0).setDepth(Depth.UI_MODAL_CONTENT);

    this.setupEventListeners();

    return this.container;
  }

  private generateHTML(): string {
    const width = this.config.width || 400;
    const height = this.config.height || 520;

    return `
      <div class="connection-panel" style="
        width: ${width}px;
        height: ${height}px;
        background: ${THEME.bg};
        border: 1px solid ${THEME.border};
        border-radius: 8px;
        font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
        color: ${THEME.text};
        display: flex;
        flex-direction: column;
        overflow: hidden;
      ">
        <div class="header" style="
          padding: 16px;
          border-bottom: 1px solid ${THEME.border};
        ">
          <div style="font-size: 11px; color: ${THEME.textMuted}; letter-spacing: 1px; margin-bottom: 4px;">第二步 STEP 2</div>
          <div style="font-size: 14px; color: ${THEME.accent};">链接服务 OpenClaw Connection</div>
        </div>
        
        <div class="mode-selector" style="
          display: flex;
          gap: 12px;
          padding: 16px;
          border-bottom: 1px solid ${THEME.border};
        ">
          <button class="mode-btn ${this.currentMode === 'pairing' ? 'active' : ''}" data-mode="pairing" style="
            flex: 1;
            padding: 12px 16px;
            background: ${this.currentMode === 'pairing' ? THEME.accentDim : 'transparent'};
            border: 1px solid ${this.currentMode === 'pairing' ? THEME.accent : THEME.border};
            border-radius: 6px;
            color: ${this.currentMode === 'pairing' ? THEME.accent : THEME.textMuted};
            font-size: 12px;
            font-family: inherit;
            cursor: pointer;
            transition: all 0.2s;
          ">
            <div style="font-size: 16px; margin-bottom: 4px;">🔑</div>
            <div>配对连接</div>
            <div style="font-size: 10px; color: ${THEME.textMuted};">本地/远程</div>
          </button>
          <button class="mode-btn ${this.currentMode === 'tailscale' ? 'active' : ''}" data-mode="tailscale" style="
            flex: 1;
            padding: 12px 16px;
            background: ${this.currentMode === 'tailscale' ? THEME.accentDim : 'transparent'};
            border: 1px solid ${this.currentMode === 'tailscale' ? THEME.accent : THEME.border};
            border-radius: 6px;
            color: ${this.currentMode === 'tailscale' ? THEME.accent : THEME.textMuted};
            font-size: 12px;
            font-family: inherit;
            cursor: pointer;
            transition: all 0.2s;
          ">
            <div style="font-size: 16px; margin-bottom: 4px;">🌐</div>
            <div>Tailscale</div>
            <div style="font-size: 10px; color: ${THEME.textMuted};">推荐，零配置</div>
          </button>
        </div>

        <div class="config-content" style="
          flex: 1;
          padding: 16px;
          overflow-y: auto;
        ">
          ${this.generatePairingHTML()}
          ${this.generateTailscaleHTML()}
          ${this.generateSavedConnectionsHTML()}
        </div>

        <div class="status-bar" style="
          padding: 12px 16px;
          background: var(--ds-bg-primary);
          border-top: 1px solid ${THEME.border};
          display: flex;
          align-items: center;
          gap: 8px;
        ">
          <div id="status-indicator" style="
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: ${THEME.textMuted};
          "></div>
          <span id="status-text" style="font-size: 11px; color: ${THEME.textMuted};">未连接</span>
          <span id="device-id" style="
            margin-left: auto;
            font-size: 10px;
            color: ${THEME.textMuted};
            opacity: 0.6;
          ">设备ID: ${this.deviceId}</span>
        </div>

        <div class="actions" style="
          padding: 12px 16px;
          background: var(--ds-bg-primary);
          border-top: 1px solid ${THEME.border};
          display: flex;
          justify-content: flex-end;
          gap: 12px;
        ">
          <button id="cancel-btn" style="
            padding: 10px 20px;
            background: transparent;
            border: 1px solid ${THEME.border};
            border-radius: 4px;
            color: ${THEME.textMuted};
            font-size: 12px;
            font-family: inherit;
            cursor: pointer;
          ">取消</button>
          <button id="connect-btn" style="
            padding: 10px 24px;
            background: ${THEME.success};
            border: none;
            border-radius: 4px;
            color: var(--ds-bg-primary);
            font-size: 12px;
            font-family: inherit;
            cursor: pointer;
            font-weight: bold;
          ">连接并继续 →</button>
        </div>
      </div>
      <style>
        .mode-btn:hover {
          background: ${THEME.accentDim} !important;
          border-color: ${THEME.accent} !important;
        }
        #connect-btn:hover {
          background: var(--ds-status-success) !important;
        }
        .saved-connection-item {
          display: flex;
          align-items: center;
          padding: 8px 12px;
          margin-bottom: 4px;
          background: var(--ds-bg-primary);
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .saved-connection-item:hover {
          background: ${THEME.accentDim};
          border-color: ${THEME.accent};
        }
        .saved-connection-item.selected {
          border-color: ${THEME.success};
          background: rgba(74, 222, 128, 0.1);
        }
        .tailscale-node-item {
          display: flex;
          align-items: center;
          padding: 10px 12px;
          margin-bottom: 4px;
          background: var(--ds-bg-primary);
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .tailscale-node-item:hover {
          background: ${THEME.accentDim};
          border-color: ${THEME.accent};
        }
        .tailscale-node-item.selected {
          border-color: ${THEME.success};
          background: rgba(74, 222, 128, 0.1);
        }
      </style>
    `;
  }

  private generatePairingHTML(): string {
    return `
      <div id="config-pairing" class="config-section" style="display: ${this.currentMode === 'pairing' ? 'block' : 'none'};">
        <div class="prerequisite-box" style="
          background: var(--ds-bg-secondary);
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          padding: 12px;
          margin-bottom: 16px;
        ">
          <div style="font-size: 11px; color: ${THEME.warning}; margin-bottom: 6px;">⚠️ 前置条件</div>
          <div style="font-size: 11px; color: ${THEME.textMuted}; line-height: 1.6;">
            请确保 OpenClaw Gateway 已启动。首次连接需要 Shared Token。<br>
            <span style="opacity: 0.6;">Ensure OpenClaw Gateway is running. First connection requires Shared Token.</span>
          </div>
        </div>
        
        <div style="margin-bottom: 12px;">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 8px;">Endpoint</label>
          <input type="text" id="pairing-endpoint" value="ws://127.0.0.1:18789" placeholder="ws://127.0.0.1:18789 或 wss://remote.server.com" style="
            width: 100%;
            padding: 10px 12px;
            background: var(--ds-bg-primary);
            border: 1px solid ${THEME.border};
            border-radius: 4px;
            color: ${THEME.text};
            font-size: 12px;
            font-family: inherit;
            box-sizing: border-box;
          " />
        </div>
        
        <div style="margin-bottom: 12px;">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 8px;">
            Shared Token <span style="opacity: 0.5;">(首次连接需要，后续自动使用 Device Token)</span>
          </label>
          <input type="password" id="shared-token" placeholder="输入 gateway.auth.token" style="
            width: 100%;
            padding: 10px 12px;
            background: var(--ds-bg-primary);
            border: 1px solid ${THEME.border};
            border-radius: 4px;
            color: ${THEME.text};
            font-size: 12px;
            font-family: inherit;
            box-sizing: border-box;
          " />
        </div>

        <div id="pairing-status-box" style="
          display: none;
          background: var(--ds-bg-secondary);
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          padding: 12px;
          margin-top: 12px;
        ">
          <div id="pairing-status-icon" style="font-size: 14px; margin-bottom: 8px;">⏳</div>
          <div id="pairing-status-text" style="font-size: 12px; color: ${THEME.textMuted};"></div>
          <div id="pairing-hint" style="
            display: none;
            margin-top: 8px;
            padding: 8px;
            background: var(--ds-bg-primary);
            border-radius: 4px;
            font-size: 11px;
            font-family: monospace;
            color: ${THEME.textMuted};
          "></div>
        </div>
      </div>
    `;
  }

  private generateTailscaleHTML(): string {
    return `
      <div id="config-tailscale" class="config-section" style="display: ${this.currentMode === 'tailscale' ? 'block' : 'none'};">
        <div class="prerequisite-box" style="
          background: var(--ds-bg-secondary);
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          padding: 12px;
          margin-bottom: 16px;
        ">
          <div style="font-size: 11px; color: ${THEME.success}; margin-bottom: 6px;">✨ Tailscale 模式</div>
          <div style="font-size: 11px; color: ${THEME.textMuted}; line-height: 1.6;">
            无需 token，Tailscale 身份自动验证。请确保双方都在同一 Tailscale 网络中。<br>
            <span style="opacity: 0.6;">No token needed. Tailscale identity auto-verification.</span>
          </div>
        </div>

        <div style="margin-bottom: 12px;">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 8px;">MagicDNS 地址 (手动输入)</label>
          <input type="text" id="tailscale-endpoint" placeholder="my-server.tailnet.ts.net" style="
            width: 100%;
            padding: 10px 12px;
            background: var(--ds-bg-primary);
            border: 1px solid ${THEME.border};
            border-radius: 4px;
            color: ${THEME.text};
            font-size: 12px;
            font-family: inherit;
            box-sizing: border-box;
          " />
        </div>

        <div style="
          text-align: center;
          color: ${THEME.textMuted};
          font-size: 11px;
          margin: 16px 0;
        ">────────────── 或扫描节点 ──────────────</div>

        <button id="scan-tailscale-btn" style="
          width: 100%;
          padding: 10px 16px;
          background: ${THEME.accentDim};
          border: 1px solid ${THEME.accent};
          border-radius: 4px;
          color: ${THEME.accent};
          font-size: 12px;
          font-family: inherit;
          cursor: pointer;
          margin-bottom: 12px;
        ">扫描 Tailscale 节点</button>

        <div id="tailscale-nodes-list" style="
          min-height: 60px;
          padding: 8px;
          background: var(--ds-bg-primary);
          border: 1px solid ${THEME.border};
          border-radius: 4px;
        ">
          <p style="color: ${THEME.textMuted}; font-size: 11px; text-align: center;">点击扫描按钮发现可用节点</p>
        </div>
      </div>
    `;
  }

  private generateSavedConnectionsHTML(): string {
    const hasConnections = this.savedConnections.length > 0;
    
    return `
      <div id="saved-connections" style="
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid ${THEME.border};
        display: ${hasConnections && this.currentMode === 'pairing' ? 'block' : 'none'};
      ">
        <div style="font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 8px;">已保存的连接:</div>
        <div id="saved-connections-list">
          ${this.savedConnections.map(conn => `
            <div class="saved-connection-item" data-endpoint="${conn.endpoint}" data-method="${conn.method}">
              <span style="font-size: 16px; margin-right: 8px;">${conn.method === 'tailscale' ? '🌐' : '🔑'}</span>
              <div style="flex: 1;">
                <div style="font-size: 11px; color: ${THEME.text};">${conn.name}</div>
                <div style="font-size: 10px; color: ${THEME.textMuted};">${conn.endpoint}</div>
              </div>
              ${conn.deviceToken ? '<span style="color: ' + THEME.success + '; font-size: 10px;">✓</span>' : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;

    node.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = (e.currentTarget as HTMLElement).dataset.mode as PanelMode;
        if (mode) {
          this.switchMode(mode);
        }
      });
    });

    const scanBtn = node.querySelector('#scan-tailscale-btn');
    scanBtn?.addEventListener('click', () => {
      this.scanTailscaleNodes();
    });

    const connectBtn = node.querySelector('#connect-btn');
    connectBtn?.addEventListener('click', () => {
      this.handleConnect();
    });

    const cancelBtn = node.querySelector('#cancel-btn');
    cancelBtn?.addEventListener('click', () => {
      this.updateStatus('disconnected', '未连接');
    });

    node.querySelectorAll('.saved-connection-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const endpoint = (e.currentTarget as HTMLElement).dataset.endpoint!;
        const method = (e.currentTarget as HTMLElement).dataset.method as 'pairing' | 'tailscale';
        
        if (method === 'pairing') {
          const endpointInput = node.querySelector('#pairing-endpoint') as HTMLInputElement;
          if (endpointInput) endpointInput.value = endpoint;
        } else {
          const tsInput = node.querySelector('#tailscale-endpoint') as HTMLInputElement;
          if (tsInput) tsInput.value = endpoint.replace(/^wss?:\/\//, '').replace(/\/ws$/, '');
        }
        
        this.switchMode(method);
      });
    });
  }

  private switchMode(mode: PanelMode): void {
    this.currentMode = mode;
    
    if (!this.container) return;
    const node = this.container.node as HTMLElement;

    node.querySelectorAll('.mode-btn').forEach(btn => {
      const btnMode = (btn as HTMLElement).dataset.mode;
      const isActive = btnMode === mode;
      (btn as HTMLElement).style.background = isActive ? THEME.accentDim : 'transparent';
      (btn as HTMLElement).style.borderColor = isActive ? THEME.accent : THEME.border;
      (btn as HTMLElement).style.color = isActive ? THEME.accent : THEME.textMuted;
    });

    const pairingSection = node.querySelector('#config-pairing') as HTMLElement;
    const tailscaleSection = node.querySelector('#config-tailscale') as HTMLElement;
    const savedSection = node.querySelector('#saved-connections') as HTMLElement;

    if (pairingSection) pairingSection.style.display = mode === 'pairing' ? 'block' : 'none';
    if (tailscaleSection) tailscaleSection.style.display = mode === 'tailscale' ? 'block' : 'none';
    if (savedSection) savedSection.style.display = mode === 'pairing' && this.savedConnections.length > 0 ? 'block' : 'none';
  }

  private async scanTailscaleNodes(): Promise<void> {
    if (!this.container) return;
    const node = this.container.node as HTMLElement;
    const listEl = node.querySelector('#tailscale-nodes-list') as HTMLElement;

    if (listEl) {
      listEl.innerHTML = `<p style="color: ${THEME.warning}; font-size: 11px; text-align: center;">扫描中...</p>`;
    }

    this.tailscaleNodes = await unifiedOpenClawConnectionManager.discoverTailscaleNodes();

    if (!listEl) return;

    if (this.tailscaleNodes.length === 0) {
      listEl.innerHTML = `
        <p style="color: ${THEME.textMuted}; font-size: 11px; text-align: center;">
          未发现节点<br>
          <span style="opacity: 0.6;">请手动输入 MagicDNS 地址</span>
        </p>
      `;
      return;
    }

    listEl.innerHTML = this.tailscaleNodes.map(n => `
      <div class="tailscale-node-item ${this.selectedNode?.nodeId === n.nodeId ? 'selected' : ''}" data-node-id="${n.nodeId}">
        <span style="font-size: 14px; margin-right: 8px;">${n.online ? '🟢' : '⚫'}</span>
        <div style="flex: 1;">
          <div style="font-size: 11px; color: ${THEME.text};">${n.name}</div>
          <div style="font-size: 10px; color: ${THEME.textMuted};">${n.ipAddress}${n.latency ? ` · ${n.latency}ms` : ''}</div>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.tailscale-node-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const nodeId = (e.currentTarget as HTMLElement).dataset.nodeId;
        const selectedNode = this.tailscaleNodes.find(n => n.nodeId === nodeId);
        
        if (selectedNode) {
          this.selectedNode = selectedNode;
          listEl.querySelectorAll('.tailscale-node-item').forEach(i => i.classList.remove('selected'));
          (e.currentTarget as HTMLElement).classList.add('selected');

          const tsInput = node.querySelector('#tailscale-endpoint') as HTMLInputElement;
          if (tsInput) {
            tsInput.value = selectedNode.name || selectedNode.ipAddress;
          }
        }
      });
    });
  }

  private async handleConnect(): Promise<void> {
    if (!this.container) return;
    const node = this.container.node as HTMLElement;

    if (this.currentMode === 'pairing') {
      await this.handlePairingConnect(node);
    } else {
      await this.handleTailscaleConnect(node);
    }
  }

  private async handlePairingConnect(node: HTMLElement): Promise<void> {
    const endpointInput = node.querySelector('#pairing-endpoint') as HTMLInputElement;
    const tokenInput = node.querySelector('#shared-token') as HTMLInputElement;

    const endpoint = endpointInput?.value?.trim();
    const sharedToken = tokenInput?.value?.trim();

    if (!endpoint) {
      this.updateStatus('error', '请输入 Endpoint');
      return;
    }

    this.updateStatus('connecting', '检查连接...');
    
    const checkResult = await unifiedOpenClawConnectionManager.checkEndpointExists(endpoint);
    
    if (checkResult.exists && checkResult.connection) {
      this.showExistingConnectionDialog(node, checkResult.connection, endpoint, sharedToken);
      return;
    }

    const storedToken = await unifiedOpenClawConnectionManager.getStoredDeviceToken(endpoint);
    const token = storedToken || sharedToken;

    if (!token) {
      this.updateStatus('error', '请输入 Shared Token');
      return;
    }

    await this.doPairConnect(endpoint, token);
  }

  private showExistingConnectionDialog(
    node: HTMLElement, 
    existingConn: { id: string; name: string; status?: string },
    endpoint: string,
    sharedToken?: string
  ): void {
    const statusBox = node.querySelector('#pairing-status-box') as HTMLElement;
    const statusIcon = node.querySelector('#pairing-status-icon') as HTMLElement;
    const statusText = node.querySelector('#pairing-status-text') as HTMLElement;
    const statusHint = node.querySelector('#pairing-hint') as HTMLElement;

    if (!statusBox || !statusIcon || !statusText || !statusHint) return;

    statusBox.style.display = 'block';
    statusIcon.textContent = '⚠️';
    statusText.style.color = THEME.warning;
    statusText.textContent = '此 endpoint 已存在配置';
    
    statusHint.style.display = 'block';
    statusHint.innerHTML = `
      <div style="margin-bottom: 8px;">
        <strong>名称:</strong> ${existingConn.name}<br>
        <strong>状态:</strong> ${existingConn.status || '未知'}
      </div>
      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <button id="use-existing-btn" style="
          flex: 1;
          padding: 8px 12px;
          background: ${THEME.success};
          border: none;
          border-radius: 4px;
          color: var(--ds-bg-primary);
          font-size: 11px;
          cursor: pointer;
        ">使用已有配置</button>
        <button id="update-existing-btn" style="
          flex: 1;
          padding: 8px 12px;
          background: transparent;
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          color: ${THEME.textMuted};
          font-size: 11px;
          cursor: pointer;
        ">更新现有配置</button>
      </div>
    `;

    const useExistingBtn = statusHint.querySelector('#use-existing-btn');
    const updateExistingBtn = statusHint.querySelector('#update-existing-btn');

    useExistingBtn?.addEventListener('click', async () => {
      this.updateStatus('connecting', '正在连接...');

      const result = await unifiedOpenClawConnectionManager.connectViaProxy(existingConn.id);

      if (result.success) {
        this.connectionId = existingConn.id;
        this.showPairingStatus('connected', '使用已有配置');
        this.updateStatus('connected', '已连接');
        this.config.onConnected?.(existingConn.id);
      } else {
        this.showPairingStatus('error', result.message || '连接失败');
        this.updateStatus('error', result.message || '连接失败');
      }
    });

    updateExistingBtn?.addEventListener('click', async () => {
      // 重新从输入框获取 token，因为用户可能在弹窗显示后修改了
      const tokenInput = node.querySelector('#shared-token') as HTMLInputElement;
      const currentToken = tokenInput?.value?.trim() || sharedToken;
      
      if (!currentToken) {
        this.updateStatus('error', '请输入 Shared Token');
        return;
      }
      await this.doUpdateAndConnect(existingConn.id, endpoint, currentToken);
    });
  }

  private async doPairConnect(endpoint: string, token: string): Promise<void> {
    this.updateStatus('connecting', '正在连接...');
    this.showPairingStatus('connecting', '正在连接...');

    try {
      const result = await unifiedOpenClawConnectionManager.pairConnect(endpoint, token);
      
      if (result.success) {
        this.connectionId = unifiedOpenClawConnectionManager.getConnectionId();
        this.showPairingStatus('connected', `连接成功 (${result.latency || 0}ms)`);
        this.updateStatus('connected', `已连接 (${result.latency || 0}ms)`);
        this.config.onConnected?.(this.connectionId || undefined);
      } else if (result.state === 'pairing') {
        this.showPairingStatus('waiting', '等待管理员批准...', result.pairingRequestId);
        this.updateStatus('connecting', '等待批准...');
        
        unifiedOpenClawConnectionManager.startPairingPolling((pollResult) => {
          if (pollResult.success) {
            this.connectionId = unifiedOpenClawConnectionManager.getConnectionId();
            this.showPairingStatus('connected', '配对成功！');
            this.updateStatus('connected', '已连接');
            this.config.onConnected?.(this.connectionId || undefined);
          }
        }, 3000);
      } else {
        this.showPairingStatus('error', result.message);
        this.updateStatus('error', result.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接失败';
      this.showPairingStatus('error', message);
      this.updateStatus('error', message);
    }
  }

  private async doUpdateAndConnect(connectionId: string, endpoint: string, sharedToken: string): Promise<void> {
    console.log('[OpenClawPanel] doUpdateAndConnect called:', { connectionId, endpoint, hasToken: !!sharedToken });
    
    this.updateStatus('connecting', '正在更新配置...');
    this.showPairingStatus('connecting', '正在更新配置...');

    try {
      // 调用 API 更新现有连接的 sharedToken
      console.log('[OpenClawPanel] Calling PUT /api/stratix/openclaw/connections/' + connectionId);
      const response = await fetch(`/api/stratix/openclaw/connections/${connectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sharedToken }),
      });

      const result = await response.json();
      console.log('[OpenClawPanel] PUT response:', result);

      if (result.code !== 200) {
        this.showPairingStatus('error', result.message || '更新失败');
        this.updateStatus('error', result.message || '更新失败');
        return;
      }

      // 重新连接
      console.log('[OpenClawPanel] Calling connectViaProxy');
      const connectResult = await unifiedOpenClawConnectionManager.connectViaProxy(connectionId);
      console.log('[OpenClawPanel] connectViaProxy result:', connectResult);

      if (connectResult.success) {
        this.connectionId = connectionId;
        this.showPairingStatus('connected', `更新并连接成功 (${connectResult.latency || 0}ms)`);
        this.updateStatus('connected', `已连接 (${connectResult.latency || 0}ms)`);
        this.config.onConnected?.(connectionId);
      } else if (connectResult.state === 'pairing') {
        this.showPairingStatus('waiting', '等待管理员批准...', connectResult.pairingRequestId);
        this.updateStatus('connecting', '等待批准...');

        unifiedOpenClawConnectionManager.startPairingPolling((pollResult) => {
          if (pollResult.success) {
            this.connectionId = unifiedOpenClawConnectionManager.getConnectionId();
            this.showPairingStatus('connected', '配对成功！');
            this.updateStatus('connected', '已连接');
            this.config.onConnected?.(this.connectionId || undefined);
          }
        }, 3000);
      } else {
        this.showPairingStatus('error', connectResult.message);
        this.updateStatus('error', connectResult.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新失败';
      console.error('[OpenClawPanel] doUpdateAndConnect error:', error);
      this.showPairingStatus('error', message);
      this.updateStatus('error', message);
    }
  }

  private async handleTailscaleConnect(node: HTMLElement): Promise<void> {
    const endpointInput = node.querySelector('#tailscale-endpoint') as HTMLInputElement;
    let endpoint = endpointInput?.value?.trim();

    if (!endpoint) {
      if (this.selectedNode) {
        endpoint = this.selectedNode.ipAddress;
      } else {
        this.updateStatus('error', '请输入 MagicDNS 地址或选择节点');
        return;
      }
    }

    if (!endpoint.startsWith('ws://') && !endpoint.startsWith('wss://')) {
      if (endpoint.includes('.ts.net') || endpoint.includes('.tailscale')) {
        endpoint = `wss://${endpoint}`;
      } else {
        endpoint = `ws://${endpoint}`;
      }
    }

    this.updateStatus('connecting', '检查连接...');

    const checkResult = await unifiedOpenClawConnectionManager.checkEndpointExists(endpoint);
    
    if (checkResult.exists && checkResult.connection) {
      this.connectionId = checkResult.connection.id;
      this.updateStatus('connected', `使用已有配置: ${checkResult.connection.name}`);
      this.config.onConnected?.(this.connectionId);
      return;
    }

    this.updateStatus('connecting', '正在连接...');

    try {
      const result = await unifiedOpenClawConnectionManager.tailscaleConnect(endpoint);
      
      if (result.success) {
        this.connectionId = unifiedOpenClawConnectionManager.getConnectionId();
        this.updateStatus('connected', `已连接 (${result.latency || 0}ms)`);
        this.config.onConnected?.(this.connectionId || undefined);
      } else {
        this.updateStatus('error', result.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接失败';
      this.updateStatus('error', message);
    }
  }

  getConnectionId(): string | null {
    return this.connectionId;
  }

  private showPairingStatus(state: 'connecting' | 'waiting' | 'connected' | 'error', message: string, requestId?: string): void {
    if (!this.container) return;
    const node = this.container.node as HTMLElement;

    const statusBox = node.querySelector('#pairing-status-box') as HTMLElement;
    const statusIcon = node.querySelector('#pairing-status-icon') as HTMLElement;
    const statusText = node.querySelector('#pairing-status-text') as HTMLElement;
    const statusHint = node.querySelector('#pairing-hint') as HTMLElement;

    if (!statusBox || !statusIcon || !statusText) return;

    statusBox.style.display = 'block';

    const states = {
      connecting: { icon: '⏳', color: THEME.warning },
      waiting: { icon: '🔐', color: THEME.warning },
      connected: { icon: '✅', color: THEME.success },
      error: { icon: '❌', color: THEME.error },
    };

    statusIcon.textContent = states[state].icon;
    statusText.textContent = message;
    statusText.style.color = states[state].color;

    if (state === 'waiting' && requestId) {
      this.pairingRequestId = requestId;
      statusHint!.style.display = 'block';
      statusHint!.innerHTML = `
        💡 请在 OpenClaw Gateway 终端执行:<br>
        <code style="color: ${THEME.accent};">openclaw nodes approve ${requestId}</code>
      `;
    } else if (statusHint) {
      statusHint.style.display = 'none';
    }
  }

  private updateStatus(status: 'disconnected' | 'connecting' | 'connected' | 'error', message: string): void {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;
    const indicator = node.querySelector('#status-indicator') as HTMLElement;
    const text = node.querySelector('#status-text') as HTMLElement;

    if (!indicator || !text) return;

    const colors = {
      disconnected: THEME.textMuted,
      connecting: THEME.warning,
      connected: THEME.success,
      error: THEME.error,
    };

    indicator.style.background = colors[status];
    text.textContent = message;
    text.style.color = colors[status];
  }

  private updateDeviceIdDisplay(): void {
    if (!this.container) return;
    const node = this.container.node as HTMLElement;
    const deviceIdEl = node.querySelector('#device-id') as HTMLElement;
    if (deviceIdEl) {
      deviceIdEl.textContent = `设备ID: ${this.deviceId}`;
    }
  }

  private updateSavedConnectionsDisplay(): void {
    // Refresh saved connections display if needed
  }

  destroy(): void {
    unifiedOpenClawConnectionManager.stopPairingPolling();
    this.container?.destroy();
  }
}

export default OpenClawConnectionPanel;
