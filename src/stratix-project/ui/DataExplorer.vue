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
        <!-- 撤销/重做按钮 -->
        <div class="history-controls">
          <button
            class="tab-button history-btn"
            :disabled="!canUndo"
            title="撤销 (Ctrl+Z)"
            @click="undo"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 7v6h6M3 13A9 9 0 1 0 6 6l-3 7" />
            </svg>
          </button>
          <button
            class="tab-button history-btn"
            :disabled="!canRedo"
            title="重做 (Ctrl+Shift+Z)"
            @click="redo"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 7v6h-6M21 13A9 9 0 1 1 18 6l3 7" />
            </svg>
          </button>
          <span v-if="historyStack.length > 0" class="history-info">
            {{ historyIndex + 1 }}/{{ historyStack.length }}
          </span>
        </div>
        <div class="tab-divider"></div>
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
            <div class="detail-actions">
              <button class="action-btn template-btn" @click="saveAsTemplate(selectedZone)" title="保存为模板">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
                保存为模板
              </button>
            </div>
          </div>

          <!-- 模板列表 -->
          <div v-if="!sidebarCollapsed" class="template-section">
            <div class="template-header" @click="showTemplateModal = !showTemplateModal">
              <span class="sidebar-title">模板库 ({{ templates.length }})</span>
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                :style="{ transform: showTemplateModal ? 'rotate(90deg)' : '' }"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
            <div v-if="showTemplateModal" class="template-list">
              <div v-if="templates.length === 0" class="template-empty">
                暂无模板
              </div>
              <div v-for="tpl in templates" :key="tpl.id" class="template-item">
                <div class="template-info" @click="createFromTemplate(tpl)" title="点击创建新 Zone">
                  <span class="template-name">{{ tpl.name }}</span>
                  <span class="template-preview">{{ tpl.title || '(无标题)' }}</span>
                </div>
                <div class="template-actions">
                  <button class="icon-btn" @click.stop="startEditTemplateName(tpl)" title="编辑名称">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button class="icon-btn delete" @click.stop="deleteTemplate(tpl.id)" title="删除模板">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
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
              @zone-batch-delete="handleZoneBatchDelete"
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
              :zone-id="selectedZone.id"
              @file-select="handleFileSelect"
              @file-delete="handleFileDelete"
              @file-refresh="handleFileRefresh"
              @file-batch-delete="handleFileBatchDelete"
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

    <!-- 模板编辑弹窗 -->
    <StratixModal
      :visible="editingTemplate !== null"
      :title="editingTemplate?.id ? '编辑模板名称' : '保存为模板'"
      width="400px"
      height="auto"
      @update:visible="showTemplateModal = false; editingTemplate = null"
    >
      <div class="template-edit-modal">
        <div class="form-group">
          <label>模板名称</label>
          <input
            v-model="templateNameInput"
            type="text"
            class="form-input"
            placeholder="请输入模板名称"
            @keyup.enter="editingTemplate?.id ? confirmEditTemplateName() : confirmSaveTemplate()"
          />
        </div>
        <div v-if="editingTemplate?.id" class="form-info">
          <label>模板内容 (不可编辑):</label>
          <div class="template-preview-box">
            <div><strong>O:</strong> {{ editingTemplate.title || '-' }}</div>
            <div><strong>KR:</strong> {{ editingTemplate.prompt || '-' }}</div>
          </div>
        </div>
        <div v-else class="form-info">
          <label>模板内容:</label>
          <div class="template-preview-box">
            <div><strong>O:</strong> {{ editingTemplate?.title || '-' }}</div>
            <div><strong>KR:</strong> {{ editingTemplate?.prompt || '-' }}</div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showTemplateModal = false; editingTemplate = null">
            取消
          </button>
          <button
            class="btn-primary"
            @click="editingTemplate?.id ? confirmEditTemplateName() : confirmSaveTemplate()"
          >
            {{ editingTemplate?.id ? '保存' : '创建' }}
          </button>
        </div>
      </div>
    </StratixModal>
  </StratixModal>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import StratixModal from '@/components/ui/StratixModal.vue';
import ZoneTable from './ZoneTable.vue';
import ZoneFileTable from './ZoneFileTable.vue';
import AgentTable from './AgentTable.vue';
import type { Zone, ZoneFile } from '../types';
import StratixEventBus from '@stratix-core/StratixEventBus';
import type { StratixStateSyncEvent } from '@stratix-core/stratix-protocol';

// ============================================
// Zone 模板类型定义
// ============================================
interface ZoneTemplate {
  id: string;
  name: string;
  title: string;      // O (Objective)
  prompt: string;     // KR (Key Results)
  createdAt: number;
}

const TEMPLATES_KEY = 'stratix_zone_templates';

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

// ============================================
// Zone 模板管理
// ============================================
const templates = ref<ZoneTemplate[]>([]);
const showTemplateModal = ref(false);
const editingTemplate = ref<ZoneTemplate | null>(null);
const templateNameInput = ref('');

// 加载模板从 localStorage
const loadTemplates = () => {
  try {
    const stored = localStorage.getItem(TEMPLATES_KEY);
    if (stored) {
      templates.value = JSON.parse(stored);
    }
  } catch (error) {
    console.error('[DataExplorer] Failed to load templates:', error);
    templates.value = [];
  }
};

// 保存模板到 localStorage
const saveTemplatesToStorage = () => {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates.value));
  } catch (error) {
    console.error('[DataExplorer] Failed to save templates:', error);
  }
};

// 生成模板 ID
const generateTemplateId = () => `tpl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

// 保存当前 Zone 为模板
const saveAsTemplate = (zone: Zone) => {
  templateNameInput.value = zone.title || '';
  editingTemplate.value = {
    id: '',
    name: zone.title || '未命名模板',
    title: zone.title,
    prompt: zone.prompt,
    createdAt: Date.now(),
  };
  showTemplateModal.value = true;
};

// 确认保存模板
const confirmSaveTemplate = () => {
  if (!editingTemplate.value) return;

  const name = templateNameInput.value.trim();
  if (!name) {
    alert('请输入模板名称');
    return;
  }

  // 检查名称是否重复
  const exists = templates.value.some(t => t.name === name);
  if (exists) {
    alert('模板名称已存在，请使用其他名称');
    return;
  }

  const newTemplate: ZoneTemplate = {
    id: generateTemplateId(),
    name,
    title: editingTemplate.value.title,
    prompt: editingTemplate.value.prompt,
    createdAt: Date.now(),
  };

  templates.value.push(newTemplate);
  saveTemplatesToStorage();
  showTemplateModal.value = false;
  editingTemplate.value = null;
  templateNameInput.value = '';

  console.log('[DataExplorer] Template saved:', newTemplate.name);
};

// 从模板创建 Zone
const createFromTemplate = async (template: ZoneTemplate) => {
  try {
    const response = await fetch('/api/zones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: template.title,
        prompt: template.prompt,
      }),
    });

    const result = await response.json();
    if (result.success) {
      await loadZones();
      console.log('[DataExplorer] Zone created from template:', template.name);
    } else {
      console.error('[DataExplorer] Failed to create zone from template:', result.error);
    }
  } catch (error) {
    console.error('[DataExplorer] Failed to create zone from template:', error);
  }
};

// 删除模板
const deleteTemplate = (templateId: string) => {
  const template = templates.value.find(t => t.id === templateId);
  if (!template) return;

  if (confirm(`确定要删除模板 "${template.name}" 吗？`)) {
    templates.value = templates.value.filter(t => t.id !== templateId);
    saveTemplatesToStorage();
    console.log('[DataExplorer] Template deleted:', template.name);
  }
};

// 编辑模板名称
const startEditTemplateName = (template: ZoneTemplate) => {
  editingTemplate.value = { ...template };
  templateNameInput.value = template.name;
};

const confirmEditTemplateName = () => {
  if (!editingTemplate.value) return;

  const newName = templateNameInput.value.trim();
  if (!newName) {
    alert('请输入模板名称');
    return;
  }

  // 检查名称是否重复（排除自己）
  const exists = templates.value.some(t => t.name === newName && t.id !== editingTemplate.value!.id);
  if (exists) {
    alert('模板名称已存在，请使用其他名称');
    return;
  }

  const template = templates.value.find(t => t.id === editingTemplate.value!.id);
  if (template) {
    template.name = newName;
    saveTemplatesToStorage();
  }

  showTemplateModal.value = false;
  editingTemplate.value = null;
  templateNameInput.value = '';
};

// ============================================
// 撤销/重做历史管理
// ============================================
const MAX_HISTORY_SIZE = 50;

interface HistoryCommand {
  id: string;
  type: 'update_zone' | 'delete_file' | 'batch_delete_files' | 'batch_delete_zones';
  description: string;
  undoData: any;
  redoData: any;
}

const historyStack = ref<HistoryCommand[]>([]);
const historyIndex = ref(-1);

const canUndo = computed(() => historyIndex.value >= 0);
const canRedo = computed(() => historyIndex.value < historyStack.value.length - 1);

const generateId = () => Math.random().toString(36).substring(2, 11);

// 添加到历史
const pushHistory = (command: Omit<HistoryCommand, 'id'>) => {
  // 如果当前索引不在栈顶，删除栈顶之后的所有条目
  if (historyIndex.value < historyStack.value.length - 1) {
    historyStack.value = historyStack.value.slice(0, historyIndex.value + 1);
  }

  const newCommand: HistoryCommand = {
    ...command,
    id: generateId(),
  };

  historyStack.value.push(newCommand);
  historyIndex.value = historyStack.value.length - 1;

  // 限制历史记录数量
  if (historyStack.value.length > MAX_HISTORY_SIZE) {
    historyStack.value.shift();
    historyIndex.value--;
  }

  console.log('[DataExplorer] History pushed:', newCommand.type, newCommand.description);
};

// 执行撤销
const undo = async () => {
  if (!canUndo.value) return;

  const command = historyStack.value[historyIndex.value];
  console.log('[DataExplorer] Undo:', command.type, command.description);

  try {
    if (command.type === 'update_zone') {
      // 撤销 Zone 更新：恢复旧数据
      await fetch(`/api/zones/${command.undoData.zoneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.undoData.oldData),
      });
    } else if (command.type === 'delete_file') {
      // 撤销文件删除：重新添加文件
      await fetch(`/api/zones/${command.undoData.zoneId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.undoData.file),
      });
    } else if (command.type === 'batch_delete_files') {
      // 撤销批量文件删除：重新添加所有文件
      for (const file of command.undoData.files) {
        await fetch(`/api/zones/${file.zoneId}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(file),
        });
      }
    } else if (command.type === 'batch_delete_zones') {
      // 撤销批量 Zone 删除：重新添加所有 Zone（仅前端模拟，因为 API 可能不支持）
      // 这里仅做前端状态恢复，不调用后端
      console.warn('[DataExplorer] Batch zone delete undo not fully supported');
    }

    historyIndex.value--;
    await loadZones();
  } catch (error) {
    console.error('[DataExplorer] Undo failed:', error);
  }
};

// 执行重做
const redo = async () => {
  if (!canRedo.value) return;

  historyIndex.value++;
  const command = historyStack.value[historyIndex.value];
  console.log('[DataExplorer] Redo:', command.type, command.description);

  try {
    if (command.type === 'update_zone') {
      // 重做 Zone 更新：应用新数据
      await fetch(`/api/zones/${command.redoData.zoneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.redoData.newData),
      });
    } else if (command.type === 'delete_file') {
      // 重做文件删除：再次删除
      await fetch(`/api/zones/${command.redoData.zoneId}/files/${command.redoData.fileId}`, {
        method: 'DELETE',
      });
    } else if (command.type === 'batch_delete_files') {
      // 重做批量文件删除
      for (const file of command.redoData.files) {
        await fetch(`/api/zones/${file.zoneId}/files/${file.id}`, {
          method: 'DELETE',
        });
      }
    } else if (command.type === 'batch_delete_zones') {
      // 重做批量 Zone 删除
      for (const zone of command.redoData.zones) {
        await fetch(`/api/zones/${zone.id}`, { method: 'DELETE' });
      }
    }

    await loadZones();
  } catch (error) {
    console.error('[DataExplorer] Redo failed:', error);
  }
};

// 键盘事件处理
const handleKeydown = (e: KeyboardEvent) => {
  // Ctrl+Z: 撤销
  if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
    e.preventDefault();
    undo();
  }
  // Ctrl+Shift+Z 或 Ctrl+Y: 重做
  if ((e.ctrlKey && e.shiftKey && e.key === 'Z') || (e.ctrlKey && e.key === 'y')) {
    e.preventDefault();
    redo();
  }
};

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

const handleZoneBatchDelete = async (zones: Zone[]) => {
  try {
    for (const zone of zones) {
      await fetch(`/api/zones/${zone.id}`, {
        method: 'DELETE',
      });
    }
    await loadZones();
  } catch (error) {
    console.error('[DataExplorer] Failed to batch delete zones:', error);
  }
};

const handleZoneUpdate = async (zone: Zone, updates: { title?: string; prompt?: string }) => {
  try {
    // 记录历史：保存旧数据用于撤销
    pushHistory({
      type: 'update_zone',
      description: `修改 Zone "${zone.title || zone.id}"`,
      undoData: {
        zoneId: zone.id,
        oldData: { title: zone.title, prompt: zone.prompt },
      },
      redoData: {
        zoneId: zone.id,
        newData: updates,
      },
    });

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
    // 记录历史：保存文件数据用于撤销
    pushHistory({
      type: 'delete_file',
      description: `删除文件 "${file.name}"`,
      undoData: {
        zoneId: file.zoneId,
        file: { ...file },
      },
      redoData: {
        zoneId: file.zoneId,
        fileId: file.id,
      },
    });

    await fetch(`/api/zones/${file.zoneId}/files/${file.id}`, {
      method: 'DELETE',
    });
    await loadZones();
  } catch (error) {
    console.error('[DataExplorer] Failed to delete file:', error);
  }
};

const handleFileBatchDelete = async (files: ZoneFile[]) => {
  try {
    // 记录历史：保存所有文件数据用于撤销
    pushHistory({
      type: 'batch_delete_files',
      description: `批量删除 ${files.length} 个文件`,
      undoData: {
        files: files.map(f => ({ ...f })),
      },
      redoData: {
        files: files.map(f => ({ zoneId: f.zoneId, id: f.id })),
      },
    });

    for (const file of files) {
      await fetch(`/api/zones/${file.zoneId}/files/${file.id}`, {
        method: 'DELETE',
      });
    }
    await loadZones();
  } catch (error) {
    console.error('[DataExplorer] Failed to batch delete files:', error);
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

// WebSocket 事件处理
const handleZoneUpdated = (event: StratixStateSyncEvent) => {
  console.log('[DataExplorer] Zone updated, refreshing...', event.payload);
  loadZones();
};

const handleZoneFileAdded = (event: StratixStateSyncEvent) => {
  console.log('[DataExplorer] Zone file added, refreshing...', event.payload);
  loadZones();
};

const handleZoneFileRemoved = (event: StratixStateSyncEvent) => {
  console.log('[DataExplorer] Zone file removed, refreshing...', event.payload);
  loadZones();
};

const handleZoneDeleted = (event: StratixStateSyncEvent) => {
  console.log('[DataExplorer] Zone deleted, refreshing...', event.payload);
  loadZones();
  // 如果删除的是当前选中的 Zone，清除选中状态
  if (selectedZone.value && event.payload?.zoneId === selectedZone.value.id) {
    selectedZone.value = null;
  }
};

// 初始化
onMounted(() => {
  loadZones();
  loadAgents();
  loadTemplates();

  // 订阅 Zone 相关 WebSocket 事件
  const eventBus = StratixEventBus.getInstance();
  eventBus.subscribe('stratix:zone_updated', handleZoneUpdated);
  eventBus.subscribe('stratix:zone_file_added', handleZoneFileAdded);
  eventBus.subscribe('stratix:zone_file_removed', handleZoneFileRemoved);
  eventBus.subscribe('stratix:zone_deleted', handleZoneDeleted);

  // 注册键盘事件
  window.addEventListener('keydown', handleKeydown);
});

// 清理
onUnmounted(() => {
  const eventBus = StratixEventBus.getInstance();
  eventBus.unsubscribe('stratix:zone_updated', handleZoneUpdated);
  eventBus.unsubscribe('stratix:zone_file_added', handleZoneFileAdded);
  eventBus.unsubscribe('stratix:zone_file_removed', handleZoneFileRemoved);
  eventBus.unsubscribe('stratix:zone_deleted', handleZoneDeleted);

  // 移除键盘事件
  window.removeEventListener('keydown', handleKeydown);
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

.history-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-right: 8px;
}

.history-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 6px;
}

.history-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.history-btn:not(:disabled):hover {
  background-color: var(--ds-bg-hover, #f3f4f6);
}

.history-info {
  font-size: 11px;
  color: var(--ds-text-tertiary, #9ca3af);
  margin-left: 4px;
  white-space: nowrap;
}

.tab-divider {
  width: 1px;
  height: 24px;
  background-color: var(--ds-border, #e5e7eb);
  margin: 0 4px;
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

.detail-actions {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ds-border, #e5e7eb);
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background-color: var(--ds-bg-hover, #f3f4f6);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--ds-text-secondary, #6b7280);
  transition: all 0.15s ease;
}

.action-btn:hover {
  background-color: var(--ds-primary, #3b82f6);
  color: white;
}

.template-section {
  border-top: 1px solid var(--ds-border, #e5e7eb);
  padding: 8px;
}

.template-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  cursor: pointer;
  border-radius: 6px;
  transition: background-color 0.15s ease;
}

.template-header:hover {
  background-color: var(--ds-bg-hover, #f3f4f6);
}

.template-list {
  margin-top: 8px;
}

.template-empty {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--ds-text-tertiary, #9ca3af);
}

.template-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  margin-bottom: 4px;
  border-radius: 6px;
  transition: background-color 0.15s ease;
}

.template-item:hover {
  background-color: var(--ds-bg-hover, #f3f4f6);
}

.template-info {
  flex: 1;
  cursor: pointer;
  overflow: hidden;
}

.template-name {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--ds-text-primary, #111827);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.template-preview {
  display: block;
  font-size: 10px;
  color: var(--ds-text-tertiary, #9ca3af);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.template-actions {
  display: flex;
  gap: 4px;
  margin-left: 8px;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ds-text-tertiary, #9ca3af);
  transition: all 0.15s ease;
}

.icon-btn:hover {
  background-color: var(--ds-bg-hover, #f3f4f6);
  color: var(--ds-text-primary, #111827);
}

.icon-btn.delete:hover {
  background-color: #fee2e2;
  color: #dc2626;
}

/* 模板编辑弹窗 */
.template-edit-modal {
  padding: 8px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--ds-text-secondary, #6b7280);
  margin-bottom: 6px;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ds-border, #e5e7eb);
  border-radius: 6px;
  font-size: 14px;
  color: var(--ds-text-primary, #111827);
  background-color: white;
  box-sizing: border-box;
}

.form-input:focus {
  outline: none;
  border-color: var(--ds-primary, #3b82f6);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-info {
  margin-bottom: 16px;
}

.form-info label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--ds-text-secondary, #6b7280);
  margin-bottom: 6px;
}

.template-preview-box {
  padding: 10px 12px;
  background-color: var(--ds-bg-secondary, #f9fafb);
  border-radius: 6px;
  font-size: 12px;
  color: var(--ds-text-primary, #111827);
}

.template-preview-box div {
  margin-bottom: 4px;
}

.template-preview-box div:last-child {
  margin-bottom: 0;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.btn-primary {
  padding: 8px 16px;
  border: none;
  background-color: var(--ds-primary, #3b82f6);
  color: white;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.btn-primary:hover {
  background-color: #2563eb;
}

.btn-secondary {
  padding: 8px 16px;
  border: 1px solid var(--ds-border, #e5e7eb);
  background-color: white;
  color: var(--ds-text-secondary, #6b7280);
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-secondary:hover {
  background-color: var(--ds-bg-hover, #f3f4f6);
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
