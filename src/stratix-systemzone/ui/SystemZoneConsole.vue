<template>
  <div class="sz-console">
    <!-- Header -->
    <header class="sz-header">
      <div class="header-left">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 15l-2-2h4l-2 2z" />
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v2M12 16v2M6 12h2M16 12h2" />
        </svg>
        <h1>System Zone 控制台</h1>
      </div>
      <div class="header-right">
        <button class="btn-refresh" @click="refreshAll" :disabled="store.loading">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2v6h-6M3 12a9 9 0 0115.36-6.36L21 8M3 22v-6h6M21 12a9 9 0 01-15.36 6.36L3 16" />
          </svg>
          刷新
        </button>
      </div>
    </header>

    <!-- Status Bar -->
    <StatusHeader />

    <!-- Error Banner -->
    <div v-if="store.error" class="error-banner">
      ⚠️ {{ store.error }}
    </div>

    <!-- Tabs -->
    <nav class="sz-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        <span class="tab-icon">{{ tab.icon }}</span>
        <span class="tab-label">{{ tab.label }}</span>
        <span v-if="tab.badge" class="tab-badge">{{ tab.badge }}</span>
      </button>
    </nav>

    <!-- Tab Content -->
    <main class="sz-content">
      <InsightsPanel v-if="activeTab === 'insights'" />
      <ProposalsPanel v-if="activeTab === 'proposals'" />
      <ExecutionsPanel v-if="activeTab === 'executions'" />
      <SourcesPanel v-if="activeTab === 'sources'" />
      <BootstrapPanel v-if="activeTab === 'bootstrap'" />
      <FitnessPanel v-if="activeTab === 'fitness'" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useSystemZoneStore } from '../../stores/systemzone';
import { szLog } from './logger';
import StatusHeader from './StatusHeader.vue';
import InsightsPanel from './InsightsPanel.vue';
import ProposalsPanel from './ProposalsPanel.vue';
import ExecutionsPanel from './ExecutionsPanel.vue';
import SourcesPanel from './SourcesPanel.vue';
import BootstrapPanel from './BootstrapPanel.vue';
import FitnessPanel from './FitnessPanel.vue';

const store = useSystemZoneStore();
const activeTab = ref('insights');

const tabs = computed(() => [
  { key: 'insights', icon: '💡', label: '洞察', badge: store.insightsCount || undefined },
  { key: 'proposals', icon: '📋', label: '提案', badge: store.pendingProposals.length || undefined },
  { key: 'executions', icon: '⚡', label: '执行', badge: store.activeExecutions.length || undefined },
  { key: 'sources', icon: '📡', label: '外部源' },
  { key: 'bootstrap', icon: '🔄', label: '自举引擎' },
  { key: 'fitness', icon: '📊', label: '健康' },
]);

async function refreshAll() {
  szLog.info('ui', '手动刷新');
  await store.initialize();
}

onMounted(() => {
  store.initialize();
});

onUnmounted(() => {
  store.cleanup();
});
</script>

<style scoped>
.sz-console {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--ds-bg-primary, #0f1117);
  color: var(--ds-text-primary, #e2e8f0);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  overflow: hidden;
}

/* Header */
.sz-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
  flex-shrink: 0;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.header-left h1 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}
.header-right {
  display: flex;
  gap: 8px;
}
.btn-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(148, 163, 184, 0.1);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 6px;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-refresh:hover:not(:disabled) {
  background: rgba(148, 163, 184, 0.2);
}
.btn-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Error */
.error-banner {
  padding: 8px 20px;
  background: rgba(239, 68, 68, 0.1);
  border-bottom: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
  font-size: 13px;
}

/* Tabs */
.sz-tabs {
  display: flex;
  gap: 2px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
  flex-shrink: 0;
  overflow-x: auto;
}
.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: rgba(148, 163, 184, 0.7);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.tab-btn:hover {
  color: rgba(226, 232, 240, 0.9);
  background: rgba(148, 163, 184, 0.05);
}
.tab-btn.active {
  color: #e2e8f0;
  border-bottom-color: #3b82f6;
}
.tab-icon {
  font-size: 14px;
}
.tab-badge {
  padding: 1px 6px;
  background: #3b82f6;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
  color: white;
  min-width: 18px;
  text-align: center;
}

/* Content */
.sz-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
</style>
