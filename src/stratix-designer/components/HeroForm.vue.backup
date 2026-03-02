<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { StratixAgentConfig } from '@/stratix-core/stratix-protocol';
import { StratixHeroDesigner } from '../StratixHeroDesigner';
import { HeroType, getHeroColor } from '../templates/types';
import SoulEditor from './SoulEditor.vue';
import SkillEditor from './SkillEditor.vue';
import MemoryEditor from './MemoryEditor.vue';
import ModelConfig from './ModelConfig.vue';

const props = defineProps<{
  agentId?: string;
  heroType?: HeroType;
  designer?: StratixHeroDesigner;
}>();

const emit = defineEmits<{
  (e: 'saved', config: StratixAgentConfig): void;
  (e: 'cancel'): void;
}>();

const designer = props.designer || new StratixHeroDesigner();
const activeTab = ref<'soul' | 'skills' | 'memory' | 'model'>('soul');
const saving = ref(false);
const showPreview = ref(false);

const isNew = computed(() => !props.agentId);
const config = ref<StratixAgentConfig>(designer.createNewHero(props.heroType || 'writer'));

const heroTypeOptions: { value: HeroType; label: string; icon: string }[] = [
  { value: 'writer', label: '文案英雄', icon: '✍️' },
  { value: 'dev', label: '开发英雄', icon: '💻' },
  { value: 'analyst', label: '分析英雄', icon: '📊' },
];

const tabs = [
  { key: 'soul', label: 'Soul', icon: '❤️' },
  { key: 'skills', label: '技能', icon: '⚡' },
  { key: 'memory', label: '记忆', icon: '🧠' },
  { key: 'model', label: '模型', icon: '🖥️' },
] as const;

const handleSave = async () => {
  try {
    saving.value = true;
    const result = await designer.saveHeroConfig(config.value);
    if (result.code === 200) {
      emit('saved', config.value);
    } else {
      alert(result.message);
    }
  } catch (error) {
    alert('保存失败');
  } finally {
    saving.value = false;
  }
};

const handleExport = () => {
  try {
    designer.downloadHeroConfig(config.value.agentId);
  } catch (error) {
    alert('导出失败');
  }
};

const handlePreview = () => {
  showPreview.value = true;
};

const handleCancel = () => {
  emit('cancel');
};

const copyJson = async () => {
  const json = designer.exportHeroConfig(config.value.agentId);
  await navigator.clipboard.writeText(json);
};

const heroColor = computed(() => getHeroColor(config.value.type));
</script>

<template>
  <div class="hero-form">
    <div class="form-header">
      <div class="header-left">
        <button class="back-btn" @click="handleCancel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
        </button>
        <div class="hero-badge" :style="{ background: heroColor }">
          {{ config.name?.charAt(0) || '?' }}
        </div>
        <div class="header-info">
          <h2 class="header-title">{{ isNew ? '创建英雄' : '编辑英雄' }}</h2>
          <span class="header-id">{{ config.agentId }}</span>
        </div>
      </div>
      <div class="header-actions">
        <button class="action-btn secondary" @click="handlePreview">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
          </svg>
          预览
        </button>
        <button class="action-btn secondary" @click="handleExport">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
          </svg>
          导出
        </button>
        <button class="action-btn primary" @click="handleSave" :disabled="saving">
          <svg v-if="saving" class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>

    <div class="form-body">
      <div class="basic-info">
        <div class="info-field">
          <label class="field-label">英雄名称</label>
          <input
            v-model="config.name"
            class="field-input"
            placeholder="输入英雄名称"
          />
        </div>
        <div class="info-field">
          <label class="field-label">英雄类型</label>
          <div class="type-selector">
            <button
              v-for="opt in heroTypeOptions"
              :key="opt.value"
              :class="['type-option', { selected: config.type === opt.value }]"
              @click="config.type = opt.value"
            >
              <span class="type-icon">{{ opt.icon }}</span>
              <span class="type-label">{{ opt.label }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="tabs-container">
        <div class="tabs-header">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :class="['tab-btn', { active: activeTab === tab.key }]"
            @click="activeTab = tab.key"
          >
            <span class="tab-icon">{{ tab.icon }}</span>
            {{ tab.label }}
          </button>
        </div>

        <div class="tabs-body">
          <SoulEditor v-if="activeTab === 'soul'" v-model="config.soul" />
          <SkillEditor v-if="activeTab === 'skills'" v-model="config.skills" />
          <MemoryEditor v-if="activeTab === 'memory'" v-model="config.memory" />
          <ModelConfig v-if="activeTab === 'model'" v-model="config.model" />
        </div>
      </div>
    </div>

    <div v-if="showPreview" class="preview-overlay" @click="showPreview = false">
      <div class="preview-modal" @click.stop>
        <div class="modal-header">
          <h3>配置预览</h3>
          <button class="close-btn" @click="showPreview = false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <pre class="json-preview">{{ JSON.stringify(config, null, 2) }}</pre>
        </div>
        <div class="modal-footer">
          <button class="action-btn secondary" @click="showPreview = false">关闭</button>
          <button class="action-btn primary" @click="copyJson">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
            复制 JSON
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap');

.hero-form {
  font-family: 'Fira Sans', sans-serif;
  background: #020617;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: #0F172A;
  border-bottom: 1px solid #1E293B;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.back-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid #1E293B;
  border-radius: 8px;
  color: #94A3B8;
  cursor: pointer;
  transition: all 200ms ease;
}

.back-btn:hover {
  background: #1E293B;
  color: #F8FAFC;
}

.back-btn svg {
  width: 18px;
  height: 18px;
}

.hero-badge {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 700;
  font-size: 18px;
}

.header-info {
  display: flex;
  flex-direction: column;
}

.header-title {
  font-family: 'Fira Code', monospace;
  font-size: 16px;
  font-weight: 600;
  color: #F8FAFC;
  margin: 0;
}

.header-id {
  font-family: 'Fira Code', monospace;
  font-size: 11px;
  color: #64748B;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 200ms ease;
}

.action-btn svg {
  width: 16px;
  height: 16px;
}

.action-btn.secondary {
  background: transparent;
  border: 1px solid #1E293B;
  color: #F8FAFC;
}

.action-btn.secondary:hover {
  background: #1E293B;
  border-color: #334155;
}

.action-btn.primary {
  background: #22C55E;
  border: none;
  color: #020617;
}

.action-btn.primary:hover:not(:disabled) {
  background: #16A34A;
}

.action-btn.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.form-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.basic-info {
  display: flex;
  gap: 24px;
  margin-bottom: 24px;
}

.info-field {
  flex: 1;
}

.field-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: #94A3B8;
  margin-bottom: 8px;
}

.field-input {
  width: 100%;
  padding: 12px 16px;
  background: #0F172A;
  border: 1px solid #1E293B;
  border-radius: 8px;
  color: #F8FAFC;
  font-size: 14px;
  transition: border-color 200ms ease;
}

.field-input::placeholder {
  color: #475569;
}

.field-input:focus {
  outline: none;
  border-color: #22C55E;
}

.type-selector {
  display: flex;
  gap: 8px;
}

.type-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
  background: #0F172A;
  border: 1px solid #1E293B;
  border-radius: 8px;
  cursor: pointer;
  transition: all 200ms ease;
}

.type-option:hover {
  background: #1E293B;
}

.type-option.selected {
  border-color: #22C55E;
  background: rgba(34, 197, 94, 0.1);
}

.type-icon {
  font-size: 20px;
}

.type-label {
  font-size: 12px;
  font-weight: 500;
  color: #F8FAFC;
}

.tabs-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #0F172A;
  border: 1px solid #1E293B;
  border-radius: 12px;
  overflow: hidden;
}

.tabs-header {
  display: flex;
  background: #020617;
  border-bottom: 1px solid #1E293B;
  padding: 4px;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: transparent;
  border: none;
  color: #64748B;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 200ms ease;
  border-radius: 8px;
}

.tab-btn:hover {
  color: #F8FAFC;
  background: #1E293B;
}

.tab-btn.active {
  color: #22C55E;
  background: rgba(34, 197, 94, 0.1);
}

.tab-icon {
  font-size: 14px;
}

.tabs-body {
  flex: 1;
  overflow-y: auto;
}

.preview-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 200ms ease;
}

.preview-modal {
  background: #0F172A;
  border: 1px solid #1E293B;
  border-radius: 12px;
  width: 90%;
  max-width: 700px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  animation: slideUp 200ms ease;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #1E293B;
}

.modal-header h3 {
  font-family: 'Fira Code', monospace;
  font-size: 14px;
  font-weight: 600;
  color: #F8FAFC;
  margin: 0;
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: #64748B;
  cursor: pointer;
  border-radius: 6px;
  transition: all 200ms ease;
}

.close-btn:hover {
  background: #1E293B;
  color: #F8FAFC;
}

.close-btn svg {
  width: 18px;
  height: 18px;
}

.modal-body {
  flex: 1;
  overflow: auto;
  padding: 20px;
}

.json-preview {
  font-family: 'Fira Code', monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #94A3B8;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid #1E293B;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .preview-overlay,
  .preview-modal,
  .spin {
    animation: none;
  }
}

@media (max-width: 768px) {
  .form-header {
    flex-direction: column;
    gap: 12px;
  }

  .header-left {
    width: 100%;
  }

  .header-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .basic-info {
    flex-direction: column;
  }

  .tabs-header {
    overflow-x: auto;
  }

  .tab-btn {
    padding: 10px 14px;
    font-size: 12px;
  }
}
</style>
