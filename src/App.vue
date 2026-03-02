<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { createStratixRTS } from './stratix-rts';
import { StratixEventBus, StratixAgentConfig, StratixFrontendOperationEvent } from './stratix-core';
import MainLayout from './components/MainLayout.vue';
import CharacterCreatorModal from './components/CharacterCreatorModal.vue';
import { agentStore } from './stores/agentStore';
import type { SavedCharacter } from './stratix-character-creator/types';

const gameContainer = ref<HTMLElement | null>(null);
const isGameReady = ref(false);
const currentSkill = ref<any>(null);
const commandLogs = ref<any[]>([]);
const showCharacterCreator = ref(false);
const editCharacterId = ref<string | undefined>(undefined);

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
  console.log('Character created:', character);
  await agentStore.createCustomAgent(character);
  closeCharacterCreator();
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

onMounted(async () => {
  eventBus = StratixEventBus.getInstance();
  
  eventBus.subscribe('stratix:agent_select', handleAgentSelect);
  eventBus.subscribe('stratix:command_execute', handleCommandExecute as any);
  
  // 设置 agent 创建/删除回调
  agentStore.setOnAgentCreated((config, centerOnScreen) => {
    addAgentToRTS(config, centerOnScreen);
  });
  
  agentStore.setOnAgentDeleted((agentId) => {
    // 可以在这里处理删除后的逻辑
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
    @create-agent="createAgent"
    @delete-agent="deleteAgent"
    @select-agent="selectAgentInRTS"
    @open-character-creator="openCharacterCreator()"
    @refresh-agents="agentStore.refreshAgents()"
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
</template>

<style>
.game-container {
  width: 100%;
  height: 100%;
  background: #1a1a2e;
}
</style>
