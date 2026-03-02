<script setup lang="ts">
import { ref, computed } from 'vue';
import { StratixSkillConfig, StratixSkillParameter } from '@/stratix-core/stratix-protocol';
import { generateSkillId } from '../templates/types';

const props = defineProps<{
  modelValue: StratixSkillConfig[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: StratixSkillConfig[]): void;
}>();

const activeSkill = ref<string | null>(null);

const addSkill = () => {
  const newSkill: StratixSkillConfig = {
    skillId: generateSkillId(`custom-${Date.now()}`),
    name: '',
    description: '',
    parameters: [],
    executeScript: '',
  };
  emit('update:modelValue', [...props.modelValue, newSkill]);
  activeSkill.value = newSkill.skillId;
};

const removeSkill = (index: number) => {
  const newSkills = [...props.modelValue];
  newSkills.splice(index, 1);
  emit('update:modelValue', newSkills);
};

const updateSkill = (index: number, updates: Partial<StratixSkillConfig>) => {
  const newSkills = [...props.modelValue];
  newSkills[index] = { ...newSkills[index], ...updates };
  emit('update:modelValue', newSkills);
};

const addParameter = (skillIndex: number) => {
  const skill = props.modelValue[skillIndex];
  const newParam: StratixSkillParameter = {
    paramId: `param-${Date.now()}`,
    name: '',
    type: 'string',
    required: false,
    defaultValue: '',
  };
  updateSkill(skillIndex, {
    parameters: [...skill.parameters, newParam],
  });
};

const removeParameter = (skillIndex: number, paramIndex: number) => {
  const skill = props.modelValue[skillIndex];
  const newParams = [...skill.parameters];
  newParams.splice(paramIndex, 1);
  updateSkill(skillIndex, { parameters: newParams });
};

const updateParameter = (skillIndex: number, paramIndex: number, updates: Partial<StratixSkillParameter>) => {
  const skill = props.modelValue[skillIndex];
  const newParams = [...skill.parameters];
  newParams[paramIndex] = { ...newParams[paramIndex], ...updates };
  updateSkill(skillIndex, { parameters: newParams });
};

const getSkillIcon = (name: string): string => {
  return name ? name.charAt(0).toUpperCase() : '?';
};

const getSkillColor = (skillId: string): string => {
  const hash = skillId.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0);
  const colors = ['#4A90E2', '#9B59B6', '#E67E22', '#22C55E', '#EF4444'];
  return colors[Math.abs(hash) % colors.length];
};
</script>

<template>
  <div class="skill-editor">
    <div class="section-header">
      <svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
      </svg>
      <span class="section-title">技能配置 Skills</span>
      <span class="skill-count">{{ modelValue.length }} 个技能</span>
    </div>

    <div class="skills-accordion">
      <div
        v-for="(skill, sIndex) in modelValue"
        :key="skill.skillId"
        :class="['skill-card', { expanded: activeSkill === skill.skillId }]"
      >
        <div class="skill-card-header" @click="activeSkill = activeSkill === skill.skillId ? null : skill.skillId">
          <div class="skill-icon" :style="{ background: getSkillColor(skill.skillId) }">
            {{ getSkillIcon(skill.name) }}
          </div>
          <div class="skill-card-info">
            <div class="skill-card-name">{{ skill.name || '未命名技能' }}</div>
            <div class="skill-card-id">{{ skill.skillId }}</div>
          </div>
          <div class="skill-card-meta">
            <span class="param-badge" v-if="skill.parameters.length">
              {{ skill.parameters.length }} 参数
            </span>
            <svg class="chevron-icon" :class="{ rotated: activeSkill === skill.skillId }" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
            </svg>
            <button class="icon-btn danger" @click.stop="removeSkill(sIndex)" :disabled="modelValue.length <= 1" title="删除技能">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="skill-card-body" v-show="activeSkill === skill.skillId">
          <div class="form-row">
            <div class="form-group flex-1">
              <label class="label">技能 ID</label>
              <input :value="skill.skillId" class="input-field" disabled />
            </div>
            <div class="form-group flex-2">
              <label class="label label-required">技能名称</label>
              <input
                :value="skill.name"
                @input="updateSkill(sIndex, { name: ($event.target as HTMLInputElement).value })"
                class="input-field"
                placeholder="例如：快速写文案"
              />
            </div>
          </div>

          <div class="form-group">
            <label class="label">技能描述</label>
            <textarea
              :value="skill.description"
              @input="updateSkill(sIndex, { description: ($event.target as HTMLTextAreaElement).value })"
              class="textarea-field"
              :rows="2"
              placeholder="描述技能的功能..."
            />
          </div>

          <div class="form-group">
            <label class="label">参数配置</label>
            <div class="params-list" v-if="skill.parameters.length">
              <div v-for="(param, pIndex) in skill.parameters" :key="param.paramId" class="param-item">
                <input
                  :value="param.paramId"
                  @input="updateParameter(sIndex, pIndex, { paramId: ($event.target as HTMLInputElement).value })"
                  class="input-field param-id"
                  placeholder="参数ID"
                />
                <input
                  :value="param.name"
                  @input="updateParameter(sIndex, pIndex, { name: ($event.target as HTMLInputElement).value })"
                  class="input-field param-name"
                  placeholder="参数名称"
                />
                <select
                  :value="param.type"
                  @change="updateParameter(sIndex, pIndex, { type: ($event.target as HTMLSelectElement).value as any })"
                  class="select-field param-type"
                >
                  <option value="string">字符串</option>
                  <option value="number">数字</option>
                  <option value="boolean">布尔</option>
                  <option value="object">对象</option>
                </select>
                <label class="checkbox-label">
                  <input
                    type="checkbox"
                    :checked="param.required"
                    @change="updateParameter(sIndex, pIndex, { required: ($event.target as HTMLInputElement).checked })"
                  />
                  <span>必填</span>
                </label>
                <input
                  :value="param.defaultValue"
                  @input="updateParameter(sIndex, pIndex, { defaultValue: ($event.target as HTMLInputElement).value })"
                  class="input-field param-default"
                  placeholder="默认值"
                />
                <button class="icon-btn danger" @click="removeParameter(sIndex, pIndex)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            </div>
            <button class="btn-add" @click="addParameter(sIndex)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
              </svg>
              添加参数
            </button>
          </div>

          <div class="form-group">
            <label class="label">执行脚本 (JSON)</label>
            <textarea
              :value="skill.executeScript"
              @input="updateSkill(sIndex, { executeScript: ($event.target as HTMLTextAreaElement).value })"
              class="textarea-field code-field"
              :rows="3"
              placeholder='{"action":"...","params":{...}}'
            />
          </div>
        </div>
      </div>
    </div>

    <button class="btn-add-skill" @click="addSkill">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
      </svg>
      添加新技能
    </button>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap');

.skill-editor {
  font-family: 'Fira Sans', sans-serif;
  padding: 20px;
  animation: fadeIn 200ms ease;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #1E293B;
}

.section-icon {
  width: 20px;
  height: 20px;
  color: #22C55E;
}

.section-title {
  font-family: 'Fira Code', monospace;
  font-size: 14px;
  font-weight: 600;
  color: #F8FAFC;
  flex: 1;
}

.skill-count {
  font-size: 12px;
  color: #64748B;
  background: #0F172A;
  padding: 4px 10px;
  border-radius: 12px;
}

.skills-accordion {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.skill-card {
  background: #0F172A;
  border: 1px solid #1E293B;
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 200ms ease;
}

.skill-card.expanded {
  border-color: #22C55E;
}

.skill-card-header {
  display: flex;
  align-items: center;
  padding: 12px;
  cursor: pointer;
  transition: background 200ms ease;
}

.skill-card-header:hover {
  background: #1E293B;
}

.skill-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 700;
  font-size: 14px;
  margin-right: 12px;
  flex-shrink: 0;
}

.skill-card-info {
  flex: 1;
  min-width: 0;
}

.skill-card-name {
  font-weight: 600;
  font-size: 14px;
  color: #F8FAFC;
}

.skill-card-id {
  font-family: 'Fira Code', monospace;
  font-size: 11px;
  color: #64748B;
  margin-top: 2px;
}

.skill-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.param-badge {
  font-size: 11px;
  color: #22C55E;
  background: rgba(34, 197, 94, 0.1);
  padding: 2px 8px;
  border-radius: 10px;
}

.chevron-icon {
  width: 16px;
  height: 16px;
  color: #64748B;
  transition: transform 200ms ease;
}

.chevron-icon.rotated {
  transform: rotate(180deg);
}

.icon-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #64748B;
  cursor: pointer;
  transition: all 200ms ease;
}

.icon-btn svg {
  width: 14px;
  height: 14px;
}

.icon-btn:hover:not(:disabled) {
  background: #1E293B;
  color: #F8FAFC;
}

.icon-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
  border-color: #EF4444;
  color: #EF4444;
}

.icon-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.skill-card-body {
  padding: 16px;
  border-top: 1px solid #1E293B;
  animation: fadeIn 150ms ease;
}

.form-row {
  display: flex;
  gap: 12px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group.flex-1 { flex: 1; }
.form-group.flex-2 { flex: 2; }

.label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: #94A3B8;
  margin-bottom: 6px;
}

.label-required::after {
  content: ' *';
  color: #EF4444;
}

.input-field {
  width: 100%;
  padding: 8px 12px;
  background: #020617;
  border: 1px solid #1E293B;
  border-radius: 6px;
  color: #F8FAFC;
  font-size: 13px;
  font-family: 'Fira Sans', sans-serif;
  transition: border-color 200ms ease;
}

.input-field::placeholder {
  color: #475569;
}

.input-field:focus {
  outline: none;
  border-color: #22C55E;
}

.input-field:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.textarea-field {
  width: 100%;
  padding: 8px 12px;
  background: #020617;
  border: 1px solid #1E293B;
  border-radius: 6px;
  color: #F8FAFC;
  font-size: 13px;
  font-family: 'Fira Sans', sans-serif;
  resize: vertical;
  min-height: 60px;
  transition: border-color 200ms ease;
}

.textarea-field::placeholder {
  color: #475569;
}

.textarea-field:focus {
  outline: none;
  border-color: #22C55E;
}

.code-field {
  font-family: 'Fira Code', monospace;
  font-size: 12px;
}

.select-field {
  padding: 8px 12px;
  background: #020617;
  border: 1px solid #1E293B;
  border-radius: 6px;
  color: #F8FAFC;
  font-size: 13px;
  cursor: pointer;
}

.params-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.param-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: #020617;
  border-radius: 6px;
}

.param-id { width: 100px; font-family: 'Fira Code', monospace; font-size: 11px; }
.param-name { flex: 1; }
.param-type { width: 90px; }
.param-default { width: 100px; }

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #94A3B8;
  cursor: pointer;
}

.checkbox-label input {
  width: 14px;
  height: 14px;
  accent-color: #22C55E;
}

.btn-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  border: 1px dashed #334155;
  border-radius: 6px;
  color: #22C55E;
  font-size: 12px;
  cursor: pointer;
  transition: all 200ms ease;
}

.btn-add svg {
  width: 14px;
  height: 14px;
}

.btn-add:hover {
  background: rgba(34, 197, 94, 0.1);
  border-color: #22C55E;
}

.btn-add-skill {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px;
  background: transparent;
  border: 2px dashed #334155;
  border-radius: 8px;
  color: #22C55E;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 200ms ease;
}

.btn-add-skill svg {
  width: 18px;
  height: 18px;
}

.btn-add-skill:hover {
  background: rgba(34, 197, 94, 0.1);
  border-color: #22C55E;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .skill-editor { animation: none; }
  .skill-card-body { animation: none; }
}
</style>
