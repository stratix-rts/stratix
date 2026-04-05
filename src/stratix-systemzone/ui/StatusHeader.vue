<template>
  <div class="status-header">
    <div class="status-item" v-if="store.status">
      <span class="status-dot" :class="dotClass(store.status.observer.status)"></span>
      <span class="status-name">Observer</span>
      <span class="status-detail">{{ store.status.observer.totalInputs }} 输入</span>
    </div>
    <div class="status-item" v-if="store.status">
      <span class="status-dot" :class="dotClass(store.status.strategist.status)"></span>
      <span class="status-name">Strategist</span>
      <span class="status-detail">{{ store.status.strategist.pendingProposals }} 待审</span>
    </div>
    <div class="status-item" v-if="store.status">
      <span class="status-dot" :class="store.status.guardian.circuitBreakerOpen ? 'dot-error' : 'dot-ok'"></span>
      <span class="status-name">Guardian</span>
      <span class="status-detail">{{ store.status.guardian.circuitBreakerOpen ? '熔断中' : '正常' }}</span>
    </div>
    <div class="status-item" v-if="store.status">
      <span class="status-dot" :class="store.status.guardian.circuitBreakerOpen ? 'dot-error' : 'dot-ok'"></span>
      <span class="status-name">Fitness</span>
      <span class="status-detail">{{ store.fitnessReport ? store.fitnessReport.overallScore + '分' : '--' }}</span>
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
    default: return 'dot-idle';
  }
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
.dot-idle { background: var(--ds-text-muted, #6a6a8a); }
.status-name { color: var(--ds-text-primary, #ffffff); font-weight: var(--ds-typography-fontWeight-medium, 500); opacity: 0.8; }
.status-detail { color: var(--ds-text-muted, #6a6a8a); font-size: 11px; }

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
