import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import axios from 'axios';

import { TailscalePeer, OpenClawNode } from './types';
export { OpenClawNode };

// EmbeddedTailscale-specific TailscaleStatus (differs from types.ts version)
export interface EmbeddedTailscaleStatus {
  self: {
    id: string;
    hostName: string;
    dnsName: string;
    tailscaleIps: string[];
    os: string;
  };
  peers: TailscalePeer[];
  backendState: 'Running' | 'Stopped' | 'NeedsLogin' | 'NoState' | 'Starting';
  magicDnsSuffix: string;
  currentTailnet?: { name: string };
}

export interface TailscaleConfig {
  openClawPort?: number;
  stateDir?: string;
  hostname?: string;
  authKey?: string;
  healthCheckInterval?: number;
}

export interface TailscaleEvent {
  type: 'started' | 'stopped' | 'connected' | 'needs-login' | 'peer_online' | 'peer_offline' | 'openclaw_found' | 'error';
  data?: unknown;
}

export class EmbeddedTailscale {
  private config: Required<Omit<TailscaleConfig, 'authKey'>> & { authKey?: string };
  private tailscaled: ChildProcess | null = null;
  private status: EmbeddedTailscaleStatus | null = null;
  private openClawNodes: Map<string, OpenClawNode> = new Map();
  private subscribers: ((event: TailscaleEvent) => void)[] = [];
  private healthTimer?: ReturnType<typeof setInterval>;
  private socketPath: string;
  private binaryPath: string;
  private isRunning = false;
  private needsAuth = false;

  constructor(config?: TailscaleConfig) {
    this.config = {
      openClawPort: config?.openClawPort ?? 18789,
      stateDir: config?.stateDir ?? path.join(os.homedir(), '.stratix', 'tailscale'),
      hostname: config?.hostname ?? 'stratix',
      authKey: config?.authKey,
      healthCheckInterval: config?.healthCheckInterval ?? 60000,
    };
    this.socketPath = path.join(this.config.stateDir, 'tailscaled.sock');
    this.binaryPath = this.findBinary();
  }

  private findBinary(): string {
    const platform = os.platform();
    const arch = os.arch();

    const binaryName = platform === 'win32' ? 'tailscaled.exe' : 'tailscaled';

    const searchPaths = [
      path.join(__dirname, '..', '..', 'bin', platform, arch, binaryName),
      path.join(__dirname, '..', '..', 'bin', binaryName),
      path.join(process.resourcesPath || '', 'bin', platform, arch, binaryName),
    ];

    if (platform === 'darwin') {
      searchPaths.push('/opt/homebrew/bin/tailscaled');
      searchPaths.push('/usr/local/bin/tailscaled');
    } else if (platform === 'linux') {
      searchPaths.push('/usr/bin/tailscaled');
      searchPaths.push('/usr/local/bin/tailscaled');
    }

    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return 'tailscaled';
  }

  public async start(): Promise<boolean> {
    if (this.isRunning) {
      return true;
    }

    // Check if binary exists (findBinary falls back to 'tailscaled' if not found)
    if (this.binaryPath === 'tailscaled' && !fs.existsSync('/usr/bin/tailscaled') && !fs.existsSync('/opt/homebrew/bin/tailscaled')) {
      console.log('[Tailscale] Binary not found, skipping start');
      return false;
    }

    await fs.promises.mkdir(this.config.stateDir, { recursive: true });

    const args = [
      '--tun=userspace-networking',
      `--socket=${this.socketPath}`,
      `--state=${path.join(this.config.stateDir, 'tailscaled.state')}`,
      `--statedir=${this.config.stateDir}`,
    ];

    this.emit({ type: 'started', data: { pid: 'starting' } });

    return new Promise((resolve, reject) => {
      try {
        this.tailscaled = spawn(this.binaryPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        });

        this.tailscaled.on('error', (err) => {
          this.emit({ type: 'error', data: err.message });
          reject(err);
        });

        this.tailscaled.stdout?.on('data', (_data) => {
          // Log for debugging
        });

        this.tailscaled.stderr?.on('data', (_data) => {
          // Log for debugging
        });

        this.tailscaled.on('close', (code) => {
          this.isRunning = false;
          this.emit({ type: 'stopped', data: { code } });
        });

        setTimeout(async () => {
          this.isRunning = true;

          if (this.config.authKey) {
            await this.login(this.config.authKey);
          }

          const status = await this.getStatus();
          if (status?.backendState === 'NeedsLogin') {
            this.needsAuth = true;
            this.emit({ type: 'needs-login', data: null });
            resolve(true);
          } else {
            this.emit({ type: 'connected', data: status });
            resolve(true);
          }
        }, 2000);
      } catch (error) {
        reject(error);
      }
    });
  }

  public async login(authKey?: string): Promise<boolean> {
    const key = authKey || this.config.authKey;
    if (!key) {
      this.emit({ type: 'needs-login', data: null });
      return false;
    }

    try {
      await this.runTailscale(['up', `--authkey=${key}`, `--hostname=${this.config.hostname}`]);
      this.needsAuth = false;
      const status = await this.getStatus();
      this.emit({ type: 'connected', data: status });
      return true;
    } catch (error) {
      this.emit({ type: 'error', data: (error as Error).message });
      return false;
    }
  }

  public async getLoginURL(): Promise<string | null> {
    try {
      const { stdout } = await this.runTailscale(['login', '--verbose']);
      const match = stdout.match(/https:\/\/login\.tailscale\.com\/a\/[^\s]+/);
      return match ? match[0] : null;
    } catch {
      return null;
    }
  }

  private async runTailscale(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const tailscaleBin = this.binaryPath.replace('tailscaled', 'tailscale');
    const fullArgs = [`--socket=${this.socketPath}`, ...args];

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn(tailscaleBin, fullArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      proc.stdout?.on('data', (data) => { stdout += data; });
      proc.stderr?.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`tailscale exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  public async getStatus(): Promise<EmbeddedTailscaleStatus | null> {
    try {
      const { stdout } = await this.runTailscale(['status', '--json']);
      const raw = JSON.parse(stdout);

      const self = {
        id: raw.Self?.ID || '',
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

      this.status = {
        self,
        peers,
        backendState: raw.BackendState || 'NoState',
        magicDnsSuffix: raw.MagicDNSSuffix || '',
        currentTailnet: raw.CurrentTailnet ? { name: raw.CurrentTailnet.Name || '' } : undefined,
      };

      return this.status;
    } catch {
      return null;
    }
  }

  public async discoverOpenClawNodes(): Promise<OpenClawNode[]> {
    if (!this.status) {
      await this.getStatus();
    }

    if (!this.status?.peers) {
      return [];
    }

    const discovered: OpenClawNode[] = [];

    for (const peer of this.status.peers) {
      if (!peer.online) continue;

      const ip = peer.tailscaleIps[0];
      if (!ip) continue;

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

      if (node.healthy) {
        discovered.push(node);
        const existing = this.openClawNodes.get(peer.id);
        if (!existing?.healthy) {
          this.emit({ type: 'openclaw_found', data: node });
        }
      }

      this.openClawNodes.set(peer.id, node);
    }

    return discovered;
  }

  public getOpenClawNodes(): OpenClawNode[] {
    return Array.from(this.openClawNodes.values()).filter((n) => n.healthy);
  }

  public getFirstHealthyNode(): OpenClawNode | null {
    return this.getOpenClawNodes()[0] || null;
  }

  public isTailscaleRunning(): boolean {
    return this.isRunning;
  }

  public needsAuthentication(): boolean {
    return this.needsAuth;
  }

  public subscribe(callback: (event: TailscaleEvent) => void): () => void {
    this.subscribers.push(callback);
    return () => {
      const idx = this.subscribers.indexOf(callback);
      if (idx > -1) this.subscribers.splice(idx, 1);
    };
  }

  private emit(event: TailscaleEvent): void {
    this.subscribers.forEach((cb) => cb(event));
  }

  public startHealthCheck(): void {
    if (this.healthTimer) return;

    this.healthTimer = setInterval(async () => {
      const status = await this.getStatus();
      if (status?.backendState === 'Running') {
        await this.discoverOpenClawNodes();
      }
    }, this.config.healthCheckInterval);
  }

  public async stop(): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
    }

    if (this.tailscaled) {
      return new Promise((resolve) => {
        this.tailscaled!.on('close', () => {
          this.tailscaled = null;
          this.isRunning = false;
          resolve();
        });
        this.tailscaled!.kill('SIGTERM');

        setTimeout(() => {
          if (this.tailscaled) {
            this.tailscaled.kill('SIGKILL');
          }
        }, 5000);
      });
    }
  }
}
