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
        <button
          class="tab-button history-btn"
          title="快捷键帮助 (F1)"
          @click="showShortcutHelp = true"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>
        <div class="tab-divider"></div>
        <div class="tab-items">
          <div class="tab-indicator" :style="tabIndicatorStyle"></div>
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
              <div class="zone-glow" v-if="selectedZone?.id === zone.id"></div>
              <div class="zone-content">
                <span class="zone-name">{{ zone.title || '(未命名)' }}</span>
                <span class="zone-stats">
                  📄 {{ zone.files?.length || 0 }} · 👤 {{ zone.members?.length || 0 }}
                </span>
              </div>
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
            <Transition name="template-expand">
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
            </Transition>
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
              @file-update="handleFileUpdate"
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

    <!-- 快捷键帮助弹窗 -->
    <StratixModal
      :visible="showShortcutHelp"
      title="快捷键帮助"
      width="500px"
      @update:visible="showShortcutHelp = false"
    >
      <div class="shortcut-help">
        <div class="shortcut-section">
          <h4>全局</h4>
          <div class="shortcut-item">
            <kbd>Ctrl</kbd> + <kbd>D</kbd>
            <span>打开数据浏览器</span>
          </div>
        </div>
        <div class="shortcut-section">
          <h4>表格导航</h4>
          <div class="shortcut-item">
            <kbd>↑</kbd> <kbd>↓</kbd>
            <span>行间移动</span>
          </div>
          <div class="shortcut-item">
            <kbd>Tab</kbd>
            <span>切换单元格</span>
          </div>
          <div class="shortcut-item">
            <kbd>Enter</kbd>
            <span>进入编辑 / 确认</span>
          </div>
          <div class="shortcut-item">
            <kbd>Esc</kbd>
            <span>取消编辑 / 关闭弹窗</span>
          </div>
          <div class="shortcut-item">
            <kbd>F2</kbd>
            <span>快速编辑</span>
          </div>
        </div>
        <div class="shortcut-section">
          <h4>撤销/重做</h4>
          <div class="shortcut-item">
            <kbd>Ctrl</kbd> + <kbd>Z</kbd>
            <span>撤销</span>
          </div>
          <div class="shortcut-item">
            <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd>
            <span>重做</span>
          </div>
        </div>
      </div>
    </StratixModal>
  </StratixModal>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, defineAsyncComponent } from 'vue';
import StratixModal from '@/components/ui/StratixModal.vue';
import ZoneTable from './ZoneTable.vue';
import type { Zone, ZoneFile } from '../types';
import StratixEventBus from '@stratix-core/StratixEventBus';
import type { StratixStateSyncEvent } from '@stratix-core/stratix-protocol';

const ZoneFileTable = defineAsyncComponent(() => import('./ZoneFileTable.vue'));
const AgentTable = defineAsyncComponent(() => import('./AgentTable.vue'));

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

// Tab indicator position
const tabIndicatorStyle = computed(() => {
  const index = tabs.findIndex(t => t.id === activeTab.value);
  return {
    left: `${index * (100 / tabs.length)}%`,
    width: `${100 / tabs.length}%`,
  };
});

// ============================================
// Zone 模板管理
// ============================================
const templates = ref<ZoneTemplate[]>([]);
const showTemplateModal = ref(false);
const showShortcutHelp = ref(false);
const editingTemplate = ref<ZoneTemplate | null>(null);
const templateNameInput = ref('');

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

const saveTemplatesToStorage = () => {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates.value));
  } catch (error) {
    console.error('[DataExplorer] Failed to save templates:', error);
  }
};

const generateTemplateId = () => `tpl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

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

const confirmSaveTemplate = () => {
  if (!editingTemplate.value) return;

  const name = templateNameInput.value.trim();
  if (!name) {
    alert('请输入模板名称');
    return;
  }

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

const deleteTemplate = (templateId: string) => {
  const template = templates.value.find(t => t.id === templateId);
  if (!template) return;

  if (confirm(`确定要删除模板 "${template.name}" 吗？`)) {
    templates.value = templates.value.filter(t => t.id !== templateId);
    saveTemplatesToStorage();
    console.log('[DataExplorer] Template deleted:', template.name);
  }
};

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

const pushHistory = (command: Omit<HistoryCommand, 'id'>) => {
  if (historyIndex.value < historyStack.value.length - 1) {
    historyStack.value = historyStack.value.slice(0, historyIndex.value + 1);
  }

  const newCommand: HistoryCommand = {
    ...command,
    id: generateId(),
  };

  historyStack.value.push(newCommand);
  historyIndex.value = historyStack.value.length - 1;

  if (historyStack.value.length > MAX_HISTORY_SIZE) {
    historyStack.value.shift();
    historyIndex.value--;
  }

  console.log('[DataExplorer] History pushed:', newCommand.type, newCommand.description);
};

const undo = async () => {
  if (!canUndo.value) return;

  const command = historyStack.value[historyIndex.value];
  console.log('[DataExplorer] Undo:', command.type, command.description);

  try {
    if (command.type === 'update_zone') {
      await fetch(`/api/zones/${command.undoData.zoneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.undoData.oldData),
      });
    } else if (command.type === 'delete_file') {
      await fetch(`/api/zones/${command.undoData.zoneId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.undoData.file),
      });
    } else if (command.type === 'batch_delete_files') {
      for (const file of command.undoData.files) {
        await fetch(`/api/zones/${file.zoneId}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(file),
        });
      }
    } else if (command.type === 'batch_delete_zones') {
      console.warn('[DataExplorer] Batch zone delete undo not fully supported');
    }

    historyIndex.value--;
    await loadZones();
  } catch (error) {
    console.error('[DataExplorer] Undo failed:', error);
  }
};

const redo = async () => {
  if (!canRedo.value) return;

  historyIndex.value++;
  const command = historyStack.value[historyIndex.value];
  console.log('[DataExplorer] Redo:', command.type, command.description);

  try {
    if (command.type === 'update_zone') {
      await fetch(`/api/zones/${command.redoData.zoneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.redoData.newData),
      });
    } else if (command.type === 'delete_file') {
      await fetch(`/api/zones/${command.redoData.zoneId}/files/${command.redoData.fileId}`, {
        method: 'DELETE',
      });
    } else if (command.type === 'batch_delete_files') {
      for (const file of command.redoData.files) {
        await fetch(`/api/zones/${file.zoneId}/files/${file.id}`, {
          method: 'DELETE',
        });
      }
    } else if (command.type === 'batch_delete_zones') {
      for (const zone of command.redoData.zones) {
        await fetch(`/api/zones/${zone.id}`, { method: 'DELETE' });
      }
    }

    await loadZones();
  } catch (error) {
    console.error('[DataExplorer] Redo failed:', error);
  }
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'F1' || (e.key === '?' && !e.ctrlKey && !e.altKey)) {
    e.preventDefault();
    showShortcutHelp.value = true;
    return;
  }
  if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
    e.preventDefault();
    undo();
  }
  if ((e.ctrlKey && e.shiftKey && e.key === 'Z') || (e.ctrlKey && e.key === 'y')) {
    e.preventDefault();
    redo();
  }
};

// 数据
const zones = ref<Zone[]>([]);
const agents = ref<any[]>([]);
const selectedZone = ref<Zone | null>(null);

const loadZones = async () => {
  try {
    const projectId = props.projectId || props.initialZoneId || 'default';
    const response = await fetch(`/api/zones?projectId=${encodeURIComponent(projectId)}`);
    if (!response.ok) {
      console.warn('[DataExplorer] loadZones failed with status:', response.status);
      return;
    }
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.warn('[DataExplorer] loadZones received non-JSON response');
      return;
    }
    const text = await response.text();
    if (!text.trim()) {
      console.warn('[DataExplorer] loadZones received empty response');
      return;
    }
    const result = JSON.parse(text);
    if (result.success) {
      zones.value = result.zones || [];
    }
  } catch (error) {
    console.error('[DataExplorer] Failed to load zones:', error);
  }
};

const loadAgents = async () => {
  try {
    const response = await fetch('/api/stratix/config/agent/list');
    if (!response.ok) {
      console.warn('[DataExplorer] loadAgents failed with status:', response.status);
      return;
    }
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.warn('[DataExplorer] loadAgents received non-JSON response');
      return;
    }
    const text = await response.text();
    if (!text.trim()) {
      console.warn('[DataExplorer] loadAgents received empty response');
      return;
    }
    const result = JSON.parse(text);
    if (result.code === 200) {
      agents.value = result.data || [];
    }
  } catch (error) {
    console.error('[DataExplorer] Failed to load agents:', error);
  }
};

const selectZone = (zone: Zone) => {
  selectedZone.value = zone;
  emit('zone-select', zone);

  if (zone.files) {
    zone.files.forEach((file) => {
      if (file.sourceType === 'url' && !file.metadata?.title && !file.metadata?.favicon) {
        fetchUrlFileMeta(file);
      }
    });
  }
};

const fetchUrlFileMeta = async (file: ZoneFile) => {
  if (file.sourceType !== 'url' || !selectedZone.value?.id) return;

  try {
    const response = await fetch(`/api/zones/${selectedZone.value.id}/files/${file.id}/metadata`);
    const result = await response.json();

    if (result.success && (result.title || result.favicon)) {
      if (selectedZone.value.files) {
        const targetFile = selectedZone.value.files.find((f) => f.id === file.id);
        if (targetFile) {
          targetFile.metadata = { ...targetFile.metadata, ...result };
        }
      }
    }
  } catch (error) {
    console.warn('[DataExplorer] Failed to fetch URL metadata:', error);
  }
};

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

const handleFileUpdate = (file: ZoneFile) => {
  if (selectedZone.value && selectedZone.value.files) {
    const index = selectedZone.value.files.findIndex((f) => f.id === file.id);
    if (index !== -1) {
      selectedZone.value.files[index] = file;
    }
  }
};

const handleFileBatchDelete = async (files: ZoneFile[]) => {
  try {
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

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      loadZones();
      loadAgents();
    }
  }
);

watch(
  () => zones.value,
  (newZones) => {
    if (props.initialZoneId && newZones.length > 0) {
      const targetZone = newZones.find(z => z.id === props.initialZoneId);
      if (targetZone) {
        selectZone(targetZone);
        activeTab.value = 'files';
      }
    }
  },
  { immediate: true }
);

onMounted(() => {
  loadZones();
  loadAgents();
  loadTemplates();

  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
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
  gap: var(--ds-spacing-xs);
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  border-bottom: 1px solid var(--ds-border);
  background-color: var(--ds-bg-secondary);
  position: relative;
}

.history-controls {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-xs);
  margin-right: var(--ds-spacing-sm);
}

.history-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: var(--ds-radius-md);
}

.history-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.history-btn:not(:disabled):hover {
  background-color: var(--ds-bg-hover);
}

.history-info {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-tertiary);
  margin-left: var(--ds-spacing-xs);
  white-space: nowrap;
}

.tab-divider {
  width: 1px;
  height: var(--ds-spacing-lg);
  background-color: var(--ds-border);
  margin: 0 var(--ds-spacing-xs);
}

.tab-items {
  display: flex;
  flex: 1;
  position: relative;
}

.tab-indicator {
  position: absolute;
  bottom: -9px;
  height: var(--ds-border-width-md, 2px);
  background: var(--ds-brand-primary);
  transition: left 0.3s var(--ds-animation-easing-ease-out), width 0.3s var(--ds-animation-easing-ease-out);
  box-shadow: 0 -2px 8px var(--ds-brand-primary);
}

.tab-button {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-xs);
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  border: none;
  background: none;
  border-radius: var(--ds-radius-md);
  cursor: pointer;
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-secondary);
  transition: all var(--ds-animation-duration-fast) ease;
  flex: 1;
  justify-content: center;
}

.tab-button:hover {
  background-color: var(--ds-bg-hover);
  color: var(--ds-text-primary);
}

.tab-button.active {
  color: var(--ds-brand-primary);
}

.tab-icon {
  font-size: var(--ds-font-size-md);
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
  border-right: 1px solid var(--ds-border);
  background-color: var(--ds-bg-secondary);
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
  padding: calc(var(--ds-spacing-sm) + var(--ds-spacing-xs));
  border-bottom: 1px solid var(--ds-border);
}

.sidebar-title {
  font-size: var(--ds-font-size-sm);
  font-weight: 600;
  color: var(--ds-text-primary);
}

.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: var(--ds-spacing-lg);
  border: none;
  background: none;
  border-radius: var(--ds-radius-sm);
  cursor: pointer;
  color: var(--ds-text-secondary);
  transition: all var(--ds-animation-duration-fast) ease;
}

.collapse-btn:hover {
  background-color: var(--ds-bg-hover);
}

.collapse-btn svg {
  transition: transform 0.2s ease;
}

.zone-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--ds-spacing-sm);
}

.zone-item {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-xs);
  padding: 10px var(--ds-spacing-md);
  margin-bottom: 4px;
  border-radius: var(--ds-radius-md);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
  position: relative;
  overflow: hidden;
}

.zone-item:hover {
  background-color: var(--ds-bg-hover);
  transform: translateX(2px);
}

.zone-item.selected {
  background-color: color-mix(in srgb, var(--ds-brand-primary) 10%, transparent);
}

.zone-glow {
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  background: var(--ds-brand-primary);
  border-radius: 0 2px 2px 0;
  box-shadow: 0 0 8px var(--ds-brand-primary);
}

.zone-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-left: 8px;
}

.zone-name {
  font-size: var(--ds-font-size-sm);
  font-weight: 500;
  color: var(--ds-text-primary);
}

.zone-stats {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-tertiary);
}

.zone-detail {
  padding: calc(var(--ds-spacing-sm) + var(--ds-spacing-xs));
  border-top: 1px solid var(--ds-border);
}

.detail-title {
  font-size: var(--ds-font-size-sm);
  font-weight: 600;
  color: var(--ds-text-secondary);
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
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-tertiary);
}

.detail-item span {
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-primary);
}

.prompt-text {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-secondary);
}

.detail-actions {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ds-border);
}

.action-btn {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-xs);
  width: 100%;
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  border: none;
  background-color: var(--ds-bg-hover);
  border-radius: var(--ds-radius-md);
  cursor: pointer;
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-secondary);
  transition: all var(--ds-animation-duration-fast) ease;
}

.action-btn:hover {
  background-color: var(--ds-brand-primary);
  color: var(--ds-text-inverse);
}

.template-section {
  border-top: 1px solid var(--ds-border);
  padding: var(--ds-spacing-sm);
}

.template-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ds-spacing-sm);
  cursor: pointer;
  border-radius: var(--ds-radius-md);
  transition: background-color 0.15s ease;
}

.template-header:hover {
  background-color: var(--ds-bg-hover);
}

.template-header svg {
  transition: transform 0.2s ease;
}

.template-list {
  margin-top: 8px;
}

.template-empty {
  padding: var(--ds-spacing-md);
  text-align: center;
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-tertiary);
}

.template-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  margin-bottom: 4px;
  border-radius: var(--ds-radius-md);
  transition: background-color 0.15s ease;
}

.template-item:hover {
  background-color: var(--ds-bg-hover);
}

.template-info {
  flex: 1;
  cursor: pointer;
  overflow: hidden;
}

.template-name {
  display: block;
  font-size: var(--ds-font-size-sm);
  font-weight: 500;
  color: var(--ds-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.template-preview {
  display: block;
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.template-actions {
  display: flex;
  gap: var(--ds-spacing-xs);
  margin-left: 8px;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: var(--ds-spacing-lg);
  border: none;
  background: none;
  border-radius: var(--ds-radius-sm);
  cursor: pointer;
  color: var(--ds-text-tertiary);
  transition: all var(--ds-animation-duration-fast) ease;
}

.icon-btn:hover {
  background-color: var(--ds-bg-hover);
  color: var(--ds-text-primary);
}

.icon-btn.delete:hover {
  background-color: color-mix(in srgb, var(--ds-status-danger) 10%, transparent);
  color: var(--ds-status-danger);
}

.template-expand-enter-active,
.template-expand-leave-active {
  transition: all 0.2s var(--ds-animation-easing-ease-out);
  overflow: hidden;
}

.template-expand-enter-from,
.template-expand-leave-to {
  opacity: 0;
  max-height: 0;
  margin-top: 0;
}

.template-expand-enter-to,
.template-expand-leave-from {
  opacity: 1;
  max-height: 300px;
}

/* 模板编辑弹窗 */
.template-edit-modal {
  padding: var(--ds-spacing-sm);
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: var(--ds-font-size-sm);
  font-weight: 500;
  color: var(--ds-text-secondary);
  margin-bottom: 6px;
}

.form-input {
  width: 100%;
  padding: 10px var(--ds-spacing-md);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  font-size: var(--ds-font-size-md);
  color: var(--ds-text-primary);
  background-color: var(--ds-bg-primary);
  box-sizing: border-box;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.form-input:focus {
  outline: none;
  border-color: var(--ds-brand-primary);
  box-shadow: 0 0 0 var(--ds-spacing-xs) color-mix(in srgb, var(--ds-brand-primary) 10%, transparent);
}

.form-info {
  margin-bottom: 16px;
}

.form-info label {
  display: block;
  font-size: var(--ds-font-size-sm);
  font-weight: 500;
  color: var(--ds-text-secondary);
  margin-bottom: 6px;
}

.template-preview-box {
  padding: 10px var(--ds-spacing-md);
  background-color: var(--ds-bg-secondary);
  border-radius: var(--ds-radius-md);
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-primary);
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
  gap: var(--ds-spacing-sm);
  margin-top: 20px;
}

.btn-primary {
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  border: none;
  background-color: var(--ds-brand-primary);
  color: var(--ds-text-inverse);
  border-radius: var(--ds-radius-md);
  font-size: var(--ds-font-size-sm);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.btn-primary:hover {
  background-color: var(--ds-brand-primary);
}

.btn-secondary {
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  border: 1px solid var(--ds-border);
  background-color: var(--ds-bg-primary);
  color: var(--ds-text-secondary);
  border-radius: var(--ds-radius-md);
  font-size: var(--ds-font-size-sm);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
}

.btn-secondary:hover {
  background-color: var(--ds-bg-hover);
}

.explorer-main {
  flex: 1;
  padding: var(--ds-spacing-md);
  overflow-y: auto;
}

.files-header {
  margin-bottom: 12px;
}

.files-header h3 {
  font-size: var(--ds-font-size-md);
  font-weight: 600;
  color: var(--ds-text-primary);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--ds-text-tertiary);
  font-size: var(--ds-font-size-md);
}

/* 快捷键帮助样式 */
.shortcut-help {
  padding: var(--ds-spacing-sm);
}

.shortcut-section {
  margin-bottom: 20px;
}

.shortcut-section:last-child {
  margin-bottom: 0;
}

.shortcut-section h4 {
  font-size: var(--ds-font-size-md);
  font-weight: 600;
  color: var(--ds-text-primary, var(--ds-text-primary));
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--ds-border);
}

.shortcut-item {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  padding: 6px 0;
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-secondary, var(--ds-text-secondary));
}

.shortcut-item kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: var(--ds-spacing-lg);
  padding: 0 var(--ds-spacing-sm);
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border, var(--ds-border));
  border-radius: var(--ds-radius-sm);
  font-family: var(--ds-font-mono);
  font-size: var(--ds-font-size-sm);
  font-weight: 500;
  color: var(--ds-text-primary, var(--ds-text-primary));
  box-shadow: var(--ds-shadow-sm);
}

.shortcut-item span {
  margin-left: auto;
}

/* Prefers reduced motion */
@media (prefers-reduced-motion: reduce) {
  .zone-item,
  .template-header svg,
  .collapse-btn svg,
  .tab-indicator,
  .template-expand-enter-active,
  .template-expand-leave-active {
    transition: none !important;
    animation: none !important;
    transform: none !important;
  }
}
</style>
