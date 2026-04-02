<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { StratixModal, StratixButton, SvgIcon } from '@/components/ui';
import { getToken } from '@/design-system/config';
import { agentStore } from '@/stores/agentStore';
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

// Simulated runtime data (in real implementation, this would come from agent metrics)
const agentRuntimeData = ref<Map<string, { startedAt: number; task?: string }>>(new Map());

const handleClose = () => {
  emit('update:visible', false);
};

// Map agent config status to dashboard status
const mapAgentStatus = (agent: any): AgentDashboardItem['status'] => {
  // Use configStatus as primary indicator
  if (agent.configStatus === 'draft') return 'offline';
  if (agent.configStatus === 'ready') {
    // Check if agent has actual activity - in a real implementation,
    // this would come from a WebSocket or polling mechanism
    const runtimeData = agentRuntimeData.value.get(agent.agentId);
    if (runtimeData && runtimeData.task) return 'working';
    return 'idle';
  }
  return 'offline';
};

// Convert agents from store to dashboard items
const dashboardAgents = computed<AgentDashboardItem[]>(() => {
  return agentStore.agents.value.map(agent => {
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
  });
});

// Stats
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

// Status display config
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

// Format runtime display
const formatRuntime = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

// Navigate to agent in RTS
const navigateToAgent = (agentId: string) => {
  rtsBridge.focusAgent(agentId);
};

// Start periodic refresh
onMounted(() => {
  refreshInterval.value = setInterval(() => {
    // Force reactivity update for runtime display
    agentRuntimeData.value = new Map(agentRuntimeData.value);
  }, 1000);
});

onUnmounted(() => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value);
  }
});

// Expose method to update agent runtime data (called from external sources)
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
          <span class="stat-value">{{ stats.total }}</span>
          <span class="stat-label">总计</span>
        </div>
      </div>

      <div class="stat-item stat-working">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <div class="stat-content">
          <span class="stat-value">{{ stats.working }}</span>
          <span class="stat-label">工作中</span>
        </div>
      </div>

      <div class="stat-item stat-idle">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
          <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
        <div class="stat-content">
          <span class="stat-value">{{ stats.idle }}</span>
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
          <span class="stat-value">{{ stats.error }}</span>
          <span class="stat-label">错误</span>
        </div>
      </div>

      <div class="stat-item stat-offline">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
        <div class="stat-content">
          <span class="stat-value">{{ stats.offline }}</span>
          <span class="stat-label">离线</span>
        </div>
      </div>
    </div>

    <!-- Agent List -->
    <div class="agent-list">
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
.stats-bar {
  display: flex;
  gap: 12px;
  padding: 16px;
  background: var(--ds-bg-tertiary);
  border-radius: 8px;
  margin-bottom: 16px;
}

.stat-item {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--ds-bg-secondary);
  border-radius: 6px;
  border: 1px solid var(--ds-border);
  cursor: default;
  transition: all 0.2s ease;
}

.stat-item:hover {
  border-color: var(--ds-color-primary);
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
  font-size: 20px;
  font-weight: 600;
  color: var(--ds-text-primary);
  line-height: 1;
}

.stat-label {
  font-size: 11px;
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
  border-radius: 3px;
}

.agent-list::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: 3px;
}

.agent-list::-webkit-scrollbar-thumb:hover {
  background: var(--ds-text-muted);
}

.agent-card {
  padding: 14px 16px;
  background: var(--ds-bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--ds-border);
  cursor: pointer;
  transition: all 0.15s ease;
}

.agent-card:hover {
  border-color: var(--ds-color-primary);
  transform: translateX(2px);
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
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--ds-bg-primary);
  flex-shrink: 0;
}

.agent-info {
  flex: 1;
  min-width: 0;
}

.agent-name {
  display: block;
  font-weight: 500;
  color: var(--ds-text-primary);
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-id {
  display: block;
  font-size: 11px;
  color: var(--ds-text-muted);
  font-family: monospace;
}

.agent-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.agent-card-body {
  padding-left: 48px;
}

.agent-task {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
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
  gap: 16px;
}

.metric {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
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
  font-size: 11px;
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
  font-size: 14px;
}
</style>
