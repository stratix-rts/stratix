import { defineStore } from 'pinia';
import { ref, computed, readonly } from 'vue';

import type { SavedCharacter } from '@/stratix-character-creator/types';
import type {
  StratixAgentConfig,
  CharacterProfile,
  AgentBackendType,
  OpenClawConfig
} from '@/stratix-core';
import { POSITION_SAVE_DELAY_MS } from '@/stratix-core/config/defaults';
import { WriterHeroTemplate, DevHeroTemplate, AnalystHeroTemplate, generateAgentId } from '@/stratix-designer';

function savedCharacterToProfile(character: SavedCharacter): CharacterProfile {
  return {
    characterId: character.characterId,
    name: character.name,
    bodyType: character.bodyType,
    parts: character.parts,
    skillTree: character.skillTree,
    attributes: character.attributes,
    thumbnail: character.thumbnail,
    texture: character.texture,
    createdAt: character.createdAt,
    updatedAt: character.updatedAt
  };
}

function determineConfigStatus(
  profile: CharacterProfile | undefined,
  backendType: AgentBackendType,
  openClawConfig?: OpenClawConfig,
  stratixConfig?: { provider?: string; model?: string }
): 'draft' | 'ready' {
  if (!profile) return 'draft';

  if (backendType === 'openclaw') {
    if (!openClawConfig?.endpoint || !openClawConfig?.accountId) {
      return 'draft';
    }
  } else if (backendType === 'stratix') {
    if (!stratixConfig?.provider || !stratixConfig?.model) {
      return 'draft';
    }
  }

  return 'ready';
}

export const useAgentStore = defineStore('agent', () => {
  // State
  const agents = ref<StratixAgentConfig[]>([]);
  const selectedIds = ref<string[]>([]);
  const isLoading = ref(false);
  const isRefreshing = ref(false);
  const lastRefreshTime = ref<Date | null>(null);
  const error = ref<string | null>(null);

  // Callbacks
  let onAgentCreatedCallback: ((config: StratixAgentConfig, centerOnScreen: boolean) => void) | null = null;
  let onAgentDeletedCallback: ((agentId: string) => void) | null = null;
  let onAgentUpdatedCallback: ((config: StratixAgentConfig) => void) | null = null;

  // Position saving
  const pendingPositionUpdates = new Map<string, { x: number; y: number }>();
  let positionSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let stopPositionSaveTimer: (() => void) | null = null;
  const POSITION_SAVE_DELAY = POSITION_SAVE_DELAY_MS;

  // Auto refresh
  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

  // Computed
  const selectedAgents = computed(() =>
    agents.value.filter(a => selectedIds.value.includes(a.agentId))
  );

  const readyAgents = computed(() =>
    agents.value.filter(a => a.configStatus === 'ready')
  );

  const draftAgents = computed(() =>
    agents.value.filter(a => a.configStatus === 'draft')
  );

  const agentCount = computed(() => agents.value.length);

  // Callbacks setters
  function setOnAgentCreated(callback: (config: StratixAgentConfig, centerOnScreen: boolean) => void) {
    onAgentCreatedCallback = callback;
  }

  function setOnAgentDeleted(callback: (agentId: string) => void) {
    onAgentDeletedCallback = callback;
  }

  function setOnAgentUpdated(callback: (config: StratixAgentConfig) => void) {
    onAgentUpdatedCallback = callback;
  }

  // Position updates
  function updateAgentPosition(agentId: string, position: { x: number; y: number }): void {
    const agent = agents.value.find(a => a.agentId === agentId);
    if (!agent) return;

    agent.position = position;
    pendingPositionUpdates.set(agentId, position);

    if (!positionSaveTimer) {
      positionSaveTimer = setTimeout(() => {
        flushPositionUpdates();
        positionSaveTimer = null;
        stopPositionSaveTimer = null;
      }, POSITION_SAVE_DELAY);
      stopPositionSaveTimer = () => {
        if (positionSaveTimer) {
          clearTimeout(positionSaveTimer);
          positionSaveTimer = null;
          stopPositionSaveTimer = null;
        }
      };
    }
  }

  async function flushPositionUpdates(): Promise<void> {
    positionSaveTimer = null;

    if (pendingPositionUpdates.size === 0) return;

    const updates = Array.from(pendingPositionUpdates.entries());
    pendingPositionUpdates.clear();

    for (const [agentId, position] of updates) {
      const agent = agents.value.find(a => a.agentId === agentId);
      if (!agent) continue;

      try {
        await fetch('/api/stratix/config/agent/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...agent, position })
        });
      } catch (e) {
        console.warn(`[AgentStore] Failed to save position for ${agentId}:`, e);
      }
    }
  }

  // Load agents
  async function loadAgents(): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await fetch('/api/stratix/config/agent/list');
      const result = await response.json();

      if (result.code === 200 && result.data) {
        agents.value = result.data;
        lastRefreshTime.value = new Date();
      }
    } catch (e) {
      error.value = '加载失败';
      console.warn('[AgentStore] Failed to load agents:', e);
    } finally {
      isLoading.value = false;
    }
  }

  // Refresh agents
  async function refreshAgents(): Promise<void> {
    if (isRefreshing.value) return;

    isRefreshing.value = true;
    error.value = null;

    try {
      const response = await fetch('/api/stratix/config/agent/list');
      const result = await response.json();

      if (result.code === 200 && result.data) {
        const oldAgents = agents.value;
        const newAgents: StratixAgentConfig[] = result.data;

        const oldIds = new Set(oldAgents.map(a => a.agentId));
        const newIds = new Set(newAgents.map(a => a.agentId));

        for (const newAgent of newAgents) {
          if (!oldIds.has(newAgent.agentId)) {
            onAgentCreatedCallback?.(newAgent, false);
          } else {
            const oldAgent = oldAgents.find(a => a.agentId === newAgent.agentId);
            if (oldAgent && onAgentUpdatedCallback) {
              onAgentUpdatedCallback(newAgent);
            }
          }
        }

        for (const oldId of oldIds) {
          if (!newIds.has(oldId)) {
            onAgentDeletedCallback?.(oldId);
          }
        }

        agents.value = newAgents;
        lastRefreshTime.value = new Date();
      }
    } catch (e) {
      error.value = '刷新失败';
      console.warn('[AgentStore] Failed to refresh agents:', e);
    } finally {
      setTimeout(() => {
        isRefreshing.value = false;
      }, 500);
    }
  }

  // Create agent
  async function createAgent(type: 'writer' | 'dev' | 'analyst'): Promise<StratixAgentConfig | null> {
    const TemplateClass = type === 'writer' ? WriterHeroTemplate
      : type === 'dev' ? DevHeroTemplate
      : AnalystHeroTemplate;

    const t = new TemplateClass();
    const config = t.getTemplate(generateAgentId(type));

    try {
      await fetch('/api/stratix/config/agent/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
    } catch (e) {
      console.warn('[AgentStore] Failed to save agent:', e);
    }

    agents.value.push(config);
    onAgentCreatedCallback?.(config, false);

    await refreshAgents();
    return config;
  }

  // Create agent from character
  async function createAgentFromCharacter(
    character: SavedCharacter,
    options?: {
      backendType?: AgentBackendType;
      openClawConfig?: OpenClawConfig;
      stratixConfig?: StratixAgentConfig['stratixConfig'];
      soul?: StratixAgentConfig['soul'];
      memory?: StratixAgentConfig['memory'];
      skills?: StratixAgentConfig['skills'];
      rules?: string[];
    }
  ): Promise<StratixAgentConfig | null> {
    const backendType = options?.backendType || 'stratix';
    const profile = savedCharacterToProfile(character);

    const configStatus = determineConfigStatus(
      profile,
      backendType,
      options?.openClawConfig,
      options?.stratixConfig
    );

    const config: StratixAgentConfig = {
      agentId: character.characterId,
      name: character.name || 'Hero',
      type: 'custom',
      profile,
      backendType,
      openClawConfig: backendType === 'openclaw' ? options?.openClawConfig : undefined,
      stratixConfig: backendType === 'stratix' ? options?.stratixConfig : undefined,
      soul: options?.soul,
      memory: options?.memory,
      skills: options?.skills,
      rules: options?.rules,
      configStatus,
      createdAt: character.createdAt,
      updatedAt: Date.now()
    };

    try {
      await fetch('/api/stratix/config/agent/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
    } catch (e) {
      console.warn('[AgentStore] Failed to save agent from character:', e);
    }

    agents.value.push(config);
    onAgentCreatedCallback?.(config, true);

    await refreshAgents();
    return config;
  }

  // Test backend connection
  async function testBackendConnection(
    backendType: AgentBackendType,
    config: OpenClawConfig | unknown
  ): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch('/api/stratix/agent/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backendType, config })
      });

      const result = await response.json();

      if (result.code === 200 && result.data) {
        return result.data;
      }

      return { success: false, message: result.message || 'Test failed' };
    } catch (e) {
      return {
        success: false,
        message: `Connection test failed: ${e instanceof Error ? e.message : 'Unknown error'}`
      };
    }
  }

  // Update agent profile
  async function updateAgentProfile(
    agentId: string,
    character: SavedCharacter,
    options?: {
      backendType?: AgentBackendType;
      openClawConfig?: OpenClawConfig;
      stratixConfig?: StratixAgentConfig['stratixConfig'];
      soul?: StratixAgentConfig['soul'];
      memory?: StratixAgentConfig['memory'];
      skills?: StratixAgentConfig['skills'];
      rules?: string[];
    }
  ): Promise<void> {
    const index = agents.value.findIndex(a => a.agentId === agentId);

    if (index >= 0) {
      const profile = savedCharacterToProfile(character);
      const _backendType = options?.backendType || agents.value[index].backendType;

      agents.value[index].profile = profile;
      agents.value[index].name = character.name;

      if (options) {
        if (options.backendType) {
          agents.value[index].backendType = options.backendType;
        }
        if (options.openClawConfig !== undefined) {
          agents.value[index].openClawConfig = options.openClawConfig;
        }
        if (options.stratixConfig !== undefined) {
          agents.value[index].stratixConfig = options.stratixConfig;
        }
        if (options.soul !== undefined) {
          agents.value[index].soul = options.soul;
        }
        if (options.memory !== undefined) {
          agents.value[index].memory = options.memory;
        }
        if (options.skills !== undefined) {
          agents.value[index].skills = options.skills;
        }
        if (options.rules !== undefined) {
          agents.value[index].rules = options.rules;
        }
      }

      agents.value[index].configStatus = determineConfigStatus(
        profile,
        agents.value[index].backendType,
        agents.value[index].openClawConfig,
        agents.value[index].stratixConfig
      );

      agents.value[index].updatedAt = Date.now();
    }

    await refreshAgents();
  }

  // Update agent config
  async function updateAgentConfig(
    agentId: string,
    updates: Partial<StratixAgentConfig>
  ): Promise<void> {
    const index = agents.value.findIndex(a => a.agentId === agentId);

    if (index >= 0) {
      agents.value[index] = {
        ...agents.value[index],
        ...updates,
        updatedAt: Date.now()
      };

      if (updates.backendType || updates.openClawConfig || updates.profile || updates.stratixConfig) {
        agents.value[index].configStatus = determineConfigStatus(
          agents.value[index].profile,
          agents.value[index].backendType,
          agents.value[index].openClawConfig,
          agents.value[index].stratixConfig
        );
      }

      try {
        await fetch('/api/stratix/config/agent/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agents.value[index])
        });
      } catch (e) {
        console.warn('[AgentStore] Failed to update agent:', e);
      }
    }

    await refreshAgents();
  }

  async function markAgentReady(agentId: string): Promise<void> {
    await updateAgentConfig(agentId, { configStatus: 'ready' });
  }

  async function markAgentDraft(agentId: string): Promise<void> {
    await updateAgentConfig(agentId, { configStatus: 'draft' });
  }

  // Delete agent
  async function deleteAgent(agentId: string): Promise<void> {
    try {
      await fetch(`/api/stratix/config/agent/delete?agentId=${encodeURIComponent(agentId)}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.warn('[AgentStore] Failed to delete agent:', e);
    }

    agents.value = agents.value.filter(a => a.agentId !== agentId);
    selectedIds.value = selectedIds.value.filter(id => id !== agentId);

    onAgentDeletedCallback?.(agentId);
  }

  // Selection
  function selectAgent(agentId: string): void {
    if (!selectedIds.value.includes(agentId)) {
      selectedIds.value.push(agentId);
    }
  }

  function deselectAgent(agentId: string): void {
    selectedIds.value = selectedIds.value.filter(id => id !== agentId);
  }

  function setSelectedIds(ids: string[]): void {
    selectedIds.value = ids;
  }

  function clearSelection(): void {
    selectedIds.value = [];
  }

  // Getters
  function getAgentById(agentId: string): StratixAgentConfig | undefined {
    return agents.value.find(a => a.agentId === agentId);
  }

  function getAgentByCharacterId(characterId: string): StratixAgentConfig | undefined {
    return agents.value.find(a => a.profile?.characterId === characterId);
  }

  // Auto refresh
  function startAutoRefresh(intervalMs: number = 30000): void {
    if (autoRefreshTimer) return;

    autoRefreshTimer = setInterval(() => {
      refreshAgents();
    }, intervalMs);

    console.log(`[AgentStore] Auto refresh started (${intervalMs}ms interval)`);
  }

  function stopAutoRefresh(): void {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
      console.log('[AgentStore] Auto refresh stopped');
    }
  }

  // Clear
  function clear(): void {
    stopAutoRefresh();
    if (stopPositionSaveTimer) {
      stopPositionSaveTimer();
    }
    agents.value = [];
    selectedIds.value = [];
    error.value = null;
    lastRefreshTime.value = null;
  }

  // Legacy API support (read-only state object for backward compatibility)
  const state = computed(() => ({
    agents: readonly(agents),
    selectedIds: readonly(selectedIds),
    isLoading: readonly(isLoading),
    isRefreshing: readonly(isRefreshing),
    lastRefreshTime: readonly(lastRefreshTime),
    error: readonly(error)
  }));

  return {
    // State (reactive refs)
    agents,
    selectedIds,
    isLoading,
    isRefreshing,
    lastRefreshTime,
    error,

    // Computed
    selectedAgents,
    readyAgents,
    draftAgents,
    agentCount,

    // Legacy state object for backward compatibility
    state,

    // Methods
    setOnAgentCreated,
    setOnAgentDeleted,
    setOnAgentUpdated,
    updateAgentPosition,
    flushPositionUpdates,
    loadAgents,
    refreshAgents,
    createAgent,
    createAgentFromCharacter,
    testBackendConnection,
    updateAgentProfile,
    updateAgentConfig,
    markAgentReady,
    markAgentDraft,
    deleteAgent,
    selectAgent,
    deselectAgent,
    setSelectedIds,
    clearSelection,
    getAgentById,
    getAgentByCharacterId,
    startAutoRefresh,
    stopAutoRefresh,
    clear
  };
});