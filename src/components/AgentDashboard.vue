<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { StratixModal, StratixButton, SvgIcon } from '@/components/ui';
import { getToken } from '@/design-system/config';
import { useAgentStore } from '@/stores/agent';

const agentStore = useAgentStore();
import { rtsBridge } from '@/stratix-rts';

interface AgentDashboardItem {
  agentId: string;
  name: string;
  status: 'idle' | 'working' | 'error' | 'offline';
  currentTask?: string;
  cpuUsage?: number;
  memoryUsage?: number;
  runtime: number; // seconds
  startedAt?: number;
  zoneName?: string;
}

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:visible', value: boolean): void;
}>();

const refreshInterval = ref<ReturnType<typeof setInterval> | null>(null);
const isRefreshing = ref(false);
const refreshComplete = ref(false);

// Animated stats
const animatedStats = ref({ total: 0, idle: 0, working: 0, error: 0, offline: 0 });
const statsTarget = ref({ total: 0, idle: 0, working: 0, error: 0, offline: 0 });
let animationFrameId: number | null = null;

// Simulated runtime data
const agentRuntimeData = ref<Map<string, { startedAt: number; task?: string }>>(new Map());

const handleClose = () => {
  emit('update:visible', false);
};

const mapAgentStatus = (agent: any): AgentDashboardItem['status'] => {
  if (agent.configStatus === 'draft') return 'offline';
  if (agent.configStatus === 'ready') {
    const runtimeData = agentRuntimeData.value.get(agent.agentId);
    if (runtimeData && runtimeData.task) return 'working';
    return 'idle';
  }
  return 'offline';
};

const dashboardAgents = computed<AgentDashboardItem[]>(() => {
  return (agentStore.agents ?? [])?.map(agent => {
    const runtimeData = agentRuntimeData.value.get(agent.agentId);
    const runtime = runtimeData
      ? Math.floor((Date.now() - runtimeData.startedAt) / 1000)
      : 0;

    return {
      agentId: agent.agentId,
      name: agent.name || 'Unnamed Agent',
      status: mapAgentStatus(agent),
      currentTask: runtimeData?.task,
      runtime,
      zoneName: agent.currentZoneName,
    };
  }) ?? [];
});

const stats = computed(() => {
  const agents = dashboardAgents.value;
  return {
    total: agents.length,
    idle: agents.filter(a => a.status === 'idle').length,
    working: agents.filter(a => a.status === 'working').length,
    error: agents.filter(a => a.status === 'error').length,
    offline: agents.filter(a => a.status === 'offline').length,
  };
});

// Animate stats when they change
const animateStats = () => {
  const start = { ...animatedStats.value };
  const end = { ...stats.value };
  const duration = 600;
  const startTime = performance.now();
  
  const step = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    
    animatedStats.value = {
      total: Math.round(start.total + (end.total - start.total) * easeOut),
      idle: Math.round(start.idle + (end.idle - start.idle) * easeOut),
      working: Math.round(start.working + (end.working - start.working) * easeOut),
      error: Math.round(start.error + (end.error - start.error) * easeOut),
      offline: Math.round(start.offline + (end.offline - start.offline) * easeOut),
    };
    
    if (progress < 1) {
      animationFrameId = requestAnimationFrame(step);
    }
  };
  
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animationFrameId = requestAnimationFrame(step);
};

watch(stats, animateStats, { immediate: true });

const statusConfig = {
  idle: {
    color: 'var(--ds-status-success)',
    bgColor: 'rgba(0, 255, 136, 0.1)',
    label: '空闲',
    icon: 'circle',
  },
  working: {
    color: 'var(--ds-status-info)',
    bgColor: 'rgba(0, 212, 255, 0.1)',
    label: '工作中',
    icon: 'loader',
  },
  error: {
    color: 'var(--ds-status-danger)',
    bgColor: 'rgba(255, 68, 68, 0.1)',
    label: '错误',
    icon: 'alert-circle',
  },
  offline: {
    color: 'var(--ds-text-muted)',
    bgColor: 'rgba(160, 160, 176, 0.1)',
    label: '离线',
    icon: 'circle',
  },
};

const formatRuntime = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

const navigateToAgent = (agentId: string) => {
  rtsBridge.focusAgent(agentId);
};

const handleRefresh = () => {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  refreshComplete.value = false;
  
  // Simulate refresh
  setTimeout(() => {
    agentRuntimeData.value = new Map(agentRuntimeData.value);
    isRefreshing.value = false;
    refreshComplete.value = true;
    setTimeout(() => { refreshComplete.value = false; }, 2000);
  }, 1000);
};

onMounted(() => {
  refreshInterval.value = setInterval(() => {
    agentRuntimeData.value = new Map(agentRuntimeData.value);
  }, 1000);
});

onUnmounted(() => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value);
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
});

const updateAgentRuntime = (agentId: string, startedAt: number, task?: string) => {
  agentRuntimeData.value.set(agentId, { startedAt, task });
};

defineExpose({ updateAgentRuntime });
</script>

<template>
  <StratixModal
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    title="Agent 状态监控"
    size="lg"
    @close="handleClose"
  >
    <!-- Refresh button -->
    <div class="refresh-bar">
      <button 
        class="refresh-btn"
        :class="{ spinning: isRefreshing, complete: refreshComplete }"
        @click="handleRefresh"
        title="刷新"
      >
        <svg v-if="!refreshComplete" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span v-if="refreshComplete" class="checkmark">完成</span>
      </button>
    </div>

    <!-- Stats Bar -->
    <div class="stats-bar">
      <div class="stat-item stat-total">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <div class="stat-content">
          <span class="stat-value">{{ animatedStats.total }}</span>
          <span class="stat-label">总计</span>
        </div>
      </div>

      <div class="stat-item stat-working">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <div class="stat-content">
          <span class="stat-value">{{ animatedStats.working }}</span>
          <span class="stat-label">工作中</span>
        </div>
      </div>

      <div class="stat-item stat-idle">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
          <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
        <div class="stat-content">
          <span class="stat-value">{{ animatedStats.idle }}</span>
          <span class="stat-label">空闲</span>
        </div>
      </div>

      <div class="stat-item stat-error">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div class="stat-content">
          <span class="stat-value">{{ animatedStats.error }}</span>
          <span class="stat-label">错误</span>
        </div>
      </div>

      <div class="stat-item stat-offline">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
        <div class="stat-content">
          <span class="stat-value">{{ animatedStats.offline }}</span>
          <span class="stat-label">离线</span>
        </div>
      </div>
    </div>

    <!-- Agent List -->
    <div class="agent-list">
      <TransitionGroup name="agent-card">
        <div
          v-for="agent in dashboardAgents"
          :key="agent.agentId"
          class="agent-card"
          :class="`status-${agent.status}`"
          @click="navigateToAgent(agent.agentId)"
        >
          <div class="agent-card-header">
            <div class="agent-avatar" :style="{ background: statusConfig[agent.status].color }">
              {{ agent.name.slice(0, 2).toUpperCase() }}
            </div>
            <div class="agent-info">
              <span class="agent-name">{{ agent.name }}</span>
              <span class="agent-id">{{ agent.agentId.slice(0, 8) }}...</span>
            </div>
            <div
              class="agent-status-badge"
              :style="{
                background: statusConfig[agent.status].bgColor,
                color: statusConfig[agent.status].color,
              }"
            >
              <span class="status-dot" :style="{ background: statusConfig[agent.status].color }"></span>
              {{ statusConfig[agent.status].label }}
            </div>
          </div>

          <div class="agent-card-body">
            <div v-if="agent.currentTask" class="agent-task">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              <span>{{ agent.currentTask }}</span>
            </div>
            <div v-else class="agent-task idle-task">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
              <span>等待任务...</span>
            </div>

            <div class="agent-metrics">
              <div class="metric">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>{{ formatRuntime(agent.runtime) }}</span>
              </div>

              <div v-if="agent.zoneName" class="metric">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                </svg>
                <span>{{ agent.zoneName }}</span>
              </div>
            </div>
          </div>

          <div class="agent-card-footer">
            <span class="navigate-hint">点击定位</span>
          </div>
        </div>
      </TransitionGroup>

      <!-- Empty State -->
      <div v-if="dashboardAgents.length === 0" class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="19" y1="8" x2="19" y2="14" />
          <line x1="22" y1="11" x2="16" y2="11" />
        </svg>
        <span>暂无 Agent</span>
      </div>
    </div>
  </StratixModal>
</template>

<style scoped>
.refresh-bar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  color: var(--ds-text-secondary);
  cursor: pointer;
  font-size: var(--ds-font-size-sm);
  transition: all 0.2s ease;
}

.refresh-btn:hover {
  background: var(--ds-bg-secondary);
  border-color: var(--ds-brand-primary);
  color: var(--ds-brand-primary);
}

.refresh-btn.spinning svg {
  animation: ds-spin 1s linear infinite;
}

.refresh-btn.complete {
  color: var(--ds-status-success);
  border-color: var(--ds-status-success);
}

.refresh-btn.complete svg {
  animation: check-bounce 0.5s ease;
}

@keyframes ds-spin {
  to { transform: rotate(360deg); }
}

@keyframes check-bounce {
  0% { transform: scale(0); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); }
}

.checkmark {
  font-size: var(--ds-font-size-xs);
  font-weight: 500;
}

.stats-bar {
  display: flex;
  gap: 12px;
  padding: var(--ds-spacing-md);
  background: var(--ds-bg-tertiary);
  border-radius: var(--ds-radius-md);
  margin-bottom: 16px;
}

.stat-item {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--ds-bg-secondary);
  border-radius: var(--ds-radius-md);
  border: 1px solid var(--ds-border);
  cursor: default;
  transition: all var(--ds-animation-duration-fast) ease;
}

.stat-item:hover {
  border-color: var(--ds-color-primary);
  transform: translateY(-2px);
  box-shadow: var(--ds-shadow-sm);
}

.stat-item svg {
  flex-shrink: 0;
}

.stat-total svg {
  color: var(--ds-text-secondary);
}

.stat-working svg {
  color: var(--ds-status-info);
}

.stat-idle svg {
  color: var(--ds-status-success);
}

.stat-error svg {
  color: var(--ds-status-danger);
}

.stat-offline svg {
  color: var(--ds-text-muted);
}

.stat-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-value {
  font-size: var(--ds-font-size-2xl);
  font-weight: 600;
  color: var(--ds-text-primary);
  line-height: 1;
  transition: color 0.3s ease;
}

.stat-label {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 400px;
  overflow-y: auto;
  padding-right: 4px;
}

.agent-list::-webkit-scrollbar {
  width: 6px;
}

.agent-list::-webkit-scrollbar-track {
  background: var(--ds-bg-tertiary);
  border-radius: var(--ds-radius-sm);
}

.agent-list::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: var(--ds-radius-sm);
}

.agent-list::-webkit-scrollbar-thumb:hover {
  background: var(--ds-text-muted);
}

.agent-card {
  padding: 14px 16px;
  background: var(--ds-bg-tertiary);
  border-radius: var(--ds-radius-md);
  border: 1px solid var(--ds-border);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
}

.agent-card:hover {
  border-color: var(--ds-color-primary);
  transform: translateX(4px);
  box-shadow: var(--ds-shadow-sm);
}

.agent-card.status-working {
  border-left: 3px solid var(--ds-status-info);
}

.agent-card.status-idle {
  border-left: 3px solid var(--ds-status-success);
}

.agent-card.status-error {
  border-left: 3px solid var(--ds-status-danger);
}

.agent-card.status-offline {
  border-left: 3px solid var(--ds-text-muted);
  opacity: 0.7;
}

.agent-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.agent-avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--ds-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--ds-font-size-sm);
  font-weight: 600;
  color: var(--ds-bg-primary);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.agent-card:hover .agent-avatar {
  transform: scale(1.1);
}

.agent-info {
  flex: 1;
  min-width: 0;
}

.agent-name {
  display: block;
  font-weight: 500;
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-md);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-id {
  display: block;
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  font-family: var(--ds-font-mono);
}

.agent-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--ds-radius-lg);
  font-size: var(--ds-font-size-sm);
  font-weight: 500;
  flex-shrink: 0;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--ds-radius-full);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(0.8); }
}

.agent-card-body {
  padding-left: 48px;
}

.agent-task {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-secondary);
  margin-bottom: 8px;
}

.agent-task svg {
  flex-shrink: 0;
  color: var(--ds-status-success);
}

.idle-task svg {
  color: var(--ds-text-muted);
}

.idle-task span {
  color: var(--ds-text-muted);
  font-style: italic;
}

.agent-metrics {
  display: flex;
  gap: var(--ds-spacing-md);
}

.metric {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-xs);
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-muted);
}

.metric svg {
  flex-shrink: 0;
}

.agent-card-footer {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--ds-border);
  text-align: right;
}

.navigate-hint {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.agent-card:hover .navigate-hint {
  opacity: 1;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  color: var(--ds-text-muted);
  gap: 12px;
}

.empty-state svg {
  opacity: 0.5;
}

.empty-state span {
  font-size: var(--ds-font-size-md);
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
  .refresh-btn svg,
  .status-dot,
  .stat-value,
  .agent-card,
  .agent-avatar {
    transition: none !important;
    animation: none !important;
    transform: none !important;
  }
}
</style>
