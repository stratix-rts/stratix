import { reactive, readonly, computed } from 'vue';
import type { 
  StratixAgentConfig, 
  SkillTreeState, 
  AgentBackendType,
  DirectLLMConfig,
  OpenClawConfig
} from '@/stratix-core';
import type { SavedCharacter } from '@/stratix-character-creator/types';
import { WriterHeroTemplate, DevHeroTemplate, AnalystHeroTemplate, generateAgentId } from '@/stratix-designer';

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

export const agentStore = {
  state: readonly(state),
  
  agents: computed(() => state.agents),
  selectedIds: computed(() => state.selectedIds),
  selectedAgents: computed(() => 
    state.agents.filter(a => state.selectedIds.includes(a.agentId))
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
        state.agents = result.data;
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

  async createCustomAgent(
    character: SavedCharacter, 
    options?: {
      backendType?: AgentBackendType;
      openClawConfig?: OpenClawConfig;
      directConfig?: DirectLLMConfig;
      soul?: StratixAgentConfig['soul'];
      skills?: StratixAgentConfig['skills'];
      rules?: string[];
    }
  ): Promise<StratixAgentConfig | null> {
    const backendType = options?.backendType || 'openclaw';
    
    const config: StratixAgentConfig = {
      agentId: `custom-${character.characterId}`,
      name: character.name || character.characterId.split('-')[0] || 'Hero',
      type: 'custom',
      backendType,
      openClawConfig: backendType === 'openclaw' 
        ? (options?.openClawConfig || { accountId: '', endpoint: '' })
        : undefined,
      directConfig: backendType === 'direct' 
        ? options?.directConfig 
        : undefined,
      character: {
        characterId: character.characterId,
        bodyType: character.bodyType,
        parts: character.parts,
        thumbnail: character.thumbnail,
        texture: character.texture,
        createdAt: character.createdAt,
        updatedAt: character.updatedAt
      },
      skillTree: character.skillTree,
      attributes: character.attributes,
      soul: options?.soul,
      skills: options?.skills,
      rules: options?.rules,
    };
    
    try {
      await fetch('/api/stratix/config/agent/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
    } catch (e) {
      console.warn('[AgentStore] Failed to save custom agent:', e);
    }
    
    state.agents.push(config);
    
    onAgentCreatedCallback?.(config, true);
    
    await this.refreshAgents();
    
    return config;
  },

  async createDirectAgent(config: {
    name: string;
    directConfig: DirectLLMConfig;
    soul?: StratixAgentConfig['soul'];
    memory?: StratixAgentConfig['memory'];
    skills?: StratixAgentConfig['skills'];
    rules?: string[];
    character?: SavedCharacter;
  }): Promise<StratixAgentConfig | null> {
    const agentId = `stratix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-custom`;
    
    const agentConfig: StratixAgentConfig = {
      agentId,
      name: config.name,
      type: 'custom',
      backendType: 'direct',
      directConfig: config.directConfig,
      soul: config.soul,
      memory: config.memory,
      skills: config.skills,
      rules: config.rules,
      character: config.character ? {
        characterId: config.character.characterId,
        bodyType: config.character.bodyType,
        parts: config.character.parts,
        thumbnail: config.character.thumbnail,
        texture: config.character.texture,
        createdAt: config.character.createdAt,
        updatedAt: config.character.updatedAt
      } : undefined,
      skillTree: config.character?.skillTree,
      attributes: config.character?.attributes,
    };
    
    try {
      await fetch('/api/stratix/config/agent/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentConfig)
      });
    } catch (e) {
      console.warn('[AgentStore] Failed to save direct agent:', e);
    }
    
    state.agents.push(agentConfig);
    
    onAgentCreatedCallback?.(agentConfig, true);
    
    await this.refreshAgents();
    
    return agentConfig;
  },

  async testBackendConnection(
    backendType: AgentBackendType,
    config: OpenClawConfig | DirectLLMConfig
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

  async updateCustomAgent(
    character: SavedCharacter, 
    options?: {
      backendType?: AgentBackendType;
      openClawConfig?: OpenClawConfig;
      directConfig?: DirectLLMConfig;
      soul?: StratixAgentConfig['soul'];
      skills?: StratixAgentConfig['skills'];
      rules?: string[];
    }
  ): Promise<void> {
    const agentId = `custom-${character.characterId}`;
    const index = state.agents.findIndex(a => a.agentId === agentId);
    
    if (index >= 0) {
      state.agents[index].character = {
        characterId: character.characterId,
        bodyType: character.bodyType,
        parts: character.parts,
        thumbnail: character.thumbnail,
        texture: character.texture,
        createdAt: character.createdAt,
        updatedAt: character.updatedAt
      };
      state.agents[index].skillTree = character.skillTree;
      state.agents[index].attributes = character.attributes;
      
      if (options) {
        if (options.backendType) {
          state.agents[index].backendType = options.backendType;
        }
        if (options.openClawConfig) {
          state.agents[index].openClawConfig = options.openClawConfig;
        }
        if (options.directConfig) {
          state.agents[index].directConfig = options.directConfig;
        }
        if (options.soul) {
          state.agents[index].soul = options.soul;
        }
        if (options.skills) {
          state.agents[index].skills = options.skills;
        }
        if (options.rules) {
          state.agents[index].rules = options.rules;
        }
      }
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
    state.agents = [];
    state.selectedIds = [];
    state.error = null;
    state.lastRefreshTime = null;
  }
};

export default agentStore;
