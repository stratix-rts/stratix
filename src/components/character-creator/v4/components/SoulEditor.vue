<script setup lang="ts">
/**
 * SoulEditor.vue — Soul 编辑器 (V4)
 *
 * 编辑角色 Soul（identity, goals, personality）。
 * 支持模板选择、目标增删、Prompt 预览、导入导出。
 *
 * Props:
 *   modelValue?: { identity: string; goals: string[]; personality: string }
 *
 * Emits:
 *   update:modelValue: [value: SoulValue]
 *   change: [value: SoulValue]
 *
 * 美学约束: A1-A8，全部使用 var(--ds-*) tokens
 */

import { ref, computed, watch } from 'vue';
import { StratixButton } from '@/components/ui';
import { SOUL_TEMPLATES, type SoulTemplate } from '@/stratix-character-creator/config/soulTemplates';
import { renderTemplatePrompt } from '@/stratix-character-creator/core/SoulTemplateRenderer';

type SoulValue = { identity: string; goals: string[]; personality: string };

// ============================================================================

const props = defineProps<{
  modelValue?: SoulValue;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: SoulValue];
  change: [value: SoulValue];
}>();

// ============================================================================
// 本地编辑状态
// ============================================================================

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

// ============================================================================
// 领域配置
// ============================================================================

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

// ============================================================================
// 计算属性
// ============================================================================

/** 过滤模板 */
const filteredTemplates = computed(() => {
  let templates = SOUL_TEMPLATES;

  if (selectedDomain.value !== 'all') {
    templates = templates.filter(t => t.domain === selectedDomain.value);
  }

  if (templateSearchQuery.value) {
    const query = templateSearchQuery.value.toLowerCase();
    templates = templates.filter(t =>
      t.name.toLowerCase().includes(query) ||
      t.description.toLowerCase().includes(query),
    );
  }

  return templates;
});

/** 实时预览 */
const promptPreview = computed(() => {
  return renderTemplatePrompt({
    identity: identity.value,
    goals: goals.value,
    personality: personality.value,
  });
});

/** 是否为空 */
const isEmpty = computed(() => {
  return !identity.value && goals.value.length === 0 && !personality.value;
});

// ============================================================================
// 监听 props 变化
// ============================================================================

watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    identity.value = newVal.identity;
    goals.value = [...newVal.goals];
    personality.value = newVal.personality;
  }
}, { immediate: true });

// ============================================================================
// 操作方法
// ============================================================================

/** 发出更新 */
function emitUpdate(): void {
  const soul: SoulValue = {
    identity: identity.value,
    goals: goals.value,
    personality: personality.value,
  };
  emit('update:modelValue', soul);
  emit('change', soul);
}

/** 选择模板 */
function selectTemplate(template: SoulTemplate): void {
  selectedTemplateId.value = template.id;

  if (template.soul) {
    identity.value = template.soul.identity ?? '';
    goals.value = template.soul.goals ? [...template.soul.goals] : [];
    personality.value = template.soul.personality ?? '';
    emitUpdate();
  }
}

/** 下拉选择模板 */
function onTemplateSelect(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (!value) return;
  const t = SOUL_TEMPLATES.find(tpl => tpl.id === value);
  if (t) selectTemplate(t);
}

/** 添加目标 */
function addGoal(): void {
  const goal = newGoalInput.value.trim();
  if (goal && !goals.value.includes(goal)) {
    goals.value.push(goal);
    newGoalInput.value = '';
    emitUpdate();
  }
}

/** 移除目标 */
function removeGoal(index: number): void {
  goals.value.splice(index, 1);
  emitUpdate();
}

/** 导出配置 */
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

/** 复制配置 */
async function copySoul(): Promise<void> {
  const data = {
    identity: identity.value,
    goals: goals.value,
    personality: personality.value,
  };
  await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
}

/** 复制预览 */
async function copyPreview(): Promise<void> {
  await navigator.clipboard.writeText(promptPreview.value);
}

/** 清除所有 */
function clearAll(): void {
  identity.value = '';
  goals.value = [];
  personality.value = '';
  selectedTemplateId.value = null;
  emitUpdate();
}
</script>

<template>
  <div class="soul-editor">
    <!-- ================================================================
         头部 — 标题 + 空状态提示
    ================================================================ -->
    <div class="soul-editor__header">
      <span class="soul-editor__title">身份配置</span>
      <span class="soul-editor__subtitle">SOUL</span>
    </div>

    <!-- ================================================================
         模板选择 — 搜索 + 领域筛选 + 下拉
    ================================================================ -->
    <div class="soul-editor__template">
      <!-- A2: flex row 搜索 + 领域标签 -->
      <div class="template-controls">
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
            :class="['domain-chip', { 'domain-chip--active': selectedDomain === key }]"
            @click="selectedDomain = key"
          >
            {{ cfg.label }}
          </button>
        </div>
      </div>

      <!-- A3: select 使用 ds tokens -->
      <select
        class="template-select"
        @change="onTemplateSelect"
      >
        <option value="">-- 选择模板 --</option>
        <option
          v-for="t in filteredTemplates"
          :key="t.id"
          :value="t.id"
        >
          {{ t.name }} — {{ t.description }}
        </option>
      </select>
    </div>

    <!-- ================================================================
         表单区域 — Identity / Goals / Personality
    ================================================================ -->
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
            <span class="goal-text">{{ goal }}</span>
            <button
              class="goal-remove"
              title="移除目标"
              @click="removeGoal(index)"
            >
              ✕
            </button>
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
        <textarea
          v-model="personality"
          class="form-textarea"
          placeholder="描述 Agent 的性格特点..."
          rows="2"
          @input="emitUpdate"
        />
      </div>
    </div>

    <!-- ================================================================
         Prompt 预览
    ================================================================ -->
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

    <!-- ================================================================
         底部操作 — A5: CTA 在末端
    ================================================================ -->
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
/* ==========================================================================
   根容器 — A2: flex column, A3: ds tokens
========================================================================== */
.soul-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radii-lg, 8px);
  overflow: hidden;
}

/* ==========================================================================
   头部 — A5: 视觉层级第一层
========================================================================== */
.soul-editor__header {
  padding: var(--ds-spacing-md, 12px) var(--ds-spacing-lg, 16px);
  border-bottom: 1px solid var(--ds-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.soul-editor__title {
  font-size: var(--ds-font-size-md, 14px);
  color: var(--ds-color-primary);
  font-weight: var(--ds-font-weight-semibold, 600);
}

.soul-editor__subtitle {
  font-size: var(--ds-font-size-xs, 10px);
  color: var(--ds-text-muted);
  letter-spacing: 0.1em;
}

/* ==========================================================================
   模板区域
========================================================================== */
.soul-editor__template {
  padding: var(--ds-spacing-md, 12px) var(--ds-spacing-lg, 16px);
  background: var(--ds-bg-base);
  border-bottom: 1px solid var(--ds-border);
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm, 8px);
}

/* A2: flex wrap, 搜索框 + 领域标签 */
.template-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-spacing-sm, 8px);
  align-items: center;
}

.template-search {
  padding: var(--ds-spacing-xs, 4px) var(--ds-spacing-sm, 8px);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radii-md, 4px);
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-sm, 12px);
  width: 140px;
  outline: none;
  transition: border-color 0.15s ease;
}

.template-search:focus {
  border-color: var(--ds-color-primary);
}

.template-search::placeholder {
  color: var(--ds-text-muted);
}

/* A2: flex wrap 领域标签 */
.domain-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-spacing-xs, 4px);
}

/* A3: pill chip 风格, A4: 小尺寸 */
.domain-chip {
  padding: var(--ds-spacing-xs, 4px) var(--ds-spacing-sm, 8px);
  font-size: var(--ds-font-size-xs, 10px);
  border-radius: 12px;
  border: 1px solid var(--ds-border);
  background: var(--ds-bg-tertiary);
  color: var(--ds-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}

.domain-chip:hover {
  border-color: var(--ds-color-primary);
}

.domain-chip--active {
  background: var(--ds-color-primary);
  border-color: var(--ds-color-primary);
  color: var(--ds-text-inverse);
}

.template-select {
  padding: var(--ds-spacing-sm, 8px);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radii-md, 4px);
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-sm, 12px);
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease;
}

.template-select:focus {
  border-color: var(--ds-color-primary);
}

/* ==========================================================================
   表单区域 — A1: 间距一致, A7: 留白
========================================================================== */
.soul-editor__form {
  flex: 1;
  overflow-y: auto;
  padding: var(--ds-spacing-lg, 16px);
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-lg, 16px);
}

/* A1: 统一 field gap */
.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm, 8px);
}

/* A5: 标签层级第三层, 10px uppercase */
.form-label {
  font-size: var(--ds-font-size-xs, 10px);
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.char-count {
  font-size: var(--ds-font-size-xs, 10px);
  font-weight: var(--ds-font-weight-normal, 400);
  color: var(--ds-text-muted);
  text-transform: none;
}

/* A3: 统一输入样式 */
.form-textarea,
.goal-input {
  padding: var(--ds-spacing-sm, 8px) var(--ds-spacing-md, 12px);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radii-md, 4px);
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-sm, 12px);
  font-family: inherit;
  line-height: 1.5;
  transition: border-color 0.15s ease;
  outline: none;
}

.form-textarea:focus,
.goal-input:focus {
  border-color: var(--ds-color-primary);
}

.form-textarea::placeholder,
.goal-input::placeholder {
  color: var(--ds-text-muted);
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
}

/* ==========================================================================
   目标列表
========================================================================== */
.goals-list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-xs, 4px);
}

/* A2: flex row, A4: 等高 */
.goal-item {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm, 8px);
  padding: var(--ds-spacing-sm, 8px);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radii-md, 4px);
}

.goal-number {
  font-size: var(--ds-font-size-xs, 10px);
  color: var(--ds-color-primary);
  font-weight: var(--ds-font-weight-semibold, 600);
  min-width: 16px;
}

.goal-text {
  flex: 1;
  font-size: var(--ds-font-size-sm, 12px);
  color: var(--ds-text-primary);
  word-break: break-word;
}

/* A4: 20px 方形按钮 */
.goal-remove {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-sm, 12px);
  cursor: pointer;
  border-radius: var(--ds-radii-md, 4px);
  transition: all 0.15s ease;
}

.goal-remove:hover {
  background: var(--ds-status-danger);
  color: var(--ds-text-inverse);
}

.goals-empty {
  text-align: center;
  padding: var(--ds-spacing-lg, 16px);
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-sm, 12px);
}

/* A2: flex row 添加目标 */
.goal-add {
  display: flex;
  gap: var(--ds-spacing-sm, 8px);
}

.goal-input {
  flex: 1;
}

/* ==========================================================================
   Prompt 预览
========================================================================== */
.soul-editor__preview {
  border-top: 1px solid var(--ds-border);
  padding: var(--ds-spacing-md, 12px) var(--ds-spacing-lg, 16px);
  background: var(--ds-bg-base);
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--ds-spacing-sm, 8px);
}

.empty-warning {
  font-size: var(--ds-font-size-xs, 10px);
  color: var(--ds-status-warning, #f59e0b);
  background: var(--ds-bg-tertiary);
  padding: 2px var(--ds-spacing-sm, 8px);
  border-radius: var(--ds-radii-md, 4px);
  margin-left: var(--ds-spacing-sm, 8px);
}

.preview-content {
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radii-md, 4px);
  padding: var(--ds-spacing-md, 12px);
  font-size: var(--ds-font-size-xs, 10px);
  line-height: 1.6;
  color: var(--ds-text-primary);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 150px;
  overflow-y: auto;
  margin: 0;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
}

/* ==========================================================================
   底部操作 — A2: flex 右对齐, A5: CTA 在末端
========================================================================== */
.soul-editor__footer {
  padding: var(--ds-spacing-md, 12px) var(--ds-spacing-lg, 16px);
  border-top: 1px solid var(--ds-border);
  display: flex;
  justify-content: flex-end;
  gap: var(--ds-spacing-sm, 8px);
}

/* ==========================================================================
   滚动条 — 轻量样式
========================================================================== */
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
  border-radius: 3px;
}

.soul-editor__form::-webkit-scrollbar-thumb:hover,
.preview-content::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary);
}
</style>
