<script setup lang="ts">
import { SvgIcon, StratixDropdown } from '@/components/ui';
import type { DropdownOption } from '@/components/ui';
import { computed } from 'vue';
import { useAgentStore } from '../stores/agent';

const agentStore = useAgentStore();
import { StratixPanel, StratixButton } from '@/components/ui';
import { getToken } from '@/design-system/config';

// 图标名称常量
const plus = 'plus';
const refresh = 'refresh';
const settings = 'settings';
const user = 'user';

const props = defineProps<{
  selectedIds?: string[];
  isRefreshing?: boolean;
}>();

const emit = defineEmits<{
  (e: 'create', type: 'writer' | 'dev' | 'analyst'): void;
  (e: 'delete', agentId: string): void;
  (e: 'select', agentId: string): void;
  (e: 'open-character-creator'): void;
  (e: 'refresh'): void;
}>();

const agents = computed(() => agentStore.agents.value);
const storeRefreshing = computed(() => agentStore.isRefreshing.value);
const lastRefreshTime = computed(() => agentStore.lastRefreshTime.value);
const isRefreshing = computed(() => props.isRefreshing || storeRefreshing.value);

// 使用 SVG 图标替代 Emoji
// Agent 类型配置（使用 SVG 图标）
const heroTypes = [
  { type: 'writer' as const, name: '文案英雄', color: getToken('colors.semantic.success') },
  { type: 'dev' as const, name: '开发英雄', color: getToken('colors.info') },
  { type: 'analyst' as const, name: '数据英雄', color: '#ff6b9d' }
];

// Dropdown 选项配置
const dropdownOptions = computed<DropdownOption[]>(() => [
  ...heroTypes.map(hero => ({
    label: hero.name,
    value: hero.type,
    color: hero.color,
  })),
  {
    label: '自定义角色',
    value: 'custom',
    color: getToken('colors.accent'),
    divided: true,
  },
]);

const getHeroTypeColor = (type: string) => {
  if (type === 'custom') return getToken('colors.accent');
  return heroTypes.find(h => h.type === type)?.color || getToken('colors.text.muted');
};

const isSelected = (agentId: string) => {
  return props.selectedIds?.includes(agentId) || false;
};

const getAgentThumbnail = (agent: any) => {
  return agent.profile?.thumbnail || null;
};

const getAgentStatus = (agent: any) => {
  return agent.status || 'online';
};

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    online: getToken('colors.semantic.success'),
    offline: getToken('colors.text.muted'),
    busy: getToken('colors.warning'),
    error: getToken('colors.semantic.danger')
  };
  return colors[status] || getToken('colors.text.muted');
};

const getStatusText = (status: string) => {
  const texts: Record<string, string> = {
    online: '在线',
    offline: '离线',
    busy: '忙碌',
    error: '错误'
  };
  return texts[status] || '未知';
};

const handleRefresh = () => {
  if (isRefreshing.value) return;
  emit('refresh');
  agentStore.refreshAgents();
};

const formatTime = (date: Date | null) => {
  if (!date) return '--:--:--';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const handleCreateSelect = (value: string | number) => {
  if (value === 'custom') {
    emit('open-character-creator');
  } else {
    emit('create', value as 'writer' | 'dev' | 'analyst');
  }
};

const panelStyle = computed(() => getToken('panel.default'));
</script>

<template>
  <StratixPanel variant="default" class="agent-panel">
    <div class="panel-header">
      <h3 class="panel-title">英雄列表</h3>
      <div class="header-actions">
        <StratixButton 
          variant="secondary" 
          size="sm"
          :loading="isRefreshing"
          @click="handleRefresh"
          :icon="refresh"
          title="刷新列表"
        >
          刷新
        </StratixButton>
        
        <StratixButton 
          variant="secondary" 
          size="sm"
          @click="emit('open-character-creator')"
          :icon="settings"
          title="自定义角色"
        >
          自定义
        </StratixButton>
        
        <StratixDropdown 
          :options="dropdownOptions"
          size="sm"
          @select="handleCreateSelect"
        >
          <StratixButton variant="primary" size="sm" :icon="plus">
            新建
          </StratixButton>
        </StratixDropdown>
      </div>
    </div>
    
    <div class="refresh-info" v-if="lastRefreshTime">
      <span class="refresh-label">上次刷新:</span>
      <span class="refresh-time">{{ formatTime(lastRefreshTime) }}</span>
    </div>
    
    <div class="agent-list">
      <div 
        v-for="agent in agents" 
        :key="agent.agentId"
        class="agent-card"
        :class="{ selected: isSelected(agent.agentId) }"
        @click="emit('select', agent.agentId)"
      >
        <div class="agent-avatar">
          <img 
            v-if="getAgentThumbnail(agent)" 
            :src="getAgentThumbnail(agent)!" 
            class="avatar-img"
          />
          <div 
            v-else 
            class="avatar-placeholder"
            :style="{ background: getHeroTypeColor(agent.type) + '20' }"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" :stroke="getHeroTypeColor(agent.type)" stroke-width="2">
              <SvgIcon :name="user" :size="16" />
            </svg>
          </div>
        </div>
        
        <div class="agent-info">
          <div class="agent-name">{{ agent.name }}</div>
          <div class="agent-meta">
            <span class="agent-type" :style="{ color: getHeroTypeColor(agent.type) }">
              {{ agent.type }}
            </span>
            <span class="agent-status" :style="{ color: getStatusColor(getAgentStatus(agent)) }">
              {{ getStatusText(getAgentStatus(agent)) }}
            </span>
          </div>
        </div>
        
        <div class="agent-actions">
          <button 
            class="action-btn"
            @click.stop="emit('delete', agent.agentId)"
            title="删除"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path :d="'trash'" />
            </svg>
          </button>
        </div>
      </div>
      
      <div v-if="agents.length === 0" class="empty-state">
        <p>暂无英雄</p>
        <p class="empty-hint">点击右上角"新建"创建第一个英雄</p>
      </div>
    </div>
  </StratixPanel>
</template>

<style scoped>
.agent-panel {
  padding: v-bind('panelStyle.padding');
  background: v-bind('panelStyle.background');
  border: v-bind('panelStyle.border');
  border-radius: v-bind('panelStyle.borderRadius');
  max-width: 400px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.panel-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--ds-text);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.refresh-info {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--ds-text-secondary);
  margin-bottom: 16px;
}

.refresh-label {
  font-weight: 500;
}

.refresh-time {
  font-family: 'SF Mono', 'Monaco', monospace;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.agent-card:hover {
  background: var(--ds-bg-secondary);
  border-color: var(--ds-border);
}

.agent-card.selected {
  border-color: var(--ds-accent);
  background: rgba(0, 212, 255, 0.1);
}

.agent-avatar {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--ds-bg-secondary);
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.agent-info {
  flex: 1;
  min-width: 0;
}

.agent-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--ds-text);
  margin-bottom: 4px;
}

.agent-meta {
  display: flex;
  gap: 8px;
  font-size: 12px;
}

.agent-type,
.agent-status {
  font-weight: 500;
}

.agent-actions {
  display: flex;
  gap: 4px;
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
  background: var(--ds-danger);
  border-color: var(--ds-danger);
  color: white;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--ds-text-muted);
}

.empty-state p {
  margin: 8px 0;
}

.empty-hint {
  font-size: 12px;
}

.type-indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 8px;
}
</style>
