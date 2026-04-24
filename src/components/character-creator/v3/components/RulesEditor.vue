<script setup lang="ts">
/**
 * RulesEditor.vue - 规则编辑器组件 (V3)
 *
 * 规则列表编辑：模板选择、添加/编辑/删除规则、清空
 *
 * Props/Emits:
 *   modelValue: string[] — 当前规则列表
 *   update:modelValue — 规则变更时触发
 */

import { ref, computed } from 'vue';

const props = defineProps<{
  modelValue?: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

// 模板定义
interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  category: 'communication' | 'quality' | 'zone';
}

const TEMPLATES: RuleTemplate[] = [
  { id: 'professional', name: '专业友好', description: '保持专业和友好的沟通风格', category: 'communication' },
  { id: 'responsive', name: '及时响应', description: '快速响应用户需求', category: 'communication' },
  { id: 'concise', name: '简洁高效', description: '提供简洁明了的回复', category: 'communication' },
  { id: 'accurate', name: '准确无误', description: '确保内容准确可靠', category: 'quality' },
  { id: 'detailed', name: '详尽完整', description: '提供详尽完整的解释', category: 'quality' },
  { id: 'zone_collaborate', name: 'Zone 协作', description: '在 Zone 内与其他 Agent 协作的规范', category: 'zone' },
  { id: 'zone_context', name: '上下文维护', description: '维护 Zone 内的工作上下文', category: 'zone' },
  { id: 'zone_resource', name: '资源共享', description: 'Zone 内资源使用的规范', category: 'zone' },
  { id: 'zone_delegate', name: '任务委托', description: '任务委托给同 Zone Agent 的规范', category: 'zone' },
];

// 模板规则映射
const TEMPLATE_RULES: Record<string, string[]> = {
  professional: [
    '始终保持专业和友好的语气',
    '提供清晰、有组织的回复',
    '避免使用过于技术化的术语，除非用户要求',
  ],
  responsive: [
    '根据用户反馈及时调整',
    '主动询问需要澄清的问题',
    '提供具体可行的建议',
  ],
  concise: [
    '回复简洁明了，避免冗余',
    '优先给出结论或解决方案',
    '使用列表和结构化格式提高可读性',
  ],
  accurate: [
    '确保内容准确、无错误',
    '不确定时明确说明',
    '引用可靠来源',
  ],
  detailed: [
    '提供详细完整的解释',
    '包含背景信息和上下文',
    '考虑各种可能的情况和边界条件',
  ],
  zone_collaborate: [
    '进入 Zone 时主动获取上下文',
    '使用 zone_communicate 与同 Zone Agent 协作',
    '完成任务后主动汇报进度',
    '不重复其他 Agent 的工作',
  ],
  zone_context: [
    '关注 Zone 内的共享文件变化',
    '及时更新工作进度到 Zone 状态',
    '离开 Zone 时保存上下文',
  ],
  zone_resource: [
    '合理使用 Zone 共享资源',
    '避免独占长时间运行的任务',
    '主动释放不再使用的资源',
  ],
  zone_delegate: [
    '明确任务目标和验收标准',
    '提供必要的上下文和信息',
    '跟踪委托任务的进度',
    '验收任务结果并反馈',
  ],
};

const DEFAULT_RULES = [
  '始终保持专业和友好的语气',
  '确保回复内容准确、有帮助',
];

// 内部规则状态
const rules = ref<string[]>([...(props.modelValue ?? DEFAULT_RULES)]);

// 新规则输入
const newRuleInput = ref('');

// 规则数量
const rulesCount = computed(() => rules.value.length);

// 分类模板
const templatesByCategory = computed(() => {
  const categories: Record<string, RuleTemplate[]> = {};
  for (const t of TEMPLATES) {
    if (!categories[t.category]) categories[t.category] = [];
    categories[t.category].push(t);
  }
  return categories;
});

const categoryLabels: Record<string, string> = {
  communication: '沟通类',
  quality: '质量类',
  zone: 'Zone 行为',
};

// 添加规则
function addRule(): void {
  const rule = newRuleInput.value.trim();
  if (!rule) return;
  rules.value.push(rule);
  newRuleInput.value = '';
  emit('update:modelValue', [...rules.value]);
}

// 回车添加
function handleKeypress(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    addRule();
  }
}

// 删除规则
function removeRule(index: number): void {
  rules.value.splice(index, 1);
  emit('update:modelValue', [...rules.value]);
}

// 编辑规则
function editRule(index: number): void {
  const current = rules.value[index];
  const edited = window.prompt('编辑规则:', current);
  if (edited !== null && edited.trim()) {
    rules.value[index] = edited.trim();
    emit('update:modelValue', [...rules.value]);
  }
}

// 应用模板
function applyTemplate(templateId: string): void {
  const templateRules = TEMPLATE_RULES[templateId];
  if (!templateRules) return;
  for (const rule of templateRules) {
    if (!rules.value.includes(rule)) {
      rules.value.push(rule);
    }
  }
  emit('update:modelValue', [...rules.value]);
}

// 清空所有规则
function clearAll(): void {
  if (window.confirm('确定要清空所有规则吗？')) {
    rules.value = [];
    emit('update:modelValue', []);
  }
}

// 验证
function validate(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (rules.value.length === 0) {
    errors.push('至少需要添加一条规则');
  }
  for (const rule of rules.value) {
    if (!rule.trim()) {
      errors.push('规则不能为空');
      break;
    }
  }
  return { valid: errors.length === 0, errors };
}

// HTML 转义
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
</script>

<template>
  <div class="rules-editor">
    <!-- 模板选择区 -->
    <div class="section">
      <div class="section__label">规则模板（快速选择）</div>
      <div class="template-categories">
        <div
          v-for="(templates, category) in templatesByCategory"
          :key="category"
          class="template-category"
        >
          <div class="template-category__label">{{ categoryLabels[category] }}</div>
          <div class="template-buttons">
            <button
              v-for="tpl in templates"
              :key="tpl.id"
              class="template-btn"
              :title="tpl.description"
              @click="applyTemplate(tpl.id)"
            >
              {{ tpl.name }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 规则列表 -->
    <div class="section">
      <div class="section__label">
        当前规则（<span class="rules-count">{{ rulesCount }}</span> 条）
      </div>
      <div class="rules-list">
        <div v-if="rules.length === 0" class="rules-empty">
          暂无规则
        </div>
        <div
          v-for="(rule, index) in rules"
          :key="index"
          class="rule-item"
        >
          <span class="rule-item__number">{{ index + 1 }}.</span>
          <span class="rule-item__text" v-html="escapeHtml(rule)"></span>
          <button
            class="rule-item__btn rule-item__btn--edit"
            @click="editRule(index)"
            title="编辑"
          >
            编辑
          </button>
          <button
            class="rule-item__btn rule-item__btn--remove"
            @click="removeRule(index)"
            title="删除"
          >
            删除
          </button>
        </div>
      </div>
    </div>

    <!-- 添加新规则 -->
    <div class="section">
      <div class="section__label">添加新规则</div>
      <div class="add-rule-row">
        <input
          v-model="newRuleInput"
          type="text"
          class="add-rule-input"
          placeholder="输入新规则..."
          @keypress="handleKeypress"
        />
        <button
          class="add-rule-btn"
          :disabled="!newRuleInput.trim()"
          @click="addRule"
        >
          添加
        </button>
      </div>
    </div>

    <!-- 清空按钮 -->
    <div class="section section--danger">
      <button
        class="clear-all-btn"
        :disabled="rules.length === 0"
        @click="clearAll"
      >
        清空所有规则
      </button>
    </div>
  </div>
</template>

<style scoped>
.rules-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: 8px;
  font-family: 'SF Mono', 'Monaco', monospace;
  max-height: 500px;
  overflow-y: auto;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section__label {
  font-size: 11px;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.section--danger {
  padding-top: 16px;
  border-top: 1px solid var(--ds-border);
}

/* 模板分类 */
.template-categories {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.template-category {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.template-category__label {
  font-size: 10px;
  color: var(--ds-text-muted);
}

.template-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.template-btn {
  padding: 5px 10px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-secondary);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.template-btn:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

/* 规则列表 */
.rules-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rules-empty {
  padding: 12px;
  color: var(--ds-text-muted);
  font-size: 12px;
  text-align: center;
  background: var(--ds-bg-tertiary);
  border: 1px dashed var(--ds-border);
  border-radius: 6px;
}

.rule-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
}

.rule-item__number {
  color: var(--ds-color-primary);
  font-size: 11px;
  min-width: 18px;
}

.rule-item__text {
  flex: 1;
  color: var(--ds-text-primary);
  font-size: 12px;
  line-height: 1.4;
  word-break: break-word;
}

.rule-item__btn {
  padding: 3px 8px;
  background: transparent;
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-secondary);
  font-size: 10px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.rule-item__btn--edit:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

.rule-item__btn--remove {
  color: var(--ds-color-danger);
}

.rule-item__btn--remove:hover {
  border-color: var(--ds-color-danger);
  color: var(--ds-color-danger);
}

/* 添加规则输入 */
.add-rule-row {
  display: flex;
  gap: 8px;
}

.add-rule-input {
  flex: 1;
  padding: 8px 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  color: var(--ds-text-primary);
  font-size: 12px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease;
}

.add-rule-input::placeholder {
  color: var(--ds-text-muted);
}

.add-rule-input:focus {
  border-color: var(--ds-color-primary);
}

.add-rule-btn {
  padding: 8px 16px;
  background: var(--ds-color-primary);
  border: 1px solid var(--ds-color-primary);
  border-radius: 6px;
  color: var(--ds-text-on-accent);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.add-rule-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.add-rule-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 清空按钮 */
.clear-all-btn {
  padding: 8px 16px;
  background: transparent;
  border: 1px solid var(--ds-color-danger);
  border-radius: 6px;
  color: var(--ds-color-danger);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.clear-all-btn:hover:not(:disabled) {
  background: var(--ds-color-danger);
  color: var(--ds-text-on-accent);
}

.clear-all-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
