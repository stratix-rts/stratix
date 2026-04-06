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
        <StratixButton variant="secondary" size="sm" :disabled="store.loading" icon="refresh" @click="refreshAll">
          刷新
        </StratixButton>
      </div>
    </header>

    <!-- Status Bar -->
    <StatusHeader />

    <!-- Error Banner -->
    <div v-if="store.error" class="error-banner">
      <span class="error-icon">⚠️</span>
      <span class="error-msg">{{ store.error }}</span>
      <button class="error-retry" @click="refreshAll">重试</button>
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
      <LLMConfigPanel v-if="activeTab === 'llm'" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useSystemZoneStore } from '../../stores/systemzone';
import { szLog } from './logger';
import StratixButton from '@/components/ui/StratixButton.vue';
import StatusHeader from './StatusHeader.vue';
import InsightsPanel from './InsightsPanel.vue';
import ProposalsPanel from './ProposalsPanel.vue';
import ExecutionsPanel from './ExecutionsPanel.vue';
import SourcesPanel from './SourcesPanel.vue';
import BootstrapPanel from './BootstrapPanel.vue';
import FitnessPanel from './FitnessPanel.vue';
import LLMConfigPanel from './LLMConfigPanel.vue';

const store = useSystemZoneStore();
const activeTab = ref('insights');

const tabs = computed(() => [
  { key: 'insights', icon: '💡', label: '洞察', badge: store.insightsCount || undefined },
  { key: 'proposals', icon: '📋', label: '提案', badge: store.pendingProposals.length || undefined },
  { key: 'executions', icon: '⚡', label: '执行', badge: store.activeExecutions.length || undefined },
  { key: 'sources', icon: '📡', label: '外部源' },
  { key: 'bootstrap', icon: '🔄', label: '自举引擎' },
  { key: 'fitness', icon: '📊', label: '健康' },
  { key: 'llm', icon: '🤖', label: 'LLM 配置' },
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
  background: var(--ds-bg-base);
  color: var(--ds-text-primary);
  font-family: var(--ds-typography-fontFamily-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
  overflow: hidden;
}

/* Header */
.sz-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ds-spacing-xs, 4px) * 3 var(--ds-spacing-md, 16px);
  border-bottom: 1px solid var(--ds-border-default);
  flex-shrink: 0;
}
.header-left {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm, 8px);
}
.header-left h1 {
  font-size: var(--ds-typography-fontSize-lg, 16px);
  font-weight: var(--ds-typography-fontWeight-semibold, 600);
  margin: 0;
}
.header-right {
  display: flex;
  gap: var(--ds-spacing-sm, 8px);
}

/* Error Banner */
.error-banner {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm, 8px);
  padding: 8px var(--ds-spacing-md, 16px);
  background: color-mix(in srgb, var(--ds-status-danger) 10%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--ds-status-danger) 30%, transparent);
  color: var(--ds-status-danger);
  font-size: var(--ds-typography-fontSize-sm, 12px);
}
.error-icon { flex-shrink: 0; }
.error-msg { flex: 1; }
.error-retry {
  padding: 2px 10px;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--ds-status-danger) 30%, transparent);
  border-radius: var(--ds-radius-sm, 2px);
  color: var(--ds-status-danger);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}
.error-retry:hover { background: color-mix(in srgb, var(--ds-status-danger) 15%, transparent); }

/* Tabs */
.sz-tabs {
  display: flex;
  gap: 2px;
  padding: 0 var(--ds-spacing-md, 16px);
  border-bottom: 1px solid var(--ds-border-subtle);
  flex-shrink: 0;
  overflow-x: auto;
}
.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px var(--ds-spacing-md, 16px);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--ds-text-secondary);
  font-size: var(--ds-typography-fontSize-sm, 12px);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.tab-btn:hover {
  color: var(--ds-text-primary);
  background: color-mix(in srgb, var(--ds-text-secondary) 5%, transparent);
}
.tab-btn.active {
  color: var(--ds-text-primary);
  border-bottom-color: var(--ds-color-primary);
}
.tab-icon {
  font-size: 14px;
}
.tab-badge {
  padding: 1px 6px;
  background: var(--ds-color-primary);
  border-radius: 8px;
  font-size: 11px;
  font-weight: var(--ds-typography-fontWeight-semibold, 600);
  color: var(--ds-bg-base);
  min-width: 18px;
  text-align: center;
}

/* Content */
.sz-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--ds-spacing-md, 16px);
}

/* Responsive */
@media (max-width: 640px) {
  .sz-header {
    padding: 8px 12px;
  }
  .header-left h1 {
    font-size: 14px;
  }
  .sz-tabs {
    padding: 0 8px;
  }
  .tab-btn {
    padding: 8px 10px;
    font-size: 12px;
  }
  .tab-label {
    display: none;
  }
  .sz-content {
    padding: 12px 8px;
  }
}
</style>
