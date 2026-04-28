<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAgentStore } from '../stores/agent';

const agentStore = useAgentStore();
import { StratixModal, StratixButton, StratixDropdown, SvgIcon } from '@/components/ui';
import type { DropdownOption } from '@/components/ui';
import { getToken } from '@/design-system/config';

const plus = 'plus';
const refresh = 'refresh';
const settings = 'settings';
const trash = 'trash';
const user = 'user';

const props = defineProps<{
  visible: boolean;
  selectedIds?: string[];
  isRefreshing?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:visible', value: boolean): void;
  (e: 'create', type: 'writer' | 'dev' | 'analyst'): void;
  (e: 'delete', agentId: string): void;
  (e: 'select', agentId: string): void;
  (e: 'open-character-creator'): void;
  (e: 'refresh'): void;
}>();

const agents = computed(() => agentStore.agents);
const storeRefreshing = computed(() => agentStore.isRefreshing);
const lastRefreshTime = computed(() => agentStore.lastRefreshTime);

const heroTypes = [
  { type: 'writer' as const, name: '文案英雄', color: 'var(--ds-status-success)' },
  { type: 'dev' as const, name: '开发英雄', color: 'var(--ds-status-info)' },
  { type: 'analyst' as const, name: '数据英雄', color: 'var(--ds-status-warning)' }
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

// 空状态下的选项（没有自定义角色）
const emptyDropdownOptions = computed<DropdownOption[]>(() =>
  heroTypes.map(hero => ({
    label: hero.name,
    value: hero.type,
    color: hero.color,
  }))
);

const isRefreshing = computed(() => props.isRefreshing || storeRefreshing.value);

const getHeroTypeColor = (type: string) => {
  if (type === 'custom') return getToken('colors.accent');
  return heroTypes.find(h => h.type === type)?.color || getToken('colors.text.muted');
};

const isSelected = (agentId: string) => {
  return props.selectedIds?.includes(agentId) || false;
};

const getAgentStatus = (agent: any) => {
  return agent.status || 'online';
};

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    online: 'var(--ds-status-success)',
    offline: 'var(--ds-text-muted)',
    busy: 'var(--ds-status-warning)',
    error: 'var(--ds-status-danger)'
  };
  return colors[status] || 'var(--ds-text-muted)';
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

const handleClose = () => {
  emit('update:visible', false);
};

const handleCreateSelect = (value: string | number) => {
  if (value === 'custom') {
    emit('open-character-creator');
  } else {
    emit('create', value as 'writer' | 'dev' | 'analyst');
  }
};
</script>

<template>
  <StratixModal
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    title="英雄管理"
    size="lg"
    @close="handleClose"
  >
    <div class="panel-header">
      <h3>英雄列表</h3>
      <div class="header-actions">
        <StratixButton 
          variant="secondary" 
          size="sm"
          :loading="isRefreshing"
          :icon="refresh"
          @click="handleRefresh"
          :disabled="isRefreshing"
          title="刷新列表"
          class="refresh-btn"
        />
        
        <StratixButton 
          variant="secondary" 
          size="sm"
          :icon="settings"
          @click="emit('open-character-creator')"
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
      <TransitionGroup name="agent-card">
        <div 
          v-for="agent in agents" 
          :key="agent.agentId"
          class="agent-card"
          :class="{ selected: isSelected(agent.agentId) }"
          @click="emit('select', agent.agentId)"
        >
          <div class="agent-avatar">
            <img 
              v-if="agent.profile?.thumbnail" 
              :src="agent.profile.thumbnail!" 
              class="avatar-img"
            />
            <div 
              v-else 
              class="avatar-placeholder"
              :style="{ background: getHeroTypeColor(agent.type) + '20' }"
            >
              <SvgIcon :name="user" :color="getHeroTypeColor(agent.type)" :size="16" />
            </div>
            <div 
              class="status-dot"
              :class="getAgentStatus(agent)"
              :style="{ background: getStatusColor(getAgentStatus(agent)) }"
            ></div>
          </div>
          <div class="agent-info">
            <div class="agent-name">{{ agent.name }}</div>
            <div class="agent-meta">
              <span class="agent-status" :style="{ color: getStatusColor(getAgentStatus(agent)) }">
                {{ getStatusText(getAgentStatus(agent)) }}
              </span>
              <span class="agent-divider">·</span>
              <span class="agent-skills">{{ agent.skills?.length || 0 }} 技能</span>
            </div>
          </div>
          <StratixButton 
            variant="secondary" 
            size="sm"
            :icon="trash"
            @click.stop="emit('delete', agent.agentId)"
            title="删除"
            class="delete-btn"
          />
        </div>
      </TransitionGroup>
      
      <div v-if="agents?.length === 0" class="empty-state">
        <div class="empty-float">
          <SvgIcon :name="user" :color="getToken('colors.accent')" :size="48" :stroke-width="1.5" />
        </div>
        <div class="empty-title">还没有英雄</div>
        <div class="empty-desc">点击上方按钮创建你的第一个英雄</div>
        <div class="empty-actions">
          <StratixDropdown 
            :options="emptyDropdownOptions"
            size="sm"
            @select="handleCreateSelect"
          >
            <StratixButton variant="primary" size="sm" :icon="plus">
              创建英雄
            </StratixButton>
          </StratixDropdown>
          <StratixButton 
            variant="secondary" 
            size="sm"
            :icon="settings"
            @click="emit('open-character-creator')"
          >
            自定义
          </StratixButton>
        </div>
      </div>
    </div>
  </StratixModal>
</template>

<style scoped>
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid v-bind('getToken("colors.border.default")');
  margin-bottom: 12px;
}

.panel-header h3 {
  margin: 0;
  font-size: var(--ds-font-size-md);
  color: v-bind('getToken("colors.text.primary")');
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
}

.refresh-btn :deep(svg) {
  transition: transform 0.3s ease;
}

.refresh-btn.spinning :deep(svg) {
  animation: ds-spin 0.8s linear infinite;
}

@keyframes ds-spin {
  to { transform: rotate(360deg); }
}

.refresh-info {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--ds-bg-elevated) 3%, transparent);
  border-radius: var(--ds-radius-sm);
  font-size: var(--ds-font-size-xs);
}

.refresh-label {
  color: v-bind('getToken("colors.text.secondary")');
}

.refresh-time {
  color: v-bind('getToken("colors.text.muted")');
  font-family: var(--ds-font-mono);
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm);
}

.agent-card {
  display: flex;
  align-items: center;
  padding: 10px var(--ds-spacing-md);
  background: v-bind('getToken("colors.background.tertiary")');
  border-radius: var(--ds-radius-md);
  cursor: pointer;
  transition: all 0.3s var(--ds-animation-easing-ease-out);
  border: 1px solid transparent;
  transform-style: preserve-3d;
  perspective: 1000px;
}

.agent-card:hover {
  background: v-bind('getToken("colors.background.secondary")');
  transform: perspective(1000px) rotateX(1deg) rotateY(-1deg) translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1), 0 2px 6px rgba(0, 0, 0, 0.05);
  border-color: v-bind('getToken("colors.border.default")');
}

.agent-card.selected {
  border-color: var(--ds-brand-primary);
  background: var(--ds-bg-tertiary);
  box-shadow: 0 0 0 1px var(--ds-brand-primary), 0 4px 12px rgba(59, 130, 246, 0.1);
}

.agent-avatar {
  position: relative;
  width: 40px;
  height: 40px;
  margin-right: 12px;
  flex-shrink: 0;
}

.avatar-img {
  width: 100%;
  height: 100%;
  border-radius: var(--ds-radius-md);
  object-fit: cover;
  image-rendering: pixelated;
  transition: transform 0.2s ease;
}

.agent-card:hover .avatar-img {
  transform: scale(1.05);
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ds-radius-md);
  transition: transform 0.2s ease;
}

.agent-card:hover .avatar-placeholder {
  transform: scale(1.05);
}

.status-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: var(--ds-radius-full);
  border: 2px solid v-bind('getToken("colors.background.secondary")');
  transition: box-shadow 0.3s ease;
}

.status-dot.online {
  box-shadow: 0 0 4px var(--ds-status-success);
  animation: status-glow 2s infinite;
}

.status-dot.busy {
  box-shadow: 0 0 4px var(--ds-status-warning);
}

.status-dot.error {
  box-shadow: 0 0 4px var(--ds-status-danger);
  animation: status-glow 2s infinite;
}

@keyframes status-glow {
  0%, 100% { box-shadow: 0 0 4px currentColor; }
  50% { box-shadow: 0 0 8px currentColor, 0 0 4px currentColor; }
}

.agent-info {
  flex: 1;
  min-width: 0;
}

.agent-name {
  font-size: var(--ds-font-size-md);
  color: v-bind('getToken("colors.text.primary")');
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.agent-meta {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-xs);
  font-size: var(--ds-font-size-xs);
}

.agent-status {
  font-weight: 500;
}

.agent-divider {
  color: v-bind('getToken("colors.border.default")');
}

.agent-skills {
  color: v-bind('getToken("colors.text.muted")');
}

.delete-btn {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.agent-card:hover .delete-btn {
  opacity: 1;
}

.empty-state {
  text-align: center;
  padding: var(--ds-spacing-xl) var(--ds-spacing-lg);
  color: v-bind('getToken("colors.text.muted")');
  line-height: 1.8;
}

.empty-float {
  animation: empty-float 3s ease-in-out infinite;
}

@keyframes empty-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.empty-title {
  font-size: var(--ds-font-size-lg);
  color: v-bind('getToken("colors.text.secondary")');
  margin: var(--ds-spacing-md) 0 8px;
}

.empty-desc {
  font-size: var(--ds-font-size-sm);
  margin-bottom: 20px;
}

.empty-actions {
  display: flex;
  gap: var(--ds-spacing-sm);
  justify-content: center;
}

.type-indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: var(--ds-radius-full);
  margin-right: 8px;
}

/* Transition group */
.agent-card-enter-active,
.agent-card-leave-active {
  transition: all 0.3s ease;
}

.agent-card-enter-from,
.agent-card-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

.agent-card-move {
  transition: transform 0.3s ease;
}

/* Prefers reduced motion */
@media (prefers-reduced-motion: reduce) {
  .agent-card,
  .status-dot,
  .avatar-img,
  .avatar-placeholder,
  .empty-float {
    transition: none !important;
    animation: none !important;
    transform: none !important;
  }
}
</style>
