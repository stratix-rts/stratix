/**
 * DeviceIdentityManager - 设备身份管理器
 * 
 * 职责：
 * - 生成/加载 Ed25519 密钥对（与 OpenClaw 兼容）
 * - 计算 deviceId（公钥 SHA256 前16位）
 * - 签名 challenge（按 OpenClaw 格式）
 * - 存储/读取 deviceToken
 * - 管理多个连接配置
 */

import * as ed from '@noble/ed25519';

export interface StoredConnection {
  id: string;
  name: string;
  endpoint: string;
  method: 'pairing' | 'tailscale';
  deviceToken?: string;
  deviceId: string;
  lastConnected?: number;
}

interface StoredIdentity {
  deviceId: string;
  publicKeyHex: string;
  privateKeyHex: string;
}

interface DeviceIdentity {
  deviceId: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

const STORAGE_KEYS = {
  IDENTITY: 'openclaw_device_identity',
  CONNECTIONS: 'openclaw_connections',
};

/**
 * 构建 OpenClaw 签名数据
 * 格式: v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce
 */
function buildSignPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
}): string {
  const { deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce } = params;
  const parts = [
    'v2',
    deviceId,
    clientId,
    clientMode,
    role,
    scopes.join(','),
    String(signedAtMs),
    token ?? '',
    nonce ?? '',
  ];
  return parts.join('|');
}

/**
 * Uint8Array 转 Base64 URL-safe
 */
function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Uint8Array 转 Hex
 */
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hex 转 Uint8Array
 */
function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

class DeviceIdentityManager {
  private static instance: DeviceIdentityManager | null = null;
  private identity: DeviceIdentity | null = null;
  private initPromise: Promise<DeviceIdentity> | null = null;

  private constructor() {}

  static getInstance(): DeviceIdentityManager {
    if (!DeviceIdentityManager.instance) {
      DeviceIdentityManager.instance = new DeviceIdentityManager();
    }
    return DeviceIdentityManager.instance;
  }

  async getOrCreateIdentity(): Promise<DeviceIdentity> {
    if (this.identity) {
      return this.identity;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.initializeIdentity();
    return this.initPromise;
  }

  private async initializeIdentity(): Promise<DeviceIdentity> {
    const stored = this.loadStoredIdentity();
    
    if (stored) {
      try {
        const publicKey = hexToUint8Array(stored.publicKeyHex);
        const privateKey = hexToUint8Array(stored.privateKeyHex);

        this.identity = {
          deviceId: stored.deviceId,
          publicKey,
          privateKey,
        };

        console.log('[DeviceIdentity] Loaded existing identity:', stored.deviceId);
        return this.identity;
      } catch (e) {
        console.warn('[DeviceIdentity] Failed to load stored identity, generating new one:', e);
      }
    }

    return this.generateNewIdentity();
  }

  private async generateNewIdentity(): Promise<DeviceIdentity> {
    // 生成 Ed25519 私钥（32 字节种子）
    const privateKey = ed.utils.randomSecretKey();
    // 派生公钥
    const publicKey = await ed.getPublicKeyAsync(privateKey);

    // 计算 deviceId（公钥的完整 SHA-256 哈希，64 个十六进制字符）
    const publicKeyBuffer = new Uint8Array(publicKey).buffer as ArrayBuffer;
    const publicKeyHash = await crypto.subtle.digest('SHA-256', publicKeyBuffer);
    const hashBytes = new Uint8Array(publicKeyHash);
    const deviceId = Array.from(hashBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const stored: StoredIdentity = {
      deviceId,
      publicKeyHex: uint8ArrayToHex(publicKey),
      privateKeyHex: uint8ArrayToHex(privateKey),
    };

    localStorage.setItem(STORAGE_KEYS.IDENTITY, JSON.stringify(stored));

    this.identity = {
      deviceId,
      publicKey,
      privateKey,
    };

    console.log('[DeviceIdentity] Generated new Ed25519 identity:', deviceId);
    return this.identity;
  }

  private loadStoredIdentity(): StoredIdentity | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.IDENTITY);
      if (stored) {
        return JSON.parse(stored) as StoredIdentity;
      }
    } catch (e) {
      console.warn('[DeviceIdentity] Failed to load stored identity:', e);
    }
    return null;
  }

  /**
   * 签名挑战数据（OpenClaw 格式）
   */
  async signChallenge(params: {
    clientId: string;
    clientMode: string;
    role: string;
    scopes: string[];
    signedAtMs: number;
    token: string | null;
    nonce: string;
  }): Promise<string> {
    const identity = await this.getOrCreateIdentity();
    
    // 构建签名数据
    const payload = buildSignPayload({
      deviceId: identity.deviceId,
      clientId: params.clientId,
      clientMode: params.clientMode,
      role: params.role,
      scopes: params.scopes,
      signedAtMs: params.signedAtMs,
      token: params.token,
      nonce: params.nonce,
    });

    console.log('[DeviceIdentity] Signing payload:', payload);
    console.log('[DeviceIdentity] Device ID:', identity.deviceId);
    console.log('[DeviceIdentity] Public key (hex):', uint8ArrayToHex(identity.publicKey));
    console.log('[DeviceIdentity] Nonce:', params.nonce);
    console.log('[DeviceIdentity] Token:', params.token ? '(provided)' : '(null)');

    // 使用 Ed25519 签名
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const signature = await ed.signAsync(data, identity.privateKey);

    const signatureBase64 = uint8ArrayToBase64Url(signature);
    console.log('[DeviceIdentity] Signature (base64url):', signatureBase64);

    return signatureBase64;
  }

  /**
   * 获取公钥（Base64 URL-safe 格式）
   */
  async getPublicKeyBase64(): Promise<string> {
    const identity = await this.getOrCreateIdentity();
    return uint8ArrayToBase64Url(identity.publicKey);
  }

  async getDeviceId(): Promise<string> {
    const identity = await this.getOrCreateIdentity();
    return identity.deviceId;
  }

  async saveDeviceToken(endpoint: string, token: string): Promise<void> {
    const connections = this.getConnections();
    const existing = connections.find(c => c.endpoint === endpoint);

    if (existing) {
      existing.deviceToken = token;
      existing.lastConnected = Date.now();
      this.saveConnections(connections);
    } else {
      const deviceId = await this.getDeviceId();
      const conns = this.getConnections();
      conns.push({
        id: this.generateId(),
        name: this.extractNameFromEndpoint(endpoint),
        endpoint,
        method: 'pairing',
        deviceToken: token,
        deviceId,
        lastConnected: Date.now(),
      });
      this.saveConnections(conns);
    }
  }

  getDeviceToken(endpoint: string): string | null {
    const connections = this.getConnections();
    const conn = connections.find(c => c.endpoint === endpoint);
    return conn?.deviceToken || null;
  }

  clearDeviceToken(endpoint: string): void {
    const connections = this.getConnections();
    const connIndex = connections.findIndex(c => c.endpoint === endpoint);
    if (connIndex >= 0) {
      delete connections[connIndex].deviceToken;
      this.saveConnections(connections);
    }
  }

  saveConnection(connection: StoredConnection): void {
    const connections = this.getConnections();
    const existingIndex = connections.findIndex(c => c.id === connection.id);
    
    if (existingIndex >= 0) {
      connections[existingIndex] = { ...connection, lastConnected: Date.now() };
    } else {
      connections.push({ ...connection, lastConnected: Date.now() });
    }
    
    this.saveConnections(connections);
  }

  getConnections(): StoredConnection[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.CONNECTIONS);
      if (stored) {
        return JSON.parse(stored) as StoredConnection[];
      }
    } catch (e) {
      console.warn('[DeviceIdentity] Failed to load connections:', e);
    }
    return [];
  }

  removeConnection(id: string): void {
    const connections = this.getConnections().filter(c => c.id !== id);
    this.saveConnections(connections);
  }

  private saveConnections(connections: StoredConnection[]): void {
    localStorage.setItem(STORAGE_KEYS.CONNECTIONS, JSON.stringify(connections));
  }

  private generateId(): string {
    return 'conn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  private extractNameFromEndpoint(endpoint: string): string {
    try {
      const url = new URL(endpoint.replace(/^ws/, 'http'));
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
        return '本地连接';
      }
      return url.hostname;
    } catch {
      return endpoint;
    }
  }
}

export const deviceIdentityManager = DeviceIdentityManager.getInstance();
export default DeviceIdentityManager;
