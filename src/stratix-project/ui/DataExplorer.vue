<template>
  <StratixModal
    :visible="visible"
    title="数据浏览器"
    width="90vw"
    height="80vh"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="data-explorer">
      <!-- Tab 导航 -->
      <div class="explorer-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab-button"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <span class="tab-icon">{{ tab.icon }}</span>
          <span class="tab-label">{{ tab.label }}</span>
        </button>
      </div>

      <!-- 内容区域 -->
      <div class="explorer-content">
        <!-- 左侧边栏 - Zone 选择器 -->
        <aside class="explorer-sidebar" :class="{ collapsed: sidebarCollapsed }">
          <div class="sidebar-header">
            <span class="sidebar-title">{{ sidebarCollapsed ? '' : 'Zone 列表' }}</span>
            <button class="collapse-btn" @click="sidebarCollapsed = !sidebarCollapsed">
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                :style="{ transform: sidebarCollapsed ? 'rotate(180deg)' : '' }"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>

          <div v-if="!sidebarCollapsed" class="zone-list">
            <div
              v-for="zone in zones"
              :key="zone.id"
              class="zone-item"
              :class="{ selected: selectedZone?.id === zone.id }"
              @click="selectZone(zone)"
            >
              <span class="zone-name">{{ zone.title || '(未命名)' }}</span>
              <span class="zone-stats">
                📄 {{ zone.files?.length || 0 }} · 👤 {{ zone.members?.length || 0 }}
              </span>
            </div>

            <div v-if="zones.length === 0" class="empty-state">
              <span>暂无 Zone</span>
            </div>
          </div>

          <!-- 选中 Zone 详情 -->
          <div v-if="!sidebarCollapsed && selectedZone" class="zone-detail">
            <h4 class="detail-title">Zone 详情</h4>
            <div class="detail-item">
              <label>O (目标):</label>
              <span>{{ selectedZone.title || '-' }}</span>
            </div>
            <div class="detail-item">
              <label>KR (关键结果):</label>
              <span class="prompt-text">{{ selectedZone.prompt || '-' }}</span>
            </div>
            <div class="detail-item">
              <label>成员:</label>
              <span>{{ selectedZone.members?.length || 0 }} 个 Agent</span>
            </div>
            <div class="detail-item">
              <label>文件:</label>
              <span>{{ selectedZone.files?.length || 0 }} 个文件</span>
            </div>
          </div>
        </aside>

        <!-- 主内容区 -->
        <main class="explorer-main">
          <!-- Zone 概览 Tab -->
          <template v-if="activeTab === 'zones'">
            <ZoneTable
              :zones="zones"
              @zone-select="handleZoneSelect"
              @zone-edit="handleZoneEdit"
              @zone-delete="handleZoneDelete"
              @zone-update="handleZoneUpdate"
              @refresh="loadZones"
            />
          </template>

          <!-- 文件 Tab -->
          <template v-else-if="activeTab === 'files'">
            <div v-if="selectedZone" class="files-header">
              <h3>{{ selectedZone.title || 'Zone' }} - 文件列表</h3>
            </div>
            <ZoneFileTable
              v-if="selectedZone"
              :files="selectedZone.files || []"
              :zone-name="selectedZone.title"
              @file-select="handleFileSelect"
              @file-delete="handleFileDelete"
              @file-refresh="handleFileRefresh"
              @refresh="loadZones"
            />
            <div v-else class="empty-state">
              <span>请先选择一个 Zone</span>
            </div>
          </template>

          <!-- Agents Tab -->
          <template v-else-if="activeTab === 'agents'">
            <AgentTable
              :agents="agents"
              @agent-select="handleAgentSelect"
              @agent-edit="handleAgentEdit"
              @agent-delete="handleAgentDelete"
              @refresh="loadAgents"
            />
          </template>
        </main>
      </div>
    </div>
  </StratixModal>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import StratixModal from '@/components/ui/StratixModal.vue';
import ZoneTable from './ZoneTable.vue';
import ZoneFileTable from './ZoneFileTable.vue';
import AgentTable from './AgentTable.vue';
import type { Zone, ZoneFile } from '../types';

interface Props {
  visible: boolean;
  projectId?: string;
  /** 初始选中的 Zone ID（从 Zone 面板打开时传入） */
  initialZoneId?: string;
}

const props = withDefaults(defineProps<Props>(), {
  projectId: '',
  initialZoneId: undefined,
});

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'zone-select': [zone: Zone];
  'zone-edit': [zone: Zone];
  'zone-delete': [zone: Zone];
  'zone-update': [zone: Zone, updates: { title?: string; prompt?: string }];
  'file-select': [file: ZoneFile];
  'file-delete': [file: ZoneFile];
  'file-refresh': [file: ZoneFile];
  'agent-select': [agent: any];
  'agent-edit': [agent: any];
  'agent-delete': [agent: any];
}>();

// Tab 配置
const tabs = [
  { id: 'zones', label: 'Zone 概览', icon: '🎯' },
  { id: 'files', label: '文件', icon: '📁' },
  { id: 'agents', label: 'Agents', icon: '🤖' },
];

const activeTab = ref('zones');
const sidebarCollapsed = ref(false);

// 数据
const zones = ref<Zone[]>([]);
const agents = ref<any[]>([]);
const selectedZone = ref<Zone | null>(null);

// 加载 Zones
const loadZones = async () => {
  try {
    const projectId = props.projectId || 'default';
    const response = await fetch(`/api/zones`);
    const result = await response.json();
    if (result.success) {
      zones.value = result.zones || [];
    }
  } catch (error) {
    console.error('[DataExplorer] Failed to load zones:', error);
  }
};

// 加载 Agents
const loadAgents = async () => {
  try {
    const response = await fetch('/api/stratix/config/agent');
    const result = await response.json();
    if (result.success) {
      agents.value = result.data || [];
    }
  } catch (error) {
    console.error('[DataExplorer] Failed to load agents:', error);
  }
};

// 选择 Zone
const selectZone = (zone: Zone) => {
  selectedZone.value = zone;
  emit('zone-select', zone);
};

// Event Handlers
const handleZoneSelect = (zone: Zone) => {
  selectedZone.value = zone;
  emit('zone-select', zone);
};

const handleZoneEdit = (zone: Zone) => {
  emit('zone-edit', zone);
};

const handleZoneDelete = async (zone: Zone) => {
  try {
    await fetch(`/api/zones/${zone.id}`, {
      method: 'DELETE',
    });
    await loadZones();
  } catch (error) {
    console.error('[DataExplorer] Failed to delete zone:', error);
  }
};

const handleZoneUpdate = async (zone: Zone, updates: { title?: string; prompt?: string }) => {
  try {
    await fetch(`/api/zones/${zone.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    await loadZones();
  } catch (error) {
    console.error('[DataExplorer] Failed to update zone:', error);
  }
};

const handleFileSelect = (file: ZoneFile) => {
  emit('file-select', file);
};

const handleFileDelete = async (file: ZoneFile) => {
  try {
    await fetch(`/api/zones/${file.zoneId}/files/${file.id}`, {
      method: 'DELETE',
    });
    await loadZones();
  } catch (error) {
    console.error('[DataExplorer] Failed to delete file:', error);
  }
};

const handleFileRefresh = async (file: ZoneFile) => {
  try {
    await fetch(`/api/zones/${file.zoneId}/files/${file.id}/refresh`, {
      method: 'POST',
    });
    await loadZones();
  } catch (error) {
    console.error('[DataExplorer] Failed to refresh file:', error);
  }
};

const handleAgentSelect = (agent: any) => {
  emit('agent-select', agent);
};

const handleAgentEdit = (agent: any) => {
  emit('agent-edit', agent);
};

const handleAgentDelete = async (agent: any) => {
  try {
    await fetch(`/api/stratix/config/agent/${agent.agentId}`, {
      method: 'DELETE',
    });
    await loadAgents();
  } catch (error) {
    console.error('[DataExplorer] Failed to delete agent:', error);
  }
};

// 监听 visible 变化
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      // 打开时加载数据
      loadZones();
      loadAgents();
    }
  }
);

// 监听 zones 加载完成后，自动选中 initialZoneId 对应的 Zone
watch(
  () => zones.value,
  (newZones) => {
    if (props.initialZoneId && newZones.length > 0) {
      const targetZone = newZones.find(z => z.id === props.initialZoneId);
      if (targetZone) {
        selectZone(targetZone);
        activeTab.value = 'files'; // 自动切换到文件 Tab
      }
    }
  },
  { immediate: true }
);

// 初始化
onMounted(() => {
  loadZones();
  loadAgents();
});
</script>

<style scoped>
.data-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 500px;
}

.explorer-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ds-border, #e5e7eb);
  background-color: var(--ds-bg-secondary, #f9fafb);
}

.tab-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--ds-text-secondary, #6b7280);
  transition: all 0.15s ease;
}

.tab-button:hover {
  background-color: var(--ds-bg-hover, #f3f4f6);
  color: var(--ds-text-primary, #111827);
}

.tab-button.active {
  background-color: var(--ds-primary, #3b82f6);
  color: white;
}

.tab-icon {
  font-size: 14px;
}

.explorer-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.explorer-sidebar {
  display: flex;
  flex-direction: column;
  width: 260px;
  min-width: 200px;
  border-right: 1px solid var(--ds-border, #e5e7eb);
  background-color: var(--ds-bg-secondary, #f9fafb);
  transition: width 0.2s ease;
}

.explorer-sidebar.collapsed {
  width: 48px;
  min-width: 48px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--ds-border, #e5e7eb);
}

.sidebar-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ds-text-primary, #111827);
}

.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ds-text-secondary, #6b7280);
  transition: all 0.15s ease;
}

.collapse-btn:hover {
  background-color: var(--ds-bg-hover, #f3f4f6);
}

.zone-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.zone-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  margin-bottom: 4px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.zone-item:hover {
  background-color: var(--ds-bg-hover, #f3f4f6);
}

.zone-item.selected {
  background-color: rgba(59, 130, 246, 0.1);
  border-left: 3px solid var(--ds-primary, #3b82f6);
}

.zone-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--ds-text-primary, #111827);
}

.zone-stats {
  font-size: 11px;
  color: var(--ds-text-tertiary, #9ca3af);
}

.zone-detail {
  padding: 12px;
  border-top: 1px solid var(--ds-border, #e5e7eb);
}

.detail-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ds-text-secondary, #6b7280);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}

.detail-item label {
  font-size: 11px;
  color: var(--ds-text-tertiary, #9ca3af);
}

.detail-item span {
  font-size: 12px;
  color: var(--ds-text-primary, #111827);
}

.prompt-text {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 11px;
  color: var(--ds-text-secondary, #6b7280);
}

.explorer-main {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
}

.files-header {
  margin-bottom: 12px;
}

.files-header h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--ds-text-primary, #111827);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--ds-text-tertiary, #9ca3af);
  font-size: 14px;
}
</style>
