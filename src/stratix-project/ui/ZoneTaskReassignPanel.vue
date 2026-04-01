<template>
  <div class="zone-task-reassign-panel">
    <!-- Stats Summary -->
    <div class="zone-task-reassign-panel__stats">
      <div class="zone-task-reassign-panel__stat zone-task-reassign-panel__stat--info">
        <span class="zone-task-reassign-panel__stat-value">{{ stats.activeTaskCount }}</span>
        <span class="zone-task-reassign-panel__stat-label">进行中</span>
      </div>
      <div class="zone-task-reassign-panel__stat zone-task-reassign-panel__stat--success">
        <span class="zone-task-reassign-panel__stat-value">{{ stats.completedTaskCount }}</span>
        <span class="zone-task-reassign-panel__stat-label">已完成</span>
      </div>
      <div class="zone-task-reassign-panel__stat zone-task-reassign-panel__stat--member">
        <span class="zone-task-reassign-panel__stat-value">{{ stats.memberCount }}</span>
        <span class="zone-task-reassign-panel__stat-label">成员</span>
      </div>
    </div>

    <!-- Task List -->
    <div class="zone-task-reassign-panel__tasks">
      <div v-if="loading && tasks.length === 0" class="zone-task-reassign-panel__empty">
        加载中...
      </div>
      <div v-else-if="tasks.length === 0" class="zone-task-reassign-panel__empty">
        暂无进行中的任务
      </div>
      <template v-else>
        <div
          v-for="task in tasks"
          :key="task.id"
          class="zone-task-reassign-panel__task"
          :class="`zone-task-reassign-panel__task--${task.status}`"
        >
          <div class="zone-task-reassign-panel__task-header">
            <span class="zone-task-reassign-panel__task-type-icon">{{ getTypeIcon(task.type) }}</span>
            <span class="zone-task-reassign-panel__task-title">{{ task.title }}</span>
            <span class="zone-task-reassign-panel__task-status" :class="`zone-task-reassign-panel__task-status--${task.status}`">
              {{ getStatusLabel(task.status) }}
            </span>
          </div>

          <div class="zone-task-reassign-panel__task-desc">
            {{ task.description || '暂无描述' }}
          </div>

          <div class="zone-task-reassign-panel__task-meta">
            <span class="zone-task-reassign-panel__task-type">{{ getTypeLabel(task.type) }}</span>
            <span class="zone-task-reassign-panel__task-agent">
              当前: {{ task.assigneeId ? task.assigneeId.slice(0, 8) : '未分配' }}
            </span>
          </div>

          <div class="zone-task-reassign-panel__task-actions">
            <StratixButton
              size="sm"
              variant="warning"
              :disabled="!task.assigneeId"
              @click="openReassignModal(task)"
            >
              重新分配
            </StratixButton>
          </div>
        </div>
      </template>
    </div>

    <!-- Reassign Modal -->
    <div v-if="showModal" class="zone-task-reassign-panel__modal-overlay" @click.self="closeModal">
      <div class="zone-task-reassign-panel__modal">
        <div class="zone-task-reassign-panel__modal-header">
          <span class="zone-task-reassign-panel__modal-title">重新分配任务</span>
          <button class="zone-task-reassign-panel__modal-close" @click="closeModal">×</button>
        </div>

        <div class="zone-task-reassign-panel__modal-body">
          <div class="zone-task-reassign-panel__modal-task-info">
            <span class="zone-task-reassign-panel__modal-task-title">{{ selectedTask?.title }}</span>
            <span class="zone-task-reassign-panel__modal-task-current">
              当前: {{ selectedTask?.assigneeId ? selectedTask.assigneeId.slice(0, 8) : '未分配' }}
            </span>
          </div>

          <div class="zone-task-reassign-panel__modal-field">
            <label class="zone-task-reassign-panel__modal-label">选择新 Agent</label>
            <select v-model="selectedNewAgentId" class="zone-task-reassign-panel__select">
              <option value="">请选择 Agent</option>
              <option
                v-for="agent in availableAgents"
                :key="agent.agentId"
                :value="agent.agentId"
                :disabled="agent.agentId === selectedTask?.assigneeId"
              >
                {{ agent.agentId.slice(0, 8) }}{{ agent.agentId === selectedTask?.assigneeId ? ' (当前)' : '' }}
              </option>
            </select>
          </div>
        </div>

        <div class="zone-task-reassign-panel__modal-footer">
          <StratixButton
            size="sm"
            variant="secondary"
            @click="closeModal"
          >
            取消
          </StratixButton>
          <StratixButton
            size="sm"
            variant="primary"
            :loading="reassigning"
            :disabled="!selectedNewAgentId"
            @click="confirmReassign"
          >
            确认分配
          </StratixButton>
        </div>
      </div>
    </div>

    <!-- Refresh Button -->
    <div class="zone-task-reassign-panel__footer">
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
import { ref, onMounted } from 'vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import type { TaskItem, TaskType, TaskStatus, ZoneStatusSummary } from '../../../../stratix-orchestration/zone/ZoneCoordinator';

interface Props {
  zoneId: string;
}

const props = defineProps<Props>();

const loading = ref(false);
const reassigning = ref(false);
const tasks = ref<TaskItem[]>([]);

// Stats from coordinator status
const stats = ref<ZoneStatusSummary>({
  zoneId: props.zoneId,
  memberCount: 0,
  activeTaskCount: 0,
  completedTaskCount: 0,
  pendingTaskCount: 0,
  recentActivity: []
});

// Available agents for selection (from zone members)
const availableAgents = ref<Array<{ agentId: string; role?: string }>>([]);

// Modal state
const showModal = ref(false);
const selectedTask = ref<TaskItem | null>(null);
const selectedNewAgentId = ref('');

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

const statusLabelMap: Record<TaskStatus, string> = {
  pending: '待分派',
  delegated: '已分派',
  in_progress: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
};

function getTypeIcon(type: TaskType): string {
  return typeIconMap[type] ?? '📌';
}

function getTypeLabel(type: TaskType): string {
  return typeLabelMap[type] ?? type;
}

function getStatusLabel(status: TaskStatus): string {
  return statusLabelMap[status] ?? status;
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
    }
  } catch (error) {
    console.error('[ZoneTaskReassignPanel] Failed to fetch coordinator status:', error);
  }
}

async function fetchActiveTasks(): Promise<void> {
  try {
    // Fetch tasks from coordinator status - we filter for active/in_progress tasks
    const response = await fetch(`/api/zones/${props.zoneId}/coordinator/status`);
    const result = await response.json();
    if (result.success) {
      // Extract active tasks from recentActivity to show assigned tasks
      // In a full implementation, there would be a separate endpoint for active tasks
      const agentTasks = new Map<string, TaskItem>();
      for (const event of result.recentActivity || []) {
        if (event.eventType === 'task_assigned' && event.targetId) {
          // Try to build task info from events
          agentTasks.set(event.targetId, {
            id: event.targetId,
            title: `Task ${event.targetId.slice(0, 8)}`,
            description: '',
            type: 'general',
            priority: 3,
            assigneeId: event.targetId,
            status: 'in_progress',
            zoneId: props.zoneId
          });
        }
      }
      tasks.value = Array.from(agentTasks.values());
    }
  } catch (error) {
    console.error('[ZoneTaskReassignPanel] Failed to fetch active tasks:', error);
  }
}

async function fetchZoneMembers(): Promise<void> {
  try {
    const response = await fetch(`/api/zones/${props.zoneId}/members`);
    const result = await response.json();
    if (result.success && result.members) {
      availableAgents.value = result.members.map((m: { agentId: string; role?: string }) => ({
        agentId: m.agentId,
        role: m.role
      }));
    }
  } catch (error) {
    console.error('[ZoneTaskReassignPanel] Failed to fetch zone members:', error);
  }
}

function openReassignModal(task: TaskItem): void {
  selectedTask.value = task;
  selectedNewAgentId.value = '';
  showModal.value = true;
}

function closeModal(): void {
  showModal.value = false;
  selectedTask.value = null;
  selectedNewAgentId.value = '';
}

async function confirmReassign(): Promise<void> {
  if (!selectedTask.value || !selectedNewAgentId.value) return;

  reassigning.value = true;
  try {
    const response = await fetch(`/api/zones/${props.zoneId}/tasks/${selectedTask.value.id}/reassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newAgentId: selectedNewAgentId.value })
    });
    const result = await response.json();
    if (result.success) {
      closeModal();
      await refresh();
    } else {
      console.error('[ZoneTaskReassignPanel] Reassign failed:', result.error);
    }
  } catch (error) {
    console.error('[ZoneTaskReassignPanel] Failed to reassign task:', error);
  } finally {
    reassigning.value = false;
  }
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    await Promise.all([
      fetchCoordinatorStatus(),
      fetchActiveTasks(),
      fetchZoneMembers()
    ]);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  refresh();
});
</script>

<style scoped>
.zone-task-reassign-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow: hidden;
}

/* Stats */
.zone-task-reassign-panel__stats {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

.zone-task-reassign-panel__stat {
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

.zone-task-reassign-panel__stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--ds-text-primary);
}

.zone-task-reassign-panel__stat--success .zone-task-reassign-panel__stat-value {
  color: var(--ds-success);
}

.zone-task-reassign-panel__stat--info .zone-task-reassign-panel__stat-value {
  color: var(--ds-info);
}

.zone-task-reassign-panel__stat--member .zone-task-reassign-panel__stat-value {
  color: var(--ds-text-secondary);
}

.zone-task-reassign-panel__stat-label {
  font-size: 11px;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Task List */
.zone-task-reassign-panel__tasks {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

.zone-task-reassign-panel__empty {
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
.zone-task-reassign-panel__task {
  padding: 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 8px;
  transition: border-color 0.15s ease;
}

.zone-task-reassign-panel__task:hover {
  border-color: var(--ds-border-strong);
}

.zone-task-reassign-panel__task-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.zone-task-reassign-panel__task-type-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.zone-task-reassign-panel__task-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--ds-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-task-reassign-panel__task-status {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.zone-task-reassign-panel__task-status--delegated {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.zone-task-reassign-panel__task-status--in_progress {
  background: rgba(168, 85, 247, 0.15);
  color: #a855f7;
}

.zone-task-reassign-panel__task-status--completed {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.zone-task-reassign-panel__task-status--failed {
  background: rgba(239, 68, 68, 0.15);
  color: var(--ds-semantic-danger);
}

.zone-task-reassign-panel__task-desc {
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

.zone-task-reassign-panel__task-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--ds-text-muted);
  margin-bottom: 10px;
}

.zone-task-reassign-panel__task-type {
  padding: 2px 6px;
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border-default);
  border-radius: 4px;
}

.zone-task-reassign-panel__task-agent {
  color: var(--ds-info);
}

.zone-task-reassign-panel__task-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Modal */
.zone-task-reassign-panel__modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.zone-task-reassign-panel__modal {
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border-default);
  border-radius: 12px;
  width: 400px;
  max-width: 90vw;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
}

.zone-task-reassign-panel__modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--ds-border-default);
}

.zone-task-reassign-panel__modal-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--ds-text-primary);
}

.zone-task-reassign-panel__modal-close {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--ds-text-muted);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.zone-task-reassign-panel__modal-close:hover {
  color: var(--ds-text-primary);
}

.zone-task-reassign-panel__modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.zone-task-reassign-panel__modal-task-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  background: var(--ds-bg-tertiary);
  border-radius: 8px;
}

.zone-task-reassign-panel__modal-task-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ds-text-primary);
}

.zone-task-reassign-panel__modal-task-current {
  font-size: 12px;
  color: var(--ds-text-muted);
}

.zone-task-reassign-panel__modal-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.zone-task-reassign-panel__modal-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--ds-text-secondary);
}

.zone-task-reassign-panel__select {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--ds-text-primary);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 6px;
  outline: none;
}

.zone-task-reassign-panel__select:focus {
  border-color: var(--ds-info);
}

.zone-task-reassign-panel__modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid var(--ds-border-default);
}

/* Footer */
.zone-task-reassign-panel__footer {
  display: flex;
  justify-content: center;
  padding: 8px;
  flex-shrink: 0;
}
</style>
