<script setup lang="ts">
import { SvgIcon } from '@/components/ui';
import { computed } from 'vue';
import { StratixAgentConfig, StratixSkillConfig } from '../stratix-core';
import { StratixPanel, StratixButton } from '@/components/ui';
import { getToken } from '@/design-system/config';
interface Props {
  selectedAgents: StratixAgentConfig[];
  commandLogs: any[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'execute', skill: StratixSkillConfig, params: Record<string, any>): void;
}>();

const panelStyle = computed(() => getToken('panel.default'));
const selectedCount = computed(() => props.selectedAgents.length);
const settingsIcon = 'settings';
</script>

<template>
  <StratixPanel variant="default" class="command-panel">
    <div class="header">
      <h3>指令面板</h3>
      <div class="actions">
        <button class="action-btn" title="设置">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <SvgIcon :name="settingsIcon" size="16" />
          </svg>
        </button>
      </div>
    </div>
    
    <div v-if="selectedCount === 0" class="empty-state">
      <p>请先在地图中选择英雄</p>
    </div>
    
    <div v-else class="selected-info">
      <p>已选中 {{ selectedCount }} 个英雄</p>
      <div class="agent-list">
        <div 
          v-for="agent in selectedAgents" 
          :key="agent.agentId"
          class="agent-item"
        >
          <span class="agent-name">{{ agent.name }}</span>
          <span class="agent-type">{{ agent.type }}</span>
        </div>
      </div>
    </div>
  </StratixPanel>
</template>

<style scoped>
.command-panel {
  padding: v-bind('panelStyle.padding');
  background: v-bind('panelStyle.background');
  border: v-bind('panelStyle.border');
  border-radius: v-bind('panelStyle.borderRadius');
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--ds-text);
}

.actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn:hover {
  background: var(--ds-accent);
  border-color: var(--ds-accent);
  color: var(--ds-bg-primary);
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--ds-text-muted);
  font-size: 14px;
}

.selected-info {
  padding: 16px;
  background: rgba(0, 212, 255, 0.1);
  border-radius: 4px;
  color: var(--ds-info);
}

.selected-info p {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 500;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--ds-bg-tertiary);
  border-radius: 4px;
  font-size: 13px;
}

.agent-name {
  font-weight: 500;
}

.agent-type {
  color: var(--ds-text-secondary);
  font-size: 12px;
}
</style>
