<template>
  <div class="agent-table">
    <!-- 工具栏 -->
    <div class="agent-table-toolbar">
      <div class="toolbar-left">
        <StratixInput
          v-model="searchKeyword"
          placeholder="搜索 Agent..."
          clearable
          @update:model-value="handleSearch"
        >
          <template #prefix>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </template>
        </StratixInput>

        <!-- 状态筛选 -->
        <StratixSelect
          v-model="filterStatus"
          placeholder="状态"
          clearable
          @update:model-value="handleFilterChange"
        >
          <option value="">全部</option>
          <option value="active">🟢 在线</option>
          <option value="idle">🟡 空闲</option>
          <option value="busy">🔴 忙碌</option>
          <option value="offline">⚫ 离线</option>
        </StratixSelect>
      </div>
      <div class="toolbar-right">
        <StratixButton size="small" @click="handleRefresh">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          刷新
        </StratixButton>
      </div>
    </div>

    <!-- 表格 -->
    <vxe-grid
      ref="tableRef"
      :data="filteredAgents"
      :columns="columns"
      stripe
      border
      show-overflow
      :max-height="500"
      :sort-config="{ trigger: 'cell', remote: false, orders: ['asc', 'desc', 'null'] }"
    >
      <!-- 单元格自定义插槽 -->
      <template #nameSlot="{ row }">
        <div class="agent-name-cell">
          <span class="agent-avatar">
            {{ getAgentInitials(row.name || row.agentId) }}
          </span>
          <div class="agent-info">
            <span class="agent-name">{{ row.name || '未命名' }}</span>
            <span class="agent-id">{{ row.agentId }}</span>
          </div>
        </div>
      </template>

      <template #statusSlot="{ row }">
        <span class="agent-status" :class="row.status || 'offline'">
          {{ getStatusText(row.status) }}
        </span>
      </template>

      <template #typeSlot="{ row }">
        <span class="agent-type">{{ row.type || 'default' }}</span>
      </template>

      <template #backendSlot="{ row }">
        <span class="backend-badge">{{ row.backend || 'direct' }}</span>
      </template>

      <template #zonesSlot="{ row }">
        <span class="zones-count">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
          {{ row.zones?.length || 0 }}
        </span>
      </template>

      <template #createdAtSlot="{ row }">
        {{ formatDate(row.createdAt) }}
      </template>

      <template #actionSlot="{ row }">
        <div class="action-cell">
          <StratixButton size="tiny" variant="ghost" @click="handleView(row)">
            查看
          </StratixButton>
          <StratixButton size="tiny" variant="ghost" @click="handleEdit(row)">
            编辑
          </StratixButton>
          <StratixButton size="tiny" variant="ghost" danger @click="handleDelete(row)">
            删除
          </StratixButton>
        </div>
      </template>
    </vxe-grid>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { VxeGridInstance, VxeGridPropTypes } from 'vxe-table';
import StratixInput from '@/components/ui/StratixInput.vue';
import StratixSelect from '@/components/ui/StratixSelect.vue';
import StratixButton from '@/components/ui/StratixButton.vue';

interface Agent {
  agentId: string;
  name?: string;
  type?: string;
  status?: 'active' | 'idle' | 'busy' | 'offline';
  backend?: string;
  zones?: string[];
  config?: any;
  createdAt?: number;
  updatedAt?: number;
}

interface Props {
  agents: Agent[];
}

const props = withDefaults(defineProps<Props>(), {
  agents: () => [],
});

const emit = defineEmits<{
  refresh: [];
  'agent-select': [agent: Agent];
  'agent-edit': [agent: Agent];
  'agent-delete': [agent: Agent];
}>();

const tableRef = ref<VxeGridInstance | null>(null);
const searchKeyword = ref('');
const filterStatus = ref('');

// 列定义 - 使用 slots 属性指定插槽名称
const columns: VxeGridPropTypes.Columns = [
  { type: 'seq', width: 60, title: '#' },
  { field: 'name', title: 'Agent', width: 220, sortable: true, slots: { default: 'nameSlot' } },
  { field: 'status', title: '状态', width: 100, slots: { default: 'statusSlot' } },
  { field: 'type', title: '类型', width: 120, slots: { default: 'typeSlot' } },
  { field: 'backend', title: 'Backend', width: 100, slots: { default: 'backendSlot' } },
  { field: 'zones', title: 'Zone 数', width: 90, slots: { default: 'zonesSlot' } },
  { field: 'createdAt', title: '创建时间', width: 160, sortable: true, slots: { default: 'createdAtSlot' } },
  { field: 'action', title: '操作', width: 180, fixed: 'right', slots: { default: 'actionSlot' } },
];

// 过滤后的 Agent
const filteredAgents = computed(() => {
  let result = props.agents;

  // 按状态筛选
  if (filterStatus.value) {
    result = result.filter((agent) => agent.status === filterStatus.value);
  }

  // 按关键词搜索
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(
      (agent) =>
        agent.name?.toLowerCase().includes(keyword) ||
        agent.agentId?.toLowerCase().includes(keyword) ||
        agent.type?.toLowerCase().includes(keyword)
    );
  }

  return result;
});

// 获取状态文本
const getStatusText = (status?: string) => {
  const statusMap: Record<string, string> = {
    active: '🟢 在线',
    idle: '🟡 空闲',
    busy: '🔴 忙碌',
    offline: '⚫ 离线',
  };
  return statusMap[status || 'offline'] || '⚫ 离线';
};

// 获取 Agent 首字母
const getAgentInitials = (name: string) => {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

// 格式化日期
const formatDate = (timestamp: number | undefined) => {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// 搜索
const handleSearch = () => {
  // 搜索通过 computed 属性自动处理
};

// 筛选变化
const handleFilterChange = () => {
  // 筛选通过 computed 属性自动处理
};

// 刷新
const handleRefresh = () => {
  emit('refresh');
};

// 查看详情
const handleView = (agent: Agent) => {
  emit('agent-select', agent);
};

// 编辑
const handleEdit = (agent: Agent) => {
  emit('agent-edit', agent);
};

// 删除
const handleDelete = (agent: Agent) => {
  emit('agent-delete', agent);
};
</script>

<style scoped>
.agent-table {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agent-table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-left {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
}

.toolbar-left > * {
  min-width: 120px;
  max-width: 200px;
}

.toolbar-right {
  display: flex;
  gap: 8px;
}

.agent-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}

.agent-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agent-name {
  font-weight: 500;
}

.agent-id {
  font-size: 11px;
  color: var(--ds-text-tertiary, #9ca3af);
  font-family: monospace;
}

.agent-status {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  background-color: var(--ds-bg-secondary, #f3f4f6);
}

.agent-status.active {
  background-color: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.agent-status.idle {
  background-color: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

.agent-status.busy {
  background-color: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.agent-status.offline {
  background-color: var(--ds-bg-secondary, #f3f4f6);
  color: #6b7280;
}

.agent-type {
  color: var(--ds-text-secondary, #6b7280);
}

.backend-badge {
  display: inline-block;
  padding: 2px 6px;
  background-color: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
  border-radius: 4px;
  font-size: 11px;
  font-family: monospace;
}

.zones-count {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--ds-text-secondary, #6b7280);
}

.cell-text {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-cell {
  display: flex;
  gap: 4px;
}
</style>
