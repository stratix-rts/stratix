export interface CredentialConfig {
  apiKey?: string;
  endpoint?: string;
}

export class CredentialManager {
  private cache: Map<string, string> = new Map();

  resolveCredential(config: CredentialConfig): string | undefined {
    if (!config.apiKey) {
      return undefined;
    }

    if (config.apiKey.startsWith('${') && config.apiKey.endsWith('}')) {
      const envVar = config.apiKey.slice(2, -1);
      const value = process.env[envVar];
      if (!value) {
        throw new Error(`Environment variable ${envVar} is not set`);
      }
      return value;
    }

    return config.apiKey;
  }

  setCachedCredential(key: string, value: string): void {
    this.cache.set(key, value);
  }

  getCachedCredential(key: string): string | undefined {
    return this.cache.get(key);
  }

  clearCache(): void {
    this.cache.clear();
  }

  validateApiKey(apiKey: string | undefined): boolean {
    if (!apiKey) return false;
    
    if (apiKey.startsWith('${') && apiKey.endsWith('}')) {
      const envVar = apiKey.slice(2, -1);
      return !!process.env[envVar];
    }

    return apiKey.length > 0;
  }
}
