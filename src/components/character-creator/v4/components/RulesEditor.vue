<script setup lang="ts">
/**
 * RulesEditor.vue — 规则编辑器 (V4)
 *
 * 规则列表编辑：模板选择、添加/编辑/删除规则、拖拽排序、清空。
 *
 * Props:
 *   modelValue?: string[] — 当前规则列表
 *
 * Emits:
 *   update:modelValue: [value: string[]]
 *   change: [value: string[]]
 *
 * 美学约束: A1-A8，全部使用 var(--ds-*) tokens
 */

import { ref, computed, watch } from 'vue';
import { StratixButton } from '@/components/ui';
import { RULE_TEMPLATES, DEFAULT_RULES, type RuleTemplate } from '@/stratix-character-creator/config/ruleTemplates';

// ============================================================================

const props = defineProps<{
  modelValue?: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
  change: [value: string[]];
}>();

// ============================================================================
// 本地编辑状态
// ============================================================================

const rules = ref<string[]>([...(props.modelValue ?? DEFAULT_RULES)]);

// 新规则输入
const newRuleInput = ref('');

// 编辑状态
const editingIndex = ref<number | null>(null);
const editingText = ref('');

// 拖拽状态
const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

// 模板分类筛选
const selectedCategory = ref<string>('all');

// ============================================================================
// 分类配置
// ============================================================================

const categoryConfig: Record<string, { label: string }> = {
  all: { label: '全部' },
  communication: { label: '沟通类' },
  quality: { label: '质量类' },
  zone: { label: 'Zone 行为' },
};

// ============================================================================
// 计算属性
// ============================================================================

/** 规则数量 */
const rulesCount = computed(() => rules.value.length);

/** 按分类过滤模板 */
const filteredTemplates = computed(() => {
  if (selectedCategory.value === 'all') return RULE_TEMPLATES;
  return RULE_TEMPLATES.filter(t => t.category === selectedCategory.value);
});

/** 是否为空 */
const isEmpty = computed(() => rules.value.length === 0);

// ============================================================================
// 监听 props 变化
// ============================================================================

watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    rules.value = [...newVal];
  }
}, { immediate: true });

// ============================================================================
// 操作方法
// ============================================================================

/** 发出更新 */
function emitUpdate(): void {
  emit('update:modelValue', [...rules.value]);
  emit('change', [...rules.value]);
}

/** 添加规则 */
function addRule(): void {
  const rule = newRuleInput.value.trim();
  if (!rule) return;
  rules.value.push(rule);
  newRuleInput.value = '';
  emitUpdate();
}

/** 回车添加 */
function handleKeyup(e: KeyboardEvent): void {
  if (e.key === 'Enter') addRule();
}

/** 删除规则 */
function removeRule(index: number): void {
  rules.value.splice(index, 1);
  emitUpdate();
}

/** 开始编辑规则 */
function startEdit(index: number): void {
  editingIndex.value = index;
  editingText.value = rules.value[index];
}

/** 确认编辑 */
function confirmEdit(): void {
  if (editingIndex.value === null) return;
  const trimmed = editingText.value.trim();
  if (trimmed) {
    rules.value[editingIndex.value] = trimmed;
    emitUpdate();
  }
  cancelEdit();
}

/** 取消编辑 */
function cancelEdit(): void {
  editingIndex.value = null;
  editingText.value = '';
}

/** 编辑键盘处理 */
function handleEditKeyup(e: KeyboardEvent): void {
  if (e.key === 'Enter') confirmEdit();
  if (e.key === 'Escape') cancelEdit();
}

/** 应用模板（追加不重复的规则） */
function applyTemplate(template: RuleTemplate): void {
  for (const rule of template.rules) {
    if (!rules.value.includes(rule)) {
      rules.value.push(rule);
    }
  }
  emitUpdate();
}

/** 清空所有规则 */
function clearAll(): void {
  rules.value = [];
  emitUpdate();
}

// ============================================================================
// 拖拽排序
// ============================================================================

function onDragStart(index: number): void {
  dragIndex.value = index;
}

function onDragOver(e: DragEvent, index: number): void {
  e.preventDefault();
  dragOverIndex.value = index;
}

function onDragLeave(): void {
  dragOverIndex.value = null;
}

function onDrop(index: number): void {
  if (dragIndex.value === null || dragIndex.value === index) {
    dragIndex.value = null;
    dragOverIndex.value = null;
    return;
  }
  const item = rules.value.splice(dragIndex.value, 1)[0];
  rules.value.splice(index, 0, item);
  dragIndex.value = null;
  dragOverIndex.value = null;
  emitUpdate();
}

function onDragEnd(): void {
  dragIndex.value = null;
  dragOverIndex.value = null;
}
</script>

<template>
  <div class="rules-editor">
    <!-- ================================================================
         头部 — 标题 + 规则计数
    ================================================================ -->
    <div class="rules-editor__header">
      <span class="rules-editor__title">规则配置</span>
      <span class="rules-editor__subtitle">RULES · {{ rulesCount }} 条</span>
    </div>

    <!-- ================================================================
         模板选择 — 分类筛选 + 模板列表
    ================================================================ -->
    <div class="rules-editor__template">
      <div class="template-label">规则模板（快速选择）</div>

      <!-- 分类标签 -->
      <div class="category-filters">
        <button
          v-for="(cfg, key) in categoryConfig"
          :key="key"
          :class="['category-chip', { 'category-chip--active': selectedCategory === key }]"
          @click="selectedCategory = key"
        >
          {{ cfg.label }}
        </button>
      </div>

      <!-- 模板按钮 -->
      <div class="template-buttons">
        <button
          v-for="tpl in filteredTemplates"
          :key="tpl.id"
          class="template-btn"
          :title="tpl.description"
          @click="applyTemplate(tpl)"
        >
          {{ tpl.name }}
        </button>
      </div>
    </div>

    <!-- ================================================================
         规则列表 — 拖拽排序 + 编辑 + 删除
    ================================================================ -->
    <div class="rules-editor__list">
      <div class="list-label">
        当前规则
        <span v-if="isEmpty" class="empty-hint">暂无规则</span>
      </div>

      <div class="rules-list">
        <!-- 空状态 -->
        <div v-if="isEmpty" class="rules-empty">
          <span class="rules-empty__text">暂无规则，请添加或选择模板</span>
        </div>

        <!-- 规则项 -->
        <div
          v-for="(rule, index) in rules"
          :key="index"
          :class="[
            'rule-item',
            {
              'rule-item--dragging': dragIndex === index,
              'rule-item--drag-over': dragOverIndex === index,
            },
          ]"
          draggable="true"
          @dragstart="onDragStart(index)"
          @dragover="onDragOver($event, index)"
          @dragleave="onDragLeave"
          @drop="onDrop(index)"
          @dragend="onDragEnd"
        >
          <!-- 拖拽手柄 -->
          <span class="rule-drag-handle" title="拖拽排序">⠿</span>

          <!-- 序号 -->
          <span class="rule-number">{{ index + 1 }}</span>

          <!-- 规则文本（编辑模式 / 显示模式） -->
          <div v-if="editingIndex === index" class="rule-edit-row">
            <input
              v-model="editingText"
              type="text"
              class="rule-edit-input"
              @keyup="handleEditKeyup"
            />
            <StratixButton size="sm" variant="secondary" @click="confirmEdit">确认</StratixButton>
            <StratixButton size="sm" variant="ghost" @click="cancelEdit">取消</StratixButton>
          </div>

          <span v-else class="rule-text">{{ rule }}</span>

          <!-- 操作按钮（非编辑模式显示） -->
          <template v-if="editingIndex !== index">
            <button
              class="rule-action rule-action--edit"
              title="编辑"
              @click="startEdit(index)"
            >
              ✎
            </button>
            <button
              class="rule-action rule-action--remove"
              title="删除"
              @click="removeRule(index)"
            >
              ✕
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- ================================================================
         添加新规则
    ================================================================ -->
    <div class="rules-editor__add">
      <div class="add-label">添加新规则</div>
      <div class="add-row">
        <input
          v-model="newRuleInput"
          type="text"
          class="add-input"
          placeholder="输入新规则..."
          @keyup="handleKeyup"
        />
        <StratixButton
          size="sm"
          variant="primary"
          :disabled="!newRuleInput.trim()"
          @click="addRule"
        >
          添加
        </StratixButton>
      </div>
    </div>

    <!-- ================================================================
         底部操作 — A5: CTA 在末端
    ================================================================ -->
    <div class="rules-editor__footer">
      <StratixButton
        size="sm"
        variant="danger"
        :disabled="isEmpty"
        @click="clearAll"
      >
        清空所有规则
      </StratixButton>
    </div>
  </div>
</template>

<style scoped>
/* ==========================================================================
   根容器 — A2: flex column, A3: ds tokens
========================================================================== */
.rules-editor {
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
.rules-editor__header {
  padding: var(--ds-spacing-md, 12px) var(--ds-spacing-lg, 16px);
  border-bottom: 1px solid var(--ds-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.rules-editor__title {
  font-size: var(--ds-font-size-md, 14px);
  color: var(--ds-color-primary);
  font-weight: var(--ds-font-weight-semibold, 600);
}

.rules-editor__subtitle {
  font-size: var(--ds-font-size-xs, 10px);
  color: var(--ds-text-muted);
  letter-spacing: 0.1em;
}

/* ==========================================================================
   模板区域 — A1: 间距一致
========================================================================== */
.rules-editor__template {
  padding: var(--ds-spacing-md, 12px) var(--ds-spacing-lg, 16px);
  background: var(--ds-bg-base);
  border-bottom: 1px solid var(--ds-border);
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm, 8px);
}

.template-label,
.list-label,
.add-label {
  font-size: var(--ds-font-size-xs, 10px);
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.empty-hint {
  font-size: var(--ds-font-size-xs, 10px);
  color: var(--ds-status-warning, #f59e0b);
  margin-left: var(--ds-spacing-sm, 8px);
  text-transform: none;
}

/* A2: flex wrap 分类标签 */
.category-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-spacing-xs, 4px);
}

/* A3: pill chip 风格, A4: 小尺寸 */
.category-chip {
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

.category-chip:hover {
  border-color: var(--ds-color-primary);
}

.category-chip--active {
  background: var(--ds-color-primary);
  border-color: var(--ds-color-primary);
  color: var(--ds-text-inverse);
}

/* A2: flex wrap 模板按钮 */
.template-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-spacing-xs, 4px);
}

.template-btn {
  padding: var(--ds-spacing-xs, 4px) var(--ds-spacing-sm, 8px);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radii-md, 4px);
  color: var(--ds-text-secondary);
  font-size: var(--ds-font-size-xs, 10px);
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.template-btn:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

/* ==========================================================================
   规则列表 — A1: 间距, A7: 留白
========================================================================== */
.rules-editor__list {
  flex: 1;
  overflow-y: auto;
  padding: var(--ds-spacing-lg, 16px);
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm, 8px);
}

.rules-list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-xs, 4px);
}

/* 空状态 */
.rules-empty {
  padding: var(--ds-spacing-lg, 16px);
  text-align: center;
  background: var(--ds-bg-tertiary);
  border: 1px dashed var(--ds-border);
  border-radius: var(--ds-radii-md, 4px);
}

.rules-empty__text {
  font-size: var(--ds-font-size-sm, 12px);
  color: var(--ds-text-muted);
}

/* A2: flex row, A4: 等高 */
.rule-item {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm, 8px);
  padding: var(--ds-spacing-sm, 8px);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radii-md, 4px);
  transition: border-color 0.15s ease, background 0.15s ease;
  cursor: grab;
}

.rule-item--dragging {
  opacity: 0.5;
  border-color: var(--ds-color-primary);
}

.rule-item--drag-over {
  border-color: var(--ds-color-primary);
  background: var(--ds-bg-base);
}

/* 拖拽手柄 */
.rule-drag-handle {
  color: var(--ds-text-muted);
  font-size: var(--ds-font-size-sm, 12px);
  cursor: grab;
  user-select: none;
  opacity: 0.4;
  transition: opacity 0.15s ease;
}

.rule-item:hover .rule-drag-handle {
  opacity: 1;
}

/* 序号 */
.rule-number {
  font-size: var(--ds-font-size-xs, 10px);
  color: var(--ds-color-primary);
  font-weight: var(--ds-font-weight-semibold, 600);
  min-width: 16px;
}

/* 规则文本 */
.rule-text {
  flex: 1;
  font-size: var(--ds-font-size-sm, 12px);
  color: var(--ds-text-primary);
  line-height: 1.5;
  word-break: break-word;
}

/* 编辑行 */
.rule-edit-row {
  flex: 1;
  display: flex;
  gap: var(--ds-spacing-xs, 4px);
  align-items: center;
}

.rule-edit-input {
  flex: 1;
  padding: var(--ds-spacing-xs, 4px) var(--ds-spacing-sm, 8px);
  background: var(--ds-bg-base);
  border: 1px solid var(--ds-color-primary);
  border-radius: var(--ds-radii-md, 4px);
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-sm, 12px);
  font-family: inherit;
  outline: none;
}

/* A4: 20px 方形操作按钮 */
.rule-action {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  font-size: var(--ds-font-size-sm, 12px);
  cursor: pointer;
  border-radius: var(--ds-radii-md, 4px);
  transition: all 0.15s ease;
}

.rule-action--edit {
  color: var(--ds-text-muted);
}

.rule-action--edit:hover {
  background: var(--ds-color-primary);
  color: var(--ds-text-on-accent);
}

.rule-action--remove {
  color: var(--ds-text-muted);
}

.rule-action--remove:hover {
  background: var(--ds-status-danger);
  color: var(--ds-text-inverse);
}

/* ==========================================================================
   添加规则 — A2: flex row
========================================================================== */
.rules-editor__add {
  padding: var(--ds-spacing-md, 12px) var(--ds-spacing-lg, 16px);
  border-top: 1px solid var(--ds-border);
  background: var(--ds-bg-base);
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm, 8px);
}

.add-row {
  display: flex;
  gap: var(--ds-spacing-sm, 8px);
}

.add-input {
  flex: 1;
  padding: var(--ds-spacing-sm, 8px) var(--ds-spacing-md, 12px);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radii-md, 4px);
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-sm, 12px);
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease;
}

.add-input::placeholder {
  color: var(--ds-text-muted);
}

.add-input:focus {
  border-color: var(--ds-color-primary);
}

/* ==========================================================================
   底部操作 — A2: flex 右对齐, A5: CTA 在末端
========================================================================== */
.rules-editor__footer {
  padding: var(--ds-spacing-md, 12px) var(--ds-spacing-lg, 16px);
  border-top: 1px solid var(--ds-border);
  display: flex;
  justify-content: flex-end;
}

/* ==========================================================================
   滚动条 — 轻量样式
========================================================================== */
.rules-editor__list::-webkit-scrollbar {
  width: 6px;
}

.rules-editor__list::-webkit-scrollbar-track {
  background: var(--ds-bg-base);
}

.rules-editor__list::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: 3px;
}

.rules-editor__list::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary);
}
</style>
