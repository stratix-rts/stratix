import * as fs from 'fs';
import * as path from 'path';

import { safeStorage , app } from 'electron';

export interface ApiKeyStore {
  [providerId: string]: string;
}

export function getApiKeysFilePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'api-keys.encrypted');
}

export async function saveApiKey(providerId: string, apiKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return { success: false, error: 'Encryption not available' };
    }

    const encrypted = safeStorage.encryptString(apiKey);
    const keysPath = getApiKeysFilePath();

    let keys: ApiKeyStore = {};
    if (fs.existsSync(keysPath)) {
      const existing = fs.readFileSync(keysPath);
      keys = JSON.parse(existing.toString('base64'));
    }

    keys[providerId] = encrypted.toString('base64');
    fs.writeFileSync(keysPath, Buffer.from(JSON.stringify(keys)));

    return { success: true };
  } catch (error) {
    console.error('[ApiKeyStore] Failed to save API key:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to save' };
  }
}

export async function loadApiKey(providerId: string): Promise<{ success: boolean; data: string | null; error?: string }> {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return { success: false, data: null, error: 'Encryption not available' };
    }

    const keysPath = getApiKeysFilePath();
    if (!fs.existsSync(keysPath)) {
      return { success: true, data: null };
    }

    const keys: ApiKeyStore = JSON.parse(fs.readFileSync(keysPath).toString('base64'));
    const encrypted = keys[providerId];

    if (!encrypted) {
      return { success: true, data: null };
    }

    const decrypted = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    return { success: true, data: decrypted };
  } catch (error) {
    console.error('[ApiKeyStore] Failed to load API key:', error);
    return { success: false, data: null, error: error instanceof Error ? error.message : 'Failed to load' };
  }
}

export async function deleteApiKey(providerId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const keysPath = getApiKeysFilePath();
    if (!fs.existsSync(keysPath)) {
      return { success: true };
    }

    const keys: ApiKeyStore = JSON.parse(fs.readFileSync(keysPath).toString('base64'));
    delete keys[providerId];
    fs.writeFileSync(keysPath, Buffer.from(JSON.stringify(keys)));

    return { success: true };
  } catch (error) {
    console.error('[ApiKeyStore] Failed to delete API key:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete' };
  }
}

export async function listApiKeys(): Promise<{ success: boolean; data: string[]; error?: string }> {
  try {
    const keysPath = getApiKeysFilePath();
    if (!fs.existsSync(keysPath)) {
      return { success: true, data: [] };
    }

    const keys: ApiKeyStore = JSON.parse(fs.readFileSync(keysPath).toString('base64'));
    return { success: true, data: Object.keys(keys) };
  } catch (error) {
    console.error('[ApiKeyStore] Failed to list API keys:', error);
    return { success: false, data: [], error: error instanceof Error ? error.message : 'Failed to list' };
  }
}
