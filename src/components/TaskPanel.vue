<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { StratixModal, StratixButton, StratixLoading, StratixEmpty, SvgIcon } from '@/components/ui';
import type { LraTask } from '../stratix-lra-bridge/types';
import { LRAClient } from '../stratix-lra-bridge/LRAClient';
import { LRAWatcher } from '../stratix-lra-bridge/LRAWatcher';

const ChatPanel = defineAsyncComponent(() => import('./ChatPanel.vue'));
const TaskLogViewer = defineAsyncComponent(() => import('./TaskLogViewer.vue'));

const props = defineProps<{
  visible: boolean;
  projectId: string | null;
  projectPath: string | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:visible', value: boolean): void;
}>();

type TabType = 'tasks' | 'chat' | 'logs';
const activeTab = ref<TabType>('tasks');

const lraClient = ref<LRAClient | null>(null);
const lraWatcher = ref<LRAWatcher | null>(null);
const tasks = ref<LraTask[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const selectedTaskId = ref<string | null>(null);
const previousCompletedCount = ref(0);
const completedPulse = ref(false);

const projectName = computed(() => {
  if (!tasks.value || tasks.value.length === 0) return '';
  return tasks.value[0].task_file.split('/')[2] || 'Unknown Project';
});

const taskStats = computed(() => {
  const stats = {
    total: tasks.value.length,
    pending: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
    paused: 0
  };

  tasks.value.forEach(task => {
    stats[task.status]++;
  });

  return stats;
});

// Watch for completion to trigger pulse
watch(() => taskStats.value.completed, (newVal, oldVal) => {
  if (newVal > oldVal) {
    completedPulse.value = true;
    setTimeout(() => { completedPulse.value = false; }, 2000);
  }
});

const sortedTasks = computed(() => {
  return [...tasks.value].sort((a, b) => {
    const statusOrder = { in_progress: 0, pending: 1, paused: 2, failed: 3, completed: 4 };
    const orderA = statusOrder[a.status] ?? 5;
    const orderB = statusOrder[b.status] ?? 5;
    
    if (orderA !== orderB) return orderA - orderB;
    
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const pA = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 3;
    const pB = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 3;
    
    return pA - pB;
  });
});

const loadTasks = async () => {
  if (!props.projectPath) return;

  loading.value = true;
  error.value = null;

  try {
    if (!lraClient.value) {
      lraClient.value = new LRAClient(props.projectPath);
    }

    const taskList = await lraClient.value.listTasks();
    tasks.value = taskList?.tasks || [];
    previousCompletedCount.value = taskStats.value.completed;
  } catch (err: any) {
    console.error('[TaskPanel] Failed to load tasks:', err);
    error.value = err.message || 'Failed to load tasks';
  } finally {
    loading.value = false;
  }
};

const setupWatcher = () => {
  if (!props.projectPath) return;

  lraWatcher.value = new LRAWatcher(props.projectPath, {
    interval: 3000,
    onTaskListChanged: (newTaskList) => {
      tasks.value = newTaskList?.tasks || [];
    }
  });

  lraWatcher.value.start();
};

const teardownWatcher = () => {
  if (lraWatcher.value) {
    lraWatcher.value.stop();
    lraWatcher.value = null;
  }
};

const handleClose = () => {
  emit('update:visible', false);
};

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    pending: 'var(--ds-text-muted)',
    in_progress: 'var(--ds-brand-primary)',
    completed: 'var(--ds-status-success)',
    failed: 'var(--ds-status-danger)',
    paused: 'var(--ds-status-warning)'
  };
  return colors[status] || 'var(--ds-text-muted)';
};

const getStatusIcon = (status: string) => {
  const icons: Record<string, string> = {
    pending: 'clock',
    in_progress: 'zap',
    completed: 'check',
    failed: 'error',
    paused: 'stop'
  };
  return icons[status] || 'info';
};

const getPriorityColor = (priority: string) => {
  const colors: Record<string, string> = {
    high: 'var(--ds-status-danger)',
    medium: 'var(--ds-status-warning)',
    low: 'var(--ds-brand-secondary)'
  };
  return colors[priority] || 'var(--ds-text-muted)';
};

const formatTime = (dateStr: string) => {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
};

watch(() => props.visible, (visible) => {
  if (visible && props.projectPath) {
    loadTasks();
    setupWatcher();
  } else {
    teardownWatcher();
  }
});

watch(() => props.projectPath, (newPath) => {
  if (props.visible && newPath) {
    loadTasks();
    teardownWatcher();
    setupWatcher();
  }
});

onMounted(() => {
  if (props.visible && props.projectPath) {
    loadTasks();
    setupWatcher();
  }
});

onUnmounted(() => {
  teardownWatcher();
});
</script>

<template>
  <StratixModal
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    title="项目面板"
    size="xl"
    @close="handleClose"
  >
    <div class="task-panel">
      <div class="panel-tabs">
        <div class="tab-indicator" :style="{ left: activeTab === 'tasks' ? '0%' : activeTab === 'chat' ? '33.33%' : '66.66%' }"></div>
        <button
          class="tab-button"
          :class="{ active: activeTab === 'tasks' }"
          @click="activeTab = 'tasks'"
        >
          任务
        </button>
        <button
          class="tab-button"
          :class="{ active: activeTab === 'chat' }"
          @click="activeTab = 'chat'"
        >
          聊天
        </button>
        <button
          class="tab-button"
          :class="{ active: activeTab === 'logs' }"
          @click="activeTab = 'logs'"
        >
          日志
        </button>
      </div>

      <div v-if="activeTab === 'tasks'" class="tab-content">
        <div class="panel-header">
          <div class="project-info" v-if="projectName">
            <h3>{{ projectName }}</h3>
            <span class="project-path">{{ projectPath }}</span>
          </div>
          
          <div class="task-stats">
            <div class="stat-item">
              <span class="stat-label">总计</span>
              <span class="stat-value">{{ taskStats.total }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">进行中</span>
              <span class="stat-value in-progress">{{ taskStats.in_progress }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">已完成</span>
              <span class="stat-value completed" :class="{ pulse: completedPulse }">{{ taskStats.completed }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">失败</span>
              <span class="stat-value failed">{{ taskStats.failed }}</span>
            </div>
          </div>
        </div>

        <div class="panel-body">
          <StratixLoading v-if="loading" mode="skeleton" :skeleton-lines="5" />

          <div v-else-if="error" class="error">
            <div class="error-icon">⚠️</div>
            <div class="error-message">{{ error }}</div>
            <StratixButton @click="loadTasks">重试</StratixButton>
          </div>

          <StratixEmpty
            v-else-if="tasks.length === 0"
            scenario="no-tasks"
            title="暂无任务"
            description="使用 LRA 创建任务"
          >
            <template #action>
              <StratixButton variant="primary" @click="loadTasks">
                刷新
              </StratixButton>
            </template>
          </StratixEmpty>

          <TransitionGroup v-else name="task-list" tag="div" class="task-list">
            <div
              v-for="task in sortedTasks"
              :key="task.id"
              class="task-item"
              :class="{ selected: selectedTaskId === task.id }"
              @click="selectedTaskId = task.id"
            >
              <div class="task-header">
                <SvgIcon :name="getStatusIcon(task.status)" class="status-icon" />
                <span class="task-id">{{ task.id }}</span>
                <span
                  class="priority-badge"
                  :style="{ backgroundColor: getPriorityColor(task.priority) }"
                >
                  {{ task.priority }}
                </span>
              </div>

              <div class="task-description">{{ task.description }}</div>

              <div class="task-meta">
                <div class="meta-item">
                  <span class="meta-label">模板:</span>
                  <span class="meta-value">{{ task.template }}</span>
                </div>
                <div class="meta-item" v-if="task.lock_info">
                  <span class="meta-label">执行者:</span>
                  <span class="meta-value">{{ task.lock_info.session_id }}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">更新:</span>
                  <span class="meta-value">{{ formatTime(task.updated_at) }}</span>
                </div>
              </div>

              <div
                class="task-progress"
                :style="{ backgroundColor: getStatusColor(task.status) + '33' }"
              >
                <div
                  class="task-progress-fill"
                  :style="{
                    backgroundColor: getStatusColor(task.status),
                    width: task.status === 'completed' ? '100%' : task.status === 'in_progress' ? '50%' : '0%'
                  }"
                ></div>
              </div>
            </div>
          </TransitionGroup>
        </div>
      </div>

      <div v-if="activeTab === 'chat'" class="tab-content chat-tab">
        <ChatPanel
          :project-id="projectId"
          :project-path="projectPath"
        />
      </div>

      <div v-if="activeTab === 'logs'" class="tab-content logs-tab">
        <TaskLogViewer />
      </div>
    </div>
  </StratixModal>
</template>

<style scoped>
.task-panel {
  display: flex;
  flex-direction: column;
  height: 70vh;
  min-height: 500px;
}

/* Responsive: narrow screens */
@media (max-width: 1024px) {
  .task-panel {
    height: 80vh;
    min-height: 400px;
  }

  .task-stats {
    flex-wrap: wrap;
  }

  .stat-item {
    flex: 1;
    min-width: 70px;
    padding: 6px 10px;
  }

  .panel-header {
    padding: var(--ds-spacing-md) var(--ds-spacing-md);
  }

  .panel-body {
    padding: var(--ds-spacing-md) var(--ds-spacing-md);
  }
}

.panel-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--ds-border);
  background: var(--ds-bg-secondary);
  padding: 0 calc(var(--ds-spacing-md) + var(--ds-spacing-xs));
  position: relative;
}

.tab-button {
  flex: 1;
  padding: var(--ds-spacing-sm) var(--ds-spacing-lg);
  background: transparent;
  border: none;
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-md);
  cursor: pointer;
  transition: color 0.2s;
  position: relative;
  z-index: 1;
}

.tab-button:hover {
  color: var(--ds-text-secondary);
}

.tab-button.active {
  color: var(--ds-brand-primary);
}

.tab-indicator {
  position: absolute;
  bottom: 0;
  width: 33.33%;
  height: var(--ds-border-width-md, 2px);
  background: var(--ds-brand-primary);
  transition: left 0.3s var(--ds-animation-easing-ease-out);
  box-shadow: 0 -2px 8px var(--ds-brand-primary);
}

.tab-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.chat-tab,
.logs-tab {
  padding: 0;
}

.logs-tab {
  display: flex;
  flex-direction: column;
}

.panel-header {
  padding: calc(var(--ds-spacing-md) + var(--ds-spacing-xs));
  border-bottom: 1px solid var(--ds-border);
  background: var(--ds-bg-secondary);
}

.project-info {
  margin-bottom: var(--ds-spacing-md);
}

.project-info h3 {
  margin: 0 0 var(--ds-spacing-xs) 0;
  font-size: var(--ds-font-size-xl);
  color: var(--ds-text-primary);
}

.project-path {
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-muted);
  font-family: var(--ds-font-mono);
}

.task-stats {
  display: flex;
  gap: var(--ds-spacing-md);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  background: var(--ds-bg-tertiary);
  border-radius: var(--ds-radius-md);
  transition: all 0.3s ease;
}

.stat-item:hover {
  transform: translateY(-2px);
  box-shadow: var(--ds-shadow-sm);
}

.stat-label {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  margin-bottom: var(--ds-spacing-xs);
}

.stat-value {
  font-size: var(--ds-font-size-xl);
  font-weight: bold;
  color: var(--ds-text-primary);
  transition: all 0.3s ease;
}

.stat-value.in-progress {
  color: var(--ds-brand-primary);
}

.stat-value.completed {
  color: var(--ds-status-success);
}

.stat-value.completed.pulse {
  animation: completed-glow 2s ease;
}

@keyframes completed-glow {
  0% { text-shadow: 0 0 0 transparent; }
  30% { text-shadow: 0 0 20px var(--ds-status-success), 0 0 40px var(--ds-status-success); }
  100% { text-shadow: 0 0 0 transparent; }
}

.stat-value.failed {
  color: var(--ds-status-danger);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: calc(var(--ds-spacing-md) + var(--ds-spacing-xs));
}

.loading,
.error,
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: var(--ds-text-muted);
}

.loading-spinner {
  width: var(--ds-spacing-2xl);
  height: var(--ds-spacing-2xl);
  border: var(--ds-border-width-md, 3px) solid var(--ds-border);
  border-top-color: var(--ds-brand-primary);
  border-radius: var(--ds-radius-full);
  animation: spin 0.8s linear infinite;
  margin-bottom: var(--ds-spacing-md);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-icon {
  font-size: var(--ds-font-size-4xl);
  margin-bottom: var(--ds-spacing-md);
}

.error-message {
  margin-bottom: 16px;
  color: var(--ds-status-danger);
}

.empty-icon {
  font-size: var(--ds-font-size-4xl);
  margin-bottom: var(--ds-spacing-md);
}

.empty-hint {
  font-size: var(--ds-font-size-sm);
  margin-top: var(--ds-spacing-sm);
}

.empty-float {
  animation: empty-float 3s ease-in-out infinite;
}

@keyframes empty-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: calc(var(--ds-spacing-sm) + var(--ds-spacing-xs));
}

.task-list-move {
  transition: transform 0.4s ease;
}

.task-list-enter-active,
.task-list-leave-active {
  transition: all 0.3s ease;
}

.task-list-enter-from,
.task-list-leave-to {
  opacity: 0;
  transform: translateY(calc(var(--ds-spacing-md) + var(--ds-spacing-xs)));
}

.task-item {
  padding: var(--ds-spacing-md);
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  cursor: pointer;
  transition: all 0.3s var(--ds-animation-easing-ease-out);
  transform-style: preserve-3d;
  perspective: 1000px;
}

.task-item:hover {
  background: var(--ds-bg-tertiary);
  border-color: var(--ds-brand-primary);
  transform: translateY(calc(var(--ds-spacing-xs) / -2));
  box-shadow: var(--ds-shadow-lg);
}

.task-item.selected {
  background: var(--ds-bg-tertiary);
  border-color: var(--ds-status-success);
  box-shadow: 0 0 0 1px var(--ds-status-success), 0 var(--ds-spacing-sm) var(--ds-spacing-lg) color-mix(in srgb, var(--ds-status-success) 10%, transparent);
}

.task-header {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  margin-bottom: var(--ds-spacing-sm);
}

.status-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.task-item:hover .status-icon {
  transform: scale(1.2);
}

.task-id {
  font-weight: bold;
  color: var(--ds-brand-primary);
  font-family: var(--ds-font-mono);
}

.priority-badge {
  padding: 2px var(--ds-spacing-sm);
  border-radius: var(--ds-radius-sm);
  font-size: var(--ds-font-size-xs);
  font-weight: bold;
  color: var(--ds-text-primary);
  text-transform: uppercase;
  transition: box-shadow 0.3s ease;
}

.task-item:hover .priority-badge {
  box-shadow: 0 0 8px currentColor;
}

.task-description {
  color: var(--ds-text-secondary);
  font-size: var(--ds-font-size-md);
  margin-bottom: calc(var(--ds-spacing-sm) + var(--ds-spacing-xs));
  line-height: 1.4;
}

.task-meta {
  display: flex;
  gap: var(--ds-spacing-md);
  margin-bottom: calc(var(--ds-spacing-sm) + var(--ds-spacing-xs));
  font-size: var(--ds-font-size-xs);
}

.meta-item {
  display: flex;
  gap: var(--ds-spacing-xs);
}

.meta-label {
  color: var(--ds-text-muted);
}

.meta-value {
  color: var(--ds-text-secondary);
}

.task-progress {
  height: var(--ds-spacing-xs);
  border-radius: var(--ds-radius-sm);
  overflow: hidden;
}

.task-progress-fill {
  height: 100%;
  transition: width 0.6s var(--ds-animation-easing-ease-out);
  position: relative;
}

.task-progress-fill::after {
  content: '';
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: var(--ds-spacing-lg);
  background: linear-gradient(90deg, transparent, currentColor);
  opacity: 0.3;
  filter: blur(4px);
}

/* Prefers reduced motion */
@media (prefers-reduced-motion: reduce) {
  .task-item,
  .stat-item,
  .stat-value,
  .task-progress-fill,
  .tab-indicator {
    transition: none !important;
    animation: none !important;
    transform: none !important;
  }
}
</style>
