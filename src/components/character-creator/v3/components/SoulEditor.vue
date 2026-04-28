<script setup lang="ts">
/**
 * SoulEditor.vue - Soul 编辑器组件 (V3)
 *
 * 编辑角色 Soul（identity, goals, personality）
 * 支持模板选择、实时预览、导入导出
 *
 * Props:
 *   modelValue?: { identity: string; goals: string[]; personality: string }
 *
 * Emits:
 *   update:modelValue: [value: SoulValue]
 *   change: [value: SoulValue]
 */

import { ref, computed, watch } from 'vue';
import { StratixButton } from '@/components/ui';
import { SOUL_TEMPLATES, type SoulTemplate } from '@/stratix-character-creator/config/soulTemplates';
import { renderTemplatePrompt } from '@/stratix-character-creator/core/SoulTemplateRenderer';

type SoulValue = { identity: string; goals: string[]; personality: string };

const props = defineProps<{
  modelValue?: SoulValue;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: SoulValue];
  change: [value: SoulValue];
}>();

// 本地编辑状态
const identity = ref(props.modelValue?.identity ?? '');
const goals = ref<string[]>(props.modelValue?.goals ?? []);
const personality = ref(props.modelValue?.personality ?? '');
const selectedTemplateId = ref<string | null>(null);

// 新目标输入
const newGoalInput = ref('');

// 模板搜索
const templateSearchQuery = ref('');

// 领域筛选
const selectedDomain = ref<string>('all');

// 域配置
const domainConfig: Record<string, { label: string }> = {
  all: { label: '全部' },
  general: { label: '通用' },
  engineering: { label: '工程开发' },
  design: { label: '设计' },
  marketing: { label: '市场营销' },
  sales: { label: '销售' },
  product: { label: '产品管理' },
  'project-management': { label: '项目管理' },
  data: { label: '数据分析' },
  support: { label: '客户支持' },
  content: { label: '内容创作' },
};

// 过滤模板
const filteredTemplates = computed(() => {
  let templates = SOUL_TEMPLATES;

  if (selectedDomain.value !== 'all') {
    templates = templates.filter(t => t.domain === selectedDomain.value);
  }

  if (templateSearchQuery.value) {
    const query = templateSearchQuery.value.toLowerCase();
    templates = templates.filter(t =>
      t.name.toLowerCase().includes(query) ||
      t.description.toLowerCase().includes(query)
    );
  }

  return templates;
});

// 实时预览
const promptPreview = computed(() => {
  return renderTemplatePrompt({
    identity: identity.value,
    goals: goals.value,
    personality: personality.value,
  });
});

// 是否为空
const isEmpty = computed(() => {
  return !identity.value && goals.value.length === 0 && !personality.value;
});

// 监听 props 变化
watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    identity.value = newVal.identity;
    goals.value = [...newVal.goals];
    personality.value = newVal.personality;
  }
}, { immediate: true });

// 发出更新
function emitUpdate(): void {
  const soul: SoulValue = {
    identity: identity.value,
    goals: goals.value,
    personality: personality.value,
  };
  emit('update:modelValue', soul);
  emit('change', soul);
}

// 选择模板
function selectTemplate(template: SoulTemplate): void {
  selectedTemplateId.value = template.id;

  if (template.soul) {
    identity.value = template.soul.identity ?? '';
    goals.value = template.soul.goals ? [...template.soul.goals] : [];
    personality.value = template.soul.personality ?? '';
    emitUpdate();
  }
}

// 添加目标
function addGoal(): void {
  const goal = newGoalInput.value.trim();
  if (goal && !goals.value.includes(goal)) {
    goals.value.push(goal);
    newGoalInput.value = '';
    emitUpdate();
  }
}

// 移除目标
function removeGoal(index: number): void {
  goals.value.splice(index, 1);
  emitUpdate();
}

// 导出配置
function exportSoul(): void {
  const data = {
    version: '1.0',
    exportedAt: Date.now(),
    soul: {
      identity: identity.value,
      goals: goals.value,
      personality: personality.value,
    },
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'soul-template.json';
  a.click();
  URL.revokeObjectURL(url);
}

// 复制配置
async function copySoul(): Promise<void> {
  const data = {
    identity: identity.value,
    goals: goals.value,
    personality: personality.value,
  };
  await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
}

// 复制预览
async function copyPreview(): Promise<void> {
  await navigator.clipboard.writeText(promptPreview.value);
}

// 清除所有
function clearAll(): void {
  identity.value = '';
  goals.value = [];
  personality.value = '';
  selectedTemplateId.value = null;
  emitUpdate();
}

// HTML 转义
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
</script>

<template>
  <div class="soul-editor">
    <!-- 头部 -->
    <div class="soul-editor__header">
      <span class="soul-editor__title">身份配置</span>
      <span class="soul-editor__subtitle">SOUL</span>
    </div>

    <!-- 模板选择 -->
    <div class="soul-editor__template">
      <div class="template-header">
        <input
          v-model="templateSearchQuery"
          type="text"
          class="template-search"
          placeholder="搜索模板..."
        />
        <div class="domain-filters">
          <button
            v-for="(cfg, key) in domainConfig"
            :key="key"
            class="domain-filter"
            :class="{ 'domain-filter--active': selectedDomain === key }"
            @click="selectedDomain = key"
          >
            {{ cfg.label }}
          </button>
        </div>
      </div>
      <select
        v-model="selectedTemplateId"
        class="template-select"
        @change="() => {
          const t = SOUL_TEMPLATES.find(t => t.id === selectedTemplateId);
          if (t) selectTemplate(t);
        }"
      >
        <option value="">-- 选择模板 --</option>
        <option
          v-for="t in filteredTemplates"
          :key="t.id"
          :value="t.id"
        >
          {{ t.name }} - {{ t.description }}
        </option>
      </select>
    </div>

    <!-- 表单区域 -->
    <div class="soul-editor__form">
      <!-- Identity -->
      <div class="form-field">
        <label class="form-label">
          身份 IDENTITY
          <span class="char-count">{{ identity.length }} 字符</span>
        </label>
        <textarea
          v-model="identity"
          class="form-textarea"
          placeholder="描述 Agent 的身份定位..."
          rows="3"
          @input="emitUpdate"
        />
      </div>

      <!-- Goals -->
      <div class="form-field">
        <label class="form-label">
          目标 GOALS
          <span class="char-count">{{ goals.length }} 个</span>
        </label>

        <!-- 目标列表 -->
        <div class="goals-list">
          <div
            v-for="(goal, index) in goals"
            :key="index"
            class="goal-item"
          >
            <span class="goal-number">{{ index + 1 }}</span>
            <span class="goal-text">{{ escapeHtml(goal) }}</span>
            <button class="goal-remove" @click="removeGoal(index)">✕</button>
          </div>
          <div v-if="goals.length === 0" class="goals-empty">
            暂无目标，请添加
          </div>
        </div>

        <!-- 添加目标 -->
        <div class="goal-add">
          <input
            v-model="newGoalInput"
            type="text"
            class="goal-input"
            placeholder="输入新目标..."
            @keyup.enter="addGoal"
          />
          <StratixButton size="sm" variant="secondary" @click="addGoal">
            添加
          </StratixButton>
        </div>
      </div>

      <!-- Personality -->
      <div class="form-field">
        <label class="form-label">
          性格 PERSONALITY
          <span class="char-count">{{ personality.length }} 字符</span>
        </label>
        <input
          v-model="personality"
          type="text"
          class="form-input"
          placeholder="描述 Agent 的性格特点..."
          @input="emitUpdate"
        />
      </div>
    </div>

    <!-- 预览区域 -->
    <div class="soul-editor__preview">
      <div class="preview-header">
        <label class="form-label">
          Prompt 预览
          <span v-if="isEmpty" class="empty-warning">⚠ 配置为空</span>
        </label>
        <StratixButton size="sm" variant="ghost" @click="copyPreview">
          复制
        </StratixButton>
      </div>
      <pre class="preview-content">{{ promptPreview || '暂无内容' }}</pre>
    </div>

    <!-- 底部操作 -->
    <div class="soul-editor__footer">
      <StratixButton size="sm" variant="ghost" @click="copySoul">
        复制配置
      </StratixButton>
      <StratixButton size="sm" variant="ghost" @click="exportSoul">
        导出
      </StratixButton>
      <StratixButton size="sm" variant="danger" @click="clearAll">
        清空
      </StratixButton>
    </div>
  </div>
</template>

<style scoped>
.soul-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  overflow: hidden;
  font-family: var(--ds-font-mono);
}

.soul-editor__header {
  padding: var(--ds-spacing-md) var(--ds-spacing-md);
  border-bottom: 1px solid var(--ds-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.soul-editor__title {
  font-size: var(--ds-font-size-md);
  color: var(--ds-color-primary);
  font-weight: 500;
}

.soul-editor__subtitle {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  letter-spacing: 1px;
}

.soul-editor__template {
  padding: var(--ds-spacing-md) var(--ds-spacing-md);
  background: var(--ds-bg-base);
  border-bottom: 1px solid var(--ds-border);
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm);
}

.template-header {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.template-search {
  padding: 6px 10px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-sm);
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-xs);
  font-family: inherit;
  width: 140px;
}

.template-search:focus {
  outline: none;
  border-color: var(--ds-color-primary);
}

.template-search::placeholder {
  color: var(--ds-text-muted);
}

.domain-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.domain-filter {
  padding: 4px 10px;
  font-size: var(--ds-font-size-xs);
  border-radius: var(--ds-radius-lg);
  border: 1px solid var(--ds-border);
  background: var(--ds-bg-tertiary);
  color: var(--ds-text-secondary);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
  font-family: inherit;
}

.domain-filter:hover {
  border-color: var(--ds-color-primary);
}

.domain-filter--active {
  background: var(--ds-color-primary);
  border-color: var(--ds-color-primary);
  color: var(--ds-text-inverse);
}

.template-select {
  padding: 8px 10px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-xs);
  font-family: inherit;
}

.template-select:focus {
  outline: none;
  border-color: var(--ds-color-primary);
}

.soul-editor__form {
  flex: 1;
  overflow-y: auto;
  padding: var(--ds-spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-md);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm);
}

.form-label {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.char-count {
  font-size: var(--ds-font-size-xs);
  font-weight: normal;
  color: var(--ds-text-muted);
  text-transform: none;
}

.form-input,
.form-textarea,
.goal-input {
  padding: 10px var(--ds-spacing-md);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-sm);
  font-family: inherit;
  transition: border-color 0.15s ease;
}

.form-input:focus,
.form-textarea:focus,
.goal-input:focus {
  outline: none;
  border-color: var(--ds-color-primary);
}

.form-input::placeholder,
.form-textarea::placeholder,
.goal-input::placeholder {
  color: var(--ds-text-muted);
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
  line-height: 1.5;
}

.goals-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.goal-item {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  padding: 8px 10px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-sm);
}

.goal-number {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-color-primary);
  font-weight: 600;
  min-width: 16px;
}

.goal-text {
  flex: 1;
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-primary);
  word-break: break-word;
}

.goal-remove {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-sm);
  cursor: pointer;
  border-radius: var(--ds-radius-sm);
  transition: all var(--ds-animation-duration-fast) ease;
}

.goal-remove:hover {
  background: var(--ds-status-danger);
  color: var(--ds-text-inverse);
}

.goals-empty {
  text-align: center;
  padding: var(--ds-spacing-md);
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-sm);
}

.goal-add {
  display: flex;
  gap: var(--ds-spacing-sm);
}

.goal-input {
  flex: 1;
}

.soul-editor__preview {
  border-top: 1px solid var(--ds-border);
  padding: var(--ds-spacing-md) var(--ds-spacing-md);
  background: var(--ds-bg-base);
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.empty-warning {
  font-size: var(--ds-font-size-xs);
  color: #f59e0b;
  background: color-mix(in srgb, var(--ds-status-warning) 10%, transparent);
  padding: 2px var(--ds-spacing-xs);
  border-radius: var(--ds-radius-sm);
  margin-left: 8px;
}

.preview-content {
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  padding: 12px;
  font-size: var(--ds-font-size-xs);
  line-height: 1.6;
  color: var(--ds-text-primary);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 150px;
  overflow-y: auto;
  margin: 0;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
}

.soul-editor__footer {
  padding: var(--ds-spacing-md) var(--ds-spacing-md);
  border-top: 1px solid var(--ds-border);
  display: flex;
  justify-content: flex-end;
  gap: var(--ds-spacing-sm);
}

/* 滚动条样式 */
.soul-editor__form::-webkit-scrollbar,
.preview-content::-webkit-scrollbar {
  width: 6px;
}

.soul-editor__form::-webkit-scrollbar-track,
.preview-content::-webkit-scrollbar-track {
  background: var(--ds-bg-base);
}

.soul-editor__form::-webkit-scrollbar-thumb,
.preview-content::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: var(--ds-radius-sm);
}

.soul-editor__form::-webkit-scrollbar-thumb:hover,
.preview-content::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary);
}
</style>
