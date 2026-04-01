<template>
  <div class="zone-audit-panel">
    <!-- Stats Summary -->
    <div class="zone-audit-panel__stats">
      <div class="zone-audit-panel__stat">
        <span class="zone-audit-panel__stat-value">{{ stats.total }}</span>
        <span class="zone-audit-panel__stat-label">总事件</span>
      </div>
      <div class="zone-audit-panel__stat zone-audit-panel__stat--success">
        <span class="zone-audit-panel__stat-value">{{ stats.taskCompleted }}</span>
        <span class="zone-audit-panel__stat-label">已完成</span>
      </div>
      <div class="zone-audit-panel__stat zone-audit-panel__stat--danger">
        <span class="zone-audit-panel__stat-value">{{ stats.taskFailed }}</span>
        <span class="zone-audit-panel__stat-label">失败</span>
      </div>
      <div class="zone-audit-panel__stat zone-audit-panel__stat--info">
        <span class="zone-audit-panel__stat-value">{{ stats.activeMembers }}</span>
        <span class="zone-audit-panel__stat-label">活跃成员</span>
      </div>
    </div>

    <!-- Filters -->
    <div class="zone-audit-panel__filters">
      <div class="zone-audit-panel__filter-group">
        <label class="zone-audit-panel__filter-label">事件类型</label>
        <div class="zone-audit-panel__filter-checkboxes">
          <label
            v-for="et in eventTypeOptions"
            :key="et.value"
            class="zone-audit-panel__filter-checkbox"
          >
            <input
              v-model="selectedEventTypes"
              type="checkbox"
              :value="et.value"
            />
            <span class="zone-audit-panel__filter-icon" :style="{ color: et.color }">{{ et.icon }}</span>
            <span>{{ et.label }}</span>
          </label>
        </div>
      </div>
      <div class="zone-audit-panel__filter-group">
        <label class="zone-audit-panel__filter-label">Agent</label>
        <select v-model="selectedAgentId" class="zone-audit-panel__filter-select">
          <option value="">全部</option>
          <option v-for="agent in agentList" :key="agent" :value="agent">
            {{ agent.slice(0, 8) }}
          </option>
        </select>
      </div>
      <div class="zone-audit-panel__filter-group">
        <label class="zone-audit-panel__filter-label">时间范围</label>
        <div class="zone-audit-panel__filter-dates">
          <input
            v-model="startDate"
            type="date"
            class="zone-audit-panel__filter-date"
          />
          <span>至</span>
          <input
            v-model="endDate"
            type="date"
            class="zone-audit-panel__filter-date"
          />
        </div>
      </div>
      <StratixButton size="sm" variant="secondary" @click="resetFilters">
        重置
      </StratixButton>
    </div>

    <!-- Timeline -->
    <div class="zone-audit-panel__timeline">
      <div v-if="loading && events.length === 0" class="zone-audit-panel__empty">
        加载中...
      </div>
      <div v-else-if="events.length === 0" class="zone-audit-panel__empty">
        暂无审计记录
      </div>
      <template v-else>
        <div
          v-for="event in events"
          :key="event.id"
          class="zone-audit-panel__event"
          :class="`zone-audit-panel__event--${event.eventType}`"
        >
          <div class="zone-audit-panel__event-icon" :style="{ color: getEventColor(event.eventType) }">
            {{ getEventIcon(event.eventType) }}
          </div>
          <div class="zone-audit-panel__event-content">
            <div class="zone-audit-panel__event-header">
              <span class="zone-audit-panel__event-time">{{ formatTime(event.createdAt) }}</span>
              <span class="zone-audit-panel__event-actor">
                {{ formatActor(event) }}
              </span>
              <span class="zone-audit-panel__event-action">
                {{ getEventLabel(event.eventType) }}
              </span>
              <span v-if="event.targetId" class="zone-audit-panel__event-target">
                → {{ formatTarget(event) }}
              </span>
            </div>
            <div v-if="event.metadata && Object.keys(event.metadata).length > 0" class="zone-audit-panel__event-meta">
              <button
                class="zone-audit-panel__event-expand"
                @click="toggleExpand(event.id)"
              >
                {{ expandedEvents.has(event.id) ? '收起' : '展开' }}详情
              </button>
              <div
                v-if="expandedEvents.has(event.id)"
                class="zone-audit-panel__event-meta-content"
              >
                <pre>{{ JSON.stringify(event.metadata, null, 2) }}</pre>
              </div>
            </div>
          </div>
          <div class="zone-audit-panel__event-badge" :style="{ color: getEventColor(event.eventType) }">
            {{ getEventTypeShort(event.eventType) }}
          </div>
        </div>
      </template>
    </div>

    <!-- Load More -->
    <div v-if="hasMore" class="zone-audit-panel__load-more">
      <StratixButton
        size="sm"
        variant="secondary"
        :loading="loading"
        @click="loadMore"
      >
        加载更多
      </StratixButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import type { AuditEventType, AuditLogRecord } from '../../../../stratix-database/AuditLogRepository';

interface Props {
  zoneId: string;
}

const props = defineProps<Props>();

const loading = ref(false);
const events = ref<AuditLogRecord[]>([]);
const hasMore = ref(false);
const offset = ref(0);
const limit = 20;

// Filters
const selectedEventTypes = ref<AuditEventType[]>([]);
const selectedAgentId = ref('');
const startDate = ref('');
const endDate = ref('');

// Stats
const stats = ref({
  total: 0,
  taskCompleted: 0,
  taskFailed: 0,
  activeMembers: 0
});

// Expanded events
const expandedEvents = ref(new Set<string>());

// Agent list from events
const agentList = computed(() => {
  const agents = new Set<string>();
  for (const e of events.value) {
    if (e.actorId) agents.add(e.actorId);
  }
  return Array.from(agents);
});

// Event type options
const eventTypeOptions: Array<{ value: AuditEventType; label: string; icon: string; color: string }> = [
  { value: 'agent_entered', label: '进入', icon: '👤', color: '#9ca3af' },
  { value: 'agent_left', label: '离开', icon: '👤', color: '#9ca3af' },
  { value: 'task_created', label: '创建', icon: '➕', color: '#3b82f6' },
  { value: 'task_assigned', label: '分派', icon: '➡️', color: '#eab308' },
  { value: 'task_claimed', label: '认领', icon: '🤝', color: '#3b82f6' },
  { value: 'task_started', label: '开始', icon: '●', color: '#f97316' },
  { value: 'task_completed', label: '完成', icon: '✓', color: '#22c55e' },
  { value: 'task_failed', label: '失败', icon: '✗', color: '#ef4444' },
  { value: 'message_sent', label: '消息', icon: '💬', color: '#a855f7' },
  { value: 'skill_executed', label: 'Skill', icon: '⚡', color: '#06b6d4' },
  { value: 'context_shared', label: '共享', icon: '📎', color: '#9ca3af' },
];

const eventColorMap: Record<AuditEventType, string> = {
  agent_entered: '#9ca3af',
  agent_left: '#9ca3af',
  task_created: '#3b82f6',
  task_assigned: '#eab308',
  task_claimed: '#3b82f6',
  task_started: '#f97316',
  task_completed: '#22c55e',
  task_failed: '#ef4444',
  message_sent: '#a855f7',
  skill_executed: '#06b6d4',
  context_shared: '#9ca3af',
};

const eventIconMap: Record<AuditEventType, string> = {
  agent_entered: '👤',
  agent_left: '👤',
  task_created: '➕',
  task_assigned: '➡️',
  task_claimed: '🤝',
  task_started: '●',
  task_completed: '✓',
  task_failed: '✗',
  message_sent: '💬',
  skill_executed: '⚡',
  context_shared: '📎',
};

const eventLabelMap: Record<AuditEventType, string> = {
  agent_entered: '进入了 Zone',
  agent_left: '离开了 Zone',
  task_created: '创建了任务',
  task_assigned: '分派了任务',
  task_claimed: '认领了任务',
  task_started: '开始了任务',
  task_completed: '完成了任务',
  task_failed: '任务失败',
  message_sent: '发送了消息',
  skill_executed: '执行了 skill',
  context_shared: '共享了上下文',
};

const eventTypeShortMap: Record<AuditEventType, string> = {
  agent_entered: 'entered',
  agent_left: 'left',
  task_created: 'created',
  task_assigned: 'delegated',
  task_claimed: 'claimed',
  task_started: 'started',
  task_completed: 'completed',
  task_failed: 'failed',
  message_sent: 'message',
  skill_executed: 'skill',
  context_shared: 'shared',
};

function getEventIcon(type: AuditEventType): string {
  return eventIconMap[type] ?? '📌';
}

function getEventColor(type: AuditEventType): string {
  return eventColorMap[type] ?? '#9ca3af';
}

function getEventLabel(type: AuditEventType): string {
  return eventLabelMap[type] ?? type;
}

function getEventTypeShort(type: AuditEventType): string {
  return eventTypeShortMap[type] ?? type;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatActor(event: AuditLogRecord): string {
  if (!event.actorId) return 'System';
  return event.actorId.slice(0, 8);
}

function formatTarget(event: AuditLogRecord): string {
  if (!event.targetId) return '';
  return event.targetId.slice(0, 8);
}

function toggleExpand(eventId: string): void {
  if (expandedEvents.value.has(eventId)) {
    expandedEvents.value.delete(eventId);
  } else {
    expandedEvents.value.add(eventId);
  }
  expandedEvents.value = new Set(expandedEvents.value);
}

async function fetchStats(): Promise<void> {
  try {
    const response = await fetch(`/api/zones/${props.zoneId}/audit/stats`);
    const result = await response.json();
    if (result.success) {
      const data = result.data as Record<AuditEventType, number>;
      stats.value = {
        total: Object.values(data).reduce((sum, v) => sum + v, 0),
        taskCompleted: data.task_completed ?? 0,
        taskFailed: data.task_failed ?? 0,
        activeMembers: (data.agent_entered ?? 0) - (data.agent_left ?? 0),
      };
    }
  } catch (error) {
    console.error('[ZoneAuditPanel] Failed to fetch stats:', error);
  }
}

async function fetchEvents(append = false): Promise<void> {
  if (loading.value) return;
  loading.value = true;

  try {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(append ? offset.value : 0));

    if (selectedEventTypes.value.length > 0) {
      params.set('eventTypes', selectedEventTypes.value.join(','));
    }
    if (selectedAgentId.value) {
      params.set('actorId', selectedAgentId.value);
    }
    if (startDate.value) {
      params.set('startTime', String(new Date(startDate.value).getTime()));
    }
    if (endDate.value) {
      const end = new Date(endDate.value);
      end.setHours(23, 59, 59, 999);
      params.set('endTime', String(end.getTime()));
    }

    const response = await fetch(`/api/zones/${props.zoneId}/audit?${params.toString()}`);
    const result = await response.json();

    if (result.success) {
      const { events: newEvents, hasMore: more } = result.data;
      if (append) {
        events.value = [...events.value, ...newEvents];
      } else {
        events.value = newEvents;
        expandedEvents.value = new Set();
      }
      hasMore.value = more;
      offset.value = append ? offset.value + newEvents.length : newEvents.length;
    }
  } catch (error) {
    console.error('[ZoneAuditPanel] Failed to fetch events:', error);
  } finally {
    loading.value = false;
  }
}

function loadMore(): void {
  fetchEvents(true);
}

function resetFilters(): void {
  selectedEventTypes.value = [];
  selectedAgentId.value = '';
  startDate.value = '';
  endDate.value = '';
  offset.value = 0;
  fetchEvents(false);
  fetchStats();
}

// Watch filter changes
watch([selectedEventTypes, selectedAgentId, startDate, endDate], () => {
  offset.value = 0;
  fetchEvents(false);
}, { deep: true });

onMounted(() => {
  fetchEvents();
  fetchStats();
});
</script>

<style scoped>
.zone-audit-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow: hidden;
}

/* Stats */
.zone-audit-panel__stats {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

.zone-audit-panel__stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 8px;
}

.zone-audit-panel__stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--ds-text-primary);
}

.zone-audit-panel__stat--success .zone-audit-panel__stat-value {
  color: var(--ds-success);
}

.zone-audit-panel__stat--danger .zone-audit-panel__stat-value {
  color: var(--ds-semantic-danger);
}

.zone-audit-panel__stat--info .zone-audit-panel__stat-value {
  color: var(--ds-info);
}

.zone-audit-panel__stat-label {
  font-size: 11px;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Filters */
.zone-audit-panel__filters {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 8px;
  flex-shrink: 0;
}

.zone-audit-panel__filter-group {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.zone-audit-panel__filter-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  min-width: 60px;
  padding-top: 4px;
}

.zone-audit-panel__filter-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.zone-audit-panel__filter-checkbox {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--ds-text-secondary);
  cursor: pointer;
  user-select: none;
}

.zone-audit-panel__filter-checkbox input {
  accent-color: var(--ds-info);
}

.zone-audit-panel__filter-icon {
  font-size: 12px;
}

.zone-audit-panel__filter-select {
  padding: 4px 8px;
  font-size: 12px;
  color: var(--ds-text-primary);
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border-default);
  border-radius: 4px;
  outline: none;
}

.zone-audit-panel__filter-select:focus {
  border-color: var(--ds-info);
}

.zone-audit-panel__filter-dates {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ds-text-secondary);
}

.zone-audit-panel__filter-date {
  padding: 4px 8px;
  font-size: 12px;
  color: var(--ds-text-primary);
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border-default);
  border-radius: 4px;
  outline: none;
}

.zone-audit-panel__filter-date:focus {
  border-color: var(--ds-info);
}

/* Timeline */
.zone-audit-panel__timeline {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 4px;
}

.zone-audit-panel__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100px;
  font-size: 13px;
  color: var(--ds-text-muted);
  background: var(--ds-bg-tertiary);
  border: 1px dashed var(--ds-border-default);
  border-radius: 8px;
}

.zone-audit-panel__event {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 8px;
  transition: border-color 0.15s ease;
}

.zone-audit-panel__event:hover {
  border-color: var(--ds-border-strong);
}

.zone-audit-panel__event-icon {
  font-size: 16px;
  flex-shrink: 0;
  width: 24px;
  text-align: center;
}

.zone-audit-panel__event-content {
  flex: 1;
  min-width: 0;
}

.zone-audit-panel__event-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 13px;
}

.zone-audit-panel__event-time {
  color: var(--ds-text-muted);
  font-size: 11px;
}

.zone-audit-panel__event-actor {
  color: var(--ds-text-primary);
  font-weight: 500;
}

.zone-audit-panel__event-action {
  color: var(--ds-text-secondary);
}

.zone-audit-panel__event-target {
  color: var(--ds-text-muted);
}

.zone-audit-panel__event-meta {
  margin-top: 6px;
}

.zone-audit-panel__event-expand {
  font-size: 11px;
  color: var(--ds-info);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.zone-audit-panel__event-expand:hover {
  text-decoration: underline;
}

.zone-audit-panel__event-meta-content {
  margin-top: 6px;
  padding: 8px;
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border-default);
  border-radius: 4px;
  overflow-x: auto;
}

.zone-audit-panel__event-meta-content pre {
  margin: 0;
  font-size: 11px;
  color: var(--ds-text-secondary);
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.zone-audit-panel__event-badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
  padding-top: 2px;
}

/* Load More */
.zone-audit-panel__load-more {
  display: flex;
  justify-content: center;
  padding: 8px;
  flex-shrink: 0;
}
</style>
