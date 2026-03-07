<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { StratixModal, StratixButton } from '@/components/ui';
import type { LraTask } from '../stratix-lra-bridge/types';
import { LRAClient } from '../stratix-lra-bridge/LRAClient';
import { LRAWatcher } from '../stratix-lra-bridge/LRAWatcher';

const props = defineProps<{
  visible: boolean;
  projectId: string | null;
  projectPath: string | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:visible', value: boolean): void;
}>();

const lraClient = ref<LRAClient | null>(null);
const lraWatcher = ref<LRAWatcher | null>(null);
const tasks = ref<LraTask[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const selectedTaskId = ref<string | null>(null);

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
    pending: '#888888',
    in_progress: '#00aaff',
    completed: '#00ff00',
    failed: '#ff4444',
    paused: '#ffaa00'
  };
  return colors[status] || '#888888';
};

const getStatusIcon = (status: string) => {
  const icons: Record<string, string> = {
    pending: '⏳',
    in_progress: '▶️',
    completed: '✅',
    failed: '❌',
    paused: '⏸️'
  };
  return icons[status] || '❓';
};

const getPriorityColor = (priority: string) => {
  const colors: Record<string, string> = {
    high: '#ff4444',
    medium: '#ffaa00',
    low: '#4488ff'
  };
  return colors[priority] || '#888888';
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
    title="任务面板"
    size="xl"
    @close="handleClose"
  >
    <div class="task-panel">
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
            <span class="stat-value completed">{{ taskStats.completed }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">失败</span>
            <span class="stat-value failed">{{ taskStats.failed }}</span>
          </div>
        </div>
      </div>

      <div class="panel-body">
        <div v-if="loading" class="loading">
          <div class="loading-spinner"></div>
          <span>加载任务中...</span>
        </div>

        <div v-else-if="error" class="error">
          <div class="error-icon">⚠️</div>
          <div class="error-message">{{ error }}</div>
          <StratixButton @click="loadTasks">重试</StratixButton>
        </div>

        <div v-else-if="tasks.length === 0" class="empty">
          <div class="empty-icon">📋</div>
          <div>暂无任务</div>
          <div class="empty-hint">使用 LRA 创建任务</div>
        </div>

        <div v-else class="task-list">
          <div
            v-for="task in sortedTasks"
            :key="task.id"
            class="task-item"
            :class="{ selected: selectedTaskId === task.id }"
            @click="selectedTaskId = task.id"
          >
            <div class="task-header">
              <span class="status-icon">{{ getStatusIcon(task.status) }}</span>
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
        </div>
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

.panel-header {
  padding: 20px;
  border-bottom: 1px solid #2a2a4e;
  background: #1a1a2e;
}

.project-info {
  margin-bottom: 16px;
}

.project-info h3 {
  margin: 0 0 4px 0;
  font-size: 18px;
  color: #ffffff;
}

.project-path {
  font-size: 12px;
  color: #888;
  font-family: monospace;
}

.task-stats {
  display: flex;
  gap: 16px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 16px;
  background: #2a2a4e;
  border-radius: 6px;
}

.stat-label {
  font-size: 11px;
  color: #888;
  margin-bottom: 4px;
}

.stat-value {
  font-size: 18px;
  font-weight: bold;
  color: #fff;
}

.stat-value.in-progress {
  color: #00aaff;
}

.stat-value.completed {
  color: #00ff00;
}

.stat-value.failed {
  color: #ff4444;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.loading,
.error,
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: #888;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #2a2a4e;
  border-top-color: #00aaff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.error-message {
  margin-bottom: 16px;
  color: #ff4444;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.empty-hint {
  font-size: 12px;
  margin-top: 8px;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-item {
  padding: 16px;
  background: #1a1a2e;
  border: 1px solid #2a2a4e;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.task-item:hover {
  background: #2a2a4e;
  border-color: #00aaff;
}

.task-item.selected {
  background: #2a2a4e;
  border-color: #00ff00;
}

.task-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.status-icon {
  font-size: 18px;
}

.task-id {
  font-weight: bold;
  color: #00aaff;
  font-family: monospace;
}

.priority-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: bold;
  color: #fff;
  text-transform: uppercase;
}

.task-description {
  color: #ccc;
  font-size: 14px;
  margin-bottom: 12px;
  line-height: 1.4;
}

.task-meta {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 11px;
}

.meta-item {
  display: flex;
  gap: 4px;
}

.meta-label {
  color: #888;
}

.meta-value {
  color: #ccc;
}

.task-progress {
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
}

.task-progress-fill {
  height: 100%;
  transition: width 0.3s ease;
}
</style>
