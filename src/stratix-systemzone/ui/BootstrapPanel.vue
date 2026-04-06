<template>
  <StratixPanel>
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
      <StratixButton variant="secondary" size="sm" @click="retry">重试</StratixButton>
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
        <StratixButton
          :variant="store.bootstrapStatus.engineRunning ? 'danger' : 'success'"
          size="sm"
          @click="toggleEngine"
          :disabled="store.loading"
        >
          {{ store.bootstrapStatus.engineRunning ? '停止' : '启动' }}
        </StratixButton>

        <div class="mode-select">
          <label>模式</label>
          <select :value="store.bootstrapStatus.mode" @change="changeMode">
            <option value="manual">手动</option>
            <option value="semi_auto">半自动</option>
            <option value="full_auto">全自动</option>
          </select>
        </div>

        <StratixButton
          variant="secondary"
          size="sm"
          @click="triggerCycle"
          :disabled="store.loading || store.bootstrapStatus.engineRunning"
        >
          触发一次循环
        </StratixButton>

        <StratixButton
          variant="secondary"
          size="sm"
          @click="runCycle"
          :disabled="cyclePhase !== 'idle' || store.loading || store.bootstrapStatus.engineRunning"
        >
          {{ cyclePhase === 'idle' ? '运行完整周期' : cyclePhaseLabels[cyclePhase] }}
        </StratixButton>
      </div>

      <!-- Cycle Phase Indicator -->
      <div v-if="cyclePhase !== 'idle'" class="cycle-indicator">
        <div class="phase-track">
          <span class="phase-dot" :class="{ active: cyclePhase === 'observing' || cyclePhase === 'analyzing' || cyclePhase === 'done' }">观察</span>
          <span class="phase-line" :class="{ filled: cyclePhase === 'analyzing' || cyclePhase === 'done' }"></span>
          <span class="phase-dot" :class="{ active: cyclePhase === 'analyzing' || cyclePhase === 'done' }">分析</span>
          <span class="phase-line" :class="{ filled: cyclePhase === 'done' }"></span>
          <span class="phase-dot" :class="{ active: cyclePhase === 'done' }">完成</span>
        </div>
        <div v-if="cyclePhase === 'done'" class="cycle-timings">
          <span class="timing-total">总耗时: {{ totalCycleTime.toFixed(1) }}s</span>
          <span class="timing-detail">
            观察 {{ observeTime.toFixed(1) }}s · 分析 {{ analyzeTime.toFixed(1) }}s
          </span>
        </div>
      </div>
    </div>

    <!-- Confirm Modal for full_auto -->
    <div v-if="showConfirm" class="modal-overlay" @click.self="showConfirm = false">
      <div class="modal">
        <p class="modal-text">切换到全自动模式后，系统将自主决策并执行优化提案。</p>
        <p class="modal-text">确定要继续吗？</p>
        <div class="modal-actions">
          <StratixButton variant="success" size="sm" @click="confirmModeChange">确认</StratixButton>
          <StratixButton variant="secondary" size="sm" @click="showConfirm = false">取消</StratixButton>
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
  </StratixPanel>
</template>

<script setup lang="ts">
import { ref, computed, type Ref, onMounted } from 'vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import StratixPanel from '@/components/ui/StratixPanel.vue';
import { useSystemZoneStore } from '../../stores/systemzone';
import { usePanelState } from './composables/usePanelState';

const store = useSystemZoneStore();

const showConfirm = ref(false);
const pendingMode = ref<string | null>(null);

type CyclePhase = 'idle' | 'observing' | 'analyzing' | 'done';
const cyclePhase = ref<CyclePhase>('idle');
const cyclePhaseLabels: Record<CyclePhase, string> = {
  idle: '运行完整周期',
  observing: '观察中...',
  analyzing: '分析中...',
  done: '完成',
};
const observeTime = ref(0);
const analyzeTime = ref(0);
const totalCycleTime = ref(0);

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

async function runCycle() {
  const start = Date.now();
  cyclePhase.value = 'observing';

  const observeStart = Date.now();
  await store.triggerObserve();
  observeTime.value = (Date.now() - observeStart) / 1000;

  cyclePhase.value = 'analyzing';
  const analyzeStart = Date.now();
  await store.triggerAnalyze();
  analyzeTime.value = (Date.now() - analyzeStart) / 1000;

  totalCycleTime.value = (Date.now() - start) / 1000;
  cyclePhase.value = 'done';

  // Auto-refresh store data after cycle completes
  await Promise.all([
    store.fetchInsights(),
    store.fetchProposals(),
    store.fetchStatus(),
  ]);
}

onMounted(() => {
  store.fetchBootstrapStatus();
});
</script>

<style scoped>
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ds-border-subtle);
}

.panel-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--ds-text-primary);
}

.mode-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.mode-manual {
  background: color-mix(in srgb, var(--ds-text-muted) 15%, transparent);
  color: var(--ds-text-muted);
}
.mode-semi_auto {
  background: color-mix(in srgb, var(--ds-status-warning) 15%, transparent);
  color: var(--ds-status-warning);
}
.mode-full_auto {
  background: color-mix(in srgb, var(--ds-status-success) 15%, transparent);
  color: var(--ds-status-success);
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
  border: 2px solid var(--ds-border-subtle);
  border-top-color: var(--ds-status-info);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.error-icon { font-size: 28px; }
.error-msg { color: var(--ds-status-danger); font-size: 13px; }

/* Engine Card */
.engine-card {
  padding: 16px;
  border-bottom: 1px solid var(--ds-border-subtle);
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
  background: var(--ds-status-success);
  animation: pulse 1.5s infinite;
}
.dot-stopped { background: var(--ds-text-muted); }

.status-label {
  font-size: 14px;
  color: var(--ds-text-primary);
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
  color: var(--ds-text-primary);
  font-weight: 500;
}
.stat-value.phase {
  font-size: 11px;
  padding: 1px 6px;
  background: color-mix(in srgb, var(--ds-status-info) 15%, transparent);
  color: var(--ds-status-info);
  border-radius: 3px;
}
.stat-label {
  font-size: 11px;
  color: var(--ds-text-muted);
  margin-top: 2px;
}

/* Controls */
.controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mode-select {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mode-select label { font-size: 12px; color: var(--ds-text-secondary); }
.mode-select select {
  background: var(--ds-bg-elevated);
  border: 1px solid var(--ds-border-default);
  border-radius: var(--ds-radius-sm, 4px);
  padding: 4px 8px;
  color: var(--ds-text-primary);
  font-size: 12px;
  cursor: pointer;
}
.mode-select select:focus {
  outline: none;
  border-color: var(--ds-status-info);
}

/* Cycle Phase Indicator */
.cycle-indicator {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--ds-bg-elevated);
  border-radius: var(--ds-radius-sm, 4px);
  border: 1px solid var(--ds-border-subtle);
}

.phase-track {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.phase-dot {
  font-size: 11px;
  color: var(--ds-text-muted);
  padding: 2px 8px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--ds-text-muted) 10%, transparent);
  transition: all 0.3s;
}
.phase-dot.active {
  background: color-mix(in srgb, var(--ds-status-success) 20%, transparent);
  color: var(--ds-status-success);
}

.phase-line {
  flex: 1;
  height: 2px;
  background: var(--ds-border-subtle);
  transition: background 0.3s;
}
.phase-line.filled {
  background: var(--ds-status-success);
}

.cycle-timings {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.timing-total {
  font-size: 12px;
  font-weight: 600;
  color: var(--ds-text-primary);
}

.timing-detail {
  font-size: 11px;
  color: var(--ds-text-muted);
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--ds-bg-base) 60%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: var(--ds-bg-elevated);
  border: 1px solid var(--ds-border-default);
  border-radius: var(--ds-radius-md, 8px);
  padding: 24px;
  max-width: 360px;
}
.modal-text {
  color: var(--ds-text-primary);
  font-size: 14px;
  margin: 0 0 8px;
}
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }

/* History */
.history-section { padding: 16px; }

.section-title {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ds-text-primary);
}

.empty-history {
  text-align: center;
  color: var(--ds-text-muted);
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
  color: var(--ds-text-muted);
  font-weight: 500;
  border-bottom: 1px solid var(--ds-border-subtle);
}
.history-table td {
  padding: 8px 12px;
  color: var(--ds-text-primary);
  border-bottom: 1px solid color-mix(in srgb, var(--ds-border-subtle) 50%, transparent);
}
.history-table tr:last-child td { border-bottom: none; }

.history-status {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
}
.status-success {
  background: color-mix(in srgb, var(--ds-status-success) 15%, transparent);
  color: var(--ds-status-success);
}
.status-partial {
  background: color-mix(in srgb, var(--ds-status-warning) 15%, transparent);
  color: var(--ds-status-warning);
}
.status-failed {
  background: color-mix(in srgb, var(--ds-status-danger) 15%, transparent);
  color: var(--ds-status-danger);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
