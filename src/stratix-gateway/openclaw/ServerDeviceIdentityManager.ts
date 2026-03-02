/**
 * ServerDeviceIdentityManager - 服务端设备身份管理器
 * 
 * 功能与 DeviceIdentityManager 相同，但使用 Node.js API：
 * - 使用 node:crypto 替代 crypto.subtle
 * - 使用文件存储替代 localStorage
 */

import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as ed from '@noble/ed25519';

interface StoredIdentity {
  deviceId: string;
  publicKeyHex: string;
  privateKeyHex: string;
  createdAt: number;
}

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
  const parts = [
    'v2',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(','),
    String(params.signedAtMs),
    params.token ?? '',
    params.nonce ?? '',
  ];
  return parts.join('|');
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function hexToUint8Array(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

const IDENTITY_FILENAME = 'gateway-identity.json';

class ServerDeviceIdentityManager {
  private static instance: ServerDeviceIdentityManager | null = null;
  private identity: { deviceId: string; publicKey: Uint8Array; privateKey: Uint8Array } | null = null;
  private initPromise: Promise<void> | null = null;
  private dataDir: string = '';

  private constructor() {}

  static getInstance(): ServerDeviceIdentityManager {
    if (!ServerDeviceIdentityManager.instance) {
      ServerDeviceIdentityManager.instance = new ServerDeviceIdentityManager();
    }
    return ServerDeviceIdentityManager.instance;
  }

  async initialize(dataDir: string): Promise<void> {
    if (this.identity) return;
    if (this.initPromise) return this.initPromise;

    this.dataDir = dataDir;
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    const filePath = path.join(this.dataDir, IDENTITY_FILENAME);
    
    try {
      if (await fs.pathExists(filePath)) {
        const stored: StoredIdentity = await fs.readJson(filePath);
        this.identity = {
          deviceId: stored.deviceId,
          publicKey: hexToUint8Array(stored.publicKeyHex),
          privateKey: hexToUint8Array(stored.privateKeyHex),
        };
        console.log('[ServerDeviceIdentity] Loaded existing identity:', this.identity.deviceId);
        return;
      }
    } catch (e) {
      console.warn('[ServerDeviceIdentity] Failed to load identity, generating new one:', e);
    }

    await this.generateNewIdentity(filePath);
  }

  private async generateNewIdentity(filePath: string): Promise<void> {
    const privateKey = ed.utils.randomSecretKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);

    const hash = crypto.createHash('sha256').update(publicKey).digest('hex');
    const deviceId = hash;

    this.identity = { deviceId, publicKey, privateKey };

    await fs.ensureDir(path.dirname(filePath));
    await fs.writeJson(filePath, {
      deviceId,
      publicKeyHex: uint8ArrayToHex(publicKey),
      privateKeyHex: uint8ArrayToHex(privateKey),
      createdAt: Date.now(),
    }, { spaces: 2 });

    console.log('[ServerDeviceIdentity] Generated new identity:', deviceId);
  }

  async getDeviceId(): Promise<string> {
    if (!this.identity) throw new Error('Identity not initialized');
    return this.identity.deviceId;
  }

  async getPublicKeyBase64(): Promise<string> {
    if (!this.identity) throw new Error('Identity not initialized');
    return uint8ArrayToBase64Url(this.identity.publicKey);
  }

  async signChallenge(params: {
    clientId: string;
    clientMode: string;
    role: string;
    scopes: string[];
    signedAtMs: number;
    token: string | null;
    nonce: string;
  }): Promise<string> {
    if (!this.identity) throw new Error('Identity not initialized');

    const payload = buildSignPayload({
      deviceId: this.identity.deviceId,
      ...params,
    });

    console.log('[ServerDeviceIdentity] Signing payload:', payload);

    const data = new TextEncoder().encode(payload);
    const signature = await ed.signAsync(data, this.identity.privateKey);
    return uint8ArrayToBase64Url(signature);
  }

  isInitialized(): boolean {
    return this.identity !== null;
  }
}

export const serverDeviceIdentityManager = ServerDeviceIdentityManager.getInstance();
export default ServerDeviceIdentityManager;
