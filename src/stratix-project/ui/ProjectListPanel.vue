<template>
  <div class="project-list-panel" v-if="visible">
    <div class="panel-header">
      <h3>项目列表</h3>
      <span class="project-count">{{ projects.length }} 个项目</span>
    </div>

    <div class="panel-body">
      <div v-if="loading" class="loading">
        <div class="loading-spinner"></div>
        <span>加载中...</span>
      </div>

      <div v-else-if="projects.length === 0" class="empty">
        <div class="empty-icon">📦</div>
        <div>暂无项目</div>
        <div class="empty-hint">点击"新建项目"开始创建</div>
      </div>

      <transition-group v-else name="list" tag="div" class="project-list">
        <div
          v-for="project in projects"
          :key="project.id"
          class="project-item"
          :class="{ selected: selectedProjectId === project.id }"
          @click="handleSelect(project)"
        >
          <div class="project-header">
            <div class="project-name">
              <span class="status-indicator" :class="`status-${project.status}`"></span>
              {{ project.name }}
            </div>
            <div class="project-priority">P{{ project.priority }}</div>
          </div>

          <div class="project-info">
            <div class="project-status">{{ getStatusText(project.status) }}</div>
            <div class="project-progress" v-if="project.status === 'active'">
              <div class="progress-bar">
                <div class="progress-fill" :style="{ width: `${project.progress}%` }"></div>
              </div>
              <span class="progress-text">{{ project.progress }}%</span>
            </div>
          </div>

          <div class="project-tasks" v-if="project.taskCount > 0">
            任务: {{ project.completedTaskCount }} / {{ project.taskCount }}
          </div>

          <div class="project-actions">
            <button
              v-if="project.status === 'pending'"
              @click.stop="handleStart(project.id)"
              class="btn-start"
            >
              启动
            </button>
            <button
              v-if="project.status === 'active'"
              @click.stop="handlePause(project.id)"
              class="btn-pause"
            >
              暂停
            </button>
            <button
              v-if="project.status === 'paused'"
              @click.stop="handleStart(project.id)"
              class="btn-start"
            >
              继续
            </button>
            <button
              @click.stop="handleEdit(project)"
              class="btn-edit"
            >
              编辑
            </button>
            <button
              @click.stop="handleDelete(project.id)"
              class="btn-delete"
            >
              删除
            </button>
          </div>
        </div>
      </transition-group>
    </div>

    <div class="panel-footer">
      <button @click="handleCreateNew" class="btn-create">
        + 新建项目
      </button>
      <button @click="handleRefresh" class="btn-refresh">
        刷新
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import type { Project, ProjectStatus } from '../types';
import { debounce } from '../utils/helpers';

interface Props {
  visible: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  select: [project: Project];
  edit: [project: Project];
  create: [];
  start: [projectId: string];
  pause: [projectId: string];
  delete: [projectId: string];
  refresh: [];
  'locate-project': [projectId: string];
}>();

const projects = ref<Project[]>([]);
const selectedProjectId = ref<string>('');
const loading = ref(false);

const getStatusText = (status: ProjectStatus): string => {
  const statusMap: Record<ProjectStatus, string> = {
    pending: '待启动',
    active: '执行中',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败'
  };
  return statusMap[status] || status;
};

const handleSelect = (project: Project) => {
  selectedProjectId.value = project.id;
  emit('select', project);
  emit('locate-project', project.id);
};

const handleEdit = (project: Project) => {
  emit('edit', project);
};

const handleStart = (projectId: string) => {
  emit('start', projectId);
};

const handlePause = (projectId: string) => {
  emit('pause', projectId);
};

const handleDelete = (projectId: string) => {
  if (confirm('确定要删除此项目吗？')) {
    emit('delete', projectId);
  }
};

const handleCreateNew = () => {
  emit('create');
};

const handleRefresh = () => {
  loading.value = true;
  emit('refresh');
  setTimeout(() => {
    loading.value = false;
  }, 500);
};

const updateProjectsDebounced = debounce((newProjects: Project[]) => {
  projects.value = newProjects;
  loading.value = false;
}, 300);

const updateProjects = (newProjects: Project[]) => {
  updateProjectsDebounced(newProjects);
};

defineExpose({
  updateProjects
});

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      selectedProjectId.value = '';
    }
  }
);
</script>

<style scoped>
.project-list-panel {
  position: fixed;
  right: 20px;
  top: 80px;
  width: 320px;
  max-height: 600px;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: 8px;
  box-shadow: var(--ds-shadow-lg);
  z-index: 1000;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--ds-border);
}

.panel-header h3 {
  margin: 0;
  color: var(--ds-text-primary);
  font-size: 16px;
}

.project-count {
  color: var(--ds-text-muted);
  font-size: 12px;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.loading,
.empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--ds-text-muted);
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--ds-border);
  border-top-color: var(--ds-brand-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-hint {
  font-size: 12px;
  color: var(--ds-text-muted);
  margin-top: 8px;
}

.project-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.project-item {
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.project-item:hover {
  border-color: var(--ds-brand-primary);
  background: var(--ds-bg-secondary);
  transform: translateY(-1px);
  box-shadow: var(--ds-shadow-md);
}

.project-item.selected {
  border-color: var(--ds-brand-primary);
  background: var(--ds-bg-tertiary);
}

.project-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.project-name {
  color: var(--ds-text-primary);
  font-size: 14px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-pending {
  background: var(--ds-text-muted);
}

.status-active {
  background: var(--ds-brand-primary);
  animation: pulse 2s infinite;
}

.status-paused {
  background: var(--ds-status-warning);
}

.status-completed {
  background: var(--ds-status-success);
}

.status-failed {
  background: var(--ds-status-danger);
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.project-priority {
  font-size: 11px;
  color: var(--ds-status-warning);
  background: var(--ds-bg-tertiary);
  padding: 2px 6px;
  border-radius: 3px;
}

.project-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.project-status {
  font-size: 12px;
  color: var(--ds-text-muted);
}

.project-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-bar {
  width: 80px;
  height: 4px;
  background: var(--ds-bg-tertiary);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--ds-status-success);
  transition: width 0.3s;
}

.progress-text {
  font-size: 11px;
  color: var(--ds-status-success);
}

.project-tasks {
  font-size: 11px;
  color: var(--ds-text-muted);
  margin-bottom: 8px;
}

.project-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--ds-border);
}

.project-actions button {
  flex: 1;
  padding: 6px 8px;
  border: none;
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-start {
  background: var(--ds-status-success);
  color: var(--ds-text-inverse);
}

.btn-start:hover {
  background: var(--ds-status-success);
  opacity: 0.9;
}

.btn-pause {
  background: var(--ds-status-warning);
  color: var(--ds-text-inverse);
}

.btn-pause:hover {
  background: var(--ds-status-warning);
  opacity: 0.9;
}

.btn-edit {
  background: var(--ds-brand-primary);
  color: var(--ds-text-inverse);
}

.btn-edit:hover {
  background: var(--ds-brand-primary);
  opacity: 0.9;
}

.btn-delete {
  background: var(--ds-status-danger);
  color: var(--ds-text-inverse);
}

.btn-delete:hover {
  background: var(--ds-status-danger);
  opacity: 0.9;
}

.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}

.list-enter-from {
  opacity: 0;
  transform: translateX(30px);
}

.list-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}

.list-move {
  transition: transform 0.3s ease;
}
</style>
