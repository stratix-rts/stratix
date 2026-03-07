<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { createStratixRTS } from './stratix-rts';
import { StratixEventBus, StratixAgentConfig, StratixFrontendOperationEvent } from './stratix-core';
import MainLayout from './components/MainLayout.vue';
import CharacterCreatorModal from './components/CharacterCreatorModal.vue';
import ProjectConfigPanel from './stratix-project/ui/ProjectConfigPanel.vue';
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
const selectedProjectId = ref<string | null>(null);
const selectedProjectPath = ref<string | null>(null);
const showProjectConfig = ref(false);
const currentProject = ref<Project | null>(null);

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
  agentStore.createCustomAgent(character)
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
  console.log('[App] Project created:', data.project.id, 'needs config:', data.needsConfig);
  
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
        agents.value.forEach(config => addAgentToRTS(config));
      }, 100);
      
      const scene = game!.scene.getScene('StratixRTSGameScene') as any;
      if (scene) {
        scene.events.on('zone:double-click', async (zoneId: string) => {
          console.log('[App] Zone double-clicked:', zoneId);
          
          const projectManagerIntegration = scene.projectManagerIntegration;
          if (projectManagerIntegration) {
            const project = await projectManagerIntegration.getProjectClient().getProject(zoneId);
            if (project) {
              handleOpenTaskModal(zoneId, project.path);
            }
          }
        });
      }
      
      rtsEventBus.on('game:ui:project_created', handleProjectCreated);
    });
    
    if (game.isBooted) {
      isGameReady.value = true;
      setTimeout(() => {
        agents.value.forEach(config => addAgentToRTS(config));
      }, 100);
    }
  }
  
  // 启动自动刷新
  agentStore.startAutoRefresh(30000);
});

onUnmounted(() => {
  agentStore.stopAutoRefresh();
  agentStore.clear();
  
  if (eventBus) {
    eventBus.unsubscribe('stratix:agent_select', handleAgentSelect);
    eventBus.unsubscribe('stratix:command_execute', handleCommandExecute as any);
  }
  
  rtsEventBus.off('game:ui:project_created', handleProjectCreated);
  
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
  
  <ProjectConfigPanel
    :visible="showProjectConfig"
    :project-id="currentProject?.id"
    :initial-config="currentProject?.config"
    :project-status="currentProject?.status"
    @close="handleProjectConfigClose"
    @save="handleProjectConfigSave"
  />
</template>

<style>
.game-container {
  width: 100%;
  height: 100%;
  background: #1a1a2e;
}
</style>
