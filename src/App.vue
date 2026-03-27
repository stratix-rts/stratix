<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { createStratixRTS } from './stratix-rts';
import { StratixEventBus, StratixAgentConfig, StratixFrontendOperationEvent } from './stratix-core';
import MainLayout from './components/MainLayout.vue';
import CharacterCreatorModal from './components/CharacterCreatorModalV2.vue';
import AgentChatModal from './components/AgentChatModal.vue';
import ProjectConfigPanel from './stratix-project/ui/ProjectConfigPanel.vue';
import ZonePanel from './stratix-project/ui/ZonePanel.vue';
import DataExplorer from './stratix-project/ui/DataExplorer.vue';
import type { Zone } from './stratix-project/types';
import { agentStore } from './stores/agentStore';
import type { SavedCharacter } from './stratix-character-creator/types';
import type { ProjectConfig, Project } from './stratix-project/types';
import { rtsEventBus } from './stratix-rts/events/core/RTSEventBus';

const gameContainer = ref<HTMLElement | null>(null);
const isGameReady = ref(false);
const currentSkill = ref<any>(null);
const commandLogs = ref<any[]>([]);
const showCharacterCreator = ref(false);
const editCharacterId = ref<string | undefined>(undefined);
const showTaskModal = ref(false);
const showChatModal = ref(false);
const chatAgentIds = ref<string[]>([]);
const selectedProjectId = ref<string | null>(null);
const selectedProjectPath = ref<string | null>(null);
const showProjectConfig = ref(false);
const currentProject = ref<Project | null>(null);
const showZonePanel = ref(false);
const currentZone = ref<Zone | null>(null);
const showDataExplorer = ref(false);
const dataExplorerZoneId = ref<string | undefined>(undefined);

let game: Phaser.Game | null = null;
let eventBus: StratixEventBus;

// 从 store 获取状态
const agents = computed(() => agentStore.agents.value);
const selectedAgentIds = computed(() => agentStore.selectedIds.value);
const isRefreshing = computed(() => agentStore.isRefreshing.value);

const handleAgentSelect = (event: StratixFrontendOperationEvent) => {
  agentStore.setSelectedIds(event.payload.agentIds || []);
};

const handleCommandExecute = async (event: StratixFrontendOperationEvent) => {
  if (!event.payload.command) return;
  
  const log = {
    commandId: event.payload.command.commandId,
    agentId: event.payload.command.agentId,
    skillName: event.payload.skill?.name || 'Unknown',
    status: 'pending' as const,
    time: new Date().toLocaleTimeString(),
    params: event.payload.command.params
  };
  
  commandLogs.value.unshift(log);
  if (commandLogs.value.length > 20) commandLogs.value.pop();

  try {
    const response = await fetch('/api/stratix/command/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event.payload.command)
    });
    const result = await response.json();
    
    log.status = result.code === 200 ? 'success' : 'failed';
  } catch (error) {
    log.status = 'failed';
  }
};

const addAgentToRTS = (config: StratixAgentConfig, centerOnScreen: boolean = false) => {
  if (!game) return;
  const scene = game.scene.getScene('StratixRTSGameScene') as any;
  if (scene) {
    if (centerOnScreen) {
      scene.addAgentSprite(config, true).catch(err => {
        console.error('[RTS] Failed to create agent sprite:', err);
      });
    } else {
      scene.events.emit('stratix:create-agent', config);
    }
  }
};

const selectAgentInRTS = (agentId: string) => {
  if (!game) return;
  const scene = game.scene.getScene('StratixRTSGameScene') as any;
  if (scene) {
    scene.clearSelection();
    scene.selectAgent(agentId);
  }
};

const createAgent = async (type: 'writer' | 'dev' | 'analyst') => {
  await agentStore.createAgent(type);
};

const deleteAgent = async (agentId: string) => {
  await agentStore.deleteAgent(agentId);
};

const openCharacterCreator = (characterId?: string) => {
  editCharacterId.value = characterId;
  showCharacterCreator.value = true;
};

const closeCharacterCreator = () => {
  showCharacterCreator.value = false;
  editCharacterId.value = undefined;
};

const handleCharacterCreated = async (character: SavedCharacter) => {
  console.log('========================================');
  console.log('[App] 🔵 handleCharacterCreated called');
  console.log('[App] 📦 Character:', character);
  console.log('[App] 🎮 Game instance exists:', !!game);
  
  // 🚨 立即关闭弹窗
  closeCharacterCreator();
  console.log('[App] ✅ Modal closed');
  
  if (game) {
    const scene = game.scene.getScene('StratixRTSGameScene') as any;
    console.log('[App] 🎬 Scene exists:', !!scene);
    
    if (scene) {
      console.log('[App] 🚀 Emitting character:spawning event');
      scene.events.emit('character:spawning', {
        characterId: character.characterId,
        name: character.name,
        bodyType: character.bodyType,
        parts: character.parts,
        thumbnail: character.thumbnail
      });
    } else {
      console.error('[App] ❌ Scene not found');
    }
  } else {
    console.error('[App] ❌ Game instance not found');
  }
  
  console.log('[App] 🔄 Starting async agent creation...');
  agentStore.createCustomAgent(character, {
    backendType: character.backendType,
    openClawConfig: character.openClawConfig,
    stratixConfig: character.stratixConfig
  })
    .then(config => {
      console.log('[App] ✅ Agent created successfully:', config);
      if (game) {
        const scene = game.scene.getScene('StratixRTSGameScene') as any;
        if (scene) {
          console.log('[App] 🎉 Emitting character:spawn-complete event');
          scene.events.emit('character:spawn-complete', config);
        }
      }
    })
    .catch(err => {
      console.error('[App] ❌ Failed to create agent:', err);
      if (game) {
        const scene = game.scene.getScene('StratixRTSGameScene') as any;
        if (scene) {
          console.log('[App] 🔴 Emitting character:spawn-failed event');
          scene.events.emit('character:spawn-failed', {
            characterId: character.characterId,
            error: err.message || 'Unknown error'
          });
        }
      }
    });
  
  console.log('[App] ✅ handleCharacterCreated completed (async operations running in background)');
  console.log('========================================');
};

const handleCharacterUpdated = (character: SavedCharacter) => {
  console.log('Character updated:', character);
  agentStore.updateCustomAgent(character);
};

const handleCharacterDeleted = (characterId: string) => {
  console.log('Character deleted:', characterId);
  const agentId = `custom-${characterId}`;
  agentStore.deleteAgent(agentId);
};

const handleOpenTaskModal = (projectId: string, projectPath: string) => {
  selectedProjectId.value = projectId;
  selectedProjectPath.value = projectPath;
  showTaskModal.value = true;
};

const handleProjectCreated = (data: { project: Project; needsConfig: boolean }) => {
  console.log('[App] handleProjectCreated called:', data.project.id, 'needs config:', data.needsConfig);
  
  currentProject.value = data.project;
  
  if (data.needsConfig) {
    showProjectConfig.value = true;
  }
};

const handleProjectConfigSave = async (config: ProjectConfig) => {
  if (!currentProject.value) return;
  
  console.log('[App] Saving project config:', currentProject.value.id, config);
  
  try {
    const response = await fetch(`/api/projects/${currentProject.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: {
          name: config.name,
          description: config.description,
          priority: config.priority,
          config: config,
          path: config.localFolderPath
        }
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('[App] Project config saved successfully');
      showProjectConfig.value = false;
      currentProject.value = null;
    } else {
      throw new Error(result.error || 'Failed to save project config');
    }
  } catch (error: any) {
    console.error('[App] Failed to save project config:', error);
    throw error;
  }
};

const handleProjectConfigClose = () => {
  showProjectConfig.value = false;
  currentProject.value = null;
};

const handleZonePanelClose = () => {
  showZonePanel.value = false;
  currentZone.value = null;
};

// 打开数据浏览器（可选指定 Zone ID）
const openDataExplorer = (zoneId?: string) => {
  dataExplorerZoneId.value = zoneId;
  showDataExplorer.value = true;
};

onMounted(async () => {
  eventBus = StratixEventBus.getInstance();
  
  eventBus.subscribe('stratix:agent_select', handleAgentSelect);
  eventBus.subscribe('stratix:command_execute', handleCommandExecute as any);
  
  // 设置 agent 创建/删除回调
  agentStore.setOnAgentCreated((config, centerOnScreen) => {
    addAgentToRTS(config, centerOnScreen);
  });
  
  agentStore.setOnAgentDeleted((agentId) => {
    if (!game) return;
    const scene = game.scene.getScene('StratixRTSGameScene') as any;
    if (scene) {
      scene.removeAgent(agentId);
    }
  });
  
  agentStore.setOnAgentUpdated((config) => {
    if (!game) return;
    const scene = game.scene.getScene('StratixRTSGameScene') as any;
    if (scene && config.position) {
      scene.updateAgentPosition(config.agentId, config.position);
    }
  });
  
  // 加载 agents
  await agentStore.loadAgents();
  
  if (gameContainer.value) {
    game = createStratixRTS({
      parent: gameContainer.value,
      width: gameContainer.value.clientWidth || 800,
      height: gameContainer.value.clientHeight || 600
    });
    
    game.events.on('ready', () => {
      isGameReady.value = true;
      setTimeout(() => {
        Promise.all(agents.value.map(config => addAgentToRTS(config)));
      }, 100);
      
      const scene = game!.scene.getScene('StratixRTSGameScene') as any;
      if (scene) {
        scene.events.on('zone:double-click', async (zoneId: string) => {
          console.log('[App] Zone double-clicked:', zoneId);

          try {
            // First try to fetch zone directly
            let response = await fetch(`/api/zones/${zoneId}`);
            let result = await response.json();

            // If not found, it might be a projectId - try to get zone context via projectId
            if (!result.success || !result.zone) {
              console.log('[App] Zone not found directly, trying project lookup:', zoneId);
              response = await fetch(`/api/zones?projectId=${zoneId}`);
              result = await response.json();

              if (result.success && result.zones && result.zones.length > 0) {
                // Use the first zone context found
                result.zone = result.zones[0];
                console.log('[App] Found zone via project lookup:', result.zone.id);
              }
            }

            if (result.success && result.zone) {
              currentZone.value = result.zone;
              showZonePanel.value = true;
            } else {
              console.error('[App] Failed to fetch zone:', result.error);
            }
          } catch (error) {
            console.error('[App] Error fetching zone:', error);
          }
        });

        // Handle zone deletion - close ZonePanel if this zone is shown
        scene.events.on('stratix:zone-deleted', (data: { zoneId: string }) => {
          console.log('[App] Zone deleted event:', data.zoneId);
          if (currentZone.value && currentZone.value.id === data.zoneId) {
            showZonePanel.value = false;
            currentZone.value = null;
            console.log('[App] ZonePanel closed (zone was deleted)');
          }
        });

        // Handle zone member changes - refresh current zone if it was updated
        scene.events.on('stratix:zone-member-joined', async (data: { zoneId: string; agentId: string }) => {
          console.log('[App] Zone member joined event:', data);
          if (currentZone.value && currentZone.value.id === data.zoneId) {
            // Refresh zone data to get updated members list
            try {
              const response = await fetch(`/api/zones/${data.zoneId}`);
              const result = await response.json();
              if (result.success && result.zone) {
                currentZone.value = result.zone;
                console.log('[App] Zone refreshed with new member:', data.agentId);
              }
            } catch (error) {
              console.error('[App] Failed to refresh zone after member joined:', error);
            }
          }
        });

        scene.events.on('stratix:zone-member-left', async (data: { zoneId: string; agentId: string }) => {
          console.log('[App] Zone member left event:', data);
          if (currentZone.value && currentZone.value.id === data.zoneId) {
            // Refresh zone data to get updated members list
            try {
              const response = await fetch(`/api/zones/${data.zoneId}`);
              const result = await response.json();
              if (result.success && result.zone) {
                currentZone.value = result.zone;
                console.log('[App] Zone refreshed after member left:', data.agentId);
              }
            } catch (error) {
              console.error('[App] Failed to refresh zone after member left:', error);
            }
          }
        });
      }
      
      rtsEventBus.on('game:ui:project_created', handleProjectCreated);
      rtsEventBus.on('game:ui:config_click', ({ agentId }: { agentId: string }) => {
        openCharacterCreator(agentId.replace('custom-', ''));
      });
      rtsEventBus.on('game:ui:task_click', ({ agentIds }: { agentIds: string[] }) => {
        if (agentIds.length > 0) {
          const agentId = agentIds[0];
          const agent = agents.value.find(a => a.agentId === agentId);
          if (agent) {
            handleOpenTaskModal(agentId, agent.config?.projectPath || '');
          }
        }
      });
      rtsEventBus.on('game:ui:stop_agents', async ({ agentIds }: { agentIds: string[] }) => {
        try {
          for (const agentId of agentIds) {
            await fetch(`/api/agents/${agentId}/stop`, {
              method: 'POST',
            });
          }
        } catch (error) {
          console.error('[App] Failed to stop agents:', error);
        }
      });
      rtsEventBus.on('game:ui:chat_click', ({ agentIds }: { agentIds: string[] }) => {
        chatAgentIds.value = agentIds;
        showChatModal.value = true;
      });
    });
  }
  
  // 启动自动刷新
  agentStore.startAutoRefresh(30000);

  // 键盘快捷键：Ctrl+D 打开 Data Explorer
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      showDataExplorer.value = true;
    }
  });
});

onUnmounted(() => {
  agentStore.stopAutoRefresh();
  agentStore.clear();
  
  if (eventBus) {
    eventBus.unsubscribe('stratix:agent_select', handleAgentSelect);
    eventBus.unsubscribe('stratix:command_execute', handleCommandExecute as any);
  }
  
  rtsEventBus.off('game:ui:project_created', handleProjectCreated);
  rtsEventBus.off('game:ui:config_click', (({ agentId }: { agentId: string }) => {
    openCharacterCreator(agentId.replace('custom-', ''));
  }) as any);
  rtsEventBus.off('game:ui:task_click', (({ agentIds }: { agentIds: string[] }) => {
    if (agentIds.length > 0) {
      const agentId = agentIds[0];
      const agent = agents.value.find(a => a.agentId === agentId);
      if (agent) {
        handleOpenTaskModal(agentId, agent.config?.projectPath || '');
      }
    }
  }) as any);
  rtsEventBus.off('game:ui:stop_agents', (({ agentIds }: { agentIds: string[] }) => {
    console.log('Stop agents:', agentIds);
  }) as any);
  
  if (game) {
    game.destroy(true);
  }
});
</script>

<template>
  <MainLayout
    :game-container="gameContainer"
    :is-game-ready="isGameReady"
    :agents="agents"
    :selected-agent-ids="selectedAgentIds"
    :command-logs="commandLogs"
    :is-refreshing="isRefreshing"
    :show-task-modal="showTaskModal"
    :selected-project-id="selectedProjectId"
    :selected-project-path="selectedProjectPath"
    @create-agent="createAgent"
    @delete-agent="deleteAgent"
    @select-agent="selectAgentInRTS"
    @open-character-creator="openCharacterCreator()"
    @refresh-agents="agentStore.refreshAgents()"
    @update:show-task-modal="showTaskModal = $event"
    @open-data-explorer="showDataExplorer = true"
  >
    <template #game>
      <div ref="gameContainer" class="game-container"></div>
    </template>
  </MainLayout>
  
  <CharacterCreatorModal
    :visible="showCharacterCreator"
    :edit-character-id="editCharacterId"
    @close="closeCharacterCreator"
    @created="handleCharacterCreated"
    @updated="handleCharacterUpdated"
    @deleted="handleCharacterDeleted"
  />
  
  <AgentChatModal
    :visible="showChatModal"
    :agent-ids="chatAgentIds"
    :mode="chatAgentIds.length > 1 ? 'group' : 'single'"
    @close="showChatModal = false"
  />
  
  <ProjectConfigPanel
    :visible="showProjectConfig"
    :project-id="currentProject?.id"
    :initial-config="currentProject?.config"
    :project-status="currentProject?.status"
    @close="handleProjectConfigClose"
    @save="handleProjectConfigSave"
  />

  <ZonePanel
    :visible="showZonePanel"
    :zone="currentZone"
    @close="handleZonePanelClose"
    @update:visible="showZonePanel = $event"
    @open-data-explorer="openDataExplorer"
  />

  <DataExplorer
    v-model:visible="showDataExplorer"
    :initial-zone-id="dataExplorerZoneId"
  />
</template>

<style>
.game-container {
  width: 100%;
  height: 100%;
  background: var(--ds-bg-primary);
}
</style>
