import { reactive, readonly, computed } from 'vue';
import type {
  StratixAgentConfig,
  CharacterProfile,
  AgentBackendType,
  AgentConfigStatus,
  OpenClawConfig
} from '@/stratix-core';
import { WriterHeroTemplate, DevHeroTemplate, AnalystHeroTemplate, generateAgentId } from '@/stratix-designer';
import type { SavedCharacter } from '@/stratix-character-creator/types';
import { POSITION_SAVE_DELAY_MS } from '@/stratix-core/config/defaults';

interface AgentState {
  agents: StratixAgentConfig[];
  selectedIds: string[];
  isLoading: boolean;
  isRefreshing: boolean;
  lastRefreshTime: Date | null;
  error: string | null;
}

const state = reactive<AgentState>({
  agents: [],
  selectedIds: [],
  isLoading: false,
  isRefreshing: false,
  lastRefreshTime: null,
  error: null
});

let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let onAgentCreatedCallback: ((config: StratixAgentConfig, centerOnScreen: boolean) => void) | null = null;
let onAgentDeletedCallback: ((agentId: string) => void) | null = null;
let onAgentUpdatedCallback: ((config: StratixAgentConfig) => void) | null = null;

const pendingPositionUpdates: Map<string, { x: number; y: number }> = new Map();
let positionSaveTimer: ReturnType<typeof setTimeout> | null = null;
let stopPositionSaveTimer: (() => void) | null = null;
const POSITION_SAVE_DELAY = POSITION_SAVE_DELAY_MS;

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
): AgentConfigStatus {
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

export const agentStore = {
  state: readonly(state),

  agents: computed(() => state.agents),
  selectedIds: computed(() => state.selectedIds),
  selectedAgents: computed(() =>
    state.agents.filter(a => state.selectedIds.includes(a.agentId))
  ),
  readyAgents: computed(() =>
    state.agents.filter(a => a.configStatus === 'ready')
  ),
  draftAgents: computed(() =>
    state.agents.filter(a => a.configStatus === 'draft')
  ),
  isLoading: computed(() => state.isLoading),
  isRefreshing: computed(() => state.isRefreshing),
  lastRefreshTime: computed(() => state.lastRefreshTime),
  error: computed(() => state.error),
  agentCount: computed(() => state.agents.length),

  setOnAgentCreated(callback: (config: StratixAgentConfig, centerOnScreen: boolean) => void) {
    onAgentCreatedCallback = callback;
  },

  setOnAgentDeleted(callback: (agentId: string) => void) {
    onAgentDeletedCallback = callback;
  },

  setOnAgentUpdated(callback: (config: StratixAgentConfig) => void) {
    onAgentUpdatedCallback = callback;
  },

  updateAgentPosition(agentId: string, position: { x: number; y: number }): void {
    const agent = state.agents.find(a => a.agentId === agentId);
    if (!agent) return;

    agent.position = position;
    pendingPositionUpdates.set(agentId, position);

    if (!positionSaveTimer) {
      positionSaveTimer = setTimeout(() => {
        this.flushPositionUpdates();
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
  },

  async flushPositionUpdates(): Promise<void> {
    positionSaveTimer = null;

    if (pendingPositionUpdates.size === 0) return;

    const updates = Array.from(pendingPositionUpdates.entries());
    pendingPositionUpdates.clear();

    for (const [agentId, position] of updates) {
      const agent = state.agents.find(a => a.agentId === agentId);
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
  },

  async loadAgents(): Promise<void> {
    state.isLoading = true;
    state.error = null;

    try {
      const response = await fetch('/api/stratix/config/agent/list');
      const result = await response.json();

      if (result.code === 200 && result.data) {
        state.agents = result.data;
        state.lastRefreshTime = new Date();
      }
    } catch (e) {
      state.error = '加载失败';
      console.warn('[AgentStore] Failed to load agents:', e);
    } finally {
      state.isLoading = false;
    }
  },

  async refreshAgents(): Promise<void> {
    if (state.isRefreshing) return;

    state.isRefreshing = true;
    state.error = null;

    try {
      const response = await fetch('/api/stratix/config/agent/list');
      const result = await response.json();

      if (result.code === 200 && result.data) {
        const oldAgents = state.agents;
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

        state.agents = newAgents;
        state.lastRefreshTime = new Date();
      }
    } catch (e) {
      state.error = '刷新失败';
      console.warn('[AgentStore] Failed to refresh agents:', e);
    } finally {
      setTimeout(() => {
        state.isRefreshing = false;
      }, 500);
    }
  },

  async createAgent(type: 'writer' | 'dev' | 'analyst'): Promise<StratixAgentConfig | null> {
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

    state.agents.push(config);

    onAgentCreatedCallback?.(config, false);

    await this.refreshAgents();

    return config;
  },

  async createAgentFromCharacter(
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

    state.agents.push(config);

    onAgentCreatedCallback?.(config, true);

    await this.refreshAgents();

    return config;
  },

  async createCustomAgent(
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
    return this.createAgentFromCharacter(character, options);
  },

  async testBackendConnection(
    backendType: AgentBackendType,
    config: OpenClawConfig | any
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
  },

  async updateAgentProfile(
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
    const index = state.agents.findIndex(a => a.agentId === agentId);

    if (index >= 0) {
      const profile = savedCharacterToProfile(character);
      const backendType = options?.backendType || state.agents[index].backendType;

      state.agents[index].profile = profile;
      state.agents[index].name = character.name;

      if (options) {
        if (options.backendType) {
          state.agents[index].backendType = options.backendType;
        }
        if (options.openClawConfig !== undefined) {
          state.agents[index].openClawConfig = options.openClawConfig;
        }
        if (options.stratixConfig !== undefined) {
          state.agents[index].stratixConfig = options.stratixConfig;
        }
        if (options.soul !== undefined) {
          state.agents[index].soul = options.soul;
        }
        if (options.memory !== undefined) {
          state.agents[index].memory = options.memory;
        }
        if (options.skills !== undefined) {
          state.agents[index].skills = options.skills;
        }
        if (options.rules !== undefined) {
          state.agents[index].rules = options.rules;
        }
      }

      state.agents[index].configStatus = determineConfigStatus(
        profile,
        state.agents[index].backendType,
        state.agents[index].openClawConfig,
        state.agents[index].stratixConfig
      );

      state.agents[index].updatedAt = Date.now();
    }

    await this.refreshAgents();
  },

  async updateAgentConfig(
    agentId: string,
    updates: Partial<StratixAgentConfig>
  ): Promise<void> {
    const index = state.agents.findIndex(a => a.agentId === agentId);

    if (index >= 0) {
      state.agents[index] = {
        ...state.agents[index],
        ...updates,
        updatedAt: Date.now()
      };

      if (updates.backendType || updates.openClawConfig || updates.profile || updates.stratixConfig) {
        state.agents[index].configStatus = determineConfigStatus(
          state.agents[index].profile,
          state.agents[index].backendType,
          state.agents[index].openClawConfig,
          state.agents[index].stratixConfig
        );
      }

      try {
        await fetch('/api/stratix/config/agent/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.agents[index])
        });
      } catch (e) {
        console.warn('[AgentStore] Failed to update agent:', e);
      }
    }

    await this.refreshAgents();
  },

  async markAgentReady(agentId: string): Promise<void> {
    await this.updateAgentConfig(agentId, { configStatus: 'ready' });
  },

  async markAgentDraft(agentId: string): Promise<void> {
    await this.updateAgentConfig(agentId, { configStatus: 'draft' });
  },

  async deleteAgent(agentId: string): Promise<void> {
    try {
      await fetch(`/api/stratix/config/agent/delete?agentId=${agentId}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.warn('[AgentStore] Failed to delete agent:', e);
    }

    state.agents = state.agents.filter(a => a.agentId !== agentId);
    state.selectedIds = state.selectedIds.filter(id => id !== agentId);

    onAgentDeletedCallback?.(agentId);
  },

  selectAgent(agentId: string): void {
    if (!state.selectedIds.includes(agentId)) {
      state.selectedIds.push(agentId);
    }
  },

  deselectAgent(agentId: string): void {
    state.selectedIds = state.selectedIds.filter(id => id !== agentId);
  },

  setSelectedIds(ids: string[]): void {
    state.selectedIds = ids;
  },

  clearSelection(): void {
    state.selectedIds = [];
  },

  getAgentById(agentId: string): StratixAgentConfig | undefined {
    return state.agents.find(a => a.agentId === agentId);
  },

  getAgentByCharacterId(characterId: string): StratixAgentConfig | undefined {
    return state.agents.find(a => a.profile?.characterId === characterId);
  },

  startAutoRefresh(intervalMs: number = 30000): void {
    if (autoRefreshTimer) return;

    autoRefreshTimer = setInterval(() => {
      this.refreshAgents();
    }, intervalMs);

    console.log(`[AgentStore] Auto refresh started (${intervalMs}ms interval)`);
  },

  stopAutoRefresh(): void {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
      console.log('[AgentStore] Auto refresh stopped');
    }
  },

  clear(): void {
    this.stopAutoRefresh();
    if (stopPositionSaveTimer) {
      stopPositionSaveTimer();
    }
    state.agents = [];
    state.selectedIds = [];
    state.error = null;
    state.lastRefreshTime = null;
  }
};

export default agentStore;
