<template>
  <div class="command-log">
    <div class="log-header">
      <h3 class="log-title">指令日志</h3>
      <div class="log-actions">
        <div v-if="logs.length > 5" class="log-search">
          <StratixInput
            v-model="searchQuery"
            placeholder="搜索日志..."
            size="small"
            :show-label="false"
            class="search-input"
          />
        </div>
        <div class="filter-dropdown">
          <StratixButton
            variant="ghost"
            size="small"
            :icon="'filter'"
            @click="showFilterMenu = !showFilterMenu"
          />
          <transition name="dropdown-fade">
            <div v-if="showFilterMenu" class="filter-menu">
              <button
                :class="['filter-option', { active: statusFilter === 'all' }]"
                @click="statusFilter = 'all'; showFilterMenu = false"
              >
                全部状态
              </button>
              <button
                :class="['filter-option', { active: statusFilter === 'success' }]"
                @click="statusFilter = 'success'; showFilterMenu = false"
              >
                <span class="status-dot success"></span>
                执行成功
              </button>
              <button
                :class="['filter-option', { active: statusFilter === 'failed' }]"
                @click="statusFilter = 'failed'; showFilterMenu = false"
              >
                <span class="status-dot failed"></span>
                执行失败
              </button>
              <button
                :class="['filter-option', { active: statusFilter === 'running' }]"
                @click="statusFilter = 'running'; showFilterMenu = false"
              >
                <span class="status-dot running"></span>
                执行中
              </button>
            </div>
          </transition>
        </div>
      </div>
    </div>

    <div v-if="filteredLogs.length === 0" class="empty-state">
      <svg class="empty-icon" :viewBox="getIconViewBox('file')" :stroke="getToken('color.foreground.muted')">
        <SvgIcon :name="'file'" size="16" />
      </svg>
      <p>{{ searchQuery || statusFilter !== 'all' ? '未找到匹配的日志' : '暂无指令日志' }}</p>
    </div>

    <div v-else class="logs-container">
      <div
        v-for="log in filteredLogs"
        :key="log.commandId"
        class="log-item"
        :class="[`status-${log.status}`]"
        @click="showLogDetail(log)"
        tabindex="0"
        @keydown.enter="showLogDetail(log)"
      >
        <div class="log-status-icon">
          <svg v-if="log.status === 'pending'" class="status-svg pending" :viewBox="getIconViewBox('clock')" :stroke="getToken('color.status.info')">
            <SvgIcon :name="'clock'" size="16" />
          </svg>
          <svg v-else-if="log.status === 'running'" class="status-svg running" :viewBox="getIconViewBox('zap')" :stroke="getToken('color.status.warning')">
            <SvgIcon :name="'zap'" size="16" />
          </svg>
          <svg v-else-if="log.status === 'success'" class="status-svg success" :viewBox="getIconViewBox('check')" :stroke="getToken('color.status.success')">
            <SvgIcon :name="'check'" size="16" />
          </svg>
          <svg v-else-if="log.status === 'failed'" class="status-svg failed" :viewBox="getIconViewBox('x')" :stroke="getToken('color.status.error')">
            <SvgIcon :name="'x'" size="16" />
          </svg>
        </div>

        <div class="log-content">
          <div class="log-main">
            <span class="log-skill">{{ log.skillName }}</span>
            <span class="log-agent">{{ log.agentName }}</span>
          </div>
          <div class="log-meta">
            <span class="log-time">{{ formatTime(log.time) }}</span>
            <span class="log-id">{{ log.commandId.slice(0, 12) }}...</span>
          </div>
        </div>

        <StratixButton
          v-if="canCancel(log.status)"
          variant="ghost"
          size="small"
          :icon="'x'"
          class="cancel-btn"
          @click.stop="showCancelConfirm(log)"
        />

        <div v-else class="log-arrow">
          <svg :viewBox="getIconViewBox('chevron-right')" :stroke="getToken('color.foreground.muted')">
            <SvgIcon :name="'chevron-right'" size="16" />
          </svg>
        </div>
      </div>
    </div>

    <LogDetailModal
      :visible="showDetailModal"
      :log="selectedLog"
      @close="showDetailModal = false"
    />

    <CancelConfirmDialog
      :visible="showCancelDialog"
      :log="logToCancel"
      @confirm="confirmCancel"
      @cancel="showCancelDialog = false"
    />
  </div>
</template>

<script setup lang="ts">
import { SvgIcon } from '@/components/ui';
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { StratixStateSyncEvent, StratixFrontendOperationEvent } from '@/stratix-core/stratix-protocol';
import StratixEventBus from '../../stratix-core/StratixEventBus';
import LogDetailModal from './LogDetailModal.vue';
import CancelConfirmDialog from './CancelConfirmDialog.vue';
import StratixInput from '@/components/ui/StratixInput.vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import { getToken } from '@/design-system/config';
import { getIconViewBox } from '@/design-system/icons/registry';
export interface CommandLogItem {
  commandId: string;
  agentId: string;
  agentName: string;
  skillId: string;
  skillName: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  time: number;
  params?: Record<string, any>;
  result?: any;
  error?: string;
  duration?: number;
}

interface Props {
  maxLogs?: number;
}

const props = withDefaults(defineProps<Props>(), {
  maxLogs: 10
});

const logs = ref<CommandLogItem[]>([]);
const searchQuery = ref<string>('');
const statusFilter = ref<string>('all');
const showFilterMenu = ref<boolean>(false);
const showDetailModal = ref<boolean>(false);
const selectedLog = ref<CommandLogItem | null>(null);
const showCancelDialog = ref<boolean>(false);
const logToCancel = ref<CommandLogItem | null>(null);

const filteredLogs = computed(() => {
  let result = logs.value;

  if (statusFilter.value !== 'all') {
    result = result.filter(log => log.status === statusFilter.value);
  }

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(log =>
      log.skillName.toLowerCase().includes(query) ||
      log.agentName.toLowerCase().includes(query) ||
      log.commandId.toLowerCase().includes(query)
    );
  }

  return result;
});

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) {
    return '刚刚';
  } else if (diff < 3600000) {
    return `${Math.floor(diff / 60000)} 分钟前`;
  } else if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)} 小时前`;
  } else {
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }
};

const addLog = (log: CommandLogItem) => {
  logs.value.unshift(log);
  if (logs.value.length > props.maxLogs) {
    logs.value.pop();
  }
};

const updateLogStatus = (
  commandId: string,
  status: CommandLogItem['status'],
  result?: any,
  error?: string,
  duration?: number
) => {
  const log = logs.value.find(l => l.commandId === commandId);
  if (log) {
    log.status = status;
    if (result !== undefined) log.result = result;
    if (error !== undefined) log.error = error;
    if (duration !== undefined) log.duration = duration;
  }
};

const showLogDetail = (log: CommandLogItem) => {
  selectedLog.value = log;
  showDetailModal.value = true;
};

const canCancel = (status: CommandLogItem['status']): boolean => {
  return status === 'pending' || status === 'running';
};

const showCancelConfirm = (log: CommandLogItem) => {
  logToCancel.value = log;
  showCancelDialog.value = true;
};

const confirmCancel = () => {
  if (!logToCancel.value) return;

  const event: StratixFrontendOperationEvent = {
    eventType: 'stratix:command_cancel',
    payload: {
      commandId: logToCancel.value.commandId
    },
    timestamp: Date.now(),
    requestId: `stratix-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  };

  StratixEventBus.getInstance().emit(event);

  updateLogStatus(
    logToCancel.value.commandId,
    'failed',
    undefined,
    '用户取消'
  );

  showCancelDialog.value = false;
  logToCancel.value = null;
};

const handleCommandStatusUpdate = (event: StratixStateSyncEvent) => {
  const { commandId, commandStatus, data } = event.payload;
  if (commandId && commandStatus) {
    updateLogStatus(
      commandId,
      commandStatus as CommandLogItem['status'],
      data?.result,
      data?.error,
      data?.duration
    );
  }
};

const handleCommandExecute = (event: StratixFrontendOperationEvent) => {
  const { command, skill } = event.payload;
  if (command && skill) {
    addLog({
      commandId: command.commandId,
      agentId: command.agentId,
      agentName: command.agentId,
      skillId: command.skillId,
      skillName: skill.name,
      status: 'pending',
      time: command.executeAt || Date.now(),
      params: command.params
    });
  }
};

const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  if (!target.closest('.filter-dropdown')) {
    showFilterMenu.value = false;
  }
};

onMounted(() => {
  StratixEventBus.getInstance().subscribe('stratix:command_status_update', handleCommandStatusUpdate);
  StratixEventBus.getInstance().subscribe('stratix:command_execute', handleCommandExecute);
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  StratixEventBus.getInstance().unsubscribe('stratix:command_status_update', handleCommandStatusUpdate);
  StratixEventBus.getInstance().unsubscribe('stratix:command_execute', handleCommandExecute);
  document.removeEventListener('click', handleClickOutside);
});

defineExpose({
  addLog,
  updateLogStatus
});
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap');

.command-log {
  font-family: 'Fira Sans', sans-serif;
  background: v-bind("getToken('panel.default')");
  border-radius: v-bind("getToken('radius.md')");
  padding: v-bind("getToken('space.4')");
  color: v-bind("getToken('color.foreground.default')");
  height: 100%;
  display: flex;
  flex-direction: column;
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: v-bind("getToken('space.4')");
  padding-bottom: v-bind("getToken('space.3')");
  border-bottom: v-bind("getToken('border.default')");
}

.log-title {
  font-family: 'Fira Code', monospace;
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: v-bind("getToken('color.foreground.default')");
}

.log-actions {
  display: flex;
  align-items: center;
  gap: v-bind("getToken('space.3')");
}

.log-search {
  position: relative;
}

.search-input {
  width: 140px;
}

.filter-dropdown {
  position: relative;
}

.filter-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: v-bind("getToken('space.1')");
  background: v-bind("getToken('panel.default')");
  border: v-bind("getToken('border.default')");
  border-radius: v-bind("getToken('radius.md')");
  padding: v-bind("getToken('space.1')");
  min-width: 140px;
  z-index: 100;
  box-shadow: v-bind("getToken('shadow.lg')");
}

.filter-option {
  display: flex;
  align-items: center;
  gap: v-bind("getToken('space.2')");
  width: 100%;
  padding: v-bind("getToken('space.2')") v-bind("getToken('space.3')");
  background: transparent;
  border: none;
  border-radius: v-bind("getToken('radius.sm')");
  color: v-bind("getToken('color.foreground.muted')");
  font-size: 13px;
  cursor: pointer;
  transition: all 150ms ease;
  font-family: 'Fira Sans', sans-serif;
}

.filter-option:hover {
  background: v-bind("getToken('panel.ghost')");
  color: v-bind("getToken('color.foreground.default')");
}

.filter-option.active {
  background: v-bind("getToken('color.status.success.bg')");
  color: v-bind("getToken('color.status.success')");
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.success { background: v-bind("getToken('color.status.success')"); }
.status-dot.failed { background: v-bind("getToken('color.status.error')"); }
.status-dot.running { background: v-bind("getToken('color.status.warning')"); }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: v-bind("getToken('space.10')") v-bind("getToken('space.5')");
  color: v-bind("getToken('color.foreground.muted')");
  flex: 1;
}

.empty-icon {
  width: 48px;
  height: 48px;
  stroke-width: 2;
  margin-bottom: v-bind("getToken('space.3')");
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}

.logs-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.log-item {
  display: flex;
  align-items: center;
  padding: v-bind("getToken('space.3')");
  margin-bottom: v-bind("getToken('space.2')");
  background: v-bind("getToken('panel.subtle')");
  border: v-bind("getToken('border.default')");
  border-radius: v-bind("getToken('radius.md')");
  cursor: pointer;
  transition: all 200ms ease;
  gap: v-bind("getToken('space.3')");
}

.log-item:hover {
  background: v-bind("getToken('panel.ghost')");
  border-color: v-bind("getToken('color.border.hover')");
  transform: translateX(4px);
}

.log-item:focus {
  outline: none;
  border-color: v-bind("getToken('color.status.success')");
}

.log-status-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.log-item.status-pending .log-status-icon {
  background: v-bind("getToken('color.status.info.bg')");
}

.log-item.status-running .log-status-icon {
  background: v-bind("getToken('color.status.warning.bg')");
}

.log-item.status-success .log-status-icon {
  background: v-bind("getToken('color.status.success.bg')");
}

.log-item.status-failed .log-status-icon {
  background: v-bind("getToken('color.status.error.bg')");
}

.status-svg {
  width: 16px;
  height: 16px;
  stroke-width: 2.5;
}

.status-svg.pending { color: v-bind("getToken('color.status.info')"); }
.status-svg.running { 
  color: v-bind("getToken('color.status.warning')"); 
  animation: pulse 1.5s ease-in-out infinite;
}
.status-svg.success { color: v-bind("getToken('color.status.success')"); }
.status-svg.failed { color: v-bind("getToken('color.status.error')"); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.log-content {
  flex: 1;
  min-width: 0;
}

.log-main {
  display: flex;
  align-items: center;
  gap: v-bind("getToken('space.2')");
  margin-bottom: v-bind("getToken('space.1')");
}

.log-skill {
  font-weight: 600;
  font-size: 13px;
  color: v-bind("getToken('color.foreground.default')");
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-agent {
  font-size: 11px;
  color: v-bind("getToken('color.foreground.muted')");
  padding: v-bind("getToken('space.0\\.5')") v-bind("getToken('space.1\\.5')");
  background: v-bind("getToken('panel.subtle')");
  border-radius: v-bind("getToken('radius.sm')");
  flex-shrink: 0;
}

.log-meta {
  display: flex;
  align-items: center;
  gap: v-bind("getToken('space.2')");
}

.log-time {
  font-size: 11px;
  color: v-bind("getToken('color.foreground.muted')");
}

.log-id {
  font-family: 'Fira Code', monospace;
  font-size: 10px;
  color: v-bind("getToken('color.foreground.muted')");
}

.log-arrow {
  flex-shrink: 0;
}

.log-arrow svg {
  width: 16px;
  height: 16px;
  stroke-width: 2;
}

.log-item:hover .log-arrow svg {
  color: v-bind("getToken('color.status.success')");
}

.cancel-btn {
  flex-shrink: 0;
}

.logs-container::-webkit-scrollbar {
  width: 6px;
}

.logs-container::-webkit-scrollbar-track {
  background: v-bind("getToken('panel.subtle')");
  border-radius: v-bind("getToken('radius.sm')");
}

.logs-container::-webkit-scrollbar-thumb {
  background: v-bind("getToken('color.border.default')");
  border-radius: v-bind("getToken('radius.sm')");
}

.logs-container::-webkit-scrollbar-thumb:hover {
  background: v-bind("getToken('color.border.hover')");
}

.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}

.dropdown-fade-enter-from,
.dropdown-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .log-item,
  .filter-btn,
  .search-input,
  .filter-option,
  .status-svg.running,
  .dropdown-fade-enter-active,
  .dropdown-fade-leave-active {
    transition: none;
    animation: none;
  }
}

@media (max-width: 768px) {
  .command-log {
    padding: v-bind("getToken('space.3')");
  }

  .log-header {
    flex-direction: column;
    align-items: flex-start;
    gap: v-bind("getToken('space.3')");
  }

  .log-actions {
    width: 100%;
    justify-content: space-between;
  }

  .search-input {
    width: 120px;
  }

  .log-item {
    padding: v-bind("getToken('space.2\\.5')");
  }
}
</style>
