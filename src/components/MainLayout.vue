<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { StratixSkillConfig } from '../stratix-core';
import type { Skill } from '../stratix-rts/ui/v2/CommandPanelV2';
import { StratixButton, StratixPanel, StratixConfirmDialog } from '@/components/ui';
import { getToken } from '@/design-system/config';
import CommandLog from '../stratix-command-panel/components/CommandLog.vue';
import { StratixEventBus, StratixFrontendOperationEvent } from '../stratix-core';
import { StratixRequestHelper } from '../stratix-core/utils';
import { useAgentStore } from '../stores/agent';
import { rtsBridge, rtsEventBus } from '../stratix-rts';
import { usePerformanceMonitor } from '@/composables/usePerformanceMonitor';

const agentStore = useAgentStore();
const { trackEvent, getReport } = usePerformanceMonitor({ threshold: 16 });

import HeroManagementModal from './HeroManagementModal.vue';
import LogPanelModal from './LogPanelModal.vue';
import StatusPanelModal from './StatusPanelModal.vue';
import AgentDashboard from './AgentDashboard.vue';
import ParamFormModal from './ParamFormModal.vue';
import TaskPanel from './TaskPanel.vue';
import WorkflowEditorModal from './WorkflowEditorModal.vue';

const props = defineProps<{
  gameContainer: HTMLElement | null;
  isGameReady: boolean;
  commandLogs: any[];
  isRefreshing?: boolean;
  showTaskModal?: boolean;
  selectedProjectId?: string | null;
  selectedProjectPath?: string | null;
}>();

const emit = defineEmits<{
  (e: 'create-agent', type: 'writer' | 'dev' | 'analyst'): void;
  (e: 'delete-agent', agentId: string): void;
  (e: 'select-agent', agentId: string): void;
  (e: 'open-character-creator'): void;
  (e: 'refresh-agents'): void;
  (e: 'update:show-task-modal', value: boolean): void;
  (e: 'open-data-explorer'): void;
}>();

const showHeroModal = ref(false);
const showLogModal = ref(false);
const showStatusModal = ref(false);
const showAgentDashboard = ref(false);
const showParamFormModal = ref(false);
const showWorkflowEditor = ref(false);

const selectedSkill = ref<StratixSkillConfig | null>(null);
const paramValues = ref<Record<string, any>>({});
const eventBus = StratixEventBus.getInstance();
const requestHelper = StratixRequestHelper.getInstance();

const agents = computed(() => agentStore.agents);
const selectedAgentIds = computed(() => agentStore.selectedIds);
const selectedAgents = computed(() => agentStore.selectedAgents);
const agentCount = computed(() => agentStore.agentCount);

const handleOpenHeroModal = () => {
  showHeroModal.value = true;
};

const handleOpenLogModal = () => {
  showLogModal.value = true;
};

const handleOpenStatusModal = () => {
  showStatusModal.value = true;
};

const handleOpenAgentDashboard = () => {
  showAgentDashboard.value = true;
};

const handleOpenWorkflowEditor = () => {
  showWorkflowEditor.value = true;
};

const handleOpenTaskModal = (projectId: string, projectPath: string) => {
  selectedProjectId.value = projectId;
  selectedProjectPath.value = projectPath;
  showTaskModal.value = true;
};

const handleExecuteSkill = (skill: StratixSkillConfig | Skill) => {
  return trackEvent('handleExecuteSkill', () => {
    if (selectedAgentIds.value.length === 0) return;

    const parameters = 'parameters' in skill ? skill.parameters : undefined;
    const needsParams = parameters && parameters.length > 0;

    if (!needsParams) {
      executeCommand(skill as StratixSkillConfig, {});
    } else {
      selectedSkill.value = skill as StratixSkillConfig;
      paramValues.value = {};
      parameters.forEach(p => {
        paramValues.value[p.paramId] = p.defaultValue;
      });
      showParamFormModal.value = true;
    }
  });
};

const executeCommand = (skill: StratixSkillConfig, params: Record<string, any>) => {
  return trackEvent('executeCommand', () => {
    const event: StratixFrontendOperationEvent = {
      eventType: 'stratix:command_execute',
      payload: {
        agentIds: selectedAgentIds.value,
        skill: skill,
        command: {
          commandId: requestHelper.generateRequestId().replace('req', 'cmd'),
          skillId: skill.skillId,
          agentId: selectedAgentIds.value[0],
          params: { ...params },
          executeAt: Date.now()
        }
      },
      timestamp: Date.now(),
      requestId: requestHelper.generateRequestId()
    };

    eventBus.emit(event);
    showParamFormModal.value = false;
    selectedSkill.value = null;
  });
};

const handleExecuteCommand = () => {
  if (!selectedSkill.value) return;
  executeCommand(selectedSkill.value, paramValues.value);
};

const handleCancelCommand = () => {
  showParamFormModal.value = false;
  selectedSkill.value = null;
};

const unsubscribeSkillSelected = rtsBridge.onSkillSelected((data) => {
  handleExecuteSkill(data.skill);
});

const showDeleteZoneConfirm = ref(false);
const pendingDeleteZoneIds = ref<string[]>([]);

const unsubscribeZoneDeleteConfirm = rtsEventBus.on('vue:game:confirm_delete_zones' as any, (data: { zoneIds: string[] }) => {
  pendingDeleteZoneIds.value = data.zoneIds;
  showDeleteZoneConfirm.value = true;
});

const handleConfirmDeleteZones = () => {
  rtsEventBus.emit('vue:game:zone_delete_confirmed' as any, {
    zoneIds: pendingDeleteZoneIds.value
  });
  showDeleteZoneConfirm.value = false;
  pendingDeleteZoneIds.value = [];
};

const handleCancelDeleteZones = () => {
  showDeleteZoneConfirm.value = false;
  pendingDeleteZoneIds.value = [];
};

onUnmounted(() => {
  unsubscribeSkillSelected();
  unsubscribeZoneDeleteConfirm();
});

// Icons - 直接使用 SVG 路径数据
const icons = {
  star: 'M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  'file-text': 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z M14 2v6h6',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  'database': 'M12 2C6.48 2 2 4.69 2 7v10c0 2.31 4.48 5 10 5s10-2.69 10-5V7c0-2.31-4.48-5-10-5zm0 18c-4.42 0-8-2.24-8-5s3.58-5 8-5 8 2.24 8 5-3.58 5-8 5z',
} as const;
</script>

<template>
  <div class="main-layout">
    <header class="header">
      <div class="logo">
        <svg class="logo-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
          <path :d="icons.star" />
        </svg>
        <span class="logo-text">Stratix 星策系统</span>
      </div>
      
      <div class="toolbar">
        <StratixButton 
          variant="secondary"
          @click="handleOpenHeroModal"
          title="英雄管理"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path :d="icons.users" />
          </svg>
          <span>英雄</span>
          <span v-if="agentCount > 0" class="btn-badge">{{ agentCount }}</span>
        </StratixButton>
        
        <StratixButton 
          variant="secondary"
          @click="handleOpenLogModal"
          title="日志"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path :d="icons['file-text']" />
          </svg>
          <span>日志</span>
        </StratixButton>
        
        <StratixButton
          variant="secondary"
          @click="handleOpenStatusModal"
          title="状态"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path :d="icons.activity" />
          </svg>
          <span>状态</span>
        </StratixButton>

        <StratixButton
          variant="secondary"
          @click="handleOpenAgentDashboard"
          title="Agent 监控"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span>监控</span>
        </StratixButton>

        <StratixButton
          variant="secondary"
          @click="emit('open-data-explorer')"
          title="数据浏览器 (Ctrl+D)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path :d="icons.database" />
          </svg>
          <span>数据</span>
        </StratixButton>

        <StratixButton
          variant="secondary"
          @click="handleOpenWorkflowEditor"
          title="工作流编辑器"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
          </svg>
          <span>工作流</span>
        </StratixButton>
      </div>
      
      <div class="header-info">
        <span class="status" :class="{ ready: isGameReady }">
          {{ isGameReady ? '● 系统就绪' : '○ 加载中...' }}
        </span>
      </div>
    </header>
    
    <main class="main-content">
      <section class="game-area">
        <slot name="game"></slot>
      </section>
    </main>
    
    <HeroManagementModal
      v-model:visible="showHeroModal"
      :selected-ids="selectedAgentIds"
      :is-refreshing="isRefreshing"
      @create="emit('create-agent', $event)"
      @delete="emit('delete-agent', $event)"
      @select="emit('select-agent', $event)"
      @open-character-creator="emit('open-character-creator')"
      @refresh="emit('refresh-agents')"
    />
    
    <LogPanelModal
      v-model:visible="showLogModal"
      :logs="commandLogs"
    />
    
    <StatusPanelModal
      v-model:visible="showStatusModal"
      :selected-agents="selectedAgents"
      :agent-count="agentCount"
      :is-game-ready="isGameReady"
    />

    <AgentDashboard
      v-model:visible="showAgentDashboard"
    />
    
    <ParamFormModal
      v-model:visible="showParamFormModal"
      :skill="selectedSkill"
      :param-values="paramValues"
      @execute="handleExecuteCommand"
      @cancel="handleCancelCommand"
      @update:param-values="paramValues = $event"
    />
    
    <TaskPanel
      :visible="showTaskModal || false"
      :project-id="selectedProjectId || null"
      :project-path="selectedProjectPath || null"
      @update:visible="$emit('update:show-task-modal', $event)"
    />
    
    <StratixConfirmDialog
      v-model:visible="showDeleteZoneConfirm"
      type="warning"
      title="确认删除"
      :content="`确定要删除 ${pendingDeleteZoneIds.length} 个任务区吗？此操作不可撤销。`"
      ok-text="删除"
      ok-danger
      @ok="handleConfirmDeleteZones"
      @cancel="handleCancelDeleteZones"
    />

    <WorkflowEditorModal
      v-model:visible="showWorkflowEditor"
      @workflowChange="(def) => console.log('Workflow changed:', def)"
      @execute="(status, def) => console.log('Workflow execute:', status, def)"
    />
  </div>
</template>

<style scoped>
.main-layout {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ds-bg-primary);
}

.header {
  height: 56px;
  background: var(--ds-bg-secondary);
  border-bottom: 1px solid var(--ds-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  gap: 20px;
}

/* Responsive: narrow screens */
@media (max-width: 1024px) {
  .header {
    padding: 0 12px;
    gap: 12px;
  }

  .logo-text {
    display: none;
  }

  .toolbar :deep(.stratix-button span:not(.btn-badge)) {
    display: none;
  }

  .toolbar :deep(.stratix-button) {
    padding: 8px;
    min-width: auto;
  }

  .toolbar :deep(.stratix-button svg) {
    margin: 0;
  }

  .status {
    font-size: 12px;
  }
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.logo-icon {
  color: var(--ds-brand-primary);
}

.logo-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--ds-text-primary);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  justify-content: center;
}

.btn-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  background: linear-gradient(135deg, var(--ds-info), var(--ds-success));
  color: var(--ds-bg-primary);
  font-size: 11px;
  font-weight: 600;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.header-info {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-shrink: 0;
}

.status {
  font-size: 14px;
  color: var(--ds-text-muted);
}

.status.ready {
  color: var(--ds-success);
}

.main-content {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.game-area {
  width: 100%;
  height: 100%;
  position: relative;
}
</style>
