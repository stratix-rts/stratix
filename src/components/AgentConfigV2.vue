<script setup lang="ts">
/**
 * AgentConfigV2 - Vue 版本的 Agent 配置组件
 * 用于 CharacterCreatorModalV2 的 agent 步骤
 */
import { ref, computed } from 'vue';
import { StratixButton } from '@/components/ui';
import type { SavedCharacter } from '../stratix-character-creator/types';
import { SOUL_TEMPLATES } from '../stratix-character-creator/config/soulTemplates';
import { RULE_TEMPLATES } from '../stratix-character-creator/config/ruleTemplates';

const props = defineProps<{
  character?: SavedCharacter | null;
}>();

const emit = defineEmits<{
  (e: 'change', config: AgentConfigChange): void;
  (e: 'prev'): void;
  (e: 'complete'): void;
}>();

interface AgentConfigChange {
  soul: {
    identity: string;
    goals: string[];
    personality: string;
  };
  rules: string[];
}

type TabKey = 'soul' | 'rules';

const currentTab = ref<TabKey>('soul');

// Soul state
const soulIdentity = ref(props.character?.soul?.identity || '');
const soulGoals = ref<string[]>(props.character?.soul?.goals || []);
const soulPersonality = ref(props.character?.soul?.personality || '');
const newGoal = ref('');

// Rules state
const rules = ref<string[]>(props.character?.rules || []);
const newRule = ref('');

// Current template
const selectedTemplateId = ref<string | null>(null);

// Soul templates grouped by domain
const localDomainNames: Record<string, string> = {
  engineering: '工程开发',
  design: '设计',
  marketing: '市场营销',
  sales: '销售',
  product: '产品管理',
  'project-management': '项目管理',
  data: '数据分析',
  support: '客户支持',
  content: '内容创作',
  general: '通用',
};

// Group templates by domain
const groupedTemplates = computed(() => {
  const groups: Record<string, typeof SOUL_TEMPLATES> = {};
  for (const t of SOUL_TEMPLATES) {
    const domain = t.domain || 'general';
    if (!groups[domain]) groups[domain] = [];
    groups[domain].push(t);
  }
  return groups;
});

const selectTemplate = (templateId: string) => {
  const template = SOUL_TEMPLATES.find(t => t.id === templateId);
  if (template && template.soul) {
    soulIdentity.value = template.soul.identity || '';
    soulGoals.value = template.soul.goals ? [...template.soul.goals] : [];
    soulPersonality.value = template.soul.personality || '';
    selectedTemplateId.value = templateId;
    emitChange();
  }
};

const addGoal = () => {
  const goal = newGoal.value.trim();
  if (goal) {
    soulGoals.value.push(goal);
    newGoal.value = '';
    emitChange();
  }
};

const removeGoal = (index: number) => {
  soulGoals.value.splice(index, 1);
  emitChange();
};

const addRule = () => {
  const rule = newRule.value.trim();
  if (rule) {
    rules.value.push(rule);
    newRule.value = '';
    emitChange();
  }
};

const removeRule = (index: number) => {
  rules.value.splice(index, 1);
  emitChange();
};

const applyRulesTemplate = (templateId: string) => {
  const template = RULE_TEMPLATES.find(t => t.id === templateId);
  if (template) {
    for (const rule of template.rules) {
      if (!rules.value.includes(rule)) {
        rules.value.push(rule);
      }
    }
    emitChange();
  }
};

const clearAllRules = () => {
  rules.value = [];
  emitChange();
};

const emitChange = () => {
  emit('change', {
    soul: {
      identity: soulIdentity.value,
      goals: [...soulGoals.value],
      personality: soulPersonality.value,
    },
    rules: [...rules.value],
  });
};

const validate = (): string[] => {
  const errors: string[] = [];
  if (!soulIdentity.value.trim()) errors.push('身份描述不能为空');
  if (soulGoals.value.length === 0) errors.push('至少需要添加一个目标');
  if (!soulPersonality.value.trim()) errors.push('性格描述不能为空');
  return errors;
};

const validationErrors = ref<string[]>([]);

const handleComplete = () => {
  validationErrors.value = validate();
  if (validationErrors.value.length === 0) {
    emit('complete');
  }
};

// Emit changes on input
const onIdentityChange = () => { emitChange(); };
const onPersonalityChange = () => { emitChange(); };
</script>

<template>
  <div class="agent-config">
    <!-- Tabs -->
    <div class="tabs">
      <button
        class="tab-btn"
        :class="{ active: currentTab === 'soul' }"
        @click="currentTab = 'soul'"
      >
        身份 SOUL
      </button>
      <button
        class="tab-btn"
        :class="{ active: currentTab === 'rules' }"
        @click="currentTab = 'rules'"
      >
        规则 RULES
      </button>
    </div>

    <!-- Tab Content -->
    <div class="tab-content">
      <!-- Soul Tab -->
      <div v-if="currentTab === 'soul'" class="tab-panel">
        <!-- Template Select -->
        <div class="form-group">
          <label class="form-label">快速选择模板</label>
          <select class="form-select" @change="selectTemplate(($event.target as HTMLSelectElement).value)">
            <option value="">-- 选择模板 --</option>
            <optgroup v-for="(templates, domain) in groupedTemplates" :key="domain" :label="`[L] ${localDomainNames[domain] || domain}`">
              <option v-for="t in templates" :key="t.id" :value="t.id">
                {{ t.name }}
              </option>
            </optgroup>
          </select>
        </div>

        <!-- Identity -->
        <div class="form-group">
          <label class="form-label">身份 IDENTITY</label>
          <textarea
            v-model="soulIdentity"
            class="form-textarea"
            placeholder="描述 Agent 的身份定位..."
            @input="onIdentityChange"
          ></textarea>
        </div>

        <!-- Goals -->
        <div class="form-group">
          <label class="form-label">目标 GOALS</label>
          <div class="goals-list">
            <div v-for="(goal, index) in soulGoals" :key="index" class="goal-item">
              <span class="goal-text">{{ goal }}</span>
              <button class="remove-btn" @click="removeGoal(index)">删除</button>
            </div>
            <div v-if="soulGoals.length === 0" class="empty-message">暂无目标</div>
          </div>
          <div class="add-row">
            <input
              v-model="newGoal"
              type="text"
              class="form-input"
              placeholder="输入新目标..."
              @keyup.enter="addGoal"
            />
            <StratixButton variant="primary" size="sm" @click="addGoal">添加</StratixButton>
          </div>
        </div>

        <!-- Personality -->
        <div class="form-group">
          <label class="form-label">性格 PERSONALITY</label>
          <input
            v-model="soulPersonality"
            type="text"
            class="form-input"
            placeholder="描述 Agent 的性格特点..."
            @input="onPersonalityChange"
          />
        </div>
      </div>

      <!-- Rules Tab -->
      <div v-if="currentTab === 'rules'" class="tab-panel">
        <!-- Template Buttons -->
        <div class="form-group">
          <label class="form-label">规则模板 (快速选择)</label>
          <div class="template-buttons">
            <button
              v-for="t in RULE_TEMPLATES"
              :key="t.id"
              class="template-btn"
              :title="t.description"
              @click="applyRulesTemplate(t.id)"
            >
              {{ t.name }}
            </button>
          </div>
        </div>

        <!-- Rules List -->
        <div class="form-group">
          <label class="form-label">当前规则 ({{ rules.length }}条)</label>
          <div class="rules-list">
            <div v-for="(rule, index) in rules" :key="index" class="rule-item">
              <span class="rule-number">{{ index + 1 }}.</span>
              <span class="rule-text">{{ rule }}</span>
              <button class="remove-btn" @click="removeRule(index)">删除</button>
            </div>
            <div v-if="rules.length === 0" class="empty-message">暂无规则</div>
          </div>
        </div>

        <!-- Add Rule -->
        <div class="form-group">
          <label class="form-label">添加新规则</label>
          <div class="add-row">
            <input
              v-model="newRule"
              type="text"
              class="form-input"
              placeholder="输入新规则..."
              @keyup.enter="addRule"
            />
            <StratixButton variant="primary" size="sm" @click="addRule">添加</StratixButton>
          </div>
        </div>

        <!-- Clear All -->
        <div class="form-group" v-if="rules.length > 0">
          <StratixButton variant="danger" size="sm" @click="clearAllRules">
            清空所有规则
          </StratixButton>
        </div>
      </div>
    </div>

    <!-- Validation Errors -->
    <div v-if="validationErrors.length > 0" class="validation-errors">
      <div v-for="error in validationErrors" :key="error" class="error-item">
        ✗ {{ error }}
      </div>
    </div>

    <!-- Navigation -->
    <div class="nav-buttons">
      <StratixButton variant="secondary" size="sm" @click="$emit('prev')">
        上一步
      </StratixButton>
      <StratixButton variant="primary" size="sm" @click="handleComplete">
        完成创建
      </StratixButton>
    </div>
  </div>
</template>

<style scoped>
.agent-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.tabs {
  display: flex;
  border-bottom: 1px solid var(--ds-border);
}

.tab-btn {
  flex: 1;
  padding: 12px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--ds-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: var(--ds-text-primary);
}

.tab-btn.active {
  color: var(--ds-brand-primary);
  border-bottom-color: var(--ds-brand-primary);
}

.tab-content {
  flex: 1;
  overflow-y: auto;
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 11px;
  color: var(--ds-text-muted);
}

.form-input,
.form-select,
.form-textarea {
  width: 100%;
  padding: 8px 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  color: var(--ds-text-primary);
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
}

.form-textarea {
  min-height: 80px;
  resize: vertical;
}

.form-input:focus,
.form-select:focus,
.form-textarea:focus {
  border-color: var(--ds-brand-primary);
}

.goals-list,
.rules-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.goal-item,
.rule-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
}

.goal-text,
.rule-text {
  flex: 1;
  font-size: 12px;
  color: var(--ds-text-primary);
  line-height: 1.4;
}

.rule-number {
  color: var(--ds-brand-primary);
  font-size: 11px;
  min-width: 20px;
}

.remove-btn {
  padding: 4px 8px;
  background: transparent;
  border: 1px solid var(--ds-status-danger);
  border-radius: 4px;
  color: var(--ds-status-danger);
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s;
}

.remove-btn:hover {
  background: var(--ds-status-danger);
  color: white;
}

.empty-message {
  color: var(--ds-text-muted);
  font-size: 12px;
  text-align: center;
  padding: 20px;
}

.add-row {
  display: flex;
  gap: 8px;
}

.add-row .form-input {
  flex: 1;
}

.template-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.template-btn {
  padding: 6px 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  color: var(--ds-text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.template-btn:hover {
  border-color: var(--ds-brand-primary);
  color: var(--ds-brand-primary);
}

.validation-errors {
  padding: 12px;
  background: rgba(255, 102, 102, 0.1);
  border: 1px solid rgba(255, 102, 102, 0.3);
  border-radius: 6px;
}

.error-item {
  font-size: 12px;
  color: var(--ds-status-danger);
  margin-bottom: 4px;
}

.error-item:last-child {
  margin-bottom: 0;
}

.nav-buttons {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--ds-border);
}
</style>
