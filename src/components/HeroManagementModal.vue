<script setup lang="ts">
import { computed } from 'vue';
import { agentStore } from '../stores/agentStore';
import { StratixModal, StratixButton, SvgIcon } from '@/components/ui';
import { getToken } from '@/design-system/config';

const x = 'x';
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

const agents = computed(() => agentStore.agents.value);
const storeRefreshing = computed(() => agentStore.isRefreshing.value);
const lastRefreshTime = computed(() => agentStore.lastRefreshTime.value);

const heroTypes = [
  { type: 'writer' as const, name: '文案英雄', color: '#00ff88' },
  { type: 'dev' as const, name: '开发英雄', color: '#00d4ff' },
  { type: 'analyst' as const, name: '数据英雄', color: '#ff6b9d' }
];

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
    online: '#00ff88',
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

const handleClose = () => {
  emit('update:visible', false);
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
        
        <el-dropdown @command="emit('create', $event)" trigger="click">
          <StratixButton variant="primary" size="sm" :icon="plus">
            新建
          </StratixButton>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item 
                v-for="hero in heroTypes" 
                :key="hero.type"
                :command="hero.type"
              >
                <span class="type-indicator" :style="{ background: hero.color }"></span>
                {{ hero.name }}
              </el-dropdown-item>
              <el-dropdown-item divided @click="emit('open-character-creator')">
                <span class="type-indicator" :style="{ background: getToken('colors.accent') }"></span>
                自定义角色
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
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
        />
      </div>
      
      <div v-if="agents.length === 0" class="empty-state">
        <SvgIcon :name="user" :color="getToken('colors.accent')" :size="48" :stroke-width="1.5" />
        <div class="empty-title">还没有英雄</div>
        <div class="empty-desc">点击上方按钮创建你的第一个英雄</div>
        <div class="empty-actions">
          <el-dropdown @command="emit('create', $event)" trigger="click">
            <StratixButton variant="primary" size="sm" :icon="plus">
              创建英雄
            </StratixButton>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item 
                  v-for="hero in heroTypes" 
                  :key="hero.type"
                  :command="hero.type"
                >
                  <span class="type-indicator" :style="{ background: hero.color }"></span>
                  {{ hero.name }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
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
  font-size: 14px;
  color: v-bind('getToken("colors.text.primary")');
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.refresh-info {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
  font-size: 11px;
}

.refresh-label {
  color: v-bind('getToken("colors.text.secondary")');
}

.refresh-time {
  color: v-bind('getToken("colors.text.muted")');
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
  padding: 10px 12px;
  background: v-bind('getToken("colors.background.tertiary")');
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.agent-card:hover {
  background: v-bind('getToken("colors.background.secondary")');
}

.agent-card.selected {
  border-color: v-bind('getToken("colors.accent")');
  background: rgba(0, 212, 255, 0.1);
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
  border-radius: 8px;
  object-fit: cover;
  image-rendering: pixelated;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
}

.status-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid v-bind('getToken("colors.background.secondary")');
  box-shadow: 0 0 4px currentColor;
}

.agent-info {
  flex: 1;
  min-width: 0;
}

.agent-name {
  font-size: 14px;
  color: v-bind('getToken("colors.text.primary")');
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.agent-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
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

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: v-bind('getToken("colors.text.muted")');
  line-height: 1.8;
}

.empty-title {
  font-size: 16px;
  color: v-bind('getToken("colors.text.secondary")');
  margin: 16px 0 8px;
}

.empty-desc {
  font-size: 13px;
  margin-bottom: 20px;
}

.empty-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.type-indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 8px;
}
</style>
