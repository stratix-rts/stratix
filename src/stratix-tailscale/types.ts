export interface TailscalePeer {
  id: string;
  publicKey: string;
  hostName: string;
  dnsName: string;
  os: string;
  tailscaleIps: string[];
  online: boolean;
  lastSeen?: number;
  created: number;
}

export interface TailscaleStatus {
  self: {
    id: string;
    publicKey: string;
    hostName: string;
    dnsName: string;
    tailscaleIps: string[];
    os: string;
  };
  peers: TailscalePeer[];
  health: 'ok' | 'warning' | 'error';
  backendState: 'Running' | 'Stopped' | 'NeedsLogin' | 'NoState' | 'Starting';
  magicDnsSuffix: string;
  currentTailnet: {
    name: string;
  };
}

export interface OpenClawNode {
  peer: TailscalePeer;
  url: string;
  port: number;
  healthy: boolean;
  lastChecked: number;
}

export interface TailscaleConfig {
  openClawPort?: number;
  healthCheckInterval?: number;
  discoveryInterval?: number;
}

export interface TailscaleEvent {
  type: 'connected' | 'disconnected' | 'peer_online' | 'peer_offline' | 'openclaw_discovered' | 'error';
  data?: unknown;
}
