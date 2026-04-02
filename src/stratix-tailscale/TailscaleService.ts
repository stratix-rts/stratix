import { exec } from 'child_process';
import { promisify } from 'util';

import axios from 'axios';

import {
  TailscaleStatus,
  TailscalePeer,
  TailscaleConfig,
  OpenClawNode,
  TailscaleEvent,
} from './types';

const execAsync = promisify(exec);

const DEFAULT_CONFIG: Required<TailscaleConfig> = {
  openClawPort: 18789,
  healthCheckInterval: 60000,
  discoveryInterval: 30000,
};

export class TailscaleService {
  private config: Required<TailscaleConfig>;
  private status: TailscaleStatus | null = null;
  private openClawNodes: Map<string, OpenClawNode> = new Map();
  private subscribers: ((event: TailscaleEvent) => void)[] = [];
  private healthCheckTimer?: ReturnType<typeof setInterval>;
  private discoveryTimer?: ReturnType<typeof setInterval>;
  private isAvailable = false;

  constructor(config?: TailscaleConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public async initialize(): Promise<boolean> {
    try {
      await this.checkAvailability();
      this.isAvailable = true;
      await this.refreshStatus();
      await this.discoverOpenClawNodes();
      return true;
    } catch (error) {
      this.isAvailable = false;
      this.emit({ type: 'error', data: (error as Error).message });
      return false;
    }
  }

  private async checkAvailability(): Promise<void> {
    try {
      await execAsync('tailscale version');
    } catch {
      throw new Error(
        'Tailscale not installed. Please install from https://tailscale.com/download'
      );
    }

    try {
      const status = await this.fetchStatus();
      if (status.backendState !== 'Running') {
        throw new Error(`Tailscale not running: ${status.backendState}`);
      }
    } catch (error) {
      if ((error as Error).message.includes('not installed')) {
        throw error;
      }
      throw new Error('Tailscale not connected. Run: tailscale up');
    }
  }

  private async fetchStatus(): Promise<TailscaleStatus> {
    try {
      const { stdout } = await execAsync('tailscale status --json');
      const raw = JSON.parse(stdout);

      const self = {
        id: raw.Self?.ID || '',
        publicKey: raw.Self?.PublicKey || '',
        hostName: raw.Self?.HostName || '',
        dnsName: raw.Self?.DNSName || '',
        tailscaleIps: raw.Self?.TailscaleIPs || [],
        os: raw.Self?.OS || '',
      };

      const peers: TailscalePeer[] = Object.entries(raw.Peer || {}).map(
        ([id, peer]: [string, any]) => ({
          id,
          publicKey: peer.PublicKey || '',
          hostName: peer.HostName || '',
          dnsName: peer.DNSName || '',
          os: peer.OS || '',
          tailscaleIps: peer.TailscaleIPs || [],
          online: peer.Online || false,
          lastSeen: peer.LastSeen ? new Date(peer.LastSeen).getTime() : undefined,
          created: peer.Created ? new Date(peer.Created).getTime() : 0,
        })
      );

      const healthArray = raw.Health || [];
      const health = healthArray.some((h: string) => h.includes('error'))
        ? 'error'
        : healthArray.some((h: string) => h.includes('warning'))
          ? 'warning'
          : 'ok';

      return {
        self,
        peers,
        health,
        backendState: raw.BackendState || 'NoState',
        magicDnsSuffix: raw.MagicDNSSuffix || '',
        currentTailnet: {
          name: raw.CurrentTailnet?.Name || '',
        },
      };
    } catch (error) {
      throw new Error(`Failed to fetch Tailscale status: ${(error as Error).message}`);
    }
  }

  public async refreshStatus(): Promise<TailscaleStatus> {
    this.status = await this.fetchStatus();

    if (this.status.backendState === 'Running') {
      this.emit({ type: 'connected', data: this.status });
    } else {
      this.emit({ type: 'disconnected', data: this.status });
    }

    return this.status;
  }

  public async discoverOpenClawNodes(): Promise<OpenClawNode[]> {
    if (!this.status) {
      await this.refreshStatus();
    }

    const discovered: OpenClawNode[] = [];
    const checkPromises = this.status!.peers
      .filter((peer) => peer.online)
      .map(async (peer) => {
        const ip = peer.tailscaleIps[0] || peer.dnsName;
        const url = `http://${ip}:${this.config.openClawPort}`;
        const node: OpenClawNode = {
          peer,
          url,
          port: this.config.openClawPort,
          healthy: false,
          lastChecked: Date.now(),
        };

        try {
          const response = await axios.get(url, { timeout: 3000 });
          node.healthy = response.status === 200;
        } catch {
          node.healthy = false;
        }

        return node;
      });

    const results = await Promise.all(checkPromises);

    for (const node of results) {
      const existing = this.openClawNodes.get(node.peer.id);
      this.openClawNodes.set(node.peer.id, node);

      if (node.healthy && !existing?.healthy) {
        this.emit({ type: 'openclaw_discovered', data: node });
      }

      if (node.healthy) {
        discovered.push(node);
      }
    }

    return discovered;
  }

  public getOpenClawNodes(): OpenClawNode[] {
    return Array.from(this.openClawNodes.values()).filter((n) => n.healthy);
  }

  public getHealthyOpenClawNodes(): OpenClawNode[] {
    return this.getOpenClawNodes();
  }

  public getFirstHealthyNode(): OpenClawNode | null {
    return this.getHealthyOpenClawNodes()[0] || null;
  }

  public getStatus(): TailscaleStatus | null {
    return this.status;
  }

  public isTailscaleAvailable(): boolean {
    return this.isAvailable;
  }

  public isConnected(): boolean {
    return this.status?.backendState === 'Running';
  }

  public subscribe(callback: (event: TailscaleEvent) => void): () => void {
    this.subscribers.push(callback);
    return () => {
      const index = this.subscribers.indexOf(callback);
      if (index > -1) {
        this.subscribers.splice(index, 1);
      }
    };
  }

  private emit(event: TailscaleEvent): void {
    this.subscribers.forEach((cb) => cb(event));
  }

  public startHealthCheck(): void {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.refreshStatus();
      } catch {
        this.emit({ type: 'disconnected', data: null });
      }
    }, this.config.healthCheckInterval);
  }

  public startDiscovery(): void {
    if (this.discoveryTimer) return;

    this.discoveryTimer = setInterval(async () => {
      try {
        await this.discoverOpenClawNodes();
      } catch {
        // ignore discovery errors
      }
    }, this.config.discoveryInterval);
  }

  public stop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = undefined;
    }
  }
}
