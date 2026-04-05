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
  gap: 24px;
  padding: 10px 20px;
  background: rgba(148, 163, 184, 0.05);
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  flex-shrink: 0;
}
.status-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot-ok { background: #22c55e; }
.dot-running { background: #3b82f6; animation: pulse 1.5s infinite; }
.dot-error { background: #ef4444; }
.dot-idle { background: #94a3b8; }
.status-name { color: rgba(226, 232, 240, 0.8); font-weight: 500; }
.status-detail { color: rgba(148, 163, 184, 0.6); font-size: 12px; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
