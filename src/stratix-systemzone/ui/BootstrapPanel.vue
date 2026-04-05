<template>
  <div class="bootstrap-panel">
    <div class="panel-header">
      <h3 class="panel-title">自举引擎</h3>
      <span class="mode-badge" :class="`mode-${store.bootstrapStatus?.mode}`">
        {{ modeLabel(store.bootstrapStatus?.mode) }}
      </span>
    </div>

    <!-- Loading -->
    <div v-if="isLoading && !store.bootstrapStatus" class="panel-state loading">
      <span class="spinner"></span>
      <span>加载中...</span>
    </div>

    <!-- Error -->
    <div v-else-if="panelError" class="panel-state error">
      <span class="error-icon">⚠️</span>
      <span class="error-msg">{{ panelError }}</span>
      <button class="btn-retry" @click="retry">重试</button>
    </div>

    <!-- Engine Status Card -->
    <div v-else-if="store.bootstrapStatus" class="engine-card">
      <div class="engine-status-row">
        <div class="status-indicator">
          <span class="big-dot" :class="store.bootstrapStatus.engineRunning ? 'dot-running' : 'dot-stopped'"></span>
          <span class="status-label">{{ store.bootstrapStatus.engineRunning ? '运行中' : '已停止' }}</span>
        </div>
        <div class="engine-stats">
          <div class="stat-item">
            <span class="stat-value">{{ store.bootstrapStatus.cycleCount }}</span>
            <span class="stat-label">完成循环</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ store.bootstrapStatus.lastCycleAt ? formatTime(store.bootstrapStatus.lastCycleAt) : '-' }}</span>
            <span class="stat-label">最后循环</span>
          </div>
          <div v-if="store.bootstrapStatus.phase" class="stat-item">
            <span class="stat-value phase">{{ store.bootstrapStatus.phase }}</span>
            <span class="stat-label">当前阶段</span>
          </div>
        </div>
      </div>

      <!-- Controls -->
      <div class="controls">
        <button
          class="btn-primary"
          :class="store.bootstrapStatus.engineRunning ? 'btn-stop' : 'btn-start'"
          @click="toggleEngine"
          :disabled="store.loading"
        >
          {{ store.bootstrapStatus.engineRunning ? '停止' : '启动' }}
        </button>

        <div class="mode-select">
          <label>模式</label>
          <select :value="store.bootstrapStatus.mode" @change="changeMode">
            <option value="manual">手动</option>
            <option value="semi_auto">半自动</option>
            <option value="full_auto">全自动</option>
          </select>
        </div>

        <button
          class="btn-cycle"
          @click="triggerCycle"
          :disabled="store.loading || store.bootstrapStatus.engineRunning"
        >
          触发一次循环
        </button>
      </div>
    </div>

    <!-- Confirm Modal for full_auto -->
    <div v-if="showConfirm" class="modal-overlay" @click.self="showConfirm = false">
      <div class="modal">
        <p class="modal-text">切换到全自动模式后，系统将自主决策并执行优化提案。</p>
        <p class="modal-text">确定要继续吗？</p>
        <div class="modal-actions">
          <button class="btn-confirm" @click="confirmModeChange">确认</button>
          <button class="btn-cancel" @click="showConfirm = false">取消</button>
        </div>
      </div>
    </div>

    <!-- History Table -->
    <div class="history-section">
      <h4 class="section-title">历史记录</h4>
      <div v-if="store.bootstrapHistory.length === 0" class="empty-history">
        暂无历史记录
      </div>
      <table v-else class="history-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>状态</th>
            <th>提案</th>
            <th>批准</th>
            <th>执行</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in store.bootstrapHistory" :key="entry.id">
            <td>{{ formatTime(entry.startedAt) }}</td>
            <td>
              <span class="history-status" :class="`status-${entry.status}`">
                {{ statusLabel(entry.status) }}
              </span>
            </td>
            <td>{{ entry.proposalsGenerated }}</td>
            <td>{{ entry.proposalsApproved }}</td>
            <td>{{ entry.proposalsExecuted }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, type Ref, onMounted } from 'vue';
import { useSystemZoneStore } from '../../stores/systemzone';
import { usePanelState } from './composables/usePanelState';

const store = useSystemZoneStore();

const showConfirm = ref(false);
const pendingMode = ref<string | null>(null);

const bootstrapRef = computed(() => store.bootstrapHistory) as Ref<any[]>;
const { isLoading, panelError, retry } = usePanelState('bootstrap', bootstrapRef);

function modeLabel(mode?: string): string {
  switch (mode) {
    case 'manual': return '手动';
    case 'semi_auto': return '半自动';
    case 'full_auto': return '全自动';
    default: return '未知';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'success': return '成功';
    case 'partial': return '部分';
    case 'failed': return '失败';
    default: return status;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function toggleEngine() {
  if (store.bootstrapStatus?.engineRunning) {
    await store.stopBootstrap();
  } else {
    await store.startBootstrap();
  }
}

function changeMode(e: Event) {
  const mode = (e.target as HTMLSelectElement).value as 'manual' | 'semi_auto' | 'full_auto';
  if (mode === 'full_auto') {
    pendingMode.value = mode;
    showConfirm.value = true;
    return;
  }
  store.setBootstrapMode(mode);
}

async function confirmModeChange() {
  if (pendingMode.value) {
    await store.setBootstrapMode(pendingMode.value);
  }
  showConfirm.value = false;
  pendingMode.value = null;
}

async function triggerCycle() {
  await store.triggerBootstrapCycle();
}

onMounted(() => {
  store.fetchBootstrapStatus();
});
</script>

<style scoped>
.bootstrap-panel {
  background: var(--ds-bg-sunken, #0f1117);
  border-radius: var(--ds-radius-md, 8px);
  border: 1px solid var(--ds-border-subtle, rgba(148, 163, 184, 0.1));
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ds-border-subtle, rgba(148, 163, 184, 0.1));
}

.panel-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--ds-text-primary, #e2e8f0);
}

.mode-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.mode-manual {
  background: color-mix(in srgb, var(--ds-text-muted, #94a3b8) 15%, transparent);
  color: var(--ds-text-muted, #94a3b8);
}
.mode-semi_auto {
  background: color-mix(in srgb, var(--ds-status-warning, #eab308) 15%, transparent);
  color: var(--ds-status-warning, #eab308);
}
.mode-full_auto {
  background: color-mix(in srgb, var(--ds-status-success, #22c55e) 15%, transparent);
  color: var(--ds-status-success, #22c55e);
}

/* Panel states */
.panel-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 10px;
}
.panel-state.loading { flex-direction: row; }

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--ds-border-subtle, rgba(255, 255, 255, 0.1));
  border-top-color: var(--ds-status-info, #3b82f6);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.error-icon { font-size: 28px; }
.error-msg { color: var(--ds-status-danger, #ef4444); font-size: 13px; }
.btn-retry {
  background: var(--ds-bg-overlay, rgba(255, 255, 255, 0.08));
  color: var(--ds-text-secondary, #94a3b8);
  padding: 4px 12px;
  border-radius: var(--ds-radius-sm, 4px);
  font-size: 12px;
  border: none;
  cursor: pointer;
}
.btn-retry:hover { color: var(--ds-text-primary, #e2e8f0); }

/* Engine Card */
.engine-card {
  padding: 16px;
  border-bottom: 1px solid var(--ds-border-subtle, rgba(148, 163, 184, 0.1));
}

.engine-status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 10px;
}

.big-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}
.dot-running {
  background: var(--ds-status-success, #22c55e);
  animation: pulse 1.5s infinite;
}
.dot-stopped { background: var(--ds-text-muted, #64748b); }

.status-label {
  font-size: 14px;
  color: var(--ds-text-primary, #e2e8f0);
  font-weight: 500;
}

.engine-stats { display: flex; gap: 24px; }

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.stat-value {
  font-size: 14px;
  color: var(--ds-text-primary, #e2e8f0);
  font-weight: 500;
}
.stat-value.phase {
  font-size: 11px;
  padding: 1px 6px;
  background: color-mix(in srgb, var(--ds-status-info, #3b82f6) 15%, transparent);
  color: var(--ds-status-info, #3b82f6);
  border-radius: 3px;
}
.stat-label {
  font-size: 11px;
  color: var(--ds-text-muted, #64748b);
  margin-top: 2px;
}

/* Controls */
.controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-primary {
  padding: 6px 20px;
  border-radius: var(--ds-radius-sm, 4px);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: opacity 0.2s;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-start {
  background: var(--ds-status-success, #22c55e);
  color: var(--ds-bg-base, #fff);
}
.btn-stop {
  background: var(--ds-status-danger, #ef4444);
  color: var(--ds-bg-base, #fff);
}

.mode-select {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mode-select label { font-size: 12px; color: var(--ds-text-secondary, #94a3b8); }
.mode-select select {
  background: var(--ds-bg-elevated, #1e293b);
  border: 1px solid var(--ds-border-default, rgba(148, 163, 184, 0.2));
  border-radius: var(--ds-radius-sm, 4px);
  padding: 4px 8px;
  color: var(--ds-text-primary, #e2e8f0);
  font-size: 12px;
  cursor: pointer;
}
.mode-select select:focus {
  outline: none;
  border-color: var(--ds-status-info, #3b82f6);
}

.btn-cycle {
  background: color-mix(in srgb, var(--ds-status-info, #3b82f6) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--ds-status-info, #3b82f6) 30%, transparent);
  color: var(--ds-status-info, #3b82f6);
  padding: 6px 14px;
  border-radius: var(--ds-radius-sm, 4px);
  font-size: 12px;
  cursor: pointer;
  margin-left: auto;
  transition: background 0.2s;
}
.btn-cycle:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ds-status-info, #3b82f6) 25%, transparent);
}
.btn-cycle:disabled { opacity: 0.5; cursor: not-allowed; }

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--ds-bg-base, #000) 60%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: var(--ds-bg-elevated, #1e293b);
  border: 1px solid var(--ds-border-default, rgba(148, 163, 184, 0.2));
  border-radius: var(--ds-radius-md, 8px);
  padding: 24px;
  max-width: 360px;
}
.modal-text {
  color: var(--ds-text-primary, #e2e8f0);
  font-size: 14px;
  margin: 0 0 8px;
}
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
.btn-confirm {
  background: var(--ds-status-success, #22c55e);
  border: none;
  color: var(--ds-bg-base, #fff);
  padding: 6px 16px;
  border-radius: var(--ds-radius-sm, 4px);
  font-size: 13px;
  cursor: pointer;
}
.btn-cancel {
  background: transparent;
  border: 1px solid var(--ds-border-default, rgba(148, 163, 184, 0.2));
  color: var(--ds-text-secondary, #94a3b8);
  padding: 6px 16px;
  border-radius: var(--ds-radius-sm, 4px);
  font-size: 13px;
  cursor: pointer;
}

/* History */
.history-section { padding: 16px; }

.section-title {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ds-text-primary, #e2e8f0);
}

.empty-history {
  text-align: center;
  color: var(--ds-text-muted, #64748b);
  font-size: 13px;
  padding: 20px;
}

.history-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.history-table th {
  text-align: left;
  padding: 8px 12px;
  color: var(--ds-text-muted, #64748b);
  font-weight: 500;
  border-bottom: 1px solid var(--ds-border-subtle, rgba(148, 163, 184, 0.1));
}
.history-table td {
  padding: 8px 12px;
  color: var(--ds-text-primary, #e2e8f0);
  border-bottom: 1px solid var(--ds-border-subtle, rgba(148, 163, 184, 0.05));
}
.history-table tr:last-child td { border-bottom: none; }

.history-status {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
}
.status-success {
  background: color-mix(in srgb, var(--ds-status-success, #22c55e) 15%, transparent);
  color: var(--ds-status-success, #22c55e);
}
.status-partial {
  background: color-mix(in srgb, var(--ds-status-warning, #eab308) 15%, transparent);
  color: var(--ds-status-warning, #eab308);
}
.status-failed {
  background: color-mix(in srgb, var(--ds-status-danger, #ef4444) 15%, transparent);
  color: var(--ds-status-danger, #ef4444);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
