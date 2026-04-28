<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { StratixModal, StratixButton, SvgIcon } from '@/components/ui';
import { getToken } from '@/design-system/config';

const x = 'x';
const user = 'user';

const props = defineProps<{
  visible: boolean;
  selectedAgents: any[];
  agentCount: number;
  isGameReady: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:visible', value: boolean): void;
}>();

const handleClose = () => {
  emit('update:visible', false);
};

const getHeroTypeColor = (type: string) => {
  const colors: Record<string, string> = {
    writer: 'var(--ds-status-success)',
    dev: 'var(--ds-status-info)',
    analyst: 'var(--ds-status-warning)',
    custom: 'var(--ds-accent)'
  };
  return colors[type] || getToken('colors.text.muted');
};

// Animated stats
const animatedStats = ref({ agentCount: 0, custom: 0, selected: 0 });
let animationFrameId: number | null = null;

const animateStats = () => {
  const customCount = props.selectedAgents.filter(a => a.type === 'custom').length;
  const start = { ...animatedStats.value };
  const end = {
    agentCount: props.agentCount,
    custom: customCount,
    selected: props.selectedAgents.length
  };
  const duration = 600;
  const startTime = performance.now();

  const step = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);

    animatedStats.value = {
      agentCount: Math.round(start.agentCount + (end.agentCount - start.agentCount) * easeOut),
      custom: Math.round(start.custom + (end.custom - start.custom) * easeOut),
      selected: Math.round(start.selected + (end.selected - start.selected) * easeOut),
    };

    if (progress < 1) {
      animationFrameId = requestAnimationFrame(step);
    }
  };

  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animationFrameId = requestAnimationFrame(step);
};

watch(() => [props.agentCount, props.selectedAgents.length], animateStats, { immediate: true });
</script>

<template>
  <StratixModal
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    title="状态面板"
    size="md"
    @close="handleClose"
  >
    <div class="status-section">
      <h4>选中英雄</h4>
      <div v-if="selectedAgents.length > 0" class="selected-info">
        <TransitionGroup name="agent-list">
          <div v-for="agent in selectedAgents" :key="agent.agentId" class="agent-item">
            <div class="agent-item-left">
              <img 
                v-if="agent.profile?.thumbnail" 
                :src="agent.profile.thumbnail" 
                class="agent-thumb"
              />
              <div 
                v-else 
                class="agent-icon-placeholder"
                :style="{ background: getHeroTypeColor(agent.type) + '20' }"
              >
                <SvgIcon :name="user" :color="getHeroTypeColor(agent.type)" :size="14" />
              </div>
              <span class="agent-name">{{ agent.name }}</span>
            </div>
            <span class="agent-type" :style="{ color: getHeroTypeColor(agent.type) }">
              {{ agent.type === 'custom' ? '自定义' : agent.type }}
            </span>
          </div>
        </TransitionGroup>
      </div>
      <div v-else class="empty-state">未选中</div>
    </div>
    
    <div class="status-section">
      <h4>英雄统计</h4>
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-value">{{ animatedStats.agentCount }}</span>
          <span class="stat-label">总数</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ animatedStats.custom }}</span>
          <span class="stat-label">自定义</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ animatedStats.selected }}</span>
          <span class="stat-label">已选中</span>
        </div>
      </div>
    </div>
    
    <div class="status-section">
      <h4>系统状态</h4>
      <div class="system-status">
        <div class="status-item">
          <span class="label">RTS 引擎</span>
          <span class="value" :class="{ ok: isGameReady }">
            <span class="status-indicator" :class="{ ok: isGameReady }"></span>
            {{ isGameReady ? '运行中' : '加载中' }}
          </span>
        </div>
        <div class="status-item">
          <span class="label">事件总线</span>
          <span class="value ok">
            <span class="status-indicator ok"></span>
            已连接
          </span>
        </div>
        <div class="status-item">
          <span class="label">数据存储</span>
          <span class="value ok">
            <span class="status-indicator ok"></span>
            本地模式
          </span>
        </div>
      </div>
    </div>
  </StratixModal>
</template>

<style scoped>
.status-section {
  margin-bottom: 24px;
}

.status-section:last-child {
  margin-bottom: 0;
}

.status-section h4 {
  margin: 0 0 12px 0;
  font-size: var(--ds-font-size-sm);
  color: v-bind('getToken("colors.text.muted")');
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.selected-info {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm);
}

.agent-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px var(--ds-spacing-md);
  background: v-bind('getToken("colors.background.tertiary")');
  border-radius: var(--ds-radius-md);
  transition: all 0.2s ease;
}

.agent-item:hover {
  transform: translateX(4px);
  box-shadow: var(--ds-shadow-sm);
}

.agent-item-left {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
}

.agent-thumb {
  width: 32px;
  height: 32px;
  border-radius: var(--ds-radius-sm);
  object-fit: cover;
  image-rendering: pixelated;
  transition: transform 0.2s ease;
}

.agent-item:hover .agent-thumb {
  transform: scale(1.1);
}

.agent-icon-placeholder {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ds-radius-sm);
  transition: transform 0.2s ease;
}

.agent-item:hover .agent-icon-placeholder {
  transform: scale(1.1);
}

.agent-name {
  color: v-bind('getToken("colors.text.primary")');
  font-size: var(--ds-font-size-md);
}

.agent-type {
  font-size: var(--ds-font-size-xs);
  font-weight: 500;
  padding: 2px var(--ds-spacing-xs);
  background: color-mix(in srgb, var(--ds-bg-elevated) 10%, transparent);
  border-radius: var(--ds-radius-sm);
}

.empty-state {
  text-align: center;
  padding: 30px 20px;
  color: v-bind('getToken("colors.text.muted")');
  font-size: var(--ds-font-size-md);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 12px;
  background: color-mix(in srgb, var(--ds-bg-elevated) 3%, transparent);
  border-radius: var(--ds-radius-md);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.3s ease;
}

.stat-item:hover {
  transform: translateY(-2px);
  box-shadow: var(--ds-shadow-sm);
}

.stat-value {
  font-size: var(--ds-font-size-2xl);
  font-weight: 600;
  color: v-bind('getToken("colors.info")');
  margin-bottom: 4px;
  transition: all 0.3s ease;
}

.stat-label {
  font-size: var(--ds-font-size-xs);
  color: v-bind('getToken("colors.text.muted")');
}

.system-status {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm);
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px var(--ds-spacing-md);
  background: color-mix(in srgb, var(--ds-bg-elevated) 3%, transparent);
  border-radius: var(--ds-radius-md);
  transition: all 0.2s ease;
}

.status-item:hover {
  transform: translateX(4px);
}

.status-item .label {
  color: v-bind('getToken("colors.text.muted")');
  font-size: var(--ds-font-size-sm);
}

.status-item .value {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--ds-font-size-sm);
  font-weight: 500;
  color: v-bind('getToken("colors.semantic.danger")');
}

.status-item .value.ok {
  color: v-bind('getToken("colors.semantic.success")');
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: var(--ds-radius-full);
  background: v-bind('getToken("colors.semantic.danger")');
  transition: all 0.3s ease;
}

.status-indicator.ok {
  background: v-bind('getToken("colors.semantic.success")');
  box-shadow: 0 0 6px v-bind('getToken("colors.semantic.success")');
  animation: status-pulse 2s infinite;
}

@keyframes status-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(0.85); }
}

/* Transition group */
.agent-list-enter-active,
.agent-list-leave-active {
  transition: all 0.3s ease;
}

.agent-list-enter-from,
.agent-list-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

.agent-list-move {
  transition: transform 0.3s ease;
}

/* Prefers reduced motion */
@media (prefers-reduced-motion: reduce) {
  .stat-value,
  .stat-item,
  .agent-item,
  .status-item,
  .status-indicator,
  .agent-thumb,
  .agent-icon-placeholder {
    transition: none !important;
    animation: none !important;
    transform: none !important;
  }
}
</style>
