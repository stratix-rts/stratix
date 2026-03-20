import { providerRegistry } from '../providers/registry';
import type { ProviderConfig, ProviderTestResult } from '../providers/types';

export function registerProviderHandlers() {
  return {
    'provider:list': async (): Promise<{ success: boolean; providers: ProviderConfig[]; error?: string }> => {
      try {
        const providers = providerRegistry.getAllConfigs();
        return { success: true, providers };
      } catch (error) {
        return { success: false, providers: [], error: error instanceof Error ? error.message : 'Failed to list' };
      }
    },

    'provider:models': async (_event: any, providerId: string): Promise<{ success: boolean; models: string[]; error?: string }> => {
      try {
        const models = providerRegistry.getModels(providerId);
        return { success: true, models };
      } catch (error) {
        return { success: false, models: [], error: error instanceof Error ? error.message : 'Failed to get models' };
      }
    },

    'provider:test': async (
      _event: any,
      providerId: string,
      model: string,
      apiKey?: string
    ): Promise<ProviderTestResult> => {
      try {
        const result = await providerRegistry.testConnection({
          providerId,
          model,
          apiKey,
        });
        return {
          success: result.success,
          message: result.error || 'Connection successful',
          latency: result.latency,
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Test failed',
        };
      }
    },

    'provider:create': async (
      _event: any,
      instanceId: string,
      providerId: string,
      model: string,
      apiKey?: string,
      options?: { temperature?: number; maxTokens?: number }
    ) => {
      try {
        const instance = await providerRegistry.createAndStore(instanceId, {
          providerId,
          model,
          apiKey,
          ...options,
        });
        return { success: true, hasInstance: !!instance };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to create' };
      }
    },
  };
}
