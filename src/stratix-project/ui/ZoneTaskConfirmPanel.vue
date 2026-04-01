<template>
  <div class="zone-task-confirm-panel">
    <!-- Stats Summary -->
    <div class="zone-task-confirm-panel__stats">
      <div class="zone-task-confirm-panel__stat zone-task-confirm-panel__stat--warning">
        <span class="zone-task-confirm-panel__stat-value">{{ stats.pendingTaskCount }}</span>
        <span class="zone-task-confirm-panel__stat-label">待确认</span>
      </div>
      <div class="zone-task-confirm-panel__stat zone-task-confirm-panel__stat--success">
        <span class="zone-task-confirm-panel__stat-value">{{ stats.completedTaskCount }}</span>
        <span class="zone-task-confirm-panel__stat-label">已确认</span>
      </div>
      <div class="zone-task-confirm-panel__stat zone-task-confirm-panel__stat--info">
        <span class="zone-task-confirm-panel__stat-value">{{ stats.activeTaskCount }}</span>
        <span class="zone-task-confirm-panel__stat-label">进行中</span>
      </div>
      <div class="zone-task-confirm-panel__stat zone-task-confirm-panel__stat--member">
        <span class="zone-task-confirm-panel__stat-value">{{ stats.memberCount }}</span>
        <span class="zone-task-confirm-panel__stat-label">成员</span>
      </div>
    </div>

    <!-- Requirement Input -->
    <div class="zone-task-confirm-panel__input">
      <input
        v-model="requirementInput"
        type="text"
        class="zone-task-confirm-panel__input-field"
        placeholder="输入需求描述，按回车提交..."
        @keydown.enter="submitRequirement"
      />
      <StratixButton
        size="sm"
        variant="primary"
        :loading="submitting"
        :disabled="!requirementInput.trim()"
        @click="submitRequirement"
      >
        提交
      </StratixButton>
    </div>

    <!-- Task List -->
    <div class="zone-task-confirm-panel__tasks">
      <div v-if="loading && tasks.length === 0" class="zone-task-confirm-panel__empty">
        加载中...
      </div>
      <div v-else-if="tasks.length === 0" class="zone-task-confirm-panel__empty">
        暂无待确认任务，提交需求获取任务分派建议
      </div>
      <template v-else>
        <div
          v-for="task in tasks"
          :key="task.id"
          class="zone-task-confirm-panel__task"
          :class="`zone-task-confirm-panel__task--${task.type}`"
        >
          <div class="zone-task-confirm-panel__task-header">
            <span class="zone-task-confirm-panel__task-type-icon">{{ getTypeIcon(task.type) }}</span>
            <span class="zone-task-confirm-panel__task-title">{{ task.title }}</span>
            <span class="zone-task-confirm-panel__task-priority" :class="`zone-task-confirm-panel__task-priority--${task.priority}`">
              {{ getPriorityLabel(task.priority) }}
            </span>
          </div>

          <div class="zone-task-confirm-panel__task-desc">
            {{ task.description || '暂无描述' }}
          </div>

          <div class="zone-task-confirm-panel__task-meta">
            <span class="zone-task-confirm-panel__task-type">{{ getTypeLabel(task.type) }}</span>
            <span class="zone-task-confirm-panel__task-agent">
              建议: {{ task.assigneeId ? task.assigneeId.slice(0, 8) : '未分配' }}
            </span>
          </div>

          <div class="zone-task-confirm-panel__task-actions">
            <StratixButton
              size="sm"
              variant="success"
              @click="confirmTask(task.id, task.assigneeId)"
            >
              确认分派
            </StratixButton>

            <div class="zone-task-confirm-panel__agent-select">
              <select v-model="selectedAgents[task.id]" class="zone-task-confirm-panel__select">
                <option value="">更换 Agent</option>
                <option v-for="agent in availableAgents" :key="agent" :value="agent">
                  {{ agent.slice(0, 8) }}
                </option>
              </select>
            </div>

            <StratixButton
              size="sm"
              variant="danger"
              @click="rejectTask(task.id)"
            >
              拒绝
            </StratixButton>
          </div>
        </div>
      </template>
    </div>

    <!-- Refresh Button -->
    <div class="zone-task-confirm-panel__footer">
      <StratixButton
        size="sm"
        variant="secondary"
        :loading="loading"
        @click="refresh"
      >
        刷新
      </StratixButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import type { TaskItem, TaskType, TaskPriority, ZoneStatusSummary } from '../../../../stratix-orchestration/zone/ZoneCoordinator';

interface Props {
  zoneId: string;
}

const props = defineProps<Props>();

const loading = ref(false);
const submitting = ref(false);
const tasks = ref<TaskItem[]>([]);
const requirementInput = ref('');
const selectedAgents = reactive<Record<string, string>>({});

// Stats from coordinator status
const stats = ref<ZoneStatusSummary>({
  zoneId: props.zoneId,
  memberCount: 0,
  activeTaskCount: 0,
  completedTaskCount: 0,
  pendingTaskCount: 0,
  recentActivity: []
});

// Available agents for selection
const availableAgents = ref<string[]>([]);

const typeIconMap: Record<TaskType, string> = {
  coding: '💻',
  writing: '📝',
  analysis: '🔍',
  research: '📚',
  general: '📌'
};

const typeLabelMap: Record<TaskType, string> = {
  coding: '编码',
  writing: '写作',
  analysis: '分析',
  research: '研究',
  general: '通用'
};

const priorityLabelMap: Record<TaskPriority, string> = {
  1: '紧急',
  2: '高',
  3: '中',
  4: '低',
  5: '最低'
};

function getTypeIcon(type: TaskType): string {
  return typeIconMap[type] ?? '📌';
}

function getTypeLabel(type: TaskType): string {
  return typeLabelMap[type] ?? type;
}

function getPriorityLabel(priority: TaskPriority): string {
  return priorityLabelMap[priority] ?? String(priority);
}

async function fetchCoordinatorStatus(): Promise<void> {
  try {
    const response = await fetch(`/api/zones/${props.zoneId}/coordinator/status`);
    const result = await response.json();
    if (result.success) {
      stats.value = {
        zoneId: result.zoneId,
        memberCount: result.memberCount,
        activeTaskCount: result.activeTaskCount,
        completedTaskCount: result.completedTaskCount,
        pendingTaskCount: result.pendingTaskCount,
        recentActivity: result.recentActivity || []
      };
      // Extract agents from recent activity
      const agents = new Set<string>();
      for (const event of result.recentActivity || []) {
        if (event.actorId) agents.add(event.actorId);
        if (event.targetId) agents.add(event.targetId);
      }
      availableAgents.value = Array.from(agents);
    }
  } catch (error) {
    console.error('[ZoneTaskConfirmPanel] Failed to fetch coordinator status:', error);
  }
}

async function submitRequirement(): Promise<void> {
  const requirement = requirementInput.value.trim();
  if (!requirement || submitting.value) return;

  submitting.value = true;
  try {
    const response = await fetch(`/api/zones/${props.zoneId}/requirements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirement })
    });
    const result = await response.json();
    if (result.success) {
      // Add new tasks from result
      const newTasks = (result.tasks || []).filter(
        (t: TaskItem) => !tasks.value.find(existing => existing.id === t.id)
      );
      tasks.value = [...newTasks, ...tasks.value];
      requirementInput.value = '';
      // Refresh stats
      await fetchCoordinatorStatus();
    } else {
      console.error('[ZoneTaskConfirmPanel] Submit requirement failed:', result.error);
    }
  } catch (error) {
    console.error('[ZoneTaskConfirmPanel] Failed to submit requirement:', error);
  } finally {
    submitting.value = false;
  }
}

async function confirmTask(taskId: string, assigneeId?: string): Promise<void> {
  const selectedAgent = selectedAgents[taskId];
  const targetAgentId = selectedAgent || assigneeId;
  if (!targetAgentId) return;

  try {
    const response = await fetch(`/api/zones/${props.zoneId}/tasks/${taskId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true, assigneeId: targetAgentId })
    });
    const result = await response.json();
    if (result.success) {
      // Remove confirmed task from list
      tasks.value = tasks.value.filter(t => t.id !== taskId);
      delete selectedAgents[taskId];
      await fetchCoordinatorStatus();
    } else {
      console.error('[ZoneTaskConfirmPanel] Confirm task failed:', result.error);
    }
  } catch (error) {
    console.error('[ZoneTaskConfirmPanel] Failed to confirm task:', error);
  }
}

async function rejectTask(taskId: string): Promise<void> {
  try {
    const response = await fetch(`/api/zones/${props.zoneId}/tasks/${taskId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const result = await response.json();
    if (result.success) {
      // Remove rejected task from list
      tasks.value = tasks.value.filter(t => t.id !== taskId);
      delete selectedAgents[taskId];
    } else {
      console.error('[ZoneTaskConfirmPanel] Reject task failed:', result.error);
    }
  } catch (error) {
    console.error('[ZoneTaskConfirmPanel] Failed to reject task:', error);
  }
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    await fetchCoordinatorStatus();
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  fetchCoordinatorStatus();
});
</script>

<style scoped>
.zone-task-confirm-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow: hidden;
}

/* Stats */
.zone-task-confirm-panel__stats {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

.zone-task-confirm-panel__stat {
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

.zone-task-confirm-panel__stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--ds-text-primary);
}

.zone-task-confirm-panel__stat--warning .zone-task-confirm-panel__stat-value {
  color: var(--ds-semantic-warning, #eab308);
}

.zone-task-confirm-panel__stat--success .zone-task-confirm-panel__stat-value {
  color: var(--ds-success);
}

.zone-task-confirm-panel__stat--info .zone-task-confirm-panel__stat-value {
  color: var(--ds-info);
}

.zone-task-confirm-panel__stat--member .zone-task-confirm-panel__stat-value {
  color: var(--ds-text-secondary);
}

.zone-task-confirm-panel__stat-label {
  font-size: 11px;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Input */
.zone-task-confirm-panel__input {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.zone-task-confirm-panel__input-field {
  flex: 1;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--ds-text-primary);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 6px;
  outline: none;
}

.zone-task-confirm-panel__input-field:focus {
  border-color: var(--ds-info);
}

.zone-task-confirm-panel__input-field::placeholder {
  color: var(--ds-text-muted);
}

/* Task List */
.zone-task-confirm-panel__tasks {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

.zone-task-confirm-panel__empty {
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

/* Task Card */
.zone-task-confirm-panel__task {
  padding: 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 8px;
  transition: border-color 0.15s ease;
}

.zone-task-confirm-panel__task:hover {
  border-color: var(--ds-border-strong);
}

.zone-task-confirm-panel__task-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.zone-task-confirm-panel__task-type-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.zone-task-confirm-panel__task-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--ds-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-task-confirm-panel__task-priority {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.zone-task-confirm-panel__task-priority--1 {
  background: rgba(239, 68, 68, 0.15);
  color: var(--ds-semantic-danger);
}

.zone-task-confirm-panel__task-priority--2 {
  background: rgba(249, 115, 22, 0.15);
  color: #f97316;
}

.zone-task-confirm-panel__task-priority--3 {
  background: rgba(234, 179, 8, 0.15);
  color: #eab308;
}

.zone-task-confirm-panel__task-priority--4 {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.zone-task-confirm-panel__task-priority--5 {
  background: rgba(156, 163, 175, 0.15);
  color: var(--ds-text-muted);
}

.zone-task-confirm-panel__task-desc {
  font-size: 12px;
  color: var(--ds-text-secondary);
  margin-bottom: 8px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.zone-task-confirm-panel__task-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--ds-text-muted);
  margin-bottom: 10px;
}

.zone-task-confirm-panel__task-type {
  padding: 2px 6px;
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border-default);
  border-radius: 4px;
}

.zone-task-confirm-panel__task-agent {
  color: var(--ds-info);
}

.zone-task-confirm-panel__task-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.zone-task-confirm-panel__agent-select {
  flex: 1;
}

.zone-task-confirm-panel__select {
  width: 100%;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--ds-text-primary);
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border-default);
  border-radius: 4px;
  outline: none;
}

.zone-task-confirm-panel__select:focus {
  border-color: var(--ds-info);
}

/* Footer */
.zone-task-confirm-panel__footer {
  display: flex;
  justify-content: center;
  padding: 8px;
  flex-shrink: 0;
}
</style>
