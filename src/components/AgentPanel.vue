<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { SvgIcon, StratixDropdown } from '@/components/ui';
import type { DropdownOption } from '@/components/ui';
import { useAgentStore } from '../stores/agent';
import { StratixPanel, StratixButton, StratixEmpty } from '@/components/ui';
import { getToken } from '@/design-system/config';

const agentStore = useAgentStore();

// 图标名称常量
const plus = 'plus';
const refresh = 'refresh';
const settings = 'settings';
const user = 'user';
const search = 'search';
const chevronLeft = 'chevron-left';
const chevronRight = 'chevron-right';

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

const agents = computed(() => agentStore.agents);
const storeRefreshing = computed(() => agentStore.isRefreshing);
const lastRefreshTime = computed(() => agentStore.lastRefreshTime);
const isRefreshing = computed(() => props.isRefreshing || storeRefreshing);

// Sidebar collapse state
const isCollapsed = ref(false);

// Search state
const searchQuery = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);

// Debounce search
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(searchQuery, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    // searchQuery is reactive, filteredAgents will recompute
  }, 150);
});

const filteredAgents = computed(() => {
  if (!searchQuery.value.trim()) return agents.value;
  const q = searchQuery.value.toLowerCase();
  return agents.value.filter(agent =>
    agent.name?.toLowerCase().includes(q) ||
    agent.type?.toLowerCase().includes(q) ||
    agent.agentId?.toLowerCase().includes(q)
  );
});

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

// Group agents by status
const groupedAgents = computed(() => {
  const groups: Record<string, typeof agents.value> = {
    online: [],
    busy: [],
    offline: [],
    error: [],
  };
  for (const agent of filteredAgents.value) {
    const status = getAgentStatus(agent);
    if (groups[status]) {
      groups[status].push(agent);
    } else {
      groups.offline.push(agent);
    }
  }
  return groups;
});

const groupLabels: Record<string, string> = {
  online: '在线',
  busy: '忙碌',
  offline: '离线',
  error: '错误',
};

const groupOrder = ['online', 'busy', 'error', 'offline'];

// Highlight matched text
function highlightText(text: string, query: string): string {
  if (!query.trim()) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<mark class="search-highlight">$1</mark>');
}

const panelStyle = computed(() => getToken('panel.default'));
</script>

<template>
  <div
    class="agent-panel-wrapper"
    :class="{ collapsed: isCollapsed }"
  >
    <!-- Collapse toggle -->
    <button
      class="collapse-toggle"
      :title="isCollapsed ? '展开' : '收起'"
      @click="isCollapsed = !isCollapsed"
    >
      <SvgIcon :name="isCollapsed ? chevronRight : chevronLeft" :size="14" />
    </button>

    <StratixPanel variant="default" class="agent-panel">
      <div class="panel-header">
        <h3 class="panel-title" :class="{ 'visually-hidden': isCollapsed }">英雄列表</h3>
        <div class="header-actions" :class="{ 'visually-hidden': isCollapsed }">
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
      
      <!-- Search -->
      <div class="search-box" :class="{ 'visually-hidden': isCollapsed }">
        <SvgIcon :name="search" :size="14" class="search-icon" />
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="搜索英雄..."
          autocomplete="off"
        />
        <kbd v-if="searchQuery" class="search-clear" @click="searchQuery = ''">✕</kbd>
      </div>

      <div class="refresh-info" v-if="lastRefreshTime && !isCollapsed">
        <span class="refresh-label">上次刷新:</span>
        <span class="refresh-time">{{ formatTime(lastRefreshTime) }}</span>
      </div>
      
      <div class="agent-list" :class="{ 'visually-hidden': isCollapsed }">
        <template v-for="groupKey in groupOrder" :key="groupKey">
          <div v-if="groupedAgents[groupKey].length > 0" class="agent-group">
            <div class="group-header">
              <span class="group-label">{{ groupLabels[groupKey] }}</span>
              <span class="group-count">{{ groupedAgents[groupKey].length }}</span>
            </div>
            <div class="group-divider"></div>
            
            <div 
              v-for="agent in groupedAgents[groupKey]" 
              :key="agent.agentId"
              class="agent-card"
              :class="{ selected: isSelected(agent.agentId) }"
              @click="emit('select', agent.agentId)"
            >
              <!-- Drag handle -->
              <div class="drag-handle" title="拖拽排序">
                <span></span><span></span><span></span>
                <span></span><span></span><span></span>
              </div>

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
                  <SvgIcon :name="user" :color="getHeroTypeColor(agent.type)" :size="16" />
                </div>
                <!-- Status glow dot -->
                <div 
                  class="status-glow"
                  :style="{ 
                    background: getStatusColor(getAgentStatus(agent)),
                    boxShadow: `0 0 6px ${getStatusColor(getAgentStatus(agent))}`
                  }"
                ></div>
              </div>
              
              <div class="agent-info">
                <div class="agent-name" v-html="highlightText(agent.name, searchQuery)"></div>
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
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </template>
        
        <!-- Empty state -->
        <StratixEmpty
          v-if="agents.length === 0"
          scenario="no-agents"
          action-label="创建 Agent"
          action-icon="plus"
          @action="emit('open-character-creator')"
        />

        <!-- No search results -->
        <div v-else-if="filteredAgents.length === 0" class="no-results">
          <SvgIcon :name="search" :size="32" :stroke-width="1" />
          <p>未找到匹配的英雄</p>
          <button class="clear-search" @click="searchQuery = ''">清除搜索</button>
        </div>
      </div>
    </StratixPanel>
  </div>
</template>

<style scoped>
.agent-panel-wrapper {
  position: relative;
  display: flex;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  width: 320px;
}

.agent-panel-wrapper.collapsed {
  width: 48px;
}

.collapse-toggle {
  position: absolute;
  right: -12px;
  top: 16px;
  z-index: 10;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-full);
  color: var(--ds-text-muted);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
  padding: 0;
}

.collapse-toggle:hover {
  background: var(--ds-bg-secondary);
  color: var(--ds-text-primary);
  border-color: var(--ds-color-primary);
}

.agent-panel {
  padding: v-bind('panelStyle.padding');
  background: v-bind('panelStyle.background');
  border: v-bind('panelStyle.border');
  border-radius: v-bind('panelStyle.borderRadius');
  width: 100%;
  overflow: hidden;
  transition: opacity 0.3s ease;
}

.agent-panel-wrapper.collapsed .agent-panel {
  opacity: 0.7;
}

.visually-hidden {
  opacity: 0;
  pointer-events: none;
  height: 0;
  overflow: hidden;
  margin: 0 !important;
  padding: 0 !important;
  transition: opacity 0.2s ease;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.panel-title {
  margin: 0;
  font-size: var(--ds-font-size-lg);
  font-weight: 600;
  color: var(--ds-text);
  transition: opacity 0.2s ease;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  gap: var(--ds-spacing-sm);
  transition: opacity 0.2s ease;
}

/* Search box */
.search-box {
  position: relative;
  margin-bottom: 12px;
  transition: opacity 0.2s ease;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ds-text-muted);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 8px 28px 8px 32px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  color: var(--ds-text);
  font-size: var(--ds-font-size-sm);
  outline: none;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
  box-sizing: border-box;
}

.search-input:focus {
  border-color: var(--ds-color-primary);
  box-shadow: 0 0 0 3px var(--ds-border-focus);
}

.search-input::placeholder {
  color: var(--ds-text-muted);
}

.search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  padding: 2px 4px;
  background: var(--ds-bg-secondary);
  border: none;
  border-radius: var(--ds-radius-sm);
  color: var(--ds-text-muted);
  font-size: 10px;
  cursor: pointer;
  line-height: 1;
}

.search-clear:hover {
  color: var(--ds-text-primary);
}

:deep(.search-highlight) {
  background: color-mix(in srgb, var(--ds-color-primary) 30%, transparent);
  color: var(--ds-text-primary);
  border-radius: 2px;
  padding: 0 1px;
}

.refresh-info {
  display: flex;
  gap: var(--ds-spacing-sm);
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-secondary);
  margin-bottom: 16px;
}

.refresh-label {
  font-weight: 500;
}

.refresh-time {
  font-family: var(--ds-font-mono);
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm);
  transition: opacity 0.2s ease;
}

/* Agent Group */
.agent-group {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-xs);
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  position: sticky;
  top: 0;
  background: v-bind('panelStyle.background');
  z-index: 2;
}

.group-label {
  font-size: var(--ds-font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--ds-text-muted);
}

.group-count {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  background: var(--ds-bg-tertiary);
  padding: 1px 6px;
  border-radius: var(--ds-radius-full);
}

.group-divider {
  height: 1px;
  background: var(--ds-border);
  opacity: 0.5;
  margin-bottom: 2px;
}

.agent-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  background: var(--ds-bg-tertiary);
  border: 1px solid transparent;
  border-left: 3px solid transparent;
  border-radius: var(--ds-radius-md);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
  position: relative;
}

.agent-card:hover {
  background: var(--ds-bg-hover, var(--ds-bg-secondary));
  transform: scale(1.02);
  border-color: var(--ds-border);
}

.agent-card.selected {
  border-left: 3px solid var(--ds-color-primary);
  background: color-mix(in srgb, var(--ds-color-primary) 8%, transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--ds-color-primary) 15%, transparent);
}

/* Drag handle (6 dots) */
.drag-handle {
  display: grid;
  grid-template-columns: repeat(2, 3px);
  grid-template-rows: repeat(3, 3px);
  gap: 1px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s ease;
  cursor: grab;
}

.drag-handle span {
  width: 3px;
  height: 3px;
  background: var(--ds-text-muted);
  border-radius: 50%;
}

.agent-card:hover .drag-handle {
  opacity: 0.4;
}

.drag-handle:active {
  cursor: grabbing;
}

.agent-avatar {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: var(--ds-radius-md);
  overflow: hidden;
  background: var(--ds-bg-secondary);
  position: relative;
  border: 2px solid var(--ds-border);
  transition: border-color 0.15s ease;
}

.agent-card:hover .agent-avatar {
  border-color: var(--ds-color-primary);
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

.status-glow {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: var(--ds-radius-full);
  border: 2px solid var(--ds-bg-primary);
}

.agent-info {
  flex: 1;
  min-width: 0;
}

.agent-name {
  font-size: var(--ds-font-size-sm);
  font-weight: 500;
  color: var(--ds-text);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-meta {
  display: flex;
  gap: var(--ds-spacing-sm);
  font-size: var(--ds-font-size-xs);
}

.agent-type,
.agent-status {
  font-weight: 500;
}

.agent-actions {
  display: flex;
  gap: var(--ds-spacing-xs);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.agent-card:hover .agent-actions {
  opacity: 1;
}

.action-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-sm);
  color: var(--ds-text-secondary);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
  padding: 0;
}

.action-btn:hover {
  background: var(--ds-danger);
  border-color: var(--ds-danger);
  color: white;
}

.no-results {
  text-align: center;
  padding: var(--ds-spacing-xl) var(--ds-spacing-md);
  color: var(--ds-text-muted);
}

.no-results p {
  margin: var(--ds-spacing-sm) 0;
  font-size: var(--ds-font-size-sm);
}

.clear-search {
  padding: 4px 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  color: var(--ds-text-secondary);
  font-size: var(--ds-font-size-sm);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
}

.clear-search:hover {
  background: var(--ds-bg-secondary);
  color: var(--ds-text-primary);
  border-color: var(--ds-color-primary);
}

@media (prefers-reduced-motion: reduce) {
  .agent-panel-wrapper,
  .agent-card,
  .agent-panel,
  .visually-hidden,
  .panel-title,
  .header-actions,
  .agent-list,
  .search-box {
    transition: none !important;
  }

  .agent-card:hover {
    transform: none;
  }
}
</style>
