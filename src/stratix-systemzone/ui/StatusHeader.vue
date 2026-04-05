<template>
  <div class="status-header">
    <div class="status-item" v-if="store.status">
      <span class="status-dot" :class="observerDotClass(store.status.observer.status)"></span>
      <span class="status-name">Observer:</span>
      <span class="status-value" :class="observerTextClass(store.status.observer.status)">{{ observerStatusLabel(store.status.observer.status) }}</span>
      <span class="status-sep">·</span>
      <span class="status-detail">{{ store.status.observer.totalInputsReceived }} 输入 / {{ store.status.observer.totalInsightsGenerated }} 洞察</span>
    </div>
    <div class="status-item" v-if="store.status">
      <span class="status-dot" :class="strategistDotClass(store.status.strategist.status)"></span>
      <span class="status-name">Strategist:</span>
      <span class="status-value" :class="strategistTextClass(store.status.strategist.status)">{{ strategistStatusLabel(store.status.strategist) }}</span>
      <span class="status-sep">·</span>
      <span class="status-detail">{{ strategistLastOp(store.status.strategist) }}</span>
    </div>
    <div class="status-item" v-if="store.status">
      <span class="status-dot" :class="dotClass(String(store.status.guardian))"></span>
      <span class="status-name">Guardian</span>
      <span class="status-detail">{{ store.status.guardian }}</span>
    </div>
    <div class="status-item" v-if="store.status">
      <span class="status-dot" :class="store.fitnessReport?.passed ? 'dot-ok' : 'dot-error'"></span>
      <span class="status-name">Fitness</span>
      <span class="status-detail">{{ store.fitnessReport ? store.fitnessReport.scores.overall + '分' : '--' }}</span>
    </div>
    <div class="status-item" v-if="store.llmStatus">
      <span
        class="status-dot"
        :class="store.llmStatus.configured ? 'dot-ok' : 'dot-warning'"
        :title="store.llmStatus.configured ? `${store.llmStatus.provider} / ${store.llmStatus.model}` : 'LLM 未配置'"
      ></span>
      <span class="status-name">LLM</span>
    </div>
    <div class="status-item" v-if="!store.status">
      <span class="status-dot dot-idle"></span>
      <span class="status-name">未连接</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSystemZoneStore } from '../../stores/systemzone';

const store = useSystemZoneStore();

function dotClass(status: string): string {
  switch (status) {
    case 'running': return 'dot-running';
    case 'error': return 'dot-error';
    case 'idle': return 'dot-ok';
    case 'active': return 'dot-ok';
    default: return 'dot-idle';
  }
}

function observerDotClass(status: string): string {
  return dotClass(status);
}
function observerTextClass(status: string): string {
  switch (status) {
    case 'running': return 'text-info';
    case 'error': return 'text-danger';
    case 'idle': return 'text-muted';
    default: return 'text-muted';
  }
}
function observerStatusLabel(status: string): string {
  switch (status) {
    case 'running': return 'processing';
    case 'idle': return 'idle';
    case 'error': return 'error';
    default: return status;
  }
}

function strategistDotClass(status: string): string {
  return dotClass(status);
}
function strategistTextClass(status: string): string {
  return observerTextClass(status);
}
function strategistStatusLabel(s: { status: string; hasScanResult?: boolean }): string {
  if (s.status === 'running') return s.hasScanResult ? 'analyzing' : 'scanning';
  return s.status === 'idle' ? 'idle' : s.status;
}
function strategistLastOp(s: { lastScan: string | null; lastAnalysis: string | null }): string {
  const last = s.lastAnalysis || s.lastScan;
  if (!last) return '无操作记录';
  const d = new Date(last);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
</script>

<style scoped>
.status-header {
  display: flex;
  gap: var(--ds-spacing-lg, 24px);
  padding: 10px var(--ds-spacing-md, 16px);
  background: rgba(148, 163, 184, 0.03);
  border-bottom: 1px solid var(--ds-border-subtle, #1e1e2e);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.status-item {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-xs, 4px);
  font-size: var(--ds-typography-fontSize-sm, 12px);
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-ok { background: var(--ds-status-success, #00ff88); }
.dot-running { background: var(--ds-status-info, #00d4ff); animation: pulse 1.5s infinite; }
.dot-error { background: var(--ds-status-danger, #ff4444); }
.dot-warning { background: #ffaa00; }
.dot-idle { background: var(--ds-text-muted, #6a6a8a); }
.status-name { color: var(--ds-text-primary, #ffffff); font-weight: var(--ds-typography-fontWeight-medium, 500); opacity: 0.8; }
.status-detail { color: var(--ds-text-muted, #6a6a8a); font-size: 11px; }
.status-value { font-size: 11px; font-weight: 500; }
.status-sep { color: var(--ds-text-muted, #6a6a8a); font-size: 11px; }
.text-info { color: var(--ds-status-info, #00d4ff); }
.text-danger { color: var(--ds-status-danger, #ff4444); }
.text-muted { color: var(--ds-text-muted, #6a6a8a); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@media (max-width: 640px) {
  .status-header {
    gap: var(--ds-spacing-md, 16px);
    padding: 8px 12px;
  }
  .status-item {
    font-size: 11px;
  }
}
</style>
