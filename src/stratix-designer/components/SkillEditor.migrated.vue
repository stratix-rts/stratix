<script setup lang="ts">
import { SvgIcon } from '@/components/ui';
import { ref, computed } from 'vue';
import { StratixSkillConfig, StratixSkillParameter } from '@/stratix-core/stratix-protocol';
import { StratixInput, StratixTextarea, StratixButton, StratixSelect, StratixCheckbox } from '@/components/ui';
import { getToken } from '@/design-system/config';
import { generateSkillId } from '../templates/types';

const props = defineProps<{ modelValue: StratixSkillConfig[] }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: StratixSkillConfig[]): void }>();

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
  updateSkill(skillIndex, { parameters: [...skill.parameters, newParam] });
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

const getSkillColor = (skillId: string): string => {
  const hash = skillId.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0);
  const colors = [getToken('colors.info'), '#9B59B6', '#E67E22', getToken('colors.semantic.success'), getToken('colors.semantic.danger')];
  return colors[Math.abs(hash) % colors.length];
};

const typeOptions = [
  { value: 'string', label: '字符串' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' },
  { value: 'object', label: '对象' },
];

</script>

<template>
  <div class="skill-editor">
    <div class="section-header">
      <svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <SvgIcon :name="zap" size="16" />
      </svg>
      <span class="section-title">技能配置 Skills</span>
      <span class="skill-count">{{ modelValue.length }} 个技能</span>
      <StratixButton variant="primary" size="sm" :icon="plus" @click="addSkill">
        添加技能
      </StratixButton>
    </div>

    <div class="skills-accordion">
      <div
        v-for="(skill, sIndex) in modelValue"
        :key="skill.skillId"
        :class="['skill-card', { expanded: activeSkill === skill.skillId }]"
      >
        <div class="skill-card-header" @click="activeSkill = activeSkill === skill.skillId ? null : skill.skillId">
          <div class="skill-icon" :style="{ background: getSkillColor(skill.skillId) }">
            {{ skill.name?.charAt(0).toUpperCase() || '?' }}
          </div>
          <div class="skill-card-info">
            <div class="skill-card-name">{{ skill.name || '未命名技能' }}</div>
            <div class="skill-card-id">{{ skill.skillId }}</div>
          </div>
          <div class="skill-card-meta">
            <span class="param-badge" v-if="skill.parameters.length">
              {{ skill.parameters.length }} 参数
            </span>
            <svg class="chevron-icon" :class="{ rotated: activeSkill === skill.skillId }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <SvgIcon :name="chevronDown" size="16" />
            </svg>
            <StratixButton
              variant="secondary"
              size="sm"
              :icon="trash"
              @click.stop="removeSkill(sIndex)"
              :disabled="modelValue.length <= 1"
            />
          </div>
        </div>

        <div class="skill-card-body" v-show="activeSkill === skill.skillId">
          <div class="form-row">
            <div class="form-group flex-1">
              <label class="label">技能 ID</label>
              <StratixInput :value="skill.skillId" disabled />
            </div>
            <div class="form-group flex-2">
              <label class="label label-required">技能名称</label>
              <StratixInput
                :value="skill.name"
                @update:value="updateSkill(sIndex, { name: $event })"
                placeholder="例如：快速写文案"
              />
            </div>
          </div>

          <div class="form-group">
            <label class="label">技能描述</label>
            <StratixTextarea
              :value="skill.description"
              @update:value="updateSkill(sIndex, { description: $event })"
              :rows="2"
              placeholder="描述技能的功能..."
            />
          </div>

          <div class="form-group">
            <label class="label">参数配置</label>
            <div class="params-list" v-if="skill.parameters.length">
              <div v-for="(param, pIndex) in skill.parameters" :key="param.paramId" class="param-item">
                <StratixInput
                  :value="param.paramId"
                  @update:value="updateParameter(sIndex, pIndex, { paramId: $event })"
                  placeholder="参数 ID"
                  size="sm"
                  class="param-id"
                />
                <StratixInput
                  :value="param.name"
                  @update:value="updateParameter(sIndex, pIndex, { name: $event })"
                  placeholder="参数名称"
                  size="sm"
                  class="param-name"
                />
                <StratixSelect
                  :value="param.type"
                  @update:value="updateParameter(sIndex, pIndex, { type: $event as any })"
                  :options="typeOptions"
                  size="sm"
                  class="param-type"
                />
                <StratixCheckbox
                  :value="param.required"
                  @update:value="updateParameter(sIndex, pIndex, { required: $event })"
                  size="sm"
                />
                <StratixInput
                  :value="param.defaultValue"
                  @update:value="updateParameter(sIndex, pIndex, { defaultValue: $event })"
                  placeholder="默认值"
                  size="sm"
                  class="param-default"
                />
                <StratixButton
                  variant="secondary"
                  size="sm"
                  :icon="trash"
                  @click="removeParameter(sIndex, pIndex)"
                />
              </div>
            </div>
            <StratixButton variant="secondary" :icon="plus" @click="addParameter(sIndex)" class="btn-add">
              添加参数
            </StratixButton>
          </div>

          <div class="form-group">
            <label class="label">执行脚本</label>
            <StratixTextarea
              :value="skill.executeScript"
              @update:value="updateSkill(sIndex, { executeScript: $event })"
              :rows="4"
              placeholder="输入执行脚本..."
              class="script-editor"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skill-editor {
  font-family: v-bind('getToken("typography.fontFamily.sans")');
  padding: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid v-bind('getToken("colors.border.default")');
}

.section-icon {
  width: 20px;
  height: 20px;
  color: v-bind('getToken("colors.warning")');
}

.section-title {
  font-family: v-bind('getToken("typography.fontFamily.mono")');
  font-size: 14px;
  font-weight: 600;
  color: v-bind('getToken("colors.text.primary")');
}

.skill-count {
  flex: 1;
  font-size: 13px;
  color: v-bind('getToken("colors.text.muted")');
}

.skills-accordion {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skill-card {
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s;
}

.skill-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  background: v-bind('getToken("colors.background.primary")');
}

.skill-card-header:hover {
  background: v-bind('getToken("colors.background.secondary")');
}

.skill-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 700;
  font-size: 18px;
  flex-shrink: 0;
}

.skill-card-info {
  flex: 1;
  min-width: 0;
}

.skill-card-name {
  font-size: 14px;
  font-weight: 600;
  color: v-bind('getToken("colors.text.primary")');
  margin-bottom: 2px;
}

.skill-card-id {
  font-size: 11px;
  color: v-bind('getToken("colors.text.muted")');
  font-family: v-bind('getToken("typography.fontFamily.mono")');
}

.skill-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.param-badge {
  font-size: 11px;
  color: v-bind('getToken("colors.info")');
  background: v-bind('getToken("colors.info") + "1A"');
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 500;
}

.chevron-icon {
  width: 16px;
  height: 16px;
  color: v-bind('getToken("colors.text.muted")');
  transition: transform 0.2s;
}

.chevron-icon.rotated {
  transform: rotate(180deg);
}

.skill-card-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: v-bind('getToken("colors.background.tertiary")');
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.flex-1 { flex: 1; }
.flex-2 { flex: 2; }

.label {
  font-size: 12px;
  font-weight: 500;
  color: v-bind('getToken("colors.text.secondary")');
}

.label-required::after {
  content: '*';
  color: v-bind('getToken("colors.semantic.danger")');
  margin-left: 4px;
}

.params-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.param-item {
  display: grid;
  grid-template-columns: 80px 1fr 1fr 50px 1fr 40px;
  gap: 8px;
  align-items: center;
  padding: 8px;
  background: v-bind('getToken("colors.background.secondary")');
  border-radius: 6px;
}

.param-id { min-width: 80px; }
.param-name { min-width: 120px; }
.param-type { min-width: 100px; }
.param-default { min-width: 100px; }

.btn-add {
  width: 100%;
  justify-content: center;
  margin-top: 8px;
}

.script-editor {
  font-family: v-bind('getToken("typography.fontFamily.mono")');
  font-size: 12px;
}
</style>
