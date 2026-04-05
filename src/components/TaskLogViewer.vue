<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { StratixEmpty, StratixButton, StratixLoading } from '@/components/ui';
import type { StratixCommandLog } from '@/stratix-data-store/types';

interface FilterOptions {
  agentId?: string;
  status?: StratixCommandLog['status'];
  startTime?: number;
  endTime?: number;
}

const logs = ref<StratixCommandLog[]>([]);
const loading = ref(false);
const expandedLogId = ref<string | null>(null);
const autoScroll = ref(true);
const logListRef = ref<HTMLElement | null>(null);

const filterAgentId = ref<string>('');
const filterStatus = ref<StratixCommandLog['status'] | ''>('');
const filterStartTime = ref<string>('');
const filterEndTime = ref<string>('');

const statusOptions: { value: StratixCommandLog['status'] | ''; label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '等待中' },
  { value: 'running', label: '执行中' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
];

const filteredLogs = computed(() => {
  return logs.value.filter(log => {
    if (filterAgentId.value && log.agentId !== filterAgentId.value) return false;
    if (filterStatus.value && log.status !== filterStatus.value) return false;
    if (filterStartTime.value) {
      const start = new Date(filterStartTime.value).getTime();
      if (log.startTime < start) return false;
    }
    if (filterEndTime.value) {
      const end = new Date(filterEndTime.value).getTime();
      if (log.startTime > end) return false;
    }
    return true;
  });
});

const uniqueAgentIds = computed(() => {
  const agents = new Set(logs.value.map(l => l.agentId));
  return Array.from(agents).sort();
});

const fetchLogs = async () => {
  loading.value = true;
  try {
    const res = await fetch('/api/commands');
    const data = await res.json();
    logs.value = data.data?.commands || [];
  } catch (err) {
    console.error('[TaskLogViewer] Failed to fetch logs:', err);
  } finally {
    loading.value = false;
  }
};

let pollInterval: ReturnType<typeof setInterval> | null = null;

const startPolling = () => {
  stopPolling();
  pollInterval = setInterval(fetchLogs, 2000);
};

const stopPolling = () => {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
};

const scrollToBottom = () => {
  if (logListRef.value && autoScroll.value) {
    nextTick(() => {
      if (logListRef.value) {
        logListRef.value.scrollTop = logListRef.value.scrollHeight;
      }
    });
  }
};

watch(filteredLogs, () => {
  if (autoScroll.value) {
    scrollToBottom();
  }
});

const toggleExpand = (logId: string) => {
  expandedLogId.value = expandedLogId.value === logId ? null : logId;
};

const clearFilters = () => {
  filterAgentId.value = '';
  filterStatus.value = '';
  filterStartTime.value = '';
  filterEndTime.value = '';
};

const formatTimestamp = (ts: number) => {
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatDuration = (start: number, end?: number) => {
  if (!end) return '-';
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

const getStatusConfig = (status: StratixCommandLog['status']) => {
  const configs = {
    pending: { color: 'var(--ds-text-muted)', bg: 'var(--ds-bg-tertiary)', label: '等待' },
    running: { color: 'var(--ds-brand-primary)', bg: 'rgba(0, 170, 255, 0.15)', label: '运行' },
    success: { color: 'var(--ds-status-success)', bg: 'rgba(0, 200, 100, 0.15)', label: '成功' },
    failed: { color: 'var(--ds-status-danger)', bg: 'rgba(255, 60, 60, 0.15)', label: '失败' },
  };
  return configs[status] || configs.pending;
};

const exportLogs = () => {
  const data = filteredLogs.value.map(log => ({
    logId: log.logId,
    commandId: log.commandId,
    agentId: log.agentId,
    skillId: log.skillId,
    skillName: log.skillName,
    params: log.params,
    status: log.status,
    result: log.result,
    error: log.error,
    startTime: new Date(log.startTime).toISOString(),
    endTime: log.endTime ? new Date(log.endTime).toISOString() : null,
    duration: log.endTime ? log.endTime - log.startTime : null,
  }));

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `task-logs-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

const formatParams = (params: Record<string, any>) => {
  try {
    return JSON.stringify(params, null, 2);
  } catch {
    return String(params);
  }
};

onMounted(() => {
  fetchLogs();
  startPolling();
});

onUnmounted(() => {
  stopPolling();
});
</script>

<template>
  <div class="task-log-viewer">
    <div class="log-header">
      <div class="header-title">
        <span class="title-icon">📋</span>
        <span>执行日志</span>
        <span class="log-count">{{ filteredLogs.length }}</span>
      </div>
      <div class="header-actions">
        <StratixButton variant="ghost" size="sm" @click="exportLogs" :disabled="filteredLogs.length === 0">
          导出
        </StratixButton>
        <StratixButton variant="ghost" size="sm" @click="fetchLogs">
          刷新
        </StratixButton>
      </div>
    </div>

    <div class="log-filters">
      <div class="filter-group">
        <label>Agent</label>
        <select v-model="filterAgentId" class="filter-select">
          <option value="">全部</option>
          <option v-for="agent in uniqueAgentIds" :key="agent" :value="agent">
            {{ agent }}
          </option>
        </select>
      </div>

      <div class="filter-group">
        <label>状态</label>
        <select v-model="filterStatus" class="filter-select">
          <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <div class="filter-group">
        <label>开始时间</label>
        <input type="datetime-local" v-model="filterStartTime" class="filter-input" />
      </div>

      <div class="filter-group">
        <label>结束时间</label>
        <input type="datetime-local" v-model="filterEndTime" class="filter-input" />
      </div>

      <StratixButton variant="ghost" size="sm" @click="clearFilters">
        重置
      </StratixButton>
    </div>

    <div class="log-controls">
      <label class="auto-scroll-toggle">
        <input type="checkbox" v-model="autoScroll" />
        <span>自动滚动</span>
      </label>
    </div>

    <div class="log-list" ref="logListRef">
      <StratixLoading v-if="loading && logs.length === 0" mode="skeleton" :skeleton-lines="5" />

      <StratixEmpty
        v-else-if="logs.length === 0"
        scenario="no-data"
        title="暂无日志"
        description="任务执行日志将显示在这里"
      />

      <template v-else>
        <div
          v-for="log in filteredLogs"
          :key="log.logId"
          class="log-item"
          :class="{ expanded: expandedLogId === log.logId, [log.status]: true }"
          @click="toggleExpand(log.logId)"
        >
          <div class="log-summary">
            <span class="log-timestamp">{{ formatTimestamp(log.startTime) }}</span>
            <span class="log-agent">{{ log.agentId }}</span>
            <span class="log-skill">{{ log.skillName }}</span>
            <span
              class="log-status"
              :style="{
                color: getStatusConfig(log.status).color,
                backgroundColor: getStatusConfig(log.status).bg,
              }"
            >
              {{ getStatusConfig(log.status).label }}
            </span>
            <span class="log-duration">{{ formatDuration(log.startTime, log.endTime) }}</span>
            <span class="expand-icon">{{ expandedLogId === log.logId ? '▼' : '▶' }}</span>
          </div>

          <div v-if="expandedLogId === log.logId" class="log-details">
            <div class="detail-section">
              <div class="detail-label">日志ID</div>
              <div class="detail-value mono">{{ log.logId }}</div>
            </div>

            <div class="detail-section">
              <div class="detail-label">命令ID</div>
              <div class="detail-value mono">{{ log.commandId }}</div>
            </div>

            <div class="detail-section">
              <div class="detail-label">Skill ID</div>
              <div class="detail-value mono">{{ log.skillId }}</div>
            </div>

            <div class="detail-section">
              <div class="detail-label">输入参数</div>
              <pre class="detail-value pre">{{ formatParams(log.params) }}</pre>
            </div>

            <div v-if="log.result" class="detail-section">
              <div class="detail-label">输出结果</div>
              <pre class="detail-value pre success">{{ log.result }}</pre>
            </div>

            <div v-if="log.error" class="detail-section">
              <div class="detail-label">错误信息</div>
              <pre class="detail-value pre error">{{ log.error }}</pre>
            </div>

            <div class="detail-section">
              <div class="detail-label">开始时间</div>
              <div class="detail-value">{{ formatTimestamp(log.startTime) }}</div>
            </div>

            <div v-if="log.endTime" class="detail-section">
              <div class="detail-label">结束时间</div>
              <div class="detail-value">{{ formatTimestamp(log.endTime) }}</div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.task-log-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 400px;
  background: var(--ds-bg-primary);
  border-radius: 8px;
  border: 1px solid var(--ds-border);
  overflow: hidden;
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--ds-bg-secondary);
  border-bottom: 1px solid var(--ds-border);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--ds-text-primary);
}

.title-icon {
  font-size: 16px;
}

.log-count {
  background: var(--ds-bg-tertiary);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  color: var(--ds-text-muted);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.log-filters {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  background: var(--ds-bg-secondary);
  border-bottom: 1px solid var(--ds-border);
  flex-wrap: wrap;
  align-items: flex-end;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.filter-group label {
  font-size: 11px;
  color: var(--ds-text-muted);
}

.filter-select,
.filter-input {
  padding: 6px 10px;
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  background: var(--ds-bg-primary);
  color: var(--ds-text-primary);
  font-size: 12px;
  min-width: 100px;
}

.filter-select:focus,
.filter-input:focus {
  outline: none;
  border-color: var(--ds-brand-primary);
}

.log-controls {
  display: flex;
  gap: 12px;
  padding: 8px 16px;
  background: var(--ds-bg-tertiary);
  border-bottom: 1px solid var(--ds-border);
}

.auto-scroll-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ds-text-muted);
  cursor: pointer;
}

.auto-scroll-toggle input {
  cursor: pointer;
}

.log-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.log-item {
  padding: 10px 12px;
  margin-bottom: 4px;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.log-item:hover {
  background: var(--ds-bg-tertiary);
}

.log-item.expanded {
  border-color: var(--ds-brand-primary);
}

.log-item.running {
  border-left: 3px solid var(--ds-brand-primary);
}

.log-item.failed {
  border-left: 3px solid var(--ds-status-danger);
}

.log-item.success {
  border-left: 3px solid var(--ds-status-success);
}

.log-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.log-timestamp {
  color: var(--ds-text-muted);
  font-family: monospace;
  font-size: 11px;
  white-space: nowrap;
}

.log-agent {
  color: var(--ds-brand-primary);
  font-weight: 500;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-skill {
  color: var(--ds-text-secondary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-status {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.log-duration {
  color: var(--ds-text-muted);
  font-family: monospace;
  font-size: 11px;
}

.expand-icon {
  color: var(--ds-text-muted);
  font-size: 10px;
}

.log-details {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ds-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-label {
  font-size: 10px;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-value {
  font-size: 12px;
  color: var(--ds-text-secondary);
}

.detail-value.mono {
  font-family: monospace;
  color: var(--ds-text-primary);
}

.detail-value.pre {
  background: var(--ds-bg-primary);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: monospace;
  font-size: 11px;
  max-height: 200px;
  overflow-y: auto;
}

.detail-value.pre.success {
  color: var(--ds-status-success);
}

.detail-value.pre.error {
  color: var(--ds-status-danger);
}
</style>
